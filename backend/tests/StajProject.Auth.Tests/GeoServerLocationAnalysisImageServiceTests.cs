using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using StajProject.Application.Analysis;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using NetTopologySuite.Geometries;
using StajProject.Application.Options;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.GeoServer;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Auth.Tests;

/// <summary>
/// Analiz POI nokta örtüsünün GeoServer isteği: ne gönderildiği, neyin
/// gönderilMEdiği ve istemcinin neyi belirleyemediği.
/// </summary>
/// <remarks>
/// <para>
/// <b>Ağırlıklı ısı haritası ARTIK burada değildir.</b> O yüzey sunucuda
/// hesaplanıyor ve denklemi <c>LocationAnalysisHeatmapRendererTests</c> ile
/// <c>LocationAnalysisImageServiceTests</c> sabitliyor. Bu dosyada kalan
/// sözleşme, örtünün analizle AYNI alan ve AYNI kategori kümesini çizmesi ve
/// istemcinin GeoServer parametrelerine hiçbir metin sokamamasıdır.
/// </para>
/// <para>
/// <b>Level 1 doğrulamasıdır.</b> GeoServer kataloğunda <c>analysis_poi_read</c>
/// katmanı ELLE oluşturulana kadar gerçek bir render çalıştırılamaz; burada
/// ölçülen şey isteğin BİLEŞİMİdir.
/// </para>
/// </remarks>
public class GeoServerLocationAnalysisImageServiceTests
{
    private static readonly byte[] Png = [137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3];

    private const string Ankara = "POLYGON ((32 39, 34 39, 34 41, 32 41, 32 39))";
    private const string Istanbul = "POLYGON ((28 40.5, 29.5 40.5, 29.5 41.5, 28 41.5, 28 40.5))";

    /* --- İstek bileşimi ------------------------------------------------------------ */

    [Fact]
    public async Task Uses_backend_owned_WMS_parameters_over_the_analysis_layer()
    {
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        var result = await ServiceWith(db, handler).RenderAsync(Request(("eczane", 50), ("okullar", 50)), default);

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal(Png, result.Value!.Content);
        Assert.Equal(HttpMethod.Post, handler.Method);
        Assert.Equal("http://localhost:8080/geoserver/wms", handler.RequestUri!.ToString());
        Assert.Equal("application/x-www-form-urlencoded", handler.ContentType);

        var form = handler.Form();
        Assert.Equal("WMS", form["SERVICE"]);
        Assert.Equal("1.3.0", form["VERSION"]);
        Assert.Equal("GetMap", form["REQUEST"]);
        Assert.Equal("geoworkspace:analysis_poi_read", form["LAYERS"]);
        Assert.Equal("analysis_poi_points", form["STYLES"]);
        /* CRS artık CRS:84'tür: aynı datum (WGS84), aynı sayılar, ama eksen
           sırası KANONİK boylam,enlem. Gerekçe için eksen sırası bölümüne
           bakın — EPSG:4326 bu uçta rasteri devriyor. */
        Assert.Equal("CRS:84", form["CRS"]);
        Assert.Equal("image/png", form["FORMAT"]);
        Assert.Equal("true", form["TRANSPARENT"]);
        Assert.Equal("512", form["WIDTH"]);
        Assert.Equal("320", form["HEIGHT"]);
    }

    [Fact]
    public async Task The_existing_drawing_heatmap_layer_and_style_are_never_requested()
    {
        /* İki ısı haritası AYRI özelliklerdir. Bu ucun yanlışlıkla
           tbl_point_heatmap'i çizmesi, kullanıcıya başka birinin çizim
           yoğunluğunu konum analizi diye göstermek olurdu. */
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        await ServiceWith(db, handler).RenderAsync(Request(("eczane", 50), ("okullar", 50)), default);

        var form = handler.Form();
        Assert.DoesNotContain("tbl_point", form["LAYERS"], StringComparison.Ordinal);
        Assert.DoesNotContain("point_density", form["STYLES"], StringComparison.Ordinal);
        Assert.DoesNotContain("inserted_user_id", form["CQL_FILTER"], StringComparison.Ordinal);
    }

