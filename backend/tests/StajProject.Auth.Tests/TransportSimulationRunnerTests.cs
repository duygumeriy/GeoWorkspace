using NSubstitute;
using StajProject.Application.Options;
using StajProject.Application.Simulation;
using StajProject.Infrastructure.Simulation;

namespace StajProject.Auth.Tests;

/// <summary>
/// Sunucu otoriteli runner: ilerleme, tamamlanma, iptal ve kimlik denetimi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Gerçek bekleme YOKTUR.</b> Zaman runner'a DIŞARIDAN verilir
/// (<c>AdvanceAsync(utcNow)</c>); testler saatin kendisini kurgular. Bir
/// simülasyon testinin <c>Task.Delay</c> ile "biraz beklemesi", hem yavaş hem
/// de makineye göre kırılgan olurdu.
/// </para>
/// </remarks>
public sealed class TransportSimulationRunnerTests
{
    private static readonly DateTime Start = new(2026, 8, 31, 10, 0, 0, DateTimeKind.Utc);

    /* --- İlerleme geçen SÜREDEN türetilir --------------------------------------- */

    [Theory]
    [InlineData(0, 0)]
    [InlineData(25, 25)]
    [InlineData(50, 50)]
    [InlineData(99, 99)]
    public async Task Progress_is_derived_from_elapsed_server_time(double elapsedSeconds, double expectedPercent)
    {
        var fixture = Fixture.Create();
        fixture.Start(durationSeconds: 100);

        await fixture.Runner.AdvanceAsync(Start.AddSeconds(elapsedSeconds));

        var update = Assert.Single(fixture.Broadcaster.Updates);
        Assert.Equal(expectedPercent, update.ProgressPercent, 6);
        Assert.Equal(TransportSimulationStatus.Running, update.Status);
    }

    [Fact]
    public async Task Timer_jitter_does_not_accumulate_drift()
    {
        /* ASIL İDDİA: ilerleme tick SAYISINDAN değil, saatten türetilir. Aynı
           ana denk gelen fazladan tick'ler, kaçırılan tick'ler ve düzensiz
           aralıklar konumu kaydırmamalıdır. */
        var fixture = Fixture.Create();
        fixture.Start(durationSeconds: 100);

        // Aynı anda beş kez ilerlet: hiçbiri ilerlemeyi biriktirmez.
        for (var index = 0; index < 5; index++)
        {
            await fixture.Runner.AdvanceAsync(Start.AddSeconds(10));
        }

        Assert.All(fixture.Broadcaster.Updates, update => Assert.Equal(10, update.ProgressPercent, 6));

        // Aradaki tick'ler kaçırılmış olsa bile bir sonraki yayın DOĞRU yerdedir.
        fixture.Broadcaster.Updates.Clear();
        await fixture.Runner.AdvanceAsync(Start.AddSeconds(50));

        Assert.Equal(50, Assert.Single(fixture.Broadcaster.Updates).ProgressPercent, 6);
    }

    [Fact]
    public async Task The_speed_multiplier_scales_the_persisted_route_duration()
    {
        var fixture = Fixture.Create(speedMultiplier: 10);
        fixture.Start(durationSeconds: 100);

        // 10 saniyelik gerçek zaman × 10 = 100 saniyelik rota süresi.
        await fixture.Runner.AdvanceAsync(Start.AddSeconds(5));

        Assert.Equal(50, Assert.Single(fixture.Broadcaster.Updates).ProgressPercent, 6);
    }

    [Fact]
    public async Task An_unusable_duration_falls_back_instead_of_dividing_by_zero()
    {
        var fixture = Fixture.Create(fallbackDurationSeconds: 200);
        fixture.Start(durationSeconds: 0);

        await fixture.Runner.AdvanceAsync(Start.AddSeconds(100));

        var update = Assert.Single(fixture.Broadcaster.Updates);
        Assert.Equal(50, update.ProgressPercent, 6);
        Assert.False(double.IsNaN(update.Longitude));
    }

    [Fact]
    public async Task The_published_position_moves_along_the_path()
    {
        var fixture = Fixture.Create();
        fixture.Start(durationSeconds: 100, points: [(30, 0), (31, 0), (32, 0)]);

        await fixture.Runner.AdvanceAsync(Start.AddSeconds(50));

        var update = Assert.Single(fixture.Broadcaster.Updates);
        Assert.Equal(31, update.Longitude, 3);
        Assert.Equal(0, update.Latitude, 6);

        // Sunucu durumu da ilerlemiştir; REST anlık görüntüsü aynı gerçeği taşır.
        var stored = fixture.Store.Find(Fixture.RouteId)!;
        Assert.Equal(0.5, stored.Snapshot.ProgressRatio, 6);
        Assert.Equal(Start.AddSeconds(50), stored.Snapshot.CapturedAt);
    }

    /* --- Tamamlanma ------------------------------------------------------------- */

