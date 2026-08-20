using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// Kullanıcıya doğrudan verilen yetkilerin okunması ve güncellenmesi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Etkinlik burada YENİDEN HESAPLANMAZ.</b> "Bu yetki işliyor mu" sorusunun
/// tek sahibi <see cref="IEffectivePermissionService"/>'tir ve bu servis onu
/// olduğu gibi kullanır. İkinci bir etkinlik formülü yazmak, zamanla motordan
/// sapan ve ekranda "var" görünen ama gerçekte çalışmayan bir yetki tablosu
/// üretirdi — yetkilendirmede en tehlikeli hata sınıfı budur.
/// </para>
/// <para>
/// <b>Kaynak ile etki ayrı sorulardır.</b> Servis kaynağı (rolden mi, doğrudan
/// mı) atama satırlarından okur; etkiyi motordan alır. Bir satırın var olması
/// yetkinin işlediği anlamına gelmez: yetki pasifleştirilmiş ya da hedef hesap
/// askıya alınmış olabilir.
/// </para>
/// <para>
/// <b>Sorgu sayısı yetki sayısından bağımsızdır.</b> Katalog, rol kaynakları ve
/// doğrudan atamalar toplu okunur; yetki başına gidiş-dönüş yoktur. Çağıranın
/// otoritesi de işlem başına bir kez çözülür.
/// </para>
/// </remarks>
public class UserPermissionManagementService : IUserPermissionManagementService
{
    private readonly AppDbContext _dbContext;
    private readonly UserManager<User> _userManager;
    private readonly IEffectivePermissionService _effectivePermissions;
    private readonly ILogger<UserPermissionManagementService> _logger;

    public UserPermissionManagementService(
        AppDbContext dbContext,
        UserManager<User> userManager,
        IEffectivePermissionService effectivePermissions,
        ILogger<UserPermissionManagementService> logger)
    {
        _dbContext = dbContext;
        _userManager = userManager;
        _effectivePermissions = effectivePermissions;
        _logger = logger;
    }

    /* --- Okuma ------------------------------------------------------------------------ */

    public async Task<ServiceResult<UserPermissionsResponse>> GetUserPermissionsAsync(
        int actingUserId,
        int targetUserId,
        CancellationToken cancellationToken = default)
    {
        var target = await FindTargetAsync(targetUserId, cancellationToken);

        if (target is null)
        {
            return ServiceResult<UserPermissionsResponse>.NotFound("Kullanıcı bulunamadı.");
        }

        var authority = await LoadAuthorityAsync(actingUserId, cancellationToken);

        return ServiceResult<UserPermissionsResponse>.Success(
            await BuildAsync(target, authority, cancellationToken));
    }

    /* --- Güncelleme ------------------------------------------------------------------- */

