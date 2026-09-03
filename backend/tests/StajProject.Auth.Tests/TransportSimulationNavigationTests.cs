using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;
using NetTopologySuite.Geometries;
using NSubstitute;
using StajProject.Api.Controllers;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Geographic;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Application.Routing;
using StajProject.Application.Simulation;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;
using StajProject.Infrastructure.Simulation;

namespace StajProject.Auth.Tests;

/// <summary>
/// PAYLAŞILAN hattın SUNUCU OTORİTELİ navigasyonu (Faz 5).
/// </summary>
/// <remarks>
/// <para>
/// Ölçülen asıl iddia OTORİTE ZİNCİRİDİR: manevralar yolun üretildiği anda
/// motordan alınır, yolla AYNI kayıt işleminde saklanır ve "şu anda hangi
/// manevradayız" sorusunu SUNUCU cevaplar. Tarayıcının geometriye bakıp dönüş
/// çıkarması, motorun bilmediği bir gerçeği uydurmak olurdu — ve yanlış bir
/// talimat, hiç talimat olmamasından daha kötüdür.
/// </para>
/// <para>
/// İkinci iddia KİMLİK GÜVENLİĞİDİR: navigasyon çalıştırmaya aittir, rotaya
/// değil. Yerine geçen bir çalıştırma eskisinin adımını devralmaz ve bayat bir
/// çalıştırma yenisinin navigasyonunu değiştiremez.
/// </para>
/// <para>
/// Zaman DIŞARIDAN verilir; hiçbir test gerçek bekleme yapmaz.
/// </para>
/// </remarks>
public class TransportSimulationNavigationTests
{
    /* --- 1-3. OTORİTE VE KİMLİK --------------------------------------------------- */

    [Fact]
    public void Navigation_steps_are_persisted_route_authority_and_never_geometry_inference()
    {
        /* Adım, KALICI yolun türetilmiş verisidir ve yalnızca motordan gelir.
           Modelde geometriden çıkarım yapılabilecek hiçbir alan yoktur. */
        var properties = typeof(TransportRoutePathStep)
            .GetProperties()
            .Select(property => property.Name)
            .ToArray();

        Assert.Contains(nameof(TransportRoutePathStep.Sequence), properties);
        Assert.Contains(nameof(TransportRoutePathStep.ManeuverType), properties);
        Assert.Contains(nameof(TransportRoutePathStep.StartDistanceMeters), properties);
        Assert.Contains(nameof(TransportRoutePathStep.EndDistanceMeters), properties);

        // Adım YOLA bağlıdır; rotaya değil ve çalıştırmaya hiç değil.
        Assert.Contains(nameof(TransportRoutePathStep.PathId), properties);
        Assert.DoesNotContain(properties, name => name.Contains("Simulation", StringComparison.Ordinal));

        /* Kullanıcıya gösterilecek metin SAKLANMAZ: motor çekirdeği insan
           okunabilir talimat üretmez ve uydurulmuş bir metin sunucunun
           bilmediği bir şeyi bildiriyormuş gibi olurdu. */
        Assert.DoesNotContain(properties, name => name.Contains("Instruction", StringComparison.Ordinal));
        Assert.DoesNotContain(properties, name => name.Contains("DisplayText", StringComparison.Ordinal));
    }

    [Fact]
    public void The_sequence_is_the_identity_and_never_the_array_index()
    {
        /* Sunucu sırayı boşluklu verebilir. Çözümleme dizinin konumuna
           dayansaydı, süzülmüş ya da yeniden numaralanmış bir listede sessizce
           YANLIŞ talimat gösterilirdi. */
        var navigation = TransportRouteNavigation.Create(
        [
            Step(sequence: 10, start: 0, end: 100),
            Step(sequence: 20, start: 100, end: 250),
            Step(sequence: 30, start: 250, end: 400)
        ]);

        Assert.Equal(10, navigation.SequenceAt(0));
        Assert.Equal(20, navigation.SequenceAt(150));
        Assert.Equal(30, navigation.SequenceAt(399));

        // Arama SIRAYA göredir; 20 numaralı adım dizinin 1. elemanıdır.
        Assert.Equal(20, navigation.FindBySequence(20)!.Sequence);
        Assert.Null(navigation.FindBySequence(1));
    }

