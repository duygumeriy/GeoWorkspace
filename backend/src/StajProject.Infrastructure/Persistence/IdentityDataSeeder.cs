using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;

namespace StajProject.Infrastructure.Persistence;

/// <summary>
/// Startup provisioning: ilk yönetici hesabını ve rolsüz hesapları
/// kanonik rollere taşır.
/// </summary>
/// <remarks>
/// <para>
/// <b>Kapsam: yalnızca bootstrap / first-run.</b> Sistemde gerçek bir
/// rol yönetimi (AUTH-3) bulunduğu için seeder, uygulama normal
/// çalışmaya başladıktan sonra alınan yönetim kararlarının üzerine yazmaz.
/// Bir yöneticinin bilinçli olarak yaptığı rol değişikliği restart sonrasında
/// geri alınmaz.
/// </para>
/// <para>
/// Ayrım şudur:
/// <list type="bullet">
/// <item><b>First-run provisioning</b> — hesap <i>bu çalıştırmada</i> oluşturulduysa
/// Administrator rolü atanır.</item>
/// <item><b>Operator kararı</b> — hesap zaten varsa rolüne, şifresine,
/// e-postasına, aktiflik durumuna ve security stamp'ine DOKUNULMAZ.</item>
/// </list>
/// </para>
/// </remarks>
public static class IdentityDataSeeder
{
    /// <summary>
    /// Startup identity seed akışı. Kanonik rollerin önceden
    /// <see cref="AuthorizationDataSeeder"/> tarafından oluşturulmuş olması gerekir.
    /// </summary>
    public static async Task SeedAsync(
        UserManager<User> userManager,
        IEffectivePermissionService effectivePermissions,
        AdminSeedOptions options,
        ILogger logger,
        CancellationToken cancellationToken = default)
    {
        var bootstrapped = await EnsureBootstrapAdminAccountAsync(userManager, options, logger, cancellationToken);

        if (bootstrapped)
        {
            // FIRST-RUN PROVISIONING: hesap bu çalıştırmada oluşturuldu, dolayısıyla
            // henüz hiçbir operator kararı yok. İlk yöneticiyi burada atarız.
            await PromoteToAdministratorAsync(userManager, options.Username, logger, "first-run provisioning");
        }

        await RecoverWhenNoActiveAdminAsync(
            userManager,
            effectivePermissions,
            options,
            logger,
            cancellationToken);

        await AssignDefaultRoleToRolelessUsersAsync(userManager, logger, cancellationToken);
    }

    /* --- Bootstrap hesabı ----------------------------------------------------- */

