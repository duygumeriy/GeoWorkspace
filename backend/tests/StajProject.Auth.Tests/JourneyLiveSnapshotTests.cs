using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using StajProject.Application.Journeys;
using StajProject.Application.Options;
using StajProject.Application.Simulation;
using StajProject.Infrastructure.Simulation;

namespace StajProject.Auth.Tests;

/// <summary>
/// Kişisel yolculuğun CANLI anlık görüntü dizisi.
/// </summary>
/// <remarks>
/// <para>
/// Manuel kabul testinde panel, balon ve işaretçi %0'da donmuştu. Arıza
/// tarayıcıdaydı; ama "sunucu gerçekten ilerliyor mu" sorusu ancak DİZİ olarak
/// sorulunca cevaplanır: tek bir tick'in doğru olması, ardışık tick'lerin
/// birbirini takip ettiğini KANITLAMAZ.
/// </para>
/// <para>
/// <b>Çalıştırma elle kurulur.</b> Planlama, EF ve motor bilinçle dışarıdadır:
/// buradaki soru yalnızca runner'ın ürettiği anlık görüntülerdir. Adım
/// mesafeleri de otoriter geometrinin KENDİ toplamından türetilir — sabit
/// metreler yazmak, geometrinin uzunluğu değiştiğinde testi sessizce anlamsız
/// kılardı.
/// </para>
/// </remarks>
public sealed class JourneyLiveSnapshotTests
{
    private const double DurationSeconds = 100;

    [Fact]
    public async Task Running_snapshots_advance_progress_coordinate_and_step_together()
    {
        var harness = Harness.Create();

        await harness.AdvanceAsync(10);
        await harness.AdvanceAsync(40);
        await harness.AdvanceAsync(70);

        var published = harness.Broadcaster.Published;
        Assert.Equal(3, published.Count);
        Assert.All(published, update => Assert.Equal(JourneySimulationStatus.Running, update.Status));

        // 1) p0 < p1 < p2 — ilerleme GERÇEKTEN artar.
        Assert.True(published[0].ProgressPercent < published[1].ProgressPercent);
        Assert.True(published[1].ProgressPercent < published[2].ProgressPercent);
        Assert.True(published[0].ProgressPercent > 0);

        // 2) Kabul edilen koordinat ilerlemeyle birlikte DEĞİŞİR.
        Assert.NotEqual(published[0].Longitude, published[1].Longitude);
        Assert.NotEqual(published[1].Longitude, published[2].Longitude);

        /* 3) Güncel manevra, kat edilen mesafe bir sonraki OTORİTER adım
              sınırını geçtiğinde değişir. Sınırlar %25/%50/%75/%100'de olduğu
              için %10 → adım 0, %40 → adım 1, %70 → adım 2. */
        Assert.Equal(0, published[0].CurrentStepSequence);
        Assert.Equal(1, published[1].CurrentStepSequence);
        Assert.Equal(2, published[2].CurrentStepSequence);

        // 4) Yayınlanan anlık görüntü YENİ sırayı taşır; depo ile aynıdır.
        Assert.Equal(
            harness.Store.Find(harness.SimulationId)!.Snapshot.CurrentStepSequence,
            published[^1].CurrentStepSequence);

        // 5) Kimlik çalıştırma boyunca SABİTTİR: istemcinin kilidi tutar.
        Assert.All(published, update => Assert.Equal(harness.SimulationId, update.SimulationId));
    }

    [Fact]
    public async Task The_step_sequence_holds_until_the_authoritative_boundary_is_crossed()
    {
        var harness = Harness.Create();

        /* İki tick AYNI adımın içinde kalır: sıra ilerlemeyle orantılı bir
           sayaç DEĞİL, mesafe sınırının bir fonksiyonudur. */
        await harness.AdvanceAsync(5);
        await harness.AdvanceAsync(20);

        Assert.Equal(0, harness.Broadcaster.Published[0].CurrentStepSequence);
        Assert.Equal(0, harness.Broadcaster.Published[1].CurrentStepSequence);
        Assert.True(
            harness.Broadcaster.Published[1].ProgressPercent
            > harness.Broadcaster.Published[0].ProgressPercent);

        // Sınır geçilir geçilmez sıra ilerler.
        await harness.AdvanceAsync(30);
        Assert.Equal(1, harness.Broadcaster.Published[2].CurrentStepSequence);
    }

