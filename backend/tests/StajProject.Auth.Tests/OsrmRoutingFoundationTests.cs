using System.Net;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.Extensions.Logging.Abstractions;
using NetTopologySuite.Geometries;
using StajProject.Application.Common;
using StajProject.Application.Options;
using StajProject.Application.Routing;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Routing;

namespace StajProject.Auth.Tests;

public sealed class OsrmRoutingFoundationTests
{
    [Fact]
    public void Route_path_is_required_dependent_in_one_to_one_relationship()
    {
        var model = Model();
        var route = model.FindEntityType(typeof(TransportRoute))!;
        var path = model.FindEntityType(typeof(TransportRoutePath))!;

        var foreignKey = Assert.Single(path.GetForeignKeys());
        Assert.Same(route, foreignKey.PrincipalEntityType);
        Assert.Equal(nameof(TransportRoutePath.RouteId), Assert.Single(foreignKey.Properties).Name);
        Assert.Equal(DeleteBehavior.Restrict, foreignKey.DeleteBehavior);
        Assert.True(foreignKey.IsUnique);
        Assert.Equal(nameof(TransportRoute.Path), foreignKey.PrincipalToDependent!.Name);
        Assert.Equal(nameof(TransportRoutePath.Route), foreignKey.DependentToPrincipal!.Name);
        Assert.NotNull(path.GetQueryFilter());
    }

    [Fact]
    public void Route_id_has_a_unique_index()
    {
        var path = Model().FindEntityType(typeof(TransportRoutePath))!;
        var index = Assert.Single(path.GetIndexes().Where(index =>
            index.Properties.Select(property => property.Name).SequenceEqual([nameof(TransportRoutePath.RouteId)])));

        Assert.True(index.IsUnique);
    }

    [Fact]
    public void Route_path_geometry_is_required_linestring_4326()
    {
        var geometry = Model().FindEntityType(typeof(TransportRoutePath))!
            .FindProperty(nameof(TransportRoutePath.Geometry))!;

        Assert.False(geometry.IsNullable);
        Assert.Equal(typeof(LineString), geometry.ClrType);
        Assert.Equal("geometry(LineString,4326)", geometry.GetColumnType());
    }

    [Fact]
    public async Task Active_route_path_is_visible_through_normal_queries()
    {
        await using var context = QueryFilterContext(routeDeleted: false, pathIsStale: false);

        Assert.Equal(1, await context.TransportRoutePaths.CountAsync());
    }

    [Fact]
    public async Task Soft_deleted_parent_hides_route_path_from_normal_queries()
    {
        await using var context = QueryFilterContext(routeDeleted: true, pathIsStale: false);

        Assert.Equal(0, await context.TransportRoutePaths.CountAsync());
    }

    [Fact]
    public async Task Ignore_query_filters_can_access_soft_deleted_routes_path()
    {
        await using var context = QueryFilterContext(routeDeleted: true, pathIsStale: false);

        Assert.Equal(1, await context.TransportRoutePaths.IgnoreQueryFilters().CountAsync());
    }

