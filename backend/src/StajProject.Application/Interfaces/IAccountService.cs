using StajProject.Application.DTOs;
using StajProject.Application.Common;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Hesap yaşam döngüsü: kayıt, e-posta doğrulama, şifre sıfırlama ve şifre
/// değiştirme. Login/JWT üretimi <see cref="IAuthService"/>'te kalır.
/// </summary>
/// <remarks>
/// Kullanıcı numaralandırmasına (user enumeration) karşı: e-posta adresi
/// alan tüm akışlar (<see cref="ResendConfirmationAsync"/>,
/// <see cref="ForgotPasswordAsync"/>) adresin kayıtlı olup olmamasından
/// bağımsız olarak <b>aynı</b> sonucu döner.
/// </remarks>
public interface IAccountService
{
    Task<AccountResult> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken = default);

    Task<AccountResult> ConfirmEmailAsync(ConfirmEmailRequest request, CancellationToken cancellationToken = default);

    Task<AccountResult> ResendConfirmationAsync(ResendConfirmationRequest request, CancellationToken cancellationToken = default);

    Task<AccountResult> ForgotPasswordAsync(ForgotPasswordRequest request, CancellationToken cancellationToken = default);

    Task<AccountResult> ResetPasswordAsync(ResetPasswordRequest request, CancellationToken cancellationToken = default);

    /// <summary>
    /// Yalnızca geçerli InvitationPending hesap için özel amaçlı, stateless
    /// davet token'ı üretir. Bu metot public bir HTTP ucu değildir.
    /// </summary>
    Task<ServiceResult<AccountInvitationToken>> GenerateAccountInvitationAsync(
        int userId,
        CancellationToken cancellationToken = default);

    /// <summary>Davet token'ını doğrular ve kullanıcının kendi şifresiyle hesabı etkinleştirir.</summary>
    Task<AccountResult> ActivateAccountAsync(
        ActivateAccountRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>Kullanıcı kimliği request'ten değil, doğrulanmış JWT'den gelir.</summary>
    Task<AccountResult> ChangePasswordAsync(int userId, ChangePasswordRequest request, CancellationToken cancellationToken = default);
}
