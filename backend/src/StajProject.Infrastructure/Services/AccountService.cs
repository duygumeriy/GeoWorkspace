using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Logging;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;

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
    /// E-posta adresi alan akışlarda adresin kayıtlı olup olmadığından
    /// bağımsız olarak dönen tek mesaj.
    /// </summary>
    private const string GenericEmailDispatchMessage =
        "Bu adresle eşleşen bir hesap varsa, e-posta gönderildi. Lütfen gelen kutunuzu kontrol edin.";

    private readonly UserManager<User> _userManager;
    private readonly IEmailSender _emailSender;
    private readonly ClientAppOptions _clientApp;
    private readonly ILogger<AccountService> _logger;

    public AccountService(
        UserManager<User> userManager,
        IEmailSender emailSender,
        ClientAppOptions clientApp,
        ILogger<AccountService> logger)
    {
        _userManager = userManager;
        _emailSender = emailSender;
        _clientApp = clientApp;
        _logger = logger;
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

        // Server-owned alanlar burada sabittir; request'ten HİÇBİRİ okunmaz.
        // Rol ataması yapılmaz — roller AUTH-3 kapsamındadır.
        var user = new User
        {
            UserName = username,
            Email = email,
            EmailConfirmed = false,
            IsActive = true,
            IsDeleted = false
        };

        // Kullanıcı adı/e-posta formatı, benzersizlik ve şifre politikası
        // tamamen Identity validator'larına bırakılır — kural kopyalanmaz.
        var result = await _userManager.CreateAsync(user, request.Password);

        if (!result.Succeeded)
        {
            return AccountResult.Failure("Kayıt tamamlanamadı.", TranslateErrors(result.Errors));
        }

        /* Rol SERVER tarafında atanır; istemci rol seçemez. Kayıt olan herkes
           User rolünü alır (AUTH-3).

           Atama başarısız olursa yeni oluşturulan hesap silinir: rolsüz yarım
           bir kullanıcı bırakmak, sonradan hiçbir authorization kuralına
           uymayan "yetim" hesaplar demek olurdu. Identity UserManager kendi
           transaction'ını yönetmediği için telafi (compensating delete)
           yaklaşımı kullanılır; kullanıcı henüz bu istekte oluşturulduğundan
           silmek güvenlidir. */
        var roleAssignment = await _userManager.AddToRoleAsync(user, ApplicationRoles.User);

        if (!roleAssignment.Succeeded)
        {
            await _userManager.DeleteAsync(user);

            _logger.LogError(
                "Kayıt geri alındı: rol ataması başarısız. {Errors}",
                string.Join("; ", roleAssignment.Errors.Select(e => e.Description)));

            return AccountResult.Failure(
                "Kayıt tamamlanamadı.",
                "Hesap oluşturulurken bir sorun oluştu. Lütfen tekrar deneyin.");
        }

        await SendConfirmationEmailAsync(user, cancellationToken);

        _logger.LogInformation("Yeni kullanıcı kaydı oluşturuldu. UserId={UserId}", user.Id);

        // Otomatik login YAPILMAZ: önce e-posta doğrulanmalı.
        return AccountResult.Success(
            "Hesabınız oluşturuldu. Giriş yapabilmek için e-posta adresinizi doğrulayın.");
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
        if (user.EmailConfirmed)
        {
            return AccountResult.Success("E-posta adresiniz zaten doğrulanmış. Giriş yapabilirsiniz.");
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

        _logger.LogInformation("E-posta doğrulandı. UserId={UserId}", user.Id);

        return AccountResult.Success("E-posta adresiniz doğrulandı. Artık giriş yapabilirsiniz.");
    }

    public async Task<AccountResult> ResendConfirmationAsync(ResendConfirmationRequest request, CancellationToken cancellationToken = default)
    {
        var email = request.Email?.Trim() ?? string.Empty;

        // Adres kayıtlı olmasa da, zaten doğrulanmış olsa da AYNI sonuç döner.
        if (!string.IsNullOrWhiteSpace(email))
        {
            var user = await _userManager.FindByEmailAsync(email);

            if (user is not null && !user.IsDeleted && user.IsActive && !user.EmailConfirmed)
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

            if (user is not null && !user.IsDeleted && user.IsActive)
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

        if (user is null || user.IsDeleted || !user.IsActive)
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

        if (user is null || user.IsDeleted || !user.IsActive)
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
