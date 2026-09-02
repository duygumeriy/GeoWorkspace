using System.Globalization;
using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;
using NetTopologySuite.Geometries;
using NSubstitute;
using StajProject.Api.Authorization;
using StajProject.Api.Controllers;
using StajProject.Api.Hubs;
using StajProject.Api.Simulation;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Application.Simulation;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;
using StajProject.Infrastructure.Simulation;

namespace StajProject.Auth.Tests;

/// <summary>
/// AKTİF paylaşılan simülasyonların KEŞFİ (Faz 4A).
/// </summary>
/// <remarks>
/// <para>
/// Bu fazın taşıdığı iki iddia var. Birincisi OKUMA: "şu anda hangi hatlar
/// çalışıyor" sorusunun tek, otoriter ve deterministik bir cevabı vardır —
/// istemcinin her rotayı tek tek yoklayarak bu kümeyi kendi kurması gerekmez.
/// İkincisi CANLILIK: hiç bilinmeyen bir hatta başka bir operatör simülasyon
/// başlattığında, istemci o rotanın yayın grubunda OLMADIĞI için olayı asla
/// göremez; bu yüzden rotadan bağımsız bir KEŞİF sinyali gerekir.
/// </para>
/// <para>
/// Sinyal ikinci bir simülasyon otoritesi DEĞİLDİR: "küme değişmiş olabilir"
/// der ve istemci tek bir liste okuması yapar. Yoklama (polling) YOKTUR ve
/// ikinci bir hub AÇILMAZ.
/// </para>
/// <para>
/// Yetki OKUMA yetkisidir: <c>transport.view</c>. Çalışan hatları GÖRMEK,
/// onları başlatabilmek ya da durdurabilmekle aynı yetenek değildir.
/// </para>
/// </remarks>
public class TransportSimulationActiveDiscoveryTests
{
    /* --- 1/2/3/4. Aktif = terminal OLMAYAN --------------------------------------- */

    [Fact]
    public async Task Active_discovery_returns_running_and_paused_and_never_a_terminal_run()
    {
        await using var fixture = await Fixture.CreateAsync();

        var running = await fixture.StartRouteAsync("A Hattı");
        var paused = await fixture.StartRouteAsync("B Hattı");
        var completed = await fixture.StartRouteAsync("C Hattı", Fixture.ShortPathDurationSeconds);
        var cancelled = await fixture.StartRouteAsync("D Hattı");

        Assert.True((await fixture.Service.PauseAsync(paused.RouteId, paused.SimulationId)).IsSuccess);

        /* C DOĞAL olarak tamamlanır: yalnızca O kısa yola sahiptir, bu yüzden
           saati ilerletmek diğer hatları bitirmez. */
        await fixture.AdvanceAsync(seconds: Fixture.ShortPathDurationSeconds + 1);

        // D KULLANICI tarafından sıfırlanır.
        Assert.True((await fixture.Service.StopAsync(cancelled.RouteId, cancelled.SimulationId)).IsSuccess);

        var active = fixture.Service.GetActiveSimulations();
        var routeIds = active.Select(item => item.RouteId).ToArray();

        // Çalışıyor ve Duraklatıldı AKTİFTİR.
        Assert.Contains(running.RouteId, routeIds);
        Assert.Contains(paused.RouteId, routeIds);
        Assert.Equal(
            TransportSimulationStatus.Running,
            active.Single(item => item.RouteId == running.RouteId).Status);
        Assert.Equal(
            TransportSimulationStatus.Paused,
            active.Single(item => item.RouteId == paused.RouteId).Status);

        // Tamamlanmış ve iptal edilmiş çalıştırmalar aktif DEĞİLDİR.
        Assert.DoesNotContain(completed.RouteId, routeIds);
        Assert.DoesNotContain(cancelled.RouteId, routeIds);

        /* Ve hiçbir satır terminal durum TAŞIMAZ: aktiflik ayrı bir süzgeçten
           değil, deponun kendi içeriğinden doğar. */
        Assert.All(active, item => Assert.False(
            item.Status is TransportSimulationStatus.Completed or TransportSimulationStatus.Cancelled));
    }

    /* --- 5/6. Eşzamanlı çalıştırmalar + deterministik sıra ----------------------- */

