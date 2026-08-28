using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using NetTopologySuite.Geometries;
using NSubstitute;
using StajProject.Application.DTOs;
using StajProject.Application.Geographic;
using StajProject.Application.Interfaces;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Persistence.Migrations;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

public class SmartTransportOwnershipTests
{
    [Fact]
    public void Stop_uses_nullable_project_standard_user_ownership_mapping()
    {
        using var fixture = Fixture.Create();
        var entity = fixture.Db.Model.FindEntityType(typeof(TransportStop))!;
        var property = entity.FindProperty(nameof(TransportStop.UserId))!;
        var foreignKey = Assert.Single(entity.GetForeignKeys().Where(key => key.Properties.Contains(property)));
        Assert.True(property.IsNullable);
        Assert.Equal("user_id", property.GetColumnName());
        Assert.Equal(typeof(User), foreignKey.PrincipalEntityType.ClrType);
        Assert.Equal(DeleteBehavior.Restrict, foreignKey.DeleteBehavior);
        Assert.Contains(entity.GetIndexes(), index => index.Properties.SequenceEqual([property]));
    }

    [Fact]
    public async Task Create_stores_authenticated_current_user()
    {
        using var fixture = Fixture.Create(101);
        var route = await fixture.RouteAsync();
        var result = await fixture.Service.CreateStopAsync(Request(route.Id));
        Assert.True(result.IsSuccess);
        Assert.Equal(101, (await fixture.StopAsync(result.Value!.Id)).UserId);
    }

