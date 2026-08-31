using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;
using NetTopologySuite.Geometries;
using NSubstitute;
using StajProject.Application.Activity;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Geographic;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Application.Routing;
using StajProject.Application.Simulation;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;
using StajProject.Infrastructure.Simulation;

namespace StajProject.Auth.Tests;

/// <summary>
/// Güzergah geçersizleştiğinde çalışan simülasyon devam ETMEZ.
/// </summary>
/// <remarks>
/// <para>
/// İptal, ulaşım servisinin yolu bayatlattığı/değiştirdiği MERKEZİ noktalardan
/// tetiklenir; controller'lara ya da tek tek CRUD metotlarına iptal kodu
/// yayılmaz. Bu testler kancanın o merkezde durduğunu ve mevcut ulaşım
/// davranışını değiştirmediğini sabitler.
/// </para>
/// </remarks>
public sealed class TransportSimulationInvalidationTests
{
    [Fact]
    public async Task Adding_a_stop_makes_the_path_stale_and_cancels_the_running_simulation()
    {
        await using var fixture = await Fixture.CreateAsync();
        var simulation = fixture.StartSimulation();

        var result = await fixture.Transport.CreateStopAsync(new CreateTransportStopRequest
        {
            Name = "Yeni Durak",
            RouteId = fixture.RouteId,
            Longitude = 32.85,
            Latitude = 39.93
        });

        Assert.True(result.IsSuccess);

        // Mevcut davranış korunur: yol bayatlar…
        var path = await fixture.Db.TransportRoutePaths.AsNoTracking().SingleAsync();
        Assert.True(path.IsStale);

        // …ve araç eski geometride yürümeye DEVAM ETMEZ.
        Assert.Null(fixture.Store.Find(fixture.RouteId));
        var update = Assert.Single(fixture.Broadcaster.Updates);
        Assert.Equal(TransportSimulationStatus.Cancelled, update.Status);
        Assert.Equal(simulation.SimulationId, update.SimulationId);
    }

    [Fact]
    public async Task Regenerating_the_path_cancels_the_running_simulation()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.AddStopAsync(1, 32.80, 39.90);
        await fixture.AddStopAsync(2, 32.90, 39.95);
        fixture.Routing.Succeed();
        fixture.StartSimulation();

        var result = await fixture.Transport.GenerateRoutePathAsync(fixture.RouteId);

