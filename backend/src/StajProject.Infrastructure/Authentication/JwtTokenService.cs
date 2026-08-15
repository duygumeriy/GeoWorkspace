using System.Globalization;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using StajProject.Application.Common;
using StajProject.Application.Interfaces;

namespace StajProject.Infrastructure.Authentication;

public class JwtTokenService : ITokenService
{
    private readonly JwtOptions _jwtOptions;

    public JwtTokenService(JwtOptions jwtOptions)
    {
        _jwtOptions = jwtOptions;
    }

    public (string Token, DateTime ExpiresAt) GenerateToken(
        int userId,
        string userName,
        IEnumerable<string> roles,
        AuthenticationLevel level)
    {
        var expiresAt = DateTime.UtcNow.AddMinutes(_jwtOptions.ExpireMinutes);
        var userIdText = userId.ToString(CultureInfo.InvariantCulture);

        var claims = new List<Claim>
        {
            // sub artık kullanıcı adı değil, kalıcı kullanıcı kimliğidir.
            // Kullanıcı adı değişse bile token'daki kimlik referansı bozulmaz.
            new(JwtRegisteredClaimNames.Sub, userIdText),
            new(ClaimTypes.NameIdentifier, userIdText),
            new(ClaimTypes.Name, userName),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),

            /* AUTH-5: token'ın hangi doğrulama adımlarından geçtiği. Değeri
               ÇAĞIRAN belirlemez — çağıran yalnızca "ikinci faktör doğrulandı
               mı" bilgisini iletir; buradaki eşleme tek yerdedir ve istemciye
               hiçbir noktada açılmaz. AdminMfaRequired policy'si bu claim'e
               dayanır. */
            new(AuthenticationMethods.ClaimType, level == AuthenticationLevel.MultiFactor
                ? AuthenticationMethods.MultiFactor
                : AuthenticationMethods.Password)
        };

        // AUTH-3 [Authorize(Roles = ...)] doğrudan çalışsın diye standart
        // role claim tipi kullanılır.
        claims.AddRange(roles.Select(role => new Claim(ClaimTypes.Role, role)));

        var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwtOptions.Key));
        var credentials = new SigningCredentials(signingKey, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: _jwtOptions.Issuer,
            audience: _jwtOptions.Audience,
            claims: claims,
            expires: expiresAt,
            signingCredentials: credentials);

        var tokenString = new JwtSecurityTokenHandler().WriteToken(token);

        return (tokenString, expiresAt);
    }
}
