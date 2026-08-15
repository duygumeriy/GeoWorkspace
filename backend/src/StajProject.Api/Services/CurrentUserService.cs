using System.Globalization;
using System.Security.Claims;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;

namespace StajProject.Api.Services;

/// <summary>
/// Kimliği doğrulanmış JWT'nin claim'lerinden okur. Endpoint'ler
/// <c>[Authorize]</c> olduğu için buraya gelindiğinde kimlik zaten
/// doğrulanmıştır; request gövdesindeki hiçbir alan kullanılmaz.
/// </summary>
public class CurrentUserService : ICurrentUserService
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    public CurrentUserService(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor;
    }

    private ClaimsPrincipal? Principal => _httpContextAccessor.HttpContext?.User;

    public int? UserId
    {
        get
        {
            // JwtSecurityTokenHandler varsayılan inbound mapping'i "sub" claim'ini
            // NameIdentifier'a çevirir; iki kaynak da aynı değeri taşır.
            var raw = Principal?.FindFirstValue(ClaimTypes.NameIdentifier);

            return int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id)
                ? id
                : null;
        }
    }

    public string UserName
    {
        get
        {
            var user = Principal;
            return user?.FindFirstValue(ClaimTypes.Name) ?? user?.Identity?.Name ?? string.Empty;
        }
    }

    public bool IsAuthenticated => Principal?.Identity?.IsAuthenticated ?? false;

    public IReadOnlyCollection<string> Roles =>
        Principal?.FindAll(ClaimTypes.Role).Select(c => c.Value).ToArray() ?? [];

    public string? Role => Roles.FirstOrDefault(r => ApplicationRoles.All.Contains(r));

    public bool IsAdmin => IsInRole(ApplicationRoles.Admin);

    public bool IsInRole(string role) => Principal?.IsInRole(role) ?? false;
}
