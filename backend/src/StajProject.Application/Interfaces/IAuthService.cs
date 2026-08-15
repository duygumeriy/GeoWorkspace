using StajProject.Application.DTOs;

namespace StajProject.Application.Interfaces;

public interface IAuthService
{
    /// <summary>
    /// Kimlik bilgilerini doğrular. Başarısız her durum (yanlış şifre, pasif
    /// hesap, lockout) 401 karşılığıdır; ayrım yalnızca kullanıcıya gösterilen
    /// mesajdadır — hesabın var olup olmadığı sızdırılmaz.
    /// </summary>
    Task<LoginResult> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default);

    /// <summary>
    /// Doğrulanmış kimliğin profil bilgisi. Kullanıcı bulunamazsa <c>null</c>
    /// (ör. token geçerli ama hesap silinmiş).
    /// </summary>
    Task<CurrentUserResponse?> GetCurrentUserAsync(int userId, CancellationToken cancellationToken = default);
}
