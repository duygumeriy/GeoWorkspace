using System.Text;
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
/// <see cref="IAccountService"/> implementasyonu.
/// </summary>
/// <remarks>
/// Kurallar:
/// <list type="bullet">
/// <item>Şifre doğrulama/hash'leme daima <see cref="UserManager{TUser}"/> üzerinden;
/// bu sınıf hiçbir yerde hash hesaplamaz veya karşılaştırmaz.</item>
/// <item>E-posta doğrulama ve şifre sıfırlama token'ları Identity token
/// provider'larından gelir; custom token üretilmez.</item>
/// <item>Token, hash, security stamp ve şifre hiçbir koşulda loglanmaz.</item>
/// </list>
/// </remarks>
public class AccountService : IAccountService
{
    /// <summary>
    /// Davet token'ını diğer Identity token türlerinden kriptografik olarak
    /// ayıran tek amaç değeri. E-posta doğrulama/sıfırlama amacı kullanılmaz.
    /// </summary>
    public const string AccountInvitationPurpose = "AccountInvitation";

    /// <summary>
    /// E-posta adresi alan akışlarda adresin kayıtlı olup olmadığından
    /// bağımsız olarak dönen tek mesaj.
    /// </summary>
    private const string GenericEmailDispatchMessage =
        "Bu adresle eşleşen bir hesap varsa, e-posta gönderildi. Lütfen gelen kutunuzu kontrol edin.";

    private const string InvalidInvitationMessage =
        "Davet bağlantısı geçersiz veya süresi dolmuş.";

    private const string InvalidInvitationError =
        "Bağlantı geçersiz. Yöneticinizden yeni bir davet isteyin.";

    private readonly AppDbContext _dbContext;
    private readonly UserManager<User> _userManager;
    private readonly IEmailSender _emailSender;
    private readonly ClientAppOptions _clientApp;
    private readonly ILogger<AccountService> _logger;

    public AccountService(
        AppDbContext dbContext,
        UserManager<User> userManager,
        IEmailSender emailSender,
        ClientAppOptions clientApp,
        ILogger<AccountService> logger)
    {
        _dbContext = dbContext;
        _userManager = userManager;
        _emailSender = emailSender;
        _clientApp = clientApp;
        _logger = logger;
    }

    /* --- Yönetici daveti ---------------------------------------------------- */

    public async Task<ServiceResult<AccountInvitationToken>> GenerateAccountInvitationAsync(
        int userId,
        CancellationToken cancellationToken = default)
    {
        if (userId <= 0)
        {
            return ServiceResult<AccountInvitationToken>.Failure(InvalidInvitationMessage);
        }

        var user = await _userManager.FindByIdAsync(userId.ToString());

        if (!await IsValidInvitationAccountAsync(user, cancellationToken))
        {
            return ServiceResult<AccountInvitationToken>.Failure(InvalidInvitationMessage);
        }

        var rawToken = await _userManager.GenerateUserTokenAsync(
            user!,
            TokenOptions.DefaultProvider,
            AccountInvitationPurpose);

        return ServiceResult<AccountInvitationToken>.Success(new AccountInvitationToken
        {
            UserId = user!.Id,
            Token = EncodeToken(rawToken)
        });
    }

    public async Task<AccountResult> ActivateAccountAsync(
        ActivateAccountRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!string.Equals(request.Password, request.ConfirmPassword, StringComparison.Ordinal))
        {
            return AccountResult.Failure("Hesap etkinleştirilemedi.", "Şifreler eşleşmiyor.");
        }

        if (request.UserId <= 0 || string.IsNullOrWhiteSpace(request.Token))
        {
            return InvalidInvitation();
        }

        var user = await _userManager.FindByIdAsync(request.UserId.ToString());

