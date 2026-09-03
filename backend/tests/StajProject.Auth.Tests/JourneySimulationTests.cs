using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using NetTopologySuite.Geometries;
using NSubstitute;
using StajProject.Api.Authorization;
using StajProject.Api.Controllers;
using StajProject.Api.Hubs;
using Microsoft.Extensions.DependencyInjection;
using StajProject.Application.Activity;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Journeys;
using StajProject.Application.Options;
using StajProject.Application.Simulation;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;
using StajProject.Infrastructure.Simulation;

namespace StajProject.Auth.Tests;

/// <summary>
/// Faz 5D: sunucu otoriteli KİŞİSEL yolculuk simülasyonu.
/// </summary>
/// <remarks>
/// Testler Docker'a, ağa ya da gerçek beklemelere BAĞLI DEĞİLDİR: zaman
/// runner'a dışarıdan verilir, yönlendirme sahte bir adaptörden gelir.
/// </remarks>
public sealed class JourneySimulationTests
{
    private const int Owner = 42;
    private const int Stranger = 99;

    /* --- GÜVEN SINIRI ------------------------------------------------------------ */

    [Fact]
    public void The_start_contract_cannot_carry_geometry_metrics_or_a_plan_id()
    {
        /* ASIL İDDİA: istemcinin otorite gönderebileceği bir ALAN YOKTUR.
           Sunucu yolculuğu niyetten yeniden kurar; bu yüzden "güvenme" kararı
           bir denetime değil, sözleşmenin şekline yaslanır. */
        var properties = typeof(JourneyPlanRequest).GetProperties().Select(item => item.Name).ToArray();

        Assert.Equal(
            ["Mode", "Profile", "RouteId", "FromStopId", "ToStopId", "Waypoints"],
            properties);

        foreach (var forbidden in (string[])
                 ["PlanId", "Geometry", "GeometryWkt", "Wkt", "DistanceMeters", "DurationSeconds", "Steps"])
        {
            Assert.Null(typeof(JourneyPlanRequest).GetProperty(forbidden));
        }

        // Geçiş noktaları da yalnızca KİMLİK taşır.
        foreach (var forbidden in (string[])["Longitude", "Latitude", "Coordinate"])
        {
            Assert.Null(typeof(JourneyWaypointRequest).GetProperty(forbidden));
        }
    }

    [Fact]
    public async Task Start_replans_inside_the_trust_boundary_instead_of_trusting_a_preview()
    {
        await using var fixture = await Fixture.WithRouteAsync();

        // Önce bir önizleme alınır; simülasyon onu HİÇ görmemelidir.
        var preview = await fixture.Planning.PreviewAsync(fixture.Intent());
        Assert.True(preview.IsSuccess);
        var routerCallsAfterPreview = fixture.Router.CallCount;

        var started = await fixture.Simulations.StartAsync(fixture.Intent());

        Assert.True(started.IsSuccess);

        // Planlama BAŞTAN çalıştırıldı: motor yeniden çağrıldı.
        Assert.True(fixture.Router.CallCount > routerCallsAfterPreview);

        // Ve yanıt önizlemenin plan kimliğini taşımaz.
        Assert.NotEqual(Guid.Empty, started.Value!.SimulationId);
        Assert.NotEqual(preview.Value!.PlanId, started.Value.SimulationId);
    }

    [Fact]
    public async Task Start_rejects_an_intent_whose_references_became_unavailable()
    {
        await using var fixture = await Fixture.WithRouteAsync();

        var intent = fixture.Intent(JourneyContractNames.RouteFull);

        // Önizleme zamanında geçerliydi…
        Assert.True((await fixture.Planning.PreviewAsync(intent)).IsSuccess);

        // …ama başlatmadan önce hat silindi.
        var route = await fixture.Db.TransportRoutes.IgnoreQueryFilters().SingleAsync();
        route.IsDeleted = true;
        await fixture.Db.SaveChangesAsync();

        var started = await fixture.Simulations.StartAsync(intent);

        /* Yeniden doğrulamanın bütün amacı budur: bayat bir önizleme geçerli
           olsa bile başlatma REDDEDİLİR. */
        Assert.False(started.IsSuccess);
        Assert.Equal(ServiceErrorKind.NotFound, started.ErrorKind);
        Assert.Null(fixture.Store.FindByOwner(Owner));
    }

    [Fact]
    public async Task The_start_response_is_the_new_truth_even_when_it_differs_from_the_preview()
    {
        await using var fixture = await Fixture.WithRouteAsync();
        var preview = await fixture.Planning.PreviewAsync(fixture.Intent());

        // Motor bu kez BAŞKA bir güzergah üretir (yol durumu değişmiş gibi).
        fixture.Router.NextGeometry = Line((30, 40), (30.5, 40.9), (31, 41), (31.5, 41.4));

        var started = await fixture.Simulations.StartAsync(fixture.Intent());

        Assert.True(started.IsSuccess);

        // Farklı olması bir hata DEĞİLDİR; istemci yeni gerçeği kullanmalıdır.
        Assert.NotEqual(preview.Value!.GeometryWkt, started.Value!.GeometryWkt);
        Assert.Contains("31.5", started.Value.GeometryWkt, StringComparison.Ordinal);
    }

    /* --- SAHİPLİK ---------------------------------------------------------------- */

    [Fact]
    public async Task A_user_may_run_only_one_personal_journey_at_a_time()
    {
        await using var fixture = await Fixture.WithRouteAsync();

        Assert.True((await fixture.Simulations.StartAsync(fixture.Intent())).IsSuccess);

        var second = await fixture.Simulations.StartAsync(fixture.Intent());

        Assert.False(second.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, second.ErrorKind);
    }

    [Fact]
    public async Task Two_users_can_simulate_the_same_journey_independently()
    {
        /* Tekillik KULLANICI başınadır, rota başına DEĞİL: kişisel bir gösterim
           paylaşılan bir kaynağa dönüşmemelidir. */
        await using var fixture = await Fixture.WithRouteAsync();

        var mine = await fixture.Simulations.StartAsync(fixture.Intent());
        var theirs = await fixture.As(Stranger).Simulations.StartAsync(fixture.Intent());

        Assert.True(mine.IsSuccess);
        Assert.True(theirs.IsSuccess);
        Assert.NotEqual(mine.Value!.SimulationId, theirs.Value!.SimulationId);

        Assert.Equal(mine.Value.SimulationId, fixture.Store.FindByOwner(Owner)!.SimulationId);
        Assert.Equal(theirs.Value.SimulationId, fixture.Store.FindByOwner(Stranger)!.SimulationId);
    }

    [Fact]
    public async Task Only_the_owner_can_read_stop_or_join_their_journey()
    {
        await using var fixture = await Fixture.WithRouteAsync();
        var started = (await fixture.Simulations.StartAsync(fixture.Intent())).Value!;

        var stranger = fixture.As(Stranger);

        // Yabancı "mevcut" ucundan başkasının çalıştırmasını GÖREMEZ.
        Assert.Equal(ServiceErrorKind.NotFound, (await stranger.Simulations.GetCurrentAsync()).ErrorKind);

        /* Kimliği bilse bile durduramaz — ve cevap 403 değil 404'tür: ayrı bir
           403, o kimliğin gerçekten var olduğunu DOĞRULARDI. */
        var stop = await stranger.Simulations.StopAsync(started.SimulationId);
        Assert.Equal(ServiceErrorKind.NotFound, stop.ErrorKind);

        // Hub katılımı da aynı kapıdan geçer.
        Assert.Null(stranger.Simulations.FindOwnedLiveUpdate(started.SimulationId, Stranger));
        Assert.NotNull(fixture.Simulations.FindOwnedLiveUpdate(started.SimulationId, Owner));

        // Yabancının kendi çalıştırması hâlâ ayakta.
        Assert.NotNull(fixture.Store.FindByOwner(Owner));
    }

    [Fact]
    public async Task A_guessed_simulation_id_reveals_nothing()
    {
        await using var fixture = await Fixture.WithRouteAsync();

        Assert.Null(fixture.Simulations.FindOwnedLiveUpdate(Guid.NewGuid(), Owner));
        Assert.Equal(
            ServiceErrorKind.NotFound,
            (await fixture.Simulations.StopAsync(Guid.NewGuid())).ErrorKind);
    }