    [Fact]
    public async Task All_concurrent_runs_are_returned_in_a_deterministic_name_then_id_order()
    {
        await using var fixture = await Fixture.CreateAsync();

        /* Ekleme sırası KASITLI olarak alfabetik değildir: sözlük gezinme
           sırası arayüze sızarsa bu test onu yakalar. */
        var zeta = await fixture.StartRouteAsync("Zeytinburnu");
        var alfa = await fixture.StartRouteAsync("Alibeyköy");
        var mercan = await fixture.StartRouteAsync("Mercan");

        var active = fixture.Service.GetActiveSimulations();

        Assert.Equal(3, active.Count);
        Assert.Equal(
            ["Alibeyköy", "Mercan", "Zeytinburnu"],
            active.Select(item => item.RouteName).ToArray());

        // Aynı çağrı iki kez AYNI sırayı verir.
        Assert.Equal(
            active.Select(item => item.RouteId).ToArray(),
            fixture.Service.GetActiveSimulations().Select(item => item.RouteId).ToArray());

        Assert.Equal(
            [alfa.RouteId, mercan.RouteId, zeta.RouteId],
            active.Select(item => item.RouteId).ToArray());
    }

    [Fact]
    public async Task Equal_names_are_broken_by_route_id_and_never_by_progress()
    {
        await using var fixture = await Fixture.CreateAsync();

        var first = await fixture.StartRouteAsync("Aynı Hat");
        var second = await fixture.StartRouteAsync("Aynı Hat");

        /* İkinci hat ilerletilir. Sıralama İLERLEMEYE bakarsa liste her tick'te
           yeniden dizilir ve kullanıcının tıklamak istediği satır kayardı. */
        await fixture.AdvanceAsync(seconds: 30);

        var ordered = fixture.Service.GetActiveSimulations().Select(item => item.RouteId).ToArray();

        Assert.Equal([first.RouteId, second.RouteId], ordered);
        Assert.True(first.RouteId < second.RouteId);
    }

    /* --- 7/8/9/10/11/12. Satır, çalıştırmanın OLGULARINI korur ------------------- */

    [Fact]
    public async Task Every_row_preserves_the_authoritative_run_facts()
    {
        await using var fixture = await Fixture.CreateAsync();
        var started = await fixture.StartRouteAsync("Merkez");

        await fixture.AdvanceAsync(seconds: 30);

        var stored = fixture.Store.Find(started.RouteId)!;
        var row = Assert.Single(fixture.Service.GetActiveSimulations());

        Assert.Equal(stored.RouteId, row.RouteId);
        Assert.Equal(stored.SimulationId, row.SimulationId);
        Assert.Equal(stored.Status, row.Status);
        Assert.Equal(stored.RouteName, row.RouteName);
        Assert.Equal(stored.RouteColorHex, row.RouteColorHex);
        Assert.Equal(stored.StartedByUserId, row.StartedByUserId);
        Assert.Equal(stored.StartedAt, row.StartedAt);

        Assert.Equal(stored.Snapshot.ProgressRatio, row.ProgressRatio);
        Assert.True(row.ProgressRatio > 0);
        Assert.Equal(stored.Snapshot.Position.Longitude, row.Longitude);
        Assert.Equal(stored.Snapshot.Position.Latitude, row.Latitude);
        Assert.Equal(stored.Snapshot.CapturedAt, row.CapturedAt);

        // Ve mevcut kanonik yol ölçüleri de taşınmaya devam eder.
        Assert.Equal(stored.Path.DistanceMeters, row.DistanceMeters);
        Assert.Equal(stored.Path.DurationSeconds, row.DurationSeconds);
        Assert.Equal(stored.Path.Profile, row.Profile);
        Assert.Equal(stored.Path.Points.Count, row.PointCount);
    }

    /* --- 13/14/15/16/17. Yetki: OKUMA -------------------------------------------- */

    [Fact]
    public void The_active_discovery_endpoint_is_gated_by_transport_view_alone()
    {
        var method = typeof(TransportSimulationController)
            .GetMethod(nameof(TransportSimulationController.GetActiveSimulations))!;

        var http = Assert.Single(
            method.GetCustomAttributes(typeof(HttpGetAttribute), true).Cast<HttpMethodAttribute>());
        var required = Assert.Single(method.GetCustomAttributes<RequirePermissionAttribute>(true));

        Assert.Equal("active", http.Template);

        /* OKUMA yetkisidir. Buraya yaşam döngüsü yetkilerini koymak, sıradan
           bir izleyicinin canlı hatları hiç görememesi demek olurdu — üstelik
           komşu okuma ucu zaten transport.view istiyor. */
        Assert.Equal(PermissionCodes.TransportView, required.PermissionCode);
        Assert.NotEqual(PermissionCodes.TransportSimulationStart, required.PermissionCode);
        Assert.NotEqual(PermissionCodes.TransportSimulationStop, required.PermissionCode);

        // Okuma ucu HİÇBİR parametre almaz: süzgeç/arama sunucuda YOKTUR.
        Assert.Empty(method.GetParameters());
    }

