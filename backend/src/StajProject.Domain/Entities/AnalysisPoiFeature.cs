using NetTopologySuite.Geometries;

namespace StajProject.Domain.Entities;

/// <summary>
/// Konum analizinin <b>TEK</b> mantıksal veri kümesi: dış kaynaklı
/// <see cref="AnalysisPoi"/> satırları ile uygulamada oluşturulmuş, aktif ve
/// silinmemiş <see cref="Poi"/> satırlarının birleşimi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Bu bir ENTITY DEĞİLDİR.</b> Hiçbir tabloya ya da view'a eşlenmez ve
/// <c>AppDbContext</c>'te bir <c>DbSet</c>'i yoktur: EF Core bir <c>Select</c>
/// içinde eşlenmiş bir varlık tipine projeksiyon yapılmasına izin vermez.
/// Birleşim, iki <c>DbSet</c> üzerinde kurulmuş bir sorgu ifadesidir
/// (<c>LocationAnalysisService.Union</c>) ve sonucu bu taşıyıcıya yazar;
/// böylece aynı tanım hem PostgreSQL'de <c>UNION ALL</c>'a çevrilir hem de
/// testlerdeki bellek içi sağlayıcıda çalışır.
/// </para>
/// <para>
/// <b>Tek tanım, beş tüketici.</b> Özet sayımı, ölçüt kırılımı, ağırlıklı
/// raster, tek ölçütlü raster ve nokta listesi (+ isabet testi) aynı sorgu
/// ifadesinden geçer. Birleşimi her tüketicide yeniden kurmak, birinin gün
/// gelip yalnızca bir kaynağa bakması demekti — ve bu SESSİZCE olurdu: özet
/// "382 POI" derken haritada 371 nokta çizilirdi.
/// </para>
/// <para>
/// <b>GeoServer aynı birleşimi bir VIEW'dan okur</b>
/// (<c>analysis_poi_union</c>, <c>AddAnalysisPoiUnionView</c> migration'ı):
/// WMS'e bir C# sorgu ifadesi gönderilemez. İkisinin ayrışmaması bir DRIFT
/// testiyle sabitlenir — view'ın ürettiği <c>feature_id</c> şeması, kaynak
/// etiketleri ve uygulama POI'si süzgeci, buradaki sabitlerle karşılaştırılır.
/// </para>
/// <para>
/// <b>Kimlik KAYNAKLA birlikte taşınır.</b> <c>poi.id</c> ile
/// <c>analysis_poi.id</c> ayrı identity dizileridir ve <b>çakışırlar</b>:
/// ikisinde de 42 numaralı satır vardır. Ham tam sayı kimlik bu yüzden
/// birleşimde bir kimlik DEĞİLDİR; <see cref="FeatureId"/>
/// (<c>"app:42"</c> / <c>"osm:42"</c>) tekil olandır ve GeoServer SQL View'ı
/// da identifier olarak onu kullanır.
/// </para>
/// <para>
/// <b>Salt okunurdur.</b> Yalnızca bir okuma projeksiyonudur; hiçbir yazma
/// yolu buradan geçmez ve iki taban tablonun kendi sözleşmeleri (sahiplik,
/// çöp kutusu, içe aktarım) olduğu gibi kalır.
/// </para>
/// <para>
/// <b>Uygulama POI'lerinin süzgeci taban tablonun sözleşmesidir.</b> Yalnızca
/// <c>is_deleted = false AND is_active = true</c> satırlar girer — bu, EF
/// global query filter'ının ve <c>poi_read</c> SQL View'ının uyguladığı
/// yüklemin AYNISIDIR. Sahiplik yüklemi YOKTUR ve uydurulmaz: POI ortak bir
/// envanterdir, <c>GET /api/poi</c> ve <c>poi_read</c> WMS'i onu
/// <c>poi.view</c> taşıyan herkese gösterir. Analizi kullanıcının kendi
/// kayıtlarıyla sınırlamak, projede hiçbir okuma yolunda bulunmayan bir kural
/// icat etmek olurdu.
/// </para>
/// </remarks>
public class AnalysisPoiFeature
{
    /// <summary>Birleşimdeki TEKİL kimlik: <c>"osm:12"</c> / <c>"app:12"</c>.</summary>
    public string FeatureId { get; set; } = string.Empty;

    /// <summary>Satırın geldiği taban tablo: <c>"analysis"</c> ya da <c>"app"</c>.</summary>
    /// <remarks>
    /// Kullanıcıya gösterilen kaynak adı bu DEĞİLDİR (<see cref="Source"/>);
    /// bu kolon, kaydın hangi sözleşmeye tabi olduğunu söyler ve kimliği
    /// ayrıştırır.
    /// </remarks>
    public string SourceKind { get; set; } = string.Empty;

    /// <summary>Taban tablodaki kimlik. <b>Tek başına tekil DEĞİLDİR.</b></summary>
    public int SourceId { get; set; }

    /// <summary>Kaydın adı; dış kaynakta <c>null</c> olabilir.</summary>
    public string? Name { get; set; }

    /// <summary>Ortak taksonomideki kategori.</summary>
    public int CategoryId { get; set; }

    /// <summary>Konum. SRID 4326.</summary>
    public Point Coordinate { get; set; } = null!;

    /// <summary>Verinin geldiği kaynağın adı (<c>"osm"</c>, <c>"app"</c>).</summary>
    public string Source { get; set; } = string.Empty;
}
