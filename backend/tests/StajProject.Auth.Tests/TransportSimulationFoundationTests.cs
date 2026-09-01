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
/// Ulaşım simülasyonu temeli (Faz 1): yetki, başlatma kuralları ve sunucu
/// otoriteli anlık görüntü.
/// </summary>
/// <remarks>
/// <para>
/// Bu faz HAREKET üretmez. Kanıtlanan şey, bir simülasyonun yalnızca gerçekten
/// işletilebilir bir güzergah üzerinde ve yalnızca bir kez başlatılabildiği;
/// başlangıç durumunun sunucuda %0'da doğduğu ve tutulan durumun hiçbir EF
/// nesnesine bağlı olmadığıdır.
/// </para>
/// </remarks>
public sealed class TransportSimulationFoundationTests
{
    private const string Code = "transport.simulation.start";

    /* --- Yetki ------------------------------------------------------------------ */

    [Fact]
    public void The_canonical_code_is_transport_simulation_start()
    {
        /* Kod DEĞİŞTİRİLEMEZ: permissions.code satırı ve ona bağlı tüm grant'lar
           bu değere göre eşleşir. Sabitten türetilmeyen literal iddia, sessiz
           bir yeniden adlandırmayı yakalar. */
        Assert.Equal(Code, PermissionCodes.TransportSimulationStart);
        Assert.StartsWith("transport.", PermissionCodes.TransportSimulationStart, StringComparison.Ordinal);
    }

    [Fact]
    public void The_permission_is_declared_in_the_catalog_with_transport_metadata()
    {
        var definition = Single(PermissionCodes.TransportSimulationStart);

        Assert.Equal(PermissionCategories.Transport, definition.Category);
        Assert.Equal("Ulaşım Simülasyonu Başlatma", definition.Name);

        // Mevcut ulaşım yetkilerinin ARDINA girer; hiçbiri yeniden numaralanmaz.
        Assert.True(definition.SortOrder > Single(PermissionCodes.TransportRouteReorder).SortOrder);
        Assert.Equal(
            PermissionCatalog.All.Count,
            PermissionCatalog.All.Select(permission => permission.SortOrder).Distinct().Count());
    }

    [Fact]
    public void The_permission_is_not_implied_by_viewing_or_route_editing()
    {
        /* Asıl iddia bir AYRIMDIR: izlemek (transport.view) ve güzergahı
           yeniden hesaplamak (transport.route.update) simülasyon başlatma
           yetkisi DEĞİLDİR. Ulaşım Kullanıcısı ikisinden birine sahip olsa
           bile hattı çalıştıramaz. */
        var transportUser = RolePermissionDefaults.For(GisRoles.TransportUser);

        Assert.Contains(PermissionCodes.TransportView, transportUser);
        Assert.DoesNotContain(PermissionCodes.TransportSimulationStart, transportUser);

        Assert.NotEqual(PermissionCodes.TransportSimulationStart, PermissionCodes.TransportView);
        Assert.NotEqual(PermissionCodes.TransportSimulationStart, PermissionCodes.TransportRouteUpdate);
    }

    [Fact]
    public void Administrator_and_transport_operator_receive_it_from_the_default_matrix()
    {
        Assert.Contains(
            PermissionCodes.TransportSimulationStart,
            RolePermissionDefaults.For(GisRoles.Administrator));
        Assert.Contains(
            PermissionCodes.TransportSimulationStart,
            RolePermissionDefaults.For(GisRoles.TransportOperator));
    }

    [Fact]
    public void An_already_provisioned_installation_receives_it_through_a_catalog_expansion()
    {
        /* Asıl regresyon riski burada: RolePermissionDefaults YALNIZCA hiç
           yetkisi olmayan rolleri doldurur. Mevcut kurulumlarda Administrator
           ve Ulaşım Operatörü çoktan provision edilmiştir; genişleme olmasa
           yeni kod onlara HİÇ ulaşmazdı. */
        foreach (var roleName in (string[])[GisRoles.Administrator, GisRoles.TransportOperator])
        {
            Assert.Contains(
                PermissionCodes.TransportSimulationStart,
                ExpansionCodesOf(roleName));

            // Dağılım matrisle birebir aynıdır; genişleme yeni bir profil tanımlamaz.
            Assert.Contains(PermissionCodes.TransportSimulationStart, RolePermissionDefaults.For(roleName));
        }

        // Görüntüleyen roller genişlemeden PAY ALMAZ.
        Assert.DoesNotContain(
            PermissionCodes.TransportSimulationStart,
            ExpansionCodesOf(GisRoles.TransportUser));
        Assert.DoesNotContain(
            PermissionCodes.TransportSimulationStart,
            ExpansionCodesOf(GisRoles.Viewer));

        // Genişlemeler yalnızca kanonik rollere dokunur; özel roller dışarıdadır.
        Assert.All(
            RolePermissionExpansions.All,
            expansion => Assert.Contains(expansion.RoleName, RoleCatalog.Canonical));
    }

