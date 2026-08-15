using StajProject.Application.Common;
using StajProject.Application.DTOs;

namespace StajProject.Application.Interfaces;

/// <summary>
/// TOTP tabanlı iki faktörlü doğrulamanın tüm iş kuralları.
/// </summary>
/// <remarks>
/// <para>
/// TOTP secret üretimi, kod doğrulaması ve kurtarma kodları <b>tamamen</b>
/// ASP.NET Core Identity'ye bırakılır (authenticator token provider +
/// recovery code store). Bu arayüzün hiçbir implementasyonu OTP algoritması
/// yazmaz, rastgele kurtarma kodu üretmez veya secret'ı kendi tablosunda
/// tutmaz.
/// </para>
/// <para>
/// Katman kuralı: HTTP'ye dair hiçbir şey (status kodu, header, challenge
/// binding) burada bulunmaz; controller yalnızca <see cref="ServiceResult{T}"/>
/// çevirisini yapar.
/// </para>
/// </remarks>
public interface ITwoFactorService
{
    /* --- Oturum açmış kullanıcı (Ayarlar → Güvenlik) ---------------------- */

    /// <summary>Kullanıcının kendi 2FA durumu; sır içermez.</summary>
    Task<ServiceResult<TwoFactorStatusResponse>> GetStatusAsync(int userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Authenticator anahtarı hazırlar ve QR için otpauth URI üretir.
    /// Şifre yeniden doğrulanır; 2FA burada <b>etkinleşmez</b>.
    /// </summary>
    Task<ServiceResult<AuthenticatorSetupResponse>> StartSetupAsync(
        int userId,
        TwoFactorSetupRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Kurulumu tamamlar: kod doğruysa 2FA etkinleşir ve kurtarma kodları
    /// <b>bir kez</b> döner. Kod yanlışsa hiçbir şey değişmez.
    /// </summary>
    Task<ServiceResult<RecoveryCodesResponse>> EnableAsync(
        int userId,
        TwoFactorEnableRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// 2FA'yı kapatır. Admin rolündeki hesaplar için <see cref="ServiceErrorKind.Conflict"/>
    /// döner — zorunluluk kullanıcı tarafından kaldırılamaz.
    /// </summary>
    Task<ServiceResult<AccountResult>> DisableAsync(
        int userId,
        TwoFactorDisableRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Kurtarma kodlarını yeniler; önceki set (kullanılmamışlar dahil)
    /// geçersizleşir.
    /// </summary>
    Task<ServiceResult<RecoveryCodesResponse>> RegenerateRecoveryCodesAsync(
        int userId,
        RegenerateRecoveryCodesRequest request,
        CancellationToken cancellationToken = default);

    /* --- Login'in ikinci adımı (challenge ile) ---------------------------- */

    /// <summary>
    /// Authenticator kodunu doğrular ve başarılıysa <c>amr=mfa</c> taşıyan
    /// normal access token üretir.
    /// </summary>
    Task<ServiceResult<LoginResponse>> CompleteLoginAsync(
        TwoFactorLoginRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Tek kullanımlık kurtarma kodunu harcayarak ikinci faktörü tamamlar.
    /// Kurtarma kodu da tam yetkili bir ikinci faktördür:
    /// <see cref="AuthenticationLevel.MultiFactor"/> token üretilir.
    /// </summary>
    Task<ServiceResult<LoginResponse>> CompleteLoginWithRecoveryCodeAsync(
        TwoFactorRecoveryLoginRequest request,
        CancellationToken cancellationToken = default);

    /* --- Zorunlu kurulum (yalnız setup bileti ile) ------------------------ */

    /// <summary>
    /// 2FA'sı zorunlu ama kurulmamış hesabın kurulumunu başlatır. Yetki
    /// kaynağı JWT değil, yalnızca kurulum amaçlı challenge biletidir.
    /// </summary>
    Task<ServiceResult<AuthenticatorSetupResponse>> StartBootstrapSetupAsync(
        TwoFactorSetupChallengeRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Zorunlu kurulumu doğrular: 2FA etkinleşir, kurtarma kodları bir kez
    /// döner ve <b>aynı anda</b> MFA tamamlanmış access token verilir.
    /// </summary>
    Task<ServiceResult<TwoFactorSetupCompletedResponse>> CompleteBootstrapSetupAsync(
        TwoFactorLoginRequest request,
        CancellationToken cancellationToken = default);
}
