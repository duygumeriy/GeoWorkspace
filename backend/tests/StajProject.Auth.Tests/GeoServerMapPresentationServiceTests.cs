using System.Net;
using System.Net.Http.Headers;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Application.Rendering;
using StajProject.Domain.Common;
using StajProject.Infrastructure.GeoServer;

namespace StajProject.Auth.Tests;

/// <summary>
/// Phase 5 — kalıcı çizimlerin WMS genel gösterimi. Sözleşmenin tamamı
/// backend'e aittir: katman, style, workspace, CRS ve sahiplik filtresi.
/// </summary>
public class GeoServerMapPresentationServiceTests
{
    private static readonly byte[] Png = [137, 80, 78, 71, 13, 10, 26, 10, 9, 9];

    [Theory]
    [InlineData(DrawingKind.Point, "geoworkspace:tbl_point_read", "drawing_point_presentation")]
    [InlineData(DrawingKind.Line, "geoworkspace:tbl_line_read", "drawing_line_presentation")]
    [InlineData(DrawingKind.Polygon, "geoworkspace:tbl_polygon_read", "drawing_polygon_presentation")]
    public async Task Every_kind_uses_its_own_server_owned_layer_and_style(
        DrawingKind kind,
        string expectedLayer,
        string expectedStyle)
    {
        var handler = PngHandler();

        var result = await ServiceWith(handler, userId: 512).GetPresentationAsync(kind, ValidRequest(), default);

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal(Png, result.Value!.Content);

        var form = handler.Form();
        Assert.Equal(HttpMethod.Post, handler.Method);
        Assert.Equal("http://localhost:8080/geoserver/wms", handler.RequestUri!.ToString());
        Assert.Equal("application/x-www-form-urlencoded", handler.ContentType);
        Assert.Equal("WMS", form["SERVICE"]);
        Assert.Equal("1.3.0", form["VERSION"]);
        Assert.Equal("GetMap", form["REQUEST"]);
        Assert.Equal(expectedLayer, form["LAYERS"]);
        Assert.Equal(expectedStyle, form["STYLES"]);
        Assert.Equal("EPSG:3857", form["CRS"]);
        Assert.Equal("image/png", form["FORMAT"]);
        Assert.Equal("true", form["TRANSPARENT"]);
        Assert.Equal("512", form["WIDTH"]);
        Assert.Equal("320", form["HEIGHT"]);
    }