    [Fact]
    public async Task An_unauthenticated_caller_cannot_start_read_or_stop()
    {
        await using var fixture = await Fixture.WithRouteAsync();
        var anonymous = fixture.As(null);

        Assert.Equal(ServiceErrorKind.Forbidden, (await anonymous.Simulations.StartAsync(fixture.Intent())).ErrorKind);
        Assert.Equal(ServiceErrorKind.Forbidden, (await anonymous.Simulations.GetCurrentAsync()).ErrorKind);
        Assert.Equal(ServiceErrorKind.Forbidden, (await anonymous.Simulations.StopAsync(Guid.NewGuid())).ErrorKind);
    }

    /* --- HAREKET ----------------------------------------------------------------- */

    [Fact]
    public async Task A_new_simulation_starts_at_zero_on_the_first_authoritative_coordinate()
    {
        await using var fixture = await Fixture.WithRouteAsync();

        var started = (await fixture.Simulations.StartAsync(fixture.Intent())).Value!;

        Assert.Equal(0, started.Snapshot.ProgressPercent);
        Assert.Equal(0, started.Snapshot.DistanceCoveredMeters);
        Assert.Equal(30, started.Snapshot.Longitude);
        Assert.Equal(40, started.Snapshot.Latitude);
        Assert.Equal("Running", started.Snapshot.Status);

        // Gerçek süre motorun ölçümüdür; oynatma çarpanı onu DEĞİŞTİRMEZ.
        Assert.Equal(FakeJourneyRouter.DefaultDurationSeconds, started.TotalDurationSeconds);
    }

    [Fact]
    public async Task Progress_derives_from_elapsed_server_time_not_from_tick_counting()
    {
        await using var fixture = await Fixture.WithRouteAsync();
        var started = (await fixture.Simulations.StartAsync(fixture.Intent())).Value!;
        var startedAt = fixture.Store.FindByOwner(Owner)!.StartedAt;

        var runner = fixture.Runner(speedMultiplier: 1);

        // TEK bir tick, yarım süre sonra: ilerleme ~%50 olmalıdır.
        await runner.AdvanceAsync(startedAt.AddSeconds(FakeJourneyRouter.DefaultDurationSeconds / 2));

        var half = fixture.Store.FindByOwner(Owner)!;
        Assert.InRange(half.Snapshot.ProgressRatio, 0.45, 0.55);

        // Kaçırılan tick'ler bir sapma BİRİKTİRMEZ.
        await runner.AdvanceAsync(startedAt.AddSeconds(FakeJourneyRouter.DefaultDurationSeconds * 0.75));
        Assert.InRange(fixture.Store.FindByOwner(Owner)!.Snapshot.ProgressRatio, 0.70, 0.80);

        Assert.Equal(started.SimulationId, fixture.Store.FindByOwner(Owner)!.SimulationId);
    }

    [Fact]
    public async Task The_playback_multiplier_only_accelerates_the_demo_never_the_reported_duration()
    {
        await using var fixture = await Fixture.WithRouteAsync();
        var started = (await fixture.Simulations.StartAsync(fixture.Intent())).Value!;
        var startedAt = fixture.Store.FindByOwner(Owner)!.StartedAt;

        // Çarpan 10: gerçek sürenin onda birinde tamamlanır.
        await fixture.Runner(speedMultiplier: 10)
            .AdvanceAsync(startedAt.AddSeconds(FakeJourneyRouter.DefaultDurationSeconds / 10));

        var update = Assert.Single(fixture.Broadcaster.Published);
        Assert.Equal(JourneySimulationStatus.Completed, update.Status);

        /* Ama BİLDİRİLEN süre motorun gerçek ölçümüdür; çarpan ona hiç
           dokunmaz. Aksi hâlde kullanıcıya yanlış bir varış süresi
           gösterilirdi. */
        Assert.Equal(FakeJourneyRouter.DefaultDurationSeconds, started.TotalDurationSeconds);
    }

    [Fact]
    public async Task Movement_follows_the_routed_geometry_rather_than_a_straight_waypoint_line()
    {
        await using var fixture = await Fixture.WithRouteAsync();

        /* Motor keskin bir sapma içeren bir yol döndürür. Uç noktalar arasında
           düz interpolasyon yapılsaydı orta nokta bu sapmayı GÖRMEZDİ. */
        fixture.Router.NextGeometry = Line((30, 40), (30, 41), (31, 41));
        await fixture.Simulations.StartAsync(fixture.Intent());
        var startedAt = fixture.Store.FindByOwner(Owner)!.StartedAt;

        await fixture.Runner(speedMultiplier: 1)
            .AdvanceAsync(startedAt.AddSeconds(FakeJourneyRouter.DefaultDurationSeconds / 2));

        var snapshot = fixture.Store.FindByOwner(Owner)!.Snapshot;

        // Yol köşesinin yakınında: düz çizgi burada (30.5, 40.5) verirdi.
        Assert.InRange(snapshot.Latitude(), 40.8, 41.01);
        Assert.InRange(snapshot.Longitude(), 29.99, 30.6);
    }

    [Fact]
    public async Task Completion_lands_exactly_on_the_final_coordinate_and_is_broadcast_once()
    {
        await using var fixture = await Fixture.WithRouteAsync();
        fixture.Router.NextGeometry = Line((30, 40), (30.5, 40.5), (31, 41));
        await fixture.Simulations.StartAsync(fixture.Intent());
        var startedAt = fixture.Store.FindByOwner(Owner)!.StartedAt;

        var runner = fixture.Runner(speedMultiplier: 1);
        var afterEnd = startedAt.AddSeconds(FakeJourneyRouter.DefaultDurationSeconds * 2);

        await runner.AdvanceAsync(afterEnd);
        // İkinci tick artık aktif bir çalıştırma BULAMAZ.
        await runner.AdvanceAsync(afterEnd.AddSeconds(1));

        var completed = Assert.Single(fixture.Broadcaster.Published);
        Assert.Equal(JourneySimulationStatus.Completed, completed.Status);
        Assert.Equal(100, completed.ProgressPercent);

        // TAM olarak son köşe; yaklaşık değil.
        Assert.Equal(31, completed.Longitude);
        Assert.Equal(41, completed.Latitude);

        // Ve çalıştırma durumdan kalkar: zombi kalmaz.
        Assert.Null(fixture.Store.FindByOwner(Owner));
    }

    [Fact]
    public async Task Stopping_broadcasts_one_cancelled_snapshot_and_halts_advancement()
    {
        await using var fixture = await Fixture.WithRouteAsync();
        var started = (await fixture.Simulations.StartAsync(fixture.Intent())).Value!;
        var startedAt = fixture.Store.FindByOwner(Owner)!.StartedAt;

        var stop = await fixture.Simulations.StopAsync(started.SimulationId);

        Assert.True(stop.IsSuccess);
        Assert.Equal("Cancelled", stop.Value!.Status);
        var cancelled = Assert.Single(fixture.Broadcaster.Published);
        Assert.Equal(JourneySimulationStatus.Cancelled, cancelled.Status);
        Assert.Null(fixture.Store.FindByOwner(Owner));

        // Sonraki tick'ler hiçbir şey yayınlamaz: zombi timer yok.
        await fixture.Runner(speedMultiplier: 1).AdvanceAsync(startedAt.AddSeconds(30));
        Assert.Single(fixture.Broadcaster.Published);

        // İkinci durdurma da sessizce güvenlidir.
        Assert.Equal(
            ServiceErrorKind.NotFound,
            (await fixture.Simulations.StopAsync(started.SimulationId)).ErrorKind);
    }

