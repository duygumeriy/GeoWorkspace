using System.Globalization;
using StajProject.Application.Rendering;

namespace StajProject.Auth.Tests;

/// <summary>
/// WMS <c>BBOX</c> eksen sırası: uygulamanın XY düzeni ile WMS 1.3.0'ın
/// EPSG:4326 için istediği enlem/boylam düzeni arasındaki TAŞIMA dönüşümü.
/// </summary>
/// <remarks>
/// <para>
/// <b>Bu testler gerçek bir hatanın nöbetçisidir.</b> Konum analizi ucu bir
/// EPSG:4326 pencereyi EPSG:3857 diye gönderiyordu; o sayılar Web Mercator
/// metresi olarak Gine Körfezi'nde ~200 metrelik bir kutuya düşüyor,
/// dolayısıyla hiçbir POI'ye rastlamıyor ve <b>her ağırlık bileşimi için aynı
/// boş PNG</b> üretiliyordu. Kayıtlı katman üzerinde ölçüldü: iki farklı
/// ağırlık kümesi bayt bayt aynı 5.622 baytlık dosyayı verdi.
/// </para>
/// <para>
/// Doğru CRS'e geçince ikinci ve bağımsız bir kural devreye girdi: WMS 1.3.0
/// EPSG:4326'yı enlem/boylam okur. Aynı pencere boylam/enlem sırasıyla yine
/// 5.622 baytlık boş bir görüntü, enlem/boylam sırasıyla 175.650 baytlık
/// gerçek bir ısı haritası üretti.
/// </para>
/// </remarks>
public class WmsBboxAxisOrderTests
{
    /* Hatanın bildirildiği GERÇEK Ankara penceresi. */
    private const double AnkaraMinLon = 32.742849147289974;
    private const double AnkaraMinLat = 39.84548205;
    private const double AnkaraMaxLon = 32.950206181106694;
    private const double AnkaraMaxLat = 40.00215400000004;

    /// <summary>İstemcinin gönderdiği metin.</summary>
    private const string AnkaraRequest =
        "32.742849147289974,39.84548205,32.950206181106694,40.00215400000004";

    /* Sunucunun ürettiği metinler. Sayılar İSTEKTEKİLERLE AYNIDIR; yalnızca
       yazımları "G17" (tam gidiş-dönüş) biçimindedir ve bu, projede zaten
       kullanılan biçimdir. Aşağıdaki testlerden biri her iki metnin de aynı
       double değerlere ayrıştığını doğrular — karşılaştırma metne değil,
       değere dayanır. */

    private const string AnkaraCanonical =
        "32.742849147289974,39.845482050000001,32.950206181106694,40.00215400000004";

    private const string AnkaraSwapped =
        "39.845482050000001,32.742849147289974,40.00215400000004,32.950206181106694";

    /* --- TEST A: tam eksen dönüşümü ------------------------------------------------ */

    [Fact]
    public void Wms_130_with_EPSG4326_puts_latitude_first()
    {
        var window = Ankara();

        Assert.Equal(
            AnkaraSwapped,
            WmsBboxFormatter.Format(WmsRenderContract.WmsVersion.V130, WmsRenderContract.Crs.Wgs84, window));
    }

    [Fact]
    public void The_produced_text_parses_back_to_the_requested_numbers()
    {
        /* Biçim "G17"dir: değer tam olarak yeniden üretilir. Metin, istemcinin
           yazdığı en kısa gösterimden farklı görünebilir ama SAYI aynıdır —
           GeoServer'ın gördüğü de sayıdır. */
        var requested = AnkaraRequest.Split(',')
            .Select(value => double.Parse(value, CultureInfo.InvariantCulture))
            .ToArray();

        var produced = AnkaraCanonical.Split(',')
            .Select(value => double.Parse(value, CultureInfo.InvariantCulture))
            .ToArray();

        Assert.Equal(requested, produced);
    }

    [Fact]
    public void The_old_wrong_upstream_bbox_is_never_produced()
    {
        /* Regresyonun ASIL ifadesi: eski (yanlış) metin bir daha üretilmemeli. */
        var upstream = WmsBboxFormatter.Format(
            WmsRenderContract.WmsVersion.V130,
            WmsRenderContract.Crs.Wgs84,
            Ankara());

        Assert.NotEqual(AnkaraCanonical, upstream);
        Assert.NotEqual(AnkaraRequest, upstream);

        // İlk sayı ENLEM olmalıdır; boylamla başlayan her metin eski hatadır.
        Assert.StartsWith("39.", upstream, StringComparison.Ordinal);
    }

    /* --- TEST E: etkilenmeyen bileşimler -------------------------------------------- */

