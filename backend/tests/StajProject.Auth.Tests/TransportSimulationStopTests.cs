using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;
using NetTopologySuite.Geometries;
using NSubstitute;
using StajProject.Api.Authorization;
using StajProject.Api.Controllers;
using StajProject.Application.Common;
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
/// PAYLAŞILAN hat simülasyonunun AÇIK durdurma yaşam döngüsü (Faz 3).
/// </summary>
/// <remarks>
/// <para>
/// Ölçülen asıl iddia YARIŞ GÜVENLİĞİDİR: komut <c>routeId</c> ile birlikte
/// <c>simulationId</c> taşır ve sunucu ikisini birden doğrular. Rota 12'de A
/// bitip yerine B başladıysa, hâlâ A'yı tutan eski bir tarayıcı B'yi
/// durduramamalıdır — çünkü B'yi başka kullanıcılar canlı izliyor olabilir.
/// </para>
/// <para>
/// İkinci iddia AYRIMDIR: kullanıcının açık komutu
/// <c>transport.simulation.stop</c> ister; sistemin KENDİ iptali (güzergah
/// geçersizleşmesi) hiçbir kullanıcı yetkisi İSTEMEZ ve o yoldan geçmez.
/// </para>
/// <para>
/// Testler sahte bir sonlandırıcı KULLANMAZ: gerçek çalışma zamanı sahibi
/// (<see cref="TransportSimulationRunner"/>) ve gerçek atomik depo kullanılır,
/// böylece ölçülen şey üretimde çalışan davranıştır.
/// </para>
/// </remarks>
public class TransportSimulationStopTests
{
    /* --- 1/2/15. Yetki sözleşmesi ------------------------------------------------ */

    [Fact]
    public void The_stop_endpoint_requires_the_dedicated_stop_permission()
    {
        var method = typeof(TransportSimulationController).GetMethod(nameof(TransportSimulationController.Stop))!;
        var http = Assert.Single(method.GetCustomAttributes(typeof(HttpPostAttribute), true).Cast<HttpMethodAttribute>());
        var required = Assert.Single(method.GetCustomAttributes<RequirePermissionAttribute>(true));

        /* Yol İKİ kimliği birden taşır. Yalnızca rota taşıyan bir yol, "şu
           hatta ne çalışıyorsa durdur" demek olurdu. */
        Assert.Equal("routes/{routeId:int}/{simulationId:guid}/stop", http.Template);
        Assert.Equal(PermissionCodes.TransportSimulationStop, required.PermissionCode);

        // Başlatma yetkisi durdurma otoritesi olarak KULLANILMAZ.
        Assert.NotEqual(PermissionCodes.TransportSimulationStart, required.PermissionCode);
        Assert.NotEqual(PermissionCodes.TransportView, required.PermissionCode);
    }

    [Fact]
    public async Task Start_permission_does_not_satisfy_the_stop_policy()
    {
        /* İKİ YÖNLÜ ayrım: hattı işletebilen biri onu durduramayabilir ve
           tersi de mümkündür. Karar rol adına değil ETKİN YETKİ koduna bakar. */
        var permissions = Substitute.For<IEffectivePermissionService>();
        permissions
            .HasPermissionAsync(42, PermissionCodes.TransportSimulationStart, Arg.Any<CancellationToken>())
            .Returns(true);
        permissions
            .HasPermissionAsync(42, PermissionCodes.TransportSimulationStop, Arg.Any<CancellationToken>())
            .Returns(false);

        var context = HandlerContext(PermissionCodes.TransportSimulationStop);
        await new PermissionAuthorizationHandler(permissions).HandleAsync(context);

        Assert.False(context.HasSucceeded);
    }

