namespace StajProject.Application.DTOs;

/// <summary>
/// Çağıranın KENDİ yürürlükteki coğrafi sınırı — haritanın "nereye
/// çizebilirim" sorusunun cevabı.
/// </summary>
/// <remarks>
/// <para>
/// <b>Yönetim cevabından bilinçli olarak DARDIR.</b> Burada alan listesi, alan
/// kimlikleri, kaynak tipleri, adlar ya da sınırın hangi rolden geldiği
/// YOKTUR. Sıradan bir GIS kullanıcısının haritayı doğru çizmek için tek
/// ihtiyacı sınırın kendisidir; rol adlarını ve alan kimliklerini vermek,
/// yetkilendirme yapısını hiçbir karşılığı olmadan dışarı açmak olurdu.
/// </para>
/// <para>
/// <b>Kısıtsızlık AÇIK bir durumdur.</b> Sınırı olmayan kullanıcı için
/// <see cref="EffectiveWkt"/> <c>null</c>'dır — dünyayı kaplayan sahte bir
/// poligon DEĞİL. Sahte bir kutu, harita üzerinde var olmayan bir sınırı
/// varmış gibi çizerdi ve kutunun kenarındaki bir çizim yanlışlıkla
/// engellenirdi.
/// </para>
/// </remarks>
public class SelfGeographicScopeResponse
{
    /// <summary>Çağıranın coğrafi bir sınırı var mı.</summary>
    public bool IsRestricted { get; set; }

    /// <summary>
    /// Yürürlükteki sınır (EPSG:4326); sınır yoksa <c>null</c>. Kopuk alanların
    /// birleşiminde MultiPolygon olur.
    /// </summary>
    public string? EffectiveWkt { get; set; }

    /// <summary>
    /// Sınırı oluşturan alan sayısı — doğrudan alanlar varsa onların, yoksa
    /// rollerden gelenlerin sayısı.
    /// </summary>
    /// <remarks>
    /// Yalnızca arayüzün "Yetki Alanım (3 bölge)" gibi bir özet yazabilmesi
    /// içindir. Hangi alanın nereden geldiğini AÇIKLAMAZ.
    /// </remarks>
    public int AreaCount { get; set; }
}
