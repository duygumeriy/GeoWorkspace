using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// <see cref="IAuthService"/> implementasyonu. Sözleşme Application katmanında,
/// gerçekleştirim — diğer servislerde olduğu gibi — Infrastructure katmanındadır.
/// Şifre doğrulaması ASP.NET Core Identity'ye (<see cref="UserManager{TUser}.CheckPasswordAsync"/>)
/// devredilmiştir; bu sınıf hiçbir yerde hash hesaplamaz veya karşılaştırmaz.
/// </summary>
public class AuthService : IAuthService
{
    private const string InvalidCredentialsMessage = "Kullanıcı adı veya şifre hatalı.";
    private const string LockedOutMessage =
        "Hesap geçici olarak kilitlendi. Lütfen bir süre sonra tekrar deneyin.";

    private readonly ITokenService _tokenService;
    private readonly UserManager<User> _userManager;
    private readonly ITwoFactorChallengeService _challenges;

    public AuthService(
        ITokenService tokenService,
        UserManager<User> userManager,
        ITwoFactorChallengeService challenges)
    {
        _tokenService = tokenService;
        _userManager = userManager;
        _challenges = challenges;
    }

    public async Task<LoginResult> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrEmpty(request.Password))
        {
            return LoginResult.Failure(InvalidCredentialsMessage);
        }

        var user = await _userManager.FindByNameAsync(request.Username);

        /* Kullanıcı yoksa da, silinmişse de, şifre yanlışsa da aynı mesaj
           döner: hangi kullanıcı adlarının var olduğu dışarı sızmasın.

           Hesap DURUMU (onay bekliyor / askıya alınmış / reddedilmiş) bu
           kontrole dahil DEĞİLDİR; aşağıda, şifre doğrulandıktan sonra
           değerlendirilir. Sebebi EmailConfirmed'deki gerekçenin aynısıdır:
           şifreyi bilmeyen biri bir hesabın var olduğunu ve hangi aşamada
           takıldığını öğrenememelidir. */
        if (user is null || user.IsDeleted)
        {
            return LoginResult.Failure(InvalidCredentialsMessage);
        }

        if (await _userManager.IsLockedOutAsync(user))
        {
            return LoginResult.LockedOut(LockedOutMessage);
        }

        /* SignInManager.CheckPasswordSignInAsync başarılı şifrede lockout
           sayacını hemen sıfırlar. Bu, MFA hesabında her yeni password isteği
           arasında TOTP deneme sayacını da sıfırlayıp brute-force korumasını
           aşılabilir yapardı. Şifreyi Identity ile doğrulamaya devam ediyoruz,
           fakat sayacı yalnız TAM authentication ceremony tamamlandığında
           sıfırlıyoruz: password-only hesapta aşağıda, MFA hesabında ise
           TwoFactorService başarılı ikinci faktörden sonra. */
        if (!await _userManager.CheckPasswordAsync(user, request.Password))
        {
            if (user.LockoutEnabled)
            {
                var failed = await _userManager.AccessFailedAsync(user);

                if (!failed.Succeeded)
                {
                    return LoginResult.Failure(InvalidCredentialsMessage);
                }

                if (await _userManager.IsLockedOutAsync(user))
                {
                    return LoginResult.LockedOut(LockedOutMessage);
                }
            }

            return LoginResult.Failure(InvalidCredentialsMessage);
        }

        /* E-posta doğrulaması kontrolü BİLEREK burada — şifre doğrulandıktan
           sonra — yapılır.
           Identity'nin options.SignIn.RequireConfirmedEmail ayarı bu kontrolü
           PreSignInCheck içinde, yani şifre hiç kontrol edilmeden yapar; o
           durumda saldırgan şifreyi bilmeden bir hesabın var olduğunu ve
           doğrulanmamış olduğunu öğrenebilirdi. Sıralamayı ters çevirerek
           bu bilgi yalnızca doğru şifreyi bilen kişiye açılır.

           Mevcut admin hesabı EmailConfirmed = true olduğu için bu kontrolden
           etkilenmez. */
        if (!user.EmailConfirmed)
        {
            await ResetFailedCountAsync(user);

            return LoginResult.EmailNotConfirmed(
                "E-posta adresinizi doğrulamanız gerekiyor. Doğrulama bağlantısını yeniden gönderebilirsiniz.");
        }

        /* --- Hesap onay kapısı ------------------------------------------------
           E-postanın doğrulanmış olması uygulamaya girmeye yetmez: araya
           yönetici incelemesi girer. Kapı BURADA — token üretiminden önce —
           durur; frontend'in route guard'ı bir kolaylıktır, güvenlik sınırı
           değildir.

           Sıra önemlidir: 2FA kararından da önce gelir, çünkü onaylanmamış bir
           hesaba challenge bileti vermek, ikinci faktörü tamamlayınca token
           alabileceği anlamına gelirdi. */
        var accountGate = CheckAccountStatus(user);

        if (accountGate is not null)
        {
            await ResetFailedCountAsync(user);
            return accountGate;
        }

        var roles = await _userManager.GetRolesAsync(user);

        /* --- AUTH-5: ikinci faktör kapısı -----------------------------------
           EN KRİTİK KURAL: buradan aşağıya access token üretmeden geçilir.
           İkinci faktör gereken bir hesapta "önce token ver, sonra 2FA sor"
           yaklaşımı 2FA değildir — üretilmiş token zaten tüm korumalı uçlarda
           geçerli olurdu ve ikinci adımı atlamak istemcinin insafına kalırdı.
           Bunun yerine yalnızca yetkisiz, kısa ömürlü bir bilet döner. */

        var securityStamp = await _userManager.GetSecurityStampAsync(user);

        if (user.TwoFactorEnabled)
        {
            return LoginResult.TwoFactorRequired(
                _challenges.Create(user.Id, securityStamp, TwoFactorChallengePurpose.Verify));
        }

        /* Administrator'da 2FA zorunludur. Hesap henüz kurulum yapmamışsa oturum
           AÇILMAZ; bunun yerine yalnızca kurulum yapmaya yarayan bir bilet
           verilir. Bu, rollout sonrasında yöneticinin "2FA zorunlu ama kurmak
           için giriş yapmam gerekiyor" çıkmazına düşmesini önleyen yoldur —
           ve aynı zamanda Administrator'a yükseltmenin doğal karşılığıdır. */
        if (AdministrativeRoleSemantics.HasAdministrativeRole(roles))
        {
            return LoginResult.TwoFactorSetupRequired(
                _challenges.Create(user.Id, securityStamp, TwoFactorChallengePurpose.Setup));
        }

        // Buraya yalnızca 2FA'sı kapalı, zorunluluğu da olmayan hesap düşer.
        if (!await ResetFailedCountAsync(user))
        {
            return LoginResult.Failure("Oturum açılamadı. Lütfen tekrar deneyin.");
        }

        var (token, expiresAt) = _tokenService.GenerateToken(
            user.Id,
            user.UserName!,
            roles,
            AuthenticationLevel.Password);

        return LoginResult.Success(new LoginResponse
        {
            Token = token,
            ExpiresAt = expiresAt
        });
    }

    /// <summary>
    /// Hesap durumunun oturum açmaya izin verip vermediğini söyler. İzin
    /// veriyorsa <c>null</c>, aksi hâlde dönecek sonucu üretir.
    /// </summary>
    /// <remarks>
    /// Yalnızca <see cref="AccountStatus.Active"/> <b>ve</b> <c>IsActive</c>
    /// birlikte geçer. İkisinin ayrışması normal akışta imkânsızdır (durum
    /// değişiklikleri ikisini birlikte yazar); yine de burada "ikisi de doğru
    /// olmalı" denerek olası bir tutarsızlık erişime değil, engellemeye
    /// dönüşür.
    /// </remarks>
    private static LoginResult? CheckAccountStatus(User user) => user.AccountStatus switch
    {
        AccountStatus.Active when user.IsActive => null,

        AccountStatus.PendingApproval => LoginResult.Blocked(
            LoginBlockReason.PendingApproval,
            "Hesabınız yönetici onayı bekliyor. Onaylandıktan sonra uygulamaya giriş yapabilirsiniz."),

        AccountStatus.Rejected => LoginResult.Blocked(
            LoginBlockReason.Rejected,
            "Hesap başvurunuz onaylanmadı. Ayrıntı için yöneticinizle iletişime geçin."),

        /* PendingEmailVerification buraya normalde düşmez (üstteki
           EmailConfirmed kontrolü onu önce yakalar); yalnızca doğrulanmış ama
           durumu geride kalmış devralınmış bir kayıtta mümkündür. Böyle bir
           satırın hangi kovaya düştüğünden bağımsız olarak sonuç aynıdır:
           erişim yok. */
        _ => LoginResult.Blocked(
            LoginBlockReason.Suspended,
            "Hesabınız devre dışı bırakılmış. Lütfen yöneticinizle iletişime geçin.")
    };

    private async Task<bool> ResetFailedCountAsync(User user)
    {
        if (!user.LockoutEnabled || user.AccessFailedCount == 0)
        {
            return true;
        }

        return (await _userManager.ResetAccessFailedCountAsync(user)).Succeeded;
    }

    public async Task<CurrentUserResponse?> GetCurrentUserAsync(int userId, CancellationToken cancellationToken = default)
    {
        var user = await _userManager.Users
            .AsNoTracking()
            .SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);

        // Oturum sırasında askıya alınan/onayı geri çekilen hesabın profili de
        // artık çözülmez; istemci ilk /me çağrısında oturumunu kaybeder.
        if (user is null || user.IsDeleted || !user.IsActive || user.AccountStatus != AccountStatus.Active)
        {
            return null;
        }

        var roles = await _userManager.GetRolesAsync(user);

        return new CurrentUserResponse
        {
            UserId = user.Id,
            Username = user.UserName ?? string.Empty,
            Email = user.Email,
            EmailConfirmed = user.EmailConfirmed,
            TwoFactorEnabled = user.TwoFactorEnabled,
            // Rol daima veritabanından okunur — istekten değil, token'dan bile değil.
            /* Sabit listeye göre süzmek, dinamik rollerde (Viewer, özel roller)
               rolü null gösterirdi. Kullanıcının gerçek rolü döner; legacy
               roller de eskisi gibi tanınmaya devam eder. */
            Role = roles.FirstOrDefault(),
            Roles = roles.ToArray()
        };
    }
}