    public async Task<ServiceResult<UserPermissionsResponse>> ReplaceUserPermissionsAsync(
        int actingUserId,
        int targetUserId,
        UpdateUserPermissionsRequest request,
        CancellationToken cancellationToken = default)
    {
        var target = await FindTargetAsync(targetUserId, cancellationToken);

        if (target is null)
        {
            return ServiceResult<UserPermissionsResponse>.NotFound("Kullanıcı bulunamadı.");
        }

        /* Çağıranın otoritesi işlem başına BİR kez çözülür ve hem doğrulamada
           hem yanıtta kullanılır. Yetki başına ya da aşama başına yeniden
           sormak, katalog büyüdükçe büyüyen bir maliyet olurdu. */
        var authority = await LoadAuthorityAsync(actingUserId, cancellationToken);

        // Aynı kodun birden çok kez gönderilmesi hata değildir; küme anlamı taşır.
        var requested = (request.PermissionCodes ?? [])
            .Select(code => (code ?? string.Empty).Trim())
            .Where(code => code.Length > 0)
            .ToHashSet(StringComparer.Ordinal);

        var catalog = await _dbContext.Permissions.AsNoTracking().ToListAsync(cancellationToken);
        var byCode = catalog.ToDictionary(p => p.Code, StringComparer.Ordinal);

        /* Tanınmayan veya pasif kodlar SESSİZCE YOK SAYILMAZ: yönetici bir
           yetkiyi işaretlediğini sanırken isteğin yarısının düşmesi, ekranı
           güvenilmez kılardı. Rol yetkisi ucuyla birebir aynı dil. */
        var unknown = requested.Where(code => !byCode.ContainsKey(code)).OrderBy(c => c, StringComparer.Ordinal).ToArray();

        if (unknown.Length > 0)
        {
            return ServiceResult<UserPermissionsResponse>.Failure(
                $"Tanınmayan yetki kodu: {string.Join(", ", unknown)}.");
        }

        var inactive = requested.Where(code => !byCode[code].IsActive).OrderBy(c => c, StringComparer.Ordinal).ToArray();

        if (inactive.Length > 0)
        {
            return ServiceResult<UserPermissionsResponse>.Failure(
                $"Kullanımdan kaldırılmış yetki atanamaz: {string.Join(", ", inactive)}.");
        }

        var inherited = await LoadInheritedAsync(targetUserId, cancellationToken);
        var existingDirect = await _dbContext.UserPermissions
            .Where(up => up.UserId == targetUserId)
            .ToListAsync(cancellationToken);

        var desired = requested.Select(code => byCode[code].Id).ToHashSet();
        var activeIds = catalog.Where(p => p.IsActive).Select(p => p.Id).ToHashSet();
        var existingIds = existingDirect.Select(up => up.PermissionId).ToHashSet();

        /* Fark hesabı.

           Pasif yetkilere ait mevcut satırlar KORUNUR — istek yalnızca aktif
           doğrudan kümeyi tanımlar. Aksi hâlde bir yetki pasifleştirildiğinde
           ilk kaydetmede kişiye özel kaydı kalıcı olarak silinir ve yetki geri
           açıldığında dönmezdi. */
        var toRemove = existingDirect
            .Where(up => activeIds.Contains(up.PermissionId) && !desired.Contains(up.PermissionId))
            .ToArray();

        var toAdd = desired.Where(id => !existingIds.Contains(id)).ToArray();

        /* --- Kalıtım çakışması ---------------------------------------------
           Rolünden zaten gelen bir yetki AYRICA doğrudan atanamaz. İkinci satır
           hiçbir erişim eklemez, ama rol değiştiğinde arkada kalarak yöneticinin
           beklemediği bir yetkiyi sessizce sürdürürdü.

           Kural yalnızca YENİ eklemelere bakar: tarihsel bir çakışma (önce
           doğrudan verilmiş, sonra rol de vermeye başlamış) zaten var olabilir
           ve olduğu gibi korunabilir ya da temizlenebilir. */
        var redundant = toAdd
            .Where(inherited.ContainsKey)
            .Select(id => catalog.Single(p => p.Id == id).Code)
            .OrderBy(c => c, StringComparer.Ordinal)
            .ToArray();

        if (redundant.Length > 0)
        {
            return ServiceResult<UserPermissionsResponse>.Failure(
                "Bu yetki kullanıcıya rol üzerinden zaten veriliyor: " +
                $"{string.Join(", ", redundant)}.");
        }

        /* --- Yetki yükseltme bariyeri --------------------------------------
           Rol yetkisi ucundaki kuralın aynısı: yeni eklenenler ⊆ çağıranın
           etkin yetkileri. Olmasaydı permissions.assign sahibi bir kuklaya
           istediği yetkiyi verip o hesap üzerinden sisteme erişebilirdi.

           Kural YALNIZCA eklemelere uygulanır. Kaldırma ayrıcalığı azaltır;
           "istenen küme ⊆ çağıran" denseydi, yönetici kendisinden güçlü bir
           kullanıcıdan yetki ÇIKARAMAZ hâle gelirdi.

           Kontrol yazmadan ÖNCE biter: yetkili ve yetkisiz eklemeleri karışık
           içeren bir istek "yetkili olan kadarını" yazmaz. */
        if (toAdd.Length > 0 || toRemove.Length > 0)
        {
            /* Kimliği çözülemeyen çağıran hiçbir şey yazamaz — ekleme de,
               kaldırma da. Kaldırma yükseltme değildir ama yıkıcıdır; "kim
               olduğunu bilmiyorum" bunun için yeterli bir yetki değildir. */
            if (authority is null)
            {
                _logger.LogWarning(
                    "Doğrudan yetki güncellemesi reddedildi: çağıran kimliği çözülemedi " +
                    "(ActingUserId={ActingUserId}), hedef UserId={TargetUserId}",
                    actingUserId,
                    targetUserId);

                return ServiceResult<UserPermissionsResponse>.Forbidden(
                    "Yetkileri düzenlemek için oturumunuz doğrulanamadı.");
            }

            var addedCodes = toAdd.Select(id => catalog.Single(p => p.Id == id).Code).ToArray();
            var missing = addedCodes.Where(code => !authority.Contains(code)).ToArray();

            if (missing.Length > 0)
            {
                _logger.LogWarning(
                    "Doğrudan yetki yükseltme girişimi reddedildi: ActingUserId={ActingUserId} " +
                    "hedef UserId={TargetUserId} eksik yetki sayısı={Missing}",
                    actingUserId,
                    targetUserId,
                    missing.Length);

                /* Hangi yetkilerin eksik olduğu YAZILMAZ: mesaj, çağıranın kendi
                   yetki kümesini uç üzerinden haritalamasına yarayan bir kâşif
                   aracına dönüşmemelidir. Rol atama ve rol yetkisi reddi de aynı
                   dili kullanır. */
                return ServiceResult<UserPermissionsResponse>.Forbidden(
                    "Bu kullanıcıya seçilen yetkiyi atamak için gerekli yetkiye sahip değilsiniz.");
            }
        }

        if (toRemove.Length > 0 || toAdd.Length > 0)
        {
            await using var transaction = _dbContext.Database.IsRelational()
                ? await _dbContext.Database.BeginTransactionAsync(cancellationToken)
                : null;

            await AdministratorSafety.AcquireMutationLockAsync(_dbContext, cancellationToken);

            var directToAdd = toAdd
                .Select(id => new UserPermission { UserId = targetUserId, PermissionId = id })
                .ToArray();

            _dbContext.UserPermissions.RemoveRange(toRemove);
            _dbContext.UserPermissions.AddRange(directToAdd);

            /* Tek SaveChanges tek transaction'dır: silme ve ekleme aynı komut
               kümesinde gider. Ayrıca açık bir transaction sarmalamak burada
               hiçbir şey eklemezdi. */
            await _dbContext.SaveChangesAsync(cancellationToken);

            var targetRoles = await LoadRoleNamesAsync(targetUserId, cancellationToken);
            var removesCriticalAdministrativePermission =
                AdministrativeRoleSemantics.HasAdministrativeRole(targetRoles)
                && toRemove.Any(grant => AdministrativeRoleSemantics.CriticalPermissionCodes.Contains(
                    catalog.Single(permission => permission.Id == grant.PermissionId).Code));

            if (removesCriticalAdministrativePermission
                && !await AdministratorSafety.HasUsableAdministratorAsync(
                    _dbContext,
                    _effectivePermissions,
                    cancellationToken))
            {
                if (!_dbContext.Database.IsRelational())
                {
                    _dbContext.UserPermissions.RemoveRange(directToAdd);
                    _dbContext.UserPermissions.AddRange(toRemove);
                    await _dbContext.SaveChangesAsync(cancellationToken);
                }

                return ServiceResult<UserPermissionsResponse>.Conflict(
                    "Bu yetki değişikliği sistemde kullanılabilir yönetici bırakmayacaktır.");
            }

            if (transaction is not null)
            {
                await transaction.CommitAsync(cancellationToken);
            }

            _logger.LogInformation(
                "Doğrudan yetkiler güncellendi: UserId={TargetUserId} Eklenen={Added} Kaldırılan={Removed} " +
                "ActingUserId={ActingUserId}",
                targetUserId,
                toAdd.Length,
                toRemove.Length,
                actingUserId);
        }

        /* Çağıran KENDİ yetkilerini düzenlediyse otorite artık bayat olabilir:
           kendi doğrudan yetkisini kaldırmış olabilir. Yanıt mutasyondan SONRAKİ
           durumu anlatmak zorunda olduğu için bu dar durumda bir kez daha
           çözülür; başkası düzenlendiğinde çağıranın yetkileri değişemez. */
        var responseAuthority = actingUserId == targetUserId && (toAdd.Length > 0 || toRemove.Length > 0)
            ? await LoadAuthorityAsync(actingUserId, cancellationToken)
            : authority;

        return ServiceResult<UserPermissionsResponse>.Success(
            await BuildAsync(target, responseAuthority, cancellationToken));
    }

