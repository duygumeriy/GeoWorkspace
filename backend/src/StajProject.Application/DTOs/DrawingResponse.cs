namespace StajProject.Application.DTOs;

public class DrawingResponse
{
    public int Id { get; set; }

    /// <summary>Database'deki geometry'nin WKTWriter çıktısı (EPSG:4326).</summary>
    public string Wkt { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    /* --- Metadata ------------------------------------------------------------
       Açıklama ve kategori boş olabilir (null). Tags ise HER ZAMAN dizidir —
       etiketi olmayan kayıtta boş dizi döner, null değil; böylece frontend
       filtreleme/gruplama yaparken null kontrolü yapmak zorunda kalmaz. */

    /// <summary>Serbest metin açıklama; yoksa <c>null</c>.</summary>
    public string? Description { get; set; }

    /// <summary>Kanonik kategori adı; yoksa <c>null</c>.</summary>
    public string? Category { get; set; }

    /// <summary>Etiketler; yoksa boş dizi.</summary>
    public List<string> Tags { get; set; } = [];

    /// <summary>Kalıcı görünüm bilgisi; her zaman dolu döner.</summary>
    public DrawingStyleDto Style { get; set; } = new();

    /// <summary>UTC. Backend tarafından yazılır.</summary>
    public DateTime CreatedDate { get; set; }

    /// <summary>UTC. Backend tarafından yazılır.</summary>
    public DateTime ModifiedDate { get; set; }

    /// <summary>
    /// Sahibin kullanıcı adı. Mevcut frontend sözleşmesi korunmuştur; değer
    /// artık sahiplik ilişkisinden türetilir.
    /// </summary>
    public string CreatedBy { get; set; } = string.Empty;

    /// <summary>
    /// Sahibin Identity kimliği. Frontend "bu çizimi yönetebilir miyim?"
    /// kararını (yalnızca UX amaçlı) bununla verir. Hassas kullanıcı bilgisi
    /// (e-posta, rol, hash, stamp) response'ta yer almaz.
    /// </summary>
    public int CreatedByUserId { get; set; }
}