        if (!await IsValidInvitationAccountAsync(user, cancellationToken)
            || !TryDecodeToken(request.Token, out var rawToken)
            || !await _userManager.VerifyUserTokenAsync(
                user!,
                TokenOptions.DefaultProvider,
                AccountInvitationPurpose,
                rawToken))
        {
            return InvalidInvitation();
        }

        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        // Yönetici rol mutasyonlarıyla aynı transaction-scoped kilit: güncel
        // rol doğrulamasından commit'e kadar primary role değişemez.
        await AdministratorSafety.AcquireMutationLockAsync(_dbContext, cancellationToken);

        // Token doğrulamasından sonra durumu ve rolü transaction içinde tekrar
        // okuyarak aradaki bir yönetici değişikliğini eski veriyle ezmeyiz.
        await _dbContext.Entry(user!).ReloadAsync(cancellationToken);

        if (!await IsValidInvitationAccountAsync(user, cancellationToken)
            || !await _userManager.VerifyUserTokenAsync(
                user!,
                TokenOptions.DefaultProvider,
                AccountInvitationPurpose,
                rawToken))
        {
            return InvalidInvitation();
        }

        // PasswordHash'e dokunulmaz: politika, hash ve security stamp tamamen
        // Identity'nin AddPasswordAsync akışına aittir.
        var password = await _userManager.AddPasswordAsync(user!, request.Password);

        if (!password.Succeeded)
        {
            return AccountResult.Failure("Hesap etkinleştirilemedi.", TranslateErrors(password.Errors));
        }

        /* Phase 13D daveti yalnızca kayıtlı posta kutusuna gönderecek; özel
           davet token'ına sahip olmak bu akışta mailbox possession kanıtıdır.
           Self-registration ConfirmEmailAsync akışı bundan tamamen ayrıdır. */
        user!.EmailConfirmed = true;
        user.AccountStatus = AccountStatus.Active;
        user.IsActive = true;
        user.ModifiedDate = DateTime.UtcNow;

        var update = await _userManager.UpdateAsync(user);

        if (!update.Succeeded)
        {
            return AccountResult.Failure(
                "Hesap etkinleştirilemedi.",
                "Lütfen daha sonra tekrar deneyin veya yöneticinizle iletişime geçin.");
        }

        await transaction.CommitAsync(cancellationToken);

        _logger.LogInformation("Davet edilen hesap etkinleştirildi. UserId={UserId}", user.Id);

