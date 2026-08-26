namespace StajProject.Application.Options;

/// <summary>Normal çizim WFS okumaları için secret içermeyen GeoServer ayarları.</summary>
public sealed class GeoServerOptions
{
    public const string SectionName = "GeoServer";

    public string BaseUrl { get; set; } = string.Empty;

    public string Workspace { get; set; } = string.Empty;

    public string PointLayer { get; set; } = string.Empty;

    public string LineLayer { get; set; } = string.Empty;

    public string PolygonLayer { get; set; } = string.Empty;

    public string HeatmapLayer { get; set; } = string.Empty;

    public string HeatmapStyle { get; set; } = string.Empty;

    public int HeatmapTimeoutSeconds { get; set; } = 30;

    /* Normal çizim sunumunun (WMS) style adları. Katman adları WFS okumasıyla
       ORTAKTIR (*_read SQL View'ları) — aynı veri, iki farklı protokol. Style
       adları ayrıdır çünkü sunum, kayıtlı per-feature stilini yeniden üreten
       kendi SLD'lerini kullanır. */

    public string PointPresentationStyle { get; set; } = string.Empty;

    public string LinePresentationStyle { get; set; } = string.Empty;

    public string PolygonPresentationStyle { get; set; } = string.Empty;

    /* POI sunumu. Katman ve style adları BACKEND'e aittir ve istemciden hiçbir
       biçimde belirlenemez — çizim sunumundaki sözleşmenin aynısı.

       `poi_read` SQL View'ı silinmiş/pasif POI'leri ve kategorileri zaten
       eler; `poi_all` ise 44 kanonik kategorinin tamamını kendi simgesi ve
       rengiyle çizen bileşik stildir. Kategori başına ayrı stiller ödev
       şartının karşılığıdır ve burada KULLANILMAZ: tek bir WMS isteği 44 style
       adı taşıyamaz. */

    public string PoiLayer { get; set; } = string.Empty;

    public string PoiStyle { get; set; } = string.Empty;

    public int PresentationTimeoutSeconds { get; set; } = 30;

    /* --- Konum analizi (ağırlıklı ısı haritası) ---------------------------------

       Mevcut Heatmap* ayarları YENİDEN KULLANILMAZ. Onlar kullanıcının KENDİ
       çizim noktalarının yoğunluğunu (tbl_point_heatmap) gösterir; bu, ortak
       açık veri POI kümesini (analysis_poi) kategori ağırlıklarıyla çizer.
       Aynı ayara iki anlam yüklemek, birini değiştirenin diğerini farkında
       olmadan bozması demek olurdu. */

    public string AnalysisPoiLayer { get; set; } = string.Empty;

    /// <summary>
    /// Analiz POI'lerini nokta olarak çizen stil.
    /// </summary>
    /// <remarks>
    /// <b>Aynı katman, farklı stil.</b> Nokta örtüsü
    /// <see cref="AnalysisPoiLayer"/>'ı yeniden kullanır; ikinci bir SQL View
    /// ya da feature type KAYDEDİLMEZ. Örtünün süzgeci ısı haritasınınkiyle
    /// birebir aynı üretimden geçer, dolayısıyla iki katman aynı POI kümesini
    /// gösterir — ayrı bir katman, ayrı bir taksonomi yorumu riski olurdu.
    /// </remarks>
    public string AnalysisPoiPointStyle { get; set; } = string.Empty;

    /// <summary>
    /// NEAR LOD ısı çekirdeğinin <b>metre</b> cinsinden bant genişliği.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Piksel DEĞİL, YER ölçüsüdür — ve bu bir düzeltmedir.</b> Önceki ayar
    /// CSS pikseliydi ve raster analiz alanının tamamını sabit sayıda piksele
    /// çizdiği için, aynı 30 piksel bir ilde ~4 km, elle çizilmiş küçük bir
    /// poligonda birkaç yüz metre anlamına geliyordu: yani çekirdek, seçilen
    /// alan büyüdükçe sessizce genişliyor ve bir ilin tamamını tek bir lekeye
    /// çeviriyordu. Kullanıcının bildirdiği "boyanmış alan" görüntüsünün
    /// başlıca nedeni buydu.
    /// </para>
    /// <para>
    /// Bant genişliği artık "bir ilgi noktası çevresini kaç metreye kadar
    /// etkiler" sorusunun cevabıdır ve rasterin çözünürlüğü (metre/piksel)
    /// üzerinden piksele çevrilir; piksel karşılığı
    /// <see cref="StajProject.Application.Analysis.LocationAnalysisHeatmapRenderer"/>
    /// içindeki alt/üst sınırlara çekilir.
    /// </para>
    /// <para>
    /// <b>Sunucu ayarıdır, istemci belirleyemez.</b> Yarıçap yalnızca bir
    /// görünüm tercihi değildir: küçük bir değer tek tek noktaları, büyük bir
    /// değer bölgesel eğilimi gösterir. İstemcinin bunu göndermesi, ödevin
    /// "kriterlere göre yoğunluk" tanımını istemcinin yeniden yorumlaması
    /// olurdu.
    /// </para>
    /// </remarks>
    public double AnalysisHeatmapRadiusMeters { get; set; } =
        StajProject.Application.Analysis.LocationAnalysisHeatmapRenderer.DefaultRadiusMeters;