    /// <summary>
    /// Konfigürasyondaki yönetici hesabı yoksa oluşturur.
    /// </summary>
    /// <returns>
    /// Hesap <b>bu çalıştırmada oluşturulduysa</b> <c>true</c>. Yalnızca bu
    /// durumda rol ataması yapılır; mevcut hesaplara dokunulmaz.
    /// </returns>
    private static async Task<bool> EnsureBootstrapAdminAccountAsync(
        UserManager<User> userManager,
        AdminSeedOptions options,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        if (string.IsNullOrWhiteSpace(options.Username))
        {
            logger.LogWarning("AdminSeed:Username tanımlı değil; yönetici hesabı seed edilmedi.");
            return false;
        }

        var existing = await userManager.FindByNameAsync(options.Username);

        if (existing is not null)
        {
            /* Hesap zaten var. HİÇBİR alanına dokunulmaz:
               - PasswordHash: startup'ta ezmek, şifresi değiştirilmiş bir hesabı
                 sessizce geri almak demek olurdu.
               - Rol: operator hesabı bilinçli olarak User'a düşürmüş olabilir;
                 bunu geri almak yönetim kararını ezmek olur (AUTH-3.1).
               - E-posta / EmailConfirmed / IsActive / SecurityStamp: aynı gerekçe. */
            logger.LogInformation(
                "Bootstrap yönetici hesabı zaten mevcut; hiçbir alanına (şifre, rol, e-posta, durum) dokunulmadı.");
            return false;
        }

        // Buradan sonrası yalnızca "hesap yok" durumu. Şifre secret'ı eksikse
        // fail-closed davranılır: hesap oluşturulmaz ve ASLA varsayılan/
        // hardcoded bir şifre üretilmez.
        if (string.IsNullOrEmpty(options.Password))
        {
            logger.LogError(
                "'{Username}' yönetici hesabı veritabanında yok ve AdminSeed:Password tanımlı değil; " +
                "hesap OLUŞTURULMADI (varsayılan şifre üretilmez). Şu komutu çalıştırın: " +
                "dotnet user-secrets set \"AdminSeed:Password\" \"<şifre>\" --project src/StajProject.Api " +
                "— veya AdminSeed__Password ortam değişkenini tanımlayıp uygulamayı yeniden başlatın.",
                options.Username);
            return false;
        }

        var user = new User
        {
            UserName = options.Username,
            Email = string.IsNullOrWhiteSpace(options.Email)
                ? $"{options.Username}@stajproject.local"
                : options.Email,
            // Bootstrap hesabı e-posta doğrulama akışından geçemez (gidecek bir
            // gelen kutusu yoktur), bu yüzden doğrulanmış kabul edilir.
            EmailConfirmed = true,
            /* Aynı gerekçe onay akışı için de geçerlidir ve klasik kilitlenmeyi
               önler: herkes yönetici onayı beklerken onaylayacak yönetici
               bulunmaması. İlk yönetici onay sırasına girmez, doğrudan Active
               provision edilir. ApprovedAt/ApprovedByUserId null bırakılır —
               bu hesap onaylanmadı, sağlandı. */
            AccountStatus = AccountStatus.Active,
            IsActive = true,
            IsDeleted = false
        };

        // Şifre hash'i Identity'nin PasswordHasher'ı ile üretilir; bu projede
        // hiçbir yerde elle SHA/MD5 hesaplanmaz.
        //
        // CreateAsync(user, password) yerine hash'in doğrudan atanmasının nedeni:
        // devralınan mevcut yönetici şifresi yeni password policy'yi
        // karşılamayabilir ve validator seed'i reddederdi. Policy, buradan
        // sonraki tüm şifre değiştirme/oluşturma işlemlerinde geçerlidir.
        user.PasswordHash = userManager.PasswordHasher.HashPassword(user, options.Password);

        var result = await userManager.CreateAsync(user);

        if (!result.Succeeded)
        {
            var errors = string.Join("; ", result.Errors.Select(e => $"{e.Code}: {e.Description}"));
            logger.LogError("Yönetici hesabı seed edilemedi. {Errors}", errors);
            return false;
        }

        if (!IsPolicyCompliant(userManager.Options.Password, options.Password))
        {
            logger.LogWarning(
                "Seed edilen yönetici şifresi mevcut password policy'yi karşılamıyor. " +
                "Eski giriş bilgisinin çalışmaya devam etmesi için kabul edildi; " +
                "şifrenin değiştirilmesi önerilir.");
        }

        logger.LogInformation("Bootstrap yönetici hesabı oluşturuldu. UserId={UserId}", user.Id);
        return true;
    }

    /* --- Zero-admin recovery --------------------------------------------------- */