    [Fact]
    public void A_stale_run_can_never_overwrite_a_newer_one()
    {
        var store = new InMemoryJourneySimulationStateStore();
        var first = Simulation(Owner);
        var snapshot = first.Snapshot with { ProgressRatio = 0.5, CapturedAt = DateTime.UtcNow };

        Assert.True(store.TryStart(first));
        Assert.True(store.TryUpdateSnapshot(first.SimulationId, snapshot));

        // Sahip yolculuğu durdurup yenisini başlatır.
        Assert.True(store.TryStop(first.SimulationId));
        var second = Simulation(Owner);
        Assert.True(store.TryStart(second));

        // Geç kalmış ESKİ tick yeni çalıştırmayı ne günceller ne durdurur.
        Assert.False(store.TryUpdateSnapshot(first.SimulationId, snapshot));
        Assert.False(store.TryStop(first.SimulationId));
        Assert.Equal(second.SimulationId, store.FindByOwner(Owner)!.SimulationId);
        Assert.Equal(0, store.FindByOwner(Owner)!.Snapshot.ProgressRatio);
    }

    [Fact]
    public void Concurrent_starts_for_one_user_produce_exactly_one_simulation()
    {
        var store = new InMemoryJourneySimulationStateStore();
        var candidates = Enumerable.Range(0, 32).Select(_ => Simulation(Owner)).ToArray();

        var winners = 0;
        Parallel.ForEach(candidates, candidate =>
        {
            if (store.TryStart(candidate)) Interlocked.Increment(ref winners);
        });

        Assert.Equal(1, winners);
        Assert.NotNull(store.FindByOwner(Owner));
    }

    /* --- YENİLEME / KURTARMA ----------------------------------------------------- */

    [Fact]
    public async Task Current_returns_the_same_authoritative_details_as_start()
    {
        await using var fixture = await Fixture.WithRouteAsync();

        var started = (await fixture.Simulations.StartAsync(fixture.Intent())).Value!;
        var routerCallsAfterStart = fixture.Router.CallCount;

        // Tarayıcı yenilendi: elde hiçbir şey yok, sunucudan sorulur.
        var recovered = (await fixture.Simulations.GetCurrentAsync()).Value!;

        /* ASIL İDDİA: kurtarma, başlatmanın DÖNDÜRDÜĞÜ gerçeğin aynısıdır.
           İki uç aynı eşlemeden geçtiği için ayrışamazlar. */
        Assert.Equal(started.SimulationId, recovered.SimulationId);
        Assert.Equal(started.Mode, recovered.Mode);
        Assert.Equal(started.RequestedProfile, recovered.RequestedProfile);
        Assert.Equal(started.EffectiveProfile, recovered.EffectiveProfile);
        Assert.Equal(started.GeometryWkt, recovered.GeometryWkt);
        Assert.Equal(started.TotalDistanceMeters, recovered.TotalDistanceMeters);
        Assert.Equal(started.TotalDurationSeconds, recovered.TotalDurationSeconds);
        Assert.Equal(started.RouteId, recovered.RouteId);
        Assert.Equal(started.RouteName, recovered.RouteName);
        Assert.Equal(started.StartedAt, recovered.StartedAt);

        // Ve kurtarma yönlendirme motoruna YENİDEN GİTMEZ.
        Assert.Equal(routerCallsAfterStart, fixture.Router.CallCount);
    }

    [Fact]
    public async Task Current_restores_waypoint_labels_and_navigation_steps()
    {
        await using var fixture = await Fixture.WithRouteAsync();
        await fixture.Simulations.StartAsync(fixture.Intent());

        var recovered = (await fixture.Simulations.GetCurrentAsync()).Value!;

        /* Yenilemeden sonra panel hattın adını, durak etiketlerini ve
           manevraları KAYBETMEMELİDİR — eskiden bunlar boş dönüyordu. */
        Assert.Equal(2, recovered.Waypoints.Count);
        Assert.Equal(["A", "B"], recovered.Waypoints.Select(waypoint => waypoint.Name));
        Assert.Equal(["origin", "destination"], recovered.Waypoints.Select(waypoint => waypoint.Role));
        Assert.All(recovered.Waypoints, waypoint => Assert.Equal("transportStop", waypoint.Source));

        Assert.NotEmpty(recovered.Steps);
        Assert.Equal(["depart", "turn", "arrive"], recovered.Steps.Select(step => step.ManeuverType));
        Assert.Equal([0, 1, 2], recovered.Steps.Select(step => step.Sequence));

        // Anlık manevra kurtarılan adımlara karşı çözülebilir.
        Assert.NotNull(recovered.Snapshot);
        Assert.InRange(recovered.Snapshot.CurrentStepSequence ?? -1, 0, recovered.Steps.Count - 1);
    }

