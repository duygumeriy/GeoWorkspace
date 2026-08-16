namespace StajProject.Application.DTOs;

/// <summary>
/// POST /api/analysis/intersections gövdesi.
/// <para>
/// Geometry, çizim endpoint'leriyle aynı sözleşmeyi kullanır: EPSG:4326 WKT.
/// Analiz için gönderilen geometry kaydedilmez; yalnızca sorgu parametresidir.
/// </para>
/// <para>
/// <b>Sahiplik burada YOKTUR ve olmamalıdır.</b> Analizin kapsamı doğrulanmış
/// JWT'den (<c>ICurrentUserService.UserId</c>) okunur; istek gövdesine bir
/// kullanıcı kimliği koymak, kapsamı client'ın belirlemesine izin vermek olurdu.
/// </para>
/// </summary>
public class IntersectionAnalysisRequest
{
    /// <summary>EPSG:4326 WKT. Yalnızca POLYGON kabul edilir.</summary>
    public string Wkt { get; set; } = string.Empty;

    /// <summary>
    /// Sayımdan çıkarılacak poligon kaydı. Yeni kaydedilmiş bir poligon kendi
    /// analizini çalıştırdığında kendisini envanter olarak saymasın diye
    /// gönderilir. Geçici analiz aracında null'dır.
    /// <para>
    /// Kapsam zaten çağıranın kendi envanteriyle sınırlı olduğu için bu alan
    /// yetki açısından zararsızdır: başkasının kaydının kimliği gönderilse bile
    /// o kayıt kümede zaten yoktur, kullanıcı yalnızca <b>kendi</b> kaydını
    /// sayımdan düşürebilir.
    /// </para>
    /// </summary>
    public int? ExcludePolygonId { get; set; }
}

/// <summary>
/// Kesişim analizi sonucu: sayılar <b>ve</b> eşleşen kayıtların kendisi.
/// <para>
/// Kayıtların tamamı çağıran kullanıcıya aittir; başka bir kullanıcının kaydı ne
/// sayıya ne listeye girer. Sayı da bir bilgidir, bu yüzden kırılımlar da aynı
/// sahiplik sınırındadır.
/// </para>
/// <para>
/// <b>Değişmez:</b> <c>TotalCount == PointCount + LineCount + PolygonCount</c> ve
/// her sayı kendi listesinin uzunluğuna eşittir. Sayılar listelerden türetilir,
/// ayrıca sorgulanmaz — ikisinin ayrışması mümkün değildir.
/// </para>
/// </summary>
public class IntersectionAnalysisResponse
{
    public int TotalCount { get; set; }

    public int PointCount { get; set; }

    public int LineCount { get; set; }

    public int PolygonCount { get; set; }

    /// <summary>Eşleşen noktalar; yoksa boş dizi (asla null).</summary>
    public List<InventoryAnalysisItemResponse> Points { get; set; } = [];

    /// <summary>Eşleşen çizgiler; yoksa boş dizi.</summary>
    public List<InventoryAnalysisItemResponse> Lines { get; set; } = [];

    /// <summary>Eşleşen poligonlar; yoksa boş dizi.</summary>
    public List<InventoryAnalysisItemResponse> Polygons { get; set; } = [];
}

/// <summary>
/// Analiz alanıyla kesişen tek bir envanter kaydı.
/// <para>
/// <b>Entity değil, dar bir DTO.</b> Sahiplik alanları (<c>CreatedByUserId</c>),
/// soft-delete izleri ve navigation property'ler kasıtlı olarak yoktur: bu uç
/// yalnızca çağıranın kendi kayıtlarını döndürdüğü için sahiplik bilgisi zaten
/// yeni bir şey söylemez, taşınması ise gereksiz yüzey açardı.
/// </para>
/// <para>
/// <b>Geometry de yoktur.</b> Eşleşen her kayıt tanım gereği çağıranın kendi
/// çizimidir, yani haritada zaten yüklüdür; "Haritada Göster" <c>Id</c> +
/// <c>DrawingType</c> ile o feature'ı bulur. Uzunluk/alan gibi ölçüler de
/// haritadaki geometry'den, uygulamanın tek ölçüm yardımcılarıyla hesaplanır —
/// aynı sayının ikinci bir tanımı üretilmez.
/// </para>
/// </summary>
public class InventoryAnalysisItemResponse
{
    public int Id { get; set; }

    /// <summary>point | line | polygon — frontend'in tür kimlikleriyle aynı.</summary>
    public string DrawingType { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    public string? Category { get; set; }

    /// <summary>Etiketler; yoksa boş dizi.</summary>
    public List<string> Tags { get; set; } = [];

    /// <summary>
    /// Kaydın kalıcı stili. Sonuç listesindeki renk noktası bunu kullanır ve
    /// değer haritadakiyle aynı okumadan (<c>DrawingStyleReader</c>) gelir.
    /// </summary>
    public DrawingStyleDto Style { get; set; } = new();

    public DateTime CreatedDate { get; set; }

    public DateTime ModifiedDate { get; set; }

    /// <summary>
    /// <see cref="IntersectionTypes.FullyInside"/> veya
    /// <see cref="IntersectionTypes.Partial"/>.
    /// </summary>
    /// <remarks>
    /// Yalnızca <b>açıklama</b> içindir. Bir kaydın sayılıp sayılmayacağına karar
    /// veren ölçüt her zaman <c>ST_Intersects</c>'tir; bu alan kullanıcıya
    /// "tamamen içeride mi, yoksa kenardan mı değiyor" bilgisini verir.
    /// </remarks>
    public string IntersectionType { get; set; } = IntersectionTypes.Partial;
}

/// <summary>Kesişim sınıflandırmasının kanonik değerleri.</summary>
public static class IntersectionTypes
{
    /// <summary>Kayıt bütünüyle analiz alanının içinde (sınırı dahil).</summary>
    public const string FullyInside = "fullyInside";

    /// <summary>Kayıt alana değiyor ama tamamı içinde değil.</summary>
    public const string Partial = "partial";
}
