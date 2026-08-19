namespace StajProject.Application.DTOs;

/// <summary>
/// Bir hedefin (kullanıcı ya da rol) coğrafi yetki alanı.
/// </summary>
/// <remarks>
/// <para>
/// <b>Hedefin KENDİ alanı ile YÜRÜRLÜKTEKİ alan ayrı tutulur.</b> Yönetici
/// ekranının iki ayrı sorusu vardır: "bu kullanıcıya özel olarak ne çizdim"
/// (düzenlenecek olan) ve "bu kullanıcıya şu an fiilen ne uygulanıyor"
/// (rollerinden mirasla gelmiş olabilir). Tek alana indirgenirse, rolünden alan
/// devralan bir kullanıcının ekranı ya boş görünür ya da yöneticinin
/// silemeyeceği bir poligonu kendi alanıymış gibi gösterirdi.
/// </para>
/// <para>
/// Rol hedefleri için ikisi daima aynıdır: bir rolün alanı başka bir yerden
/// miras alınmaz.
/// </para>
/// <para>
/// Geometri WKT olarak taşınır — projenin çizim uçlarındaki sözleşmenin
/// aynısı. EF/NetTopologySuite nesneleri JSON'a doğrudan açılmaz.
/// </para>
/// </remarks>
public class GeographicAuthorizationResponse
{
    /// <summary>Bu hedefe ait bir alan satırı var mı.</summary>
    public bool HasDirectAuthorization { get; set; }

    /// <summary>Hedefin kendi alanı (EPSG:4326 Polygon WKT); yoksa <c>null</c>.</summary>
    public string? Wkt { get; set; }

    /// <summary>
    /// Hedefe fiilen uygulanan bir coğrafi sınır var mı. Kullanıcı için
    /// rollerinden gelen alanları da kapsar.
    /// </summary>
    public bool IsRestricted { get; set; }

    /// <summary>
    /// Yürürlükteki alanın WKT'si; sınır yoksa <c>null</c>. Birden çok rolün
    /// alanı birleştiğinde MultiPolygon olabilir.
    /// </summary>
    public string? EffectiveWkt { get; set; }
}

/// <summary>
/// Bir hedefe coğrafi alan atama isteği.
/// </summary>
/// <remarks>
/// Gövde tek bir alan taşır: hedef zaten rotadadır. Aktör kimliği ASLA gövdeden
/// okunmaz.
/// </remarks>
public class UpdateGeographicAuthorizationRequest
{
    /// <summary>EPSG:4326 Polygon WKT.</summary>
    public string? Wkt { get; set; }
}