    /* --- Uç sözleşmesi ---------------------------------------------------------- */

    [Fact]
    public void The_endpoints_declare_the_expected_routes_and_permissions()
    {
        AssertEndpoint(
            nameof(TransportSimulationController.Start),
            typeof(HttpPostAttribute),
            "routes/{routeId:int}/start",
            PermissionCodes.TransportSimulationStart);

        // İzleme mevcut görüntüleme modelini kullanır; yeni bir okuma yetkisi uydurulmaz.
        AssertEndpoint(
            nameof(TransportSimulationController.GetActive),
            typeof(HttpGetAttribute),
            "routes/{routeId:int}",
            PermissionCodes.TransportView);

        var route = Assert.Single(
            typeof(TransportSimulationController).GetCustomAttributes(typeof(RouteAttribute), true).Cast<RouteAttribute>());
        Assert.Equal("api/transport/simulations", route.Template);
    }

    [Fact]
    public async Task Missing_simulation_start_permission_fails_closed()
    {
        var permissions = Substitute.For<IEffectivePermissionService>();
        permissions
            .HasPermissionAsync(42, PermissionCodes.TransportSimulationStart, Arg.Any<CancellationToken>())
            .Returns(false);

        var context = HandlerContext(PermissionCodes.TransportSimulationStart);

        await new PermissionAuthorizationHandler(permissions).HandleAsync(context);

        Assert.False(context.HasSucceeded);
    }

    [Fact]
    public async Task A_custom_role_carrying_the_effective_code_satisfies_the_start_policy()
    {
        /* Karar rol ADINA değil, ETKİN YETKİ koduna bakar: kodu taşıyan özel
           bir rol de geçer. Bu, "isAdmin/rol adı kestirmesi yok" iddiasının
           testidir. */
        var permissions = Substitute.For<IEffectivePermissionService>();
        permissions
            .HasPermissionAsync(42, PermissionCodes.TransportSimulationStart, Arg.Any<CancellationToken>())
            .Returns(true);

        var context = HandlerContext(PermissionCodes.TransportSimulationStart);

        await new PermissionAuthorizationHandler(permissions).HandleAsync(context);

        Assert.True(context.HasSucceeded);
    }

    /* --- Başlatma --------------------------------------------------------------- */

    [Fact]
    public async Task Start_creates_a_server_snapshot_at_zero_progress_on_the_persisted_path()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        await fixture.AddPathAsync(route, geometry: Geometry((30, 40), (31, 41), (32, 42)));

        var result = await fixture.Service.StartAsync(route.Id);

        Assert.True(result.IsSuccess);
        var response = result.Value!;
        Assert.NotEqual(Guid.Empty, response.SimulationId);
        Assert.Equal(route.Id, response.RouteId);
        Assert.Equal(route.Name, response.RouteName);
        Assert.Equal(route.ColorHex, response.RouteColorHex);
        Assert.Equal(Fixture.UserId, response.StartedByUserId);

        // Sunucu otoriteli başlangıç: %0, ilk köşe, kat edilen mesafe sıfır.
        Assert.Equal(0, response.ProgressRatio);
        Assert.Equal(0, response.DistanceCoveredMeters);
        Assert.Equal(0, response.SegmentIndex);
        Assert.Equal(30, response.Longitude);
        Assert.Equal(40, response.Latitude);
        Assert.Equal(3, response.PointCount);

        // Kalıcı yolun ölçümleri olduğu gibi taşınır; yeniden hesaplanmaz.
        Assert.Equal(500, response.DistanceMeters);
        Assert.Equal(50, response.DurationSeconds);
        Assert.Equal("driving", response.Profile);

