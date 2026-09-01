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
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Journeys;
using StajProject.Application.Options;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Genel yolculuk planlaması temeli (Faz 5A): sözleşme, yetki, doğrulama,
/// normalleştirme ve profil politikası.
/// </summary>
/// <remarks>
/// <para>
/// Bu faz GÜZERGAH ÜRETMEZ. Kanıtlanan şey, bir planlama isteğinin yalnızca
/// gerçekten çözülebilir kayıtlarla ve yalnızca yapısal olarak tutarlı
/// kombinasyonlarla kabul edildiği; sıranın sunucuda normalleştirildiği ve
/// karşılanamayan bir seyahat profilinin gizlenmek yerine AÇIKÇA bildirildiğidir.
/// </para>
/// </remarks>
public sealed class JourneyPlanningFoundationTests
{
    /* --- Sözleşme / yetki temeli ------------------------------------------------- */

    [Fact]
    public void The_preview_endpoint_is_gated_by_the_personal_journey_product_permission()
    {
        /* Asıl iddia: ÜRÜN kapısı artık kişisel yolculuğun KENDİ kodudur.
           Eskiden `transport.view` idi ve bu, iki ayrı yeteneği tek koda
           bağlıyordu — hattı izleyebilen herkes kişisel yolculuk da
           kullanabiliyordu. */
        var method = typeof(JourneyPlanningController).GetMethod(nameof(JourneyPlanningController.Preview))!;
        var http = Assert.Single(method.GetCustomAttributes(typeof(HttpPostAttribute), true).Cast<HttpMethodAttribute>());
        var required = Assert.Single(method.GetCustomAttributes<RequirePermissionAttribute>(true));

        Assert.Equal("preview", http.Template);
        Assert.Equal(PermissionCodes.JourneyUse, required.PermissionCode);
        Assert.NotEqual(PermissionCodes.TransportView, required.PermissionCode);

        var route = Assert.Single(
            typeof(JourneyPlanningController)
                .GetCustomAttributes(typeof(RouteAttribute), true)
                .Cast<RouteAttribute>());
        Assert.Equal("api/transport/journeys", route.Template);

        // Planlamak, hattı canlı işletmek DEĞİLDİR: simülasyon kodu istenmez.
        Assert.NotEqual(PermissionCodes.TransportSimulationStart, required.PermissionCode);
        Assert.NotEqual(PermissionCodes.TransportSimulationStop, required.PermissionCode);
    }

    [Fact]
    public void The_personal_journey_product_carries_exactly_one_catalog_code()
    {
        /* Ürün kapısı TEK bir koddur; "journey" adı taşıyan ikinci bir yetkilik
           kimlik üretilmedi. Kodun kataloğa girmesi mevcut kurulumlarda ayrıca
           bir genişleme gerektirir; onu RolePermissionExpansions ölçer. */
        Assert.Equal(
            [PermissionCodes.JourneyUse],
            PermissionCatalog.AllCodes
                .Where(code => code.Contains("journey", StringComparison.OrdinalIgnoreCase))
                .ToArray());

        Assert.Equal("journey.use", PermissionCodes.JourneyUse);
    }