    [Fact]
    public void Step_boundaries_resolve_deterministically_including_the_edges()
    {
        var navigation = TransportRouteNavigation.Create(
        [
            Step(sequence: 0, start: 0, end: 100),
            Step(sequence: 1, start: 100, end: 250)
        ]);

        // Başlangıç: ilk adım. Sınır DEĞERİ bir sonraki adıma aittir.
        Assert.Equal(0, navigation.SequenceAt(0));
        Assert.Equal(0, navigation.SequenceAt(99.9));
        Assert.Equal(1, navigation.SequenceAt(100));

        /* Varışın ÖTESİ son adımda kalır: araç varmıştır, geriye düşmez ve
           liste dışına taşmaz. */
        Assert.Equal(1, navigation.SequenceAt(10_000));

        // Okunamayan ya da negatif mesafe BAŞLANGIÇ olarak okunur.
        Assert.Equal(0, navigation.SequenceAt(-5));
        Assert.Equal(0, navigation.SequenceAt(double.NaN));
    }

    [Fact]
    public void Distance_to_the_next_maneuver_is_server_owned_and_absent_at_arrival()
    {
        var navigation = TransportRouteNavigation.Create(
        [
            Step(sequence: 0, start: 0, end: 100),
            Step(sequence: 1, start: 100, end: 250)
        ]);

        Assert.Equal(100, navigation.DistanceToNextManeuverMeters(0));
        Assert.Equal(20, navigation.DistanceToNextManeuverMeters(80));

        /* SON adımda sonraki manevra YOKTUR. Sıfır yazmak "hemen şimdi dön"
           demek olurdu. */
        Assert.Null(navigation.DistanceToNextManeuverMeters(150));
        Assert.Null(navigation.DistanceToNextManeuverMeters(250));
    }

    [Fact]
    public void A_route_without_maneuvers_stays_valid()
    {
        var navigation = TransportRouteNavigation.Create([]);

        Assert.False(navigation.HasSteps);
        Assert.Null(navigation.SequenceAt(0));
        Assert.Null(navigation.DistanceToNextManeuverMeters(0));
        Assert.Empty(navigation.Steps);

        // Aynı şey null girdide de geçerlidir; istisna fırlatılmaz.
        Assert.False(TransportRouteNavigation.Create(null).HasSteps);
    }

    [Fact]
    public void Malformed_stored_steps_are_dropped_rather_than_shown_wrong()
    {
        /* Bozuk sınır taşıyan adım DÜŞÜRÜLÜR ve sıralama savunmacıdır: eksik
           bir manevra, yanlış bir manevradan iyidir. */
        var navigation = TransportRouteNavigation.Create(
        [
            Step(sequence: 1, start: 100, end: 250),
            Step(sequence: 0, start: 0, end: 100),
            Step(sequence: 2, start: 400, end: 300),
            Step(sequence: 3, start: double.NaN, end: 500)
        ]);

        Assert.Equal([0, 1], navigation.Steps.Select(step => step.Sequence));
    }

    /* --- 4-6. ÇALIŞTIRMA BOYUNCA İLERLEME ------------------------------------------ */

    [Fact]
    public async Task A_new_run_starts_on_the_first_maneuver_without_waiting_for_a_tick()
    {
        await using var fixture = await Fixture.CreateAsync();
        var run = await fixture.StartRouteAsync("A");

        // Başlatma yanıtı ZATEN navigasyon taşır.
        Assert.True(run.HasNavigationSteps);
        Assert.Equal(0, run.CurrentStepSequence);
        Assert.Equal(3, run.NavigationSteps.Count);
        Assert.Equal([0, 1, 2], run.NavigationSteps.Select(step => step.Sequence));

        // Depodaki OTORİTER durum da aynı şeyi söyler.
        Assert.Equal(0, fixture.Store.Find(run.RouteId)!.Snapshot.CurrentStepSequence);
    }