        var stored = fixture.State.Find(route.Id);
        Assert.NotNull(stored);
        Assert.Equal(response.SimulationId, stored!.SimulationId);
        Assert.Equal(3, stored.Path.Points.Count);
    }

    [Fact]
    public async Task Start_rejects_a_route_without_a_persisted_path()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();

        var result = await fixture.Service.StartAsync(route.Id);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.NotFound, result.ErrorKind);
        Assert.Null(fixture.State.Find(route.Id));
    }

    [Fact]
    public async Task Start_rejects_a_stale_path_without_regenerating_it()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        await fixture.AddPathAsync(route, stale: true);

        var result = await fixture.Service.StartAsync(route.Id);

        /* Çakışma (409): istek kusursuz, sistemin durumu uygun değil. Doğru
           cevap güzergahı sessizce yeniden hesaplamak DEĞİL, reddetmektir —
           hangi geometrinin işletildiği belirsiz kalmamalıdır. */
        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, result.ErrorKind);
        Assert.Null(fixture.State.Find(route.Id));

        // Bayat kayıt olduğu gibi durur; simülasyon kalıcı veriye dokunmaz.
        var stored = await fixture.Db.TransportRoutePaths.AsNoTracking().SingleAsync();
        Assert.True(stored.IsStale);
    }

    [Fact]
    public async Task Start_rejects_a_deleted_or_inactive_route()
    {
        await using var fixture = Fixture.Create();
        var deleted = await fixture.AddRouteAsync(isDeleted: true);
        var inactive = await fixture.AddRouteAsync(isActive: false);
        await fixture.AddPathAsync(deleted);
        await fixture.AddPathAsync(inactive);

        foreach (var route in (TransportRoute[])[deleted, inactive])
        {
            var result = await fixture.Service.StartAsync(route.Id);

            Assert.False(result.IsSuccess);
            Assert.Equal(ServiceErrorKind.NotFound, result.ErrorKind);
            Assert.Null(fixture.State.Find(route.Id));
        }

        var missing = await fixture.Service.StartAsync(9_999);
        Assert.Equal(ServiceErrorKind.NotFound, missing.ErrorKind);
    }

    [Fact]
    public async Task Start_requires_an_authenticated_identity()
    {
        await using var fixture = Fixture.Create(userId: null);
        var route = await fixture.AddRouteAsync();
        await fixture.AddPathAsync(route);

        var result = await fixture.Service.StartAsync(route.Id);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
        Assert.Null(fixture.State.Find(route.Id));
    }

    [Fact]
    public async Task A_second_start_on_the_same_route_is_rejected_as_a_conflict()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        await fixture.AddPathAsync(route);

        var first = await fixture.Service.StartAsync(route.Id);
        var second = await fixture.Service.StartAsync(route.Id);

        Assert.True(first.IsSuccess);
        Assert.False(second.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, second.ErrorKind);

        // Çalışan simülasyon HÂLÂ ilkidir; ikinci istek onu ezmemiştir.
        Assert.Equal(first.Value!.SimulationId, fixture.State.Find(route.Id)!.SimulationId);
    }

    [Fact]
    public async Task Another_route_can_run_at_the_same_time()
    {
        await using var fixture = Fixture.Create();
        var first = await fixture.AddRouteAsync();
        var second = await fixture.AddRouteAsync();
        await fixture.AddPathAsync(first);
        await fixture.AddPathAsync(second);

        // Tekillik ROTA başınadır, sistem geneli değil.
        Assert.True((await fixture.Service.StartAsync(first.Id)).IsSuccess);
        Assert.True((await fixture.Service.StartAsync(second.Id)).IsSuccess);
    }

    [Fact]
    public void Concurrent_starts_produce_exactly_one_active_simulation()
    {
        /* Kural servis katmanındaki bir "önce oku–sonra yaz" denetimiyle değil,
           deponun atomik işlemiyle sağlanır. */
        var store = new InMemoryTransportSimulationStateStore();
        var candidates = Enumerable.Range(0, 32).Select(_ => Simulation(routeId: 7)).ToArray();

        var winners = 0;
        Parallel.ForEach(candidates, candidate =>
        {
            if (store.TryStart(candidate))
            {
                Interlocked.Increment(ref winners);
            }
        });

        Assert.Equal(1, winners);
        Assert.NotNull(store.Find(7));
    }

    /* --- Durum / anlık görüntü --------------------------------------------------- */

    [Fact]
    public async Task Status_reports_the_active_snapshot_and_404_when_nothing_runs()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        await fixture.AddPathAsync(route);

        var before = await fixture.Service.GetActiveAsync(route.Id);
        Assert.False(before.IsSuccess);
        Assert.Equal(ServiceErrorKind.NotFound, before.ErrorKind);

        var started = await fixture.Service.StartAsync(route.Id);
        var after = await fixture.Service.GetActiveAsync(route.Id);

        Assert.True(after.IsSuccess);
        Assert.Equal(started.Value!.SimulationId, after.Value!.SimulationId);
        Assert.Equal(0, after.Value.ProgressRatio);

        var unknownRoute = await fixture.Service.GetActiveAsync(9_999);
        Assert.Equal(ServiceErrorKind.NotFound, unknownRoute.ErrorKind);
    }

    [Fact]
    public async Task Status_reflects_a_snapshot_written_by_the_runner_surface()
    {
        await using var fixture = Fixture.Create();
        var route = await fixture.AddRouteAsync();
        await fixture.AddPathAsync(route, geometry: Geometry((30, 40), (31, 41)));
        var started = (await fixture.Service.StartAsync(route.Id)).Value!;

        var updated = fixture.State.TryUpdateSnapshot(
            route.Id,
            started.SimulationId,
            new TransportSimulationSnapshot(
                new TransportSimulationPoint(30.5, 40.5), SegmentIndex: 0, ProgressRatio: 0.5,
                DistanceCoveredMeters: 250, CapturedAt: DateTime.UtcNow));

        Assert.True(updated);
        var status = await fixture.Service.GetActiveAsync(route.Id);
        Assert.Equal(0.5, status.Value!.ProgressRatio);
        Assert.Equal(30.5, status.Value.Longitude);
        Assert.Equal(started.SimulationId, status.Value.SimulationId);

        // Başka bir çalıştırmanın kimliğiyle yazma, aktif durumu EZEMEZ.
        Assert.False(fixture.State.TryUpdateSnapshot(
            route.Id,
            Guid.NewGuid(),
            new TransportSimulationSnapshot(
                new TransportSimulationPoint(0, 0), 0, 1, 500, DateTime.UtcNow)));
        Assert.Equal(0.5, fixture.State.Find(route.Id)!.Snapshot.ProgressRatio);

        // Durdurma da aynı kimlik denetimine tabidir.
        Assert.False(fixture.State.TryStop(route.Id, Guid.NewGuid()));
        Assert.True(fixture.State.TryStop(route.Id, started.SimulationId));
        Assert.Null(fixture.State.Find(route.Id));
    }

    [Fact]
    public async Task The_active_state_survives_the_disposal_of_the_request_scope()
    {
        /* Depo yalnızca DEĞİŞMEZ veri tutar: hiçbir EF varlığı ya da DbContext
           orada yaşamaz. Başlatan kapsam kapandıktan sonra durum hâlâ eksiksiz
           okunabiliyorsa, singleton durum takip edilen bir nesneye bağlı
           değildir. */
        var store = new InMemoryTransportSimulationStateStore();
        int routeId;
        Guid simulationId;

        await using (var fixture = Fixture.Create(store))
        {
            var route = await fixture.AddRouteAsync();
            await fixture.AddPathAsync(route, geometry: Geometry((30, 40), (31, 41)));
            routeId = route.Id;
            simulationId = (await fixture.Service.StartAsync(route.Id)).Value!.SimulationId;
        }

        var retained = store.Find(routeId);

        Assert.NotNull(retained);
        Assert.Equal(simulationId, retained!.SimulationId);
        Assert.Equal([(30d, 40d), (31d, 41d)],
            retained.Path.Points.Select(point => (point.Longitude, point.Latitude)));
        Assert.Equal(30, retained.Snapshot.Position.Longitude);
    }

    /* --- Yardımcılar ------------------------------------------------------------- */

    private static PermissionCatalog.Definition Single(string code) =>
        Assert.Single(PermissionCatalog.All, permission => permission.Code == code);

    private static string[] ExpansionCodesOf(string roleName) =>
    [
        .. RolePermissionExpansions.All
            .Where(expansion => expansion.RoleName == roleName)
            .SelectMany(expansion => expansion.PermissionCodes)
            .Distinct(StringComparer.Ordinal)
    ];

    private static AuthorizationHandlerContext HandlerContext(string permissionCode)
    {
        var requirement = new PermissionRequirement(permissionCode);
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, "42")],
            "test"));
        return new AuthorizationHandlerContext([requirement], principal, resource: null);
    }

    private static void AssertEndpoint(string methodName, Type httpAttributeType, string template, string permission)
    {
        var method = typeof(TransportSimulationController).GetMethod(methodName)!;
        var route = Assert.Single(method.GetCustomAttributes(httpAttributeType, true).Cast<HttpMethodAttribute>());
        var required = Assert.Single(method.GetCustomAttributes<RequirePermissionAttribute>(true));
        Assert.Equal(template, route.Template);
        Assert.Equal(permission, required.PermissionCode);
    }

    private static LineString Geometry(params (double X, double Y)[] coordinates) =>
        new([.. coordinates.Select(coordinate => new Coordinate(coordinate.X, coordinate.Y))]) { SRID = 4326 };

    private static ActiveTransportSimulation Simulation(int routeId)
    {
        var now = DateTime.UtcNow;
        var points = new TransportSimulationPoint[] { new(30, 40), new(31, 41) };
        return new ActiveTransportSimulation(
            Guid.NewGuid(), routeId, "Hat", "#123456", 42, now,
            new TransportSimulationPath(points, 500, 50, "driving", now),
            new TransportSimulationSnapshot(points[0], 0, 0, 0, now));
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
        public const int UserId = 42;

        private Fixture(AppDbContext db, ITransportSimulationStateStore state, int? userId)
        {
            Db = db;
            State = state;
            var currentUser = Substitute.For<ICurrentUserService>();
            currentUser.UserId.Returns(userId);
            currentUser.IsAuthenticated.Returns(userId is not null);

            /* Sonlandırma için SAHTE değil, GERÇEK çalışma zamanı sahibi
               kullanılır: durdurmanın ölçülen davranışı (kimlik denetimi,
               terminal yayın, durumdan kaldırma) tam olarak orada yaşıyor.
               Sahte bir terminatör, kendi uydurduğumuz davranışı doğrulardı. */
            Broadcaster = new RecordingBroadcaster();
            Runner = new TransportSimulationRunner(
                state,
                Broadcaster,
                new TransportSimulationOptions
                {
                    TickIntervalMilliseconds = 1_000,
                    SpeedMultiplier = 1,
                    FallbackDurationSeconds = 300
                },
                Substitute.For<ILogger<TransportSimulationRunner>>());

            Service = new TransportSimulationService(db, currentUser, state, Runner);
        }

        public AppDbContext Db { get; }
        public ITransportSimulationStateStore State { get; }
        public RecordingBroadcaster Broadcaster { get; }
        public TransportSimulationRunner Runner { get; }
        public TransportSimulationService Service { get; }

        public static Fixture Create(int? userId = UserId) =>
            Create(new InMemoryTransportSimulationStateStore(), userId);

        public static Fixture Create(ITransportSimulationStateStore state, int? userId = UserId)
        {
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase($"transport-simulation-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;
            return new Fixture(new AppDbContext(options), state, userId);
        }

        public async Task<TransportRoute> AddRouteAsync(bool isActive = true, bool isDeleted = false)
        {
            var route = new TransportRoute
            {
                Name = "Hat",
                ColorHex = "#123456",
                IsActive = isActive,
                IsDeleted = isDeleted,
                CreatedDate = DateTime.UtcNow
            };
            Db.TransportRoutes.Add(route);
            await Db.SaveChangesAsync();
            return route;
        }

        public async Task<TransportRoutePath> AddPathAsync(
            TransportRoute route,
            bool stale = false,
            LineString? geometry = null)
        {
            var now = DateTime.UtcNow;
            var path = new TransportRoutePath
            {
                Route = route,
                RouteId = route.Id,
                Geometry = geometry ?? Geometry((30, 40), (31, 41)),
                DistanceMeters = 500,
                DurationSeconds = 50,
                Profile = "driving",
                GeneratedAt = now,
                IsStale = stale,
                ModifiedDate = now
            };
            Db.TransportRoutePaths.Add(path);
            await Db.SaveChangesAsync();
            return path;
        }

        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }
}
