namespace StajProject.Application.DTOs;

public class DrawingResponse
{
    public int Id { get; set; }

    /// <summary>Database'deki geometry'nin WKTWriter çıktısı (EPSG:4326).</summary>
    public string Wkt { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

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