    [Fact]
    public async Task No_client_controllable_GeoServer_parameter_is_ever_sent()
    {
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        await ServiceWith(db, handler).RenderAsync(Request(("eczane", 50), ("okullar", 50)), default);

        /* SLD_BODY hiçbir koşulda gönderilmez: stil KATALOGDA durur. Gövdeden
           gelen bir stil, istemcinin sunucuda rasgele render kodu
           çalıştırması demek olurdu. */
        Assert.DoesNotContain("SLD_BODY", handler.Form().Keys);
        Assert.DoesNotContain("SLD", handler.Form().Keys);
        Assert.DoesNotContain("VIEWPARAMS", handler.Form().Keys);
        Assert.DoesNotContain("FORMAT_OPTIONS", handler.Form().Keys);
    }

    /* --- Eksen sırası: bildirilen GERÇEK hatanın regresyonu -------------------------

       <b>Phase 5B'de bu sözleşme DEĞİŞTİ ve nedeni ölçüldü.</b> Phase 4C,
       WMS 1.3.0 + EPSG:4326'nın pencereyi enlem-önce okuduğunu doğru tespit
       etmişti: boylam-önce gönderildiğinde katman sorgusu boşa düşüyor ve
       tamamen saydam bir PNG dönüyordu. Ancak enlem-önce gönderildiğinde
       GeoServer aynı pencereyi `wms_bbox` ortam değişkenine de enlem-önce
       koyar; ağırlıklı ısı haritası stili o değişkeni `vec:Heatmap`'in
       `outputBBOX` parametresi yapar ve süreç zarfın X'ini doğu-batı sanar.
       Üretilen raster DEVRİKTİR.

       Gerçek veriyle ölçüldü (Ankara, 7853 satır, kategori 12/13/33/35):
       pencere yalnızca BOYLAMDA kaydırıldığında leke DÜŞEY, yalnızca
       ENLEMDE kaydırıldığında YATAY hareket etti — devrikliğin doğrudan
       kanıtı. Geniş bir pencerede (28,36,38,42) leke gerçek verinin 143 km
       doğusuna / 118 km güneyine düştü.

       CRS:84 aynı WMS 1.3.0 isteğini kanonik boylam,enlem yapar ve leke her
       yakınlaştırma düzeyinde gerçek veriye oturdu.

       <b>Phase 4C KURALI KALDIRILMADI.</b> `WmsBboxFormatter` EPSG:4326 için
       enlem-önce yazmayı sürdürür ve `WmsBboxAxisOrderTests` bunu ayrıca
       sabitler; değişen yalnızca BU ucun hangi CRS kodunu istediğidir. */

    [Fact]
    public async Task The_reported_Ankara_window_reaches_GeoServer_in_canonical_lon_lat_under_CRS84()
    {
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        var request = Request(("eczane", 10), ("okullar", 90));

        // Hatanın bildirildiği pencerenin BİREBİR aynısı.
        request.Bbox = "32.742849147289974,39.84548205,32.950206181106694,40.00215400000004";

        var result = await ServiceWith(db, handler).RenderAsync(request, default);

        Assert.True(result.IsSuccess, result.Error);

        var form = handler.Form();

        Assert.Equal("1.3.0", form["VERSION"]);
        Assert.Equal("CRS:84", form["CRS"]);

        /* CRS:84 kanonik XY'dir: metin BOYLAMLA başlar ve uygulamanın her
           yerindeki sırayla aynıdır. */
        Assert.Equal(
            "32.742849147289974,39.845482050000001,32.950206181106694,40.00215400000004",
            form["BBOX"]);

        /* Devrik rasteri üreten eski metin bir daha ÜRETİLMEMELİDİR. */
        Assert.NotEqual(
            "39.845482050000001,32.742849147289974,40.00215400000004,32.950206181106694",
            form["BBOX"]);
    }

    [Fact]
    public async Task The_axis_ambiguous_EPSG4326_code_is_never_requested_for_the_heatmap()
    {
        /* Bu uç stili `wms_bbox`'a BAĞLI olduğu için eksen sırası belirsiz bir
           kod kullanamaz. Kodun geri gelmesi, devrik rasterin de geri gelmesi
           demektir ve bunu bir bayt karşılaştırması yakalayamaz. */
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        await ServiceWith(db, handler).RenderAsync(Request(("eczane", 50), ("okullar", 50)), default);

        Assert.NotEqual("EPSG:4326", handler.Form()["CRS"]);
    }

