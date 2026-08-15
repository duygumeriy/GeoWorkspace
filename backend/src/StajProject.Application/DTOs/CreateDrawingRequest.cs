namespace StajProject.Application.DTOs;

public class CreateDrawingRequest
{
    /// <summary>
    /// EPSG:4326 koordinatlarını içeren WKT. API kontratı gereği gelen WKT'nin
    /// zaten 4326 olduğu kabul edilir; API projection dönüşümü yapmaz.
    /// </summary>
    public string Wkt { get; set; } = string.Empty;

    /// <summary>
    /// Kaydın adı. ZORUNLUDUR: öznitelik popup'ından gelir, boş olamaz ve
    /// en fazla 200 karakter olabilir (<c>DrawingAttributeValidator</c>).
    /// </summary>
    public string? Name { get; set; }

    /// <summary>
    /// Görünüm bilgisi. <c>strokeColor</c> ZORUNLUDUR (#RRGGBB) — popup'ta
    /// seçilen renk budur. Diğer alanlar gönderilmezse backend varsayılan
    /// stili uygular (<c>DrawingStyleDefaults</c>).
    /// </summary>
    public DrawingStyleDto? Style { get; set; }
}