    [Theory]
    [InlineData("1.1.1", "EPSG:4326")]
    [InlineData("1.1.1", "EPSG:3857")]
    [InlineData("1.3.0", "EPSG:3857")]
    public void Every_other_combination_keeps_canonical_XY(string version, string crs)
    {
        /* WMS 1.1.1 her CRS'i X,Y okur; EPSG:3857 zaten X,Y tanımlıdır.
           Yalnızca 1.3.0 + EPSG:4326 takas edilir. */
        Assert.Equal(AnkaraCanonical, WmsBboxFormatter.Format(version, crs, Ankara()));
        Assert.False(WmsBboxFormatter.RequiresLatitudeFirst(version, crs));
    }

    [Fact]
    public void Only_the_one_known_combination_swaps()
    {
        Assert.True(WmsBboxFormatter.RequiresLatitudeFirst("1.3.0", "EPSG:4326"));
    }

    [Theory]
    [InlineData("1.3.0", "EPSG:900913")]
    [InlineData("1.3.0", "CRS:84")]
    [InlineData("2.0.0", "EPSG:4326")]
    [InlineData("", "")]
    public void An_unknown_combination_is_left_in_canonical_XY(string version, string crs)
    {
        /* Genel bir EPSG ekseni tablosu KURULMAZ: bilinmeyen bir bileşim için
           tahmin yürütmek, doğru sanılan yanlış bir cevap üretirdi. Bilinmeyen
           bileşim bugünkü davranışta bırakılır. */
        Assert.Equal(AnkaraCanonical, WmsBboxFormatter.Format(version, crs, Ankara()));
    }

    [Fact]
    public void CRS84_is_not_treated_as_EPSG4326()
    {
        /* CRS:84, WMS 1.3.0 altında boylam/enlem sırasını KORUR ve bu yüzden
           takas edilmemelidir. Uygulama onu kullanmıyor; yayımlanan katman
           EPSG:4326 olarak tanımlı ve en küçük düzeltme bbox'ı doğru
           yazmaktı. Yine de yanlışlıkla takas edilmediği sabitlenir. */
        Assert.False(WmsBboxFormatter.RequiresLatitudeFirst("1.3.0", "CRS:84"));
    }

    /* --- TEST B: boyutlar takas EDİLMEZ --------------------------------------------- */

    [Fact]
    public void Width_and_height_are_never_swapped()
    {
        var window = WmsRenderContract
            .Validate(AnkaraRequest, 512, 320, 1.0, WmsRenderContract.Crs.Wgs84)
            .Value!;

        // Takas edilen tek şey KOORDİNAT eksenidir.
        Assert.Equal(512, window.Width);
        Assert.Equal(320, window.Height);
    }

    /* --- TEST F: kültürden bağımsız biçimlendirme ------------------------------------ */

    [Fact]
    public void Formatting_is_culture_invariant()
    {
        var original = System.Threading.Thread.CurrentThread.CurrentCulture;

        try
        {
            // Ondalık ayracı virgül olan bir kültür: bbox'ı sessizce bozardı.
            System.Threading.Thread.CurrentThread.CurrentCulture = new CultureInfo("tr-TR");

            var upstream = WmsBboxFormatter.Format(
                WmsRenderContract.WmsVersion.V130,
                WmsRenderContract.Crs.Wgs84,
                Ankara());

            Assert.Equal(AnkaraSwapped, upstream);
            Assert.Equal(3, upstream.Count(character => character == ','));
        }
        finally
        {
            System.Threading.Thread.CurrentThread.CurrentCulture = original;
        }
    }

    [Fact]
    public void The_swap_is_a_pure_reordering()
    {
        var canonical = WmsBboxFormatter.CanonicalXy(Ankara()).Split(',');
        var swapped = WmsBboxFormatter
            .Format(WmsRenderContract.WmsVersion.V130, WmsRenderContract.Crs.Wgs84, Ankara())
            .Split(',');

        // Aynı dört sayı, farklı sıra: hiçbir değer yeniden hesaplanmaz.
        Assert.Equal([canonical[1], canonical[0], canonical[3], canonical[2]], swapped);
    }

    /* --- CRS'e duyarlı doğrulama ----------------------------------------------------- */

    [Fact]
    public void A_valid_EPSG4326_window_is_accepted()
    {
        var result = WmsRenderContract.Validate(AnkaraRequest, 512, 512, 1.0, WmsRenderContract.Crs.Wgs84);

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal(AnkaraMinLon, result.Value!.MinX);
        Assert.Equal(AnkaraMinLat, result.Value.MinY);
    }

    [Theory]
    [InlineData("-181,39,-179,40")]
    [InlineData("32,-91,33,-89")]
    [InlineData("32,89,33,91")]
    [InlineData("179,39,181,40")]
    public void An_out_of_range_EPSG4326_window_is_rejected(string bbox)
    {
        /* Enlem ±90, boylam ±180 — ve sınırlar AYRI uygulanır. Tek bir ortak
           sınır kullanmak, 95 enlemli bir pencereyi geçerli sayardı. */
        Assert.False(WmsRenderContract.Validate(bbox, 512, 512, 1.0, WmsRenderContract.Crs.Wgs84).IsSuccess);
    }