    /* --- Yanıt kurulumu --------------------------------------------------------------- */

    private async Task<UserPermissionsResponse> BuildAsync(
        User target,
        HashSet<string>? authority,
        CancellationToken cancellationToken)
    {
        var catalog = await _dbContext.Permissions
            .AsNoTracking()
            .OrderBy(p => p.Category)
            .ThenBy(p => p.SortOrder)
            .ThenBy(p => p.Code)
            .ToListAsync(cancellationToken);

        var inherited = await LoadInheritedAsync(target.Id, cancellationToken);

        var direct = await _dbContext.UserPermissions
            .AsNoTracking()
            .Where(up => up.UserId == target.Id)
            .Select(up => up.PermissionId)
            .ToListAsync(cancellationToken);

        var directIds = direct.ToHashSet();

        /* Etkinlik motordan okunur, burada türetilmez — tek gerçek kaynak.
           Hesap uygunluğu ve pasif yetki elemesi zaten o sorgunun içindedir. */
        var effective = (await _effectivePermissions.GetEffectivePermissionCodesAsync(target.Id, cancellationToken))
            .ToHashSet(StringComparer.Ordinal);

        var roles = await LoadRoleNamesAsync(target.Id, cancellationToken);

        var canManage = authority is not null
            && authority.Contains(PermissionCodes.UsersUpdate)
            && authority.Contains(PermissionCodes.PermissionsAssign);

        return new UserPermissionsResponse
        {
            UserId = target.Id,
            UserName = target.UserName ?? string.Empty,
            Roles = roles,
            CanManageDirectPermissions = canManage,

            /* Görüntüleme amaçlı bir bayrak: yetkilendirme kararı VERMEZ.
               Etkinliğin tek kaynağı yukarıdaki motor sonucudur; bu alan yalnızca
               "atamalar duruyor ama hiçbiri işlemiyor" durumunu arayüzün
               açıklayabilmesi içindir. Aynı yüklem motordaki uygunluk kapısıyla
               eşleşir. */
            TargetAccountEligible = !target.IsDeleted
                && target.IsActive
                && target.AccountStatus == AccountStatus.Active,

            Permissions = catalog.Select(permission =>
            {
                var sources = inherited.TryGetValue(permission.Id, out var names) ? names : [];
                var isDirect = directIds.Contains(permission.Id);

                return new UserPermissionItem
                {
                    Id = permission.Id,
                    Code = permission.Code,
                    Name = permission.Name,
                    Description = permission.Description,
                    Category = permission.Category,
                    IsActive = permission.IsActive,
                    SortOrder = permission.SortOrder,

                    InheritedFromRoles = sources,
                    DirectAssigned = isDirect,
                    Effective = effective.Contains(permission.Code),

                    /* Doğrudan atanabilirlik dört koşulun birleşimidir; hepsi
                       sunucuda kalır ki istemci rol adına bakan bir kural
                       uydurmak zorunda kalmasın. */
                    CanAssignDirect = canManage
                        && permission.IsActive
                        && sources.Count == 0
                        && !isDirect
                        && authority!.Contains(permission.Code),

                    /* Kaldırma ayrıcalığı AZALTIR: çağıranın o yetkiyi taşıması
                       ŞART DEĞİLDİR. Pasif yetkiye ait tarihsel satır ise aktif
                       küme sözleşmesinin dışındadır ve buradan silinemez. */
                    CanRemoveDirect = canManage && isDirect && permission.IsActive
                };
            }).ToList()
        };
    }

