using System.Text.Json.Serialization;
using StajProject.Domain.Common;

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

    /// <summary>
    /// Hesabın yaşam döngüsündeki durumu. İstemciye enum'un <b>adı</b>
    /// gönderilir (ör. <c>"PendingApproval"</c>); kullanıcıya gösterilecek
    /// Türkçe karşılığı UI belirler.
    /// </summary>
    /// <remarks>
    /// Converter tek tek buraya konur, global olarak kaydedilmez: global bir
    /// enum→string dönüşümü mevcut tüm uçların sözleşmesini aynı anda
    /// değiştirirdi.
    /// </remarks>
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public AccountStatus AccountStatus { get; set; }

    /// <summary>AUTH-5 için yalnızca durum bilgisi; secret gösterilmez.</summary>
    public bool TwoFactorEnabled { get; set; }

    /// <summary>Hesap kilitliyse (lockout) bitiş zamanı, UTC.</summary>
    public DateTimeOffset? LockoutEnd { get; set; }

    public DateTime ModifiedDate { get; set; }
}

/// <summary>
/// Kullanıcı detayı. Liste öğesine onay/red audit alanlarını ekler; bunlar
/// listede taşınmaz çünkü yalnızca inceleme ekranında anlamlıdır.
/// </summary>
public class AdminUserDetail : AdminUserListItem
{
    public DateTime? ApprovedAt { get; set; }

    public int? ApprovedByUserId { get; set; }

    /// <summary>Onaylayan yöneticinin kullanıcı adı; hesap silinmişse <c>null</c>.</summary>
    public string? ApprovedByUsername { get; set; }

    public DateTime? RejectedAt { get; set; }

    public int? RejectedByUserId { get; set; }

    public string? RejectedByUsername { get; set; }

    /// <summary>Yalnızca yöneticiye gösterilir; kullanıcıya e-postayla gitmez.</summary>
    public string? RejectionReason { get; set; }

    /// <summary>
    /// Onay/red işlemi başarıyla kaydedildi fakat bilgilendirme e-postası
    /// gönderilemedi. Yalnızca <b>o isteğin yanıtında</b> doludur; kalıcı bir
    /// alan değildir ve sonraki okumalarda <c>null</c> döner.
    /// </summary>
    /// <remarks>
    /// Bilerek ayrı bir alan: e-posta arızasını hata olarak döndürmek,
    /// yöneticinin gerçekte tamamlanmış bir onayı başarısız sanmasına ve
    /// tekrar denemesine yol açardı.
    /// </remarks>
    public string? NotificationWarning { get; set; }
}

public class UpdateUserRoleRequest
{
    /// <summary>"User" veya "Admin". Başka değer reddedilir.</summary>
    public string Role { get; set; } = string.Empty;
}

/// <summary>
/// Yönetici tarafından oluşturulan parolasız hesabın en küçük sözleşmesi.
/// Hesap durumu, parola ve erişim alanları sunucunun kararlarıdır.
/// </summary>
public class CreateAdminUserRequest
{
    public string Username { get; set; } = string.Empty;

    public string Email { get; set; } = string.Empty;

    public string Role { get; set; } = string.Empty;
}

public class UpdateUserStatusRequest
{
    public bool IsActive { get; set; }
}

/// <summary>
/// Onay isteğinin gövdesi. Bilerek TEK alan taşır: aktiflik, onaylayan kimliği
/// ve onay zamanı sunucunun kendi kararlarıdır ve istemciden okunmaz.
/// </summary>
public class ApproveUserRequest
{
    /// <summary>Onayla birlikte atanacak rol. Sunucu tarafında doğrulanır.</summary>
    public string Role { get; set; } = string.Empty;
}

public class RejectUserRequest
{
    /// <summary>
    /// İsteğe bağlı yönetici notu. Yalnızca kayıt amaçlıdır; reddetme
    /// e-postasında kullanıcıya gönderilmez.
    /// </summary>
    public string? Reason { get; set; }
}

/// <summary>
/// Onay ekranında seçilebilecek rol. Rol listesi sunucudan gelir ki istemci
/// tarafında kopyalanan bir liste ile gerçek arasındaki fark büyümesin.
/// </summary>
public class AssignableRole
{
    public string Name { get; set; } = string.Empty;

    /// <summary>Rolün ne getirdiğinin kısa açıklaması (onay ekranında gösterilir).</summary>
    public string Description { get; set; } = string.Empty;

    /// <summary>Bu rolde ikinci faktör zorunlu mu.</summary>
    public bool RequiresTwoFactor { get; set; }
}