    [Fact]
    public void The_same_numbers_are_still_valid_Web_Mercator()
    {
        /* Hatanın SESSİZ olmasının sebebi budur: 32.74/39.84 geçerli birer Web
           Mercator metresidir, dolayısıyla CRS bilmeyen bir doğrulayıcı bu
           pencereyi reddedemez. Doğrulayıcının CRS parametresi almasının
           gerekçesi de tam olarak bu. */
        Assert.True(WmsRenderContract.Validate(AnkaraRequest, 512, 512).IsSuccess);
    }

    [Fact]
    public void A_Web_Mercator_window_stays_valid_and_unswapped()
    {
        // Mevcut uçların penceresi: davranış DEĞİŞMEMELİDİR.
        var result = WmsRenderContract.Validate("-1000,-2000,3000,4000", 512, 320);

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal("-1000,-2000,3000,4000", result.Value!.Bbox);
        Assert.Equal(
            "-1000,-2000,3000,4000",
            WmsBboxFormatter.Format(WmsRenderContract.WmsVersion.V130, WmsRenderContract.Crs.WebMercator, result.Value));
    }

    /* --- CRS:84 — eksen sırası belirsiz OLMAYAN WGS84 ------------------------------

       Phase 5B'de eklendi. Ağırlıklı ısı haritası stili pencereyi
       `wms_bbox` üzerinden `vec:Heatmap`'in `outputBBOX` parametresi olarak
       kullanır; enlem-önce bir zarf orada rasteri DEVİRİR. CRS:84 aynı
       datumu kanonik boylam,enlem sırasıyla söyler.

       Buradaki testler iki şeyi birden sabitler: CRS:84 takas EDİLMEZ ve
       EPSG:4326 hâlâ takas EDİLİR (Phase 4C korunur). */

    [Fact]
    public void CRS84_is_never_swapped()
    {
        Assert.False(WmsBboxFormatter.RequiresLatitudeFirst(
            WmsRenderContract.WmsVersion.V130, WmsRenderContract.Crs.Wgs84LonLat));

        Assert.Equal(
            WmsBboxFormatter.CanonicalXy(Ankara()),
            WmsBboxFormatter.Format(
                WmsRenderContract.WmsVersion.V130, WmsRenderContract.Crs.Wgs84LonLat, Ankara()));
    }

    [Fact]
    public void CRS84_and_EPSG4326_describe_the_same_window_in_opposite_order()
    {
        var lonFirst = WmsBboxFormatter.Format(
            WmsRenderContract.WmsVersion.V130, WmsRenderContract.Crs.Wgs84LonLat, Ankara());
        var latFirst = WmsBboxFormatter.Format(
            WmsRenderContract.WmsVersion.V130, WmsRenderContract.Crs.Wgs84, Ankara());

        Assert.NotEqual(lonFirst, latFirst);

        // Aynı dört sayı, takas edilmiş sırada.
        var a = lonFirst.Split(',');
        var b = latFirst.Split(',');
        Assert.Equal(new[] { a[1], a[0], a[3], a[2] }, b);
    }

    [Fact]
    public void EPSG4326_still_requires_latitude_first()
    {
        /* Phase 4C REGRESYON KORUMASI. CRS:84'e geçen tek şey konum analizi
           görüntü ucudur; taşıma kuralının kendisi yerinde durur. */
        Assert.True(WmsBboxFormatter.RequiresLatitudeFirst(
            WmsRenderContract.WmsVersion.V130, WmsRenderContract.Crs.Wgs84));
    }

    [Fact]
    public void CRS84_is_validated_with_geographic_bounds()
    {
        // Aynı datum → aynı sınırlar: boylam ±180, enlem ±90.
        Assert.True(WmsRenderContract
            .Validate(AnkaraRequest, 512, 512, 1, WmsRenderContract.Crs.Wgs84LonLat).IsSuccess);

        // Enlem 95 geçersizdir ve Web Mercator sınırlarıyla kaçamaz.
        Assert.False(WmsRenderContract
            .Validate("32.7,95,32.9,96", 512, 512, 1, WmsRenderContract.Crs.Wgs84LonLat).IsSuccess);

        // Web Mercator metreleri coğrafi sınırları aşar: sessizce geçmemeli.
        Assert.False(WmsRenderContract
            .Validate("3600000,4800000,3700000,4900000", 512, 512, 1, WmsRenderContract.Crs.Wgs84LonLat).IsSuccess);
    }

    private static ValidatedRender Ankara() =>
        new(AnkaraMinLon, AnkaraMinLat, AnkaraMaxLon, AnkaraMaxLat, 512, 512);
}
