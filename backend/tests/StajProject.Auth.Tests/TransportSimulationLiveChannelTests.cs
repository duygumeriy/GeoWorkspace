using System.Globalization;
using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using NSubstitute;
using StajProject.Api.Hubs;
using StajProject.Api.Simulation;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Simulation;
using StajProject.Domain.Common;

namespace StajProject.Auth.Tests;

/// <summary>
/// Canlı kanal: grup sözleşmesi, hub yetkilendirmesi ve geç katılım.
/// </summary>
/// <remarks>
/// Hub'ın işi taşıma ve erişim kararıdır; hareket hesabı runner'ın işidir
/// (bkz. <see cref="TransportSimulationRunnerTests"/>). Buradaki testler bu
/// ayrımı da sabitler.
/// </remarks>
public sealed class TransportSimulationLiveChannelTests
{
    private const int RouteId = 7;

    /* --- Grup adlandırma sözleşmesi --------------------------------------------- */

    [Fact]
    public void The_group_name_is_deterministic_and_route_scoped()
    {
        /* Grup adı İKİ yerde kullanılır (hub katılımı ve yayın). İkisinin
           farklı ad üretmesi, yayının sessizce hiç kimseye ulaşmaması demekti;
           bu yüzden ad tek bir yerden türetilir ve burada çivilenir. */
        Assert.Equal("transport-simulation-route-7", TransportSimulationHubContract.GroupFor(7));
        Assert.Equal("transport-simulation-route-7", TransportSimulationHubContract.GroupFor(7));
        Assert.NotEqual(
            TransportSimulationHubContract.GroupFor(7),
            TransportSimulationHubContract.GroupFor(8));
    }

    [Fact]
    public void The_hub_contract_constants_are_stable()
    {
        Assert.Equal("/hubs/transport-simulation", TransportSimulationHubContract.Path);
        Assert.Equal("SimulationUpdated", TransportSimulationHubContract.UpdateMethod);
    }

    [Fact]
    public async Task A_broadcast_reaches_only_the_route_group()
    {
        var clients = Substitute.For<IHubClients>();
        var proxy = Substitute.For<IClientProxy>();
        clients.Group(Arg.Any<string>()).Returns(proxy);
        var hubContext = Substitute.For<IHubContext<TransportSimulationHub>>();
        hubContext.Clients.Returns(clients);

        var update = Update(TransportSimulationStatus.Running);

        await new SignalRTransportSimulationBroadcaster(hubContext).PublishAsync(update);

        clients.Received(1).Group(TransportSimulationHubContract.GroupFor(RouteId));
        clients.DidNotReceive().Group(TransportSimulationHubContract.GroupFor(RouteId + 1));

        // Tüm istemcilere yayın YAPILMAZ.
        _ = clients.DidNotReceive().All;
        await proxy.Received(1).SendCoreAsync(
            TransportSimulationHubContract.UpdateMethod,
            Arg.Is<object?[]>(args => args.Length == 1 && ReferenceEquals(args[0], update)),
            Arg.Any<CancellationToken>());
    }

    /* --- Kimlik doğrulama ve yetki ---------------------------------------------- */

    [Fact]
    public void The_hub_requires_authentication()
    {
        Assert.Single(typeof(TransportSimulationHub).GetCustomAttributes<AuthorizeAttribute>(true));
    }