    /// <summary>
    /// Sistemde hiç kullanılabilir yönetici kalmadıysa devreye giren kurtarma yolu.
    /// </summary>
    /// <remarks>
    /// Normal çalışmada bu durum oluşamaz: API'deki son kullanılabilir yönetici koruması
    /// (409) sonuncunun düşürülmesini zaten engeller. Dolayısıyla buraya
    /// düşülmesi ya doğrudan veritabanı müdahalesi ya da AUTH-3 öncesinden
    /// devralınan bir şema anlamına gelir — yani istisnai bir durumdur ve
    /// sessizce "self-heal" edilmez, yüksek seviyede loglanır.
    /// <para>
    /// Koşul kasıtlı olarak dardır: "bootstrap hesabı yönetici değil" değil,
    /// <b>"hiç kullanılabilir yönetici yok"</b>. Bu sayede bilinçli bir rol
    /// değişikliği (başka bir yönetici varken bootstrap hesabını düşürmek)
    /// asla geri alınmaz.
    /// </para>
    /// </remarks>
    private static async Task RecoverWhenNoActiveAdminAsync(
        UserManager<User> userManager,
        IEffectivePermissionService effectivePermissions,
        AdminSeedOptions options,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var administrativeUsers = new Dictionary<int, User>();

        foreach (var roleName in AdministrativeRoleSemantics.RoleNames)
        {
            foreach (var user in await userManager.GetUsersInRoleAsync(roleName))
            {
                administrativeUsers[user.Id] = user;
            }
        }

        foreach (var user in administrativeUsers.Values.Where(user =>
                     !user.IsDeleted
                     && user.IsActive
                     && user.AccountStatus == AccountStatus.Active))
        {
            var codes = await effectivePermissions.GetEffectivePermissionCodesAsync(user.Id, cancellationToken);

            if (AdministrativeRoleSemantics.HasCriticalPermissions(codes))
            {
                return;
            }
        }

        if (!options.EnableZeroAdminRecovery)
        {
            logger.LogError(
                "Sistemde kullanılabilir yönetici YOK ve AdminSeed:EnableZeroAdminRecovery kapalı olduğu için " +
                "otomatik kurtarma yapılmadı. Yönetim uçlarına erişilemez. Bir hesaba veritabanı " +
                "üzerinden Administrator rolü verin veya bu ayarı açıp uygulamayı yeniden başlatın.");
            return;
        }

        if (string.IsNullOrWhiteSpace(options.Username))
        {
            logger.LogError(
                "Sistemde kullanılabilir yönetici YOK ve kurtarma için AdminSeed:Username tanımlı değil; " +
                "kurtarma yapılamadı.");
            return;
        }

        var target = await userManager.FindByNameAsync(options.Username);

        if (target is null || target.IsDeleted)
        {
            logger.LogError(
                "Sistemde kullanılabilir yönetici YOK ve kurtarma hedefi '{Username}' bulunamadı; " +
                "kurtarma yapılamadı.",
                options.Username);
            return;
        }

        logger.LogWarning(
            "KURTARMA: sistemde kullanılabilir yönetici bulunmuyor. Bootstrap hesabı '{Username}' " +
            "Administrator rolüne yükseltiliyor. Bu rutin bir işlem DEĞİLDİR — normal çalışmada " +
            "son kullanılabilir yöneticinin " +
            "düşürülmesi API tarafından engellenir; bu durum genellikle doğrudan veritabanı " +
            "müdahalesine işaret eder.",
            options.Username);

        // Kurtarmanın işe yaraması için hesabın aktif olması gerekir; pasifse
        // bu YALNIZCA kurtarma yolunda ve açıkça loglanarak geri açılır.
        // Onay durumu da birlikte yükseltilir: is_active tek başına true
        // olsaydı login kapısı hesabı yine reddeder, kurtarma işe yaramazdı.
        if (!target.IsActive || target.AccountStatus != AccountStatus.Active)
        {
            target.IsActive = true;
            target.AccountStatus = AccountStatus.Active;
            await userManager.UpdateAsync(target);
            logger.LogWarning(
                "KURTARMA: '{Username}' giriş yapabilir durumda değildi, erişim sağlanabilmesi için aktifleştirildi.",
                options.Username);
        }

        await PromoteToAdministratorAsync(userManager, options.Username, logger, "zero-admin recovery");
    }

    /* --- Rolsüz hesaplar ------------------------------------------------------- */