    [Fact]
    public async Task The_area_geometry_stays_longitude_latitude()
    {
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        var request = Request(("eczane", 10), ("okullar", 90));
        request.AreaWkts = ["POLYGON ((32.74 39.84, 32.95 39.84, 32.95 40.00, 32.74 40.00, 32.74 39.84))"];

        await ServiceWith(db, handler).RenderAsync(request, default);

        var cql = handler.Form()["CQL_FILTER"];

        /* Eksen takası YALNIZCA bbox'a aittir. Geometri her yerde X=boylam,
           Y=enlem kalır: burada takas edilseydi analiz alanı Ankara'dan
           çıkar, süzgeç hiçbir POI'ye rastlamazdı. */
        Assert.Contains("32.74 39.84", cql, StringComparison.Ordinal);
        Assert.DoesNotContain("39.84 32.74", cql, StringComparison.Ordinal);
    }

    /* --- İstek KARARLIdır ------------------------------------------------------------
       Aynı analiz her zaman aynı isteği üretir: örtü önbelleklenebilir ve
       üretilen istek sınanabilir kalır. */

    [Fact]
    public async Task The_same_request_always_produces_the_same_render_request()
    {
        await using var db = await NewDbAsync();

        var first = PngHandler();
        var second = PngHandler();

        await ServiceWith(db, first).RenderAsync(Request(("eczane", 70), ("okullar", 30)), default);
        await ServiceWith(db, second).RenderAsync(Request(("eczane", 70), ("okullar", 30)), default);

        Assert.Equal(first.Form()["CQL_FILTER"], second.Form()["CQL_FILTER"]);
        Assert.Equal(first.Form()["BBOX"], second.Form()["BBOX"]);
    }

    /* --- Alan ve kategori süzgeci (TEST §33) ---------------------------------------- */