    [Fact]
    public async Task Joining_without_the_view_permission_is_rejected_and_no_group_is_joined()
    {
        var fixture = Fixture.Create(hasViewPermission: false);

        var exception = await Assert.ThrowsAsync<HubException>(() => fixture.Hub.JoinRoute(RouteId));

        // İç ayrıntı sızmaz; yalnızca yetkisizlik bildirilir.
        Assert.DoesNotContain("Exception", exception.Message, StringComparison.OrdinalIgnoreCase);

        await fixture.Groups.DidNotReceive().AddToGroupAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task The_decision_uses_the_effective_permission_service_with_the_canonical_code()
    {
        /* Rol adı, kullanıcı adı ya da IsAdmin kestirmesi YOKTUR: hub, mevcut
           etkin yetki motoruna kanonik KODU sorar. Kodu taşıyan özel bir rol de
           bu yüzden geçer. */
        var fixture = Fixture.Create();

        await fixture.Hub.JoinRoute(RouteId);

        await fixture.Permissions.Received(1).HasPermissionAsync(
            42, PermissionCodes.TransportView, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task An_unreadable_identity_fails_closed_without_consulting_anything()
    {
        var fixture = Fixture.Create(userId: null);

        await Assert.ThrowsAsync<HubException>(() => fixture.Hub.JoinRoute(RouteId));

        await fixture.Permissions.DidNotReceive().HasPermissionAsync(
            Arg.Any<int>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
        await fixture.Groups.DidNotReceive().AddToGroupAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-3)]
    public async Task An_invalid_route_id_is_rejected(int routeId)
    {
        var fixture = Fixture.Create();

        await Assert.ThrowsAsync<HubException>(() => fixture.Hub.JoinRoute(routeId));
        await Assert.ThrowsAsync<HubException>(() => fixture.Hub.LeaveRoute(routeId));
    }

    /* --- Katılım / ayrılma ------------------------------------------------------ */

    [Fact]
    public async Task Joining_adds_the_connection_to_the_route_group()
    {
        var fixture = Fixture.Create();

        await fixture.Hub.JoinRoute(RouteId);

        await fixture.Groups.Received(1).AddToGroupAsync(
            Fixture.ConnectionId,
            TransportSimulationHubContract.GroupFor(RouteId),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Leaving_removes_the_connection_from_the_same_group()
    {
        var fixture = Fixture.Create();

        await fixture.Hub.LeaveRoute(RouteId);

        await fixture.Groups.Received(1).RemoveFromGroupAsync(
            Fixture.ConnectionId,
            TransportSimulationHubContract.GroupFor(RouteId),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task A_late_joiner_immediately_receives_the_current_snapshot()
    {
        /* Faz 3'ün geç katılım / yeniden bağlanma desteği buna dayanır: istemci
           bir sonraki tick'i BEKLEMEDEN aracı doğru yerde çizebilmelidir. */
        var fixture = Fixture.Create();
        var snapshot = Update(TransportSimulationStatus.Running);
        fixture.Simulations.FindActiveLiveUpdate(RouteId).Returns(snapshot);

        var result = await fixture.Hub.JoinRoute(RouteId);

        Assert.Same(snapshot, result);
    }

    [Fact]
    public async Task Joining_a_route_with_no_active_simulation_returns_null()
    {
        var fixture = Fixture.Create();
        fixture.Simulations.FindActiveLiveUpdate(RouteId).Returns((TransportSimulationLiveUpdate?)null);

        Assert.Null(await fixture.Hub.JoinRoute(RouteId));
    }

    [Fact]
    public async Task The_hub_does_not_move_the_vehicle_itself()
    {
        /* Hub'ın hareketle ilgili tek yeteneği, hazır anlık görüntüyü OKUMAKTIR.
           Servis çağrısı yalnızca bu okumadır; başlatma/durdurma gibi iş
           akışları hub üzerinden çalıştırılamaz. */
        var fixture = Fixture.Create();

        await fixture.Hub.JoinRoute(RouteId);

        fixture.Simulations.Received(1).FindActiveLiveUpdate(RouteId);
        await fixture.Simulations.DidNotReceive().StartAsync(Arg.Any<int>(), Arg.Any<CancellationToken>());
        await fixture.Simulations.DidNotReceive().GetActiveAsync(Arg.Any<int>(), Arg.Any<CancellationToken>());
    }

    /* --- Yayın sözleşmesi ------------------------------------------------------- */

    [Fact]
    public void The_live_update_exposes_only_what_the_client_needs()
    {
        var properties = typeof(TransportSimulationLiveUpdate)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(property => property.Name)
            .Where(name => name != "EqualityContract")
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();

        /* Ham geometri, OSRM adresleri, kullanıcı kimliği ve EF alanları
           bilinçli olarak DIŞARIDADIR.

           Faz 5 bu kümeye İKİ hafif SAYIL ekledi ve yalnızca ikisini: hangi
           manevrada olunduğu ve sonrakine ne kadar kaldığı. İkisi de her
           tick'te DEĞİŞİR, dolayısıyla canlı kanala aittir. */
        Assert.Equal(
            [
                "CurrentStepSequence",
                "DistanceToNextManeuverMeters",
                "Latitude",
                "Longitude",
                "ProgressPercent",
                "RouteId",
                "SimulationId",
                "Status",
                "UpdatedAtUtc"
            ],
            properties);
    }

    [Fact]
    public void The_live_update_never_broadcasts_the_static_navigation_step_list()
    {
        /* ASIL SINIR BUDUR ve Faz 5'te önemi arttı: manevra LİSTESİ güzergahın
           ömrü boyunca SABİTTİR. Onu saniyede bir, her gözlemciye yeniden
           göndermek, hiç değişmeyen bir veriyi canlı kanalın yüküne çevirirdi.
           Liste OKUMA yolunda (başlatma/durum) bir kez verilir; canlı akış
           yalnızca DEĞİŞEN sırayı taşır.

           Ölçü ada değil TİPE bakar: adı ne olursa olsun, sözleşmeye bir
           koleksiyon girdiği anda bu test düşer. */
        var payloadTypes = typeof(TransportSimulationLiveUpdate)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(property => property.Name != "EqualityContract")
            .Select(property => property.PropertyType)
            .ToArray();

        Assert.All(payloadTypes, type =>
        {
            var effective = Nullable.GetUnderlyingType(type) ?? type;

            // Yalnızca hafif SAYILLAR: sayı, enum, Guid, tarih.
            Assert.True(
                effective.IsValueType,
                $"canlı yayın sözleşmesine referans tipi girdi: {effective.Name}");

            Assert.False(
                typeof(System.Collections.IEnumerable).IsAssignableFrom(effective),
                $"canlı yayın sözleşmesine koleksiyon girdi: {effective.Name}");
        });

        /* Ve statik/ağır veri ADIYLA da aranır: adım listesi, geometri, ham
           motor yanıtı ya da kalıcı varlık sözleşmeye giremez. */
        var names = typeof(TransportSimulationLiveUpdate)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(property => property.Name)
            .ToArray();

        foreach (var forbidden in new[] { "NavigationSteps", "Steps", "Maneuvers", "Geometry" })
        {
            Assert.DoesNotContain(names, name => name.Contains(forbidden, StringComparison.Ordinal));
        }

        /* Buna karşılık OKUMA yanıtı listeyi TAŞIR: ayrım tam olarak budur ve
           iki sözleşmenin ayrı kalmasının nedeni de odur. */
        Assert.NotNull(typeof(TransportSimulationResponse).GetProperty("NavigationSteps"));
    }

    [Fact]
    public void The_live_update_reports_percent_and_clamps_the_ratio()
    {
        var simulation = Simulation(progressRatio: 0.25);

        var update = TransportSimulationLiveUpdate.From(simulation, TransportSimulationStatus.Running);

        Assert.Equal(25, update.ProgressPercent, 6);
        Assert.Equal(TransportSimulationStatus.Running, update.Status);
        Assert.Equal(simulation.SimulationId, update.SimulationId);
        Assert.Equal(simulation.Snapshot.CapturedAt, update.UpdatedAtUtc);

        Assert.Equal(100, TransportSimulationLiveUpdate
            .From(Simulation(progressRatio: 3), TransportSimulationStatus.Completed).ProgressPercent);
        Assert.Equal(0, TransportSimulationLiveUpdate
            .From(Simulation(progressRatio: -2), TransportSimulationStatus.Running).ProgressPercent);
    }

    private static ActiveTransportSimulation Simulation(double progressRatio)
    {
        var now = new DateTime(2026, 8, 31, 10, 0, 0, DateTimeKind.Utc);
        var points = new TransportSimulationPoint[] { new(30, 40), new(31, 41) };

        return new ActiveTransportSimulation(
            Guid.NewGuid(), RouteId, "Hat", "#123456", 42, now,
            new TransportSimulationPath(points, 1_000, 100, "driving", now),
            new TransportSimulationSnapshot(points[0], 0, progressRatio, 0, now));
    }

    private static TransportSimulationLiveUpdate Update(TransportSimulationStatus status) =>
        new(Guid.NewGuid(), RouteId, status, 30, 40, 25, DateTime.UtcNow);

    private sealed class Fixture
    {
        public const string ConnectionId = "connection-1";

        private Fixture(
            IEffectivePermissionService permissions,
            ITransportSimulationService simulations,
            IGroupManager groups,
            HubCallerContext context)
        {
            Permissions = permissions;
            Simulations = simulations;
            Groups = groups;
            Hub = new TransportSimulationHub(permissions, simulations)
            {
                Context = context,
                Groups = groups
            };
        }

        public IEffectivePermissionService Permissions { get; }
        public ITransportSimulationService Simulations { get; }
        public IGroupManager Groups { get; }
        public TransportSimulationHub Hub { get; }

        public static Fixture Create(bool hasViewPermission = true, int? userId = 42)
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

            return new Fixture(
                permissions,
                Substitute.For<ITransportSimulationService>(),
                Substitute.For<IGroupManager>(),
                context);
        }
    }
}