    [Fact]
    public async Task Recovered_metadata_comes_from_the_server_plan_not_the_client_intent()
    {
        await using var fixture = await Fixture.WithRouteAsync();

        /* İstemcinin niyeti yalnızca KİMLİK taşır; adlar, roller, geometri ve
           manevralar sunucunun kendi plan sonucundan gelir. */
        var intent = fixture.Intent();
        Assert.All(intent.Waypoints!, waypoint => Assert.NotNull(waypoint.ReferenceId));

        await fixture.Simulations.StartAsync(intent);
        var recovered = (await fixture.Simulations.GetCurrentAsync()).Value!;

        // Etiketler veritabanındaki durak adlarıdır; istekte böyle bir alan yok.
        Assert.Equal(["A", "B"], recovered.Waypoints.Select(waypoint => waypoint.Name));
        Assert.Equal(fixture.StopIds, recovered.Waypoints.Select(waypoint => waypoint.ReferenceId));
        Assert.StartsWith("LINESTRING", recovered.GeometryWkt, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_route_full_journey_with_no_steps_still_recovers()
    {
        /* Motor kullanılamıyorken kişisel yolculuk KALICI yola düşer ve o yol
           manevra saklamaz. Ölçülen şey budur: manevrasız bir yolculuk
           kurtarılabilir olmalıdır. (Motor çalışırken routeFull artık kendi
           planını üretir ve adımları OLUR — bkz. JourneyRoutingTests.) */
        await using var fixture = await Fixture.WithRouteAsync(
            router: FakeJourneyRouter.Failing(ServiceErrorKind.Upstream));
        await fixture.AddPathAsync(Line((30, 40), (30.5, 40.5), (31, 41)));

        var started = (await fixture.Simulations.StartAsync(new JourneyPlanRequest
        {
            Mode = JourneyContractNames.RouteFull,
            Profile = JourneyContractNames.Driving,
            RouteId = fixture.RouteId,
        })).Value!;

        var recovered = (await fixture.Simulations.GetCurrentAsync()).Value!;

        // Manevrasız kurtarma bir HATA DEĞİLDİR ve geri kalan her şey gelir.
        Assert.Empty(recovered.Steps);
        Assert.Null(recovered.Snapshot.CurrentStepSequence);
        Assert.Equal(started.GeometryWkt, recovered.GeometryWkt);
        Assert.Equal(fixture.RouteId, recovered.RouteId);
        Assert.Equal("Hat", recovered.RouteName);
        Assert.Equal(2, recovered.Waypoints.Count);

        /* Kurtarma SÜREÇ İÇİ oturumdan okunur: motora ikinci kez gidilmez.
           (Tek çağrı başlatma anındaki başarısız denemedir.) */
        Assert.Equal(1, fixture.Router.CallCount);
    }

    [Fact]
    public async Task A_route_full_journey_carries_real_navigation_steps_when_routing_works()
    {
        /* Manuel kabul testinde görülen eksik: gerçek bir rota çizilirken panel
           "bu güzergâh için adım adım yönlendirme bulunmuyor" diyordu. */
        await using var fixture = await Fixture.WithRouteAsync();
        await fixture.AddPathAsync(Line((30, 40), (30.5, 40.5), (31, 41)));

        var started = (await fixture.Simulations.StartAsync(new JourneyPlanRequest
        {
            Mode = JourneyContractNames.RouteFull,
            Profile = JourneyContractNames.Driving,
            RouteId = fixture.RouteId,
        })).Value!;

        Assert.NotEmpty(started.Steps);

        // Geometri ve adımlar AYNI plandandır: simülasyon o geometride ilerler.
        var active = fixture.Store.FindByOwner(Owner)!;
        Assert.Equal(started.Steps.Count, active.Details.Steps.Count);
        Assert.NotEmpty(active.Path.StepDistances);

        // Kurtarma da aynı adımları döndürür.
        var recovered = (await fixture.Simulations.GetCurrentAsync()).Value!;
        Assert.Equal(started.Steps.Count, recovered.Steps.Count);
    }

    [Fact]
    public async Task Recovery_still_answers_only_to_the_owner()
    {
        await using var fixture = await Fixture.WithRouteAsync();
        await fixture.Simulations.StartAsync(fixture.Intent());

        // Zenginleşen gövde gizlilik kuralını GEVŞETMEZ.
        Assert.Equal(
            ServiceErrorKind.NotFound,
            (await fixture.As(Stranger).Simulations.GetCurrentAsync()).ErrorKind);
        Assert.True((await fixture.Simulations.GetCurrentAsync()).IsSuccess);
    }

    [Fact]
    public void The_retained_recovery_metadata_is_plain_immutable_data()
    {
        /* Depoya giren her şey sıradan, değişmez veridir: singleton bir
           sözlükte tutulan takip edilen bir varlık ya da geometri nesnesi,
           kapanmış bir istek kapsamını süresiz canlı tutardı. */
        foreach (var property in typeof(JourneySimulationDetails).GetProperties())
        {
            var name = property.PropertyType.Name;
            foreach (var forbidden in (string[])
                     ["DbContext", "LineString", "Geometry", "ClaimsPrincipal", "HttpContext", "TransportRoute", "Poi"])
            {
                Assert.DoesNotContain(forbidden, name, StringComparison.Ordinal);
            }
        }

        // Geometri METİN olarak taşınır; NTS nesnesi olarak değil.
        Assert.Equal(typeof(string), typeof(JourneySimulationDetails).GetProperty("GeometryWkt")!.PropertyType);
    }

    /* --- NAVİGASYON -------------------------------------------------------------- */

    [Fact]
    public void The_current_maneuver_advances_deterministically_from_covered_distance()
    {
        var ends = JourneyStepDistances.CumulativeEnds([
            Step(0, 100),
            Step(1, 200),
            Step(2, 0),
        ]);

        Assert.Equal([100d, 300d, 300d], ends);

        Assert.Equal(0, JourneyStepDistances.StepAt(ends, 0));
        Assert.Equal(0, JourneyStepDistances.StepAt(ends, 99));
        Assert.Equal(1, JourneyStepDistances.StepAt(ends, 100));
        Assert.Equal(1, JourneyStepDistances.StepAt(ends, 299));

        // Sonun ötesinde varış manevrasında KALINIR; aralık dışına düşülmez.
        Assert.Equal(2, JourneyStepDistances.StepAt(ends, 5_000));
        Assert.Equal(0, JourneyStepDistances.StepAt(ends, double.NaN));
    }

    [Fact]
    public void An_empty_maneuver_list_is_valid_and_yields_no_current_step()
    {
        /* Kalıcı güzergahı yeniden kullanan bir tam-hat yolculuğunda manevra
           YOKTUR. Bu bir hata değildir ve talimat UYDURULMAZ. */
        Assert.Empty(JourneyStepDistances.CumulativeEnds([]));
        Assert.Empty(JourneyStepDistances.CumulativeEnds(null));
        Assert.Null(JourneyStepDistances.StepAt([], 0));
        Assert.Null(JourneyStepDistances.StepAt([], 1_000));
    }

    [Fact]
    public async Task A_journey_without_maneuvers_still_runs_and_keeps_a_null_current_step()
    {
        /* SENARYO DÜRÜSTÇE KURULUR (routeFull sözleşmesi değişti).

           Artık kalıcı bir yolun VARLIĞI motoru atlatmaz: kişisel yolculuk önce
           canlı yönlendirmeyi dener. Manevrasız bir plan ancak motor
           kullanılamadığında doğar — kayıtlı yol devreye girer ve o yol manevra
           saklamaz.

           Korunan ASIL değer bu testin adındadır: manevra verisi OLMAYAN bir
           yolculuk da güvenle çalışır ve güncel adım boş kalır. */
        await using var fixture = await Fixture.WithRouteAsync(
            router: FakeJourneyRouter.Failing(ServiceErrorKind.Upstream));

        var persisted = Line((30, 40), (30.5, 40.5), (31, 41));
        await fixture.AddPathAsync(persisted);

        var started = await fixture.Simulations.StartAsync(new JourneyPlanRequest
        {
            Mode = JourneyContractNames.RouteFull,
            Profile = JourneyContractNames.Driving,
            RouteId = fixture.RouteId,
        });

        Assert.True(started.IsSuccess);

        // Canlı yönlendirme DENENDİ ve başarısız oldu; kayıtlı yol devraldı.
        Assert.Equal(1, fixture.Router.CallCount);
        Assert.Equal(persisted.NumPoints, fixture.Store.FindByOwner(Owner)!.Path.Points.Count);
        Assert.Equal(900, started.Value!.TotalDistanceMeters);

        // Manevra yok: uydurulmuş bir adım listesi yerine dürüst bir boşluk.
        Assert.Empty(started.Value.Steps);
        Assert.Null(started.Value.Snapshot.CurrentStepSequence);

        // Ve simülasyon yine de sorunsuz ilerler.
        var startedAt = fixture.Store.FindByOwner(Owner)!.StartedAt;
        await fixture.Runner(speedMultiplier: 1).AdvanceAsync(startedAt.AddSeconds(10));

        var published = Assert.Single(fixture.Broadcaster.Published);
        Assert.True(published.ProgressPercent > 0);
        // Adım verisi yokken güncel adım BOŞ kalır; sıra uydurulmaz.
        Assert.Null(published.CurrentStepSequence);

        /* Kalıcı yol OKUNDU, yazılmadı: paylaşılan ürünün otoritesi yerinde
           kalır. */
        var stored = await fixture.Db.TransportRoutePaths.AsNoTracking()
            .SingleAsync(item => item.RouteId == fixture.RouteId);
        Assert.False(stored.IsStale);
        Assert.Equal(900, stored.DistanceMeters);
        Assert.Equal(persisted.NumPoints, stored.Geometry.NumPoints);
    }

    /* --- PROFİL ------------------------------------------------------------------ */

    [Fact]
    public async Task Walking_and_cycling_cannot_start_without_their_own_engine()
    {
        foreach (var profile in (string[])[JourneyContractNames.Walking, JourneyContractNames.Cycling])
        {
            await using var fixture = await Fixture.WithRouteAsync();
            var intent = fixture.Intent();
            intent.Profile = profile;

            var started = await fixture.Simulations.StartAsync(intent);

            Assert.False(started.IsSuccess);
            Assert.Equal(ServiceErrorKind.Validation, started.ErrorKind);

            /* SÜRÜŞE DÜŞÜLMEZ ve bayat önizleme bir kaçış yolu DEĞİLDİR:
               hiçbir çalıştırma oluşmaz. */
            Assert.Null(fixture.Store.FindByOwner(Owner));
            Assert.Equal(0, fixture.Router.CallCount);
        }
    }

    [Fact]
    public async Task Walking_starts_when_a_genuine_walking_engine_is_configured()
    {
        await using var fixture = await Fixture.WithRouteAsync(
            [JourneyTravelProfile.Driving, JourneyTravelProfile.Walking]);
        var intent = fixture.Intent();
        intent.Profile = JourneyContractNames.Walking;

        var started = await fixture.Simulations.StartAsync(intent);

        Assert.True(started.IsSuccess);
        Assert.Equal("walking", started.Value!.RequestedProfile);
        Assert.Equal("walking", started.Value.EffectiveProfile);
    }

    [Fact]
    public async Task A_bus_profile_cannot_start_a_simulation()
    {
        await using var fixture = await Fixture.WithRouteAsync();
        var intent = fixture.Intent();
        intent.Profile = "bus";

        var started = await fixture.Simulations.StartAsync(intent);

        Assert.False(started.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, started.ErrorKind);
        Assert.Null(fixture.Store.FindByOwner(Owner));
    }

    /* --- HATALAR ----------------------------------------------------------------- */

    [Fact]
    public async Task Routing_failures_keep_their_error_kind_and_leak_no_internals()
    {
        foreach (var kind in (ServiceErrorKind[])[ServiceErrorKind.Upstream, ServiceErrorKind.Timeout])
        {
            await using var fixture = await Fixture.WithRouteAsync(
                router: FakeJourneyRouter.Failing(kind));

            var started = await fixture.Simulations.StartAsync(fixture.Intent(JourneyContractNames.Waypoints));

            Assert.False(started.IsSuccess);
            Assert.Equal(kind, started.ErrorKind);
            Assert.Null(fixture.Store.FindByOwner(Owner));

            foreach (var leak in (string[])["http", "osrm", "localhost", "5000", "docker", "Exception"])
            {
                Assert.DoesNotContain(leak, started.Error!, StringComparison.OrdinalIgnoreCase);
            }
        }
    }

    /* --- UÇ / YETKİ SÖZLEŞMESİ --------------------------------------------------- */

    [Fact]
    public void The_endpoints_use_the_personal_journey_permission_and_never_the_management_one()
    {
        AssertEndpoint(nameof(JourneySimulationController.Start), typeof(HttpPostAttribute), null);
        AssertEndpoint(nameof(JourneySimulationController.Current), typeof(HttpGetAttribute), "current");
        AssertEndpoint(nameof(JourneySimulationController.Stop), typeof(HttpPostAttribute), "{simulationId:guid}/stop");

        var route = Assert.Single(
            typeof(JourneySimulationController)
                .GetCustomAttributes(typeof(RouteAttribute), true)
                .Cast<RouteAttribute>());
        Assert.Equal("api/transport/journeys/simulations", route.Template);

        // PAYLAŞILAN hattın yaşam döngüsü kodları bu üründe İSTENMEZ ve
        // değişmeden kalır.
        Assert.Equal("transport.simulation.start", PermissionCodes.TransportSimulationStart);
        Assert.Equal("transport.simulation.stop", PermissionCodes.TransportSimulationStop);
    }

    [Fact]
    public void The_product_permission_is_decoupled_from_the_transport_network_permission()
    {
        /* İKİ YÖNLÜ ayrım: kodlar farklıdır ve biri diğerini İMA ETMEZ.
           Kişisel yolculuk verilmesi ulaşım ağını açmaz; ulaşım ağını
           izleyebilmek kişisel yolculuk vermez. */
        Assert.Equal("journey.use", PermissionCodes.JourneyUse);
        Assert.NotEqual(PermissionCodes.TransportView, PermissionCodes.JourneyUse);
        Assert.Contains(PermissionCodes.JourneyUse, PermissionCatalog.AllCodes);
    }

    [Fact]
    public async Task Missing_journey_use_fails_closed_for_the_journey_endpoints()
    {
        var permissions = Substitute.For<IEffectivePermissionService>();
        permissions
            .HasPermissionAsync(Owner, PermissionCodes.JourneyUse, Arg.Any<CancellationToken>())
            .Returns(false);

        var context = new AuthorizationHandlerContext(
            [new PermissionRequirement(PermissionCodes.JourneyUse)],
            new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity(
                [new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.NameIdentifier, "42")],
                "test")),
            resource: null);

        await new PermissionAuthorizationHandler(permissions).HandleAsync(context);
        Assert.False(context.HasSucceeded);
    }