    [Fact]
    public async Task Completion_publishes_the_final_position_and_removes_the_run()
    {
        var fixture = Fixture.Create();
        var simulation = fixture.Start(durationSeconds: 100, points: [(30, 0), (32, 0)]);

        await fixture.Runner.AdvanceAsync(Start.AddSeconds(100));

        var update = Assert.Single(fixture.Broadcaster.Updates);
        Assert.Equal(TransportSimulationStatus.Completed, update.Status);
        Assert.Equal(100, update.ProgressPercent, 6);
        Assert.Equal(32, update.Longitude, 6);
        Assert.Equal(simulation.SimulationId, update.SimulationId);
        Assert.Equal(Fixture.RouteId, update.RouteId);

        // Temizlik: rota artık meşgul DEĞİLDİR.
        Assert.Null(fixture.Store.Find(Fixture.RouteId));
    }

    [Fact]
    public async Task A_completed_run_is_not_advanced_again()
    {
        var fixture = Fixture.Create();
        fixture.Start(durationSeconds: 100);

        await fixture.Runner.AdvanceAsync(Start.AddSeconds(150));
        fixture.Broadcaster.Updates.Clear();
        await fixture.Runner.AdvanceAsync(Start.AddSeconds(200));

        Assert.Empty(fixture.Broadcaster.Updates);
    }

    [Fact]
    public async Task The_same_route_can_run_again_after_completion()
    {
        var fixture = Fixture.Create();
        var first = fixture.Start(durationSeconds: 100);
        await fixture.Runner.AdvanceAsync(Start.AddSeconds(100));
        fixture.Broadcaster.Updates.Clear();

        var second = fixture.Start(durationSeconds: 100, startedAt: Start.AddSeconds(200));

        Assert.NotEqual(first.SimulationId, second.SimulationId);
        await fixture.Runner.AdvanceAsync(Start.AddSeconds(250));

        var update = Assert.Single(fixture.Broadcaster.Updates);
        Assert.Equal(second.SimulationId, update.SimulationId);
        Assert.Equal(50, update.ProgressPercent, 6);
        Assert.NotNull(fixture.Store.Find(Fixture.RouteId));
    }

    /* --- Kimlik denetimi: eski çalıştırma yenisine dokunamaz -------------------- */

    [Fact]
    public async Task A_superseded_run_can_neither_update_nor_stop_the_current_one()
    {
        var fixture = Fixture.Create();
        var old = fixture.Start(durationSeconds: 100);

        // Eski çalıştırma sonlanır, aynı rotada yenisi başlar.
        Assert.True(fixture.Store.TryStop(Fixture.RouteId, old.SimulationId));
        var current = fixture.Start(durationSeconds: 100, startedAt: Start.AddSeconds(10));

        var staleSnapshot = new TransportSimulationSnapshot(
            new TransportSimulationPoint(0, 0), 0, 0.99, 999, Start.AddSeconds(99));

        Assert.False(fixture.Store.TryUpdateSnapshot(Fixture.RouteId, old.SimulationId, staleSnapshot));
        Assert.False(fixture.Store.TryStop(Fixture.RouteId, old.SimulationId));

        // Güncel çalıştırma bozulmadan durur ve ilerlemeye devam eder.
        Assert.Equal(current.SimulationId, fixture.Store.Find(Fixture.RouteId)!.SimulationId);
        Assert.Equal(0, fixture.Store.Find(Fixture.RouteId)!.Snapshot.ProgressRatio);

        await fixture.Runner.AdvanceAsync(Start.AddSeconds(60));

        var update = Assert.Single(fixture.Broadcaster.Updates);
        Assert.Equal(current.SimulationId, update.SimulationId);
        Assert.Equal(50, update.ProgressPercent, 6);
    }

    /* --- İptal ------------------------------------------------------------------ */

    [Fact]
    public async Task Cancelling_a_route_stops_the_run_and_publishes_cancellation()
    {
        var fixture = Fixture.Create();
        var simulation = fixture.Start(durationSeconds: 100);
        await fixture.Runner.AdvanceAsync(Start.AddSeconds(30));
        fixture.Broadcaster.Updates.Clear();

        await fixture.Runner.CancelForRoutesAsync([Fixture.RouteId]);

        var update = Assert.Single(fixture.Broadcaster.Updates);
        Assert.Equal(TransportSimulationStatus.Cancelled, update.Status);
        Assert.Equal(simulation.SimulationId, update.SimulationId);

        // İptal edilen çalıştırmanın SON bilinen ilerlemesi taşınır.
        Assert.Equal(30, update.ProgressPercent, 6);
        Assert.Null(fixture.Store.Find(Fixture.RouteId));

        // Sonraki tick'ler artık hiçbir şey yayınlamaz.
        await fixture.Runner.AdvanceAsync(Start.AddSeconds(40));
        Assert.Single(fixture.Broadcaster.Updates);
    }

    [Fact]
    public async Task Cancelling_a_route_without_a_run_is_a_no_op()
    {
        var fixture = Fixture.Create();

        await fixture.Runner.CancelForRoutesAsync([Fixture.RouteId, 12_345]);

        Assert.Empty(fixture.Broadcaster.Updates);
    }

