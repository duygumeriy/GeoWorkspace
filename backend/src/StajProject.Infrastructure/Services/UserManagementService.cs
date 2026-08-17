using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// <see cref="IUserManagementService"/> implementasyonu. Rol işlemleri
/// Identity'nin <see cref="UserManager{TUser}"/> API'si üzerinden yapılır;
/// user_roles tablosuna elle yazılmaz.
/// </summary>
public class UserManagementService : IUserManagementService
{
    /// <summary>
    /// Rol/durum değişikliklerini serileştiren advisory lock anahtarı.
    /// <para>
    /// Son aktif Admin koruması "önce say, sonra değiştir" şeklinde çalışır ve
    /// bu iki adım arasında başka bir istek araya girerse iki eşzamanlı istek
    /// iki farklı Admin'i düşürüp sistemi adminsiz bırakabilirdi. PostgreSQL
    /// transaction-scoped advisory lock'u tüm rol/durum mutasyonlarını sıraya
    /// sokarak bu yarışı imkânsız kılar; kilit transaction bitince kendiliğinden
    /// bırakılır.
    /// </para>
    /// </summary>
    private const long RoleMutationLockKey = 8314927001L;

    /// <summary>
    /// Yönetici notu için üst sınır. Entity tarafındaki kolon uzunluğuyla
    /// aynıdır; doğrulama, veritabanı hatasından önce anlaşılır bir mesaj verir.
    /// </summary>
    private const int MaxRejectionReasonLength = 500;

    private readonly AppDbContext _dbContext;
    private readonly UserManager<User> _userManager;
    private readonly IEmailSender _emailSender;
    private readonly ClientAppOptions _clientApp;
    private readonly ILogger<UserManagementService> _logger;

    public UserManagementService(
        AppDbContext dbContext,
        UserManager<User> userManager,
        IEmailSender emailSender,
        ClientAppOptions clientApp,
        ILogger<UserManagementService> logger)
    {
        _dbContext = dbContext;
        _userManager = userManager;
        _emailSender = emailSender;
        _clientApp = clientApp;
        _logger = logger;
    }

    /* --- Okuma --------------------------------------------------------------- */

    public async Task<IReadOnlyList<AdminUserListItem>> GetUsersAsync(CancellationToken cancellationToken = default) =>
        await BuildUserQuery()
            .OrderBy(u => u.Id)
            .ToListAsync(cancellationToken);

    public async Task<ServiceResult<AdminUserDetail>> GetUserAsync(int userId, CancellationToken cancellationToken = default)
    {
        var item = await BuildDetailQuery()
            .SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);