    [Fact]
    public async Task A_custom_role_carrying_only_the_stop_code_satisfies_the_stop_policy()
    {
        /* "Rol adı kestirmesi yok" iddiasının testi: kodu taşıyan ÖZEL bir rol
           (ya da doğrudan kullanıcı yetkisi) geçer, başlatma yetkisi olmasa
           bile. */
        var permissions = Substitute.For<IEffectivePermissionService>();
        permissions
            .HasPermissionAsync(42, PermissionCodes.TransportSimulationStop, Arg.Any<CancellationToken>())
            .Returns(true);
        permissions
            .HasPermissionAsync(42, PermissionCodes.TransportSimulationStart, Arg.Any<CancellationToken>())
            .Returns(false);

        var context = HandlerContext(PermissionCodes.TransportSimulationStop);
        await new PermissionAuthorizationHandler(permissions).HandleAsync(context);

        Assert.True(context.HasSucceeded);
    }

    [Fact]
    public void The_controller_carries_no_role_name_shortcut_and_stays_thin()
    {
        var authorize = Assert.Single(
            typeof(TransportSimulationController)
                .GetCustomAttributes(typeof(AuthorizeAttribute), true)
                .Cast<AuthorizeAttribute>());

        Assert.Null(authorize.Roles);
        Assert.Null(authorize.Policy);

        /* İNCE controller: yalnızca servis portunu ve logger'ı alır. Depo,
           yayıncı ya da çalışma zamanı nesnesi almaz — yaşam döngüsü orada
           yaşamaz. */
        var dependencies = typeof(TransportSimulationController).GetConstructors().Single()
            .GetParameters().Select(parameter => parameter.ParameterType).ToArray();

        Assert.Contains(typeof(ITransportSimulationService), dependencies);
        Assert.DoesNotContain(typeof(ITransportSimulationStateStore), dependencies);
        Assert.DoesNotContain(typeof(ITransportSimulationTerminator), dependencies);
        Assert.DoesNotContain(typeof(ITransportSimulationBroadcaster), dependencies);
        Assert.DoesNotContain(dependencies, type => type.Name.Contains("Role", StringComparison.Ordinal));
        Assert.DoesNotContain(dependencies, type => type.Name.Contains("CancellationTokenSource", StringComparison.Ordinal));
    }

    /* --- 4/10/11. Geçerli durdurma ----------------------------------------------- */

    [Fact]
    public async Task A_matching_route_and_simulation_id_stops_exactly_that_run()
    {
        await using var fixture = await Fixture.WithRunningRouteAsync();
        var running = fixture.Running!;

        var stopped = await fixture.Service.StopAsync(running.RouteId, running.SimulationId);

        Assert.True(stopped.IsSuccess);

        // KANONİK terminal durum; yeni bir durum sözcüğü uydurulmadı.
        Assert.Equal(TransportSimulationStatus.Cancelled, stopped.Value!.Status);
        Assert.Equal(running.SimulationId, stopped.Value.SimulationId);
        Assert.Equal(running.RouteId, stopped.Value.RouteId);

        // Çalıştırma artık aktif değildir: hayalet Running kalmaz.
        Assert.Null(fixture.Store.Find(running.RouteId));
        Assert.Null(fixture.Service.FindActiveLiveUpdate(running.RouteId));
    }

    [Fact]
    public async Task The_terminal_broadcast_carries_the_same_simulation_id()
    {
        await using var fixture = await Fixture.WithRunningRouteAsync();
        var running = fixture.Running!;

        var stopped = await fixture.Service.StopAsync(running.RouteId, running.SimulationId);

        /* Gözlemciler MEVCUT paylaşılan kanaldan otoriter terminal olayı alır;
           durdurma için ikinci bir kanal açılmadı. */
        var published = Assert.Single(fixture.Broadcaster.Updates);

        Assert.Equal(running.SimulationId, published.SimulationId);
        Assert.Equal(running.RouteId, published.RouteId);
        Assert.Equal(TransportSimulationStatus.Cancelled, published.Status);

        // Komutu veren istemci de gözlemcilerle AYNI gerçeği görür.
        Assert.Equal(published, stopped.Value);
    }

    /* --- 5/6/7. Yarış ve eskime koruması ----------------------------------------- */

