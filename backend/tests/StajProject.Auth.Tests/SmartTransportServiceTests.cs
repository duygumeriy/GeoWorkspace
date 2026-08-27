using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using NetTopologySuite.Geometries;
using NSubstitute;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Geographic;
using StajProject.Application.Interfaces;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

public class SmartTransportServiceTests
{
    [Fact]
    public async Task Route_create_normalizes_valid_color_and_rejects_invalid_color()
    {
        await using var fixture = Fixture.Create();

        var valid = await fixture.Service.CreateRouteAsync(new CreateTransportRouteRequest
        {
            Name = "Merkez Hattı",
            ColorHex = "#a1b2c3"
        });
        var invalid = await fixture.Service.CreateRouteAsync(new CreateTransportRouteRequest
        {
            Name = "Hatalı Hat",
            ColorHex = "a1b2c3"
        });

        Assert.True(valid.IsSuccess);
        Assert.Equal("#A1B2C3", valid.Value!.ColorHex);
        Assert.False(invalid.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, invalid.ErrorKind);
        Assert.Single(await fixture.Db.TransportRoutes.ToListAsync());
    }

    [Fact]
    public async Task Route_soft_delete_and_restore_preserve_individually_deleted_stops()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync("Hat A");
        var activeStop = await fixture.AddStopAsync(route, "Aktif", 1);
        var deletedStop = await fixture.AddStopAsync(route, "Silinmiş", 2, isDeleted: true);

        var deleted = await fixture.Service.DeleteRouteAsync(route.Id);

        Assert.True(deleted.IsSuccess);
        var storedRoute = await fixture.Db.TransportRoutes.IgnoreQueryFilters().SingleAsync(item => item.Id == route.Id);
        var storedStops = await fixture.Db.TransportStops.IgnoreQueryFilters().Where(item => item.RouteId == route.Id).ToListAsync();
        Assert.True(storedRoute.IsDeleted);
        Assert.False(storedStops.Single(item => item.Id == activeStop.Id).IsDeleted);
        Assert.True(storedStops.Single(item => item.Id == deletedStop.Id).IsDeleted);
        Assert.False((await fixture.Service.GetRouteAsync(route.Id)).IsSuccess);

        var restored = await fixture.Service.RestoreRouteAsync(route.Id);

