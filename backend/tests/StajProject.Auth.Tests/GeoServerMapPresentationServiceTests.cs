using System.Net;
using System.Net.Http.Headers;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
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

        Assert.Equal(["Bbox", "Width", "Height"], properties);
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

    private static MapPresentationRequest ValidRequest() => new()
    {
        Bbox = "-1000,-2000,3000,4000",
        Width = 512,
        Height = 320
    };

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
