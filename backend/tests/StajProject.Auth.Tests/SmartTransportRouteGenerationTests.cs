using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using NetTopologySuite.Geometries;
using NSubstitute;
using StajProject.Api.Authorization;
using StajProject.Api.Controllers;
using StajProject.Application.Common;
using StajProject.Application.Activity;
using StajProject.Application.DTOs;
using StajProject.Application.Geographic;
using StajProject.Application.Interfaces;
using StajProject.Application.Routing;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

public sealed class SmartTransportRouteGenerationTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    public async Task Generation_requires_two_active_stops_without_calling_osrm(int stopCount)
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        for (var index = 0; index < stopCount; index++)
        {
            await fixture.AddStopAsync(route, index + 1);
        }
        await fixture.AddStopAsync(route, 90, deleted: true);
        await fixture.AddStopAsync(route, 91, active: false);

        var result = await fixture.Service.GenerateRoutePathAsync(route.Id);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
        Assert.Empty(fixture.Routing.Requests);
        Assert.Empty(await fixture.Db.TransportRoutePaths.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async Task First_generation_uses_sequence_order_and_persists_complete_current_path()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        await fixture.AddStopAsync(route, 2, longitude: 36.2, latitude: 41.2);
        await fixture.AddStopAsync(route, 1, longitude: 36.1, latitude: 41.1);
        fixture.Routing.Succeed(ResultGeometry(36.1, 41.1, 36.2, 41.2), 1_250.5, 180.25);

        var result = await fixture.Service.GenerateRoutePathAsync(route.Id);

        Assert.True(result.IsSuccess);
        var request = Assert.Single(fixture.Routing.Requests);
        Assert.Equal(
            [(36.1, 41.1), (36.2, 41.2)],
            request.Waypoints.Select(waypoint => (waypoint.Longitude, waypoint.Latitude)));
        var stored = Assert.Single(await fixture.Db.TransportRoutePaths.ToListAsync());
        Assert.Equal(route.Id, stored.RouteId);
        Assert.Equal(4326, stored.Geometry.SRID);
        Assert.Equal(1_250.5, stored.DistanceMeters);
        Assert.Equal(180.25, stored.DurationSeconds);
        Assert.Equal("driving", stored.Profile);
        Assert.NotEqual(default, stored.GeneratedAt);
        Assert.NotEqual(default, stored.ModifiedDate);
        Assert.False(stored.IsStale);
        Assert.Null(stored.LastFailureReason);
        Assert.StartsWith("LINESTRING", result.Value!.GeometryWkt);
        Assert.Equal(TransportActivityKind.RouteGeneration, fixture.Activity.Outcome?.Kind);
        Assert.True(fixture.Activity.Outcome?.RouteGenerated is true);
        Assert.Equal(1_250.5, fixture.Activity.Outcome?.DistanceMeters);
    }

    [Fact]
    public async Task Manual_regeneration_updates_same_row_and_clears_previous_failure()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.RouteWithTwoStopsAsync();
        var path = await fixture.AddPathAsync(route, stale: true, failure: "Eski güvenli hata");
        fixture.Routing.Succeed(ResultGeometry(30, 40, 31, 41), 900, 90);

        var result = await fixture.Service.GenerateRoutePathAsync(route.Id);

        Assert.True(result.IsSuccess);
        var stored = Assert.Single(await fixture.Db.TransportRoutePaths.ToListAsync());
        Assert.Equal(path.Id, stored.Id);
        Assert.Equal(900, stored.DistanceMeters);
        Assert.Equal(90, stored.DurationSeconds);
        Assert.False(stored.IsStale);
        Assert.Null(stored.LastFailureReason);
    }

    [Fact]
    public async Task Failed_first_generation_creates_no_path()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.RouteWithTwoStopsAsync();
        fixture.Routing.Fail(ServiceErrorKind.Upstream, "raw http://private:5000 detail");

        var result = await fixture.Service.GenerateRoutePathAsync(route.Id);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Upstream, result.ErrorKind);
        Assert.Empty(await fixture.Db.TransportRoutePaths.IgnoreQueryFilters().ToListAsync());
        Assert.DoesNotContain("private", result.Error);
    }

    [Fact]
    public async Task Safe_no_route_category_survives_the_transport_boundary()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.RouteWithTwoStopsAsync();
        fixture.Routing.Fail(ServiceErrorKind.Upstream, RouteGenerationMessages.NoRoute);

        var result = await fixture.Service.GenerateRoutePathAsync(route.Id);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Upstream, result.ErrorKind);
        Assert.Equal(RouteGenerationMessages.NoRoute, result.Error);
        Assert.True(fixture.Activity.Outcome?.RouteGenerated is false);
    }

    [Fact]
    public async Task Invalid_success_result_is_rejected_without_creating_a_path()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.RouteWithTwoStopsAsync();
        var wrongSrid = new LineString([new(30, 40), new(31, 41)]) { SRID = 3857 };
        fixture.Routing.Succeed(wrongSrid, 100, 10);

        var result = await fixture.Service.GenerateRoutePathAsync(route.Id);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Upstream, result.ErrorKind);
        Assert.Empty(await fixture.Db.TransportRoutePaths.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async Task Failed_regeneration_preserves_geometry_and_marks_existing_path_stale_safely()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.RouteWithTwoStopsAsync();
        var original = ResultGeometry(29, 39, 30, 40);
        var path = await fixture.AddPathAsync(route, geometry: original);
        fixture.Routing.Fail(ServiceErrorKind.Timeout, "container osrm-routed at http://localhost:5000");

        var result = await fixture.Service.GenerateRoutePathAsync(route.Id);

        Assert.False(result.IsSuccess);
        var stored = await fixture.Db.TransportRoutePaths.SingleAsync(item => item.Id == path.Id);
        Assert.True(stored.Geometry.EqualsExact(original));
        Assert.True(stored.IsStale);
        Assert.Equal(RouteGenerationMessages.Timeout, stored.LastFailureReason);
        Assert.DoesNotContain("localhost", stored.LastFailureReason);
    }

    [Fact]
    public async Task Obsolete_topology_snapshot_is_never_persisted_as_current()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.RouteWithTwoStopsAsync();
        var path = await fixture.AddPathAsync(route);
        fixture.Routing.Succeed(ResultGeometry(30, 40, 31, 41), 700, 70);
        fixture.Routing.OnRoute = () =>
        {
            var stop = fixture.Db.TransportStops.OrderBy(item => item.SequenceOrder).First();
            stop.Coordinate = new Point(35, 42) { SRID = 4326 };
            fixture.Db.SaveChanges();
        };

        var result = await fixture.Service.GenerateRoutePathAsync(route.Id);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, result.ErrorKind);
        var stored = await fixture.Db.TransportRoutePaths.SingleAsync(item => item.Id == path.Id);
        Assert.True(stored.IsStale);
        Assert.NotEqual(700, stored.DistanceMeters);
    }

    [Fact]
    public async Task Reorder_with_path_regenerates_from_new_order_and_updates_same_path()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var first = await fixture.AddStopAsync(route, 1, longitude: 30, latitude: 40);
        var second = await fixture.AddStopAsync(route, 2, longitude: 31, latitude: 41);
        var path = await fixture.AddPathAsync(route);
        fixture.Routing.Succeed(ResultGeometry(31, 41, 30, 40), 800, 80);

        var result = await fixture.Service.ReorderStopsAsync(
            route.Id,
            new ReorderTransportStopsRequest { StopIds = [second.Id, first.Id] });

        Assert.True(result.IsSuccess);
        Assert.Equal([second.Id, first.Id], result.Value!.Select(stop => stop.Id));
        var request = Assert.Single(fixture.Routing.Requests);
        Assert.Equal([(31d, 41d), (30d, 40d)], request.Waypoints.Select(point => (point.Longitude, point.Latitude)));
        var stored = await fixture.Db.TransportRoutePaths.SingleAsync();
        Assert.Equal(path.Id, stored.Id);
        Assert.False(stored.IsStale);
        Assert.Equal(800, stored.DistanceMeters);
        Assert.Equal(TransportActivityKind.StopReorder, fixture.Activity.Outcome?.Kind);
        Assert.Equal([second.Id, first.Id], fixture.Activity.Outcome?.OrderedStopIds);
        Assert.True(fixture.Activity.Outcome?.RouteGenerated is true);
    }

    [Fact]
    public async Task Failed_reorder_regeneration_keeps_new_order_and_old_geometry_stale()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var first = await fixture.AddStopAsync(route, 1);
        var second = await fixture.AddStopAsync(route, 2);
        var geometry = ResultGeometry(30, 40, 31, 41);
        await fixture.AddPathAsync(route, geometry: geometry);
        fixture.Routing.Fail(ServiceErrorKind.Upstream, "private upstream payload");

        var result = await fixture.Service.ReorderStopsAsync(
            route.Id,
            new ReorderTransportStopsRequest { StopIds = [second.Id, first.Id] });

        Assert.True(result.IsSuccess);
        Assert.Equal(
            [second.Id, first.Id],
            (await fixture.Db.TransportStops.OrderBy(stop => stop.SequenceOrder).ToListAsync()).Select(stop => stop.Id));
        var stored = await fixture.Db.TransportRoutePaths.SingleAsync();
        Assert.True(stored.Geometry.EqualsExact(geometry));
        Assert.True(stored.IsStale);
        Assert.Equal(RouteGenerationMessages.Unknown, stored.LastFailureReason);
        var status = await fixture.Service.GetRoutePathAsync(route.Id);
        Assert.True(status.Value!.IsStale);
        Assert.Equal(RouteGenerationMessages.Unknown, status.Value.LastFailureReason);
        Assert.Equal(TransportActivityKind.StopReorder, fixture.Activity.Outcome?.Kind);
        Assert.True(fixture.Activity.Outcome?.RouteGenerated is false);
    }

    [Fact]
    public async Task Reorder_without_path_never_calls_osrm()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var first = await fixture.AddStopAsync(route, 1);
        var second = await fixture.AddStopAsync(route, 2);

        var result = await fixture.Service.ReorderStopsAsync(
            route.Id,
            new ReorderTransportStopsRequest { StopIds = [second.Id, first.Id] });

        Assert.True(result.IsSuccess);
        Assert.Empty(fixture.Routing.Requests);
    }

    [Fact]
    public async Task Invalid_reorder_never_calls_osrm_or_changes_order()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var first = await fixture.AddStopAsync(route, 1);
        await fixture.AddStopAsync(route, 2);
        await fixture.AddPathAsync(route);

        var result = await fixture.Service.ReorderStopsAsync(
            route.Id,
            new ReorderTransportStopsRequest { StopIds = [first.Id, first.Id] });

        Assert.False(result.IsSuccess);
        Assert.Empty(fixture.Routing.Requests);
        Assert.Equal(1, (await fixture.Db.TransportStops.SingleAsync(stop => stop.Id == first.Id)).SequenceOrder);
    }

    [Fact]
    public async Task Stop_create_marks_existing_path_stale()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        await fixture.AddPathAsync(route);

        await fixture.Service.CreateStopAsync(new CreateTransportStopRequest
        {
            RouteId = route.Id, Name = "Yeni", Longitude = 32, Latitude = 41
        });

        Assert.True((await fixture.Db.TransportRoutePaths.SingleAsync()).IsStale);
    }

    [Fact]
    public async Task Stop_delete_marks_existing_path_stale()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var stop = await fixture.AddStopAsync(route, 1);
        await fixture.AddPathAsync(route);

        await fixture.Service.DeleteStopAsync(stop.Id);

        Assert.True((await fixture.Db.TransportRoutePaths.SingleAsync()).IsStale);
    }

    [Fact]
    public async Task Stop_restore_marks_existing_path_stale()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var stop = await fixture.AddStopAsync(route, 1, deleted: true);
        await fixture.AddPathAsync(route);

        await fixture.Service.RestoreStopAsync(stop.Id);

        Assert.True((await fixture.Db.TransportRoutePaths.SingleAsync()).IsStale);
    }

    [Fact]
    public async Task Coordinate_change_marks_existing_path_stale()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var stop = await fixture.AddStopAsync(route, 1);
        await fixture.AddPathAsync(route);

        await fixture.Service.UpdateStopAsync(stop.Id, new UpdateTransportStopRequest
        {
            RouteId = route.Id, Name = stop.Name, Longitude = 33, Latitude = 42
        });

        Assert.True((await fixture.Db.TransportRoutePaths.SingleAsync()).IsStale);
    }

    [Fact]
    public async Task Route_transfer_marks_both_existing_paths_stale()
    {
        await using var fixture = Fixture.Create();
        var oldRoute = await fixture.AddRouteAsync("Eski");
        var newRoute = await fixture.AddRouteAsync("Yeni");
        var stop = await fixture.AddStopAsync(oldRoute, 1);
        await fixture.AddPathAsync(oldRoute);
        await fixture.AddPathAsync(newRoute);

        await fixture.Service.UpdateStopAsync(stop.Id, new UpdateTransportStopRequest
        {
            RouteId = newRoute.Id, Name = stop.Name,
            Longitude = stop.Coordinate.X, Latitude = stop.Coordinate.Y
        });

        var paths = await fixture.Db.TransportRoutePaths.OrderBy(path => path.RouteId).ToListAsync();
        Assert.All(paths, path => Assert.True(path.IsStale));
    }

    [Fact]
    public async Task Name_only_stop_update_does_not_mark_path_stale()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var stop = await fixture.AddStopAsync(route, 1);
        await fixture.AddPathAsync(route);

        await fixture.Service.UpdateStopAsync(stop.Id, new UpdateTransportStopRequest
        {
            RouteId = route.Id, Name = "Yeni ad",
            Longitude = stop.Coordinate.X, Latitude = stop.Coordinate.Y
        });

        Assert.False((await fixture.Db.TransportRoutePaths.SingleAsync()).IsStale);
    }

    [Fact]
    public async Task Route_name_and_color_update_does_not_mark_path_stale()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        await fixture.AddPathAsync(route);

        await fixture.Service.UpdateRouteAsync(route.Id, new UpdateTransportRouteRequest
        {
            Name = "Yeni rota adı", ColorHex = "#ABCDEF"
        });

        Assert.False((await fixture.Db.TransportRoutePaths.SingleAsync()).IsStale);
    }

    [Fact]
    public async Task Route_soft_delete_and_restore_preserve_path_row_and_stale_state()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var path = await fixture.AddPathAsync(route, stale: false);

        await fixture.Service.DeleteRouteAsync(route.Id);

        Assert.Empty(await fixture.Db.TransportRoutePaths.ToListAsync());
        var storedWhileDeleted = await fixture.Db.TransportRoutePaths
            .IgnoreQueryFilters()
            .SingleAsync(item => item.Id == path.Id);
        Assert.False(storedWhileDeleted.IsStale);

        await fixture.Service.RestoreRouteAsync(route.Id);

        var restored = await fixture.Db.TransportRoutePaths.SingleAsync(item => item.Id == path.Id);
        Assert.False(restored.IsStale);
    }

    [Fact]
    public async Task Path_reads_expose_wkt_metrics_and_stale_status_with_distinct_missing_path_error()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        await fixture.AddPathAsync(route, stale: true, failure: "Rota hesaplanamadı.");

        var found = await fixture.Service.GetRoutePathAsync(route.Id);
        var routeWithoutPath = await fixture.AddRouteAsync("Yolsuz");
        var missing = await fixture.Service.GetRoutePathAsync(routeWithoutPath.Id);

        Assert.True(found.IsSuccess);
        Assert.StartsWith("LINESTRING", found.Value!.GeometryWkt);
        Assert.Equal(500, found.Value.DistanceMeters);
        Assert.Equal(50, found.Value.DurationSeconds);
        Assert.Equal("driving", found.Value.Profile);
        Assert.True(found.Value.IsStale);
        Assert.Equal("Rota hesaplanamadı.", found.Value.LastFailureReason);
        Assert.False(missing.IsSuccess);
        Assert.Contains("henüz", missing.Error);
    }

    [Fact]
    public async Task Map_path_list_is_one_set_query_and_excludes_deleted_or_inactive_routes()
    {
        await using var fixture = Fixture.Create();
        var active = await fixture.AddRouteAsync("Aktif");
        var deleted = await fixture.AddRouteAsync("Silinmiş", isDeleted: true);
        var inactive = await fixture.AddRouteAsync("Pasif", isActive: false);
        await fixture.AddPathAsync(active, stale: true);
        await fixture.AddPathAsync(deleted);
        await fixture.AddPathAsync(inactive);

        var result = await fixture.Service.GetRoutePathsAsync();

        var item = Assert.Single(result.Value!);
        Assert.Equal(active.Id, item.RouteId);
        Assert.Equal("Aktif", item.RouteName);
        Assert.Equal(active.ColorHex, item.ColorHex);
        Assert.True(item.IsStale);
        Assert.Empty(fixture.Routing.Requests);
    }

    [Fact]
    public void Path_endpoints_use_exact_permission_codes_and_accept_no_client_routing_inputs()
    {
        AssertEndpoint(nameof(TransportController.GetRoutePaths), typeof(HttpGetAttribute), "routes/paths", PermissionCodes.TransportView);
        AssertEndpoint(nameof(TransportController.GetRoutePath), typeof(HttpGetAttribute), "routes/{routeId:int}/path", PermissionCodes.TransportView);
        AssertEndpoint(nameof(TransportController.GenerateRoutePath), typeof(HttpPostAttribute), "routes/{routeId:int}/path/generate", PermissionCodes.TransportRouteUpdate);

        var generateParameters = typeof(TransportController)
            .GetMethod(nameof(TransportController.GenerateRoutePath))!
            .GetParameters()
            .Select(parameter => parameter.ParameterType)
            .ToArray();
        Assert.Equal([typeof(int), typeof(CancellationToken)], generateParameters);
        Assert.DoesNotContain(PermissionCodes.TransportRouteUpdate, RolePermissionDefaults.For(GisRoles.TransportUser));
        Assert.DoesNotContain(PermissionCodes.TransportRouteUpdate, RolePermissionDefaults.For(GisRoles.TransportOperator));
    }

    [Fact]
    public async Task Missing_route_update_permission_fails_closed_for_generation_policy()
    {
        var permissions = Substitute.For<IEffectivePermissionService>();
        permissions.HasPermissionAsync(42, PermissionCodes.TransportRouteUpdate, Arg.Any<CancellationToken>())
            .Returns(false);
        var requirement = new PermissionRequirement(PermissionCodes.TransportRouteUpdate);
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, "42")],
            "test"));
        var context = new AuthorizationHandlerContext([requirement], principal, resource: null);

        await new PermissionAuthorizationHandler(permissions).HandleAsync(context);

        Assert.False(context.HasSucceeded);
    }

    [Fact]
    public async Task Transport_view_permission_satisfies_path_read_policy()
    {
        var permissions = Substitute.For<IEffectivePermissionService>();
        permissions.HasPermissionAsync(42, PermissionCodes.TransportView, Arg.Any<CancellationToken>())
            .Returns(true);
        var requirement = new PermissionRequirement(PermissionCodes.TransportView);
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, "42")],
            "test"));
        var context = new AuthorizationHandlerContext([requirement], principal, resource: null);

        await new PermissionAuthorizationHandler(permissions).HandleAsync(context);

        Assert.True(context.HasSucceeded);
    }

    private static void AssertEndpoint(
        string methodName,
        Type httpAttributeType,
        string template,
        string permission)
    {
        var method = typeof(TransportController).GetMethod(methodName)!;
        var route = Assert.Single(method.GetCustomAttributes(httpAttributeType, true).Cast<HttpMethodAttribute>());
        var required = Assert.Single(method.GetCustomAttributes<RequirePermissionAttribute>(true));
        Assert.Equal(template, route.Template);
        Assert.Equal(permission, required.PermissionCode);
    }

    private static LineString ResultGeometry(double x1, double y1, double x2, double y2) =>
        new([new(x1, y1), new(x2, y2)]) { SRID = 4326 };

    private sealed class Fixture : IAsyncDisposable
    {
        private Fixture(AppDbContext db, FakeRoutingService routing)
        {
            Db = db;
            Routing = routing;
            var currentUser = Substitute.For<ICurrentUserService>();
            currentUser.UserId.Returns(42);
            currentUser.IsAuthenticated.Returns(true);
            var geography = Substitute.For<IGeographicAuthorizationService>();
            geography.GetEffectiveAuthorizationAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
                .Returns(EffectiveGeographicAuthorization.Unrestricted);
            Activity = new TransportActivityContext();
            Service = new TransportService(db, currentUser, geography, routing, Activity);
        }

        public AppDbContext Db { get; }
        public FakeRoutingService Routing { get; }
        public TransportActivityContext Activity { get; }
        public TransportService Service { get; }

        public static Fixture Create()
        {
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase($"smart-transport-route-generation-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;
            return new Fixture(new AppDbContext(options), new FakeRoutingService());
        }

        public async Task<TransportRoute> AddRouteAsync(
            string name = "Hat",
            bool isActive = true,
            bool isDeleted = false)
        {
            var route = new TransportRoute
            {
                Name = name,
                ColorHex = "#123456",
                IsActive = isActive,
                IsDeleted = isDeleted,
                CreatedDate = DateTime.UtcNow
            };
            Db.TransportRoutes.Add(route);
            await Db.SaveChangesAsync();
            return route;
        }

        public async Task<TransportRoute> RouteWithTwoStopsAsync()
        {
            var route = await AddRouteAsync();
            await AddStopAsync(route, 1, longitude: 30, latitude: 40);
            await AddStopAsync(route, 2, longitude: 31, latitude: 41);
            return route;
        }

        public async Task<TransportStop> AddStopAsync(
            TransportRoute route,
            int sequence,
            bool deleted = false,
            bool active = true,
            double longitude = 30,
            double latitude = 40)
        {
            var stop = new TransportStop
            {
                Route = route,
                RouteId = route.Id,
                UserId = 42,
                Name = $"Durak {sequence}",
                Coordinate = new Point(longitude, latitude) { SRID = 4326 },
                SequenceOrder = sequence,
                IsActive = active,
                IsDeleted = deleted,
                CreatedDate = DateTime.UtcNow
            };
            Db.TransportStops.Add(stop);
            await Db.SaveChangesAsync();
            return stop;
        }

        public async Task<TransportRoutePath> AddPathAsync(
            TransportRoute route,
            bool stale = false,
            string? failure = null,
            LineString? geometry = null)
        {
            var now = DateTime.UtcNow;
            var path = new TransportRoutePath
            {
                Route = route,
                RouteId = route.Id,
                Geometry = geometry ?? ResultGeometry(29, 39, 30, 40),
                DistanceMeters = 500,
                DurationSeconds = 50,
                Profile = "driving",
                GeneratedAt = now,
                IsStale = stale,
                LastFailureReason = failure,
                ModifiedDate = now
            };
            Db.TransportRoutePaths.Add(path);
            await Db.SaveChangesAsync();
            return path;
        }

        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }

    private sealed class FakeRoutingService : IOsrmRoutingService
    {
        private ServiceResult<OsrmRouteResult>? _result;

        public List<OsrmRouteRequest> Requests { get; } = [];
        public Action? OnRoute { get; set; }

        public void Succeed(LineString geometry, double distance, double duration) =>
            _result = ServiceResult<OsrmRouteResult>.Success(
                new OsrmRouteResult(geometry, distance, duration, "driving"));

        public void Fail(ServiceErrorKind kind, string message) => _result = kind switch
        {
            ServiceErrorKind.Timeout => ServiceResult<OsrmRouteResult>.Timeout(message),
            _ => ServiceResult<OsrmRouteResult>.Upstream(message)
        };

        public Task<ServiceResult<OsrmRouteResult>> RouteAsync(
            OsrmRouteRequest request,
            CancellationToken cancellationToken = default)
        {
            Requests.Add(request);
            OnRoute?.Invoke();
            return Task.FromResult(_result ?? throw new InvalidOperationException("Test routing result was not configured."));
        }
    }
}