    [Fact]
    public async Task The_current_step_advances_at_authoritative_boundaries_only()
    {
        /* Yol 300 m / 300 sn: saniyede bir metre. Adım sınırları 0-100,
           100-200, 200-300. */
        await using var fixture = await Fixture.CreateAsync();
        var run = await fixture.StartRouteAsync("A");

        await fixture.AdvanceAsync(seconds: 50);
        Assert.Equal(0, fixture.Store.Find(run.RouteId)!.Snapshot.CurrentStepSequence);

        await fixture.AdvanceAsync(seconds: 60);
        Assert.Equal(1, fixture.Store.Find(run.RouteId)!.Snapshot.CurrentStepSequence);

        await fixture.AdvanceAsync(seconds: 100);
        Assert.Equal(2, fixture.Store.Find(run.RouteId)!.Snapshot.CurrentStepSequence);

        /* Sıra CANLI YAYINDA da taşınır — ama adım LİSTESİ taşınmaz: manevralar
           sabittir ve saniyede bir yeniden gönderilmez. */
        var update = fixture.Broadcaster.Updates[^1];
        Assert.Equal(2, update.CurrentStepSequence);
        Assert.Equal(run.SimulationId, update.SimulationId);
        Assert.DoesNotContain(
            typeof(TransportSimulationLiveUpdate).GetProperties(),
            property => property.Name.Contains("Steps", StringComparison.Ordinal));
    }

    /* --- 7-10. YAŞAM DÖNGÜSÜ (Faz 3B/4B sözleşmesi korunur) ------------------------ */

    [Fact]
    public async Task Pause_freezes_the_current_step_and_resume_continues_from_it()
    {
        await using var fixture = await Fixture.CreateAsync();
        var run = await fixture.StartRouteAsync("A");

        await fixture.AdvanceAsync(seconds: 150);
        var frozen = fixture.Store.Find(run.RouteId)!.Snapshot.CurrentStepSequence;
        Assert.Equal(1, frozen);

        var paused = await fixture.Service.PauseAsync(run.RouteId, run.SimulationId);
        Assert.True(paused.IsSuccess);

        // DURAKLATMA adımı DEĞİŞTİRMEZ ve yayın da aynı adımı taşır.
        Assert.Equal(frozen, paused.Value!.CurrentStepSequence);
        Assert.Equal(run.SimulationId, paused.Value!.SimulationId);

        // Duraklatılmışken saat durur; uzun bir bekleme adımı İLERLETMEZ.
        await fixture.AdvanceAsync(seconds: 200);
        Assert.Equal(frozen, fixture.Store.Find(run.RouteId)!.Snapshot.CurrentStepSequence);

        var resumed = await fixture.Service.ResumeAsync(run.RouteId, run.SimulationId);
        Assert.True(resumed.IsSuccess);

        // SÜRDÜRME de sıçratmaz: AYNI kimlik, AYNI adım.
        Assert.Equal(run.SimulationId, resumed.Value!.SimulationId);
        Assert.Equal(frozen, resumed.Value!.CurrentStepSequence);
        Assert.Equal(frozen, fixture.Store.Find(run.RouteId)!.Snapshot.CurrentStepSequence);
    }

    [Fact]
    public async Task Reset_ends_navigation_with_the_run_and_leaves_no_replacement()
    {
        await using var fixture = await Fixture.CreateAsync();
        var run = await fixture.StartRouteAsync("A");
        await fixture.AdvanceAsync(seconds: 150);

        var terminal = await fixture.Service.StopAsync(run.RouteId, run.SimulationId);
        Assert.True(terminal.IsSuccess);

        // Terminal yayın SON BİLİNEN adımı taşır; uydurulmuş bir sıfır değil.
        Assert.Equal(TransportSimulationStatus.Cancelled, terminal.Value!.Status);
        Assert.Equal(1, terminal.Value!.CurrentStepSequence);

        // Ve çalıştırmayla birlikte navigasyon da yok olur.
        Assert.Null(fixture.Store.Find(run.RouteId));
    }

    [Fact]
    public async Task Restart_starts_a_new_run_back_at_the_first_maneuver()
    {
        await using var fixture = await Fixture.CreateAsync();
        var first = await fixture.StartRouteAsync("A");

        await fixture.AdvanceAsync(seconds: 250);
        Assert.Equal(2, fixture.Store.Find(first.RouteId)!.Snapshot.CurrentStepSequence);

        var restarted = await fixture.Service.RestartAsync(first.RouteId, first.SimulationId);
        Assert.True(restarted.IsSuccess);

        var replacement = restarted.Value!;

        // YENİ kimlik, %0 ilerleme ve BAŞTAKİ manevra.
        Assert.NotEqual(first.SimulationId, replacement.SimulationId);
        Assert.Equal(0, replacement.ProgressRatio);
        Assert.Equal(0, replacement.CurrentStepSequence);
        Assert.True(replacement.HasNavigationSteps);

        var stored = fixture.Store.Find(first.RouteId)!;
        Assert.Equal(replacement.SimulationId, stored.SimulationId);
        Assert.Equal(0, stored.Snapshot.CurrentStepSequence);

        /* Yerine geçen çalıştırma eskisinin adımını DEVRALMAZ: bu başka bir
           yolculuktur. */
        Assert.NotEqual(2, stored.Snapshot.CurrentStepSequence);
    }

