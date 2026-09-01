using System.Net;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO;
using NSubstitute;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Journeys;
using StajProject.Application.Options;
using StajProject.Application.Routing;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Routing;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Faz 5B: gerçek güzergah üretimi, profil farkındalıklı yönlendirme ve
/// manevra eşlemesi.
/// </summary>
/// <remarks>
/// <para>
/// Testler Docker'a ya da çalışan bir OSRM'e BAĞLI DEĞİLDİR: planlama tarafı
/// <see cref="FakeJourneyRouter"/> ile, adaptörün kendisi sahte bir
/// <see cref="HttpMessageHandler"/> ile sınanır.
/// </para>
/// </remarks>
public sealed class JourneyRoutingTests
{
    /* --- ROTA TAMAMI ------------------------------------------------------------- */

    [Fact]
    public async Task Route_full_routes_the_personal_journey_itself_so_it_keeps_navigation_steps()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);

        var persisted = Geometry((30, 40), (30.4, 40.9), (31, 41));
        await fixture.AddPathAsync(route, geometry: persisted, distance: 1234, duration: 321);

        var result = await fixture.Service.PreviewAsync(Request(JourneyContractNames.RouteFull, route.Id));

        Assert.True(result.IsSuccess);
        var plan = result.Value!;

        /* SÖZLEŞME DEĞİŞTİ (manuel kabul testi sonrası).

           Kalıcı `TransportRoutePath` PAYLAŞILAN hat ürününün otoritesidir ama
           manevra saklamaz. Kişisel yolculuk onu olduğu gibi kullandığında
           kullanıcı gerçek bir rota görüyor, yanında da "bu güzergâh için adım
           adım yönlendirme bulunmuyor" yazısını okuyordu.

           Kişisel yolculuk artık KENDİ planını üretir: geometri, ölçümler ve
           adımlar TEK bir yönlendirme sonucundan gelir. */
        Assert.Equal(1, fixture.Router.CallCount);
        Assert.NotEmpty(plan.Steps);
        Assert.Equal("liveRouting", plan.Summary.GeometrySource);
        Assert.Equal("driving", plan.Summary.EffectiveProfile);

        // Geometri ve adımlar AYNI plandan: kalıcı yol artık çizilen şey değildir.
        Assert.NotEqual(new WKTWriter().Write(persisted), plan.GeometryWkt);
        Assert.Contains(plan.Summary.Assumptions, note => note.Contains("AYNI plandan", StringComparison.Ordinal));

        /* Ve kalıcı yol DEĞİŞTİRİLMEZ: paylaşılan ürünün otoritesi yerinde
           kalır, kişisel yolculuk yalnızca onu tercih etmez. */
        var stored = await fixture.Db.TransportRoutePaths.AsNoTracking()
            .SingleAsync(item => item.RouteId == route.Id);
        Assert.Equal(new WKTWriter().Write(persisted), new WKTWriter().Write(stored.Geometry));
        Assert.Equal(1234, stored.DistanceMeters);
        Assert.Equal(321, stored.DurationSeconds);
    }

    [Fact]
    public async Task Route_full_still_falls_back_to_the_persisted_path_when_the_engine_is_unavailable()
    {
        /* Motor o profil için kullanılamıyorsa yolculuk YİNE ÇALIŞIR: kayıtlı
           yol devreye girer ve manevrasız bir güzergah gösterilir. Yedeğin
           kaybı, arıza anında ürünü tamamen kullanılamaz yapardı. */
        await using var fixture = Fixture.Create(FakeJourneyRouter.Failing(ServiceErrorKind.Upstream));
        var route = await fixture.AddRouteAsync();
        await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);

        var persisted = Geometry((30, 40), (30.4, 40.9), (31, 41));
        await fixture.AddPathAsync(route, geometry: persisted, distance: 1234, duration: 321);

        var result = await fixture.Service.PreviewAsync(Request(JourneyContractNames.RouteFull, route.Id));

        Assert.True(result.IsSuccess);
        var plan = result.Value!;

        Assert.Equal(new WKTWriter().Write(persisted), plan.GeometryWkt);
        Assert.Equal("persistedRoutePath", plan.Summary.GeometrySource);
        Assert.Equal(1234, plan.Summary.DistanceMeters);

        /* Manevra YOKTUR ve bu açıkça bildirilir: uydurulmuş bir adım listesi
           yerine dürüst bir boşluk. */
        Assert.Empty(plan.Steps);
        Assert.Contains(plan.Summary.Assumptions, note => note.Contains("kayıtlı", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Route_full_uses_live_routing_even_when_the_persisted_path_is_stale_or_missing()
    {
        /* Adı da sözleşmesi de DEĞİŞTİ: canlı yönlendirme artık bir "yedek"
           değil, kişisel yolculuğun BİRİNCİL planıdır. Kayıtlı yolun bayat mı
           yoksa hiç yok mu olduğu bu kararı etkilemez — ikisinde de sonuç
           aynı olmalıdır. */
        foreach (var stale in (bool[])[true, false])
        {
            await using var fixture = Fixture.Create();
            var route = await fixture.AddRouteAsync();
            await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
            await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);

            if (stale)
            {
                await fixture.AddPathAsync(route, stale: true);
            }

            var result = await fixture.Service.PreviewAsync(Request(JourneyContractNames.RouteFull, route.Id));

            Assert.True(result.IsSuccess);
            var plan = result.Value!;

            // Motora TAM OLARAK bir kez gidilir ve sonuç odur.
            Assert.Equal(1, fixture.Router.CallCount);
            Assert.Equal("liveRouting", plan.Summary.GeometrySource);

            /* Geometri, ölçümler ve adımlar AYNI yönlendirme sonucundan gelir:
               simülasyon tam olarak bu geometride ilerleyecektir. */
            Assert.Equal(FakeJourneyRouter.DefaultDistanceMeters, plan.Summary.DistanceMeters);
            Assert.Equal(FakeJourneyRouter.DefaultDurationSeconds, plan.Summary.DurationSeconds);
            Assert.NotEmpty(plan.Steps);
            Assert.Equal([0, 1, 2], plan.Steps.Select(step => step.Sequence));

            /* Kullanıcı otoriter kayıtlı yolu gördüğünü SANMAMALIDIR. Ölçülen
               şey KAVRAMDIR, cümlenin kendisi değil: sonucun baştan
               hesaplandığı söylenir ve kayıtlı yol kullanıldığı iddia
               EDİLMEZ. */
            Assert.Contains(
                plan.Summary.Assumptions,
                note => note.Contains("baştan hesaplandı", StringComparison.Ordinal));
            Assert.DoesNotContain(
                plan.Summary.Assumptions,
                note => note.Contains("kayıtlı ve güncel yolundan", StringComparison.Ordinal));

            // Bayat kayıt olduğu gibi durur; tazelenmez, silinmez, yazılmaz.
            if (stale)
            {
                var stored = await fixture.Db.TransportRoutePaths.IgnoreQueryFilters().AsNoTracking().SingleAsync();
                Assert.True(stored.IsStale);
            }
        }
    }

    [Fact]
    public async Task Route_full_does_not_reuse_a_path_generated_for_a_different_profile()
    {
        /* Kalıcı yol sürüş profiliyle üretilmiştir; onu yürüyüş talebine
           döndürmek, sürüş geometrisini yürüyüş diye etiketlemek olurdu. */
        await using var fixture = Fixture.Create(
            new FakeJourneyRouter([JourneyTravelProfile.Driving, JourneyTravelProfile.Walking]));
        var route = await fixture.AddRouteAsync();
        await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);
        await fixture.AddPathAsync(route, profile: "driving");

        var request = Request(JourneyContractNames.RouteFull, route.Id);
        request.Profile = JourneyContractNames.Walking;

        var result = await fixture.Service.PreviewAsync(request);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, fixture.Router.CallCount);
        Assert.Equal(JourneyTravelProfile.Walking, fixture.Router.Calls[0].Profile);
        Assert.Equal("liveRouting", result.Value!.Summary.GeometrySource);
        Assert.Equal("walking", result.Value.Summary.EffectiveProfile);
    }

    [Fact]
    public async Task Preview_never_writes_transport_state()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);
        await fixture.AddPathAsync(route, stale: true);

        var before = await fixture.Db.TransportRoutePaths.IgnoreQueryFilters().AsNoTracking().SingleAsync();

        Assert.True((await fixture.Service.PreviewAsync(Request(JourneyContractNames.RouteFull, route.Id))).IsSuccess);

        var after = await fixture.Db.TransportRoutePaths.IgnoreQueryFilters().AsNoTracking().SingleAsync();

        Assert.Equal(before.IsStale, after.IsStale);
        Assert.Equal(before.GeneratedAt, after.GeneratedAt);
        Assert.Equal(before.DistanceMeters, after.DistanceMeters);
        Assert.Equal(before.Geometry.NumPoints, after.Geometry.NumPoints);
        Assert.Equal(1, await fixture.Db.TransportRoutePaths.IgnoreQueryFilters().CountAsync());
    }

    /* --- ROTA BÖLÜMÜ ------------------------------------------------------------- */

    [Fact]
    public async Task A_forward_segment_is_routed_between_exactly_the_selected_stops()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        var b = await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);
        await fixture.AddStopAsync(route, "C", 32, 42, sequence: 3);
        var d = await fixture.AddStopAsync(route, "D", 33, 43, sequence: 4);
        await fixture.AddPathAsync(route);

        var request = Request(JourneyContractNames.RouteSegment, route.Id);
        request.FromStopId = b.Id;
        request.ToStopId = d.Id;

        var result = await fixture.Service.PreviewAsync(request);

        Assert.True(result.IsSuccess);

        /* Bölüm kalıcı geometriden KESİLMEZ: kayıt hangi köşesinin hangi
           durağa karşılık geldiğini saklamaz. Motora tam olarak seçilen
           duraklar gönderilir. */
        var sent = fixture.Router.LastCoordinates;
        Assert.Equal(3, sent.Count);
        Assert.Equal((31d, 41d), (sent[0].Longitude, sent[0].Latitude));
        Assert.Equal((33d, 43d), (sent[^1].Longitude, sent[^1].Latitude));

        // İLGİSİZ kısım (A) hiç girmez.
        Assert.DoesNotContain(sent, coordinate => coordinate.Longitude == 30);
        Assert.Equal(["B", "C", "D"], result.Value!.Waypoints.Select(waypoint => waypoint.Name));
        Assert.Equal("liveRouting", result.Value.Summary.GeometrySource);
    }

    [Fact]
    public async Task A_reverse_segment_is_routed_in_the_requested_direction()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var a = await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);
        var c = await fixture.AddStopAsync(route, "C", 32, 42, sequence: 3);
        await fixture.AddPathAsync(route);

        var request = Request(JourneyContractNames.RouteSegment, route.Id);
        request.FromStopId = c.Id;
        request.ToStopId = a.Id;

        var result = await fixture.Service.PreviewAsync(request);

        Assert.True(result.IsSuccess);

        // Motor İSTENEN yönde çağrılır; ters çevrilmiş bir sonuç sunulmaz.
        var sent = fixture.Router.LastCoordinates;
        Assert.Equal([32d, 31d, 30d], sent.Select(coordinate => coordinate.Longitude));
        Assert.Equal(["C", "B", "A"], result.Value!.Waypoints.Select(waypoint => waypoint.Name));
    }

    [Fact]
    public async Task A_segment_declares_that_it_was_recomputed_rather_than_spliced()
    {
        /* Yanlış bir bölümü sessizce döndürmemenin kanıtı: sonuç, kayıtlı
           geometriden kesilmediğini AÇIKÇA bildirir. */
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var a = await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        var b = await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);
        await fixture.AddPathAsync(route);

        var request = Request(JourneyContractNames.RouteSegment, route.Id);
        request.FromStopId = a.Id;
        request.ToStopId = b.Id;

        var result = await fixture.Service.PreviewAsync(request);

        Assert.True(result.IsSuccess);
        Assert.Contains(
            result.Value!.Summary.Assumptions,
            note => note.Contains("kanıtlanamaz", StringComparison.Ordinal));
    }

    /* --- SERBEST GEÇİŞ NOKTALARI ------------------------------------------------- */

    [Fact]
    public async Task Cross_route_stop_to_stop_is_routed_from_server_resolved_coordinates()
    {
        await using var fixture = Fixture.Create();
        var first = await fixture.AddRouteAsync("Hat 1");
        var second = await fixture.AddRouteAsync("Hat 2");
        var a = await fixture.AddStopAsync(first, "A", 30, 40, sequence: 1);
        var x = await fixture.AddStopAsync(second, "X", 35, 45, sequence: 1);

        var result = await fixture.Service.PreviewAsync(
            Waypoints((JourneyContractNames.TransportStop, a.Id), (JourneyContractNames.TransportStop, x.Id)));

        Assert.True(result.IsSuccess);

        /* Koordinatlar SUNUCUDA çözüldü: istek gövdesi yalnızca kimlik
           taşıyordu, geometri taşımıyordu. */
        Assert.Equal(
            [(30d, 40d), (35d, 45d)],
            fixture.Router.LastCoordinates.Select(c => (c.Longitude, c.Latitude)));
        Assert.Null(result.Value!.Summary.RouteId);
    }

    [Fact]
    public async Task Poi_to_poi_and_mixed_stop_poi_journeys_are_routed()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var stop = await fixture.AddStopAsync(route, "Durak", 31, 41, sequence: 1);
        var start = await fixture.AddPoiAsync("POI 1", 30, 40);
        var end = await fixture.AddPoiAsync("POI 2", 32, 42);

        var poiOnly = await fixture.Service.PreviewAsync(
            Waypoints((JourneyContractNames.Poi, start.Id), (JourneyContractNames.Poi, end.Id)));

        Assert.True(poiOnly.IsSuccess);
        Assert.Equal(
            [(30d, 40d), (32d, 42d)],
            fixture.Router.LastCoordinates.Select(c => (c.Longitude, c.Latitude)));

        var mixed = await fixture.Service.PreviewAsync(
            Waypoints(
                (JourneyContractNames.Poi, start.Id),
                (JourneyContractNames.TransportStop, stop.Id),
                (JourneyContractNames.Poi, end.Id)));

        Assert.True(mixed.IsSuccess);
        Assert.Equal(
            [(30d, 40d), (31d, 41d), (32d, 42d)],
            fixture.Router.LastCoordinates.Select(c => (c.Longitude, c.Latitude)));
    }

    [Fact]
    public async Task Multiple_via_points_reach_the_engine_in_the_normalized_order()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var a = await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        var b = await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);
        var c = await fixture.AddStopAsync(route, "C", 32, 42, sequence: 3);
        var d = await fixture.AddStopAsync(route, "D", 33, 43, sequence: 4);

        // İstek sırası KARIŞIK; açık Order alanı sırayı belirler.
        var request = new JourneyPlanRequest
        {
            Mode = JourneyContractNames.Waypoints,
            Profile = JourneyContractNames.Driving,
            Waypoints =
            [
                new() { Source = JourneyContractNames.TransportStop, ReferenceId = c.Id, Order = 30 },
                new() { Source = JourneyContractNames.TransportStop, ReferenceId = a.Id, Order = 10 },
                new() { Source = JourneyContractNames.TransportStop, ReferenceId = d.Id, Order = 40 },
                new() { Source = JourneyContractNames.TransportStop, ReferenceId = b.Id, Order = 20 }
            ]
        };

        var result = await fixture.Service.PreviewAsync(request);

        Assert.True(result.IsSuccess);

        // Motor normalleştirilmiş sırayı görür; ara noktalar korunur.
        Assert.Equal([30d, 31d, 32d, 33d], fixture.Router.LastCoordinates.Select(c => c.Longitude));
        Assert.Equal(["A", "B", "C", "D"], result.Value!.Waypoints.Select(waypoint => waypoint.Name));
        Assert.Equal(["origin", "via", "via", "destination"], result.Value.Waypoints.Select(w => w.Role));
    }

    /* --- YÖNLENDİRME SONUCU / ADIMLAR -------------------------------------------- */

    [Fact]
    public async Task Routed_metrics_and_geometry_replace_the_straight_line_preview()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var a = await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        var b = await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);

        var result = await fixture.Service.PreviewAsync(
            Waypoints((JourneyContractNames.TransportStop, a.Id), (JourneyContractNames.TransportStop, b.Id)));

        Assert.True(result.IsSuccess);
        var plan = result.Value!;

        // Motorun ölçümleri; kuş uçuşu bir hesap DEĞİL.
        Assert.Equal(460, plan.Summary.DistanceMeters);
        Assert.Equal(100, plan.Summary.DurationSeconds);

        /* Geometri düz çizgi değildir: sahte motor ara bir köşe ekler, yani
           sonuç iki uç noktadan fazlasını taşır. */
        Assert.StartsWith("LINESTRING", plan.GeometryWkt, StringComparison.Ordinal);
        Assert.Contains("30.5", plan.GeometryWkt, StringComparison.Ordinal);

        // Faz 5A alanları sözleşmede KALMADI.
        Assert.Null(typeof(JourneyPlanSummaryResponse).GetProperty("StraightLineDistanceMeters"));
        Assert.Null(typeof(JourneyPlanSummaryResponse).GetProperty("IsRouted"));
        Assert.Null(typeof(JourneyNavigationStepResponse).GetProperty("StraightLineDistanceMeters"));
    }

    [Fact]
    public async Task Navigation_steps_are_mapped_onto_the_stable_application_dto()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var a = await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        var b = await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);

        var result = await fixture.Service.PreviewAsync(
            Waypoints((JourneyContractNames.TransportStop, a.Id), (JourneyContractNames.TransportStop, b.Id)));

        Assert.True(result.IsSuccess);
        var steps = result.Value!.Steps;

        Assert.Equal(3, steps.Count);
        Assert.Equal(3, result.Value.Summary.StepCount);
        Assert.Equal([0, 1, 2], steps.Select(step => step.Sequence));
        Assert.Equal(["depart", "turn", "arrive"], steps.Select(step => step.ManeuverType));

        Assert.Equal("left", steps[1].ManeuverModifier);
        Assert.Equal("Orta Sokak", steps[1].Name);
        Assert.Equal(340, steps[1].DistanceMeters);
        Assert.Equal(70, steps[1].DurationSeconds);
        Assert.Equal(31, steps[1].ManeuverLongitude);
        Assert.Equal(41, steps[1].ManeuverLatitude);

        // Motor hazır metin vermiyorsa UYDURULMAZ.
        Assert.All(steps, step => Assert.Null(step.DisplayText));
        Assert.Null(steps[0].ManeuverModifier);
        Assert.Null(steps[2].Name);
    }

    [Fact]
    public async Task An_engine_failure_is_surfaced_safely_without_internals()
    {
        foreach (var (kind, expected) in ((ServiceErrorKind, ServiceErrorKind)[])
                 [
                     (ServiceErrorKind.Upstream, ServiceErrorKind.Upstream),
                     (ServiceErrorKind.Timeout, ServiceErrorKind.Timeout)
                 ])
        {
            await using var fixture = Fixture.Create(FakeJourneyRouter.Failing(kind));
            var route = await fixture.AddRouteAsync();
            var a = await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
            var b = await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);

            var result = await fixture.Service.PreviewAsync(
                Waypoints((JourneyContractNames.TransportStop, a.Id), (JourneyContractNames.TransportStop, b.Id)));

            Assert.False(result.IsSuccess);

            // Hata TÜRÜ korunur; her şey 400'e düzleştirilmez.
            Assert.Equal(expected, result.ErrorKind);
            Assert.Null(result.Value);

            foreach (var leak in (string[])["http", "osrm", "localhost", "5000", "docker", "Exception"])
            {
                Assert.DoesNotContain(leak, result.Error!, StringComparison.OrdinalIgnoreCase);
            }
        }
    }

    /* --- PROFİLLER --------------------------------------------------------------- */

    [Fact]
    public async Task Driving_is_routed_with_the_existing_configuration()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var a = await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        var b = await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);

        var result = await fixture.Service.PreviewAsync(
            Waypoints((JourneyContractNames.TransportStop, a.Id), (JourneyContractNames.TransportStop, b.Id)));

        Assert.True(result.IsSuccess);
        Assert.Equal("driving", result.Value!.Summary.RequestedProfile);
        Assert.Equal("driving", result.Value.Summary.EffectiveProfile);
        Assert.Equal("routed", result.Value.Summary.ProfileSupport);
    }

    [Fact]
    public async Task Walking_and_cycling_are_refused_when_no_engine_is_configured()
    {
        foreach (var profile in (string[])[JourneyContractNames.Walking, JourneyContractNames.Cycling])
        {
            // Yalnızca sürüş yapılandırılmış.
            await using var fixture = Fixture.Create();
            var route = await fixture.AddRouteAsync();
            var a = await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
            var b = await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);

            var request = Waypoints(
                (JourneyContractNames.TransportStop, a.Id),
                (JourneyContractNames.TransportStop, b.Id));
            request.Profile = profile;

            var result = await fixture.Service.PreviewAsync(request);

            Assert.False(result.IsSuccess);
            Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);

            /* ASIL İDDİA: sürüşe SESSİZCE düşülmedi. Motora hiç gidilmedi ve
               kullanıcıya sürüş geometrisi yürüyüş/bisiklet diye sunulmadı. */
            Assert.Equal(0, fixture.Router.CallCount);
            Assert.Null(result.Value);
        }
    }

    [Fact]
    public async Task Walking_and_cycling_are_routed_when_their_own_engine_is_configured()
    {
        foreach (var (name, profile) in ((string, JourneyTravelProfile)[])
                 [
                     (JourneyContractNames.Walking, JourneyTravelProfile.Walking),
                     (JourneyContractNames.Cycling, JourneyTravelProfile.Cycling)
                 ])
        {
            await using var fixture = Fixture.Create(
                new FakeJourneyRouter([JourneyTravelProfile.Driving, profile]));
            var route = await fixture.AddRouteAsync();
            var a = await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
            var b = await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);

            var request = Waypoints(
                (JourneyContractNames.TransportStop, a.Id),
                (JourneyContractNames.TransportStop, b.Id));
            request.Profile = name;

            var result = await fixture.Service.PreviewAsync(request);

            Assert.True(result.IsSuccess);
            Assert.Equal(name, result.Value!.Summary.RequestedProfile);

            // Etkin profil TALEP EDİLENDİR; sürüşe düşülmemiştir.
            Assert.Equal(name, result.Value.Summary.EffectiveProfile);
            Assert.Equal("routed", result.Value.Summary.ProfileSupport);
            Assert.Equal(profile, fixture.Router.Calls[0].Profile);
        }
    }

    [Fact]
    public void No_duration_multiplier_fallback_exists_anywhere_in_the_journey_layer()
    {
        /* "Yürüyüş = sürüş × katsayı" bir yaklaşım DEĞİL, uydurmadır: rota
           GEOMETRİSİ de moda göre değişir. Böyle bir katsayı için ne alan ne
           de sabit vardır. */
        var suspicious = typeof(JourneyPlanningService).Assembly
            .GetTypes()
            .Where(type => type.Namespace?.Contains("Journey", StringComparison.Ordinal) == true
                || type.Name.Contains("Journey", StringComparison.Ordinal))
            .SelectMany(type => type.GetFields(
                System.Reflection.BindingFlags.Public
                | System.Reflection.BindingFlags.NonPublic
                | System.Reflection.BindingFlags.Static
                | System.Reflection.BindingFlags.Instance))
            /* "Factor" ARANMAZ: GeometryFactory ve _httpClientFactory gibi
               masum adlar yanlış eşleşir. Aranan şey hız/katsayı uydurması. */
            .Where(field => field.Name.Contains("Multiplier", StringComparison.OrdinalIgnoreCase)
                || field.Name.Contains("Coefficient", StringComparison.OrdinalIgnoreCase)
                || field.Name.Contains("SpeedKph", StringComparison.OrdinalIgnoreCase)
                || field.Name.Contains("WalkingSpeed", StringComparison.OrdinalIgnoreCase)
                || field.Name.Contains("CyclingSpeed", StringComparison.OrdinalIgnoreCase))
            .ToArray();

        Assert.Empty(suspicious);
    }

    /* --- ADAPTÖR (OSRM sınırı) --------------------------------------------------- */

    [Fact]
    public void The_adapter_reports_routability_only_for_configured_profiles()
    {
        var drivingOnly = Adapter(new JourneyRoutingOptions());

        Assert.True(drivingOnly.IsProfileRoutable(JourneyTravelProfile.Driving));
        Assert.False(drivingOnly.IsProfileRoutable(JourneyTravelProfile.Walking));
        Assert.False(drivingOnly.IsProfileRoutable(JourneyTravelProfile.Cycling));

        var withWalking = Adapter(new JourneyRoutingOptions
        {
            Walking = new JourneyRouterOptions
            {
                BaseUrl = "http://localhost:5001",
                Profile = "walking",
                TimeoutSeconds = 30
            }
        });

        Assert.True(withWalking.IsProfileRoutable(JourneyTravelProfile.Walking));
        Assert.False(withWalking.IsProfileRoutable(JourneyTravelProfile.Cycling));
    }

    [Fact]
    public async Task An_unconfigured_profile_never_reaches_the_network()
    {
        var handler = new CountingHandler(_ => new HttpResponseMessage(HttpStatusCode.OK));
        var adapter = Adapter(new JourneyRoutingOptions(), handler);

        var result = await adapter.RouteAsync(new JourneyRouteRequest(
            JourneyTravelProfile.Walking,
            [new(30, 40), new(31, 41)]));

        Assert.False(result.IsSuccess);

        // Sürüş sunucusuna gidip sonucu "yürüyüş" diye etiketlemek MÜMKÜN DEĞİL.
        Assert.Equal(0, handler.CallCount);
    }

    [Fact]
    public void The_adapter_requests_steps_and_uses_the_configured_endpoint_profile()
    {
        var uri = OsrmJourneyRoutingService.BuildRequestUri(
            new JourneyRouterOptions { BaseUrl = "http://localhost:5001/", Profile = "walking" },
            [new(36.33, 41.28), new(36.34, 41.27)]);

        Assert.Equal("localhost", uri.Host);
        Assert.Equal(5001, uri.Port);
        Assert.Contains("/route/v1/walking/", uri.AbsoluteUri, StringComparison.Ordinal);

        // Faz 5B'nin tek gerçek farkı: manevra adımları istenir.
        Assert.Contains("steps=true", uri.Query, StringComparison.Ordinal);
        Assert.Contains("geometries=geojson", uri.Query, StringComparison.Ordinal);

        // Koordinatlar daima boylam,enlem ve kültürden bağımsızdır.
        Assert.Contains("36.33,41.28;36.34,41.27", uri.AbsoluteUri, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_adapter_maps_osrm_legs_and_steps_into_the_stable_model()
    {
        const string json = """
            {"code":"Ok","routes":[{
              "distance":1200.5,"duration":300.25,
              "geometry":{"type":"LineString","coordinates":[[36.33,41.28],[36.335,41.275],[36.34,41.27]]},
              "legs":[
                {"steps":[
                  {"name":"Atatürk Bulvarı","distance":800.0,"duration":200.0,
                   "maneuver":{"type":"depart","location":[36.33,41.28]}},
                  {"name":"","distance":400.5,"duration":100.25,
                   "maneuver":{"type":"turn","modifier":"right","location":[36.335,41.275]}}
                ]},
                {"steps":[
                  {"distance":0,"duration":0,
                   "maneuver":{"type":"arrive","location":[36.34,41.27]}}
                ]}
              ]
            }]}
            """;

        var result = await Adapter(
                new JourneyRoutingOptions(),
                new CountingHandler(_ => Json(HttpStatusCode.OK, json)))
            .RouteAsync(new JourneyRouteRequest(JourneyTravelProfile.Driving, [new(36.33, 41.28), new(36.34, 41.27)]));

        Assert.True(result.IsSuccess);
        var routed = result.Value!;

        Assert.Equal(1200.5, routed.DistanceMeters);
        Assert.Equal(300.25, routed.DurationSeconds);
        Assert.Equal(3, routed.Geometry.NumPoints);
        Assert.Equal(4326, routed.Geometry.SRID);
        Assert.Equal("driving", routed.EngineProfile);

        // Bacaklar tek ve ARTAN bir manevra dizisine düzleştirilir.
        Assert.Equal([0, 1, 2], routed.Steps.Select(step => step.Sequence));
        Assert.Equal(["depart", "turn", "arrive"], routed.Steps.Select(step => step.ManeuverType));
        Assert.Equal("Atatürk Bulvarı", routed.Steps[0].Name);
        Assert.Null(routed.Steps[0].ManeuverModifier);
        Assert.Equal("right", routed.Steps[1].ManeuverModifier);

        // Boş ad null'a normalleştirilir; boş metin taşınmaz.
        Assert.Null(routed.Steps[1].Name);
        Assert.Equal(36.335, routed.Steps[1].ManeuverLocation.Longitude);
        Assert.Equal(41.275, routed.Steps[1].ManeuverLocation.Latitude);

        // OSRM hazır talimat metni üretmez; uydurulmaz.
        Assert.All(routed.Steps, step => Assert.Null(step.DisplayText));
    }

    [Fact]
    public async Task A_route_without_step_data_still_yields_geometry_and_metrics()
    {
        const string json = """
            {"code":"Ok","routes":[{"distance":10,"duration":20,
             "geometry":{"type":"LineString","coordinates":[[36.33,41.28],[36.34,41.27]]}}]}
            """;

        var result = await Adapter(
                new JourneyRoutingOptions(),
                new CountingHandler(_ => Json(HttpStatusCode.OK, json)))
            .RouteAsync(new JourneyRouteRequest(JourneyTravelProfile.Driving, [new(36.33, 41.28), new(36.34, 41.27)]));

        /* Eksik adım verisi isteği ÖLDÜRMEZ: geometri ve ölçümler geçerlidir
           ve boş bir adım listesi uydurulmuş bir manevradan iyidir. */
        Assert.True(result.IsSuccess);
        Assert.Empty(result.Value!.Steps);
        Assert.Equal(10, result.Value.DistanceMeters);
    }

    [Fact]
    public async Task The_adapter_never_leaks_engine_internals()
    {
        foreach (var (handler, expected) in ((CountingHandler, ServiceErrorKind)[])
                 [
                     (new CountingHandler(_ => Json(HttpStatusCode.BadGateway, "private proxy trace")),
                      ServiceErrorKind.Upstream),
                     (new CountingHandler(_ => Json(HttpStatusCode.OK, "{not-json")),
                      ServiceErrorKind.Upstream),
                     (new CountingHandler(_ => throw new HttpRequestException("docker host 172.17.0.2:5000")),
                      ServiceErrorKind.Upstream),
                     (new CountingHandler(_ => throw new TaskCanceledException("internal timeout detail")),
                      ServiceErrorKind.Timeout),
                     (new CountingHandler(_ => Json(HttpStatusCode.OK, """{"code":"NoRoute"}""")),
                      ServiceErrorKind.Upstream)
                 ])
        {
            var result = await Adapter(new JourneyRoutingOptions(), handler)
                .RouteAsync(new JourneyRouteRequest(
                    JourneyTravelProfile.Driving,
                    [new(36.33, 41.28), new(36.34, 41.27)]));

            Assert.False(result.IsSuccess);
            Assert.Equal(expected, result.ErrorKind);

            // Mesaj mevcut güvenli sözleşmedendir.
            Assert.Contains(result.Error, (string[])
            [
                RouteGenerationMessages.NoRoute,
                RouteGenerationMessages.Timeout,
                RouteGenerationMessages.Unavailable,
                RouteGenerationMessages.Unknown
            ]);

            foreach (var leak in (string[])["docker", "172.17", "not-json", "proxy trace", "internal timeout"])
            {
                Assert.DoesNotContain(leak, result.Error!, StringComparison.OrdinalIgnoreCase);
            }
        }
    }

    [Fact]
    public async Task Fewer_than_two_coordinates_are_refused_before_any_request()
    {
        var handler = new CountingHandler(_ => new HttpResponseMessage(HttpStatusCode.OK));

        var result = await Adapter(new JourneyRoutingOptions(), handler)
            .RouteAsync(new JourneyRouteRequest(JourneyTravelProfile.Driving, [new(36.33, 41.28)]));

        Assert.False(result.IsSuccess);
        Assert.Equal(0, handler.CallCount);
    }

    /* --- YAPILANDIRMA ------------------------------------------------------------ */

    [Fact]
    public void Optional_profiles_are_not_required_for_startup()
    {
        // Bölüm hiç yoksa doğrulama sessizce geçer; uygulama sorunsuz başlar.
        new JourneyRoutingOptions().Validate("http://localhost:5000");
    }

    [Fact]
    public void A_walking_endpoint_pointing_at_the_driving_server_is_refused()
    {
        /* Yerel OSRM car.lua ile derlenir ve osrm-routed adresteki profil
           segmentini YOK SAYAR: aynı sunucuya "walking" demek sürüş sonucu
           üretirdi. Sessiz düşüş yapılandırmayla bile kurulamaz. */
        var options = new JourneyRoutingOptions
        {
            Walking = new JourneyRouterOptions
            {
                BaseUrl = "http://localhost:5000",
                Profile = "walking",
                TimeoutSeconds = 30
            }
        };

        var exception = Assert.Throws<InvalidOperationException>(
            () => options.Validate("http://localhost:5000/"));
        Assert.Contains("AYRI", exception.Message, StringComparison.Ordinal);

        // Yürüyüş ve bisiklet de aynı adresi paylaşamaz.
        var shared = new JourneyRoutingOptions
        {
            Walking = new JourneyRouterOptions { BaseUrl = "http://localhost:5001", Profile = "walking" },
            Cycling = new JourneyRouterOptions { BaseUrl = "http://localhost:5001", Profile = "cycling" }
        };
        Assert.Throws<InvalidOperationException>(() => shared.Validate("http://localhost:5000"));
    }

    [Fact]
    public void Configured_endpoints_are_validated_like_the_existing_osrm_options()
    {
        foreach (var invalid in (JourneyRouterOptions[])
                 [
                     new() { BaseUrl = "file:///osrm", Profile = "walking" },
                     new() { BaseUrl = "http://localhost:5001?a=b", Profile = "walking" },
                     new() { BaseUrl = "http://localhost:5001", Profile = "" },
                     new() { BaseUrl = "http://localhost:5001", Profile = "walk1ng" },
                     new() { BaseUrl = "http://localhost:5001", Profile = "walking", TimeoutSeconds = 0 },
                     new() { BaseUrl = "http://localhost:5001", Profile = "walking", TimeoutSeconds = 1000 }
                 ])
        {
            var options = new JourneyRoutingOptions { Walking = invalid };
            Assert.Throws<InvalidOperationException>(() => options.Validate("http://localhost:5000"));
        }
    }

    /* --- REGRESYON --------------------------------------------------------------- */

    [Fact]
    public void The_existing_osrm_port_and_its_consumers_are_unchanged()
    {
        /* Akıllı Ulaşım'ın kalıcı güzergah üretimi ESKİ portu kullanmaya devam
           eder ve yolculuğa özgü adım modelini hiç görmez. */
        var legacy = Assert.Single(typeof(IOsrmRoutingService).GetMethods());
        Assert.Equal(nameof(IOsrmRoutingService.RouteAsync), legacy.Name);
        Assert.Equal(typeof(Task<ServiceResult<OsrmRouteResult>>), legacy.ReturnType);
        Assert.Equal(typeof(OsrmRouteRequest), legacy.GetParameters()[0].ParameterType);

        // Eski sonuç tipi adım TAŞIMAZ; genişletilmemiştir.
        Assert.Null(typeof(OsrmRouteResult).GetProperty("Steps"));

        // Yolculuk portu ayrıdır ve eskisinden türemez.
        Assert.False(typeof(IOsrmRoutingService).IsAssignableFrom(typeof(IJourneyRoutingService)));

        // Güzergah üretimi hâlâ yalnızca eski portu ister.
        Assert.Contains(
            typeof(TransportService).GetConstructors().Single().GetParameters(),
            parameter => parameter.ParameterType == typeof(IOsrmRoutingService));
        Assert.DoesNotContain(
            typeof(TransportService).GetConstructors().Single().GetParameters(),
            parameter => parameter.ParameterType == typeof(IJourneyRoutingService));
    }

    [Fact]
    public void The_simulation_service_still_depends_only_on_persisted_state()
    {
        /* Simülasyon Faz 5B'den etkilenmez: yönlendirme portunu hiç görmez ve
           yalnızca kalıcı güzergahı işletmeye devam eder. */
        var dependencies = typeof(TransportSimulationService)
            .GetConstructors()
            .Single()
            .GetParameters()
            .Select(parameter => parameter.ParameterType)
            .ToArray();

        Assert.DoesNotContain(typeof(IJourneyRoutingService), dependencies);
        Assert.DoesNotContain(typeof(IOsrmRoutingService), dependencies);
    }

    [Fact]
    public void Permissions_are_unchanged_by_this_phase()
    {
        // Faz 5B yeni bir yetki kodu getirmez; uç hâlâ transport.view ister.
        Assert.DoesNotContain(
            PermissionCatalog.AllCodes,
            code => code.Contains("journey", StringComparison.OrdinalIgnoreCase)
                || code.Contains("routing", StringComparison.OrdinalIgnoreCase));

        Assert.Contains(PermissionCodes.TransportView, PermissionCatalog.AllCodes);
        Assert.Contains(PermissionCodes.PoiView, PermissionCatalog.AllCodes);
    }

    [Fact]
    public void The_plan_id_is_correlation_only_and_carries_no_authority()
    {
        /* Faz 5D bir simülasyonu, istemciden gelen bir PlanId ya da geometriye
           GÜVENEREK başlatamamalıdır: kimlik imzasızdır, saklanmaz ve isteğin
           parçası olarak geri kabul edilecek bir alanı yoktur. */
        Assert.Null(typeof(JourneyPlanRequest).GetProperty("PlanId"));
        Assert.Null(typeof(JourneyPlanRequest).GetProperty("GeometryWkt"));
        Assert.Null(typeof(JourneyPlanRequest).GetProperty("Geometry"));

        // İstek gövdesi yalnızca KİMLİK taşır; koordinat taşımaz.
        Assert.Null(typeof(JourneyWaypointRequest).GetProperty("Longitude"));
        Assert.Null(typeof(JourneyWaypointRequest).GetProperty("Latitude"));
    }

    /* --- Yardımcılar ------------------------------------------------------------- */

    private static JourneyPlanRequest Request(string mode, int routeId) =>
        new() { Mode = mode, Profile = JourneyContractNames.Driving, RouteId = routeId };

    private static JourneyPlanRequest Waypoints(params (string Source, int ReferenceId)[] waypoints) =>
        new()
        {
            Mode = JourneyContractNames.Waypoints,
            Profile = JourneyContractNames.Driving,
            Waypoints =
            [
                .. waypoints.Select(waypoint => new JourneyWaypointRequest
                {
                    Source = waypoint.Source,
                    ReferenceId = waypoint.ReferenceId
                })
            ]
        };

    private static LineString Geometry(params (double X, double Y)[] coordinates) =>
        new([.. coordinates.Select(coordinate => new Coordinate(coordinate.X, coordinate.Y))]) { SRID = 4326 };

    private static OsrmJourneyRoutingService Adapter(
        JourneyRoutingOptions options,
        CountingHandler? handler = null)
    {
        var factory = Substitute.For<IHttpClientFactory>();
        factory
            .CreateClient(Arg.Any<string>())
            .Returns(_ => new HttpClient(handler ?? new CountingHandler(
                _ => new HttpResponseMessage(HttpStatusCode.OK))));

        return new OsrmJourneyRoutingService(
            factory,
            new OsrmOptions { BaseUrl = "http://localhost:5000", Profile = "driving", TimeoutSeconds = 30 },
            options,
            NullLogger<OsrmJourneyRoutingService>.Instance);
    }

    private static HttpResponseMessage Json(HttpStatusCode statusCode, string content) => new(statusCode)
    {
        Content = new StringContent(content, Encoding.UTF8, "application/json")
    };

    private sealed class CountingHandler(Func<HttpRequestMessage, HttpResponseMessage> responder) : HttpMessageHandler
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

    private sealed class Fixture : IAsyncDisposable
    {
        private const int UserId = 42;

        private Fixture(AppDbContext db, FakeJourneyRouter router)
        {
            Db = db;
            Router = router;

            var currentUser = Substitute.For<ICurrentUserService>();
            currentUser.UserId.Returns(UserId);
            currentUser.IsAuthenticated.Returns(true);

            var permissions = Substitute.For<IEffectivePermissionService>();
            permissions
                .HasPermissionAsync(Arg.Any<int>(), PermissionCodes.PoiView, Arg.Any<CancellationToken>())
                .Returns(true);

            Service = new JourneyPlanningService(db, currentUser, permissions, router);
        }

        public AppDbContext Db { get; }

        public FakeJourneyRouter Router { get; }

        public JourneyPlanningService Service { get; }

        public static Fixture Create(FakeJourneyRouter? router = null)
        {
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase($"journey-routing-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;
            return new Fixture(new AppDbContext(options), router ?? new FakeJourneyRouter());
        }

        public async Task<TransportRoute> AddRouteAsync(string name = "Hat")
        {
            var route = new TransportRoute
            {
                Name = name,
                ColorHex = "#123456",
                IsActive = true,
                CreatedDate = DateTime.UtcNow
            };
            Db.TransportRoutes.Add(route);
            await Db.SaveChangesAsync();
            return route;
        }

        public async Task<TransportStop> AddStopAsync(
            TransportRoute route,
            string name,
            double longitude,
            double latitude,
            int sequence)
        {
            var stop = new TransportStop
            {
                RouteId = route.Id,
                UserId = UserId,
                Name = name,
                Coordinate = new Point(longitude, latitude) { SRID = 4326 },
                SequenceOrder = sequence,
                IsActive = true,
                CreatedDate = DateTime.UtcNow
            };
            Db.TransportStops.Add(stop);
            await Db.SaveChangesAsync();
            return stop;
        }

        public async Task<Poi> AddPoiAsync(string name, double longitude, double latitude)
        {
            var poi = new Poi
            {
                Name = name,
                CategoryId = 1,
                Coordinate = new Point(longitude, latitude) { SRID = 4326 },
                UserId = UserId,
                IsActive = true,
                CreatedDate = DateTime.UtcNow
            };
            Db.Pois.Add(poi);
            await Db.SaveChangesAsync();
            return poi;
        }

        public async Task<TransportRoutePath> AddPathAsync(
            TransportRoute route,
            bool stale = false,
            string profile = "driving",
            LineString? geometry = null,
            double distance = 500,
            double duration = 50)
        {
            var path = new TransportRoutePath
            {
                RouteId = route.Id,
                Geometry = geometry ?? Geometry((30, 40), (31, 41)),
                DistanceMeters = distance,
                DurationSeconds = duration,
                Profile = profile,
                GeneratedAt = DateTime.UtcNow,
                IsStale = stale
            };
            Db.TransportRoutePaths.Add(path);
            await Db.SaveChangesAsync();
            return path;
        }

        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }
}
