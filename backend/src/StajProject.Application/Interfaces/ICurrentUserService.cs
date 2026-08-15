namespace StajProject.Application.Interfaces;

/// <summary>
/// İstekteki doğrulanmış kimliğin tek kaynağı. Değerler daima
/// <c>HttpContext.User</c> üzerindeki doğrulanmış JWT claim'lerinden okunur;
/// request gövdesinden veya query'den asla alınmaz.
/// </summary>
public interface ICurrentUserService
{
    /// <summary>Kimlik doğrulanmamışsa <c>null</c>.</summary>
    int? UserId { get; }

    /// <summary>Kimlik doğrulanmamışsa boş string döner.</summary>
    string UserName { get; }

    bool IsAuthenticated { get; }

    /// <summary>Token'daki rol claim'leri.</summary>
    IReadOnlyCollection<string> Roles { get; }

    /// <summary>Primary application role; yoksa <c>null</c>.</summary>
    string? Role { get; }

    /// <summary>
    /// Kolaylık kontrolü. <b>Yetkilendirmenin ana mekanizması değildir</b> —
    /// erişim kararları <c>[Authorize(Policy = ...)]</c> ile verilir. Bu alan
    /// yalnızca iş kuralı gerçekten kimliğe bağlıysa kullanılır.
    /// </summary>
    bool IsAdmin { get; }

    bool IsInRole(string role);
}