        return item is null
            ? ServiceResult<AdminUserDetail>.NotFound("Kullanıcı bulunamadı.")
            : ServiceResult<AdminUserDetail>.Success(item);
    }

    /// <summary>
    /// Onay ekranında sunulacak roller. Kaynak <see cref="ApplicationRoles.All"/>
    /// olduğu için istemcinin gördüğü liste ile sunucunun kabul ettiği liste
    /// aynı yerden türer.
    /// </summary>
    public IReadOnlyList<AssignableRole> GetAssignableRoles() =>
        ApplicationRoles.All
            .Select(role => new AssignableRole
            {
                Name = role,
                Description = role == ApplicationRoles.Admin
                    ? "Kullanıcı yönetimi ve tüm çizimler üzerinde yönetim yetkisi."
                    : "Harita uygulamasına erişim; kendi çizimlerini oluşturur ve yönetir.",
                RequiresTwoFactor = role == ApplicationRoles.Admin
            })
            .ToArray();

    /* --- Rol değişikliği ------------------------------------------------------ */

    public async Task<ServiceResult<AdminUserDetail>> ChangeRoleAsync(
        int userId,
        UpdateUserRoleRequest request,
        int actingUserId,
        CancellationToken cancellationToken = default)
    {
        if (!ApplicationRoles.TryParse(request.Role, out var targetRole))
        {
            return InvalidRole();
        }

        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        await AcquireRoleMutationLockAsync(cancellationToken);

        var user = await FindManageableUserAsync(userId, cancellationToken);

        if (user is null)
        {
            return ServiceResult<AdminUserDetail>.NotFound("Kullanıcı bulunamadı.");
        }

        /* Onay akışındaki hesabın rolü bu uçtan değiştirilemez: rol atamak onu
           sessizce "rolü var ama onaylanmamış" hâline getirir ve onay ekranının
           tek giriş noktası olmasını bozardı. */
        if (user.AccountStatus is AccountStatus.PendingEmailVerification
            or AccountStatus.PendingApproval
            or AccountStatus.Rejected)
        {
            return ServiceResult<AdminUserDetail>.Conflict(
                "Bu hesap henüz onaylanmadığı için rolü değiştirilemez. Rol, onay işlemi sırasında atanır.");
        }

        var currentRoles = await _userManager.GetRolesAsync(user);
        var currentRole = currentRoles.FirstOrDefault();

        if (string.Equals(currentRole, targetRole, StringComparison.Ordinal) && currentRoles.Count == 1)
        {
            // Değişiklik yok: gereksiz yazma ve audit log üretme.
            await transaction.CommitAsync(cancellationToken);
            return await ReloadAsync(userId, cancellationToken);
        }

        // Admin'likten düşürülüyorsa sistemin adminsiz kalmadığını doğrula.
        if (IsLosingActiveAdmin(user, currentRoles, targetRole))
        {
            var guard = await GuardLastActiveAdminAsync(userId, actingUserId, cancellationToken);
            if (guard is not null)
            {
                return guard;
            }
        }

        var assignment = await AssignPrimaryRoleAsync(user, targetRole);

        if (assignment is not null)
        {
            return assignment;
        }

        await transaction.CommitAsync(cancellationToken);

        // Audit: kim, kimin rolünü, neden değiştirdi. Token/şifre/e-posta yok.
        _logger.LogInformation(
            "Rol değişikliği: acting UserId={ActingUserId} target UserId={TargetUserId} {OldRole} -> {NewRole}",
            actingUserId,
            userId,
            currentRole ?? "(yok)",
            targetRole);

        return await ReloadAsync(userId, cancellationToken);
    }

    /* --- Aktif/pasif ---------------------------------------------------------- */

    public async Task<ServiceResult<AdminUserDetail>> ChangeStatusAsync(
        int userId,
        UpdateUserStatusRequest request,
        int actingUserId,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        await AcquireRoleMutationLockAsync(cancellationToken);

        var user = await FindManageableUserAsync(userId, cancellationToken);

        if (user is null)
        {
            return ServiceResult<AdminUserDetail>.NotFound("Kullanıcı bulunamadı.");
        }

        /* Aktifleştirme YALNIZCA askıya alınmış hesabı geri açar. Onay
           bekleyen veya reddedilmiş bir hesabı buradan aktifleştirmek, onay
           kapısının etrafından dolaşıp kullanıcıya rolsüz erişim vermek
           olurdu — onay akışının tek kapısı ApproveAsync'tir. */
        if (request.IsActive && user.AccountStatus != AccountStatus.Suspended)
        {
            if (user.AccountStatus == AccountStatus.Active && user.IsActive)
            {
                await transaction.CommitAsync(cancellationToken);
                return await ReloadAsync(userId, cancellationToken);
            }

            return ServiceResult<AdminUserDetail>.Conflict(
                "Bu hesap onay akışındadır. Aktifleştirmek için rol atayıp onaylamanız gerekir.");
        }

        if (!request.IsActive && user.AccountStatus != AccountStatus.Active)
        {
            // Zaten aktif olmayan hesap için pasifleştirme anlamsızdır; durum
            // ne ise korunur (onay bekleyen hesap "askıya alınmış" olmaz).
            await transaction.CommitAsync(cancellationToken);
            return await ReloadAsync(userId, cancellationToken);
        }

        // Pasifleştirme, son aktif Admin'i devre dışı bırakıyorsa engellenir.
        if (!request.IsActive && await _userManager.IsInRoleAsync(user, ApplicationRoles.Admin))
        {
            var guard = await GuardLastActiveAdminAsync(userId, actingUserId, cancellationToken);
            if (guard is not null)
            {
                return guard;
            }
        }

        // is_active ve account_status daima BİRLİKTE yazılır; ikisinin
        // ayrışması login kapısında belirsizlik yaratırdı.
        user.IsActive = request.IsActive;
        user.AccountStatus = request.IsActive ? AccountStatus.Active : AccountStatus.Suspended;

        var update = await _userManager.UpdateAsync(user);
        if (!update.Succeeded)
        {
            return Failed<AdminUserDetail>("Kullanıcı durumu güncellenemedi.", update);
        }

        await transaction.CommitAsync(cancellationToken);

        _logger.LogInformation(
            "Hesap durumu değişikliği: acting UserId={ActingUserId} target UserId={TargetUserId} IsActive={IsActive}",
            actingUserId,
            userId,
            request.IsActive);

        return await ReloadAsync(userId, cancellationToken);
    }

    /* --- Onay ----------------------------------------------------------------- */

    public async Task<ServiceResult<AdminUserDetail>> ApproveAsync(
        int userId,
        ApproveUserRequest request,
        int actingUserId,
        CancellationToken cancellationToken = default)
    {
        if (!ApplicationRoles.TryParse(request.Role, out var targetRole))
        {
            return InvalidRole();
        }

        string approvedRole;

        /* --- Kritik bölge ------------------------------------------------------
           Rol ataması ve aktifleştirme TEK transaction içindedir. Ayrı ayrı
           yazılsalardı, aradaki bir hata hesabı "aktif ama rolsüz" — yani
           hiçbir authorization kuralına uymayan — bir durumda bırakabilirdi.
           Transaction commit edilene kadar kullanıcı onay bekliyor sayılır. */
        await using (var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken))
        {
            await AcquireRoleMutationLockAsync(cancellationToken);

            var user = await FindManageableUserAsync(userId, cancellationToken);

            if (user is null)
            {
                return ServiceResult<AdminUserDetail>.NotFound("Kullanıcı bulunamadı.");
            }

            if (!user.EmailConfirmed)
            {
                return ServiceResult<AdminUserDetail>.Failure(
                    "Bu kullanıcı e-posta adresini doğrulamadığı için onaylanamaz.");
            }

            /* Yalnızca onay bekleyen hesap onaylanabilir. Zaten aktif bir
               hesabın yeniden onaylanması sessizce başarılı sayılmaz: onay
               metadata'sını ve rolünü ezerdi. */
            if (user.AccountStatus != AccountStatus.PendingApproval)
            {
                return ServiceResult<AdminUserDetail>.Conflict(DescribeUnapprovable(user.AccountStatus));
            }

            var assignment = await AssignPrimaryRoleAsync(user, targetRole);

            if (assignment is not null)
            {
                return assignment;
            }

            user.AccountStatus = AccountStatus.Active;
            user.IsActive = true;
            user.ApprovedAt = DateTime.UtcNow;
            // Onaylayan, istek gövdesinden DEĞİL, doğrulanmış yönetici kimliğinden gelir.
            user.ApprovedByUserId = actingUserId;

            var update = await _userManager.UpdateAsync(user);

            if (!update.Succeeded)
            {
                // Commit edilmediği için rol ataması da geri alınır.
                return Failed<AdminUserDetail>("Hesap aktifleştirilemedi.", update);
            }

            await transaction.CommitAsync(cancellationToken);

            approvedRole = targetRole;
        }

        _logger.LogInformation(
            "Hesap onaylandı: acting UserId={ActingUserId} target UserId={TargetUserId} Rol={Role}",
            actingUserId,
            userId,
            approvedRole);

        var result = await ReloadAsync(userId, cancellationToken);

        /* E-posta transaction'ın DIŞINDA ve commit'ten SONRA gönderilir.
           Arıza durumunda hesap aktif kalır: kullanıcı zaten giriş yapabilir
           durumdadır, onu yeniden onay sırasına düşürmek gerçek bir yönetici
           kararını bir SMTP arızası yüzünden geri almak olurdu. */
        var warning = await TryNotifyAsync(
            userId,
            "approval",
            () => BuildApprovalEmail(result.Value!, approvedRole),
            cancellationToken);

        return WithWarning(result, warning);
    }

    public async Task<ServiceResult<AdminUserDetail>> RejectAsync(
        int userId,
        RejectUserRequest request,
        int actingUserId,
        CancellationToken cancellationToken = default)
    {
        var reason = request.Reason?.Trim();

        if (reason is { Length: > MaxRejectionReasonLength })
        {
            return ServiceResult<AdminUserDetail>.Failure(
                $"Gerekçe en fazla {MaxRejectionReasonLength} karakter olabilir.");
        }

        await using (var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken))
        {
            await AcquireRoleMutationLockAsync(cancellationToken);

            var user = await FindManageableUserAsync(userId, cancellationToken);

            if (user is null)
            {
                return ServiceResult<AdminUserDetail>.NotFound("Kullanıcı bulunamadı.");
            }

            /* Reddetme, henüz onaylanmamış başvurular içindir. Doğrulama
               aşamasındaki hesap da kapsamdadır: yönetici, e-postasını hiç
               doğrulamamış bir başvuruyu da kapatabilmelidir. Aktif bir hesabı
               kapatmanın yolu ise reddetme değil, pasifleştirmedir. */
            if (user.AccountStatus is not (AccountStatus.PendingApproval or AccountStatus.PendingEmailVerification))
            {
                return ServiceResult<AdminUserDetail>.Conflict(
                    user.AccountStatus == AccountStatus.Rejected
                        ? "Bu başvuru zaten reddedilmiş."
                        : "Yalnızca onay bekleyen başvurular reddedilebilir. Aktif bir hesabı kapatmak için pasifleştirin.");
            }

            user.AccountStatus = AccountStatus.Rejected;
            user.IsActive = false;
            user.RejectedAt = DateTime.UtcNow;
            user.RejectedByUserId = actingUserId;
            user.RejectionReason = string.IsNullOrWhiteSpace(reason) ? null : reason;

            var update = await _userManager.UpdateAsync(user);

            if (!update.Succeeded)
            {
                return Failed<AdminUserDetail>("Başvuru reddedilemedi.", update);
            }

            await transaction.CommitAsync(cancellationToken);
        }

        // Gerekçenin KENDİSİ loglanmaz: serbest metin, kişisel veri içerebilir.
        _logger.LogInformation(
            "Hesap başvurusu reddedildi: acting UserId={ActingUserId} target UserId={TargetUserId} GerekçeVar={HasReason}",
            actingUserId,
            userId,
            !string.IsNullOrWhiteSpace(reason));

        var result = await ReloadAsync(userId, cancellationToken);

        var warning = await TryNotifyAsync(
            userId,
            "rejection",
            () => BuildRejectionEmail(result.Value!),
            cancellationToken);

        return WithWarning(result, warning);
    }

    /* --- Bildirim ------------------------------------------------------------- */

    /// <summary>
    /// Bilgilendirme e-postasını gönderir. Gönderim başarısız olursa
    /// <b>exception yukarı taşınmaz</b>; yalnızca yöneticiye gösterilecek
    /// uyarı metni döner. Veritabanı işlemi bu noktada zaten commit edilmiştir.
    /// </summary>
    private async Task<string?> TryNotifyAsync(
        int userId,
        string kind,
        Func<EmailMessage?> build,
        CancellationToken cancellationToken)
    {
        try
        {
            var message = build();

            if (message is null)
            {
                // Adresi olmayan devralınmış kayıt: gönderilecek yer yok.
                return "Kullanıcının e-posta adresi bulunmadığı için bilgilendirme gönderilemedi.";
            }

            await _emailSender.SendAsync(message, cancellationToken);
            return null;
        }
        catch (Exception exception)
        {
            /* Exception nesnesi tam hâliyle loglanır (operatör tanısı için),
               fakat adres/bağlantı gövdeye yazılmaz. */
            _logger.LogError(
                exception,
                "Hesap bildirimi gönderilemedi; hesap durumu DEĞİŞTİRİLMEDİ. UserId={UserId} Tür={Kind}",
                userId,
                kind);

            return "İşlem kaydedildi ancak bilgilendirme e-postası gönderilemedi. " +
                   "Kullanıcının durumu değişmedi; gerekirse kullanıcıya ayrıca bilgi verin.";
        }
    }

    private EmailMessage? BuildApprovalEmail(AdminUserDetail user, string role)
    {
        if (string.IsNullOrWhiteSpace(user.Email))
        {
            return null;
        }

        /* İçerikte şifre, token, kurtarma kodu veya yönetici kimliği YOKTUR —
           yalnızca kullanıcının kendi hesabıyla ilgili bilmesi gerekenler. */
        return new EmailMessage
        {
            To = user.Email,
            Subject = "Hesabınız onaylandı",
            Body =
                $"Merhaba {user.Username},\n\n" +
                "Hesabınız yönetici tarafından onaylandı ve aktifleştirildi.\n" +
                "Artık hesabınızla uygulamaya giriş yapabilirsiniz.\n\n" +
                $"Atanan rol: {role}",
            ActionUrl = $"{_clientApp.BaseUrl.TrimEnd('/')}/login"
        };
    }

    private static EmailMessage? BuildRejectionEmail(AdminUserDetail user)
    {
        if (string.IsNullOrWhiteSpace(user.Email))
        {
            return null;
        }

        /* Yönetici notu (RejectionReason) BİLEREK dışarıda bırakılır: iç
           değerlendirme kaydıdır ve serbest metin olduğu için başvuru sahibine
           gitmesi amaçlanmamıştır. */
        return new EmailMessage
        {
            To = user.Email,
            Subject = "Hesap başvurunuz hakkında",
            Body =
                $"Merhaba {user.Username},\n\n" +
                "Hesap başvurunuz onaylanmadı ve uygulamaya erişim tanımlanmadı.\n" +
                "Konuyla ilgili ayrıntı için kurumunuzdaki yetkiliyle iletişime geçebilirsiniz."
        };
    }

    /* --- Yardımcılar ---------------------------------------------------------- */

    /// <summary>
    /// Rol/durum mutasyonlarını sıraya sokar. Transaction commit/rollback
    /// olduğunda kilit otomatik bırakılır.
    /// </summary>
    /// <remarks>
    /// Advisory lock PostgreSQL'e özgüdür. Provider Npgsql değilse (testlerdeki
    /// in-memory provider) atlanır: orada tek bir bağlantı üzerinde sıralı
    /// çalışıldığı için korunacak bir yarış zaten yoktur.
    /// </remarks>
    private Task AcquireRoleMutationLockAsync(CancellationToken cancellationToken) =>
        _dbContext.Database.IsNpgsql()
            ? _dbContext.Database.ExecuteSqlRawAsync(
                "SELECT pg_advisory_xact_lock({0})",
                [RoleMutationLockKey],
                cancellationToken)
            : Task.CompletedTask;

    private Task<User?> FindManageableUserAsync(int userId, CancellationToken cancellationToken) =>
        _userManager.Users.SingleOrDefaultAsync(u => u.Id == userId && !u.IsDeleted, cancellationToken);

    /// <summary>
    /// Tek primary role kuralı: yeni rol eklenmeden önce mevcut application
    /// role'lerinin TAMAMI kaldırılır; kullanıcıda asla iki application role
    /// birden kalmaz. Sorun yoksa <c>null</c> döner.
    /// </summary>
    private async Task<ServiceResult<AdminUserDetail>?> AssignPrimaryRoleAsync(User user, string targetRole)
    {
        var currentRoles = await _userManager.GetRolesAsync(user);
        var rolesToRemove = currentRoles.Where(r => ApplicationRoles.All.Contains(r)).ToArray();

        if (rolesToRemove.Length > 0)
        {
            var removal = await _userManager.RemoveFromRolesAsync(user, rolesToRemove);
            if (!removal.Succeeded)
            {
                return Failed<AdminUserDetail>("Rol kaldırılamadı.", removal);
            }
        }

        var assignment = await _userManager.AddToRoleAsync(user, targetRole);

        return assignment.Succeeded
            ? null
            : Failed<AdminUserDetail>("Rol atanamadı.", assignment);
    }

    private static bool IsLosingActiveAdmin(User user, IList<string> currentRoles, string targetRole) =>
        user.IsActive
        && currentRoles.Contains(ApplicationRoles.Admin)
        && !string.Equals(targetRole, ApplicationRoles.Admin, StringComparison.Ordinal);

    /// <summary>
    /// Hedef kullanıcı dışında en az bir aktif Admin kalmıyorsa 409 döner.
    /// Kural hem başkası hem de kişinin kendisi için aynıdır: sistemin son
    /// Admin'i hiçbir koşulda kendini kilitleyemez.
    /// </summary>
    private async Task<ServiceResult<AdminUserDetail>?> GuardLastActiveAdminAsync(
        int targetUserId,
        int actingUserId,
        CancellationToken cancellationToken)
    {
        var admins = await _userManager.GetUsersInRoleAsync(ApplicationRoles.Admin);

        var otherActiveAdmins = admins.Count(a => a.Id != targetUserId && a.IsActive && !a.IsDeleted);

        if (otherActiveAdmins > 0)
        {
            return null;
        }

        _logger.LogWarning(
            "Son aktif Admin koruması devreye girdi: acting UserId={ActingUserId} target UserId={TargetUserId}",
            actingUserId,
            targetUserId);

        return ServiceResult<AdminUserDetail>.Conflict(
            targetUserId == actingUserId
                ? "Sistemdeki son aktif yöneticisiniz; kendi yönetici yetkinizi kaldıramaz veya hesabınızı pasifleştiremezsiniz. Önce başka bir aktif yönetici tanımlayın."
                : "Bu kullanıcı sistemdeki son aktif yönetici. Önce başka bir aktif yönetici tanımlayın.");
    }

    /// <summary>
    /// Kullanıcıları tek sorguda primary role'leriyle projekte eder
    /// (kullanıcı başına ayrı rol sorgusu yapılmaz).
    /// </summary>
    private IQueryable<AdminUserListItem> BuildUserQuery() =>
        _dbContext.Users
            .AsNoTracking()
            .Where(u => !u.IsDeleted)
            .Select(u => new AdminUserListItem
            {
                Id = u.Id,
                Username = u.UserName!,
                Email = u.Email,
                Role = (from userRole in _dbContext.UserRoles
                        join role in _dbContext.Roles on userRole.RoleId equals role.Id
                        where userRole.UserId == u.Id
                        select role.Name).FirstOrDefault(),
                IsActive = u.IsActive,
                EmailConfirmed = u.EmailConfirmed,
                AccountStatus = u.AccountStatus,
                TwoFactorEnabled = u.TwoFactorEnabled,
                LockoutEnd = u.LockoutEnd,
                ModifiedDate = u.ModifiedDate
            });

    /// <summary>
    /// Detay projeksiyonu: listeye ek olarak onay/red audit alanlarını taşır.
    /// Bu alanlar listede yer almaz — yalnızca inceleme ekranında anlamlıdırlar
    /// ve her satırda iki ek alt sorgu maliyeti çıkarırlardı.
    /// </summary>
    private IQueryable<AdminUserDetail> BuildDetailQuery() =>
        _dbContext.Users
            .AsNoTracking()
            .Where(u => !u.IsDeleted)
            .Select(u => new AdminUserDetail
            {
                Id = u.Id,
                Username = u.UserName!,
                Email = u.Email,
                Role = (from userRole in _dbContext.UserRoles
                        join role in _dbContext.Roles on userRole.RoleId equals role.Id
                        where userRole.UserId == u.Id
                        select role.Name).FirstOrDefault(),
                IsActive = u.IsActive,
                EmailConfirmed = u.EmailConfirmed,
                AccountStatus = u.AccountStatus,
                TwoFactorEnabled = u.TwoFactorEnabled,
                LockoutEnd = u.LockoutEnd,
                ModifiedDate = u.ModifiedDate,
                ApprovedAt = u.ApprovedAt,
                ApprovedByUserId = u.ApprovedByUserId,
                ApprovedByUsername = _dbContext.Users
                    .Where(a => a.Id == u.ApprovedByUserId)
                    .Select(a => a.UserName)
                    .FirstOrDefault(),
                RejectedAt = u.RejectedAt,
                RejectedByUserId = u.RejectedByUserId,
                RejectedByUsername = _dbContext.Users
                    .Where(a => a.Id == u.RejectedByUserId)
                    .Select(a => a.UserName)
                    .FirstOrDefault(),
                RejectionReason = u.RejectionReason
            });

    private async Task<ServiceResult<AdminUserDetail>> ReloadAsync(int userId, CancellationToken cancellationToken) =>
        await GetUserAsync(userId, cancellationToken);

    /// <summary>
    /// Başarılı sonuca e-posta uyarısını iliştirir. Uyarı sonucu
    /// <b>başarısızlığa çevirmez</b>: veritabanı işlemi gerçekten tamamlanmıştır.
    /// </summary>
    private static ServiceResult<AdminUserDetail> WithWarning(
        ServiceResult<AdminUserDetail> result,
        string? warning)
    {
        if (result.IsSuccess && warning is not null)
        {
            result.Value!.NotificationWarning = warning;
        }

        return result;
    }

    private static ServiceResult<AdminUserDetail> InvalidRole() =>
        ServiceResult<AdminUserDetail>.Failure(
            $"Geçersiz rol. Yalnızca şu roller atanabilir: {string.Join(", ", ApplicationRoles.All)}.");

    private static string DescribeUnapprovable(AccountStatus status) => status switch
    {
        AccountStatus.PendingEmailVerification =>
            "Bu kullanıcı e-posta adresini doğrulamadığı için onaylanamaz.",
        AccountStatus.Active =>
            "Bu hesap zaten onaylanmış ve aktif.",
        AccountStatus.Suspended =>
            "Bu hesap askıya alınmış. Yeniden erişim vermek için hesabı aktifleştirin.",
        _ =>
            "Bu başvuru reddedilmiş. Onaylanabilmesi için yeniden değerlendirilmesi gerekir."
    };

    private static ServiceResult<T> Failed<T>(string message, IdentityResult result) =>
        ServiceResult<T>.Failure($"{message} {string.Join(" ", result.Errors.Select(e => e.Description))}".Trim());
}