    [Fact]
    public void The_controller_is_authenticated_and_carries_no_role_name_shortcut()
    {
        /* Yetkilendirme YALNIZCA etkin yetki koduna bakar. Controller'da rol
           adı, isAdmin ya da kullanıcı adı üzerinden bir kestirme YOKTUR. */
        Assert.Single(typeof(JourneyPlanningController).GetCustomAttributes(typeof(AuthorizeAttribute), true));

        var authorize = typeof(JourneyPlanningController)
            .GetCustomAttributes(typeof(AuthorizeAttribute), true)
            .Cast<AuthorizeAttribute>()
            .Single();

        Assert.Null(authorize.Roles);
        Assert.Null(authorize.Policy);

        /* Servis yetkilendirme için YALNIZCA etkin yetki portunu alır; rol
           adı, rol kataloğu ya da kullanıcı adı bağımlılığı YOKTUR. */
        var dependencies = typeof(JourneyPlanningService)
            .GetConstructors()
            .Single()
            .GetParameters()
            .Select(parameter => parameter.ParameterType)
            .ToArray();

        Assert.Contains(typeof(IEffectivePermissionService), dependencies);
        Assert.DoesNotContain(dependencies, type => type.Name.Contains("Role", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Missing_journey_use_permission_fails_closed_for_the_preview_endpoint()
    {
        var permissions = Substitute.For<IEffectivePermissionService>();
        permissions
            .HasPermissionAsync(42, PermissionCodes.JourneyUse, Arg.Any<CancellationToken>())
            .Returns(false);

        var context = HandlerContext(PermissionCodes.JourneyUse);
        await new PermissionAuthorizationHandler(permissions).HandleAsync(context);

        Assert.False(context.HasSucceeded);
    }

    [Fact]
    public async Task A_custom_role_carrying_the_effective_code_satisfies_the_preview_policy()
    {
        /* Karar rol ADINA değil ETKİN YETKİ koduna bakar: kodu taşıyan özel bir
           rol de geçer. "Rol adı kestirmesi yok" iddiasının testi. */
        var permissions = Substitute.For<IEffectivePermissionService>();
        permissions
            .HasPermissionAsync(42, PermissionCodes.JourneyUse, Arg.Any<CancellationToken>())
            .Returns(true);

        var context = HandlerContext(PermissionCodes.JourneyUse);
        await new PermissionAuthorizationHandler(permissions).HandleAsync(context);

        Assert.True(context.HasSucceeded);
    }

    [Fact]
    public void The_service_boundary_is_separate_from_transport_and_simulation()
    {
        var journey = typeof(IJourneyPlanningService);

        Assert.False(typeof(ITransportService).IsAssignableFrom(journey));
        Assert.False(typeof(ITransportSimulationService).IsAssignableFrom(journey));

        // Mevcut arayüzler bu fazda BÜYÜTÜLMEDİ.
        Assert.DoesNotContain(
            typeof(ITransportService).GetMethods().Concat(typeof(ITransportSimulationService).GetMethods()),
            method => method.Name.Contains("Journey", StringComparison.Ordinal));
    }

    /* --- routeFull doğrulaması --------------------------------------------------- */

    [Fact]
    public async Task Route_full_returns_every_stop_in_the_persisted_order()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        await fixture.AddStopAsync(route, "C", 32, 42, sequence: 3);
        await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);

        var result = await fixture.Service.PreviewAsync(Request(JourneyContractNames.RouteFull, routeId: route.Id));

        Assert.True(result.IsSuccess);
        var plan = result.Value!;

        // Sıra istek gövdesinden değil, hattın KALICI SequenceOrder'ından gelir.
        Assert.Equal(["A", "B", "C"], plan.Waypoints.Select(waypoint => waypoint.Name));
        Assert.Equal([0, 1, 2], plan.Waypoints.Select(waypoint => waypoint.Position));
        Assert.Equal(["origin", "via", "destination"], plan.Waypoints.Select(waypoint => waypoint.Role));
        Assert.All(plan.Waypoints, waypoint => Assert.Equal(JourneyContractNames.TransportStop, waypoint.Source));
        Assert.All(plan.Waypoints, waypoint => Assert.Equal(route.Id, waypoint.RouteId));

        Assert.Equal(JourneyContractNames.RouteFull, plan.Summary.Mode);
        Assert.Equal(route.Id, plan.Summary.RouteId);
        Assert.Equal(route.Name, plan.Summary.RouteName);
        Assert.Equal(3, plan.Summary.WaypointCount);

        /* Bu testin konusu SIRALAMADIR; ölçüm ve geometri iddiaları Faz 5B
           yönlendirme testlerindedir. Yine de sonucun gerçekten yönlendirilmiş
           olduğu burada da doğrulanır. */
        Assert.Equal("routed", plan.Summary.ProfileSupport);
        Assert.NotEmpty(plan.GeometryWkt);
        Assert.NotEqual(Guid.Empty, plan.PlanId);
    }

    [Fact]
    public async Task Route_full_rejects_a_missing_route_and_a_route_without_enough_stops()
    {
        await using var fixture = Fixture.Create();

        var missingRouteId = await fixture.Service.PreviewAsync(Request(JourneyContractNames.RouteFull));
        Assert.Equal(ServiceErrorKind.Validation, missingRouteId.ErrorKind);

        var unknown = await fixture.Service.PreviewAsync(
            Request(JourneyContractNames.RouteFull, routeId: 9_999));
        Assert.Equal(ServiceErrorKind.NotFound, unknown.ErrorKind);

        var route = await fixture.AddRouteAsync();
        var empty = await fixture.Service.PreviewAsync(Request(JourneyContractNames.RouteFull, routeId: route.Id));
        Assert.Equal(ServiceErrorKind.Validation, empty.ErrorKind);

        await fixture.AddStopAsync(route, "Tek", 30, 40, sequence: 1);
        var single = await fixture.Service.PreviewAsync(Request(JourneyContractNames.RouteFull, routeId: route.Id));
        Assert.False(single.IsSuccess);
    }

    [Fact]
    public async Task Route_full_rejects_foreign_fields_instead_of_ignoring_them()
    {
        /* Kipe ait OLMAYAN alanları sessizce yok saymak, kullanıcının seçtiği
           bölümü/noktaları görmezden gelip BAŞKA bir yolculuk üretirdi. */
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var first = await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        var second = await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);

        var withSegment = Request(JourneyContractNames.RouteFull, routeId: route.Id);
        withSegment.FromStopId = first.Id;
        withSegment.ToStopId = second.Id;
        Assert.False((await fixture.Service.PreviewAsync(withSegment)).IsSuccess);

        var withWaypoints = Request(JourneyContractNames.RouteFull, routeId: route.Id);
        withWaypoints.Waypoints = [Waypoint(JourneyContractNames.TransportStop, first.Id)];
        Assert.False((await fixture.Service.PreviewAsync(withWaypoints)).IsSuccess);
    }

    /* --- routeSegment doğrulaması ------------------------------------------------ */