    [Fact]
    public async Task A_wrong_simulation_id_cannot_stop_the_active_run()
    {
        await using var fixture = await Fixture.WithRunningRouteAsync();
        var running = fixture.Running!;

        var stopped = await fixture.Service.StopAsync(running.RouteId, Guid.NewGuid());

        Assert.False(stopped.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, stopped.ErrorKind);

        // Çalıştırmaya DOKUNULMADI ve hiçbir terminal olay yayınlanmadı.
        Assert.NotNull(fixture.Store.Find(running.RouteId));
        Assert.Equal(running.SimulationId, fixture.Store.Find(running.RouteId)!.SimulationId);
        Assert.Empty(fixture.Broadcaster.Updates);
    }

    [Fact]
    public async Task A_stale_simulation_id_can_never_stop_the_replacement_run()
    {
        /* FAZ 3'ÜN ASIL SENARYOSU. Rota 12: A çalışır, biter/durur, yerine B
           başlar. Hâlâ A'yı gösteren eski bir sekme "durdur" derse B — başka
           kullanıcıların canlı izlediği çalıştırma — DURMAMALIDIR. */
        await using var fixture = await Fixture.WithRunningRouteAsync();
        var first = fixture.Running!;

        Assert.True((await fixture.Service.StopAsync(first.RouteId, first.SimulationId)).IsSuccess);

        var second = await fixture.StartAsync();
        Assert.NotEqual(first.SimulationId, second.SimulationId);

        fixture.Broadcaster.Updates.Clear();

        var stale = await fixture.Service.StopAsync(first.RouteId, first.SimulationId);

        Assert.False(stale.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, stale.ErrorKind);

        // B hâlâ çalışıyor ve onun adına hiçbir terminal olay üretilmedi.
        Assert.Equal(second.SimulationId, fixture.Store.Find(first.RouteId)!.SimulationId);
        Assert.Empty(fixture.Broadcaster.Updates);
    }

    [Fact]
    public async Task A_run_belonging_to_another_route_cannot_be_stopped_through_this_route()
    {
        await using var fixture = await Fixture.WithRunningRouteAsync();
        var running = fixture.Running!;

        var otherRoute = await fixture.AddRouteAsync();
        await fixture.AddPathAsync(otherRoute);
        var other = (await fixture.Service.StartAsync(otherRoute.Id)).Value!;

        fixture.Broadcaster.Updates.Clear();

        // Doğru kimlik, YANLIŞ rota: komut reddedilir.
        var crossed = await fixture.Service.StopAsync(otherRoute.Id, running.SimulationId);

        Assert.False(crossed.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, crossed.ErrorKind);

        // İKİ çalıştırma da yerinde durur.
        Assert.Equal(running.SimulationId, fixture.Store.Find(running.RouteId)!.SimulationId);
        Assert.Equal(other.SimulationId, fixture.Store.Find(otherRoute.Id)!.SimulationId);
        Assert.Empty(fixture.Broadcaster.Updates);
    }

    /* --- 8/9. Güvenli başarısızlık ve tekrarlı komut ------------------------------ */

    [Fact]
    public async Task Stopping_a_route_with_no_active_run_fails_safely()
    {
        await using var fixture = await Fixture.WithRunningRouteAsync();
        var running = fixture.Running!;

        Assert.True((await fixture.Service.StopAsync(running.RouteId, running.SimulationId)).IsSuccess);
        fixture.Broadcaster.Updates.Clear();

        var again = await fixture.Service.StopAsync(running.RouteId, running.SimulationId);

        /* Sessizce "başarılı" DEMEZ: istemciye durdurmadığı bir şeyi
           durdurmuş gibi göstermek, ikinci bir terminal olay beklemesine yol
           açardı. */
        Assert.False(again.IsSuccess);
        Assert.Equal(ServiceErrorKind.NotFound, again.ErrorKind);
        Assert.Empty(fixture.Broadcaster.Updates);
    }

    [Fact]
    public async Task An_unknown_route_fails_before_touching_any_run()
    {
        await using var fixture = await Fixture.WithRunningRouteAsync();
        var running = fixture.Running!;

        var missing = await fixture.Service.StopAsync(routeId: 987654, running.SimulationId);

        Assert.False(missing.IsSuccess);
        Assert.Equal(ServiceErrorKind.NotFound, missing.ErrorKind);
        Assert.NotNull(fixture.Store.Find(running.RouteId));
        Assert.Empty(fixture.Broadcaster.Updates);
    }