    /* --- 11-14. BAYATLIK VE YALITIM ------------------------------------------------ */

    [Fact]
    public async Task A_stale_old_run_cannot_mutate_the_replacement_navigation()
    {
        await using var fixture = await Fixture.CreateAsync();
        var old = await fixture.StartRouteAsync("A");
        await fixture.AdvanceAsync(seconds: 250);

        var oldSnapshot = fixture.Store.Find(old.RouteId)!.Snapshot;
        Assert.Equal(2, oldSnapshot.CurrentStepSequence);

        var restarted = await fixture.Service.RestartAsync(old.RouteId, old.SimulationId);
        var replacement = restarted.Value!;

        /* ESKİ çalıştırmanın yolda kalmış bir tick'i, kimlik denetimli yazma
           yüzünden yenisinin adımını EZEMEZ. */
        Assert.False(fixture.Store.TryUpdateSnapshot(old.RouteId, old.SimulationId, oldSnapshot));

        var stored = fixture.Store.Find(old.RouteId)!;
        Assert.Equal(replacement.SimulationId, stored.SimulationId);
        Assert.Equal(0, stored.Snapshot.CurrentStepSequence);
    }

    [Fact]
    public async Task Concurrent_routes_keep_independent_current_steps()
    {
        await using var fixture = await Fixture.CreateAsync();

        var a = await fixture.StartRouteAsync("A");
        var b = await fixture.StartRouteAsync("B");

        await fixture.AdvanceAsync(seconds: 150);
        Assert.True((await fixture.Service.PauseAsync(a.RouteId, a.SimulationId)).IsSuccess);

        var frozenA = fixture.Store.Find(a.RouteId)!.Snapshot.CurrentStepSequence;

        // B ilerlemeye devam eder; A donmuş kalır.
        await fixture.AdvanceAsync(seconds: 120);

        Assert.Equal(frozenA, fixture.Store.Find(a.RouteId)!.Snapshot.CurrentStepSequence);
        Assert.Equal(2, fixture.Store.Find(b.RouteId)!.Snapshot.CurrentStepSequence);

        /* HİÇBİR BULAŞMA YOK: her yayın kendi rota + çalıştırma kimliğini
           taşır ve iki hattın adımları bağımsızdır. */
        foreach (var update in fixture.Broadcaster.Updates.Where(item => item.RouteId == a.RouteId))
        {
            Assert.Equal(a.SimulationId, update.SimulationId);
        }
    }

    [Fact]
    public async Task A_terminal_run_cannot_regress_into_a_running_navigation_state()
    {
        await using var fixture = await Fixture.CreateAsync();
        var run = await fixture.StartRouteAsync("A");
        await fixture.AdvanceAsync(seconds: 150);

        Assert.True((await fixture.Service.StopAsync(run.RouteId, run.SimulationId)).IsSuccess);

        var terminalIndex = fixture.Broadcaster.Updates.FindLastIndex(
            update => update.SimulationId == run.SimulationId
                && update.Status == TransportSimulationStatus.Cancelled);

        Assert.True(terminalIndex >= 0);

        // Terminal çalıştırma depodan kalkmıştır; ilerletme onu diriltemez.
        await fixture.AdvanceAsync(seconds: 60);
        Assert.Null(fixture.Store.Find(run.RouteId));

        /* Terminalden SONRA o çalıştırma adına tek bir Running yayını bile
           çıkmaz: navigasyon durumu geri saramaz. */
        Assert.DoesNotContain(
            fixture.Broadcaster.Updates.Skip(terminalIndex + 1),
            update => update.SimulationId == run.SimulationId);
    }

    /* --- 15-16. ÜRETİM VE YENİDEN ÜRETİM ------------------------------------------- */