    [Fact]
    public void Create_contract_does_not_accept_client_owner_fields()
    {
        var properties = typeof(CreateTransportStopRequest).GetProperties().Select(property => property.Name).ToArray();
        Assert.DoesNotContain(properties, name => name.Contains("User", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(properties, name => name.Contains("Owner", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Mine_returns_current_users_stop()
    {
        using var fixture = Fixture.Create(101);
        var route = await fixture.RouteAsync();
        var own = await fixture.AddStopAsync(route.Id, 101, "Benim");
        Assert.Equal(own.Id, Assert.Single((await fixture.Service.GetOwnStopsAsync()).Value!).Id);
    }

    [Fact]
    public async Task Mine_excludes_another_users_stop()
    {
        using var fixture = Fixture.Create(101);
        var route = await fixture.RouteAsync();
        await fixture.AddStopAsync(route.Id, 202, "Başkasının");
        Assert.Empty((await fixture.Service.GetOwnStopsAsync()).Value!);
    }

    [Fact]
    public async Task Mine_excludes_legacy_unowned_stop()
    {
        using var fixture = Fixture.Create(101);
        var route = await fixture.RouteAsync();
        await fixture.AddStopAsync(route.Id, null, "Legacy");
        Assert.Empty((await fixture.Service.GetOwnStopsAsync()).Value!);
    }

    [Fact]
    public async Task Global_route_read_remains_shared_and_includes_unowned_stop()
    {
        using var fixture = Fixture.Create(101);
        var route = await fixture.RouteAsync();
        var foreign = await fixture.AddStopAsync(route.Id, 202, "Ortak");
        var legacy = await fixture.AddStopAsync(route.Id, null, "Legacy", 2);
        Assert.Equal([foreign.Id, legacy.Id], (await fixture.Service.GetRouteStopsAsync(route.Id)).Value!.Select(stop => stop.Id));
    }

    [Fact]
    public async Task Central_stop_read_returns_all_active_stops_in_one_set()
    {
        using var fixture = Fixture.Create(101);
        var firstRoute = await fixture.RouteAsync("A");
        var secondRoute = await fixture.RouteAsync("B");
        var own = await fixture.AddStopAsync(firstRoute.Id, 101, "Benim");
        var foreign = await fixture.AddStopAsync(secondRoute.Id, 202, "Ortak");
        await fixture.AddStopAsync(firstRoute.Id, 101, "Silinmiş", 2, true);

        var result = await fixture.Service.GetStopsAsync();

        Assert.Equal([own.Id, foreign.Id], result.Value!.Select(stop => stop.Id).OrderBy(id => id));
        Assert.All(result.Value!, stop => Assert.False(stop.IsDeleted));
    }

    [Fact]
    public async Task Central_deleted_stop_read_is_not_limited_to_the_current_owner()
    {
        using var fixture = Fixture.Create(101);
        var route = await fixture.RouteAsync();
        var own = await fixture.AddStopAsync(route.Id, 101, "Benim", 1, true);
        var foreign = await fixture.AddStopAsync(route.Id, 202, "Ortak", 2, true);

        var result = await fixture.Service.GetDeletedStopsAsync();

        Assert.Equal([own.Id, foreign.Id], result.Value!.Select(stop => stop.Id).OrderBy(id => id));
        Assert.All(result.Value!, stop => Assert.True(stop.IsDeleted));
    }

    [Fact]
    public async Task Ownership_does_not_break_route_association()
    {
        using var fixture = Fixture.Create(101);
        var route = await fixture.RouteAsync();
        var created = await fixture.Service.CreateStopAsync(Request(route.Id));
        Assert.Equal(route.Id, (await fixture.StopAsync(created.Value!.Id)).RouteId);
    }

    [Fact]
    public async Task Create_keeps_srid_4326()
    {
        using var fixture = Fixture.Create(101);
        var route = await fixture.RouteAsync();
        var created = await fixture.Service.CreateStopAsync(Request(route.Id));
        Assert.Equal(4326, (await fixture.StopAsync(created.Value!.Id)).Coordinate.SRID);
    }

    [Fact]
    public async Task Create_still_obeys_geographic_authorization()
    {
        using var fixture = Fixture.Create(101);
        var route = await fixture.RouteAsync();
        fixture.Geography.GetEffectiveAuthorizationAsync(101, Arg.Any<CancellationToken>())
            .Returns(EffectiveGeographicAuthorization.Restricted(Box(0, 0, 1, 1)));
        var result = await fixture.Service.CreateStopAsync(Request(route.Id));
        Assert.False(result.IsSuccess);
        Assert.Empty(fixture.Db.TransportStops);
    }

    [Fact]
    public async Task Update_preserves_owner()
    {
        using var fixture = Fixture.Create(101);
        var route = await fixture.RouteAsync();
        var stop = await fixture.AddStopAsync(route.Id, 101);
        await fixture.Service.UpdateStopAsync(stop.Id, Update(route.Id));
        Assert.Equal(101, (await fixture.StopAsync(stop.Id)).UserId);
    }

    [Fact]
    public async Task Moving_between_routes_preserves_owner()
    {
        using var fixture = Fixture.Create(101);
        var source = await fixture.RouteAsync("A");
        var destination = await fixture.RouteAsync("B");
        var stop = await fixture.AddStopAsync(source.Id, 101);
        await fixture.Service.UpdateStopAsync(stop.Id, Update(destination.Id));
        Assert.Equal(101, (await fixture.StopAsync(stop.Id)).UserId);
    }

    [Fact]
    public async Task Reorder_preserves_owner()
    {
        using var fixture = Fixture.Create(101);
        var route = await fixture.RouteAsync();
        var first = await fixture.AddStopAsync(route.Id, 101, "Bir");
        var second = await fixture.AddStopAsync(route.Id, 202, "İki", 2);
        await fixture.Service.ReorderStopsAsync(route.Id, new ReorderTransportStopsRequest { StopIds = [second.Id, first.Id] });
        Assert.Equal(101, (await fixture.StopAsync(first.Id)).UserId);
        Assert.Equal(202, (await fixture.StopAsync(second.Id)).UserId);
    }

    [Fact]
    public async Task Soft_delete_preserves_owner_and_personal_trash_scope()
    {
        using var fixture = Fixture.Create(101);
        var route = await fixture.RouteAsync();
        var own = await fixture.AddStopAsync(route.Id, 101, "Benim");
        await fixture.AddStopAsync(route.Id, 202, "Yabancı", 2, true);
        await fixture.Service.DeleteStopAsync(own.Id);
        Assert.Equal(101, (await fixture.StopAsync(own.Id)).UserId);
        Assert.Equal(own.Id, Assert.Single((await fixture.Service.GetStopTrashAsync()).Value!).Id);
    }

    [Fact]
    public async Task Restore_preserves_owner_and_appends_to_end()
    {
        using var fixture = Fixture.Create(101);
        var route = await fixture.RouteAsync();
        var deleted = await fixture.AddStopAsync(route.Id, 101, "Silinmiş", 1, true);
        await fixture.AddStopAsync(route.Id, 202, "Aktif", 1);
        var restored = await fixture.Service.RestoreStopAsync(deleted.Id);
        Assert.Equal(101, (await fixture.StopAsync(deleted.Id)).UserId);
        Assert.Equal(2, restored.Value!.SequenceOrder);
    }

    [Fact]
    public void Ownership_migration_exists_and_keeps_legacy_state_nullable()
    {
        Assert.Equal(nameof(AddTransportStopOwnership), typeof(AddTransportStopOwnership).Name);
        using var fixture = Fixture.Create();
        Assert.True(fixture.Db.Model.FindEntityType(typeof(TransportStop))!.FindProperty(nameof(TransportStop.UserId))!.IsNullable);
    }

    private static CreateTransportStopRequest Request(int routeId) => new() { RouteId = routeId, Name = "Durak", Longitude = 32.85, Latitude = 39.93 };
    private static UpdateTransportStopRequest Update(int routeId) => new() { RouteId = routeId, Name = "Güncel", Longitude = 32.86, Latitude = 39.94 };
    private static Polygon Box(double minX, double minY, double maxX, double maxY) => new GeometryFactory(new PrecisionModel(), 4326).CreatePolygon([
        new(minX, minY), new(maxX, minY), new(maxX, maxY), new(minX, maxY), new(minX, minY)
    ]);

    private sealed class Fixture : IDisposable
    {
        private Fixture(AppDbContext db, ICurrentUserService currentUser, IGeographicAuthorizationService geography)
        {
            Db = db;
            Geography = geography;
            Service = new TransportService(db, currentUser, geography, Substitute.For<IOsrmRoutingService>());
        }

        public AppDbContext Db { get; }
        public IGeographicAuthorizationService Geography { get; }
        public TransportService Service { get; }

        public static Fixture Create(int? userId = 101)
        {
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase($"transport-ownership-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;
            var currentUser = Substitute.For<ICurrentUserService>();
            currentUser.UserId.Returns(userId);
            currentUser.IsAuthenticated.Returns(userId is not null);
            var geography = Substitute.For<IGeographicAuthorizationService>();
            geography.GetEffectiveAuthorizationAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
                .Returns(EffectiveGeographicAuthorization.Unrestricted);
            return new Fixture(new AppDbContext(options), currentUser, geography);
        }

        public async Task<TransportRoute> RouteAsync(string name = "Hat")
        {
            var route = new TransportRoute { Name = name, ColorHex = "#123456", IsActive = true, CreatedDate = DateTime.UtcNow };
            Db.TransportRoutes.Add(route);
            await Db.SaveChangesAsync();
            return route;
        }

        public async Task<TransportStop> AddStopAsync(int routeId, int? userId, string name = "Durak", int sequence = 1, bool deleted = false)
        {
            var stop = new TransportStop { RouteId = routeId, UserId = userId, Name = name, Coordinate = new Point(30, 40) { SRID = 4326 }, SequenceOrder = sequence, IsActive = true, IsDeleted = deleted, CreatedDate = DateTime.UtcNow };
            Db.TransportStops.Add(stop);
            await Db.SaveChangesAsync();
            return stop;
        }

        public Task<TransportStop> StopAsync(int id) => Db.TransportStops.IgnoreQueryFilters().SingleAsync(stop => stop.Id == id);
        public void Dispose() => Db.Dispose();
    }
}