    /* --- 12. Terminal durum diriltilemez ----------------------------------------- */

    [Fact]
    public async Task A_late_running_tick_cannot_revive_a_stopped_run()
    {
        await using var fixture = await Fixture.WithRunningRouteAsync();
        var running = fixture.Running!;

        Assert.True((await fixture.Service.StopAsync(running.RouteId, running.SimulationId)).IsSuccess);
        fixture.Broadcaster.Updates.Clear();

        /* Depo kimlik denetimlidir: durdurulmuş çalıştırmanın geç kalmış bir
           anlık görüntüsü YAZILAMAZ ve runner o tick'i sessizce düşürür. */
        Assert.False(fixture.Store.TryUpdateSnapshot(
            running.RouteId,
            running.SimulationId,
            new TransportSimulationSnapshot(new TransportSimulationPoint(31, 41), 1, 0.9, 400, DateTime.UtcNow)));

        await fixture.Runner.AdvanceAsync(DateTime.UtcNow.AddSeconds(5));

        Assert.Null(fixture.Store.Find(running.RouteId));
        Assert.Empty(fixture.Broadcaster.Updates);
    }

    /* --- 13. İç iptal kullanıcı yetkisi İSTEMEZ ----------------------------------- */

    [Fact]
    public async Task Internal_route_invalidation_still_cancels_without_the_stop_permission()
    {
        /* Sistemin kendi iptali bir KULLANICI komutu değildir: yetkilendirilmiş
           uç yolundan geçmez, kimlik taşımaz ve `transport.simulation.stop`
           İSTEMEZ. Port da bilinçle ayrıdır. */
        await using var fixture = await Fixture.WithRunningRouteAsync();
        var running = fixture.Running!;

        ITransportSimulationCanceller canceller = fixture.Runner;
        await canceller.CancelForRoutesAsync([running.RouteId]);

        Assert.Null(fixture.Store.Find(running.RouteId));

        var published = Assert.Single(fixture.Broadcaster.Updates);
        Assert.Equal(TransportSimulationStatus.Cancelled, published.Status);
        Assert.Equal(running.SimulationId, published.SimulationId);

        /* İki port AYRIDIR ve iç iptal kimlik almaz; kullanıcı komutu ise
           kimlik almadan çalışamaz. */
        var cancel = typeof(ITransportSimulationCanceller).GetMethod(nameof(ITransportSimulationCanceller.CancelForRoutesAsync))!;
        Assert.DoesNotContain(cancel.GetParameters(), parameter => parameter.ParameterType == typeof(Guid));

        var terminate = typeof(ITransportSimulationTerminator).GetMethod(nameof(ITransportSimulationTerminator.TerminateAsync))!;
        Assert.Contains(terminate.GetParameters(), parameter => parameter.ParameterType == typeof(Guid));
    }

    [Fact]
    public void The_runtime_primitive_is_free_of_authorization_and_http_concerns()
    {
        /* Yetki, yaşam döngüsü ilkelinde YAŞAMAZ: oraya konsaydı iç iptal de
           kullanıcı yetkisi ister hâle gelirdi. */
        var terminator = typeof(ITransportSimulationTerminator);

        Assert.DoesNotContain(
            terminator.GetMethods(),
            method => method.GetParameters().Any(parameter =>
                parameter.ParameterType.Name.Contains("Principal", StringComparison.Ordinal)
                || parameter.ParameterType.Name.Contains("HttpContext", StringComparison.Ordinal)
                || parameter.ParameterType.Name.Contains("User", StringComparison.Ordinal)));

        // Ve çalışma zamanı nesnesi tarayıcıya SIZMAZ: dönüş tipi yayın sözleşmesidir.
        var terminate = terminator.GetMethod(nameof(ITransportSimulationTerminator.TerminateAsync))!;
        Assert.Equal(typeof(Task<TransportSimulationLiveUpdate?>), terminate.ReturnType);
    }

    /* --- Başlatma regresyona uğramadı -------------------------------------------- */

