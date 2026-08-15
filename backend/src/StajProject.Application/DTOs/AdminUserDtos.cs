namespace StajProject.Application.DTOs;

/* Admin kullanıcı yönetimi DTO'ları.
   Bu tiplerin hiçbiri PasswordHash, SecurityStamp, ConcurrencyStamp,
   authenticator secret, recovery code veya herhangi bir token TAŞIMAZ.
   Admin bile başka bir kullanıcının kimlik bilgilerini göremez. */

public class AdminUserListItem
{
    public int Id { get; set; }

    public string Username { get; set; } = string.Empty;

    public string? Email { get; set; }

    /// <summary>Tek primary application role; atanmamışsa <c>null</c>.</summary>
    public string? Role { get; set; }

    public bool IsActive { get; set; }

    public bool EmailConfirmed { get; set; }

    /// <summary>AUTH-5 için yalnızca durum bilgisi; secret gösterilmez.</summary>
    public bool TwoFactorEnabled { get; set; }

    /// <summary>Hesap kilitliyse (lockout) bitiş zamanı, UTC.</summary>
    public DateTimeOffset? LockoutEnd { get; set; }

    public DateTime ModifiedDate { get; set; }
}

/// <summary>
/// Kullanıcı detayı. Şu an liste öğesiyle aynı alanları taşır; ayrı tip olarak
/// durur ki detay ekranı (AUTH-6) listeyi şişirmeden genişletilebilsin.
/// </summary>
public class AdminUserDetail : AdminUserListItem
{
}

public class UpdateUserRoleRequest
{
    /// <summary>"User" veya "Admin". Başka değer reddedilir.</summary>
    public string Role { get; set; } = string.Empty;
}

public class UpdateUserStatusRequest
{
    public bool IsActive { get; set; }
}