    [Fact]
    public async Task Generating_the_route_path_persists_geometry_and_steps_together()
    {
        await using var fixture = await Fixture.CreateAsync();
        var route = await fixture.AddRouteWithStopsAsync("A");

        fixture.Router.Steps =
        [
            OsrmStep(0, "depart", null, "Atatürk Bulvarı", 0, 100),
            OsrmStep(1, "turn", "right", "İnönü Caddesi", 100, 300)
        ];

        var generated = await fixture.Transport.GenerateRoutePathAsync(route.Id);
        Assert.True(generated.IsSuccess);

        var stored = await fixture.ReadStepsAsync(route.Id);
        Assert.Equal([0, 1], stored.Select(step => step.Sequence));
        Assert.Equal("Atatürk Bulvarı", stored[0].Name);
        Assert.Equal("right", stored[1].ManeuverModifier);
        Assert.Equal(300, stored[1].EndDistanceMeters);

        /* YENİDEN ÜRETİM: geometri ve adımlar BİRLİKTE değişir. Eski adımlar
           TAMAMEN silinir — "yeni geometri + eski adımlar" bir an bile var
           olmaz. */
        fixture.Router.Steps = [OsrmStep(0, "depart", null, "Yeni Yol", 0, 300)];

        Assert.True((await fixture.Transport.GenerateRoutePathAsync(route.Id)).IsSuccess);

        var regenerated = await fixture.ReadStepsAsync(route.Id);
        Assert.Single(regenerated);
        Assert.Equal("Yeni Yol", regenerated[0].Name);
        Assert.DoesNotContain(regenerated, step => step.Name == "İnönü Caddesi");
    }

    [Fact]
    public async Task A_route_generated_without_maneuvers_still_simulates()
    {
        await using var fixture = await Fixture.CreateAsync();
        var route = await fixture.AddRouteWithStopsAsync("A");

        fixture.Router.Steps = [];
        Assert.True((await fixture.Transport.GenerateRoutePathAsync(route.Id)).IsSuccess);
        Assert.Empty(await fixture.ReadStepsAsync(route.Id));

        var started = await fixture.Service.StartAsync(route.Id);
        Assert.True(started.IsSuccess);

        // Araç yürür; yalnızca navigasyon sunulmaz. Bu bir HATA DEĞİLDİR.
        Assert.False(started.Value!.HasNavigationSteps);
        Assert.Null(started.Value!.CurrentStepSequence);
        Assert.Empty(started.Value!.NavigationSteps);

        await fixture.AdvanceAsync(seconds: 150);
        var stored = fixture.Store.Find(route.Id)!;
        Assert.True(stored.Snapshot.ProgressRatio > 0);
        Assert.Null(stored.Snapshot.CurrentStepSequence);
    }

    /* --- 17-20. MİMARİ SINIRLARI --------------------------------------------------- */

    [Fact]
    public void No_new_hub_no_new_channel_and_no_new_status_vocabulary()
    {
        var hubs = typeof(TransportSimulationController).Assembly
            .GetTypes()
            .Where(type => typeof(Hub).IsAssignableFrom(type) && type != typeof(Hub))
            .Select(type => type.Name)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(new[] { "JourneySimulationHub", "TransportSimulationHub" }, hubs);

        // Navigasyon MEVCUT akışla taşınır; ikinci bir istemci metodu yoktur.
        Assert.Equal("SimulationUpdated", TransportSimulationHubContract.UpdateMethod);
        Assert.Equal("ActiveSimulationSetChanged", TransportSimulationHubContract.ActiveSetChangedMethod);

        // Durum sözlüğü hâlâ DÖRT değerdir; navigasyon bir DURUM değildir.
        Assert.Equal(
            new[] { "Running", "Paused", "Completed", "Cancelled" },
            Enum.GetNames<TransportSimulationStatus>());
    }

