using System.Net;
using System.Net.Http.Headers;
using Microsoft.Extensions.Logging.Abstractions;
using NetTopologySuite.IO;
using NSubstitute;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Geographic;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Infrastructure.GeoServer;

namespace StajProject.Auth.Tests;

public class GeoServerHeatmapServiceTests
{
    private static readonly byte[] Png = [137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3];

    [Fact]
    public async Task Uses_fixed_WMS_POST_parameters_and_backend_owned_user_filter()
    {
        var handler = PngHandler();
        var service = ServiceWith(handler, userId: 712, EffectiveGeographicAuthorization.Unrestricted);

        var result = await service.GetHeatmapAsync(ValidRequest(), default);

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal(Png, result.Value!.Content);
        Assert.Equal(HttpMethod.Post, handler.Method);
        Assert.Equal("http://localhost:8080/geoserver/wms", handler.RequestUri!.ToString());
        Assert.Equal("application/x-www-form-urlencoded", handler.ContentType);

        var form = handler.Form();
        Assert.Equal("WMS", form["SERVICE"]);
        Assert.Equal("1.3.0", form["VERSION"]);
        Assert.Equal("GetMap", form["REQUEST"]);
        Assert.Equal("geoworkspace:tbl_point_heatmap", form["LAYERS"]);
        Assert.Equal("point_density_heatmap", form["STYLES"]);
        Assert.Equal("EPSG:3857", form["CRS"]);
        Assert.Equal("-1000,-2000,3000,4000", form["BBOX"]);
        Assert.Equal("512", form["WIDTH"]);
        Assert.Equal("320", form["HEIGHT"]);
        Assert.Equal("image/png", form["FORMAT"]);
        Assert.Equal("true", form["TRANSPARENT"]);
        Assert.Equal(
            "inserted_user_id=712 AND is_deleted=false AND is_active=true",
            form["CQL_FILTER"]);
        Assert.DoesNotContain("INTERSECTS", form["CQL_FILTER"], StringComparison.Ordinal);
    }

    [Fact]
    public async Task Restricted_polygon_is_added_to_the_server_generated_filter()
    {
        var handler = PngHandler();
        var polygon = Geometry("POLYGON ((29 39, 31 39, 31 41, 29 41, 29 39))");

        var result = await ServiceWith(handler, 104, EffectiveGeographicAuthorization.Restricted(polygon))
            .GetHeatmapAsync(ValidRequest(), default);

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal(
            "inserted_user_id=104 AND is_deleted=false AND is_active=true " +
            "AND INTERSECTS(\"Geometry\",POLYGON ((29 39, 31 39, 31 41, 29 41, 29 39)))",
            handler.Form()["CQL_FILTER"]);
    }

    [Fact]
    public async Task Restricted_multipolygon_preserves_every_component()
    {
        var handler = PngHandler();
        var multiPolygon = Geometry(
            "MULTIPOLYGON (((29 39, 30 39, 30 40, 29 40, 29 39)), " +
            "((35 38, 36 38, 36 39, 35 39, 35 38)))");

        var result = await ServiceWith(handler, 104, EffectiveGeographicAuthorization.Restricted(multiPolygon))
            .GetHeatmapAsync(ValidRequest(), default);

        Assert.True(result.IsSuccess, result.Error);
        var cql = handler.Form()["CQL_FILTER"];
        Assert.Contains("MULTIPOLYGON", cql, StringComparison.Ordinal);
        Assert.Contains("29 39", cql, StringComparison.Ordinal);
        Assert.Contains("35 38", cql, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("")]
    [InlineData("1,2,3")]
    [InlineData("1,2,3,4,5")]
    [InlineData("NaN,2,3,4")]
    [InlineData("Infinity,2,3,4")]
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

        var result = await ServiceWith(handler).GetHeatmapAsync(request, default);

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

        var result = await ServiceWith(handler).GetHeatmapAsync(request, default);

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

        var result = await ServiceWith(
            handler,
            currentUser,
            EffectiveGeographicAuthorization.Unrestricted).GetHeatmapAsync(ValidRequest(), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
        Assert.Equal(0, handler.CallCount);
    }

    [Fact]
    public async Task Effective_geographic_scope_is_requested_for_the_authenticated_user()
    {
        var geographic = Substitute.For<IGeographicAuthorizationService>();
        geographic.GetEffectiveAuthorizationAsync(835, Arg.Any<CancellationToken>())
            .Returns(EffectiveGeographicAuthorization.Unrestricted);

        var result = await ServiceWith(PngHandler(), CurrentUser(835), geographic)
            .GetHeatmapAsync(ValidRequest(), default);

        Assert.True(result.IsSuccess, result.Error);
        await geographic.Received(1).GetEffectiveAuthorizationAsync(835, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Non_polygon_restricted_scope_fails_closed()
    {
        var handler = PngHandler();
        var point = Geometry("POINT (30 40)");

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            ServiceWith(handler, 104, EffectiveGeographicAuthorization.Restricted(point))
                .GetHeatmapAsync(ValidRequest(), default));

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

        var result = await ServiceWith(handler).GetHeatmapAsync(ValidRequest(), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Upstream, result.ErrorKind);
    }

    [Fact]
    public async Task Payload_without_PNG_signature_is_rejected()
    {
        var handler = new RecordingHandler(_ => Response([1, 2, 3, 4], "image/png"));

        var result = await ServiceWith(handler).GetHeatmapAsync(ValidRequest(), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Upstream, result.ErrorKind);
    }

    [Fact]
    public async Task GeoServer_HTTP_failure_is_observable_as_upstream_failure()
    {
        var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));

        var result = await ServiceWith(handler).GetHeatmapAsync(ValidRequest(), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Upstream, result.ErrorKind);
    }