    /* --- SIGNALR SÖZLEŞMESİ ------------------------------------------------------ */

    [Fact]
    public void The_journey_channel_is_separate_from_the_shared_route_channel()
    {
        Assert.Equal("/hubs/journey-simulation", JourneySimulationHubContract.Path);
        Assert.NotEqual(TransportSimulationHubContract.Path, JourneySimulationHubContract.Path);
        Assert.NotEqual(TransportSimulationHubContract.UpdateMethod, JourneySimulationHubContract.UpdateMethod);

        /* Grup adları ASLA çakışmaz: kişisel bir yolculuk, paylaşılan bir hat
           grubuna kazara katılamaz. */
        var journeyGroup = JourneySimulationHubContract.GroupFor(Guid.NewGuid());
        Assert.StartsWith("journey-simulation-", journeyGroup, StringComparison.Ordinal);
        Assert.DoesNotContain("transport-simulation-route-", journeyGroup, StringComparison.Ordinal);

        for (var routeId = 1; routeId < 50; routeId++)
        {
            Assert.NotEqual(TransportSimulationHubContract.GroupFor(routeId), journeyGroup);
        }
    }

    [Fact]
    public void The_journey_hub_requires_authentication_and_carries_no_role_shortcut()
    {
        Assert.Single(typeof(JourneySimulationHub).GetCustomAttributes(typeof(AuthorizeAttribute), true));

        var authorize = typeof(JourneySimulationHub)
            .GetCustomAttributes(typeof(AuthorizeAttribute), true)
            .Cast<AuthorizeAttribute>()
            .Single();

        Assert.Null(authorize.Roles);
        Assert.Null(authorize.Policy);

        // Yetkilendirme YALNIZCA etkin yetki portundan geçer.
        var dependencies = typeof(JourneySimulationHub).GetConstructors().Single()
            .GetParameters().Select(parameter => parameter.ParameterType).ToArray();
        Assert.Contains(typeof(IEffectivePermissionService), dependencies);
        Assert.DoesNotContain(dependencies, type => type.Name.Contains("Role", StringComparison.Ordinal));
    }

    /* --- REGRESYON --------------------------------------------------------------- */

    [Fact]
    public void The_shared_route_simulation_is_untouched_by_this_phase()
    {
        // Eski servis ve deposu aynen durur; yeni ürün ONLARA hiç bağlanmaz.
        Assert.Contains(
            typeof(ITransportSimulationService).GetMethods(),
            method => method.Name == nameof(ITransportSimulationService.StartAsync));

        var journeyDependencies = typeof(JourneySimulationService).GetConstructors().Single()
            .GetParameters().Select(parameter => parameter.ParameterType).ToArray();

        Assert.DoesNotContain(typeof(ITransportSimulationService), journeyDependencies);
        Assert.DoesNotContain(typeof(ITransportSimulationStateStore), journeyDependencies);
        Assert.DoesNotContain(typeof(ITransportSimulationBroadcaster), journeyDependencies);

        // Ve eski runner yolculuk deposunu hiç görmez.
        var runnerDependencies = typeof(TransportSimulationRunner).GetConstructors().Single()
            .GetParameters().Select(parameter => parameter.ParameterType).ToArray();
        Assert.DoesNotContain(typeof(IJourneySimulationStateStore), runnerDependencies);
        Assert.DoesNotContain(typeof(IJourneySimulationBroadcaster), runnerDependencies);
    }

    [Fact]
    public void The_journey_runtime_retains_no_ef_or_request_scoped_objects()
    {
        /* Depoya giren her şey sıradan, değişmez veridir: singleton bir
           sözlükte tutulan takip edilen bir varlık, kapanmış bir istek
           kapsamını süresiz canlı tutardı. */
        foreach (var property in typeof(ActiveJourneySimulation).GetProperties())
        {
            var name = property.PropertyType.Name;
            Assert.DoesNotContain("DbContext", name, StringComparison.Ordinal);
            Assert.DoesNotContain("LineString", name, StringComparison.Ordinal);
            Assert.DoesNotContain("ClaimsPrincipal", name, StringComparison.Ordinal);
            Assert.DoesNotContain("HttpContext", name, StringComparison.Ordinal);
        }
    }

    /* --- Yardımcılar ------------------------------------------------------------- */

    private static void AssertEndpoint(string methodName, Type httpAttributeType, string? template)
    {
        var method = typeof(JourneySimulationController).GetMethod(methodName)!;
        var route = Assert.Single(method.GetCustomAttributes(httpAttributeType, true).Cast<HttpMethodAttribute>());
        var required = Assert.Single(method.GetCustomAttributes<RequirePermissionAttribute>(true));

        Assert.Equal(template, route.Template);
        Assert.Equal(PermissionCodes.JourneyUse, required.PermissionCode);
        Assert.NotEqual(PermissionCodes.TransportView, required.PermissionCode);
        Assert.NotEqual(PermissionCodes.TransportSimulationStart, required.PermissionCode);
        Assert.NotEqual(PermissionCodes.TransportSimulationStop, required.PermissionCode);
    }

