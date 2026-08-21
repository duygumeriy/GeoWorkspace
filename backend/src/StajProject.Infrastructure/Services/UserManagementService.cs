using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
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
    /// <summary>
    /// Yönetici notu için üst sınır. Entity tarafındaki kolon uzunluğuyla
    /// aynıdır; doğrulama, veritabanı hatasından önce anlaşılır bir mesaj verir.
    /// </summary>
    private const int MaxRejectionReasonLength = 500;

    private readonly AppDbContext _dbContext;
    private readonly UserManager<User> _userManager;

    /* Atanabilir rol kuralının TEK sahibi. Onay ve rol değiştirme akışları
       kendi doğrulamalarını yazmaz; ikisi de buraya sorar, böylece iki uç
       zamanla farklı kurallara kayamaz. */
    private readonly IRoleManagementService _roleManagement;
    private readonly IEffectivePermissionService _effectivePermissions;
    private readonly IEmailSender _emailSender;
    private readonly ClientAppOptions _clientApp;
    private readonly ILogger<UserManagementService> _logger;
    private readonly IAccountService? _accountService;

    public UserManagementService(
        AppDbContext dbContext,
        UserManager<User> userManager,
        IRoleManagementService roleManagement,
        IEmailSender emailSender,
        ClientAppOptions clientApp,
        ILogger<UserManagementService> logger,
        IEffectivePermissionService? effectivePermissions = null,
        IAccountService? accountService = null)
    {
        _dbContext = dbContext;
        _userManager = userManager;
        _roleManagement = roleManagement;
        _effectivePermissions = effectivePermissions ?? new EffectivePermissionService(dbContext);
        _emailSender = emailSender;
        _clientApp = clientApp;
        _logger = logger;
        _accountService = accountService;
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

    /* --- Oluşturma ------------------------------------------------------------ */

    public async Task<ServiceResult<AdminUserDetail>> CreateUserAsync(
        CreateAdminUserRequest request,
        int actingUserId,
        CancellationToken cancellationToken = default)
    {
        var resolved = await _roleManagement.ResolveAssignableRoleAsync(
            request.Role,
            actingUserId,
            cancellationToken);

        if (!resolved.IsSuccess)
        {
            return Rejected(resolved);
        }

        var username = request.Username?.Trim() ?? string.Empty;
        var email = request.Email?.Trim() ?? string.Empty;

        if (username.Length == 0)
        {
            return ServiceResult<AdminUserDetail>.Failure("Kullanıcı adı zorunludur.");
        }

        if (email.Length == 0)
        {
            return ServiceResult<AdminUserDetail>.Failure("E-posta adresi zorunludur.");
        }

        var user = new User
        {
            UserName = username,
            Email = email,
            EmailConfirmed = false,
            IsActive = false,
            IsDeleted = false,
            AccountStatus = AccountStatus.InvitationPending
        };

        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        // Bilerek parola overload'u kullanılmaz: parolayı ileride kullanıcı belirler.
        var creation = await _userManager.CreateAsync(user);

        if (!creation.Succeeded)
        {
            return CreationFailed(creation);
        }

        var assignment = await _userManager.AddToRoleAsync(user, resolved.Value!);

        if (!assignment.Succeeded)
        {
            /* Relational sağlayıcıda transaction dispose edilirken kullanıcı
               eklemesi geri alınır. Hesap o ana kadar da doğrulanmamış, pasif
               ve InvitationPending olduğundan hiçbir erişim kazanamaz. */
            return Failed<AdminUserDetail>("Kullanıcı rolü atanamadı; hesap oluşturulmadı.", assignment);
        }

        await transaction.CommitAsync(cancellationToken);

        _logger.LogInformation(
            "Yönetici parolasız kullanıcı oluşturdu: acting UserId={ActingUserId} target UserId={TargetUserId} Rol={Role}",
            actingUserId,
            user.Id,
            resolved.Value);

        var result = await ReloadAsync(user.Id, cancellationToken);
        var warning = await TrySendInvitationAsync(
            user.Id,
            "create",
            "Kullanıcı oluşturuldu ancak davet e-postası gönderilemedi.",
            cancellationToken);

        return WithWarning(result, warning);
    }

    public async Task<ServiceResult<AdminUserDetail>> ResendInvitationAsync(
        int userId,
        CancellationToken cancellationToken = default)
    {
        await using (var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken))
        {
            await AcquireRoleMutationLockAsync(cancellationToken);

            var user = await _userManager.Users.SingleOrDefaultAsync(
                candidate => candidate.Id == userId,
                cancellationToken);

            if (!await IsValidInvitationAccountAsync(user, cancellationToken))
            {
                return ServiceResult<AdminUserDetail>.Conflict(
                    "Yalnızca geçerli ve davet bekleyen hesaplara yeniden davet gönderilebilir.");
            }

            // Supported Identity API hem yeni security stamp üretir hem de
            // persist eder. Başarısızsa yeni token üretilmez.
            var stamp = await _userManager.UpdateSecurityStampAsync(user!);

            if (!stamp.Succeeded)
            {
                return Failed<AdminUserDetail>("Davet yenilenemedi.", stamp);
            }

            await transaction.CommitAsync(cancellationToken);
        }

        /* SMTP transaction dışında çalışır. Teslimat başarısız olsa bile yeni
           stamp korunur; böylece eski bağlantı tekrar geçerli hâle gelmez. */
        var result = await ReloadAsync(userId, cancellationToken);
        var warning = await TrySendInvitationAsync(
            userId,
            "resend",
            "Yeni davet oluşturuldu ancak davet e-postası gönderilemedi.",
            cancellationToken);

        return WithWarning(result, warning);
    }

    /// <summary>
    /// Onay ekranında sunulacak roller.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Kaynak artık sabit bir liste değil, Identity'de gerçekten var olan ve
    /// atanabilir sayılan rollerdir. İstemcinin gördüğü liste ile sunucunun
    /// kabul ettiği liste hâlâ aynı yerden — <see cref="IRoleManagementService"/>
    /// — türer, dolayısıyla ekranda görünüp reddedilen bir rol oluşamaz.
    /// Legacy <c>Admin</c>/<c>User</c> bu listede YER ALMAZ.
    /// </para>
    /// <para>
    /// Liste <b>çağırana özeldir</b>: aynı kuralla (hedef rolün aktif
    /// yetkileri ⊆ çağıranın etkin yetkileri) daraltılır, çünkü mutasyon da
    /// tam olarak bunu uygular. <paramref name="actingUserId"/> buraya
    /// doğrulanmış token'dan gelir; <see cref="ChangeRoleAsync"/> ve
    /// <see cref="ApproveAsync"/> ile aynı kimlik kaynağıdır.
    /// </para>
    /// </remarks>
    public Task<IReadOnlyList<AssignableRole>> GetAssignableRolesAsync(
        int actingUserId,
        CancellationToken cancellationToken = default) =>
        _roleManagement.GetAssignableRolesAsync(actingUserId, cancellationToken);

    /* --- Rol değişikliği ------------------------------------------------------ */

    public async Task<ServiceResult<AdminUserDetail>> ChangeRoleAsync(
        int userId,
        UpdateUserRoleRequest request,
        int actingUserId,
        CancellationToken cancellationToken = default)
    {
        /* Rol çözümü ÇAĞIRANIN kimliğiyle yapılır: yetki yükseltme kontrolü
           (hedef rolün yetkileri ⊆ çağıranın yetkileri) burada uygulanır ve
           hiçbir kayıt değiştirilmeden önce çalışır. actingUserId doğrulanmış
           token'dan gelir, istek gövdesinden DEĞİL. */
        var resolved = await _roleManagement.ResolveAssignableRoleAsync(request.Role, actingUserId, cancellationToken);

        if (!resolved.IsSuccess)
        {
            return Rejected(resolved);
        }

        var targetRole = resolved.Value!;

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

        if (AdministrativeRoleSemantics.HasAdministrativeRole(currentRoles)
            && !AdministrativeRoleSemantics.IsAdministrativeRole(targetRole))
        {
            var guard = await GuardLastActiveAdminAsync(
                userId,
                actingUserId,
                cancellationToken,
                excludeTarget: true);

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

        if (AdministrativeRoleSemantics.HasAdministrativeRole(currentRoles)
            || AdministrativeRoleSemantics.IsAdministrativeRole(targetRole))
        {
            var guard = await GuardLastActiveAdminAsync(userId, actingUserId, cancellationToken);
            if (guard is not null)
            {
                return guard;
            }
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

        var wasAdministrative = !request.IsActive
            && AdministrativeRoleSemantics.HasAdministrativeRole(await _userManager.GetRolesAsync(user));

        if (wasAdministrative)
        {
            var guard = await GuardLastActiveAdminAsync(
                userId,
                actingUserId,
                cancellationToken,
                excludeTarget: true);

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
        /* Rol çözümü ÇAĞIRANIN kimliğiyle yapılır: yetki yükseltme kontrolü
           (hedef rolün yetkileri ⊆ çağıranın yetkileri) burada uygulanır ve
           hiçbir kayıt değiştirilmeden önce çalışır. actingUserId doğrulanmış
           token'dan gelir, istek gövdesinden DEĞİL. */
        var resolved = await _roleManagement.ResolveAssignableRoleAsync(request.Role, actingUserId, cancellationToken);

        if (!resolved.IsSuccess)
        {
            return Rejected(resolved);
        }

        var targetRole = resolved.Value!;

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

    private async Task<string?> TrySendInvitationAsync(
        int userId,
        string kind,
        string warning,
        CancellationToken cancellationToken)
    {
        try
        {
            if (_accountService is null)
            {
                return warning;
            }

            var invitation = await _accountService.GenerateAccountInvitationAsync(userId, cancellationToken);

            if (!invitation.IsSuccess)
            {
                return warning;
            }

            var user = await ReloadAsync(userId, cancellationToken);
            if (!user.IsSuccess || string.IsNullOrWhiteSpace(user.Value!.Email))
            {
                return warning;
            }

            var actionUrl = QueryHelpers.AddQueryString(
                $"{_clientApp.BaseUrl.TrimEnd('/')}/activate-account",
                new Dictionary<string, string?>
                {
                    ["userId"] = invitation.Value!.UserId.ToString(),
                    ["token"] = invitation.Value.Token
                });

            await _emailSender.SendAsync(new EmailMessage
            {
                To = user.Value.Email,
                Subject = "StajProject hesabınız oluşturuldu",
                Body =
                    $"Merhaba {user.Value.Username},\n\n" +
                    "Sistem yöneticisi sizin için bir StajProject hesabı oluşturdu.\n\n" +
                    "Hesabınızı etkinleştirmek ve kendi şifrenizi belirlemek için aşağıdaki bağlantıyı kullanın.",
                ActionUrl = actionUrl
            }, cancellationToken);

            return null;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            // Token, URL, e-posta adresi ve SMTP ayrıntıları loglanmaz.
            _logger.LogError(
                "Davet e-postası gönderilemedi. UserId={UserId} Tür={Kind} HataTürü={ErrorType}",
                userId,
                kind,
                exception.GetType().Name);

            return warning;
        }
    }

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
        AdministratorSafety.AcquireMutationLockAsync(_dbContext, cancellationToken);

    private async Task<bool> IsValidInvitationAccountAsync(
        User? user,
        CancellationToken cancellationToken)
    {
        if (user is null
            || user.IsDeleted
            || user.IsActive
            || user.EmailConfirmed
            || user.PasswordHash is not null
            || user.AccountStatus != AccountStatus.InvitationPending)
        {
            return false;
        }

        var roles = await _userManager.GetRolesAsync(user);
        cancellationToken.ThrowIfCancellationRequested();
        return roles.Count == 1 && RoleCatalog.IsAssignable(roles[0]);
    }

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

        /* Roller artık dinamik olduğu için "kaldırılacaklar" sabit bir listeden
           süzülemez: kullanıcının SAHİP OLDUĞU tüm roller kaldırılır. Eski hâl
           yalnızca Admin/User'ı temizlerdi ve Viewer -> GIS Editor geçişinde
           kullanıcı iki rolde birden kalarak tek primary role kuralını
           sessizce bozardı. Hedef rol zaten aşağıda yeniden eklenir. */
        var rolesToRemove = currentRoles.Where(r => !string.Equals(r, targetRole, StringComparison.Ordinal)).ToArray();

        if (rolesToRemove.Length > 0)
        {
            var removal = await _userManager.RemoveFromRolesAsync(user, rolesToRemove);
            if (!removal.Succeeded)
            {
                return Failed<AdminUserDetail>("Rol kaldırılamadı.", removal);
            }
        }

        // Hedef rol zaten duruyorsa yeniden eklemek Identity hatası üretirdi.
        if (currentRoles.Contains(targetRole, StringComparer.Ordinal))
        {
            return null;
        }

        var assignment = await _userManager.AddToRoleAsync(user, targetRole);

        return assignment.Succeeded
            ? null
            : Failed<AdminUserDetail>("Rol atanamadı.", assignment);
    }

    /// <summary>
    /// Hedef kullanıcı dışında en az bir aktif Admin kalmıyorsa 409 döner.
    /// Kural hem başkası hem de kişinin kendisi için aynıdır: sistemin son
    /// Admin'i hiçbir koşulda kendini kilitleyemez.
    /// </summary>
    private async Task<ServiceResult<AdminUserDetail>?> GuardLastActiveAdminAsync(
        int targetUserId,
        int actingUserId,
        CancellationToken cancellationToken,
        bool excludeTarget = false)
    {
        if (await AdministratorSafety.HasUsableAdministratorAsync(
                _dbContext,
                _effectivePermissions,
                cancellationToken,
                excludeTarget ? targetUserId : null))
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

    /// <summary>
    /// Rol çözümündeki reddi, hata TÜRÜNÜ koruyarak aktarır.
    /// </summary>
    /// <remarks>
    /// Tür korunmazsa yetki yükseltme reddi 400'e düşerdi; oysa istek
    /// geçerlidir ve rol vardır — eksik olan çağıranın yetkisidir, yani doğru
    /// karşılık 403'tür.
    /// </remarks>
    private static ServiceResult<AdminUserDetail> Rejected(ServiceResult<string> resolved) =>
        resolved.ErrorKind switch
        {
            ServiceErrorKind.Forbidden => ServiceResult<AdminUserDetail>.Forbidden(resolved.Error!),
            ServiceErrorKind.NotFound => ServiceResult<AdminUserDetail>.NotFound(resolved.Error!),
            ServiceErrorKind.Conflict => ServiceResult<AdminUserDetail>.Conflict(resolved.Error!),
            _ => ServiceResult<AdminUserDetail>.Failure(resolved.Error!)
        };

    private static ServiceResult<AdminUserDetail> CreationFailed(IdentityResult result)
    {
        if (result.Errors.Any(error => error.Code == nameof(IdentityErrorDescriber.DuplicateUserName)))
        {
            return ServiceResult<AdminUserDetail>.Conflict("Bu kullanıcı adı zaten kullanılıyor.");
        }

        if (result.Errors.Any(error => error.Code == nameof(IdentityErrorDescriber.DuplicateEmail)))
        {
            return ServiceResult<AdminUserDetail>.Conflict("Bu e-posta adresi zaten kullanılıyor.");
        }

        return Failed<AdminUserDetail>("Kullanıcı oluşturulamadı.", result);
    }

    private static ServiceResult<T> Failed<T>(string message, IdentityResult result) =>
        ServiceResult<T>.Failure($"{message} {string.Join(" ", result.Errors.Select(e => e.Description))}".Trim());
}
