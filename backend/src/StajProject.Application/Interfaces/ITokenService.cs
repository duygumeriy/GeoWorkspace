using StajProject.Application.Common;

namespace StajProject.Application.Interfaces;

public interface ITokenService
{
    /// <summary>
    /// Doğrulanmış bir kullanıcı için imzalı JWT üretir ve UTC bitiş zamanıyla döner.
    /// </summary>
    /// <param name="userId">Kullanıcının veritabanı kimliği; <c>sub</c> claim'i olur.</param>
    /// <param name="userName">Görünen kullanıcı adı; <c>name</c> claim'i olur.</param>
    /// <param name="roles">
    /// Rol claim'leri. AUTH-3'te authorization için kullanılacak; bu Phase'de
    /// genelde boş gelir ve token yapısı değişmeden rol taşıyabilir.
    /// </param>
    /// <param name="level">
    /// AUTH-5: token'ın hangi doğrulama seviyesinden geçtiği (<c>amr</c> claim'i).
    /// <see cref="AuthenticationLevel.MultiFactor"/> değerini yalnızca ikinci
    /// faktör gerçekten doğrulandıktan sonra geçirin — bu claim, admin
    /// policy'sinin dayandığı kanıttır.
    /// </param>
    (string Token, DateTime ExpiresAt) GenerateToken(
        int userId,
        string userName,
        IEnumerable<string> roles,
        AuthenticationLevel level);
}