    private static JourneyRouteStep Step(int sequence, double distance) =>
        new(sequence, "turn", null, null, distance, 10, new JourneyCoordinate(30, 40), null);

    private static LineString Line(params (double X, double Y)[] coordinates) =>
        new([.. coordinates.Select(coordinate => new Coordinate(coordinate.X, coordinate.Y))]) { SRID = 4326 };

    /* --- AKTİVİTE GEÇMİŞİ (Faz 5E-B · Dilim 7B) ---------------------------------
       Kayıt, atomik geçişi KAZANAN kod yolunda oluşur; mükerrerlik bu yüzden
       bir kontrolle değil, yapıyla engellenir. */

    [Fact]
    public async Task A_successful_start_writes_exactly_one_started_activity()
    {
        await using var fixture = await Fixture.WithRouteAsync();

        var started = (await fixture.Simulations.StartAsync(fixture.Intent())).Value!;

        var (outcome, ownerUserId) = Assert.Single(fixture.Activity.Written);

        Assert.Equal(JourneyActivityKind.Started, outcome.Kind);
        Assert.Equal(started.SimulationId, outcome.SimulationId);
        Assert.Equal(Owner, ownerUserId);
        Assert.Equal(JourneyTravelProfile.Driving, outcome.RequestedProfile);
    }

    [Fact]
    public async Task A_failed_start_writes_no_activity_at_all()
    {
        await using var fixture = await Fixture.WithRouteAsync();

        // Geçersiz seçim: planlama hiç başarılı olmaz.
        var failed = await fixture.Simulations.StartAsync(
            new JourneyPlanRequest
            {
                Mode = JourneyContractNames.RouteFull,
                Profile = JourneyContractNames.Driving,
                RouteId = null,
            });

        Assert.False(failed.IsSuccess);
        Assert.Empty(fixture.Activity.Written);

        // Çakışan ikinci başlatma da kaydedilmez: geçişi kazanmamıştır.
        Assert.True((await fixture.Simulations.StartAsync(fixture.Intent())).IsSuccess);
        var conflict = await fixture.Simulations.StartAsync(fixture.Intent());

        Assert.False(conflict.IsSuccess);
        Assert.Single(fixture.Activity.Written);
    }

    [Fact]
    public async Task Reading_the_current_simulation_writes_no_activity()
    {
        await using var fixture = await Fixture.WithRouteAsync();
        await fixture.Simulations.StartAsync(fixture.Intent());
        fixture.Activity.Written.Clear();

        // Kurtarma bir OKUMADIR: benimseme, durum değişikliği değildir.
        Assert.True((await fixture.Simulations.GetCurrentAsync()).IsSuccess);
        Assert.Empty(fixture.Activity.Written);
    }

    [Fact]
    public async Task Movement_ticks_write_no_activity_until_the_terminal_transition()
    {
        await using var fixture = await Fixture.WithRouteAsync();
        await fixture.Simulations.StartAsync(fixture.Intent());
        var startedAt = fixture.Store.FindByOwner(Owner)!.StartedAt;
        fixture.Activity.Written.Clear();

        var runner = fixture.Runner(speedMultiplier: 1);

        // Ara tick'ler ilerleme yayar ama denetim olayı DEĞİLDİR.
        await runner.AdvanceAsync(startedAt.AddSeconds(FakeJourneyRouter.DefaultDurationSeconds * 0.25));
        await runner.AdvanceAsync(startedAt.AddSeconds(FakeJourneyRouter.DefaultDurationSeconds * 0.5));
        await runner.AdvanceAsync(startedAt.AddSeconds(FakeJourneyRouter.DefaultDurationSeconds * 0.75));

        Assert.Empty(fixture.Activity.Written);
    }

    [Fact]
    public async Task An_explicit_stop_writes_exactly_one_cancelled_activity()
    {
        await using var fixture = await Fixture.WithRouteAsync();
        var started = (await fixture.Simulations.StartAsync(fixture.Intent())).Value!;
        fixture.Activity.Written.Clear();

        Assert.True((await fixture.Simulations.StopAsync(started.SimulationId)).IsSuccess);

        var (outcome, ownerUserId) = Assert.Single(fixture.Activity.Written);
        Assert.Equal(JourneyActivityKind.Cancelled, outcome.Kind);
        Assert.Equal(started.SimulationId, outcome.SimulationId);
        Assert.Equal(Owner, ownerUserId);
    }

    [Fact]
    public async Task A_repeated_or_foreign_stop_cannot_duplicate_the_terminal_activity()
    {
        await using var fixture = await Fixture.WithRouteAsync();
        var started = (await fixture.Simulations.StartAsync(fixture.Intent())).Value!;
        fixture.Activity.Written.Clear();

        Assert.True((await fixture.Simulations.StopAsync(started.SimulationId)).IsSuccess);

        // İkinci durdurma geçişi KAYBEDER: ikinci satır yazılmaz.
        Assert.False((await fixture.Simulations.StopAsync(started.SimulationId)).IsSuccess);
        // Başkasının isteği zaten 404'tür.
        Assert.False((await fixture.As(Stranger).Simulations.StopAsync(started.SimulationId)).IsSuccess);

        Assert.Single(fixture.Activity.Written);
    }

    [Fact]
    public async Task Natural_completion_writes_exactly_one_completed_activity()
    {
        await using var fixture = await Fixture.WithRouteAsync();
        await fixture.Simulations.StartAsync(fixture.Intent());
        var startedAt = fixture.Store.FindByOwner(Owner)!.StartedAt;
        fixture.Activity.Written.Clear();

        var runner = fixture.Runner(speedMultiplier: 1);
        var afterEnd = startedAt.AddSeconds(FakeJourneyRouter.DefaultDurationSeconds * 2);

        await runner.AdvanceAsync(afterEnd);
        // Bayat bir tick daha: çalıştırma zaten durumdan düştü.
        await runner.AdvanceAsync(afterEnd.AddSeconds(1));

        var (outcome, ownerUserId) = Assert.Single(fixture.Activity.Written);
        Assert.Equal(JourneyActivityKind.Completed, outcome.Kind);
        Assert.Equal(Owner, ownerUserId);

        /* Sahip kimliği ARKA PLANDA oturumdan değil, çalıştırmanın kendi
           değişmez durumundan gelir. */
        Assert.Equal(100, outcome.ProgressPercent);
    }

    [Fact]
    public async Task A_completed_run_can_never_also_produce_a_cancelled_activity()
    {
        await using var fixture = await Fixture.WithRouteAsync();
        var started = (await fixture.Simulations.StartAsync(fixture.Intent())).Value!;
        var startedAt = fixture.Store.FindByOwner(Owner)!.StartedAt;
        fixture.Activity.Written.Clear();

        await fixture.Runner(speedMultiplier: 1)
            .AdvanceAsync(startedAt.AddSeconds(FakeJourneyRouter.DefaultDurationSeconds * 2));

        // Tamamlanmış çalıştırmayı durdurmak artık mümkün değildir.
        Assert.False((await fixture.Simulations.StopAsync(started.SimulationId)).IsSuccess);

        var single = Assert.Single(fixture.Activity.Written);
        Assert.Equal(JourneyActivityKind.Completed, single.Outcome.Kind);
    }

    [Fact]
    public async Task A_cancelled_run_can_never_later_produce_a_completed_activity()
    {
        await using var fixture = await Fixture.WithRouteAsync();
        var started = (await fixture.Simulations.StartAsync(fixture.Intent())).Value!;
        var startedAt = fixture.Store.FindByOwner(Owner)!.StartedAt;
        fixture.Activity.Written.Clear();

        Assert.True((await fixture.Simulations.StopAsync(started.SimulationId)).IsSuccess);

        // Runner artık o çalıştırmayı görmez; geç tick bir olay üretemez.
        await fixture.Runner(speedMultiplier: 1)
            .AdvanceAsync(startedAt.AddSeconds(FakeJourneyRouter.DefaultDurationSeconds * 2));

        var single = Assert.Single(fixture.Activity.Written);
        Assert.Equal(JourneyActivityKind.Cancelled, single.Outcome.Kind);
    }