        Assert.True(restored.IsSuccess);
        Assert.True((await fixture.Service.GetRouteAsync(route.Id)).IsSuccess);
        Assert.True((await fixture.Db.TransportStops.IgnoreQueryFilters().SingleAsync(item => item.Id == deletedStop.Id)).IsDeleted);
    }

    [Fact]
    public async Task Stop_create_writes_srid_4326_and_appends_after_active_maximum()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync("Hat A");
        await fixture.AddStopAsync(route, "Bir", 2);
        await fixture.AddStopAsync(route, "İki", 5);
        await fixture.AddStopAsync(route, "Silinmiş", 99, isDeleted: true);

        var result = await fixture.Service.CreateStopAsync(StopRequest(route.Id, "Yeni", 32.85, 39.93));

        Assert.True(result.IsSuccess);
        var stored = await fixture.Db.TransportStops.SingleAsync(item => item.Id == result.Value!.Id);
        Assert.Equal(4326, stored.Coordinate.SRID);
        Assert.Equal(32.85, stored.Coordinate.X, 9);
        Assert.Equal(39.93, stored.Coordinate.Y, 9);
        Assert.Equal(6, stored.SequenceOrder);
    }

    [Theory]
    [InlineData(true, true)]
    [InlineData(false, false)]
    public async Task Stop_create_rejects_deleted_or_inactive_route(bool isActive, bool isDeleted)
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync("Kapalı Hat", isActive, isDeleted);

        var result = await fixture.Service.CreateStopAsync(StopRequest(route.Id, "Durak", 30, 40));

        Assert.False(result.IsSuccess);
        Assert.Empty(await fixture.Db.TransportStops.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async Task Same_route_stop_update_preserves_sequence_order()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync("Hat A");
        var stop = await fixture.AddStopAsync(route, "Eski Ad", 7, longitude: 30, latitude: 40);

        var result = await fixture.Service.UpdateStopAsync(stop.Id, StopUpdate(route.Id, "Yeni Ad", 31, 41));

        Assert.True(result.IsSuccess);
        Assert.Equal(7, result.Value!.SequenceOrder);
        var stored = await fixture.Db.TransportStops.SingleAsync(item => item.Id == stop.Id);
        Assert.Equal(7, stored.SequenceOrder);
        Assert.Equal("Yeni Ad", stored.Name);
        Assert.Equal(31, stored.Coordinate.X);
        Assert.Equal(41, stored.Coordinate.Y);
    }

    [Fact]
    public async Task Route_transfer_compacts_old_route_and_appends_to_destination_transactionally()
    {
        await using var fixture = Fixture.Create();
        var oldRoute = await fixture.AddRouteAsync("Hat A");
        var destination = await fixture.AddRouteAsync("Hat B");
        var first = await fixture.AddStopAsync(oldRoute, "A1", 1);
        var moving = await fixture.AddStopAsync(oldRoute, "A2", 2);
        var last = await fixture.AddStopAsync(oldRoute, "A3", 3);
        await fixture.AddStopAsync(destination, "B1", 1);
        await fixture.AddStopAsync(destination, "B2", 4);

        var result = await fixture.Service.UpdateStopAsync(
            moving.Id,
            StopUpdate(destination.Id, "Taşınan", moving.Coordinate.X, moving.Coordinate.Y));

        Assert.True(result.IsSuccess);
        var oldStops = await fixture.Db.TransportStops
            .Where(item => item.RouteId == oldRoute.Id)
            .OrderBy(item => item.SequenceOrder)
            .ToListAsync();
        Assert.Equal([first.Id, last.Id], oldStops.Select(item => item.Id));
        Assert.Equal([1, 2], oldStops.Select(item => item.SequenceOrder));
        var transferred = await fixture.Db.TransportStops.SingleAsync(item => item.Id == moving.Id);
        Assert.Equal(destination.Id, transferred.RouteId);
        Assert.Equal(5, transferred.SequenceOrder);
    }

    [Fact]
    public async Task Stop_soft_delete_marks_stop_and_compacts_remaining_sequence()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync("Hat A");
        var first = await fixture.AddStopAsync(route, "Bir", 1);
        var deleted = await fixture.AddStopAsync(route, "İki", 2);
        var last = await fixture.AddStopAsync(route, "Üç", 3);

        var result = await fixture.Service.DeleteStopAsync(deleted.Id);

        Assert.True(result.IsSuccess);
        Assert.True((await fixture.Db.TransportStops.IgnoreQueryFilters().SingleAsync(item => item.Id == deleted.Id)).IsDeleted);
        var remaining = await fixture.Db.TransportStops.Where(item => item.RouteId == route.Id).OrderBy(item => item.SequenceOrder).ToListAsync();
        Assert.Equal([first.Id, last.Id], remaining.Select(item => item.Id));
        Assert.Equal([1, 2], remaining.Select(item => item.SequenceOrder));
    }

    [Fact]
    public async Task Stop_restore_rejects_unavailable_parent_route()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync("Silinmiş Hat", isDeleted: true);
        var stop = await fixture.AddStopAsync(route, "Silinmiş Durak", 1, isDeleted: true);

        var result = await fixture.Service.RestoreStopAsync(stop.Id);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, result.ErrorKind);
        Assert.True((await fixture.Db.TransportStops.IgnoreQueryFilters().SingleAsync(item => item.Id == stop.Id)).IsDeleted);
    }

    [Fact]
    public async Task Stop_restore_appends_to_end_instead_of_reusing_old_sequence()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync("Hat A");
        var restored = await fixture.AddStopAsync(route, "Geri Gelen", 1, isDeleted: true);
        await fixture.AddStopAsync(route, "Bir", 1);
        await fixture.AddStopAsync(route, "Üç", 3);

        var result = await fixture.Service.RestoreStopAsync(restored.Id);

        Assert.True(result.IsSuccess);
        Assert.Equal(4, result.Value!.SequenceOrder);
        var stored = await fixture.Db.TransportStops.SingleAsync(item => item.Id == restored.Id);
        Assert.False(stored.IsDeleted);
        Assert.Equal(4, stored.SequenceOrder);
    }

    [Fact]
    public async Task Reorder_accepts_exact_active_permutation_and_writes_one_based_sequence()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync("Hat A");
        var first = await fixture.AddStopAsync(route, "Bir", 1);
        var second = await fixture.AddStopAsync(route, "İki", 2);
        var third = await fixture.AddStopAsync(route, "Üç", 3);

        var result = await fixture.Service.ReorderStopsAsync(route.Id, new ReorderTransportStopsRequest
        {
            StopIds = [third.Id, first.Id, second.Id]
        });

        Assert.True(result.IsSuccess);
        Assert.Equal([third.Id, first.Id, second.Id], result.Value!.Select(item => item.Id));
        var stored = await fixture.Db.TransportStops.Where(item => item.RouteId == route.Id).OrderBy(item => item.SequenceOrder).ToListAsync();
        Assert.Equal([third.Id, first.Id, second.Id], stored.Select(item => item.Id));
        Assert.Equal([1, 2, 3], stored.Select(item => item.SequenceOrder));
    }

    [Fact]
    public async Task Reorder_rejects_duplicate_ids()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync("Hat A");
        var first = await fixture.AddStopAsync(route, "Bir", 1);
        await fixture.AddStopAsync(route, "İki", 2);

        var result = await fixture.Service.ReorderStopsAsync(route.Id, new ReorderTransportStopsRequest
        {
            StopIds = [first.Id, first.Id]
        });

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("foreign")]
    [InlineData("deleted")]
    public async Task Reorder_rejects_non_exact_stop_sets(string scenario)
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync("Hat A");
        var otherRoute = await fixture.AddRouteAsync("Hat B");
        var first = await fixture.AddStopAsync(route, "Bir", 1);
        var second = await fixture.AddStopAsync(route, "İki", 2);
        var foreign = await fixture.AddStopAsync(otherRoute, "Yabancı", 1);
        var deleted = await fixture.AddStopAsync(route, "Silinmiş", 3, isDeleted: true);
        IReadOnlyList<int> ids = scenario switch
        {
            "missing" => [first.Id],
            "foreign" => [first.Id, second.Id, foreign.Id],
            "deleted" => [first.Id, second.Id, deleted.Id],
            _ => throw new ArgumentOutOfRangeException(nameof(scenario))
        };

        var result = await fixture.Service.ReorderStopsAsync(route.Id, new ReorderTransportStopsRequest { StopIds = ids });

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
        Assert.Equal(1, (await fixture.Db.TransportStops.SingleAsync(item => item.Id == first.Id)).SequenceOrder);
        Assert.Equal(2, (await fixture.Db.TransportStops.SingleAsync(item => item.Id == second.Id)).SequenceOrder);
    }

    [Fact]
    public async Task Trash_reads_return_only_deleted_routes_and_stops()
    {
        await using var fixture = Fixture.Create();
        var activeRoute = await fixture.AddRouteAsync("Aktif Hat");
        var deletedRoute = await fixture.AddRouteAsync("Silinmiş Hat", isDeleted: true);
        await fixture.AddStopAsync(activeRoute, "Aktif Durak", 1);
        var deletedStop = await fixture.AddStopAsync(activeRoute, "Silinmiş Durak", 2, isDeleted: true);

        var routes = await fixture.Service.GetRouteTrashAsync();
        var stops = await fixture.Service.GetStopTrashAsync();

        Assert.True(routes.IsSuccess);
        Assert.Equal([deletedRoute.Id], routes.Value!.Select(item => item.Id));
        Assert.True(stops.IsSuccess);
        Assert.Equal([deletedStop.Id], stops.Value!.Select(item => item.Id));
    }

    [Fact]
    public async Task Geographic_authorization_rejects_out_of_area_stop_create()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync("Hat A");
        fixture.RestrictTo(Box(0, 0, 10, 10));

        var result = await fixture.Service.CreateStopAsync(StopRequest(route.Id, "Dışarıda", 20, 20));

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
        Assert.Empty(await fixture.Db.TransportStops.ToListAsync());
    }

    [Fact]
    public async Task Geographic_authorization_rejects_out_of_area_coordinate_move()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync("Hat A");
        var stop = await fixture.AddStopAsync(route, "Durak", 1, longitude: 5, latitude: 5);
        fixture.RestrictTo(Box(0, 0, 10, 10));

        var result = await fixture.Service.UpdateStopAsync(stop.Id, StopUpdate(route.Id, "Durak", 20, 20));

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
        var stored = await fixture.Db.TransportStops.SingleAsync(item => item.Id == stop.Id);
        Assert.Equal(5, stored.Coordinate.X);
        Assert.Equal(5, stored.Coordinate.Y);
    }

    [Fact]
    public async Task Unrestricted_user_can_create_stop()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync("Hat A");

        var result = await fixture.Service.CreateStopAsync(StopRequest(route.Id, "Serbest", 120, -40));

        Assert.True(result.IsSuccess);
        Assert.Single(await fixture.Db.TransportStops.ToListAsync());
    }

    private static CreateTransportStopRequest StopRequest(
        int routeId,
        string name,
        double longitude,
        double latitude) => new()
    {
        Name = name,
        RouteId = routeId,
        Longitude = longitude,
        Latitude = latitude
    };

    private static UpdateTransportStopRequest StopUpdate(
        int routeId,
        string name,
        double longitude,
        double latitude) => new()
    {
        Name = name,
        RouteId = routeId,
        Longitude = longitude,
        Latitude = latitude
    };

    private static Polygon Box(double minX, double minY, double maxX, double maxY) =>
        new GeometryFactory(new PrecisionModel(), 4326).CreatePolygon(
        [
            new Coordinate(minX, minY),
            new Coordinate(maxX, minY),
            new Coordinate(maxX, maxY),
            new Coordinate(minX, maxY),
            new Coordinate(minX, minY)
        ]);

    private sealed class Fixture : IAsyncDisposable
    {
        private Fixture(
            AppDbContext db,
            ICurrentUserService currentUser,
            IGeographicAuthorizationService geography)
        {
            Db = db;
            CurrentUser = currentUser;
            Geography = geography;
            Service = new TransportService(db, currentUser, geography);
        }

        public AppDbContext Db { get; }
        public ICurrentUserService CurrentUser { get; }
        public IGeographicAuthorizationService Geography { get; }
        public TransportService Service { get; }

        public static Fixture Create()
        {
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase($"smart-transport-service-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;

            var db = new AppDbContext(options);
            var currentUser = Substitute.For<ICurrentUserService>();
            var geography = Substitute.For<IGeographicAuthorizationService>();
            currentUser.UserId.Returns(42);
            currentUser.IsAuthenticated.Returns(true);
            geography.GetEffectiveAuthorizationAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
                .Returns(EffectiveGeographicAuthorization.Unrestricted);

            return new Fixture(db, currentUser, geography);
        }

        public void RestrictTo(Geometry area) =>
            Geography.GetEffectiveAuthorizationAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
                .Returns(EffectiveGeographicAuthorization.Restricted(area));

        public async Task<TransportRoute> AddRouteAsync(
            string name,
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

        public async Task<TransportStop> AddStopAsync(
            TransportRoute route,
            string name,
            int sequenceOrder,
            bool isDeleted = false,
            bool isActive = true,
            double longitude = 30,
            double latitude = 40)
        {
            var stop = new TransportStop
            {
                RouteId = route.Id,
                UserId = 42,
                Name = name,
                Coordinate = new Point(longitude, latitude) { SRID = 4326 },
                SequenceOrder = sequenceOrder,
                IsActive = isActive,
                IsDeleted = isDeleted,
                CreatedDate = DateTime.UtcNow
            };

            Db.TransportStops.Add(stop);
            await Db.SaveChangesAsync();
            return stop;
        }

        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }
}
