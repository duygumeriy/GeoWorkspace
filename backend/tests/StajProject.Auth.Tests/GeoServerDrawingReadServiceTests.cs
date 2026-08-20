using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using StajProject.Api.Authorization;
using StajProject.Api.Controllers;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Domain.Common;
using StajProject.Infrastructure.GeoServer;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

public class GeoServerDrawingReadServiceTests
{
    [Fact]
    public async Task Maps_point_geojson_to_existing_response_contract()
    {
        var service = ServiceWith(FeatureCollection(
            Feature(8, "Point", new[] { 30.123456789012345, 40.25 }, pointRadius: 11)));

        var result = Assert.Single(await service.GetDrawingsAsync(DrawingKind.Point, 104, default));

        Assert.Equal(8, result.Id);
        Assert.Equal("POINT (30.123456789012344 40.25)", result.Wkt);
        Assert.Equal("Çizim 8", result.Name);
        Assert.Equal("Açıklama", result.Description);
        Assert.Equal("Çalışma Alanı", result.Category);
        Assert.Equal(["etiket-1", "etiket-2"], result.Tags);
        Assert.Equal("current-owner", result.CreatedBy);
        Assert.Equal(104, result.CreatedByUserId);
        Assert.Equal("#123456", result.Style.StrokeColor);
        Assert.Equal(4, result.Style.StrokeWidth);
        Assert.Equal("#654321", result.Style.FillColor);
        Assert.Equal(11, result.Style.PointRadius);
        Assert.Null(result.Style.LineStyle);
        Assert.Equal(DateTimeKind.Utc, result.CreatedDate.Kind);
        Assert.Equal(DateTimeKind.Utc, result.ModifiedDate.Kind);
    }

    [Fact]
    public async Task Maps_linestring_geojson_and_preserves_line_style()
    {
        var service = ServiceWith(FeatureCollection(
            Feature(7, "LineString", new[]
            {
                new[] { 30.0, 40.0 },
                new[] { 31.0, 41.0 }
            })));

        var result = Assert.Single(await service.GetDrawingsAsync(DrawingKind.Line, 104, default));

        Assert.Equal("LINESTRING (30 40, 31 41)", result.Wkt);
        Assert.Equal("dashed", result.Style.LineStyle);
        Assert.Null(result.Style.FillOpacity);
        Assert.Null(result.Style.PointRadius);
    }

    [Fact]
    public async Task Maps_polygon_geojson_including_inner_ring()
    {
        var service = ServiceWith(FeatureCollection(
            Feature(6, "Polygon", new[]
            {
                new[]
                {
                    new[] { 28.0, 38.0 }, new[] { 32.0, 38.0 }, new[] { 32.0, 42.0 },
                    new[] { 28.0, 42.0 }, new[] { 28.0, 38.0 }
                },
                new[]
                {
                    new[] { 29.0, 39.0 }, new[] { 30.0, 39.0 }, new[] { 30.0, 40.0 },
                    new[] { 29.0, 39.0 }
                }
            })));

        var result = Assert.Single(await service.GetDrawingsAsync(DrawingKind.Polygon, 104, default));

        Assert.StartsWith("POLYGON ((28 38, 32 38", result.Wkt);
        Assert.Contains("(29 39, 30 39, 30 40, 29 39)", result.Wkt);
        Assert.Equal(0.35, result.Style.FillOpacity);
    }