    /* --- Yardımcılar ------------------------------------------------------------------ */

    /// <summary>
    /// Silinmiş kullanıcı YOK sayılır: yönetim uçlarının tamamı aynı yüklemi
    /// kullanır, böylece soft delete edilmiş bir hesap hiçbir ekranda sıradan
    /// bir hesap gibi görünmez.
    /// </summary>
    private Task<User?> FindTargetAsync(int targetUserId, CancellationToken cancellationToken) =>
        _userManager.Users
            .AsNoTracking()
            .SingleOrDefaultAsync(u => u.Id == targetUserId && !u.IsDeleted, cancellationToken);

    /// <summary>
    /// Hedefin rollerinden gelen yetkiler: <c>PermissionId → kaynak rol adları</c>.
    /// </summary>
    /// <remarks>
    /// Tek sorgu; rol başına gidiş yoktur. Sonuç bir LİSTE'dir çünkü aynı yetki
    /// birden çok rolden gelebilir — tek bir kaynağa indirgemek, kaynağı kesmek
    /// isteyen yöneticiye eksik bilgi vermek olurdu.
    /// </remarks>
    private async Task<Dictionary<int, IReadOnlyList<string>>> LoadInheritedAsync(
        int targetUserId,
        CancellationToken cancellationToken)
    {
        var rows = await (
            from userRole in _dbContext.UserRoles.AsNoTracking()
            where userRole.UserId == targetUserId
            join role in _dbContext.Roles.AsNoTracking() on userRole.RoleId equals role.Id
            join rolePermission in _dbContext.RolePermissions.AsNoTracking()
                on role.Id equals rolePermission.RoleId
            select new { rolePermission.PermissionId, RoleName = role.Name! })
            .ToListAsync(cancellationToken);

        return rows
            .GroupBy(r => r.PermissionId)
            .ToDictionary(
                g => g.Key,
                IReadOnlyList<string> (g) =>
                    [.. g.Select(x => x.RoleName).Distinct(StringComparer.Ordinal).OrderBy(n => n, StringComparer.Ordinal)]);
    }

