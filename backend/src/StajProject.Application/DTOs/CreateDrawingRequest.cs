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

    /* --- Opsiyonel metadata --------------------------------------------------
       Üçü de popup'ın "Daha fazla seçenek" bölümünden gelir ve gönderilmemesi
       tamamen normaldir: metadata olmadan da kayıt oluşur. */

    /// <summary>
    /// Serbest metin açıklama. En fazla 2000 karakter
    /// (<c>DrawingMetadataValidator</c>).
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// Kategori. <c>DrawingCategories</c> kümesinden bir değer olmalıdır;
    /// bilinmeyen bir değer 400 ile reddedilir.
    /// </summary>
    public string? Category { get; set; }

    /// <summary>
    /// Etiketler. Backend kırpar, boşları atar, büyük/küçük harf duyarsız
    /// tekilleştirir; en fazla 10 etiket, her biri en fazla 40 karakter.
    /// </summary>
    public List<string>? Tags { get; set; }
}