    /// <summary>
    /// Hiçbir application role'ü olmayan hesapları <see cref="GisRoles.GisEditor"/>
    /// rolüne taşır (AUTH-3 öncesinden devralınan kayıtlar için).
    /// </summary>
    /// <remarks>
    /// <para>
    /// Körlemesine toplu güncelleme yapılmaz: zaten bir application role'ü olan
    /// hesaplara dokunulmaz ve silinmiş kayıtlar kapsam dışıdır. Bu sayede
    /// bilinçli olarak rol verilmiş bir hesabın GIS Editor'a düşürülmesi imkânsızdır.
    /// </para>
    /// <para>
    /// Kapsam yalnızca <see cref="AccountStatus.Active"/> hesaplardır. Onay
    /// akışında rol, onay anında atanır; henüz onaylanmamış bir hesaba burada
    /// rol vermek, yöneticinin kararını startup'ta önceden almak olurdu.
    /// </para>
    /// </remarks>
    private static async Task AssignDefaultRoleToRolelessUsersAsync(
        UserManager<User> userManager,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        var candidates = await userManager.Users
            .Where(u => !u.IsDeleted && u.AccountStatus == AccountStatus.Active)
            .ToListAsync(cancellationToken);

        foreach (var user in candidates)
        {
            var roles = await userManager.GetRolesAsync(user);

            /* "Rolsüz" demek "bilinen kanonik/legacy rollerde değil" demek DEĞİLDİR: roller
               dinamikleştiği için Viewer veya özel bir role sahip hesaplar da
               rolsüz sanılır ve startup'ta sessizce GIS Editor rolüne taşınırdı. */
            if (roles.Count > 0)
            {
                continue;
            }

            var result = await userManager.AddToRoleAsync(user, GisRoles.GisEditor);

            if (result.Succeeded)
            {
                logger.LogInformation("Rolsüz hesap GIS Editor rolüne taşındı. UserId={UserId}", user.Id);
            }
            else
            {
                logger.LogError(
                    "Rolsüz hesaba GIS Editor rolü atanamadı. UserId={UserId} {Errors}",
                    user.Id,
                    string.Join("; ", result.Errors.Select(e => e.Description)));
            }
        }
    }

    /* --- Yardımcılar ----------------------------------------------------------- */

    /// <summary>
    /// Hesabı Administrator rolüne alır. Tek primary role kuralı gereği diğer
    /// application role'leri önce kaldırılır.
    /// </summary>
    private static async Task PromoteToAdministratorAsync(
        UserManager<User> userManager,
        string username,
        ILogger logger,
        string reason)
    {
        var user = await userManager.FindByNameAsync(username);

        if (user is null)
        {
            logger.LogError("Administrator rolü atanamadı: '{Username}' bulunamadı ({Reason}).", username, reason);
            return;
        }

        if (await userManager.IsInRoleAsync(user, GisRoles.Administrator))
        {
            return;
        }

        // Aynı gerekçe: kullanıcının sahip olduğu TÜM roller kaldırılır.
        var toRemove = (await userManager.GetRolesAsync(user))
            .Where(r => !string.Equals(r, GisRoles.Administrator, StringComparison.Ordinal))
            .ToArray();

        if (toRemove.Length > 0)
        {
            await userManager.RemoveFromRolesAsync(user, toRemove);
        }

        var result = await userManager.AddToRoleAsync(user, GisRoles.Administrator);

        if (result.Succeeded)
        {
            logger.LogInformation(
                "Administrator rolü atandı. UserId={UserId} Sebep={Reason}", user.Id, reason);
        }
        else
        {
            logger.LogError(
                "Administrator rolü atanamadı. UserId={UserId} Sebep={Reason} {Errors}",
                user.Id,
                reason,
                string.Join("; ", result.Errors.Select(e => e.Description)));
        }
    }

    private static bool IsPolicyCompliant(PasswordOptions policy, string password) =>
        password.Length >= policy.RequiredLength
        && (!policy.RequireDigit || password.Any(char.IsDigit))
        && (!policy.RequireLowercase || password.Any(char.IsLower))
        && (!policy.RequireUppercase || password.Any(char.IsUpper))
        && (!policy.RequireNonAlphanumeric || password.Any(c => !char.IsLetterOrDigit(c)));
}
