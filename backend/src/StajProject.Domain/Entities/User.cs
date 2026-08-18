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

    /* --- Hesap onay yaşam döngüsü --------------------------------------------
       Kayıt tek başına uygulamaya erişim vermez; araya yönetici incelemesi
       girer. Varsayılan değer bilinçli olarak en kısıtlı durumdur: yeni bir
       User nesnesi hiçbir şey yapılmadan uygulamaya giremez. Bootstrap
       yönetici hesabı gibi istisnalar durumu AÇIKÇA yükseltmek zorundadır. */

    public AccountStatus AccountStatus { get; set; } = AccountStatus.PendingEmailVerification;

    /// <summary>Onay anı (UTC). Hiç onaylanmamış hesaplarda <c>null</c>.</summary>
    public DateTime? ApprovedAt { get; set; }

    /// <summary>
    /// Onaylayan yöneticinin kimliği. Navigation property BİLEREK yoktur:
    /// User → User çift yönlü ilişkisi Identity'nin kendi kullanıcı grafiğine
    /// döngü eklerdi; ilişki <c>UserConfiguration</c> içinde navigation'sız
    /// tanımlanır.
    /// </summary>
    public int? ApprovedByUserId { get; set; }

    /// <summary>Reddetme anı (UTC).</summary>
    public DateTime? RejectedAt { get; set; }

    public int? RejectedByUserId { get; set; }

    /// <summary>
    /// Yöneticinin kendi kayıtları için tuttuğu isteğe bağlı gerekçe.
    /// Kullanıcıya gönderilen e-postada YER ALMAZ.
    /// </summary>
    public string? RejectionReason { get; set; }
}
