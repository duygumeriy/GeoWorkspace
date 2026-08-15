namespace StajProject.Application.DTOs;

/// <summary>
/// <c>GET /api/auth/me</c> gövdesi. Mevcut frontend yalnızca
/// <see cref="Username"/> alanını okuduğu için o alan adı korunmuştur;
/// diğerleri ek alanlardır ve eski davranışı bozmaz.
/// </summary>
public class CurrentUserResponse
{
    public int UserId { get; set; }

    public string Username { get; set; } = string.Empty;

    public string? Email { get; set; }

    public bool EmailConfirmed { get; set; }

    public bool TwoFactorEnabled { get; set; }

    /// <summary>
    /// Primary application role ("User" / "Admin"). Frontend'in tek rol
    /// varsayımıyla çalışabilmesi için kolaylık alanıdır.
    /// </summary>
    public string? Role { get; set; }

    /// <summary>
    /// Kullanıcının tüm rolleri. AUTH-2'den beri var olan alan; geriye dönük
    /// uyumluluk için korunur. Tek primary role kuralı gereği normalde tek
    /// eleman taşır.
    /// </summary>
    public IReadOnlyCollection<string> Roles { get; set; } = [];
}