    /// <summary>
    /// Tek istek = tek katman. Çok katmanlı bir istekte tek CQL'in katmanlara
    /// nasıl dağıtıldığı sunucu sürümüne bağlıdır; bu servis o belirsizliği
    /// yapısal olarak taşımaz.
    /// </summary>
    [Fact]
    public async Task Request_never_bundles_more_than_one_layer()
    {
        var handler = PngHandler();

        foreach (var kind in new[] { DrawingKind.Point, DrawingKind.Line, DrawingKind.Polygon })
        {
            await ServiceWith(handler).GetPresentationAsync(kind, ValidRequest(), default);

            var form = handler.Form();
            Assert.DoesNotContain(",", form["LAYERS"], StringComparison.Ordinal);
            Assert.DoesNotContain(",", form["STYLES"], StringComparison.Ordinal);
            Assert.DoesNotContain(";", form["CQL_FILTER"], StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task Owner_and_status_filter_matches_the_normal_WFS_read_semantics()
    {
        var handler = PngHandler();

        var result = await ServiceWith(handler, userId: 907)
            .GetPresentationAsync(DrawingKind.Polygon, ValidRequest(), default);

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal(
            "inserted_user_id=907 AND is_deleted=false AND is_active=true",
            handler.Form()["CQL_FILTER"]);
    }

    /// <summary>
    /// Normal okuma coğrafi kapsamla DARALTILMAZ — bu, mevcut WFS okumasının
    /// anlamıdır ve yalnızca ısı haritası analizinde farklıdır.
    /// </summary>
    [Fact]
    public async Task Normal_read_is_not_geographically_narrowed()
    {
        var handler = PngHandler();

        await ServiceWith(handler).GetPresentationAsync(DrawingKind.Point, ValidRequest(), default);

        var cql = handler.Form()["CQL_FILTER"];
        Assert.DoesNotContain("INTERSECTS", cql, StringComparison.Ordinal);
        Assert.DoesNotContain("POLYGON", cql, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData("")]
    [InlineData("1,2,3")]
    [InlineData("1,2,3,4,5")]
    [InlineData("NaN,2,3,4")]
    [InlineData("not-a-number,2,3,4")]
    [InlineData("4,2,3,5")]
    [InlineData("1,5,3,4")]
    [InlineData("-20037509,0,1,2")]
    [InlineData("0,0,20037509,2")]
    [InlineData("1,2,3,4 AND inserted_user_id=999")]
    public async Task Invalid_bbox_is_rejected_before_GeoServer(string bbox)
    {
        var handler = PngHandler();
        var request = ValidRequest();
        request.Bbox = bbox;

        var result = await ServiceWith(handler).GetPresentationAsync(DrawingKind.Line, request, default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
        Assert.Equal(0, handler.CallCount);
    }

    [Theory]
    [InlineData(0, 512)]
    [InlineData(63, 512)]
    [InlineData(2049, 512)]
    [InlineData(512, 0)]
    [InlineData(512, 63)]
    [InlineData(512, 2049)]
    [InlineData(int.MaxValue, int.MaxValue)]
    public async Task Invalid_dimensions_are_rejected_before_GeoServer(int width, int height)
    {
        var handler = PngHandler();
        var request = ValidRequest();
        request.Width = width;
        request.Height = height;

        var result = await ServiceWith(handler).GetPresentationAsync(DrawingKind.Point, request, default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
        Assert.Equal(0, handler.CallCount);
    }

    [Fact]
    public async Task Missing_authenticated_identity_fails_closed_without_GeoServer_call()
    {
        var handler = PngHandler();
        var currentUser = Substitute.For<ICurrentUserService>();
        currentUser.IsAuthenticated.Returns(false);
        currentUser.UserId.Returns((int?)null);

        var result = await ServiceWith(handler, currentUser)
            .GetPresentationAsync(DrawingKind.Point, ValidRequest(), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
        Assert.Equal(0, handler.CallCount);
    }

    [Fact]
    public async Task Non_png_content_type_is_rejected_even_on_HTTP_200()
    {
        var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("<ServiceException/>")
            {
                Headers = { ContentType = new MediaTypeHeaderValue("application/xml") }
            }
        });

        var result = await ServiceWith(handler).GetPresentationAsync(DrawingKind.Point, ValidRequest(), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Upstream, result.ErrorKind);
    }

    [Fact]
    public async Task Payload_without_PNG_signature_is_rejected()
    {
        var handler = new RecordingHandler(_ => Response([1, 2, 3, 4], "image/png"));

        var result = await ServiceWith(handler).GetPresentationAsync(DrawingKind.Line, ValidRequest(), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Upstream, result.ErrorKind);
    }

    [Fact]
    public async Task GeoServer_HTTP_failure_is_observable_as_upstream_failure()
    {
        var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));

        var result = await ServiceWith(handler).GetPresentationAsync(DrawingKind.Polygon, ValidRequest(), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Upstream, result.ErrorKind);
    }

    [Fact]
    public async Task GeoServer_timeout_is_reported_separately()
    {
        var handler = new RecordingHandler(_ => throw new TaskCanceledException("timeout"));

        var result = await ServiceWith(handler).GetPresentationAsync(DrawingKind.Point, ValidRequest(), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Timeout, result.ErrorKind);
    }

    [Fact]
    public async Task Caller_cancellation_is_propagated()
    {
        var handler = new RecordingHandler(async (_, token) =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, token);
            return Response(Png, "image/png");
        });
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            ServiceWith(handler).GetPresentationAsync(DrawingKind.Point, ValidRequest(), cancellation.Token));
    }