        Assert.True(result.IsSuccess);
        Assert.Null(fixture.Store.Find(fixture.RouteId));
        Assert.Equal(
            TransportSimulationStatus.Cancelled,
            Assert.Single(fixture.Broadcaster.Updates).Status);
    }

    [Fact]
    public async Task A_failed_regeneration_also_cancels_because_the_path_is_left_stale()
    {
        /* Yolun üretilememesi de "otoriter geometri artık güvenilir değil"
           demektir: kayıt bayat işaretlenir, dolayısıyla simülasyon da durur. */
        await using var fixture = await Fixture.CreateAsync();
        fixture.StartSimulation();

        // Tek durak bile yok: üretim OSRM'e hiç gitmeden başarısız olur.
        var result = await fixture.Transport.GenerateRoutePathAsync(fixture.RouteId);

        Assert.False(result.IsSuccess);
        Assert.Empty(fixture.Routing.Requests);
        Assert.Null(fixture.Store.Find(fixture.RouteId));
        Assert.Equal(
            TransportSimulationStatus.Cancelled,
            Assert.Single(fixture.Broadcaster.Updates).Status);
    }

    [Fact]
    public async Task Cancellation_is_scoped_to_the_affected_route()
    {
        await using var fixture = await Fixture.CreateAsync();
        fixture.StartSimulation();
        var untouched = fixture.StartSimulation(routeId: 4_242);

        await fixture.Transport.CreateStopAsync(new CreateTransportStopRequest
        {
            Name = "Yeni Durak",
            RouteId = fixture.RouteId,
            Longitude = 32.85,
            Latitude = 39.93
        });

        Assert.Null(fixture.Store.Find(fixture.RouteId));
        Assert.Equal(untouched.SimulationId, fixture.Store.Find(4_242)!.SimulationId);
        Assert.Single(fixture.Broadcaster.Updates);
    }

    [Fact]
    public async Task Transport_writes_work_unchanged_when_no_simulation_is_running()
    {
        /* Simülasyon tarafı OPSİYONELDİR: kanca hiçbir çalıştırma yokken
           mevcut ulaşım davranışını değiştirmez ve yayın üretmez. */
        await using var fixture = await Fixture.CreateAsync();

        var result = await fixture.Transport.CreateStopAsync(new CreateTransportStopRequest
        {
            Name = "Yeni Durak",
            RouteId = fixture.RouteId,
            Longitude = 32.85,
            Latitude = 39.93
        });

        Assert.True(result.IsSuccess);
        Assert.Empty(fixture.Broadcaster.Updates);
    }

    private sealed class Fixture : IAsyncDisposable
    {
        private static readonly DateTime Now = new(2026, 8, 31, 10, 0, 0, DateTimeKind.Utc);

        private Fixture(AppDbContext db, FakeRoutingService routing)
        {
            Db = db;
            Routing = routing;
            Store = new InMemoryTransportSimulationStateStore();
            Broadcaster = new RecordingBroadcaster();
            Runner = new TransportSimulationRunner(
                Store,
                Broadcaster,
                new TransportSimulationOptions(),
                Substitute.For<ILogger<TransportSimulationRunner>>());

            var currentUser = Substitute.For<ICurrentUserService>();
            currentUser.UserId.Returns(42);
            currentUser.IsAuthenticated.Returns(true);

            var geography = Substitute.For<IGeographicAuthorizationService>();
            geography.GetEffectiveAuthorizationAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
                .Returns(EffectiveGeographicAuthorization.Unrestricted);

            Transport = new TransportService(
                db,
                currentUser,
                geography,
                routing,
                new TransportActivityContext(),
                Runner);
        }

        public AppDbContext Db { get; }
        public FakeRoutingService Routing { get; }
        public InMemoryTransportSimulationStateStore Store { get; }
        public RecordingBroadcaster Broadcaster { get; }
        public TransportSimulationRunner Runner { get; }
        public TransportService Transport { get; }
        public int RouteId { get; private set; }

        public static async Task<Fixture> CreateAsync()
        {
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase($"transport-simulation-invalidation-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;

            var fixture = new Fixture(new AppDbContext(options), new FakeRoutingService());
            await fixture.SeedAsync();
            return fixture;
        }

        private async Task SeedAsync()
        {
            var route = new TransportRoute
            {
                Name = "Hat",
                ColorHex = "#123456",
                IsActive = true,
                CreatedDate = Now
            };
            Db.TransportRoutes.Add(route);
            await Db.SaveChangesAsync();
            RouteId = route.Id;

            Db.TransportRoutePaths.Add(new TransportRoutePath
            {
                RouteId = route.Id,
                Route = route,
                Geometry = new LineString([new Coordinate(30, 40), new Coordinate(31, 41)]) { SRID = 4326 },
                DistanceMeters = 1_000,
                DurationSeconds = 100,
                Profile = "driving",
                GeneratedAt = Now,
                IsStale = false,
                ModifiedDate = Now
            });
            await Db.SaveChangesAsync();
        }

        public async Task AddStopAsync(int sequence, double longitude, double latitude)
        {
            Db.TransportStops.Add(new TransportStop
            {
                RouteId = RouteId,
                UserId = 42,
                Name = $"Durak {sequence}",
                Coordinate = new Point(longitude, latitude) { SRID = 4326 },
                SequenceOrder = sequence,
                IsActive = true,
                CreatedDate = Now
            });
            await Db.SaveChangesAsync();
        }

        public ActiveTransportSimulation StartSimulation(int? routeId = null)
        {
            var points = new TransportSimulationPoint[] { new(30, 40), new(31, 41) };
            var simulation = new ActiveTransportSimulation(
                Guid.NewGuid(),
                routeId ?? RouteId,
                "Hat",
                "#123456",
                42,
                Now,
                new TransportSimulationPath(points, 1_000, 100, "driving", Now),
                new TransportSimulationSnapshot(points[0], 0, 0, 0, Now));

            Assert.True(Store.TryStart(simulation));
            return simulation;
        }

        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }

    private sealed class RecordingBroadcaster : ITransportSimulationBroadcaster
    {
        public List<TransportSimulationLiveUpdate> Updates { get; } = [];

        public Task PublishAsync(
            TransportSimulationLiveUpdate update,
            CancellationToken cancellationToken = default)
        {
            Updates.Add(update);
            return Task.CompletedTask;
        }
    }

    private sealed class FakeRoutingService : IOsrmRoutingService
    {
        private ServiceResult<OsrmRouteResult>? _result;

        public List<OsrmRouteRequest> Requests { get; } = [];

        public void Succeed() =>
            _result = ServiceResult<OsrmRouteResult>.Success(
                new OsrmRouteResult(
                    new LineString([new Coordinate(32.80, 39.90), new Coordinate(32.90, 39.95)]) { SRID = 4326 },
                    1_500,
                    120,
                    "driving"));

        public Task<ServiceResult<OsrmRouteResult>> RouteAsync(
            OsrmRouteRequest request,
            CancellationToken cancellationToken = default)
        {
            Requests.Add(request);
            return Task.FromResult(
                _result ?? ServiceResult<OsrmRouteResult>.Upstream("rota hesaplanamadı"));
        }
    }
}
