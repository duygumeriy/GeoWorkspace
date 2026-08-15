using Microsoft.AspNetCore.Identity;
using StajProject.Domain.Common;

namespace StajProject.Domain.Entities;

/// <summary>
/// Uygulama kullanıcısı. ASP.NET Core Identity'nin <see cref="IdentityUser{TKey}"/>
/// tipinden türer; şifre hash'i, e-posta doğrulaması, 2FA ve lockout alanları
/// Identity tarafından sağlanır — elle yeniden tanımlanmaz.
/// </summary>
/// <remarks>
/// Identity'den gelen ve bu Phase'de altyapı olarak hazır tutulan alanlar:
/// <c>Id</c>, <c>UserName</c>, <c>Email</c>, <c>EmailConfirmed</c>,
/// <c>PhoneNumber</c>, <c>PhoneNumberConfirmed</c>, <c>TwoFactorEnabled</c>,
/// <c>LockoutEnabled</c>, <c>LockoutEnd</c>, <c>AccessFailedCount</c>,
/// <c>PasswordHash</c>, <c>SecurityStamp</c>, <c>ConcurrencyStamp</c>.
/// Aşağıdaki üç alan projenin kendi audit sözleşmesidir ve korunmuştur.
/// </remarks>
public class User : IdentityUser<int>, IAuditableEntity
{
    public bool IsDeleted { get; set; }

    public bool IsActive { get; set; } = true;

    /// <summary>UTC olarak tutulur.</summary>
    public DateTime ModifiedDate { get; set; }
}