    [Fact]
    public void No_new_endpoint_and_no_new_permission_were_introduced()
    {
        /* Navigasyon MEVCUT simülasyon yanıtlarıyla taşınır: ayrı bir okuma
           ucu, aynı gerçeğin ikinci bir sahibi ve ikinci bir yetki kararı
           demekti. */
        var navigationEndpoints = typeof(TransportSimulationController)
            .GetMethods()
            .Where(method => method.Name.Contains("Navigation", StringComparison.OrdinalIgnoreCase)
                || method.Name.Contains("Step", StringComparison.OrdinalIgnoreCase))
            .ToArray();

        Assert.Empty(navigationEndpoints);

        Assert.DoesNotContain(
            PermissionCatalog.AllCodes,
            code => code.Contains("navigation", StringComparison.OrdinalIgnoreCase)
                || code.Contains("maneuver", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Personal_journey_routing_is_untouched_by_shared_navigation()
    {
        /* İki ürün AYRI kalır: paylaşılan hattın kalıcı adımı, kişisel
           yolculuğun süreç içi manevra modeline bağlanmaz. */
        var sharedStepProperties = typeof(TransportRoutePathStep)
            .GetProperties()
            .Select(property => property.PropertyType.Name);

        Assert.DoesNotContain(sharedStepProperties, name => name.Contains("Journey", StringComparison.Ordinal));

        Assert.DoesNotContain(
            typeof(IJourneySimulationService).GetMethods(),
            method => method.Name.Contains("Navigation", StringComparison.Ordinal));
    }

    /* --- Yardımcılar --------------------------------------------------------------- */

    private static TransportNavigationStep Step(int sequence, double start, double end) =>
        new(sequence, "turn", "right", "Yol", end - start, 10, start, end);

    private static OsrmRouteStep OsrmStep(
        int sequence,
        string type,
        string? modifier,
        string? name,
        double start,
        double end) =>
        new(sequence, type, modifier, name, end - start, end - start, start, end);

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

    /// <summary>Manevraları TEST tarafından belirlenen sahte yönlendirme motoru.</summary>
    private sealed class FakeRouter : IOsrmRoutingService
    {
        public IReadOnlyList<OsrmRouteStep> Steps { get; set; } = [];

        public Task<ServiceResult<OsrmRouteResult>> RouteAsync(
            OsrmRouteRequest request,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(ServiceResult<OsrmRouteResult>.Success(new OsrmRouteResult(
                new LineString([new Coordinate(30, 40), new Coordinate(31, 41)]) { SRID = 4326 },
                300,
                300,
                "driving",
                Steps)));
    }

    private sealed class SyntheticTimeProvider : TimeProvider
    {
        public DateTime UtcNow { get; set; } = DateTime.UtcNow;

        public override DateTimeOffset GetUtcNow() => new(UtcNow, TimeSpan.Zero);
    }

    private sealed class Fixture : IAsyncDisposable
    {
        /// <summary>300 m / 300 sn: saniyede bir metre, sınırlar okunaklı.</summary>
        private const double PathDistanceMeters = 300;
        private const double PathDurationSeconds = 300;

        private const int UserId = 42;

        private readonly SyntheticTimeProvider _time = new();

        private Fixture(AppDbContext db)
        {
            Db = db;
            Store = new InMemoryTransportSimulationStateStore();
            Broadcaster = new RecordingBroadcaster();
            Router = new FakeRouter();

            var currentUser = Substitute.For<ICurrentUserService>();
            currentUser.UserId.Returns(UserId);
            currentUser.IsAuthenticated.Returns(true);

            Runner = new TransportSimulationRunner(
                Store,
                Broadcaster,
                new TransportSimulationOptions
                {
                    TickIntervalMilliseconds = 1_000,
                    SpeedMultiplier = 1,
                    FallbackDurationSeconds = 300
                },
                Substitute.For<ILogger<TransportSimulationRunner>>(),
                _time);

            Service = new TransportSimulationService(db, currentUser, Store, Runner, Runner, Runner);
        }

        public AppDbContext Db { get; }

        public InMemoryTransportSimulationStateStore Store { get; }

        public RecordingBroadcaster Broadcaster { get; }

        public FakeRouter Router { get; }

        public TransportSimulationRunner Runner { get; }

        public TransportSimulationService Service { get; }

        /// <summary>
        /// Gerçek ulaşım servisi: yol üretimi ve adım kalıcılığı ONUN işidir.
        /// </summary>
        /// <remarks>
        /// Sahte bir üretim yolu, ölçmek istediğimiz şeyi — geometri ile
        /// adımların AYNI işlemde yazılmasını — kendi uydurmamızla
        /// doğrulardı.
        /// </remarks>
        public ITransportService Transport => BuildTransportService();

        private DateTime Clock
        {
            get => _time.UtcNow;
            set => _time.UtcNow = value;
        }

        public static async Task<Fixture> CreateAsync()
        {
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase($"transport-navigation-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;

            var fixture = new Fixture(new AppDbContext(options));
            fixture.Clock = DateTime.UtcNow;
            await Task.CompletedTask;
            return fixture;
        }

        private ITransportService BuildTransportService()
        {
            var currentUser = Substitute.For<ICurrentUserService>();
            currentUser.UserId.Returns(UserId);
            currentUser.IsAuthenticated.Returns(true);

            var geography = Substitute.For<IGeographicAuthorizationService>();
            geography.GetEffectiveAuthorizationAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
                .Returns(EffectiveGeographicAuthorization.Unrestricted);

            /* GERÇEK runner iptal portu olarak verilir: yeniden üretim çalışan
               bir simülasyonun altındaki geometriyi değiştirir ve o çalıştırma
               iptal edilmelidir. Sahte bir iptal, ölçmek istediğimiz
               tutarlılığı kendi uydurmamızla doğrulardı. */
            return new TransportService(Db, currentUser, geography, Router, null, Runner);
        }

        public async Task<TransportRoute> AddRouteWithStopsAsync(string name)
        {
            var route = new TransportRoute
            {
                Name = name,
                ColorHex = "#123456",
                IsActive = true,
                IsDeleted = false,
                CreatedDate = DateTime.UtcNow
            };
            Db.TransportRoutes.Add(route);
            await Db.SaveChangesAsync();

            Db.TransportStops.AddRange(
                new TransportStop
                {
                    RouteId = route.Id,
                    UserId = UserId,
                    Name = "Başlangıç",
                    Coordinate = new Point(30, 40) { SRID = 4326 },
                    SequenceOrder = 1,
                    IsActive = true,
                    IsDeleted = false,
                    CreatedDate = DateTime.UtcNow
                },
                new TransportStop
                {
                    RouteId = route.Id,
                    UserId = UserId,
                    Name = "Bitiş",
                    Coordinate = new Point(31, 41) { SRID = 4326 },
                    SequenceOrder = 2,
                    IsActive = true,
                    IsDeleted = false,
                    CreatedDate = DateTime.UtcNow
                });

            await Db.SaveChangesAsync();
            return route;
        }

        /// <summary>Üç eşit manevralı bir hat kurar ve simülasyonu başlatır.</summary>
        public async Task<TransportSimulationResponse> StartRouteAsync(string name)
        {
            var route = await AddRouteWithStopsAsync(name);

            Db.TransportRoutePaths.Add(new TransportRoutePath
            {
                RouteId = route.Id,
                Geometry = new LineString([new Coordinate(30, 40), new Coordinate(31, 41)]) { SRID = 4326 },
                DistanceMeters = PathDistanceMeters,
                DurationSeconds = PathDurationSeconds,
                Profile = "driving",
                GeneratedAt = DateTime.UtcNow,
                IsStale = false,
                Steps =
                [
                    PersistedStep(0, "depart", null, "Birinci Yol", 0, 100),
                    PersistedStep(1, "turn", "right", "İkinci Yol", 100, 200),
                    PersistedStep(2, "arrive", null, "Üçüncü Yol", 200, 300)
                ]
            });
            await Db.SaveChangesAsync();

            var started = await Service.StartAsync(route.Id);
            Assert.True(started.IsSuccess);

            Clock = Store.Find(route.Id)!.StartedAt;
            return started.Value!;
        }

        public async Task<List<TransportRoutePathStep>> ReadStepsAsync(int routeId) =>
            await Db.TransportRoutePathSteps
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(step => step.Path!.RouteId == routeId)
                .OrderBy(step => step.Sequence)
                .ToListAsync();

        public Task AdvanceAsync(double seconds)
        {
            Clock = Clock.AddSeconds(seconds);
            return Runner.AdvanceAsync(Clock);
        }

        private static TransportRoutePathStep PersistedStep(
            int sequence,
            string type,
            string? modifier,
            string? name,
            double start,
            double end) =>
            new()
            {
                Sequence = sequence,
                ManeuverType = type,
                ManeuverModifier = modifier,
                Name = name,
                DistanceMeters = end - start,
                DurationSeconds = end - start,
                StartDistanceMeters = start,
                EndDistanceMeters = end
            };

        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }
}