    [Fact]
    public async Task A_plain_viewer_may_discover_while_lifecycle_permissions_are_not_required()
    {
        /* view=true, start=false, stop=false → keşif OKUMASI geçer, yaşam
           döngüsü mutasyonları geçmez. */
        var viewer = Substitute.For<IEffectivePermissionService>();
        viewer.HasPermissionAsync(42, PermissionCodes.TransportView, Arg.Any<CancellationToken>()).Returns(true);
        viewer.HasPermissionAsync(42, PermissionCodes.TransportSimulationStart, Arg.Any<CancellationToken>()).Returns(false);
        viewer.HasPermissionAsync(42, PermissionCodes.TransportSimulationStop, Arg.Any<CancellationToken>()).Returns(false);

        var discovery = HandlerContext(PermissionCodes.TransportView);
        await new PermissionAuthorizationHandler(viewer).HandleAsync(discovery);
        Assert.True(discovery.HasSucceeded);

        foreach (var lifecycle in (string[])[
            PermissionCodes.TransportSimulationStart,
            PermissionCodes.TransportSimulationStop])
        {
            var denied = HandlerContext(lifecycle);
            await new PermissionAuthorizationHandler(viewer).HandleAsync(denied);
            Assert.False(denied.HasSucceeded);
        }
    }

    [Fact]
    public async Task Without_transport_view_the_discovery_read_is_refused()
    {
        // Yaşam döngüsü yetkileri OKUMANIN yerine GEÇMEZ: fail-closed.
        var operatorOnly = Substitute.For<IEffectivePermissionService>();
        operatorOnly.HasPermissionAsync(42, PermissionCodes.TransportView, Arg.Any<CancellationToken>()).Returns(false);
        operatorOnly.HasPermissionAsync(42, PermissionCodes.TransportSimulationStart, Arg.Any<CancellationToken>()).Returns(true);
        operatorOnly.HasPermissionAsync(42, PermissionCodes.TransportSimulationStop, Arg.Any<CancellationToken>()).Returns(true);

        var denied = HandlerContext(PermissionCodes.TransportView);
        await new PermissionAuthorizationHandler(operatorOnly).HandleAsync(denied);

        Assert.False(denied.HasSucceeded);
    }

    /* --- 17/25. Rol adı YOKTUR, controller İNCEDİR ------------------------------- */

    [Fact]
    public void The_controller_stays_thin_and_carries_no_role_name_authorization()
    {
        var authorize = Assert.Single(
            typeof(TransportSimulationController)
                .GetCustomAttributes(typeof(AuthorizeAttribute), true)
                .Cast<AuthorizeAttribute>());

        Assert.Null(authorize.Roles);
        Assert.Null(authorize.Policy);

        var dependencies = typeof(TransportSimulationController).GetConstructors().Single()
            .GetParameters().Select(parameter => parameter.ParameterType).ToArray();

        // Uç servise sorar; depoya ya da yayıncıya DOĞRUDAN bağlanmaz.
        Assert.Contains(typeof(ITransportSimulationService), dependencies);
        Assert.DoesNotContain(typeof(ITransportSimulationStateStore), dependencies);
        Assert.DoesNotContain(typeof(ITransportSimulationDiscoveryBroadcaster), dependencies);
        Assert.DoesNotContain(dependencies, type => type.Name.Contains("Role", StringComparison.Ordinal));

        /* Çalışma zamanı ilkelleri HTTP/kimlik taşımaz: keşif yayıncısı da
           istisna değildir. */
        Assert.DoesNotContain(
            typeof(ITransportSimulationDiscoveryBroadcaster).GetMethods(),
            method => method.GetParameters().Any(parameter =>
                parameter.ParameterType.Name.Contains("Principal", StringComparison.Ordinal)
                || parameter.ParameterType.Name.Contains("HttpContext", StringComparison.Ordinal)));
    }

    [Fact]
    public async Task The_endpoint_returns_the_service_list_and_nothing_else()
    {
        /* Sınıfta bir metot BULUNMASI, ucun onu çağırdığı anlamına gelmez:
           gerçek okuma yolu (controller → servis → depo) çalıştırılır. */
        await using var fixture = await Fixture.CreateAsync();
        await fixture.StartRouteAsync("Sahil");
        await fixture.StartRouteAsync("Merkez");

        var controller = new TransportSimulationController(
            fixture.Service,
            Substitute.For<ILogger<TransportSimulationController>>())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };

        var response = await controller.GetActiveSimulations();
        var body = Assert.IsAssignableFrom<IReadOnlyList<TransportSimulationResponse>>(
            Assert.IsAssignableFrom<ObjectResult>(response.Result).Value);