    [Fact]
    public async Task GeoServer_timeout_is_reported_separately()
    {
        var handler = new RecordingHandler(_ => throw new TaskCanceledException("timeout"));

        var result = await ServiceWith(handler).GetHeatmapAsync(ValidRequest(), default);

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
            ServiceWith(handler).GetHeatmapAsync(ValidRequest(), cancellation.Token));
    }

    [Fact]
    public void Public_request_contract_contains_no_security_or_GeoServer_authority_fields()
    {
        var properties = typeof(HeatmapRequest).GetProperties().Select(property => property.Name).ToArray();

        Assert.Equal(["Bbox", "Width", "Height"], properties);
        Assert.DoesNotContain(properties, name =>
            name.Contains("User", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Owner", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Cql", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Layer", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Style", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Workspace", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Wkt", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Options_reject_missing_or_unsafe_heatmap_resources_and_timeout()
    {
        var missing = Options();
        missing.HeatmapLayer = string.Empty;
        Assert.Throws<InvalidOperationException>(missing.Validate);

        var unsafeName = Options();
        unsafeName.HeatmapStyle = "safe&CQL_FILTER=INCLUDE";
        Assert.Throws<InvalidOperationException>(unsafeName.Validate);

        var timeout = Options();
        timeout.HeatmapTimeoutSeconds = 0;
        Assert.Throws<InvalidOperationException>(timeout.Validate);

        Options().Validate();
    }

    private static HeatmapRequest ValidRequest() => new()
    {
        Bbox = "-1000,-2000,3000,4000",
        Width = 512,
        Height = 320
    };

    private static GeoServerHeatmapService ServiceWith(
        RecordingHandler handler,
        int userId = 104,
        EffectiveGeographicAuthorization? geographic = null) =>
        ServiceWith(
            handler,
            CurrentUser(userId),
            geographic ?? EffectiveGeographicAuthorization.Unrestricted);

    private static GeoServerHeatmapService ServiceWith(
        RecordingHandler handler,
        ICurrentUserService currentUser,
        EffectiveGeographicAuthorization geographic)
    {
        var authorization = Substitute.For<IGeographicAuthorizationService>();
        authorization.GetEffectiveAuthorizationAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns(geographic);
        return ServiceWith(handler, currentUser, authorization);
    }

    private static GeoServerHeatmapService ServiceWith(
        RecordingHandler handler,
        ICurrentUserService currentUser,
        IGeographicAuthorizationService geographic) =>
        new(
            new HttpClient(handler),
            Options(),
            currentUser,
            geographic,
            NullLogger<GeoServerHeatmapService>.Instance);

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
        /* POI sunumu bu testin KONUSU değildir ama <c>Validate()</c> ayarın
           TAMAMINI denetler ve haklı olarak öyle yapar: eksik bir POI katmanı
           uygulamanın açılışta durması gereken bir yapılandırma hatasıdır.

           Bu fixture POI entegrasyonundan ÖNCE yazıldığı için iki alanı boş
           bırakıyordu; sonuç, ısı haritası doğrulamasını ölçen testin
           kendisinin ilgisiz bir eksikten düşmesiydi. Değerler harita sunum
           testlerindeki geçerli sabitlerin aynısıdır, dolayısıyla her olumsuz
           doğrulama artık YALNIZCA hedeflediği alanı geçersiz kılar. */
        PoiLayer = "poi_read",
        PoiStyle = "poi_all",
        HeatmapTimeoutSeconds = 30
    };

    private static NetTopologySuite.Geometries.Geometry Geometry(string wkt)
    {
        var geometry = new WKTReader().Read(wkt);
        geometry.SRID = 4326;
        return geometry;
    }

    private static RecordingHandler PngHandler() =>
        new(_ => Response(Png, "image/png"));

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