    public int AnalysisTimeoutSeconds { get; set; } = 30;

    public void Validate()
    {
        if (!Uri.TryCreate(BaseUrl, UriKind.Absolute, out var baseUri)
            || baseUri.Scheme is not ("http" or "https"))
        {
            throw new InvalidOperationException("GeoServer:BaseUrl geçerli bir mutlak HTTP(S) adresi olmalıdır.");
        }

        if (string.IsNullOrWhiteSpace(Workspace)
            || string.IsNullOrWhiteSpace(PointLayer)
            || string.IsNullOrWhiteSpace(LineLayer)
            || string.IsNullOrWhiteSpace(PolygonLayer)
            || string.IsNullOrWhiteSpace(HeatmapLayer)
            || string.IsNullOrWhiteSpace(HeatmapStyle)
            || string.IsNullOrWhiteSpace(PointPresentationStyle)
            || string.IsNullOrWhiteSpace(LinePresentationStyle)
            || string.IsNullOrWhiteSpace(PolygonPresentationStyle)
            || string.IsNullOrWhiteSpace(PoiLayer)
            || string.IsNullOrWhiteSpace(PoiStyle)
            || string.IsNullOrWhiteSpace(AnalysisPoiLayer)
            || string.IsNullOrWhiteSpace(AnalysisPoiPointStyle))
        {
            throw new InvalidOperationException(
                "GeoServer workspace, drawing/POI layer, heatmap, konum analizi ve sunum style adları tanımlı olmalıdır.");
        }

        if (!IsSafeCatalogName(Workspace)
            || !IsSafeCatalogName(PointLayer)
            || !IsSafeCatalogName(LineLayer)
            || !IsSafeCatalogName(PolygonLayer)
            || !IsSafeCatalogName(HeatmapLayer)
            || !IsSafeCatalogName(HeatmapStyle)
            || !IsSafeCatalogName(PointPresentationStyle)
            || !IsSafeCatalogName(LinePresentationStyle)
            || !IsSafeCatalogName(PolygonPresentationStyle)
            || !IsSafeCatalogName(PoiLayer)
            || !IsSafeCatalogName(PoiStyle)
            || !IsSafeCatalogName(AnalysisPoiLayer)
            || !IsSafeCatalogName(AnalysisPoiPointStyle))
        {
            throw new InvalidOperationException(
                "GeoServer catalog adları yalnızca harf, sayı, nokta, tire ve alt çizgi içerebilir.");
        }

        if (HeatmapTimeoutSeconds is < 1 or > 120)
        {
            throw new InvalidOperationException("GeoServer:HeatmapTimeoutSeconds 1 ile 120 arasında olmalıdır.");
        }

        if (PresentationTimeoutSeconds is < 1 or > 120)
        {
            throw new InvalidOperationException("GeoServer:PresentationTimeoutSeconds 1 ile 120 arasında olmalıdır.");
        }

        if (AnalysisTimeoutSeconds is < 1 or > 120)
        {
            throw new InvalidOperationException("GeoServer:AnalysisTimeoutSeconds 1 ile 120 arasında olmalıdır.");
        }

        /* Bant genişliği sınırı keyfî değildir. 0 ve altı bir yoğunluk
           çekirdeği tanımlamaz; üst sınır 50 km'dir ve Türkiye'nin en büyük
           ilinin (Konya, ~350 km) genişliğinin yedide birine denk gelir —
           bunun ötesinde çekirdek, il ölçeğinde bile "her yer sıcak"
           demekten başka bir şey söylemez. */
        if (!double.IsFinite(AnalysisHeatmapRadiusMeters)
            || AnalysisHeatmapRadiusMeters is <= 0 or > 50_000)
        {
            throw new InvalidOperationException(
                "GeoServer:AnalysisHeatmapRadiusMeters 0'dan büyük ve en fazla 50000 olmalıdır.");
        }
    }

    private static bool IsSafeCatalogName(string value) =>
        value.All(character => char.IsAsciiLetterOrDigit(character) || character is '_' or '-' or '.');
}