        return AccountResult.Success("Hesabınız etkinleştirildi. Yeni şifrenizle giriş yapabilirsiniz.");
    }

    /* --- Register ----------------------------------------------------------- */

    public async Task<AccountResult> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken = default)
    {
        var username = request.Username?.Trim() ?? string.Empty;
        var email = request.Email?.Trim() ?? string.Empty;

        if (string.IsNullOrWhiteSpace(username))
        {
            return AccountResult.Failure("Kayıt tamamlanamadı.", "Kullanıcı adı zorunludur.");
        }

        if (string.IsNullOrWhiteSpace(email))
        {
            return AccountResult.Failure("Kayıt tamamlanamadı.", "E-posta adresi zorunludur.");
        }

        if (!string.Equals(request.Password, request.ConfirmPassword, StringComparison.Ordinal))
        {
            return AccountResult.Failure("Kayıt tamamlanamadı.", "Şifreler eşleşmiyor.");
        }

        /* Server-owned alanlar burada sabittir; request'ten HİÇBİRİ okunmaz.
           Kayıt yalnızca KİMLİK oluşturur — uygulamaya erişim hakkı vermez:
           hesap doğrulanmamış, pasif ve onay bekleyen durumda başlar. */
        var user = new User
        {
            UserName = username,
            Email = email,
            EmailConfirmed = false,
            AccountStatus = AccountStatus.PendingEmailVerification,
            IsActive = false,
            IsDeleted = false
        };

        // Kullanıcı adı/e-posta formatı, benzersizlik ve şifre politikası
        // tamamen Identity validator'larına bırakılır — kural kopyalanmaz.
        var result = await _userManager.CreateAsync(user, request.Password);

        if (!result.Succeeded)
        {
            return AccountResult.Failure("Kayıt tamamlanamadı.", TranslateErrors(result.Errors));
        }

        /* Kayıtta rol ATANMAZ.

           Önceki davranış herkese otomatik User rolü veriyordu; onay akışıyla
           birlikte bu, "yönetici erişim verir" kuralını daha kayıt anında
           delen bir yol olurdu. Rol artık tek bir yerde — yönetici onayında —
           atanır ve orada sunucu tarafında doğrulanır. Rolsüz kalan hesap
           erişim açısından zararsızdır: onaylanmadığı için zaten hiçbir
           authenticated uca ulaşamaz. */

        await SendConfirmationEmailAsync(user, cancellationToken);

        _logger.LogInformation("Yeni kullanıcı kaydı oluşturuldu. UserId={UserId}", user.Id);

        // Otomatik login YAPILMAZ: önce e-posta doğrulanmalı, sonra yönetici onaylamalı.
        return AccountResult.Success(
            "Hesabınız oluşturuldu. Önce e-posta adresinizi doğrulayın; " +
            "ardından hesabınız yönetici onayına gönderilecektir.");
    }

    /* --- E-posta doğrulama --------------------------------------------------- */

    public async Task<AccountResult> ConfirmEmailAsync(ConfirmEmailRequest request, CancellationToken cancellationToken = default)
    {
        var invalid = AccountResult.Failure(
            "Doğrulama bağlantısı geçersiz veya süresi dolmuş.",
            "Bağlantı geçersiz. Yeni bir doğrulama e-postası isteyebilirsiniz.");

        if (request.UserId <= 0 || string.IsNullOrWhiteSpace(request.Token))
        {
            return invalid;
        }

        var user = await _userManager.FindByIdAsync(request.UserId.ToString());

        if (user is null || user.IsDeleted)
        {
            return invalid;
        }

        // Tekrar doğrulama hata değil: kullanıcı linke iki kez tıklamış olabilir.
        // Idempotent yanıt hesabın O ANKİ durumunu anlatır, sabit bir cümle değil.
        if (user.EmailConfirmed)
        {
            return AccountResult.Success(DescribeConfirmedState(user));
        }

        if (!TryDecodeToken(request.Token, out var token))
        {
            return invalid;
        }

        var result = await _userManager.ConfirmEmailAsync(user, token);

        if (!result.Succeeded)
        {
            // Hatalı/oynanmış token: ayrıntı sızdırılmaz.
            return invalid;
        }

        /* Doğrulama, hesabı bir sonraki KAPIYA taşır — uygulamaya değil.
           Geçiş yalnızca PendingEmailVerification'dan yapılır: askıya alınmış
           veya reddedilmiş bir hesap, e-postasını doğrulayarak kendini yeniden
           onay sırasına sokamaz. */
        if (user.AccountStatus == AccountStatus.PendingEmailVerification)
        {
            user.AccountStatus = AccountStatus.PendingApproval;

            /* Devralınan (AUTH-7 öncesi) kayıtlarda is_active true olabilir;
               onay beklerken aktif görünmesi durum modeliyle çelişirdi. Bu
               satır kimseyi erişimden etmez: doğrulanmamış hesap zaten giriş
               yapamıyordu. */
            user.IsActive = false;

            var transition = await _userManager.UpdateAsync(user);

            if (!transition.Succeeded)
            {
                _logger.LogError(
                    "E-posta doğrulandı fakat hesap onay sırasına alınamadı. UserId={UserId} {Errors}",
                    user.Id,
                    string.Join("; ", transition.Errors.Select(e => e.Description)));

                return AccountResult.Failure(
                    "E-posta adresiniz doğrulandı fakat hesabınız onay sırasına alınamadı.",
                    "Lütfen daha sonra tekrar deneyin veya yöneticinizle iletişime geçin.");
            }
        }

        _logger.LogInformation("E-posta doğrulandı. UserId={UserId}", user.Id);

        return AccountResult.Success(DescribeConfirmedState(user));
    }

    /// <summary>
    /// Doğrulanmış bir hesabın kullanıcıya gösterilecek durum cümlesi.
    /// Enum adı asla dışarı yazılmaz.
    /// </summary>
    private static string DescribeConfirmedState(User user) => user.AccountStatus switch
    {
        AccountStatus.PendingApproval =>
            "E-posta adresiniz doğrulandı. Hesabınız yönetici onayı bekliyor.",
        AccountStatus.Active =>
            "E-posta adresiniz doğrulanmış. Giriş yapabilirsiniz.",
        AccountStatus.Rejected =>
            "E-posta adresiniz doğrulanmış fakat hesap başvurunuz onaylanmadı.",
        _ =>
            "E-posta adresiniz doğrulanmış. Hesabınız şu anda giriş yapmaya uygun değil."
    };

    public async Task<AccountResult> ResendConfirmationAsync(ResendConfirmationRequest request, CancellationToken cancellationToken = default)
    {
        var email = request.Email?.Trim() ?? string.Empty;

        // Adres kayıtlı olmasa da, zaten doğrulanmış olsa da AYNI sonuç döner.
        if (!string.IsNullOrWhiteSpace(email))
        {
            var user = await _userManager.FindByEmailAsync(email);

            /* Yalnızca hâlâ doğrulama aşamasında olan hesap yeni bağlantı alır.
               is_active'e BAKILMAZ: onay akışında doğrulama bekleyen hesap
               zaten pasiftir, o alana bakmak doğrulama e-postasını kendi
               kullanıcısına kapatırdı. */
            if (user is not null
                && !user.IsDeleted
                && !user.EmailConfirmed
                && user.AccountStatus == AccountStatus.PendingEmailVerification)
            {
                await SendConfirmationEmailAsync(user, cancellationToken);
            }
        }

        return AccountResult.Success(GenericEmailDispatchMessage);
    }

    /* --- Şifre sıfırlama ----------------------------------------------------- */

    public async Task<AccountResult> ForgotPasswordAsync(ForgotPasswordRequest request, CancellationToken cancellationToken = default)
    {
        var email = request.Email?.Trim() ?? string.Empty;

        if (!string.IsNullOrWhiteSpace(email))
        {
            var user = await _userManager.FindByEmailAsync(email);

            if (user is not null && CanUseAccountRecovery(user))
            {
                var rawToken = await _userManager.GeneratePasswordResetTokenAsync(user);
                var link = BuildLink("reset-password", new Dictionary<string, string?>
                {
                    ["email"] = user.Email,
                    ["token"] = EncodeToken(rawToken)
                });

                await _emailSender.SendAsync(new EmailMessage
                {
                    To = user.Email!,
                    Subject = "Şifre sıfırlama",
                    Body =
                        $"Merhaba {user.UserName},\n\n" +
                        "Şifrenizi sıfırlamak için aşağıdaki bağlantıyı kullanın. " +
                        "Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz.",
                    ActionUrl = link
                }, cancellationToken);

                // Token/link loglanmaz; yalnızca olayın gerçekleştiği bilgisi.
                _logger.LogInformation("Şifre sıfırlama e-postası kuyruğa alındı. UserId={UserId}", user.Id);
            }
        }

        // Adres kayıtlı olsun ya da olmasın outward response aynıdır.
        return AccountResult.Success(GenericEmailDispatchMessage);
    }

    public async Task<AccountResult> ResetPasswordAsync(ResetPasswordRequest request, CancellationToken cancellationToken = default)
    {
        var invalid = AccountResult.Failure(
            "Sıfırlama bağlantısı geçersiz veya süresi dolmuş.",
            "Bağlantı geçersiz. Yeni bir şifre sıfırlama isteği oluşturun.");

        if (!string.Equals(request.NewPassword, request.ConfirmPassword, StringComparison.Ordinal))
        {
            return AccountResult.Failure("Şifre sıfırlanamadı.", "Şifreler eşleşmiyor.");
        }

        var email = request.Email?.Trim() ?? string.Empty;

        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(request.Token))
        {
            return invalid;
        }

        var user = await _userManager.FindByEmailAsync(email);

        if (user is null || !CanUseAccountRecovery(user))
        {
            // Kayıtlı olmayan adres için de "geçersiz token" denir; böylece
            // adresin sistemde olup olmadığı anlaşılmaz.
            return invalid;
        }

        if (!TryDecodeToken(request.Token, out var token))
        {
            return invalid;
        }

        // ResetPasswordAsync hem token'ı doğrular hem de yeni şifreyi
        // policy'ye göre validate eder.
        var result = await _userManager.ResetPasswordAsync(user, token, request.NewPassword);

        if (!result.Succeeded)
        {
            // Şifre politikası hatalarını göstermek gerekir (kullanıcı düzeltebilsin);
            // token hatası ise generic mesaja düşer.
            if (result.Errors.Any(e => e.Code == "InvalidToken"))
            {
                return invalid;
            }

            return AccountResult.Failure("Şifre sıfırlanamadı.", TranslateErrors(result.Errors));
        }

        // ResetPasswordAsync SecurityStamp'i yeniler; aynı token ikinci kez
        // kullanılamaz. Ayrıca başarılı sıfırlama hesabın kilidini açar.
        await _userManager.SetLockoutEndDateAsync(user, null);
        await _userManager.ResetAccessFailedCountAsync(user);

        _logger.LogInformation("Şifre sıfırlandı. UserId={UserId}", user.Id);

        return AccountResult.Success("Şifreniz değiştirildi. Yeni şifrenizle giriş yapabilirsiniz.");
    }

    /* --- Şifre değiştirme ---------------------------------------------------- */

    public async Task<AccountResult> ChangePasswordAsync(int userId, ChangePasswordRequest request, CancellationToken cancellationToken = default)
    {
        var user = await _userManager.FindByIdAsync(userId.ToString());

        if (user is null || !CanUseAccountRecovery(user))
        {
            return AccountResult.Failure("Şifre değiştirilemedi.", "Hesap bulunamadı.");
        }

        if (!string.Equals(request.NewPassword, request.ConfirmPassword, StringComparison.Ordinal))
        {
            return AccountResult.Failure("Şifre değiştirilemedi.", "Yeni şifreler eşleşmiyor.");
        }

        if (string.Equals(request.CurrentPassword, request.NewPassword, StringComparison.Ordinal))
        {
            return AccountResult.Failure("Şifre değiştirilemedi.", "Yeni şifre mevcut şifreyle aynı olamaz.");
        }

        // ChangePasswordAsync mevcut şifreyi doğrular, yeni şifreyi policy'ye
        // göre validate eder ve SecurityStamp'i yeniler. Legacy seed bypass'ı
        // BURADA KULLANILMAZ — politika istisnasızdır.
        var result = await _userManager.ChangePasswordAsync(user, request.CurrentPassword, request.NewPassword);

        if (!result.Succeeded)
        {
            return AccountResult.Failure("Şifre değiştirilemedi.", TranslateErrors(result.Errors));
        }

        _logger.LogInformation("Şifre değiştirildi. UserId={UserId}", user.Id);

        return AccountResult.Success("Şifreniz güncellendi.");
    }

    /* --- Yardımcılar --------------------------------------------------------- */

    /// <summary>
    /// Hesabın şifre sıfırlama/değiştirme akışlarını kullanabilir olup
    /// olmadığı.
    /// </summary>
    /// <remarks>
    /// Kapı <c>is_active</c> yerine durum üzerinden kurulur. Önceki koşul
    /// (<c>IsActive</c>) devralınan veride "askıya alınmamış" ile eşanlamlıydı;
    /// onay akışında ise henüz onaylanmamış hesaplar da pasif olduğu için aynı
    /// koşul, kendi şifresini unutan yeni bir kullanıcıyı sıfırlama akışının
    /// dışında bırakırdı. Kapsam dışı bırakılanlar aynı kalır: silinmiş,
    /// askıya alınmış ve reddedilmiş hesaplar.
    /// </remarks>
    private static bool CanUseAccountRecovery(User user) =>
        !user.IsDeleted
        && user.AccountStatus is not (AccountStatus.Suspended or AccountStatus.Rejected);

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

        // GetRolesAsync yalnızca var olan Identity rolüyle eşleşen üyelikleri
        // döndürür. Tam bir rol şarttır; legacy Admin/User davetle aktive
        // edilemez. Rol adı token/request'ten hiçbir zaman okunmaz.
        var roles = await _userManager.GetRolesAsync(user);
        cancellationToken.ThrowIfCancellationRequested();

        return roles.Count == 1 && RoleCatalog.IsAssignable(roles[0]);
    }

    private static AccountResult InvalidInvitation() =>
        AccountResult.Failure(InvalidInvitationMessage, InvalidInvitationError);

    private async Task SendConfirmationEmailAsync(User user, CancellationToken cancellationToken)
    {
        var rawToken = await _userManager.GenerateEmailConfirmationTokenAsync(user);

        var link = BuildLink("confirm-email", new Dictionary<string, string?>
        {
            ["userId"] = user.Id.ToString(),
            ["token"] = EncodeToken(rawToken)
        });

        await _emailSender.SendAsync(new EmailMessage
        {
            To = user.Email!,
            Subject = "E-posta adresinizi doğrulayın",
            Body =
                $"Merhaba {user.UserName},\n\n" +
                "Hesabınızı etkinleştirmek için aşağıdaki bağlantıyı kullanın.",
            ActionUrl = link
        }, cancellationToken);
    }

    private string BuildLink(string path, IDictionary<string, string?> query)
    {
        var baseUrl = _clientApp.BaseUrl.TrimEnd('/');
        return QueryHelpers.AddQueryString($"{baseUrl}/{path}", query);
    }

    /// <summary>
    /// Identity token'ları '+' ve '/' içerebildiği için URL'de doğrudan
    /// taşınamaz; Base64Url'e çevrilir.
    /// </summary>
    private static string EncodeToken(string rawToken) =>
        WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(rawToken));

    private static bool TryDecodeToken(string encoded, out string token)
    {
        try
        {
            token = Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(encoded));
            return true;
        }
        catch (FormatException)
        {
            // Oynanmış/bozuk token: exception'ı yukarı taşımaya gerek yok.
            token = string.Empty;
            return false;
        }
    }

    /// <summary>
    /// Identity hata kodlarını Türkçeleştirir. Bilinmeyen kodlarda
    /// framework açıklaması kullanılır.
    /// </summary>
    private static IReadOnlyList<string> TranslateErrors(IEnumerable<IdentityError> errors) =>
        errors.Select(error => error.Code switch
        {
            "DuplicateUserName" => "Bu kullanıcı adı zaten kullanılıyor.",
            "DuplicateEmail" => "Bu e-posta adresi zaten kullanılıyor.",
            "InvalidUserName" => "Kullanıcı adı geçersiz karakterler içeriyor (harf ve rakam kullanın).",
            "InvalidEmail" => "E-posta adresi geçerli bir formatta değil.",
            "PasswordTooShort" => "Şifre en az 8 karakter olmalıdır.",
            "PasswordRequiresDigit" => "Şifre en az bir rakam içermelidir.",
            "PasswordRequiresLower" => "Şifre en az bir küçük harf içermelidir.",
            "PasswordRequiresUpper" => "Şifre en az bir büyük harf içermelidir.",
            "PasswordRequiresUniqueChars" => "Şifre daha fazla farklı karakter içermelidir.",
            "PasswordMismatch" => "Mevcut şifre hatalı.",
            _ => error.Description
        }).ToArray();
}