    [Fact]
    public async Task Stale_path_for_active_route_remains_visible_through_normal_queries()
    {
        await using var context = QueryFilterContext(routeDeleted: false, pathIsStale: true);

        var path = Assert.Single(await context.TransportRoutePaths.ToListAsync());
        Assert.True(path.IsStale);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    public async Task Fewer_than_two_waypoints_are_rejected_without_an_http_call(int count)
    {
        var handler = new RecordingHandler(_ => Response(HttpStatusCode.OK, SuccessJson));
        var service = Service(handler);
        var waypoints = Enumerable.Repeat(new OsrmWaypoint(36.33, 41.28), count).ToArray();

        var result = await service.RouteAsync(new OsrmRouteRequest(waypoints));

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
        Assert.Equal(0, handler.CallCount);
    }

    [Fact]
    public async Task Request_writes_longitude_before_latitude()
    {
        var handler = new RecordingHandler(_ => Response(HttpStatusCode.OK, SuccessJson));

        await Service(handler).RouteAsync(new OsrmRouteRequest(
            [new(36.1234, 41.5678), new(35.4321, 40.8765)]));

        Assert.Contains("/36.1234,41.5678;35.4321,40.8765?", handler.LastRequestUri!.AbsoluteUri);
    }

    [Fact]
    public async Task Request_preserves_the_explicit_waypoint_sequence()
    {
        var handler = new RecordingHandler(_ => Response(HttpStatusCode.OK, SuccessJson));

        await Service(handler).RouteAsync(new OsrmRouteRequest(
            [new(36.3, 41.3), new(36.1, 41.1), new(36.2, 41.2), new(36.4, 41.4)]));

        Assert.Contains("/36.3,41.3;36.1,41.1;36.2,41.2;36.4,41.4?", handler.LastRequestUri!.AbsoluteUri);
        /* Faz 5: adımlar ARTIK istenir. Manevralar yolun üretildiği anda
           alınıp onunla birlikte saklanır; simülasyon sırasında ya da her
           gözlemci için yeniden yönlendirme YAPILMAZ. */
        Assert.Contains("overview=full&geometries=geojson&steps=true", handler.LastRequestUri.Query);
    }

    [Fact]
    public async Task Successful_response_maps_geometry_distance_duration_and_profile()
    {
        var result = await Service(new RecordingHandler(_ => Response(HttpStatusCode.OK, SuccessJson)))
            .RouteAsync(ValidRequest());

        Assert.True(result.IsSuccess);
        Assert.Equal(4326, result.Value!.Geometry.SRID);
        Assert.Equal(3, result.Value.Geometry.NumPoints);
        Assert.Equal(36.33, result.Value.Geometry.CoordinateSequence.GetX(0));
        Assert.Equal(41.28, result.Value.Geometry.CoordinateSequence.GetY(0));
        Assert.Equal(1250.5, result.Value.DistanceMeters);
        Assert.Equal(180.25, result.Value.DurationSeconds);
        Assert.Equal("driving", result.Value.Profile);
    }

    [Fact]
    public async Task No_route_response_is_a_safe_upstream_failure()
    {
        var result = await Service(new RecordingHandler(_ => Response(
                HttpStatusCode.OK,
                "{\"code\":\"NoRoute\",\"message\":\"internal upstream detail\"}")))
            .RouteAsync(ValidRequest());

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Upstream, result.ErrorKind);
        Assert.Equal(RouteGenerationMessages.NoRoute, result.Error);
        Assert.DoesNotContain("internal upstream detail", result.Error);
    }