    [Fact]
    public async Task Wfs_query_uses_authenticated_owner_and_encoded_status_filter()
    {
        var handler = new StubHandler(_ => JsonResponse(FeatureCollection()));
        var service = ServiceWith(handler);

        await service.GetDrawingsAsync(DrawingKind.Point, 712, default);

        var uri = Assert.IsType<Uri>(handler.LastRequestUri);
        var decoded = Uri.UnescapeDataString(uri.Query);

        Assert.Contains("typeNames=geoworkspace:tbl_point_read", decoded);
        Assert.Contains(
            "cql_filter=inserted_user_id=712 AND is_deleted=false AND is_active=true",
            decoded);
        Assert.Contains("sortBy=Id A", decoded);
        Assert.Contains("outputFormat=application/json", decoded);
        Assert.Contains("srsName=EPSG:4326", decoded);
        Assert.Contains("cql_filter=", uri.Query, StringComparison.Ordinal);
        Assert.DoesNotContain("CQL_FILTER", uri.Query, StringComparison.Ordinal);
        Assert.Contains("%20", uri.OriginalString, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Deleted_records_are_excluded_by_the_server_side_wfs_filter()
    {
        var handler = new StubHandler(_ => JsonResponse(FeatureCollection()));

        await ServiceWith(handler).GetDrawingsAsync(DrawingKind.Line, 104, default);

        Assert.Contains("is_deleted=false", Uri.UnescapeDataString(handler.LastRequestUri!.Query));
    }

    [Fact]
    public async Task Inactive_records_are_excluded_by_the_server_side_wfs_filter()
    {
        var handler = new StubHandler(_ => JsonResponse(FeatureCollection()));

        await ServiceWith(handler).GetDrawingsAsync(DrawingKind.Polygon, 104, default);

        Assert.Contains("is_active=true", Uri.UnescapeDataString(handler.LastRequestUri!.Query));
    }

    [Fact]
    public async Task Results_are_ordered_by_id_even_if_geoserver_order_regresses()
    {
        var service = ServiceWith(FeatureCollection(
            Feature(9, "Point", new[] { 31.0, 41.0 }),
            Feature(2, "Point", new[] { 30.0, 40.0 })));

        var result = await service.GetDrawingsAsync(DrawingKind.Point, 104, default);

        Assert.Equal([2, 9], result.Select(item => item.Id));
    }

    [Fact]
    public async Task Missing_current_user_returns_empty_without_calling_geoserver()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"geoserver-missing-user-{Guid.NewGuid():N}")
            .Options;
        await using var db = new AppDbContext(options);
        var currentUser = Substitute.For<ICurrentUserService>();
        currentUser.UserId.Returns((int?)null);
        var geoServer = Substitute.For<IGeoServerDrawingReadService>();
        var drawingService = new DrawingService(
            db,
            currentUser,
            Substitute.For<IDrawingAuthorizationService>(),
            Substitute.For<IGeographicAuthorizationService>(),
            geoServer);

        var result = await drawingService.GetPointsAsync(default);

        Assert.Empty(result);
        await geoServer.DidNotReceive().GetDrawingsAsync(
            Arg.Any<DrawingKind>(),
            Arg.Any<int>(),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task GeoServer_failure_is_observable_and_not_converted_to_empty_list()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
        var service = ServiceWith(handler);

        await Assert.ThrowsAsync<HttpRequestException>(
            () => service.GetDrawingsAsync(DrawingKind.Point, 104, default));
    }

    [Fact]
    public async Task Malformed_geojson_is_observable_and_not_converted_to_empty_list()
    {
        var handler = new StubHandler(_ =>
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{not-json", Encoding.UTF8, "application/json")
            });
        var service = ServiceWith(handler);

        await Assert.ThrowsAnyAsync<JsonException>(
            () => service.GetDrawingsAsync(DrawingKind.Point, 104, default));
    }

    [Theory]
    [InlineData(nameof(DrawingsController.GetPoints), "points")]
    [InlineData(nameof(DrawingsController.GetLines), "lines")]
    [InlineData(nameof(DrawingsController.GetPolygons), "polygons")]
    public void Normal_read_routes_and_drawings_view_permission_remain_unchanged(
        string methodName,
        string route)
    {
        var method = typeof(DrawingsController).GetMethod(methodName)!;

        Assert.Equal(route, Assert.Single(method.GetCustomAttributes(typeof(HttpGetAttribute), true)
            .Cast<HttpGetAttribute>()).Template);
        Assert.Equal(PermissionCodes.DrawingsView, Assert.Single(
            method.GetCustomAttributes(typeof(RequirePermissionAttribute), true)
                .Cast<RequirePermissionAttribute>()).PermissionCode);
    }

    private static GeoServerDrawingReadService ServiceWith(string json) =>
        ServiceWith(new StubHandler(_ => JsonResponse(json)));

    private static GeoServerDrawingReadService ServiceWith(StubHandler handler) =>
        new(
            new HttpClient(handler),
            Options(),
            NullLogger<GeoServerDrawingReadService>.Instance);

    private static GeoServerOptions Options() => new()
    {
        BaseUrl = "http://localhost:8080/geoserver",
        Workspace = "geoworkspace",
        PointLayer = "tbl_point_read",
        LineLayer = "tbl_line_read",
        PolygonLayer = "tbl_polygon_read"
    };

    private static string FeatureCollection(params object[] features) =>
        JsonSerializer.Serialize(new { type = "FeatureCollection", features });

    private static object Feature(int id, string geometryType, object coordinates, int? pointRadius = null) => new
    {
        type = "Feature",
        geometry = new { type = geometryType, coordinates },
        properties = new
        {
            Id = id,
            Name = $"Çizim {id}",
            CreatedBy = "current-owner",
            inserted_date = "2026-08-19T20:25:07.865Z",
            FillColor = geometryType == "LineString" ? null : "#654321",
            FillOpacity = geometryType == "Polygon" ? (double?)0.35 : null,
            LineStyle = geometryType == "Point" ? null : "dashed",
            modified_date = "2026-08-19T21:25:07.865Z",
            PointRadius = pointRadius,
            StrokeColor = "#123456",
            StrokeWidth = 4,
            inserted_user_id = 104,
            is_deleted = false,
            is_active = true,
            category = "Çalışma Alanı",
            description = "Açıklama",
            tags_json = "[\"etiket-1\",\"etiket-2\"]"
        }
    };

    private static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> responder)
        : HttpMessageHandler
    {
        public Uri? LastRequestUri { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            LastRequestUri = request.RequestUri;
            return Task.FromResult(responder(request));
        }
    }
}
