using System.Security.Claims;

namespace StajProject.Application.Common;

/// <summary>
/// Bir JWT'nin hangi kimlik doğrulama adımlarından geçilerek üretildiğini
/// taşıyan <c>amr</c> (Authentication Methods References, RFC 8176) claim'i.
/// </summary>
/// <remarks>
/// <para>
/// Neden gerekli: token'ın kendisi "bu kullanıcı Admin" bilgisini taşır ama
/// "ikinci faktör gerçekten tamamlandı mı" bilgisini taşımazdı. Bu claim
/// olmadan sunucu, elindeki token'ın yalnız şifreyle mi yoksa TOTP sonrası mı
/// üretildiğini ayırt edemezdi ve "Admin işlemleri MFA ister" kuralı
/// merkezî bir policy ile uygulanamazdı.
/// </para>
/// <para>
/// Claim <b>yetkinin kaynağı değil, kanıtıdır</b>: değerini yalnızca
/// <c>JwtTokenService</c> yazar ve yalnızca ikinci faktör doğrulandıktan sonra
/// <see cref="MultiFactor"/> olur. İstemci hiçbir yerde bu değeri gönderemez.
/// </para>
/// </remarks>
public static class AuthenticationMethods
{
    /// <summary>Token'a yazılan kısa (standart) claim adı.</summary>
    public const string ClaimType = "amr";

    /// <summary>
    /// <c>JwtSecurityTokenHandler</c>'ın varsayılan inbound claim mapping'i
    /// <c>amr</c>'yi bu uzun WS-Federation adına çevirebilir. Okuma tarafı iki
    /// adı da tanır ki davranış mapping ayarına bağlı kalmasın.
    /// </summary>
    public const string MappedClaimType = "http://schemas.microsoft.com/claims/authnmethodsreferences";

    /// <summary>Yalnızca şifre doğrulandı.</summary>
    public const string Password = "pwd";

    /// <summary>Şifre + ikinci faktör (TOTP veya kurtarma kodu) doğrulandı.</summary>
    public const string MultiFactor = "mfa";

    /// <summary>
    /// Principal'ın ikinci faktörü tamamlamış bir token taşıyıp taşımadığı.
    /// </summary>
    public static bool IsMultiFactor(ClaimsPrincipal? principal) =>
        principal is not null
        && principal.Claims.Any(claim =>
            (claim.Type == ClaimType || claim.Type == MappedClaimType)
            && claim.Value == MultiFactor);
}

/// <summary>
/// <see cref="Interfaces.ITokenService"/>'e "bu token hangi doğrulama
/// seviyesinden geçti" bilgisini taşıyan tip. <c>bool isMfa</c> yerine enum
/// kullanılır: çağrı yerinde ne anlama geldiği okunur kalsın.
/// </summary>
public enum AuthenticationLevel
{
    /// <summary>Şifre doğrulandı; ikinci faktör istenmiyor.</summary>
    Password,

    /// <summary>Şifre <b>ve</b> ikinci faktör doğrulandı.</summary>
    MultiFactor
}