    [Fact]
    public async Task The_filter_carries_the_selected_categories_and_the_validated_area()
    {
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        await ServiceWith(db, handler).RenderAsync(Request(("eczane", 50), ("okullar", 50)), default);

        var cql = handler.Form()["CQL_FILTER"];
        var selected = await IdsAsync(db, "eczane", "okullar");

        Assert.Contains($"category_id IN ({string.Join(',', selected.OrderBy(id => id))})", cql, StringComparison.Ordinal);
        Assert.Contains("INTERSECTS(\"coordinate\"", cql, StringComparison.Ordinal);
        Assert.Contains("POLYGON", cql, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Unselected_categories_are_excluded_from_the_filter()
    {
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        await ServiceWith(db, handler).RenderAsync(Request(("eczane", 50), ("okullar", 50)), default);

        var cql = handler.Form()["CQL_FILTER"];
        var excluded = await IdsAsync(db, "kafe", "restoran", "yeme-icme");
        var listed = CategoryIds(cql);

        // Seçilmemiş bir kategori süzgeçte görünseydi örtüde de çizilirdi.
        Assert.All(excluded, id => Assert.DoesNotContain(id, listed));
    }

    [Fact]
    public async Task A_multi_part_area_reaches_GeoServer_as_a_single_union()
    {
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        var request = Request(("eczane", 50), ("okullar", 50));
        request.AreaWkts = [Ankara, Istanbul];

        var result = await ServiceWith(db, handler).RenderAsync(request, default);

        Assert.True(result.IsSuccess, result.Error);

        /* Kopuk parçalar MULTIPOLYGON olur; hiçbir parça DÜŞMEZ. Yalnızca
           ilkini göndermek, kullanıcının seçtiğinden küçük bir alanı doğru
           cevap gibi çizmek olurdu. */
        var cql = handler.Form()["CQL_FILTER"];
        Assert.Contains("MULTIPOLYGON", cql, StringComparison.Ordinal);
        Assert.Contains("32 39", cql, StringComparison.Ordinal);
        Assert.Contains("28 40.5", cql, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_raw_client_WKT_text_is_never_forwarded_verbatim()
    {
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        var request = Request(("eczane", 50), ("okullar", 50));

        // Aynı poligon, farklı boşluk ve ondalık biçimiyle.
        request.AreaWkts = ["POLYGON((32.0 39.0,34.0 39.0,34.0 41.0,32.0 41.0,32.0 39.0))"];

        var result = await ServiceWith(db, handler).RenderAsync(request, default);

        Assert.True(result.IsSuccess, result.Error);

        /* Geometri doğrulanmış hedeften YENİDEN yazılır: istemcinin gönderdiği
           ham metin GeoServer'a olduğu gibi ulaşmaz. */
        Assert.DoesNotContain(request.AreaWkts[0], handler.Form()["CQL_FILTER"], StringComparison.Ordinal);
    }

    /* --- Güvenlik: enjeksiyon denemeleri (TEST §26) ---------------------------------- */

    [Theory]
    [InlineData("eczane' OR '1'='1")]
    [InlineData("eczane;DROP TABLE analysis_poi")]
    [InlineData("eczane) AND INTERSECTS(coordinate,POLYGON((0 0,1 0,1 1,0 1,0 0))")]
    [InlineData("eczane&STYLES=poi_all")]
    [InlineData("../../etc/passwd")]
    [InlineData("<ogc:Function name=\"env\">")]
    [InlineData("eczane UNION SELECT 1")]
    public async Task A_hostile_category_slug_is_rejected_before_GeoServer(string slug)
    {
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        var result = await ServiceWith(db, handler).RenderAsync(Request((slug, 50), ("okullar", 50)), default);

        /* Kanoniklik denetimi ya da "bilinmeyen kategori" — hangisi önce
           çalışırsa. ASIL olan, isteğin GeoServer'a HİÇ ulaşmamasıdır. */
        Assert.False(result.IsSuccess);
        Assert.Equal(0, handler.CallCount);
    }

    [Theory]
    [InlineData("1,2,3,4 AND inserted_user_id=999")]
    [InlineData("not-a-number,2,3,4")]
    [InlineData("1,2,3")]
    [InlineData("")]
    [InlineData("32.5,-91,33.5,-89")]
    [InlineData("32.5,89,33.5,91")]
    [InlineData("-181,39.5,-179,40.5")]
    [InlineData("179,39.5,181,40.5")]
    public async Task A_hostile_bbox_is_rejected_before_GeoServer(string bbox)
    {
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        var request = Request(("eczane", 50), ("okullar", 50));
        request.Bbox = bbox;

        var result = await ServiceWith(db, handler).RenderAsync(request, default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
        Assert.Equal(0, handler.CallCount);
    }

    [Theory]
    [InlineData("not a geometry")]
    [InlineData("POINT (32 39)")]
    [InlineData("LINESTRING (32 39, 34 41)")]
    [InlineData("POLYGON ((320 390, 340 390, 340 410, 320 410, 320 390))")]
    public async Task A_hostile_area_is_rejected_before_GeoServer(string wkt)
    {
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        var request = Request(("eczane", 50), ("okullar", 50));
        request.AreaWkts = [wkt];

        var result = await ServiceWith(db, handler).RenderAsync(request, default);

        Assert.False(result.IsSuccess);
        Assert.Equal(0, handler.CallCount);
    }

    [Fact]
    public async Task Text_appended_to_a_valid_area_never_reaches_the_filter()
    {
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        var request = Request(("eczane", 50), ("okullar", 50));
        request.AreaWkts = [$"{Ankara} OR 1=1 AND inserted_user_id=999"];

        var result = await ServiceWith(db, handler).RenderAsync(request, default);

        /* Ayrıştırıcı geçerli poligonu okur ve arkasına eklenen metni DÜŞÜRÜR;
           istek reddedilmeyebilir ama eklenen metin de hiçbir yere ulaşmaz.
           Asıl koruma budur: süzgeç istemcinin metninden değil, YENİDEN
           YAZILMIŞ geometriden kurulur. */
        if (result.IsSuccess)
        {
            var cql = handler.Form()["CQL_FILTER"];

            Assert.DoesNotContain("OR 1=1", cql, StringComparison.Ordinal);
            Assert.DoesNotContain("inserted_user_id", cql, StringComparison.Ordinal);
        }
        else
        {
            Assert.Equal(0, handler.CallCount);
        }
    }

    /* --- Doğrulama (TEST §35) -------------------------------------------------------- */

    [Theory]
    [InlineData(99)]
    [InlineData(101)]
    public async Task Weights_that_do_not_total_one_hundred_are_rejected(int other)
    {
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        var result = await ServiceWith(db, handler).RenderAsync(Request(("eczane", 50), ("okullar", other - 50)), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(0, handler.CallCount);
    }

    [Fact]
    public async Task A_single_criterion_is_rejected()
    {
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        var result = await ServiceWith(db, handler).RenderAsync(Request(("eczane", 100)), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(0, handler.CallCount);
    }

    [Fact]
    public async Task Six_criteria_are_rejected()
    {
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        var result = await ServiceWith(db, handler).RenderAsync(
            Request(
                ("eczane", 20), ("okullar", 20), ("kafe", 20),
                ("restoran", 20), ("banka-ve-atm", 10), ("dini-tesisler", 10)),
            default);

        Assert.False(result.IsSuccess);
        Assert.Equal(0, handler.CallCount);
    }

    [Fact]
    public async Task A_parent_together_with_its_descendant_is_rejected()
    {
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        /* Torun zaten atanın kapsamındadır; ikisini birlikte ağırlıklandırmak
           aynı kaydı iki kez saymak olurdu. Görüntü tarafında bu, bir kategori
           kimliğinin İKİ yuvaya birden düşmesi demekti. */
        var result = await ServiceWith(db, handler)
            .RenderAsync(Request(("yeme-icme", 60), ("kafe", 40)), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(0, handler.CallCount);
    }

    [Fact]
    public async Task An_unknown_category_is_rejected_and_never_created()
    {
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        var before = await db.PoiCategories.CountAsync();

        var result = await ServiceWith(db, handler).RenderAsync(Request(("kutuphaneler", 50), ("okullar", 50)), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(0, handler.CallCount);
        Assert.Equal(before, await db.PoiCategories.CountAsync());
    }

    [Theory]
    [InlineData(63, 320)]
    [InlineData(2049, 320)]
    [InlineData(512, 63)]
    [InlineData(512, 2049)]
    public async Task Image_dimensions_outside_the_shared_contract_are_rejected(int width, int height)
    {
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        var request = Request(("eczane", 50), ("okullar", 50));
        request.Width = width;
        request.Height = height;

        var result = await ServiceWith(db, handler).RenderAsync(request, default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
        Assert.Equal(0, handler.CallCount);
    }

    [Theory]
    [InlineData(0.0)]
    [InlineData(0.5)]
    [InlineData(3.5)]
    [InlineData(double.NaN)]
    public async Task An_invalid_pixel_ratio_is_rejected(double pixelRatio)
    {
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        var request = Request(("eczane", 50), ("okullar", 50));
        request.PixelRatio = pixelRatio;

        var result = await ServiceWith(db, handler).RenderAsync(request, default);

        Assert.False(result.IsSuccess);
        Assert.Equal(0, handler.CallCount);
    }

    /* --- HiDPI --------------------------------------------------------------------- */

    [Fact]
    public async Task The_pixel_ratio_does_not_change_the_requested_image_size()
    {
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        var request = Request(("eczane", 50), ("okullar", 50));
        request.PixelRatio = 2.0;

        await ServiceWith(db, handler).RenderAsync(request, default);

        // Oran boyutları ÇARPMAZ: piksel bütçesi sessizce dörde katlanmaz.
        Assert.Equal("512", handler.Form()["WIDTH"]);
        Assert.Equal("320", handler.Form()["HEIGHT"]);
    }

    /* --- Yanıt güvenliği ------------------------------------------------------------ */

    [Fact]
    public async Task A_GeoServer_exception_report_is_never_forwarded_as_an_image()
    {
        await using var db = await NewDbAsync();

        var xml = Encoding.UTF8.GetBytes("<ServiceExceptionReport>boom</ServiceExceptionReport>");
        var handler = new RecordingHandler(_ => Response(xml, "text/xml"));

        var result = await ServiceWith(db, handler).RenderAsync(Request(("eczane", 50), ("okullar", 50)), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Upstream, result.ErrorKind);
        Assert.DoesNotContain("ServiceException", result.Error!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Content_claiming_to_be_PNG_without_the_signature_is_rejected()
    {
        await using var db = await NewDbAsync();

        var handler = new RecordingHandler(_ => Response(Encoding.UTF8.GetBytes("<html/>"), "image/png"));

        var result = await ServiceWith(db, handler).RenderAsync(Request(("eczane", 50), ("okullar", 50)), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Upstream, result.ErrorKind);
    }

    [Fact]
    public async Task An_upstream_failure_status_becomes_a_gateway_error()
    {
        await using var db = await NewDbAsync();

        var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.InternalServerError));

        var result = await ServiceWith(db, handler).RenderAsync(Request(("eczane", 50), ("okullar", 50)), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Upstream, result.ErrorKind);
    }

    [Fact]
    public async Task An_upstream_timeout_is_reported_as_a_timeout()
    {
        await using var db = await NewDbAsync();

        var handler = new RecordingHandler((_, _) =>
            Task.FromException<HttpResponseMessage>(new TaskCanceledException()));

        var result = await ServiceWith(db, handler).RenderAsync(Request(("eczane", 50), ("okullar", 50)), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Timeout, result.ErrorKind);
    }

    [Fact]
    public async Task Caller_cancellation_is_not_disguised_as_a_timeout()
    {
        await using var db = await NewDbAsync();

        using var cancellation = new CancellationTokenSource();
        await cancellation.CancelAsync();

        var handler = new RecordingHandler((_, token) =>
            Task.FromException<HttpResponseMessage>(new TaskCanceledException(null, null, token)));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            ServiceWith(db, handler).RenderAsync(Request(("eczane", 50), ("okullar", 50)), cancellation.Token));
    }

    [Fact]
    public async Task An_empty_result_is_a_successful_transparent_image()
    {
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        /* Seçilen alanda hiç eşleşen POI olmaması BİR CEVAPTIR. GeoServer bu
           durumda geçerli ama saydam bir PNG döndürür (çalışan sunucuda
           doğrulandı) ve bu 200 ile iletilir — 404 ya da 500 DEĞİL. */
        var request = Request(("eczane", 50), ("okullar", 50));
        request.AreaWkts = ["POLYGON ((0.10 0.10, 0.20 0.10, 0.20 0.20, 0.10 0.20, 0.10 0.10))"];

        var result = await ServiceWith(db, handler).RenderAsync(request, default);

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal(1, handler.CallCount);
    }

    /* --- Yardımcılar ---------------------------------------------------------------- */

    private static LocationAnalysisImageRequest Request(params (string Slug, int Weight)[] criteria) =>
        new()
        {
            AreaWkts = [Ankara],
            Criteria = [.. criteria.Select(item => new LocationAnalysisCriterionRequest
            {
                CategorySlug = item.Slug,
                Weight = item.Weight
            })],
            /* Görüntü penceresi artık EPSG:4326'dır — analiz alanıyla aynı CRS.
               Eski EPSG:3857 penceresi (-1000,-2000,3000,4000) bu uçta ARTIK
               anlamlı değildir: -2000 geçerli bir enlem değildir. */
            Bbox = "32.5,39.5,33.5,40.5",
            Width = 512,
            Height = 320
        };

    private static async Task<IReadOnlyList<int>> IdsAsync(AppDbContext db, params string[] slugs) =>
        await db.PoiCategories
            .AsNoTracking()
            .Where(category => slugs.Contains(category.Slug))
            .Select(category => category.Id)
            .ToListAsync();

    private static IReadOnlyList<int> CategoryIds(string cql)
    {
        var start = cql.IndexOf('(', StringComparison.Ordinal) + 1;
        var end = cql.IndexOf(')', start);

        return [.. cql[start..end].Split(',').Select(value => int.Parse(value, CultureInfo.InvariantCulture))];
    }

    /* --- Nokta örtüsü ---------------------------------------------------------------

       Kullanıcı analize giren POI'leri GÖRMEK istiyor. Örtü ile ısı haritası
       aynı katmanı iki farklı stille çizer; alan, ölçütler ve kategori
       kapanışı TEK bir yoldan geçer. Buradaki testlerin işi, o tekliğin
       korunduğunu sabitlemektir: iki uç ayrışmaya başlarsa kullanıcı, analize
       girmeyen noktaları analizin sonucu sanardı. */

    [Fact]
    public async Task The_point_overlay_draws_the_same_layer_with_the_point_style()
    {
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        var result = await ServiceWith(db, handler).RenderAsync(
            Request(("eczane", 50), ("okullar", 50)),
            default,
            LocationAnalysisImageKind.Points);

        Assert.True(result.IsSuccess, result.Error);

        var form = handler.Form();

        // AYNI katman: ikinci bir SQL View kaydedilmez.
        Assert.Equal("geoworkspace:analysis_poi_read", form["LAYERS"]);
        Assert.Equal("analysis_poi_points", form["STYLES"]);
        Assert.NotEqual("analysis_weighted_heatmap", form["STYLES"]);

        // Pencere sözleşmesi de aynıdır.
        Assert.Equal("1.3.0", form["VERSION"]);
        Assert.Equal("CRS:84", form["CRS"]);
        Assert.Equal("image/png", form["FORMAT"]);
        Assert.Equal("true", form["TRANSPARENT"]);
    }

    [Fact]
    public async Task The_point_overlay_never_sends_client_controllable_GeoServer_parameters()
    {
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        await ServiceWith(db, handler).RenderAsync(
            Request(("eczane", 50), ("okullar", 50)),
            default,
            LocationAnalysisImageKind.Points);

        Assert.DoesNotContain("SLD_BODY", handler.Form().Keys);
        Assert.DoesNotContain("SLD", handler.Form().Keys);
        Assert.DoesNotContain("VIEWPARAMS", handler.Form().Keys);
        Assert.DoesNotContain("tbl_point", handler.Form()["LAYERS"], StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_point_overlay_still_validates_the_analysis_and_the_window()
    {
        /* Doğrulama İKİNCİ KEZ YAZILMAZ; örtü de aynı kapıdan geçer. */
        await using var db = await NewDbAsync();
        var handler = PngHandler();

        var badWeights = Request(("eczane", 10), ("okullar", 10));
        var weightResult = await ServiceWith(db, handler).RenderAsync(
            badWeights, default, LocationAnalysisImageKind.Points);
        Assert.False(weightResult.IsSuccess);

        var badWindow = Request(("eczane", 50), ("okullar", 50));
        badWindow.Bbox = "3600000,4800000,3700000,4900000"; // Web Mercator metreleri
        var windowResult = await ServiceWith(db, handler).RenderAsync(
            badWindow, default, LocationAnalysisImageKind.Points);
        Assert.False(windowResult.IsSuccess);
    }

    /* --- Ağırlık gerçekten etkili mi -----------------------------------------------

       <b>Bildirilen sorun buydu.</b> Yuvadaki değer POI BAŞINA ağırlıktır ve
       `vec:Heatmap` onları toplar; bir ölçütün yüzeye katkısı `sayı × ağırlık`
       olur. Kategori sayıları büyüklük mertebesinde ayrıştığında kullanıcının
       verdiği yüzde etkisiz kalır — gerçek veride Alışveriş 345, Demiryolu 52
       POI taşır ve 80/20 ile 20/80 arasında kalabalık kategori HER İKİ hâlde
       de baskın çıkıyordu. */

    /* --- Tek ölçütlü görünüm ------------------------------------------------------- */

    [Fact]
    public async Task A_focused_render_draws_only_that_criterion()
    {
        /* Toplanan bir yüzeyde kategori kimliği yapısal olarak kaybolur;
           "burası neden sıcak" sorusunu ancak tek ölçütlü görünüm yanıtlar. */
        await using var db = await NewDbAsync();

        var request = Request(("saglik-kurumlari", 50), ("okullar", 50));
        request.CriterionSlug = "okullar";

        var handler = PngHandler();
        var result = await ServiceWith(db, handler).RenderAsync(request, default);

        Assert.True(result.IsSuccess, result.Error);

        var ids = CategoryIds(handler.Form()["CQL_FILTER"]);
        var okullar = await IdsAsync(db, "okullar");

        Assert.Equal(okullar.OrderBy(id => id), ids.OrderBy(id => id));

        // Alan yüklemi DEĞİŞMEZ: aynı analiz, dar bir kesit.
        Assert.Contains("INTERSECTS", handler.Form()["CQL_FILTER"], StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_focused_render_still_covers_the_criterion_subtree()
    {
        await using var db = await NewDbAsync();

        var request = Request(("saglik-kurumlari", 50), ("okullar", 50));
        request.CriterionSlug = "saglik-kurumlari";

        var handler = PngHandler();
        await ServiceWith(db, handler).RenderAsync(request, default);

        var ids = CategoryIds(handler.Form()["CQL_FILTER"]);
        var closure = await IdsAsync(db, "saglik-kurumlari", "eczane");

        // Üst kategori seçiliyse torunu da çizilir.
        Assert.Equal(closure.OrderBy(id => id), ids.OrderBy(id => id));
    }

    [Fact]
    public async Task A_criterion_slug_outside_the_request_is_refused()
    {
        /* Bu alan analizin KAPSAMINI genişletmek için kullanılamaz. */
        await using var db = await NewDbAsync();

        var request = Request(("eczane", 50), ("okullar", 50));
        request.CriterionSlug = "kafe";

        var result = await ServiceWith(db, PngHandler()).RenderAsync(request, default);

        Assert.False(result.IsSuccess);
    }

    private static GeoServerLocationAnalysisImageService ServiceWith(AppDbContext db, RecordingHandler handler) =>
        new(
            new HttpClient(handler),
            Options(),
            db,
            AreaGuards.Unrestricted,
            NullLogger<GeoServerLocationAnalysisImageService>.Instance);

    private static GeoServerOptions Options() => new()
    {
        BaseUrl = "http://localhost:8080/geoserver",
        Workspace = "geoworkspace",
        PointLayer = "tbl_point_read",
        LineLayer = "tbl_line_read",
        PolygonLayer = "tbl_polygon_read",
        HeatmapLayer = "tbl_point_heatmap",
        HeatmapStyle = "point_density_heatmap",
        PointPresentationStyle = "drawing_point_presentation",
        LinePresentationStyle = "drawing_line_presentation",
        PolygonPresentationStyle = "drawing_polygon_presentation",
        PoiLayer = "poi_read",
        PoiStyle = "poi_all",
        AnalysisPoiLayer = "analysis_poi_read",
        AnalysisPoiPointStyle = "analysis_poi_points",
        AnalysisHeatmapRadiusMeters = 1500
    };

    /// <summary>
    /// Hiyerarşik fixture: <c>yeme-icme</c> ve <c>saglik-kurumlari</c> birer
    /// alt ağaç köküdür.
    /// </summary>
    /// <summary>Hedef alanın İÇİNDE, kategori başına N adet POI üretir.</summary>
    /// <remarks>
    /// Ağırlıklar artık ölçüt başına POI SAYISINA normalleştirildiği için bu
    /// dosyanın da gerçek satırlara ihtiyacı var: hiç POI olmayan bir ölçüt
    /// yüzeye katkı vermez ve yuvası sıfır olur.
    /// </remarks>
    private static async Task SeedAsync(AppDbContext db, params (string Slug, int Count)[] rows)
    {
        var factory = new GeometryFactory(new PrecisionModel(), 4326);
        var serial = 0;

        foreach (var (slug, count) in rows)
        {
            var category = await db.PoiCategories.SingleAsync(item => item.Slug == slug);

            for (var index = 0; index < count; index++)
            {
                db.AnalysisPois.Add(new AnalysisPoi
                {
                    Name = $"{slug}-{index}",
                    CategoryId = category.Id,
                    // İstek gövdesindeki hedef alanın içinde kalır.
                    Coordinate = factory.CreatePoint(new Coordinate(
                        32.75 + (serial % 10) * 0.01,
                        39.86 + (serial % 10) * 0.01)),
                    Source = "test",
                    ExternalId = $"node/{++serial}",
                    ImportedAt = DateTime.UtcNow
                });
            }
        }

        await db.SaveChangesAsync();
    }

    private static async Task<AppDbContext> NewDbAsync()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"location-analysis-image-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

        var db = new AppDbContext(options);

        var food = new PoiCategory { Name = "Yeme İçme", Slug = "yeme-icme" };
        var health = new PoiCategory { Name = "Sağlık Kurumları", Slug = "saglik-kurumlari" };

        db.PoiCategories.AddRange(food, health);
        await db.SaveChangesAsync();

        db.PoiCategories.AddRange(
            new PoiCategory { Name = "Kafe", Slug = "kafe", ParentId = food.Id },
            new PoiCategory { Name = "Restoran", Slug = "restoran", ParentId = food.Id },
            new PoiCategory { Name = "Eczane", Slug = "eczane", ParentId = health.Id },
            new PoiCategory { Name = "Okullar", Slug = "okullar" },
            new PoiCategory { Name = "Banka ve ATM", Slug = "banka-ve-atm" },
            new PoiCategory { Name = "Dini Tesisler", Slug = "dini-tesisler" });

        await db.SaveChangesAsync();

        return db;
    }

    private static RecordingHandler PngHandler() => new(_ => Response(Png, "image/png"));

    private static HttpResponseMessage Response(byte[] content, string mediaType)
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(content) };
        response.Content.Headers.ContentType = new MediaTypeHeaderValue(mediaType);

        return response;
    }

    private sealed class RecordingHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> _response;

        public RecordingHandler(Func<HttpRequestMessage, HttpResponseMessage> response)
            : this((request, _) => Task.FromResult(response(request)))
        {
        }

        public RecordingHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> response)
        {
            _response = response;
        }

        public int CallCount { get; private set; }

        public HttpMethod? Method { get; private set; }

        public Uri? RequestUri { get; private set; }

        public string? ContentType { get; private set; }

        public string Body { get; private set; } = string.Empty;

        public IReadOnlyDictionary<string, string> Form() => Body
            .Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => part.Split('=', 2))
            .ToDictionary(
                part => Decode(part[0]),
                part => Decode(part.Length == 2 ? part[1] : string.Empty),
                StringComparer.Ordinal);

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            CallCount++;
            Method = request.Method;
            RequestUri = request.RequestUri;
            ContentType = request.Content?.Headers.ContentType?.MediaType;
            Body = request.Content is null
                ? string.Empty
                : await request.Content.ReadAsStringAsync(cancellationToken);

            return await _response(request, cancellationToken);
        }

        private static string Decode(string value) => Uri.UnescapeDataString(value.Replace('+', ' '));
    }
}