    [Fact]
    public async Task Every_running_broadcast_carries_the_whole_authoritative_snapshot()
    {
        var harness = Harness.Create();

        await harness.AdvanceAsync(45);

        var update = Assert.Single(harness.Broadcaster.Published);

        /* Tek otoriter nesne: panel, balon, işaretçi ve navigasyon AYNI
           güncellemeden beslenir. Eksik bir alan, arayüzde ikinci bir
           hesaplamaya davet olurdu. */
        Assert.Equal(harness.SimulationId, update.SimulationId);
        Assert.Equal(JourneySimulationStatus.Running, update.Status);
        Assert.InRange(update.ProgressPercent, 44, 46);
        Assert.True(double.IsFinite(update.Longitude));
        Assert.True(double.IsFinite(update.Latitude));
        Assert.True(update.DistanceCoveredMeters > 0);
        Assert.NotNull(update.CurrentStepSequence);
    }

    private sealed class Harness
    {
        private Harness(
            InMemoryJourneySimulationStateStore store,
            RecordingBroadcaster broadcaster,
            JourneySimulationRunner runner,
            Guid simulationId,
            DateTime startedAt)
        {
            Store = store;
            Broadcaster = broadcaster;
            Runner = runner;
            SimulationId = simulationId;
            StartedAt = startedAt;
        }

        public InMemoryJourneySimulationStateStore Store { get; }

        public RecordingBroadcaster Broadcaster { get; }

        public JourneySimulationRunner Runner { get; }

        public Guid SimulationId { get; }

        public DateTime StartedAt { get; }

        public Task AdvanceAsync(double elapsedSeconds) =>
            Runner.AdvanceAsync(StartedAt.AddSeconds(elapsedSeconds));

        public static Harness Create()
        {
            /* Uzun ve çok köşeli bir yol: tek segmentte kalan bir güzergah,
               interpolasyonun köşe köşe ilerlediğini gizlerdi. */
            TransportSimulationPoint[] points =
            [
                new(30.0, 40.0),
                new(30.1, 40.0),
                new(30.2, 40.05),
                new(30.3, 40.05),
                new(30.4, 40.1),
            ];

            /* Adım sınırları geometrinin KENDİ ölçümünden türetilir; sabit
               metreler yazmak testi geometriden koparırdı. */
            var total = TransportSimulationTrack.Create(points).TotalMeters;
            double[] stepEnds = [total * 0.25, total * 0.5, total * 0.75, total];

            var startedAt = new DateTime(2026, 9, 1, 12, 0, 0, DateTimeKind.Utc);
            var simulationId = Guid.NewGuid();

            var simulation = new ActiveJourneySimulation(
                SimulationId: simulationId,
                OwnerUserId: 7,
                Mode: JourneyMode.Waypoints,
                RequestedProfile: JourneyTravelProfile.Driving,
                EffectiveProfile: JourneyContractNames.Driving,
                StartedAt: startedAt,
                Path: new JourneySimulationPath(points, 1_000, DurationSeconds, stepEnds),
                Details: new JourneySimulationDetails("LINESTRING EMPTY", null, null, [], []),
                Snapshot: new JourneySimulationSnapshot(points[0], 0, 0, 0, 0, startedAt));

            var store = new InMemoryJourneySimulationStateStore();
            Assert.True(store.TryStart(simulation));

            var broadcaster = new RecordingBroadcaster();

            var runner = new JourneySimulationRunner(
                store,
                broadcaster,
                new JourneySimulationOptions { SpeedMultiplier = 1 },
                /* Aktivite yazıcısı KAYITLI DEĞİL: runner onu bulamadığında
                   sessizce geçer ve hareket bundan etkilenmez. */
                new ServiceCollection().BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(),
                NullLogger<JourneySimulationRunner>.Instance);

            return new Harness(store, broadcaster, runner, simulationId, startedAt);
        }
    }

    private sealed class RecordingBroadcaster : IJourneySimulationBroadcaster
    {
        public List<JourneySimulationLiveUpdate> Published { get; } = [];

        public Task PublishAsync(
            JourneySimulationLiveUpdate update,
            CancellationToken cancellationToken = default)
        {
            Published.Add(update);
            return Task.CompletedTask;
        }
    }
}