    private async Task<IReadOnlyList<string>> LoadRoleNamesAsync(
        int targetUserId,
        CancellationToken cancellationToken)
    {
        var names = await (
            from userRole in _dbContext.UserRoles.AsNoTracking()
            where userRole.UserId == targetUserId
            join role in _dbContext.Roles.AsNoTracking() on userRole.RoleId equals role.Id
            select role.Name!)
            .ToListAsync(cancellationToken);

        return [.. names.Distinct(StringComparer.Ordinal).OrderBy(n => n, StringComparer.Ordinal)];
    }

    /// <summary>
    /// Çağıranın dağıtma otoritesi: etkin yetki kodları, ya da kimlik
    /// çözülemiyorsa <c>null</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Otorite daima CANLI veritabanından okunur. Token'daki bir anlık görüntü
    /// kullanılsaydı, yetkiler değiştikten sonra ekran ile mutasyon farklı
    /// cevaplar verirdi.
    /// </para>
    /// <para>
    /// <b>Semantik, rol yetkisi ucundaki bariyerle aynıdır</b>
    /// (<c>RoleManagementService.LoadGrantAuthorityAsync</c>): kaynak
    /// <see cref="IEffectivePermissionService"/> (rol ∪ doğrudan, hesap uygunluğu
    /// dâhil), kimlik çözülemezse fail-closed. O helper <c>private</c> olduğu
    /// için burada tekrar çözülür; ortak bir soyutlama uğruna iki servisi
    /// birbirine bağlamak, kazandırdığından fazlasını maliyet olarak yazardı.
    /// Kopyalanan bir <b>kural</b> yoktur — yalnızca aynı motora yapılan ikinci
    /// bir çağrı. Rol adına bakan hiçbir mantık iki tarafta da bulunmaz.
    /// </para>
    /// </remarks>
    private async Task<HashSet<string>?> LoadAuthorityAsync(int actingUserId, CancellationToken cancellationToken)
    {
        if (actingUserId <= 0)
        {
            _logger.LogWarning(
                "Doğrudan yetki otoritesi çözülemedi: geçersiz çağıran kimliği ({ActingUserId}).",
                actingUserId);

            return null;
        }

        return (await _effectivePermissions.GetEffectivePermissionCodesAsync(actingUserId, cancellationToken))
            .ToHashSet(StringComparer.Ordinal);
    }
}