    [Fact]
    public async Task Route_segment_returns_only_the_selected_slice_including_intermediate_stops()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        var b = await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);
        await fixture.AddStopAsync(route, "C", 32, 42, sequence: 3);
        var d = await fixture.AddStopAsync(route, "D", 33, 43, sequence: 4);

        var request = Request(JourneyContractNames.RouteSegment, routeId: route.Id);
        request.FromStopId = b.Id;
        request.ToStopId = d.Id;

        var result = await fixture.Service.PreviewAsync(request);

        Assert.True(result.IsSuccess);

        // Aradaki duraklar DÜŞÜRÜLMEZ: bölüm hattın gerçek dizisidir.
        Assert.Equal(["B", "C", "D"], result.Value!.Waypoints.Select(waypoint => waypoint.Name));
        Assert.Equal(route.Id, result.Value.Summary.RouteId);
    }

    [Fact]
    public async Task Route_segment_normalizes_a_reverse_selection_and_declares_it()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var a = await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);
        var c = await fixture.AddStopAsync(route, "C", 32, 42, sequence: 3);

        var request = Request(JourneyContractNames.RouteSegment, routeId: route.Id);
        request.FromStopId = c.Id;
        request.ToStopId = a.Id;

        var result = await fixture.Service.PreviewAsync(request);

        Assert.True(result.IsSuccess);

        /* Ters yön geçerlidir (hat ters işletilebilir) ama SESSİZ değildir:
           sıra kullanıcının seçimine göre normalleştirilir ve varsayım
           sonuçta bildirilir. */
        Assert.Equal(["C", "B", "A"], result.Value!.Waypoints.Select(waypoint => waypoint.Name));
        Assert.Contains(result.Value.Summary.Assumptions, note => note.Contains("TERS", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Route_segment_rejects_missing_stops_identical_stops_and_stops_from_another_route()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var a = await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        var b = await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);

        var other = await fixture.AddRouteAsync("Diğer Hat");
        var foreign = await fixture.AddStopAsync(other, "X", 35, 45, sequence: 1);

        // Rota yok.
        var noRoute = Request(JourneyContractNames.RouteSegment);
        noRoute.FromStopId = a.Id;
        noRoute.ToStopId = b.Id;
        Assert.Equal(ServiceErrorKind.Validation, (await fixture.Service.PreviewAsync(noRoute)).ErrorKind);

        // Durak seçimi eksik.
        var missingStops = Request(JourneyContractNames.RouteSegment, routeId: route.Id);
        missingStops.FromStopId = a.Id;
        Assert.False((await fixture.Service.PreviewAsync(missingStops)).IsSuccess);

        // Aynı durak: sıfır uzunlukta bir bölüm.
        var identical = Request(JourneyContractNames.RouteSegment, routeId: route.Id);
        identical.FromStopId = a.Id;
        identical.ToStopId = a.Id;
        Assert.False((await fixture.Service.PreviewAsync(identical)).IsSuccess);

        // Var olan ama BAŞKA hatta ait durak.
        var crossRoute = Request(JourneyContractNames.RouteSegment, routeId: route.Id);
        crossRoute.FromStopId = a.Id;
        crossRoute.ToStopId = foreign.Id;
        Assert.False((await fixture.Service.PreviewAsync(crossRoute)).IsSuccess);
    }

    /* --- Serbest nokta (farklı hatlar / POI) doğrulaması ------------------------- */

    [Fact]
    public async Task Waypoints_can_join_stops_from_different_routes()
    {
        await using var fixture = Fixture.Create();
        var first = await fixture.AddRouteAsync("Hat 1");
        var second = await fixture.AddRouteAsync("Hat 2");
        var a = await fixture.AddStopAsync(first, "A", 30, 40, sequence: 1);
        var x = await fixture.AddStopAsync(second, "X", 35, 45, sequence: 1);

        var request = Request(JourneyContractNames.Waypoints);
        request.Waypoints =
        [
            Waypoint(JourneyContractNames.TransportStop, a.Id),
            Waypoint(JourneyContractNames.TransportStop, x.Id)
        ];

        var result = await fixture.Service.PreviewAsync(request);

        Assert.True(result.IsSuccess);
        Assert.Equal(["A", "X"], result.Value!.Waypoints.Select(waypoint => waypoint.Name));
        Assert.Equal(
            new int?[] { first.Id, second.Id },
            result.Value.Waypoints.Select(waypoint => waypoint.RouteId));

        // Serbest kip hiçbir hatta bağlı DEĞİLDİR; özet tek bir hat iddia etmez.
        Assert.Null(result.Value.Summary.RouteId);
        Assert.Null(result.Value.Summary.RouteName);
    }

    [Fact]
    public async Task Waypoints_can_mix_pois_and_stops_and_the_via_role_is_assigned()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var stop = await fixture.AddStopAsync(route, "Durak", 31, 41, sequence: 1);
        var start = await fixture.AddPoiAsync("Başlangıç POI", 30, 40);
        var end = await fixture.AddPoiAsync("Bitiş POI", 32, 42);

        var request = Request(JourneyContractNames.Waypoints);
        request.Waypoints =
        [
            Waypoint(JourneyContractNames.Poi, start.Id),
            Waypoint(JourneyContractNames.TransportStop, stop.Id),
            Waypoint(JourneyContractNames.Poi, end.Id)
        ];

        var result = await fixture.Service.PreviewAsync(request);

        Assert.True(result.IsSuccess);
        Assert.Equal(
            [JourneyContractNames.Poi, JourneyContractNames.TransportStop, JourneyContractNames.Poi],
            result.Value!.Waypoints.Select(waypoint => waypoint.Source));
        Assert.Equal(["origin", "via", "destination"], result.Value.Waypoints.Select(waypoint => waypoint.Role));

        // POI'nin hattı yoktur; alan uydurulmaz.
        Assert.Null(result.Value.Waypoints[0].RouteId);
        Assert.Null(result.Value.Waypoints[0].SequenceOrder);
        Assert.Equal(route.Id, result.Value.Waypoints[1].RouteId);
    }

    [Fact]
    public async Task A_poi_reference_requires_the_separate_poi_view_permission()
    {
        /* Ulaşım ağını görebilmek, ortak POI envanterini okuyabilmek DEĞİLDİR.
           Denetim serviste durur çünkü yalnızca istek POI taşıdığında anlamlıdır. */
        await using var fixture = Fixture.Create(canViewPois: false);
        var poi = await fixture.AddPoiAsync("POI", 30, 40);
        var other = await fixture.AddPoiAsync("POI 2", 31, 41);

        var request = Request(JourneyContractNames.Waypoints);
        request.Waypoints =
        [
            Waypoint(JourneyContractNames.Poi, poi.Id),
            Waypoint(JourneyContractNames.Poi, other.Id)
        ];

        var result = await fixture.Service.PreviewAsync(request);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
    }

    /* --- Kaynak yetkileri: ürün kapısı bir ANAHTAR değildir --------------------

       Ürün kapısı uçta `journey.use`'a taşındıktan sonra, eskiden onu örtük
       biçimde koruyan `transport.view` gitmiştir. Aşağıdaki testler o örtük
       korumanın yerine AÇIK bir kaynak denetimi geçtiğini sabitler. */

    [Fact]
    public async Task Route_based_modes_require_the_separate_transport_view_permission()
    {
        /* CASE A: journey.use VAR, transport.view YOK. Kişisel yolculuk ürünü
           açıktır ama ulaşım rotası/durağı erişilemez kalır. */
        await using var fixture = Fixture.Create(canViewTransport: false);
        var route = await fixture.AddRouteAsync();
        var a = await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        var b = await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);

        var full = Request(JourneyContractNames.RouteFull);
        full.RouteId = route.Id;

        var fullResult = await fixture.Service.PreviewAsync(full);
        Assert.False(fullResult.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, fullResult.ErrorKind);

        var segment = Request(JourneyContractNames.RouteSegment);
        segment.RouteId = route.Id;
        segment.FromStopId = a.Id;
        segment.ToStopId = b.Id;

        var segmentResult = await fixture.Service.PreviewAsync(segment);
        Assert.False(segmentResult.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, segmentResult.ErrorKind);

        // Motora hiç gidilmez: reddedilen bir istek güzergah hesaplatmaz.
        Assert.Empty(fixture.Router.Calls);
    }

    [Fact]
    public async Task A_transport_stop_waypoint_requires_the_transport_view_permission()
    {
        await using var fixture = Fixture.Create(canViewTransport: false);
        var route = await fixture.AddRouteAsync("Gizli Hat");
        var a = await fixture.AddStopAsync(route, "Gizli Durak", 30, 40, sequence: 1);
        var b = await fixture.AddStopAsync(route, "Gizli Durak 2", 31, 41, sequence: 2);

        var request = Request(JourneyContractNames.Waypoints);
        request.Waypoints =
        [
            Waypoint(JourneyContractNames.TransportStop, a.Id),
            Waypoint(JourneyContractNames.TransportStop, b.Id)
        ];

        var result = await fixture.Service.PreviewAsync(request);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);

        /* Yanıt hiçbir DURAK verisi sızdırmaz: reddedilen istek, durağın
           gerçekten var olduğunu bile doğrulamaz. */
        Assert.DoesNotContain("Gizli", result.Error!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_poi_only_plan_works_without_the_transport_permission()
    {
        /* CASE A'nın olumlu yarısı: poi.view taşıyan bir kullanıcı, ulaşım
           yetkisi olmadan da POI tabanlı serbest yolculuk kurabilir. Ürün
           kapısı bir kaynak anahtarı değildir; tersi de doğrudur. */
        await using var fixture = Fixture.Create(canViewTransport: false);
        var first = await fixture.AddPoiAsync("POI", 30, 40);
        var second = await fixture.AddPoiAsync("POI 2", 31, 41);

        var request = Request(JourneyContractNames.Waypoints);
        request.Waypoints =
        [
            Waypoint(JourneyContractNames.Poi, first.Id),
            Waypoint(JourneyContractNames.Poi, second.Id)
        ];

        Assert.True((await fixture.Service.PreviewAsync(request)).IsSuccess);
    }

    [Fact]
    public async Task A_mixed_plan_still_needs_both_reference_permissions()
    {
        /* CASE B'nin aynası: her referans KENDİ yetkisini ister ve biri
           diğerini karşılamaz. */
        await using var fixture = Fixture.Create(canViewTransport: false);
        var route = await fixture.AddRouteAsync();
        var stop = await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        var poi = await fixture.AddPoiAsync("POI", 31, 41);

        var request = Request(JourneyContractNames.Waypoints);
        request.Waypoints =
        [
            Waypoint(JourneyContractNames.Poi, poi.Id),
            Waypoint(JourneyContractNames.TransportStop, stop.Id)
        ];

        var result = await fixture.Service.PreviewAsync(request);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
    }

    [Fact]
    public async Task A_stop_only_plan_does_not_require_the_poi_permission()
    {
        await using var fixture = Fixture.Create(canViewPois: false);
        var route = await fixture.AddRouteAsync();
        var a = await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        var b = await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);

        var request = Request(JourneyContractNames.Waypoints);
        request.Waypoints =
        [
            Waypoint(JourneyContractNames.TransportStop, a.Id),
            Waypoint(JourneyContractNames.TransportStop, b.Id)
        ];

        Assert.True((await fixture.Service.PreviewAsync(request)).IsSuccess);
    }

    [Fact]
    public async Task Waypoints_require_at_least_two_points_and_reject_foreign_route_fields()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var a = await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);

        var none = Request(JourneyContractNames.Waypoints);
        Assert.False((await fixture.Service.PreviewAsync(none)).IsSuccess);

        var single = Request(JourneyContractNames.Waypoints);
        single.Waypoints = [Waypoint(JourneyContractNames.TransportStop, a.Id)];
        Assert.False((await fixture.Service.PreviewAsync(single)).IsSuccess);

        var withRoute = Request(JourneyContractNames.Waypoints, routeId: route.Id);
        withRoute.Waypoints =
        [
            Waypoint(JourneyContractNames.TransportStop, a.Id),
            Waypoint(JourneyContractNames.TransportStop, a.Id)
        ];
        Assert.False((await fixture.Service.PreviewAsync(withRoute)).IsSuccess);
    }

    [Fact]
    public async Task Waypoints_reject_an_invalid_source_or_reference()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var a = await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);

        var badSource = Request(JourneyContractNames.Waypoints);
        badSource.Waypoints =
        [
            Waypoint("building", a.Id),
            Waypoint(JourneyContractNames.TransportStop, a.Id)
        ];
        Assert.False((await fixture.Service.PreviewAsync(badSource)).IsSuccess);

        var badReference = Request(JourneyContractNames.Waypoints);
        badReference.Waypoints =
        [
            Waypoint(JourneyContractNames.TransportStop, 0),
            Waypoint(JourneyContractNames.TransportStop, a.Id)
        ];
        Assert.False((await fixture.Service.PreviewAsync(badReference)).IsSuccess);
    }

    /* --- Sıra normalleştirmesi ve tekrarlar -------------------------------------- */

    [Fact]
    public async Task An_explicit_order_reorders_the_waypoints_and_must_be_complete_and_unique()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var a = await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        var b = await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);
        var c = await fixture.AddStopAsync(route, "C", 32, 42, sequence: 3);

        var ordered = Request(JourneyContractNames.Waypoints);
        ordered.Waypoints =
        [
            Waypoint(JourneyContractNames.TransportStop, c.Id, order: 30),
            Waypoint(JourneyContractNames.TransportStop, a.Id, order: 10),
            Waypoint(JourneyContractNames.TransportStop, b.Id, order: 20)
        ];

        var result = await fixture.Service.PreviewAsync(ordered);
        Assert.True(result.IsSuccess);

        // Sıra değerleri ARDIŞIK olmak zorunda değildir; yalnızca göreli sıra sayar.
        Assert.Equal(["A", "B", "C"], result.Value!.Waypoints.Select(waypoint => waypoint.Name));
        Assert.Equal([0, 1, 2], result.Value.Waypoints.Select(waypoint => waypoint.Position));

        // Kısmi sıra: "kastedilen sıra" tanımsızdır, sessizce yorumlanmaz.
        var partial = Request(JourneyContractNames.Waypoints);
        partial.Waypoints =
        [
            Waypoint(JourneyContractNames.TransportStop, a.Id, order: 1),
            Waypoint(JourneyContractNames.TransportStop, b.Id)
        ];
        Assert.False((await fixture.Service.PreviewAsync(partial)).IsSuccess);

        // Tekrarlı sıra değeri.
        var duplicateOrder = Request(JourneyContractNames.Waypoints);
        duplicateOrder.Waypoints =
        [
            Waypoint(JourneyContractNames.TransportStop, a.Id, order: 1),
            Waypoint(JourneyContractNames.TransportStop, b.Id, order: 1)
        ];
        Assert.False((await fixture.Service.PreviewAsync(duplicateOrder)).IsSuccess);
    }

    [Fact]
    public async Task Consecutive_duplicates_are_rejected_while_a_round_trip_is_allowed()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var a = await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        var b = await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);

        // Arka arkaya aynı nokta SIFIR uzunlukta bir adım üretir.
        var consecutive = Request(JourneyContractNames.Waypoints);
        consecutive.Waypoints =
        [
            Waypoint(JourneyContractNames.TransportStop, a.Id),
            Waypoint(JourneyContractNames.TransportStop, a.Id),
            Waypoint(JourneyContractNames.TransportStop, b.Id)
        ];
        Assert.False((await fixture.Service.PreviewAsync(consecutive)).IsSuccess);

        // Gidiş-dönüş gerçek bir kullanımdır; bilinçli olarak engellenmez.
        var roundTrip = Request(JourneyContractNames.Waypoints);
        roundTrip.Waypoints =
        [
            Waypoint(JourneyContractNames.TransportStop, a.Id),
            Waypoint(JourneyContractNames.TransportStop, b.Id),
            Waypoint(JourneyContractNames.TransportStop, a.Id)
        ];
        var result = await fixture.Service.PreviewAsync(roundTrip);
        Assert.True(result.IsSuccess);
        Assert.Equal(3, result.Value!.Summary.WaypointCount);
    }

    [Fact]
    public async Task Too_many_waypoints_are_rejected_before_any_database_read()
    {
        await using var fixture = Fixture.Create();

        var request = Request(JourneyContractNames.Waypoints);
        request.Waypoints =
        [
            .. Enumerable
                .Range(1, JourneyPlanningService.MaxWaypoints + 1)
                .Select(id => Waypoint(JourneyContractNames.TransportStop, id))
        ];

        Assert.False((await fixture.Service.PreviewAsync(request)).IsSuccess);
    }

    /* --- Silinmiş / pasif kayıtların reddi --------------------------------------- */

    [Fact]
    public async Task A_deleted_or_inactive_route_is_rejected_in_route_modes()
    {
        await using var fixture = Fixture.Create();
        var deleted = await fixture.AddRouteAsync("Silinmiş", isDeleted: true);
        var inactive = await fixture.AddRouteAsync("Pasif", isActive: false);
        await fixture.AddStopAsync(deleted, "A", 30, 40, sequence: 1);
        await fixture.AddStopAsync(deleted, "B", 31, 41, sequence: 2);
        await fixture.AddStopAsync(inactive, "A", 30, 40, sequence: 1);
        await fixture.AddStopAsync(inactive, "B", 31, 41, sequence: 2);

        foreach (var route in (TransportRoute[])[deleted, inactive])
        {
            var result = await fixture.Service.PreviewAsync(
                Request(JourneyContractNames.RouteFull, routeId: route.Id));

            Assert.False(result.IsSuccess);
            Assert.Equal(ServiceErrorKind.NotFound, result.ErrorKind);
        }
    }

    [Fact]
    public async Task A_deleted_or_inactive_stop_is_neither_silently_skipped_nor_selectable()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        var a = await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        var removed = await fixture.AddStopAsync(route, "Silinmiş", 31, 41, sequence: 2, isDeleted: true);
        var passive = await fixture.AddStopAsync(route, "Pasif", 31.5, 41.5, sequence: 3, isActive: false);
        await fixture.AddStopAsync(route, "B", 32, 42, sequence: 4);

        // routeFull kullanılabilir durakları alır; kullanılamayanlar hiç görünmez.
        var full = await fixture.Service.PreviewAsync(Request(JourneyContractNames.RouteFull, routeId: route.Id));
        Assert.True(full.IsSuccess);
        Assert.Equal(["A", "B"], full.Value!.Waypoints.Select(waypoint => waypoint.Name));

        /* Serbest kipte ise SEÇİLEMEZ: kullanıcı açıkça istediği bir noktayı
           kaybetmemelidir — istek atlanmaz, tümüyle reddedilir. */
        foreach (var stop in (TransportStop[])[removed, passive])
        {
            var request = Request(JourneyContractNames.Waypoints);
            request.Waypoints =
            [
                Waypoint(JourneyContractNames.TransportStop, a.Id),
                Waypoint(JourneyContractNames.TransportStop, stop.Id)
            ];

            var result = await fixture.Service.PreviewAsync(request);
            Assert.False(result.IsSuccess);
        }

        // Hiç var olmayan bir kimlik de aynı kapıdan döner.
        var unknown = Request(JourneyContractNames.Waypoints);
        unknown.Waypoints =
        [
            Waypoint(JourneyContractNames.TransportStop, a.Id),
            Waypoint(JourneyContractNames.TransportStop, 9_999)
        ];
        Assert.False((await fixture.Service.PreviewAsync(unknown)).IsSuccess);
    }

    [Fact]
    public async Task A_stop_whose_route_is_deleted_cannot_enter_a_free_waypoint_plan()
    {
        /* Durağın kendi bayrakları temiz olsa bile HATTI silinmişse plana
           giremez; aksi hâlde çöp kutusundaki bir hattın durağı serbest kipten
           geri sızardı. */
        await using var fixture = Fixture.Create();
        var live = await fixture.AddRouteAsync("Canlı");
        var dead = await fixture.AddRouteAsync("Silinmiş", isDeleted: true);
        var a = await fixture.AddStopAsync(live, "A", 30, 40, sequence: 1);
        var orphan = await fixture.AddStopAsync(dead, "Öksüz", 31, 41, sequence: 1);

        var request = Request(JourneyContractNames.Waypoints);
        request.Waypoints =
        [
            Waypoint(JourneyContractNames.TransportStop, a.Id),
            Waypoint(JourneyContractNames.TransportStop, orphan.Id)
        ];

        Assert.False((await fixture.Service.PreviewAsync(request)).IsSuccess);
    }

    [Fact]
    public async Task A_deleted_or_inactive_poi_is_rejected()
    {
        await using var fixture = Fixture.Create();
        var live = await fixture.AddPoiAsync("Canlı", 30, 40);
        var removed = await fixture.AddPoiAsync("Silinmiş", 31, 41, isDeleted: true);
        var passive = await fixture.AddPoiAsync("Pasif", 32, 42, isActive: false);

        foreach (var poi in (Poi[])[removed, passive])
        {
            var request = Request(JourneyContractNames.Waypoints);
            request.Waypoints =
            [
                Waypoint(JourneyContractNames.Poi, live.Id),
                Waypoint(JourneyContractNames.Poi, poi.Id)
            ];

            Assert.False((await fixture.Service.PreviewAsync(request)).IsSuccess);
        }
    }

    /* --- Kimlik ve kip/profil sözleşmesi ----------------------------------------- */

    [Fact]
    public async Task An_unauthenticated_identity_is_rejected_before_anything_is_read()
    {
        await using var fixture = Fixture.Create(userId: null);
        var route = await fixture.AddRouteAsync();
        await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);

        var result = await fixture.Service.PreviewAsync(Request(JourneyContractNames.RouteFull, routeId: route.Id));

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
    }

    [Fact]
    public async Task An_unknown_mode_or_profile_fails_through_the_existing_result_contract()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);

        Assert.Equal(
            ServiceErrorKind.Validation,
            (await fixture.Service.PreviewAsync(Request("teleport", routeId: route.Id))).ErrorKind);

        Assert.Equal(
            ServiceErrorKind.Validation,
            (await fixture.Service.PreviewAsync(new JourneyPlanRequest { RouteId = route.Id })).ErrorKind);

        var badProfile = Request(JourneyContractNames.RouteFull, routeId: route.Id);
        badProfile.Profile = "rocket";
        Assert.Equal(
            ServiceErrorKind.Validation,
            (await fixture.Service.PreviewAsync(badProfile)).ErrorKind);

        // Profil verilmezse karayolu varsayılır; istek reddedilmez.
        var noProfile = Request(JourneyContractNames.RouteFull, routeId: route.Id);
        noProfile.Profile = null;
        var defaulted = await fixture.Service.PreviewAsync(noProfile);
        Assert.True(defaulted.IsSuccess);
        Assert.Equal(JourneyContractNames.Driving, defaulted.Value!.Summary.RequestedProfile);
    }

    [Fact]
    public void Contract_names_parse_case_insensitively_but_reject_anything_else()
    {
        Assert.True(JourneyContractNames.TryParseMode("ROUTEFULL", out var mode));
        Assert.Equal(JourneyMode.RouteFull, mode);
        Assert.True(JourneyContractNames.TryParseSource(" poi ", out var source));
        Assert.Equal(JourneyWaypointSource.Poi, source);
        Assert.True(JourneyContractNames.TryParseProfile("Cycling", out var profile));
        Assert.Equal(JourneyTravelProfile.Cycling, profile);

        // Kısaltma, çoğul ve eşanlamlı KABUL EDİLMEZ.
        Assert.False(JourneyContractNames.TryParseMode("full", out _));
        Assert.False(JourneyContractNames.TryParseMode(null, out _));
        Assert.False(JourneyContractNames.TryParseSource("stop", out _));
        Assert.False(JourneyContractNames.TryParseProfile("car", out _));
        Assert.False(JourneyContractNames.TryParseProfile(string.Empty, out _));

        /* Toplu taşıma KAPSAM DIŞIDIR: GTFS/transit altyapısı olmadığı için
           sahte bir otobüs seçeneği sunulmaz ve talep BİLİNMEYEN bir profil
           olarak reddedilir. */
        Assert.False(JourneyContractNames.TryParseProfile("bus", out _));
    }

    /* --- Profil politikası -------------------------------------------------------- */

    [Fact]
    public void The_canonical_profile_set_is_exactly_driving_walking_and_cycling()
    {
        /* Küme SABİTTİR. Toplu taşıma kapsam dışıdır: GTFS/transit grafiği ve
           tarife altyapısı yoktur, dolayısıyla karayolu davranışıyla
           desteklenen sahte bir otobüs seçeneği SUNULMAZ. Enum ile tel
           üzerindeki adların birlikte iddia edilmesi, birinin diğerinden
           habersiz büyümesini yakalar. */
        Assert.Equal(
            [JourneyTravelProfile.Driving, JourneyTravelProfile.Walking, JourneyTravelProfile.Cycling],
            Enum.GetValues<JourneyTravelProfile>());

        Assert.Equal(
            ["driving", "walking", "cycling"],
            Enum.GetValues<JourneyTravelProfile>().Select(value => JourneyContractNames.Of(value)));

        // Her enum değeri kendi kanonik adına geri çözülür; sessiz bir eşleme yok.
        Assert.All(
            Enum.GetValues<JourneyTravelProfile>(),
            value =>
            {
                Assert.True(JourneyContractNames.TryParseProfile(JourneyContractNames.Of(value), out var parsed));
                Assert.Equal(value, parsed);
            });
    }

    [Fact]
    public async Task A_bus_profile_is_rejected_as_an_unknown_profile()
    {
        /* Otobüs sözleşmenin parçası DEĞİLDİR ve özel bir hata yolu da yoktur:
           mevcut güvenli doğrulama modelinden, "car" ya da "rocket" ile aynı
           kapıdan döner. Faz 5B yönlendirme katmanı bunu değiştirmez —
           istek profil çözümünde durur, motora hiç ulaşmaz. */
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);

        var request = Request(JourneyContractNames.RouteFull, routeId: route.Id);
        request.Profile = "bus";

        var result = await fixture.Service.PreviewAsync(request);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
        Assert.Null(result.Value);

        // Yönlendirme motoruna HİÇ gidilmedi.
        Assert.Equal(0, fixture.Router.CallCount);
    }

    [Fact]
    public void A_profile_is_routed_only_when_its_own_engine_is_configured()
    {
        /* Faz 5B'nin çekirdek kuralı: karar yapılandırılmış motor profiline
           göre değil, o profilin GERÇEKTEN yönlendirilebilir olmasına göre
           verilir. "Yaklaşık" diye üçüncü bir durum artık YOKTUR. */
        var routed = JourneyProfilePolicy.Decide(JourneyTravelProfile.Walking, isRoutable: true);
        Assert.Equal(JourneyProfileSupport.Routed, routed.Support);
        Assert.Null(routed.Note);

        var unavailable = JourneyProfilePolicy.Decide(JourneyTravelProfile.Walking, isRoutable: false);
        Assert.Equal(JourneyProfileSupport.Unavailable, unavailable.Support);
        Assert.False(string.IsNullOrWhiteSpace(unavailable.Note));

        // Gerekçe, sürüşe düşmenin bir seçenek OLMADIĞINI söyler.
        Assert.Contains("yürüyüş gibi gösterilmez", unavailable.Note!, StringComparison.Ordinal);
    }

    [Fact]
    public void The_support_contract_has_exactly_two_honest_states()
    {
        /* "Approximated" KALDIRILDI. Üçüncü bir durum bırakmak, sürüş
           sonucunu yürüyüş/bisiklet diye etiketlemenin kapısını açık
           tutardı. */
        Assert.Equal(
            [JourneyProfileSupport.Routed, JourneyProfileSupport.Unavailable],
            Enum.GetValues<JourneyProfileSupport>());

        Assert.Equal(
            ["routed", "unavailable"],
            Enum.GetValues<JourneyProfileSupport>().Select(value => JourneyContractNames.Of(value)));

        Assert.DoesNotContain(
            Enum.GetNames<JourneyProfileSupport>(),
            name => name.Contains("Approx", StringComparison.OrdinalIgnoreCase));
    }

    /* --- Mevcut mimariye dokunulmadığının kanıtı --------------------------------- */

    [Fact]
    public async Task Planning_writes_nothing_and_leaves_the_existing_route_path_untouched()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        await fixture.AddStopAsync(route, "A", 30, 40, sequence: 1);
        await fixture.AddStopAsync(route, "B", 31, 41, sequence: 2);
        await fixture.AddPathAsync(route);

        var before = await fixture.Db.TransportRoutePaths.AsNoTracking().SingleAsync();

        Assert.True((await fixture.Service.PreviewAsync(
            Request(JourneyContractNames.RouteFull, routeId: route.Id))).IsSuccess);

        var after = await fixture.Db.TransportRoutePaths.AsNoTracking().SingleAsync();

        Assert.Equal(before.GeneratedAt, after.GeneratedAt);
        Assert.Equal(before.IsStale, after.IsStale);
        Assert.Equal(before.DistanceMeters, after.DistanceMeters);
        Assert.Equal(2, await fixture.Db.TransportStops.CountAsync());
    }

    /* --- Yardımcılar ------------------------------------------------------------- */

    private static JourneyPlanRequest Request(string? mode, int? routeId = null) =>
        new() { Mode = mode, Profile = JourneyContractNames.Driving, RouteId = routeId };

    private static JourneyWaypointRequest Waypoint(string? source, int referenceId, int? order = null) =>
        new() { Source = source, ReferenceId = referenceId, Order = order };

    private static AuthorizationHandlerContext HandlerContext(string permissionCode)
    {
        var requirement = new PermissionRequirement(permissionCode);
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, "42")],
            "test"));
        return new AuthorizationHandlerContext([requirement], principal, resource: null);
    }

    private sealed class Fixture : IAsyncDisposable
    {
        public const int UserId = 42;

        private Fixture(
            AppDbContext db,
            int? userId,
            bool canViewPois,
            bool canViewTransport,
            FakeJourneyRouter router)
        {
            Db = db;
            Router = router;

            var currentUser = Substitute.For<ICurrentUserService>();
            currentUser.UserId.Returns(userId);
            currentUser.IsAuthenticated.Returns(userId is not null);

            var permissions = Substitute.For<IEffectivePermissionService>();
            permissions
                .HasPermissionAsync(Arg.Any<int>(), PermissionCodes.PoiView, Arg.Any<CancellationToken>())
                .Returns(canViewPois);

            /* Ürün kapısı (`journey.use`) UÇTADIR; servise gelen istek onu
               çoktan geçmiştir. Serviste sorulan şey KAYNAK yetkisidir ve
               ulaşım referansları için ayrıca istenir. */
            permissions
                .HasPermissionAsync(Arg.Any<int>(), PermissionCodes.TransportView, Arg.Any<CancellationToken>())
                .Returns(canViewTransport);

            Service = new JourneyPlanningService(db, currentUser, permissions, router);
        }

        public AppDbContext Db { get; }

        public FakeJourneyRouter Router { get; }

        public JourneyPlanningService Service { get; }

        public static Fixture Create(
            int? userId = UserId,
            bool canViewPois = true,
            bool canViewTransport = true,
            FakeJourneyRouter? router = null)
        {
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase($"journey-planning-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;
            return new Fixture(
                new AppDbContext(options),
                userId,
                canViewPois,
                canViewTransport,
                router ?? new FakeJourneyRouter());
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

        public async Task<TransportStop> AddStopAsync(
            TransportRoute route,
            string name,
            double longitude,
            double latitude,
            int sequence,
            bool isActive = true,
            bool isDeleted = false)
        {
            var stop = new TransportStop
            {
                RouteId = route.Id,
                UserId = UserId,
                Name = name,
                Coordinate = new Point(longitude, latitude) { SRID = 4326 },
                SequenceOrder = sequence,
                IsActive = isActive,
                IsDeleted = isDeleted,
                CreatedDate = DateTime.UtcNow
            };
            Db.TransportStops.Add(stop);
            await Db.SaveChangesAsync();
            return stop;
        }

        public async Task<Poi> AddPoiAsync(
            string name,
            double longitude,
            double latitude,
            bool isActive = true,
            bool isDeleted = false)
        {
            var poi = new Poi
            {
                Name = name,
                CategoryId = 1,
                Coordinate = new Point(longitude, latitude) { SRID = 4326 },
                UserId = UserId,
                IsActive = isActive,
                IsDeleted = isDeleted,
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
            LineString? geometry = null)
        {
            var path = new TransportRoutePath
            {
                RouteId = route.Id,
                Geometry = geometry
                    ?? new LineString([new Coordinate(30, 40), new Coordinate(31, 41)]) { SRID = 4326 },
                DistanceMeters = 500,
                DurationSeconds = 50,
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