    [Fact]
    public async Task Start_is_unchanged_and_still_uses_its_own_permission()
    {
        var start = typeof(TransportSimulationController).GetMethod(nameof(TransportSimulationController.Start))!;
        var required = Assert.Single(start.GetCustomAttributes<RequirePermissionAttribute>(true));
        Assert.Equal(PermissionCodes.TransportSimulationStart, required.PermissionCode);

        await using var fixture = await Fixture.WithRunningRouteAsync();
        var running = fixture.Running!;

        // Çalışan hatta yeniden başlatma hâlâ çakışır.
        var conflict = await fixture.Service.StartAsync(running.RouteId);
        Assert.False(conflict.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, conflict.ErrorKind);

        // Durdurduktan sonra yeniden başlatılabilir: yaşam döngüsü kapanır.
        Assert.True((await fixture.Service.StopAsync(running.RouteId, running.SimulationId)).IsSuccess);
        Assert.True((await fixture.Service.StartAsync(running.RouteId)).IsSuccess);
    }

    /* --- Yardımcılar -------------------------------------------------------------- */

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

    private sealed class Fixture : IAsyncDisposable
    {
        private const int UserId = 42;

        private Fixture(AppDbContext db)
        {
            Db = db;
            Store = new InMemoryTransportSimulationStateStore();
            Broadcaster = new RecordingBroadcaster();

            var currentUser = Substitute.For<ICurrentUserService>();
            currentUser.UserId.Returns(UserId);
            currentUser.IsAuthenticated.Returns(true);

            /* GERÇEK çalışma zamanı sahibi. Sahte bir sonlandırıcı, kendi
               uydurduğumuz davranışı doğrulardı; ölçmek istediğimiz şey
               üretimdeki atomik kimlik denetimi ve terminal yayındır. */
            Runner = new TransportSimulationRunner(
                Store,
                Broadcaster,
                new TransportSimulationOptions
                {
                    TickIntervalMilliseconds = 1_000,
                    SpeedMultiplier = 1,
                    FallbackDurationSeconds = 300
                },
                Substitute.For<ILogger<TransportSimulationRunner>>());

            Service = new TransportSimulationService(db, currentUser, Store, Runner, Runner);
        }

        public AppDbContext Db { get; }
        public InMemoryTransportSimulationStateStore Store { get; }
        public RecordingBroadcaster Broadcaster { get; }
        public TransportSimulationRunner Runner { get; }
        public TransportSimulationService Service { get; }

        /// <summary>İlk çalıştırma; <see cref="WithRunningRouteAsync"/> doldurur.</summary>
        public TransportSimulationResponse? Running { get; private set; }

        private int RouteId { get; set; }

        public static async Task<Fixture> WithRunningRouteAsync()
        {
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase($"transport-simulation-stop-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;

            var fixture = new Fixture(new AppDbContext(options));
            var route = await fixture.AddRouteAsync();
            await fixture.AddPathAsync(route);
            fixture.RouteId = route.Id;
            fixture.Running = await fixture.StartAsync();
            fixture.Broadcaster.Updates.Clear();
            return fixture;
        }

        public async Task<TransportSimulationResponse> StartAsync()
        {
            var started = await Service.StartAsync(RouteId);
            Assert.True(started.IsSuccess);
            return started.Value!;
        }

        public async Task<TransportRoute> AddRouteAsync()
        {
            var route = new TransportRoute
            {
                Name = "Hat",
                ColorHex = "#123456",
                IsActive = true,
                IsDeleted = false,
                CreatedDate = DateTime.UtcNow
            };
            Db.TransportRoutes.Add(route);
            await Db.SaveChangesAsync();
            return route;
        }

        public async Task<TransportRoutePath> AddPathAsync(TransportRoute route)
        {
            var path = new TransportRoutePath
            {
                RouteId = route.Id,
                Geometry = new LineString([new Coordinate(30, 40), new Coordinate(31, 41)]) { SRID = 4326 },
                DistanceMeters = 500,
                DurationSeconds = 300,
                Profile = "driving",
                GeneratedAt = DateTime.UtcNow,
                IsStale = false
            };
            Db.TransportRoutePaths.Add(path);
            await Db.SaveChangesAsync();
            return path;
        }

        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }
}