    [Fact]
    public async Task Cancellation_only_touches_the_named_routes()
    {
        var fixture = Fixture.Create();
        fixture.Start(durationSeconds: 100);
        var other = fixture.Start(durationSeconds: 100, routeId: 99);

        await fixture.Runner.CancelForRoutesAsync([Fixture.RouteId]);

        Assert.Null(fixture.Store.Find(Fixture.RouteId));
        Assert.Equal(other.SimulationId, fixture.Store.Find(99)!.SimulationId);
    }

    [Fact]
    public async Task An_unusable_path_is_cancelled_instead_of_running_forever()
    {
        var fixture = Fixture.Create();
        fixture.Start(durationSeconds: 100, points: [(30, 40), (30, 40)]);

        await fixture.Runner.AdvanceAsync(Start.AddSeconds(10));

        var update = Assert.Single(fixture.Broadcaster.Updates);
        Assert.Equal(TransportSimulationStatus.Cancelled, update.Status);
        Assert.Null(fixture.Store.Find(Fixture.RouteId));
    }

    /* --- Dayanıklılık ----------------------------------------------------------- */

    [Fact]
    public async Task A_broadcast_failure_does_not_stop_the_simulation()
    {
        /* Sunucu durumu otoriterdir: yayın hattı arızalansa bile araç yoluna
           devam eder ve yeniden bağlanan istemci güncel anlık görüntüyü alır. */
        var fixture = Fixture.Create();
        fixture.Start(durationSeconds: 100);
        fixture.Broadcaster.Fail = true;

        await fixture.Runner.AdvanceAsync(Start.AddSeconds(25));

        var stored = fixture.Store.Find(Fixture.RouteId);
        Assert.NotNull(stored);
        Assert.Equal(0.25, stored!.Snapshot.ProgressRatio, 6);
    }

    [Fact]
    public async Task Two_routes_advance_independently_in_one_tick()
    {
        var fixture = Fixture.Create();
        fixture.Start(durationSeconds: 100);
        fixture.Start(durationSeconds: 200, routeId: 99);

        await fixture.Runner.AdvanceAsync(Start.AddSeconds(50));

        Assert.Equal(2, fixture.Broadcaster.Updates.Count);
        Assert.Equal(50, fixture.Broadcaster.Updates.Single(u => u.RouteId == Fixture.RouteId).ProgressPercent, 6);
        Assert.Equal(25, fixture.Broadcaster.Updates.Single(u => u.RouteId == 99).ProgressPercent, 6);
    }

    private sealed class Fixture
    {
        public const int RouteId = 7;

        private Fixture(TransportSimulationOptions options)
        {
            Store = new InMemoryTransportSimulationStateStore();
            Broadcaster = new RecordingBroadcaster();
            Runner = new TransportSimulationRunner(
                Store,
                Broadcaster,
                options,
                Substitute.For<Microsoft.Extensions.Logging.ILogger<TransportSimulationRunner>>());
        }

        public InMemoryTransportSimulationStateStore Store { get; }
        public RecordingBroadcaster Broadcaster { get; }
        public TransportSimulationRunner Runner { get; }

        public static Fixture Create(
            double speedMultiplier = 1,
            double fallbackDurationSeconds = 300) =>
            new(new TransportSimulationOptions
            {
                TickIntervalMilliseconds = 1_000,
                SpeedMultiplier = speedMultiplier,
                FallbackDurationSeconds = fallbackDurationSeconds
            });

        public ActiveTransportSimulation Start(
            double durationSeconds,
            (double Longitude, double Latitude)[]? points = null,
            int routeId = RouteId,
            DateTime? startedAt = null)
        {
            var vertices = (points ?? [(30, 0), (32, 0)])
                .Select(point => new TransportSimulationPoint(point.Longitude, point.Latitude))
                .ToArray();

            var simulation = new ActiveTransportSimulation(
                Guid.NewGuid(),
                routeId,
                "Hat",
                "#123456",
                42,
                startedAt ?? TransportSimulationRunnerTests.Start,
                new TransportSimulationPath(
                    vertices, 1_000, durationSeconds, "driving", TransportSimulationRunnerTests.Start),
                new TransportSimulationSnapshot(
                    vertices[0], 0, 0, 0, startedAt ?? TransportSimulationRunnerTests.Start));

            Assert.True(Store.TryStart(simulation));
            return simulation;
        }
    }

    private sealed class RecordingBroadcaster : ITransportSimulationBroadcaster
    {
        public List<TransportSimulationLiveUpdate> Updates { get; } = [];

        public bool Fail { get; set; }

        public Task PublishAsync(
            TransportSimulationLiveUpdate update,
            CancellationToken cancellationToken = default)
        {
            if (Fail)
            {
                throw new InvalidOperationException("yayın hattı arızalı");
            }

            Updates.Add(update);
            return Task.CompletedTask;
        }
    }
}