    /* --- DENETİM ARIZASI YAŞAM DÖNGÜSÜNÜ YALANLAYAMAZ ----------------------------
       Aktivite geçmişi GÖZLEMDİR. Kalıcılığı arızalandığında eksik kalan şey bir
       denetim satırıdır; simülasyonun gerçeği ya da çağırana verilen cevap
       değil. Aşağıdaki testler gerçek kaydediciyi, HER YAZMADA fırlatan bir
       yazıcının üzerine kurar. */

    [Fact]
    public async Task A_failing_activity_store_cannot_turn_a_successful_start_into_a_failure()
    {
        await using var fixture = await Fixture.WithRouteAsync(failingActivity: true);

        var started = await fixture.Simulations.StartAsync(fixture.Intent());

        // Geçiş kazanıldı: çağıran BAŞARI görür.
        Assert.True(started.IsSuccess);

        // Ve simülasyon gerçekten çalışıyor: durum geri alınmaz.
        var active = fixture.Store.FindByOwner(Owner);
        Assert.NotNull(active);
        Assert.Equal(started.Value!.SimulationId, active!.SimulationId);
    }

    [Fact]
    public async Task A_failing_activity_store_cannot_turn_a_successful_stop_into_a_failure()
    {
        await using var fixture = await Fixture.WithRouteAsync(failingActivity: true);
        var started = (await fixture.Simulations.StartAsync(fixture.Intent())).Value!;

        var stopped = await fixture.Simulations.StopAsync(started.SimulationId);

        Assert.True(stopped.IsSuccess);
        Assert.Equal("Cancelled", stopped.Value!.Status);

        // Terminal durum KALICIDIR: çalıştırma durumdan düşmüştür.
        Assert.Null(fixture.Store.FindByOwner(Owner));
        Assert.Null(fixture.Store.Find(started.SimulationId));
    }

    [Fact]
    public async Task A_failing_activity_store_cannot_undo_or_repeat_natural_completion()
    {
        await using var fixture = await Fixture.WithRouteAsync(failingActivity: true);
        await fixture.Simulations.StartAsync(fixture.Intent());
        var startedAt = fixture.Store.FindByOwner(Owner)!.StartedAt;

        var runner = fixture.Runner(speedMultiplier: 1);
        var afterEnd = startedAt.AddSeconds(FakeJourneyRouter.DefaultDurationSeconds * 2);

        /* Runner AYAKTA kalır: denetim arızası ilerletme yolundan dışarı
           sızmaz. */
        await runner.AdvanceAsync(afterEnd);
        await runner.AdvanceAsync(afterEnd.AddSeconds(1));

        // Tamamlanma gerçekleşti ve TEK kez yayınlandı.
        Assert.Null(fixture.Store.FindByOwner(Owner));
        Assert.Single(fixture.Broadcaster.Published.Where(update => update.Status == JourneySimulationStatus.Completed));
    }

    [Fact]
    public async Task The_broadcast_still_reaches_the_client_when_the_activity_store_fails()
    {
        await using var fixture = await Fixture.WithRouteAsync(failingActivity: true);
        var started = (await fixture.Simulations.StartAsync(fixture.Intent())).Value!;

        Assert.True((await fixture.Simulations.StopAsync(started.SimulationId)).IsSuccess);

        /* Yayın davranışı DEĞİŞMEZ: istemci durduğunu canlı kanaldan da
           öğrenir, denetim deposu arızalı olsa bile. */
        Assert.Single(fixture.Broadcaster.Published.Where(update => update.Status == JourneySimulationStatus.Cancelled));
    }

    [Fact]
    public async Task A_failed_activity_write_is_never_retried_and_never_duplicated()
    {
        var writer = new ThrowingActivityLogWriter();
        var recorder = new JourneyActivityRecorder(writer, NullLogger<JourneyActivityRecorder>.Instance);

        var outcome = new JourneyActivityOutcome(
            JourneyActivityKind.Completed,
            Guid.NewGuid(),
            JourneyMode.Waypoints,
            JourneyTravelProfile.Driving);

        // Sınır YUTAR: çağıranın görebileceği bir istisna yoktur.
        await recorder.RecordAsync(outcome, ownerUserId: Owner);

        /* Ve TEK bir deneme yapılır: kuyruk, outbox, arka plan yeniden deneme
           ya da döngü YOKTUR — tekrar denemek mükerrer bir yaşam döngüsü
           satırı riski demekti. */
        Assert.Equal(1, writer.Attempts);
    }

    [Fact]
    public void The_journey_activity_path_introduces_no_retry_or_outbox_infrastructure()
    {
        var source = File.ReadAllText(RepositoryPath("src/StajProject.Infrastructure/Services/JourneyActivityRecorder.cs"))
            + File.ReadAllText(RepositoryPath("src/StajProject.Infrastructure/Simulation/JourneySimulationRunner.cs"));

        foreach (var forbidden in (string[])
                 ["Outbox", "Retry", "Polly", "Queue", "Channel<", "Task.Delay", "Thread.Sleep"])
        {
            Assert.DoesNotContain(forbidden, source, StringComparison.Ordinal);
        }
    }