    [Fact]
    public async Task Malformed_json_is_a_safe_upstream_failure()
    {
        var result = await Service(new RecordingHandler(_ => Response(HttpStatusCode.OK, "{not-json")))
            .RouteAsync(ValidRequest());

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Upstream, result.ErrorKind);
        Assert.Equal(RouteGenerationMessages.Unknown, result.Error);
        Assert.DoesNotContain("not-json", result.Error);
    }

    [Fact]
    public async Task Invalid_geometry_is_a_safe_upstream_failure()
    {
        const string json = """
            {"code":"Ok","routes":[{"distance":1,"duration":2,"geometry":{"type":"LineString","coordinates":[[181,41],[36,41]]}}]}
            """;

        var result = await Service(new RecordingHandler(_ => Response(HttpStatusCode.OK, json)))
            .RouteAsync(ValidRequest());

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Upstream, result.ErrorKind);
    }

    [Fact]
    public async Task Non_success_http_status_is_a_safe_upstream_failure()
    {
        var result = await Service(new RecordingHandler(_ => Response(
                HttpStatusCode.BadGateway,
                "private proxy failure")))
            .RouteAsync(ValidRequest());

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Upstream, result.ErrorKind);
        Assert.Equal(RouteGenerationMessages.Unavailable, result.Error);
        Assert.DoesNotContain("private proxy failure", result.Error);
    }

    [Fact]
    public async Task Connection_failure_is_a_safe_upstream_failure()
    {
        var handler = new RecordingHandler(_ => throw new HttpRequestException("docker hostname and port"));

        var result = await Service(handler).RouteAsync(ValidRequest());

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Upstream, result.ErrorKind);
        Assert.Equal(RouteGenerationMessages.Unavailable, result.Error);
        Assert.DoesNotContain("docker", result.Error);
    }

    [Fact]
    public async Task Timeout_is_reported_separately_and_safely()
    {
        var handler = new RecordingHandler(_ => throw new TaskCanceledException("private timeout detail"));

        var result = await Service(handler).RouteAsync(ValidRequest());

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Timeout, result.ErrorKind);
        Assert.Equal(RouteGenerationMessages.Timeout, result.Error);
        Assert.DoesNotContain("private timeout detail", result.Error);
    }

    [Fact]
    public async Task Unknown_infrastructure_exception_uses_the_safe_fallback()
    {
        var handler = new RecordingHandler(_ => throw new InvalidOperationException("raw internal stack detail"));

        var result = await Service(handler).RouteAsync(ValidRequest());

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Upstream, result.ErrorKind);
        Assert.Equal(RouteGenerationMessages.Unknown, result.Error);
        Assert.DoesNotContain("internal", result.Error);
    }

    [Theory]
    [InlineData(double.NaN, 41)]
    [InlineData(181, 41)]
    [InlineData(36, 91)]
    public async Task Invalid_input_coordinate_is_rejected_without_an_http_call(double longitude, double latitude)
    {
        var handler = new RecordingHandler(_ => Response(HttpStatusCode.OK, SuccessJson));
        var request = new OsrmRouteRequest([new(longitude, latitude), new(36, 41)]);

        var result = await Service(handler).RouteAsync(request);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
        Assert.Equal(0, handler.CallCount);
    }

    [Fact]
    public void Request_contract_cannot_override_server_or_profile()
    {
        Assert.Equal(["Waypoints"], typeof(OsrmRouteRequest).GetProperties().Select(property => property.Name));
        Assert.Equal(
            ["Longitude", "Latitude"],
            typeof(OsrmWaypoint).GetProperties().Select(property => property.Name));

        var unsafeProfile = Options();
        unsafeProfile.Profile = "../../trip/v1/driving";
        Assert.Throws<InvalidOperationException>(unsafeProfile.Validate);

        var unsafeUrl = Options();
        unsafeUrl.BaseUrl = "file:///private/osrm";
        Assert.Throws<InvalidOperationException>(unsafeUrl.Validate);
    }

    private static OsrmRouteRequest ValidRequest() =>
        new([new(36.33, 41.28), new(36.34, 41.27)]);

    private static OsrmRoutingService Service(RecordingHandler handler)
    {
        var options = Options();
        options.Validate();
        return new OsrmRoutingService(
            new HttpClient(handler),
            options,
            NullLogger<OsrmRoutingService>.Instance);
    }

    private static OsrmOptions Options() => new()
    {
        BaseUrl = "http://localhost:5000",
        Profile = "driving",
        TimeoutSeconds = 30
    };

    private static HttpResponseMessage Response(HttpStatusCode statusCode, string content) => new(statusCode)
    {
        Content = new StringContent(content, Encoding.UTF8, "application/json")
    };

    private static IModel Model()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(
                "Host=localhost;Database=model-only;Username=none;Password=none",
                npgsql => npgsql.UseNetTopologySuite())
            .Options;

        using var context = new AppDbContext(options);
        return context.Model;
    }

    private static AppDbContext QueryFilterContext(bool routeDeleted, bool pathIsStale)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"osrm-route-path-filter-{Guid.NewGuid():N}")
            .Options;

        var context = new AppDbContext(options);
        var route = new TransportRoute
        {
            Name = "Test route",
            ColorHex = "#123456",
            IsActive = true,
            IsDeleted = routeDeleted,
            CreatedDate = DateTime.UtcNow
        };
        var path = new TransportRoutePath
        {
            Route = route,
            Geometry = new LineString([new(36, 41), new(36.1, 41.1)]) { SRID = 4326 },
            DistanceMeters = 1_000,
            DurationSeconds = 120,
            Profile = "driving",
            GeneratedAt = DateTime.UtcNow,
            IsStale = pathIsStale,
            ModifiedDate = DateTime.UtcNow
        };

        context.TransportRoutePaths.Add(path);
        context.SaveChanges();
        context.ChangeTracker.Clear();
        return context;
    }

    private const string SuccessJson = """
        {
          "code": "Ok",
          "routes": [{
            "distance": 1250.5,
            "duration": 180.25,
            "geometry": {
              "type": "LineString",
              "coordinates": [[36.33,41.28],[36.335,41.275],[36.34,41.27]]
            }
          }]
        }
        """;

    private sealed class RecordingHandler(Func<HttpRequestMessage, HttpResponseMessage> responder) : HttpMessageHandler
    {
        public int CallCount { get; private set; }
        public Uri? LastRequestUri { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            CallCount++;
            LastRequestUri = request.RequestUri;
            return Task.FromResult(responder(request));
        }
    }
}
