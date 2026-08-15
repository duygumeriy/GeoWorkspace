namespace StajProject.Application.DTOs;

/// <summary>
/// Detay popup'ından gelen düzenleme isteği: ad, renk (stil) ve geometry tek
/// çağrıda güncellenir.
/// </summary>
/// <remarks>
/// Alanların tamamı opsiyoneldir ve <b>gönderilmeyen alan korunur</b>: yalnızca
/// adını değiştiren bir kullanıcı geometry'sini yeniden göndermek zorunda
/// kalmaz. Sahiplik alanları burada kasıtlı olarak YOKTUR — kaydın sahibi
/// veritabanındaki değerdir, istek gövdesi onu belirleyemez.
/// </remarks>
public class UpdateDrawingRequest
{
    /// <summary>
    /// Yeni ad. <c>null</c> ise mevcut ad korunur; gönderildiyse boş olamaz ve
    /// en fazla 200 karakter olabilir (create ile aynı kural).
    /// </summary>
    public string? Name { get; set; }

    /// <summary>
    /// Yeni görünüm bilgisi. Yalnızca gönderilen alanlar uygulanır, kalanı
    /// kaydın mevcut stilinden korunur (mevcut PATCH .../style ile aynı merge).
    /// </summary>
    public DrawingStyleDto? Style { get; set; }

    /// <summary>
    /// Yeni geometry'nin WKT karşılığı, EPSG:4326. <c>null</c> ise geometry'e
    /// hiç dokunulmaz. Gönderildiğinde endpoint'in türüyle eşleşmek zorundadır
    /// (point ucu Point, line ucu LineString, polygon ucu Polygon bekler) —
    /// doğrulama create ile aynı <c>WktGeometryParser</c> üzerinden yapılır.
    /// </summary>
    public string? Wkt { get; set; }
}