    private static string RepositoryPath(string relative)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, "src")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return Path.Combine(directory!.FullName, relative);
    }

    private static ActiveJourneySimulation Simulation(int ownerUserId)
    {
        var now = DateTime.UtcNow;
        var points = new TransportSimulationPoint[] { new(30, 40), new(31, 41) };
        return new ActiveJourneySimulation(
            Guid.NewGuid(), ownerUserId, JourneyMode.Waypoints, JourneyTravelProfile.Driving,
            "driving", now,
            new JourneySimulationPath(points, 500, 50, []),
            new JourneySimulationDetails("LINESTRING (30 40, 31 41)", null, null, [], []),
            new JourneySimulationSnapshot(points[0], 0, 0, 0, null, now));
    }

    private sealed class Fixture : IAsyncDisposable
    {
        private Fixture(AppDbContext db, FakeJourneyRouter router, int? userId, bool failingActivity)
        {
            Db = db;
            Router = router;
            Store = new InMemoryJourneySimulationStateStore();
            Broadcaster = new RecordingJourneyBroadcaster();

            var currentUser = Substitute.For<ICurrentUserService>();
            currentUser.UserId.Returns(userId);
            currentUser.IsAuthenticated.Returns(userId is not null);

            var permissions = Substitute.For<IEffectivePermissionService>();
            permissions
                .HasPermissionAsync(Arg.Any<int>(), PermissionCodes.PoiView, Arg.Any<CancellationToken>())
                .Returns(true);

            /* Ürün kapısı uçtadır; serviste sorulan KAYNAK yetkisidir. Bu
               senaryolar hat tabanlı yolculuklar kurar, dolayısıyla ulaşım
               ağını okuma yetkisi verilir. */
            permissions
                .HasPermissionAsync(Arg.Any<int>(), PermissionCodes.TransportView, Arg.Any<CancellationToken>())
                .Returns(true);

            Planning = new JourneyPlanningService(db, currentUser, permissions, router);

            /* Arıza senaryosunda GERÇEK kaydedici, hep fırlatan bir yazıcının
               üzerine kurulur: ölçülen şey projenin kendi "en iyi çaba"
               sınırıdır, uydurma bir sahtenin davranışı değil. */
            Recorder = failingActivity
                ? new JourneyActivityRecorder(new ThrowingActivityLogWriter(), NullLogger<JourneyActivityRecorder>.Instance)
                : new RecordingJourneyActivityRecorder();

            Activity = Recorder as RecordingJourneyActivityRecorder ?? new RecordingJourneyActivityRecorder();

            /* GEÇMİŞ yazıcısı Faz 8'de servisin bağımlılığı oldu. Bu dosyanın
               senaryoları geçmişi ölçmez; kalıcılık ve mükerrerlik kanıtları
               kendi test dosyasında, GERÇEK yazıcı ve süreç içi veritabanıyla
               yapılır. */
            History = new RecordingJourneyHistoryWriter();
            Simulations = new JourneySimulationService(
                Planning, currentUser, Store, Broadcaster, Recorder, History);
        }

        private Fixture(Fixture origin, int? userId)
        {
            Db = origin.Db;
            Router = origin.Router;
            Store = origin.Store;
            Broadcaster = origin.Broadcaster;
            RouteId = origin.RouteId;
            StopIds = origin.StopIds;

            var currentUser = Substitute.For<ICurrentUserService>();
            currentUser.UserId.Returns(userId);
            currentUser.IsAuthenticated.Returns(userId is not null);

            var permissions = Substitute.For<IEffectivePermissionService>();
            permissions
                .HasPermissionAsync(Arg.Any<int>(), PermissionCodes.PoiView, Arg.Any<CancellationToken>())
                .Returns(true);

            /* Ürün kapısı uçtadır; serviste sorulan KAYNAK yetkisidir. Bu
               senaryolar hat tabanlı yolculuklar kurar, dolayısıyla ulaşım
               ağını okuma yetkisi verilir. */
            permissions
                .HasPermissionAsync(Arg.Any<int>(), PermissionCodes.TransportView, Arg.Any<CancellationToken>())
                .Returns(true);

            Planning = new JourneyPlanningService(Db, currentUser, permissions, Router);
            Activity = origin.Activity;
            Recorder = origin.Recorder;
            History = origin.History;
            Simulations = new JourneySimulationService(
                Planning, currentUser, Store, Broadcaster, Recorder, History);
        }

        public AppDbContext Db { get; }
        public FakeJourneyRouter Router { get; }
        public InMemoryJourneySimulationStateStore Store { get; }
        public RecordingJourneyBroadcaster Broadcaster { get; }

        /// <summary>Yazılan yolculuk aktivite olayları; defterin kendisi değil, aynası.</summary>
        public RecordingJourneyActivityRecorder Activity { get; }

        /// <summary>Servise/runner'a verilen kaydedici (arızalı senaryoda GERÇEK olanı).</summary>
        public IJourneyActivityRecorder Recorder { get; }

        /// <summary>Yazılan geçmiş çağrıları; bu dosyada yalnızca bağımlılık olarak durur.</summary>
        public RecordingJourneyHistoryWriter History { get; }
        public JourneyPlanningService Planning { get; }
        public JourneySimulationService Simulations { get; }
        public int RouteId { get; private set; }
        public int[] StopIds { get; private set; } = [];

        /// <summary>Aynı dünyayı BAŞKA bir kimlikle gören ikinci bir görünüm.</summary>
        public Fixture As(int? userId) => new(this, userId);

        public static async Task<Fixture> WithRouteAsync(
            IEnumerable<JourneyTravelProfile>? routable = null,
            FakeJourneyRouter? router = null,
            bool failingActivity = false)
        {
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase($"journey-simulation-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;

            var fixture = new Fixture(
                new AppDbContext(options),
                router ?? new FakeJourneyRouter(routable),
                Owner,
                failingActivity);

            var route = new TransportRoute
            {
                Name = "Hat", ColorHex = "#123456", IsActive = true, CreatedDate = DateTime.UtcNow,
            };
            fixture.Db.TransportRoutes.Add(route);
            await fixture.Db.SaveChangesAsync();

            var stops = new List<TransportStop>();
            var index = 1;
            foreach (var (longitude, latitude, name) in
                     new (double, double, string)[] { (30, 40, "A"), (31, 41, "B") })
            {
                var stop = new TransportStop
                {
                    RouteId = route.Id, UserId = Owner, Name = name,
                    Coordinate = new Point(longitude, latitude) { SRID = 4326 },
                    SequenceOrder = index++, IsActive = true, CreatedDate = DateTime.UtcNow,
                };
                fixture.Db.TransportStops.Add(stop);
                stops.Add(stop);
            }

            await fixture.Db.SaveChangesAsync();

            fixture.RouteId = route.Id;
            fixture.StopIds = [.. stops.Select(stop => stop.Id)];
            return fixture;
        }

        public async Task AddPathAsync(LineString geometry)
        {
            Db.TransportRoutePaths.Add(new TransportRoutePath
            {
                RouteId = RouteId,
                Geometry = geometry,
                DistanceMeters = 900,
                DurationSeconds = 120,
                Profile = "driving",
                GeneratedAt = DateTime.UtcNow,
                IsStale = false,
            });
            await Db.SaveChangesAsync();
        }

        /// <summary>Varsayılan niyet: aynı hattın iki durağı arasında serbest yolculuk.</summary>
        public JourneyPlanRequest Intent(string mode = JourneyContractNames.Waypoints) => mode switch
        {
            JourneyContractNames.RouteFull => new JourneyPlanRequest
            {
                Mode = mode, Profile = JourneyContractNames.Driving, RouteId = RouteId,
            },
            _ => new JourneyPlanRequest
            {
                Mode = JourneyContractNames.Waypoints,
                Profile = JourneyContractNames.Driving,
                Waypoints =
                [
                    new() { Source = JourneyContractNames.TransportStop, ReferenceId = StopIds[0] },
                    new() { Source = JourneyContractNames.TransportStop, ReferenceId = StopIds[1] },
                ],
            },
        };

        public JourneySimulationRunner Runner(double speedMultiplier) =>
            new(
                Store,
                Broadcaster,
                new JourneySimulationOptions { SpeedMultiplier = speedMultiplier },
                /* Runner singleton, kaydedici scoped: gerçek uygulamadaki gibi
                   bir kapsam fabrikasından çözülür. */
                new SingleRecorderScopeFactory(Recorder),
                NullLogger<JourneySimulationRunner>.Instance);

        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }

    /// <summary>Yazılan yolculuk aktivite olaylarını toplar.</summary>
    private sealed class RecordingJourneyActivityRecorder : IJourneyActivityRecorder
    {
        public List<(JourneyActivityOutcome Outcome, int OwnerUserId)> Written { get; } = [];

        public Task RecordAsync(
            JourneyActivityOutcome outcome,
            int ownerUserId,
            CancellationToken cancellationToken = default)
        {
            Written.Add((outcome, ownerUserId));
            return Task.CompletedTask;
        }
    }

    /// <summary>Denetim kalıcılığı tamamen arızalı: her yazma fırlatır.</summary>
    private sealed class ThrowingActivityLogWriter : IActivityLogWriter
    {
        public int Attempts { get; private set; }

        public Task WriteAsync(ActivityLogEntry entry, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("aktivite deposu kullanılamıyor");

        public Task WriteAsync(
            ActivityLogEntry entry,
            ActivityActor actor,
            CancellationToken cancellationToken = default)
        {
            Attempts++;
            throw new InvalidOperationException("aktivite deposu kullanılamıyor");
        }
    }

    /// <summary>Runner'ın kapsam fabrikası: tek bir kaydediciyi sunar.</summary>
    private sealed class SingleRecorderScopeFactory : IServiceScopeFactory, IServiceScope, IServiceProvider
    {
        private readonly IJourneyActivityRecorder _recorder;

        public SingleRecorderScopeFactory(IJourneyActivityRecorder recorder) => _recorder = recorder;

        public IServiceScope CreateScope() => this;

        public IServiceProvider ServiceProvider => this;

        public object? GetService(Type serviceType) =>
            serviceType == typeof(IJourneyActivityRecorder) ? _recorder : null;

        public void Dispose()
        {
        }
    }

    private sealed class RecordingJourneyBroadcaster : IJourneySimulationBroadcaster
    {
        public List<JourneySimulationLiveUpdate> Published { get; } = [];

        public Task PublishAsync(JourneySimulationLiveUpdate update, CancellationToken cancellationToken = default)
        {
            Published.Add(update);
            return Task.CompletedTask;
        }
    }
}

/// <summary>Anlık görüntü koordinatlarını okunur kılan küçük yardımcılar.</summary>
internal static class JourneySnapshotAssertions
{
    public static double Longitude(this JourneySimulationSnapshot snapshot) => snapshot.Position.Longitude;

    public static double Latitude(this JourneySimulationSnapshot snapshot) => snapshot.Position.Latitude;
}