    [Fact]
    public void Public_request_contract_contains_no_security_or_GeoServer_authority_fields()
    {
        var properties = typeof(MapPresentationRequest).GetProperties().Select(property => property.Name).ToArray();

        /* Faz 5C `PixelRatio`'yu EKLER. Yüzey hâlâ tam olarak sayılabilir ve
           eklenen şey bir çizim yetkisi değil, bir SAYIDIR: görüntünün CSS
           pikseline göre yoğunluğu. Aşağıdaki yüklemler onu da kapsar. */
        Assert.Equal(["Bbox", "Width", "Height", "PixelRatio"], properties);
        Assert.DoesNotContain(properties, name =>
            name.Contains("User", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Owner", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Cql", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Layer", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Style", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Workspace", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Kind", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Options_reject_missing_or_unsafe_presentation_styles_and_timeout()
    {
        var missing = Options();
        missing.LinePresentationStyle = string.Empty;
        Assert.Throws<InvalidOperationException>(missing.Validate);

        var unsafeName = Options();
        unsafeName.PolygonPresentationStyle = "safe&CQL_FILTER=INCLUDE";
        Assert.Throws<InvalidOperationException>(unsafeName.Validate);

        var timeout = Options();
        timeout.PresentationTimeoutSeconds = 0;
        Assert.Throws<InvalidOperationException>(timeout.Validate);

        Options().Validate();
    }

    private static MapPresentationRequest ValidRequest(double pixelRatio = 1.0) => new()
    {
        Bbox = "-1000,-2000,3000,4000",
        Width = 512,
        Height = 320,
        PixelRatio = pixelRatio
    };

    /* --- POI sunumu (Faz 4) ---------------------------------------------------- */

    /// <summary>
    /// Katman ve style SUNUCUNUNDUR: <c>poi_read</c> + <c>poi_all</c>.
    /// </summary>
    /// <remarks>
    /// 44 kategori stili ödev şartının karşılığıdır ve burada KULLANILMAZ —
    /// tek bir WMS isteği 44 style adı taşıyamaz.
    /// </remarks>
    [Fact]
    public async Task Poi_presentation_uses_the_server_owned_layer_and_composite_style()
    {
        var handler = PngHandler();

        var result = await ServiceWith(handler).GetPoiPresentationAsync(ValidRequest(), default);

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal(Png, result.Value!.Content);

        var form = handler.Form();
        Assert.Equal(HttpMethod.Post, handler.Method);
        Assert.Equal("http://localhost:8080/geoserver/wms", handler.RequestUri!.ToString());
        Assert.Equal("WMS", form["SERVICE"]);
        Assert.Equal("1.3.0", form["VERSION"]);
        Assert.Equal("GetMap", form["REQUEST"]);
        Assert.Equal("geoworkspace:poi_read", form["LAYERS"]);
        Assert.Equal("poi_all", form["STYLES"]);
        Assert.Equal("EPSG:3857", form["CRS"]);
        Assert.Equal("image/png", form["FORMAT"]);
        Assert.Equal("true", form["TRANSPARENT"]);
        Assert.Equal("512", form["WIDTH"]);
        Assert.Equal("320", form["HEIGHT"]);
    }

    /// <summary>
    /// POI sunumu sahiplik filtresi TAŞIMAZ.
    /// </summary>
    /// <remarks>
    /// Çizim sunumu kişinin KENDİ kayıtlarını gösterir; POI ise
    /// <c>poi.view</c> taşıyan herkese açık ORTAK envanterdir ve
    /// <c>PoiService.GetMapPoisAsync</c> de sahiplik yüklemi uygulamaz. Buraya
    /// bir filtre eklemek, REST'te görünen bir POI'nin haritada görünmemesi
    /// demek olurdu. Silinmiş/pasif eleme zaten <c>poi_read</c> SQL View'ının
    /// içindedir.
    /// </remarks>
    [Fact]
    public async Task Poi_presentation_sends_no_cql_filter()
    {
        var handler = PngHandler();

        await ServiceWith(handler, userId: 7).GetPoiPresentationAsync(ValidRequest(), default);

        Assert.DoesNotContain("CQL_FILTER", handler.Form().Keys);
        Assert.DoesNotContain("CQL_FILTER", handler.Body, StringComparison.OrdinalIgnoreCase);
    }

    /* --- Piksel yoğunluğu (Faz 5C) ---------------------------------------------

       WMS görüntüsü coğrafi bir kapsama raptedilip CSS boyutuna küçültülür ve
       SLD'deki her ÖLÇÜ pikseldir. Yoğunluk bildirilmezse 30 piksellik bir
       rozet Retina'da 15 CSS pikseli, 12 piksellik etiket 6 CSS pikseli
       görünür. Düzeltme TEK bir düğmededir: çizim DPI'ı. */

    [Fact]
    public async Task A_ratio_of_one_sends_no_format_options_at_all()
    {
        /* Mevcut davranış BİREBİR korunur: yoğunluk bildirmeyen bir istemcinin
           isteği bugünküyle aynı kalmalıdır. */
        var handler = PngHandler();

        await ServiceWith(handler).GetPoiPresentationAsync(ValidRequest(), default);

        Assert.DoesNotContain("FORMAT_OPTIONS", handler.Form().Keys);
        Assert.DoesNotContain("dpi", handler.Body, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(1.5, 136)]
    [InlineData(2.0, 181)]
    [InlineData(3.0, 272)]
    public async Task A_higher_ratio_sends_a_renderer_dpi_derived_from_the_ogc_base(
        double ratio,
        int expectedDpi)
    {
        var handler = PngHandler();

        await ServiceWith(handler).GetPoiPresentationAsync(ValidRequest(ratio), default);

        var form = handler.Form();

        Assert.Equal($"dpi:{expectedDpi}", form["FORMAT_OPTIONS"]);

        // DPI taban değerden TÜRETİLİR, elle seçilmez.
        Assert.Equal(expectedDpi, (int)Math.Round(WmsRenderContract.BaseDpi * ratio, MidpointRounding.AwayFromZero));
    }

    [Fact]
    public async Task The_ratio_never_multiplies_the_requested_dimensions()
    {
        /* Boyutu bir de burada çarpmak, piksel bütçesini sessizce dört katına
           çıkarırdı. Oran yalnızca DPI'ı belirler. */
        var handler = PngHandler();

        await ServiceWith(handler).GetPoiPresentationAsync(ValidRequest(3.0), default);

        var form = handler.Form();
        Assert.Equal("512", form["WIDTH"]);
        Assert.Equal("320", form["HEIGHT"]);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(0.5)]
    [InlineData(-2)]
    [InlineData(3.5)]
    [InlineData(1000)]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    public async Task An_out_of_range_ratio_is_rejected_and_never_reaches_geoserver(double ratio)
    {
        var handler = PngHandler();

        var result = await ServiceWith(handler).GetPoiPresentationAsync(ValidRequest(ratio), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
        Assert.Null(handler.RequestUri);
    }

    [Fact]
    public void The_drawing_presentation_contract_is_unchanged_by_the_ratio()
    {
        /* Çizim yolunda yoğunluk OKUNMAZ: geometri coğrafidir ve ölçekten
           bağımsız aynı alanı kaplar. Varsayılan doğrulama hiçbir DPI
           üretmez. */
        var render = WmsRenderContract.Validate("-1000,-2000,3000,4000", 512, 320);

        Assert.True(render.IsSuccess);
        Assert.Equal(1.0, render.Value!.PixelRatio);
        Assert.Null(render.Value.RendererDpi);
    }

    [Fact]
    public async Task The_client_can_never_supply_a_render_parameter_of_its_own()
    {
        /* Tarayıcının gönderebildiği TEK ek şey bir sayıdır. Sözlük her istekte
           sıfırdan kurulur, dolayısıyla tanınmayan hiçbir anahtar GeoServer'a
           ulaşamaz. */
        var handler = PngHandler();

        await ServiceWith(handler).GetPoiPresentationAsync(ValidRequest(2.0), default);

        var form = handler.Form();

        Assert.Equal(
            ["SERVICE", "VERSION", "REQUEST", "LAYERS", "STYLES", "CRS", "BBOX",
             "WIDTH", "HEIGHT", "FORMAT", "TRANSPARENT", "FORMAT_OPTIONS"],
            form.Keys);
    }

    /// <summary>
    /// Tek istek = tek katman; 44 kategori stili isteğe sızmaz.
    /// </summary>
    [Fact]
    public async Task Poi_request_never_bundles_more_than_one_layer_or_style()
    {
        var handler = PngHandler();

        await ServiceWith(handler).GetPoiPresentationAsync(ValidRequest(), default);

        var form = handler.Form();
        Assert.DoesNotContain(",", form["LAYERS"], StringComparison.Ordinal);
        Assert.DoesNotContain(",", form["STYLES"], StringComparison.Ordinal);
    }

    /// <summary>
    /// İstemci sözleşmesinde katman/style/CQL alanı YOKTUR.
    /// </summary>
    /// <remarks>
    /// Bu bir davranış değil bir TİP iddiasıdır: DTO'ya böyle bir alan
    /// eklendiği an test kırılır ve override yolu sessizce açılamaz.
    /// </remarks>
    [Fact]
    public void The_presentation_request_contract_exposes_only_the_viewport()
    {
        var properties = typeof(MapPresentationRequest)
            .GetProperties()
            .Select(property => property.Name)
            .OrderBy(name => name, StringComparer.Ordinal);

        /* Görüntü penceresi ARTIK dört değerdir: kapsam, iki boyut ve o
           boyutların CSS pikseline göre yoğunluğu. Dördü de saf render
           bilgisidir; hiçbiri katman, style, filtre ya da kimlik taşımaz. */
        Assert.Equal(["Bbox", "Height", "PixelRatio", "Width"], properties);
    }

    [Theory]
    [InlineData("not-a-bbox", 512, 320)]
    [InlineData("1,2,3", 512, 320)]
    [InlineData("3,2,1,4", 512, 320)]
    [InlineData("1,2,3,4", 63, 320)]
    [InlineData("1,2,3,4", 512, 2049)]
    [InlineData("1,2,3,4", 2049, 512)]
    public async Task Poi_presentation_rejects_an_invalid_viewport(string bbox, int width, int height)
    {
        var handler = PngHandler();

        var result = await ServiceWith(handler).GetPoiPresentationAsync(
            new MapPresentationRequest { Bbox = bbox, Width = width, Height = height },
            default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
        // Geçersiz istek GeoServer'a HİÇ ulaşmaz.
        Assert.Equal(0, handler.CallCount);
    }

    [Fact]
    public async Task Poi_presentation_rejects_a_missing_request()
    {
        var handler = PngHandler();

        var result = await ServiceWith(handler).GetPoiPresentationAsync(null!, default);

        Assert.False(result.IsSuccess);
        Assert.Equal(0, handler.CallCount);
    }

    /// <summary>
    /// PNG olmayan bir yanıt yukarı akış hatasıdır.
    /// </summary>
    /// <remarks>
    /// Boş/şeffaf bir görüntü UYDURULMAZ: yukarı akış hatası "hiç POI yok" ile
    /// aynı görüntüye indirgenirse kullanıcı envanterin kaybolduğunu fark
    /// edemez.
    /// </remarks>
    [Fact]
    public async Task Poi_presentation_rejects_a_non_png_response()
    {
        var handler = new RecordingHandler(_ => Response("<ServiceExceptionReport/>"u8.ToArray(), "text/xml"));

        var result = await ServiceWith(handler).GetPoiPresentationAsync(ValidRequest(), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Upstream, result.ErrorKind);
    }

    [Fact]
    public async Task Poi_presentation_rejects_a_body_without_a_png_signature()
    {
        var handler = new RecordingHandler(_ => Response([1, 2, 3, 4], "image/png"));

        var result = await ServiceWith(handler).GetPoiPresentationAsync(ValidRequest(), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Upstream, result.ErrorKind);
    }

    [Fact]
    public async Task Poi_presentation_maps_a_geoserver_failure_to_upstream()
    {
        var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.InternalServerError)
        {
            Content = new ByteArrayContent([])
        });

        var result = await ServiceWith(handler).GetPoiPresentationAsync(ValidRequest(), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Upstream, result.ErrorKind);
    }

    [Fact]
    public async Task Poi_presentation_maps_an_unreachable_geoserver_to_upstream()
    {
        var handler = new RecordingHandler((_, _) =>
            Task.FromException<HttpResponseMessage>(new HttpRequestException("connection refused")));

        var result = await ServiceWith(handler).GetPoiPresentationAsync(ValidRequest(), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Upstream, result.ErrorKind);
    }

    private static GeoServerMapPresentationService ServiceWith(RecordingHandler handler, int userId = 104) =>
        ServiceWith(handler, CurrentUser(userId));

    private static GeoServerMapPresentationService ServiceWith(
        RecordingHandler handler,
        ICurrentUserService currentUser) =>
        new(
            new HttpClient(handler),
            Options(),
            currentUser,
            NullLogger<GeoServerMapPresentationService>.Instance);

    private static ICurrentUserService CurrentUser(int userId)
    {
        var currentUser = Substitute.For<ICurrentUserService>();
        currentUser.IsAuthenticated.Returns(true);
        currentUser.UserId.Returns(userId);
        return currentUser;
    }

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

        /* Konum analizi bu dosyanın konusu DEĞİLDİR ama Validate() ayarın
           TAMAMINI denetler: eksik bir analiz katmanı, ısı haritası
           doğrulamasını ölçen testin ilgisiz bir sebeple düşmesine yol
           açardı. POI alanlarında da aynı gerekçeyle aynı şey yapılmıştı. */
        AnalysisPoiLayer = "analysis_poi_read",
        AnalysisPoiPointStyle = "analysis_poi_points",
        HeatmapTimeoutSeconds = 30,
        PresentationTimeoutSeconds = 30
    };

    private static RecordingHandler PngHandler() => new(_ => Response(Png, "image/png"));

    private static HttpResponseMessage Response(byte[] content, string mediaType)
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(content)
        };
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

        private static string Decode(string value) =>
            Uri.UnescapeDataString(value.Replace('+', ' '));
    }
}