        Assert.Equal(["Merkez", "Sahil"], body.Select(item => item.RouteName).ToArray());
    }

    /* --- 18/19. Bir hattı sıfırlamak YALNIZCA onu düşürür ------------------------ */

    [Fact]
    public async Task Resetting_one_route_removes_only_that_route_from_discovery()
    {
        await using var fixture = await Fixture.CreateAsync();

        var a = await fixture.StartRouteAsync("A");
        var b = await fixture.StartRouteAsync("B");
        var c = await fixture.StartRouteAsync("C");

        Assert.True((await fixture.Service.StopAsync(b.RouteId, b.SimulationId)).IsSuccess);

        var active = fixture.Service.GetActiveSimulations();

        Assert.Equal([a.RouteId, c.RouteId], active.Select(item => item.RouteId).ToArray());
        Assert.Equal(a.SimulationId, active[0].SimulationId);
        Assert.Equal(c.SimulationId, active[1].SimulationId);
    }

    /* --- 20/21. Duraklat/Sürdür ÜYELİĞİ değiştirmez ------------------------------ */

    [Fact]
    public async Task Pausing_keeps_the_route_active_and_resuming_keeps_the_same_identity()
    {
        await using var fixture = await Fixture.CreateAsync();
        var run = await fixture.StartRouteAsync("A");

        Assert.True((await fixture.Service.PauseAsync(run.RouteId, run.SimulationId)).IsSuccess);

        var paused = Assert.Single(fixture.Service.GetActiveSimulations());
        Assert.Equal(TransportSimulationStatus.Paused, paused.Status);
        Assert.Equal(run.SimulationId, paused.SimulationId);

        Assert.True((await fixture.Service.ResumeAsync(run.RouteId, run.SimulationId)).IsSuccess);

        var resumed = Assert.Single(fixture.Service.GetActiveSimulations());
        Assert.Equal(TransportSimulationStatus.Running, resumed.Status);

        // AYNI çalıştırma: sürdürme yeni bir kimlik ÜRETMEZ.
        Assert.Equal(run.SimulationId, resumed.SimulationId);
        Assert.Equal(run.StartedAt, resumed.StartedAt);
    }

    /* --- 22. Yeni başlayan hat KEŞFEDİLEBİLİR olur ------------------------------- */

    [Fact]
    public async Task A_newly_started_route_becomes_discoverable_without_touching_the_others()
    {
        await using var fixture = await Fixture.CreateAsync();
        var a = await fixture.StartRouteAsync("A");
        var b = await fixture.StartRouteAsync("B");

        Assert.Equal(2, fixture.Service.GetActiveSimulations().Count);

        var d = await fixture.StartRouteAsync("D");

        var active = fixture.Service.GetActiveSimulations();
        Assert.Equal([a.RouteId, b.RouteId, d.RouteId], active.Select(item => item.RouteId).ToArray());
        Assert.Equal(d.SimulationId, active[2].SimulationId);
    }

    /* --- 23/24. İç iptal ve doğal tamamlanma hattı düşürür ----------------------- */

    [Fact]
    public async Task Internal_cancellation_removes_the_route_from_discovery()
    {
        await using var fixture = await Fixture.CreateAsync();
        var a = await fixture.StartRouteAsync("A");
        var b = await fixture.StartRouteAsync("B");

        /* Güzergah geçersizleşmesi yolu: kullanıcı niyeti YOKTUR ve hiçbir
           yetki İSTEMEZ — ama keşif kümesi yine de küçülür. */
        ITransportSimulationCanceller canceller = fixture.Runner;
        await canceller.CancelForRoutesAsync([a.RouteId]);

        var active = fixture.Service.GetActiveSimulations();
        Assert.Equal(b.RouteId, Assert.Single(active).RouteId);
    }

    [Fact]
    public async Task Natural_completion_removes_the_route_from_discovery()
    {
        await using var fixture = await Fixture.CreateAsync();
        var a = await fixture.StartRouteAsync("A", Fixture.ShortPathDurationSeconds);
        await fixture.StartRouteAsync("B");

        // B duraklatılır: duraklatılmış çalıştırma İLERLEMEZ, dolayısıyla bitmez.
        Assert.True((await fixture.Service.PauseAsync(
            fixture.RouteIdOf("B"), fixture.SimulationIdOf("B"))).IsSuccess);

        await fixture.AdvanceAsync(seconds: Fixture.ShortPathDurationSeconds + 1);

        var active = fixture.Service.GetActiveSimulations();
        Assert.DoesNotContain(a.RouteId, active.Select(item => item.RouteId));

        // Duraklatılmış B ilerlemediği için HÂLÂ aktiftir.
        Assert.Equal(TransportSimulationStatus.Paused, Assert.Single(active).Status);
    }

    /* --- 26. Depo değiştirilebilir bir koleksiyon SIZDIRMAZ ---------------------- */

    [Fact]
    public async Task The_state_store_never_leaks_a_mutable_collection()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.StartRouteAsync("A");
        await fixture.StartRouteAsync("B");

        var snapshot = fixture.Store.Active();

        // Görüntü SALT OKUNURDUR: "aktif küme" kavramının depo dışında ikinci
        // bir sahibi doğamaz.
        Assert.True(((ICollection<ActiveTransportSimulation>)snapshot).IsReadOnly);
        Assert.Throws<NotSupportedException>(
            () => ((ICollection<ActiveTransportSimulation>)snapshot).Clear());

        // Ve her çağrı YENİ bir görüntüdür; iç sözlüğün kendisi değildir.
        Assert.NotSame(snapshot, fixture.Store.Active());

        await fixture.StartRouteAsync("C");
        Assert.Equal(2, snapshot.Count);
        Assert.Equal(3, fixture.Store.Active().Count);
    }

    /* --- 27. KANONİK durum sözlüğü ----------------------------------------------- */

    [Fact]
    public void The_active_response_reuses_the_canonical_status_type()
    {
        /* İkinci bir paylaşılan yaşam döngüsü DTO'su ya da durum vokabüleri
           uydurulmadı: keşif ucu mevcut kanonik yanıt modelini döndürür. */
        var element = typeof(TransportSimulationController)
            .GetMethod(nameof(TransportSimulationController.GetActiveSimulations))!
            .ReturnType
            .GetGenericArguments()[0]   // ActionResult<IReadOnlyList<T>>
            .GetGenericArguments()[0]   // IReadOnlyList<T>
            .GetGenericArguments()[0];  // T

        Assert.Equal(typeof(TransportSimulationResponse), element);
        Assert.Equal(
            typeof(TransportSimulationStatus),
            element.GetProperty(nameof(TransportSimulationResponse.Status))!.PropertyType);
        Assert.Equal(
            typeof(TransportSimulationStatus),
            typeof(TransportSimulationLiveUpdate)
                .GetProperty(nameof(TransportSimulationLiveUpdate.Status))!.PropertyType);
    }

    /* --- 28/29/30/31. ÜYELİK değişimi keşif sinyali üretir ----------------------- */

    [Fact]
    public async Task Starting_a_run_announces_that_the_active_set_grew()
    {
        await using var fixture = await Fixture.CreateAsync();

        var run = await fixture.StartRouteAsync("A");

        var signal = Assert.Single(fixture.Discovery.Changes);
        Assert.Equal(TransportActiveSetChange.Started, signal.Change);
        Assert.Equal(run.RouteId, signal.RouteId);
        Assert.Equal(run.SimulationId, signal.SimulationId);
    }

    [Fact]
    public async Task Reset_natural_completion_and_internal_cancellation_all_announce_an_end()
    {
        await using var fixture = await Fixture.CreateAsync();

        // 29. Sıfırla (kullanıcı komutu).
        var reset = await fixture.StartRouteAsync("A");
        fixture.Discovery.Changes.Clear();
        Assert.True((await fixture.Service.StopAsync(reset.RouteId, reset.SimulationId)).IsSuccess);
        AssertEnded(fixture, reset);

        // 30. Doğal tamamlanma.
        var completed = await fixture.StartRouteAsync("B", Fixture.ShortPathDurationSeconds);
        fixture.Discovery.Changes.Clear();
        await fixture.AdvanceAsync(seconds: Fixture.ShortPathDurationSeconds + 1);
        AssertEnded(fixture, completed);

        // 31. İç iptal (güzergah geçersizleşmesi).
        var cancelled = await fixture.StartRouteAsync("C");
        fixture.Discovery.Changes.Clear();
        ITransportSimulationCanceller canceller = fixture.Runner;
        await canceller.CancelForRoutesAsync([cancelled.RouteId]);
        AssertEnded(fixture, cancelled);
    }

    /* --- 32/33. Duraklat/Sürdür ÜYELİK sinyali ÜRETMEZ --------------------------- */

    [Fact]
    public async Task Pause_and_resume_never_announce_a_membership_change()
    {
        await using var fixture = await Fixture.CreateAsync();
        var run = await fixture.StartRouteAsync("A");

        fixture.Discovery.Changes.Clear();
        fixture.Broadcaster.Updates.Clear();

        Assert.True((await fixture.Service.PauseAsync(run.RouteId, run.SimulationId)).IsSuccess);
        Assert.True((await fixture.Service.ResumeAsync(run.RouteId, run.SimulationId)).IsSuccess);

        /* Duraklatılmış çalıştırma hattın aktif yuvasını İŞGAL ETMEYE devam
           eder: küme değişmez. Her duraklatmada sinyal üretmek, tüm
           gözlemcilere gereksiz bir liste okuması yaptırırdı. */
        Assert.Empty(fixture.Discovery.Changes);

        // 35. Geçişler MEVCUT rota bazlı akıştan görünmeye devam eder.
        Assert.Equal(
            [TransportSimulationStatus.Paused, TransportSimulationStatus.Running],
            fixture.Broadcaster.Updates.Select(update => update.Status).ToArray());
        Assert.All(fixture.Broadcaster.Updates, update => Assert.Equal(run.SimulationId, update.SimulationId));
    }

    [Fact]
    public async Task Progress_ticks_never_announce_a_membership_change()
    {
        /* Her tick'te sinyal üretmek, saniyede bir kez TÜM gözlemcilere aktif
           liste okutmak demekti — yani yoklamanın sunucudan tetiklenen
           biçimi. */
        await using var fixture = await Fixture.CreateAsync();
        await fixture.StartRouteAsync("A");
        fixture.Discovery.Changes.Clear();

        await fixture.AdvanceAsync(seconds: 10);
        await fixture.AdvanceAsync(seconds: 10);
        await fixture.AdvanceAsync(seconds: 10);

        Assert.Empty(fixture.Discovery.Changes);
        Assert.NotEmpty(fixture.Broadcaster.Updates);
    }

    /* --- 34. Keşif üyeliği transport.view KORUMALIDIR ---------------------------- */

    [Fact]
    public async Task Discovery_membership_requires_the_effective_view_permission()
    {
        var denied = HubFixture.Create(hasViewPermission: false);

        var exception = await Assert.ThrowsAsync<HubException>(
            () => denied.Hub.JoinActiveSimulationDiscovery());

        // İç ayrıntı sızmaz.
        Assert.DoesNotContain("Exception", exception.Message, StringComparison.OrdinalIgnoreCase);
        await denied.Groups.DidNotReceive().AddToGroupAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());

        var allowed = HubFixture.Create();
        await allowed.Hub.JoinActiveSimulationDiscovery();

        // Karar AYNI etkin yetki motoruna, KANONİK kodla sorulur.
        await allowed.Permissions.Received(1).HasPermissionAsync(
            42, PermissionCodes.TransportView, Arg.Any<CancellationToken>());
        await allowed.Groups.Received(1).AddToGroupAsync(
            HubFixture.ConnectionId,
            TransportSimulationHubContract.DiscoveryGroup,
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task An_unreadable_identity_never_reaches_the_discovery_group()
    {
        var fixture = HubFixture.Create(userId: null);

        await Assert.ThrowsAsync<HubException>(() => fixture.Hub.JoinActiveSimulationDiscovery());

        await fixture.Permissions.DidNotReceive().HasPermissionAsync(
            Arg.Any<int>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
        await fixture.Groups.DidNotReceive().AddToGroupAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task The_discovery_signal_goes_to_the_discovery_group_and_never_to_everyone()
    {
        /* Sinyal hangi hatların çalıştığını AÇIĞA VURUR: ayrım gözetmeyen bir
           yayın, yetkisiz bağlantılara ulaşırdı. */
        var clients = Substitute.For<IHubClients>();
        var proxy = Substitute.For<IClientProxy>();
        clients.Group(Arg.Any<string>()).Returns(proxy);
        var hubContext = Substitute.For<IHubContext<TransportSimulationHub>>();
        hubContext.Clients.Returns(clients);

        var change = new TransportActiveSimulationSetChanged(
            7, Guid.NewGuid(), TransportActiveSetChange.Started, DateTime.UtcNow);

        await new SignalRTransportSimulationDiscoveryBroadcaster(
            hubContext,
            Substitute.For<ILogger<SignalRTransportSimulationDiscoveryBroadcaster>>())
            .PublishActiveSetChangedAsync(change);

        clients.Received(1).Group(TransportSimulationHubContract.DiscoveryGroup);
        _ = clients.DidNotReceive().All;

        await proxy.Received(1).SendCoreAsync(
            TransportSimulationHubContract.ActiveSetChangedMethod,
            Arg.Is<object?[]>(args => args.Length == 1 && ReferenceEquals(args[0], change)),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task A_transport_failure_in_the_signal_never_surfaces_to_the_caller()
    {
        /* Sinyal bir KOLAYLIKTIR: çoktan başlamış bir çalıştırma, duyurusu
           yapılamadı diye geri alınamaz ve başarılı bir komut 500'e
           çevrilemez. */
        var clients = Substitute.For<IHubClients>();
        var proxy = Substitute.For<IClientProxy>();
        proxy.SendCoreAsync(Arg.Any<string>(), Arg.Any<object?[]>(), Arg.Any<CancellationToken>())
            .Returns(Task.FromException(new InvalidOperationException("taşıma arızası")));
        clients.Group(Arg.Any<string>()).Returns(proxy);
        var hubContext = Substitute.For<IHubContext<TransportSimulationHub>>();
        hubContext.Clients.Returns(clients);

        await new SignalRTransportSimulationDiscoveryBroadcaster(
            hubContext,
            Substitute.For<ILogger<SignalRTransportSimulationDiscoveryBroadcaster>>())
            .PublishActiveSetChangedAsync(new TransportActiveSimulationSetChanged(
                7, Guid.NewGuid(), TransportActiveSetChange.Ended, DateTime.UtcNow));
    }

    /* --- 35/36. Mevcut kanal DEĞİŞMEDİ ve İKİNCİ HUB YOK ------------------------- */

    [Fact]
    public void The_route_stream_contract_is_untouched_and_the_discovery_shares_the_same_hub()
    {
        // Mevcut sözleşme sabitleri aynen durur.
        Assert.Equal("/hubs/transport-simulation", TransportSimulationHubContract.Path);
        Assert.Equal("SimulationUpdated", TransportSimulationHubContract.UpdateMethod);
        Assert.Equal("transport-simulation-route-7", TransportSimulationHubContract.GroupFor(7));

        // Keşif AYNI hub'ın AYRI bir grubudur.
        Assert.Equal("ActiveSimulationSetChanged", TransportSimulationHubContract.ActiveSetChangedMethod);
        Assert.Equal("transport-simulation-active-discovery", TransportSimulationHubContract.DiscoveryGroup);
        Assert.NotEqual(
            TransportSimulationHubContract.DiscoveryGroup,
            TransportSimulationHubContract.GroupFor(0));

        // Katılma/ayrılma metotları gerçekten hub üzerindedir.
        Assert.NotNull(typeof(TransportSimulationHub)
            .GetMethod(TransportSimulationHubContract.JoinDiscoveryMethod));
        Assert.NotNull(typeof(TransportSimulationHub)
            .GetMethod(TransportSimulationHubContract.LeaveDiscoveryMethod));
    }

    [Fact]
    public void No_second_shared_transport_hub_exists()
    {
        /* İkinci bir hub, ikinci bir yol, ikinci bir kimlik hattı ve
           istemcide ikinci bir bağlantı demekti. Paylaşılan ulaşım tarafında
           TEK hub vardır; kişisel yolculuk hub'ı AYRI bir üründür ve bu fazda
           hiç değişmedi. */
        var hubs = typeof(TransportSimulationHub).Assembly
            .GetTypes()
            .Where(type => !type.IsAbstract && typeof(Hub).IsAssignableFrom(type))
            .Select(type => type.Name)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(["JourneySimulationHub", "TransportSimulationHub"], hubs);
    }

    [Fact]
    public void The_discovery_broadcaster_is_actually_registered_in_the_composition_root()
    {
        /* Bağımlılık İSTEĞE BAĞLI olarak enjekte edilir (kanal kurulmamış dar
           bileşimlerde simülasyon yine doğru çalışsın diye). Bunun bedeli,
           kaydın unutulmasının SESSİZ bir arızaya dönüşebilmesidir: hiçbir
           sinyal çıkmaz ve kimse fark etmez. Kayıt bu yüzden burada çivilenir.

           Ayrıca AYNI hub kullanılır: keşif için ikinci bir MapHub yoktur. */
        var program = ProgramSource();

        Assert.Contains(
            "AddSingleton<ITransportSimulationDiscoveryBroadcaster, SignalRTransportSimulationDiscoveryBroadcaster>()",
            program,
            StringComparison.Ordinal);

        Assert.Equal(
            2,
            System.Text.RegularExpressions.Regex.Matches(program, @"MapHub<(\w+)>").Count);
    }

    /* --- Yardımcılar -------------------------------------------------------------- */

    private static string ProgramSource()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, "src")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return File.ReadAllText(Path.Combine(directory!.FullName, "src/StajProject.Api/Program.cs"));
    }

    private static void AssertEnded(Fixture fixture, TransportSimulationResponse run)
    {
        var signal = Assert.Single(fixture.Discovery.Changes);
        Assert.Equal(TransportActiveSetChange.Ended, signal.Change);
        Assert.Equal(run.RouteId, signal.RouteId);
        Assert.Equal(run.SimulationId, signal.SimulationId);
    }

    private static AuthorizationHandlerContext HandlerContext(string permissionCode)
    {
        var requirement = new PermissionRequirement(permissionCode);
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, "42")],
            "test"));
        return new AuthorizationHandlerContext([requirement], principal, resource: null);
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

    private sealed class RecordingDiscoveryBroadcaster : ITransportSimulationDiscoveryBroadcaster
    {
        public List<TransportActiveSimulationSetChanged> Changes { get; } = [];

        public Task PublishActiveSetChangedAsync(
            TransportActiveSimulationSetChanged change,
            CancellationToken cancellationToken = default)
        {
            Changes.Add(change);
            return Task.CompletedTask;
        }
    }

    /// <summary>Runner'ın ilerletme saatiyle AYNI ekseni paylaşan sentetik saat.</summary>
    private sealed class SyntheticTimeProvider : TimeProvider
    {
        public DateTime UtcNow { get; set; } = DateTime.UtcNow;

        public override DateTimeOffset GetUtcNow() => new(UtcNow, TimeSpan.Zero);
    }

    private sealed class HubFixture
    {
        public const string ConnectionId = "connection-1";

        private HubFixture(
            IEffectivePermissionService permissions,
            IGroupManager groups,
            HubCallerContext context)
        {
            Permissions = permissions;
            Groups = groups;
            Hub = new TransportSimulationHub(permissions, Substitute.For<ITransportSimulationService>())
            {
                Context = context,
                Groups = groups
            };
        }

        public IEffectivePermissionService Permissions { get; }
        public IGroupManager Groups { get; }
        public TransportSimulationHub Hub { get; }

        public static HubFixture Create(bool hasViewPermission = true, int? userId = 42)
        {
            var permissions = Substitute.For<IEffectivePermissionService>();
            permissions
                .HasPermissionAsync(Arg.Any<int>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
                .Returns(hasViewPermission);

            Claim[] claims = userId is null
                ? []
                : [new Claim(ClaimTypes.NameIdentifier, userId.Value.ToString(CultureInfo.InvariantCulture))];

            var context = Substitute.For<HubCallerContext>();
            context.ConnectionId.Returns(ConnectionId);
            context.User.Returns(new ClaimsPrincipal(new ClaimsIdentity(claims, "test")));

            return new HubFixture(permissions, Substitute.For<IGroupManager>(), context);
        }
    }

    private sealed class Fixture : IAsyncDisposable
    {
        /// <summary>
        /// Varsayılan yol süresi BİLİNÇLİ olarak uzundur: bir testte saati
        /// ilerletmek, o testin ilgilenmediği hatların kendiliğinden
        /// tamamlanmasına yol açmamalıdır. Doğal tamamlanmayı sınayan testler
        /// KISA süreli bir hat açar.
        /// </summary>
        public const double PathDurationSeconds = 1_000;

        /// <summary>Doğal tamamlanma için kullanılan kısa yol süresi.</summary>
        public const double ShortPathDurationSeconds = 10;

        private const int UserId = 42;

        private readonly SyntheticTimeProvider _time = new();
        private readonly Dictionary<string, TransportSimulationResponse> _runs = [];

        private Fixture(AppDbContext db)
        {
            Db = db;
            Store = new InMemoryTransportSimulationStateStore();
            Broadcaster = new RecordingBroadcaster();
            Discovery = new RecordingDiscoveryBroadcaster();

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
                _time,
                Discovery);

            Service = new TransportSimulationService(db, currentUser, Store, Runner, Runner, Discovery);
        }

        public AppDbContext Db { get; }
        public InMemoryTransportSimulationStateStore Store { get; }
        public RecordingBroadcaster Broadcaster { get; }
        public RecordingDiscoveryBroadcaster Discovery { get; }
        public TransportSimulationRunner Runner { get; }
        public TransportSimulationService Service { get; }

        private DateTime Clock
        {
            get => _time.UtcNow;
            set => _time.UtcNow = value;
        }

        public static async Task<Fixture> CreateAsync()
        {
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase($"transport-active-discovery-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;

            var fixture = new Fixture(new AppDbContext(options));

            /* Saat, ilk çalıştırmadan ÖNCE sabitlenir: böylece "N saniye
               ilerlet" ifadesi tüm hatlar için aynı ekseni kullanır. */
            fixture.Clock = DateTime.UtcNow;
            await Task.CompletedTask;
            return fixture;
        }

        /// <summary>Adlandırılmış bir hat oluşturur, yolunu ekler ve başlatır.</summary>
        public async Task<TransportSimulationResponse> StartRouteAsync(
            string name,
            double durationSeconds = PathDurationSeconds)
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

            Db.TransportRoutePaths.Add(new TransportRoutePath
            {
                RouteId = route.Id,
                Geometry = new LineString([new Coordinate(30, 40), new Coordinate(31, 41)]) { SRID = 4326 },
                DistanceMeters = 500,
                DurationSeconds = durationSeconds,
                Profile = "driving",
                GeneratedAt = DateTime.UtcNow,
                IsStale = false
            });
            await Db.SaveChangesAsync();

            var started = await Service.StartAsync(route.Id);
            Assert.True(started.IsSuccess);

            /* Çalıştırma saati SENTETİK eksene bağlanır; aksi hâlde ilerletme
               ile başlatma iki farklı zaman kaynağından beslenirdi. */
            Clock = Store.Find(route.Id)!.StartedAt;

            _runs[name] = started.Value!;
            return started.Value!;
        }

        public int RouteIdOf(string name) => _runs[name].RouteId;

        public Guid SimulationIdOf(string name) => _runs[name].SimulationId;

        /// <summary>Saati ilerletir ve runner'ı O ANDA çalıştırır.</summary>
        public Task AdvanceAsync(double seconds)
        {
            Clock = Clock.AddSeconds(seconds);
            return Runner.AdvanceAsync(Clock);
        }

        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }
}
