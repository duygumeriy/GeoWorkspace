using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using NetTopologySuite.Geometries;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Auth.Tests;

public class SmartTransportFoundationTests
{
    private static readonly string[] TransportPermissions =
    [
        PermissionCodes.TransportView,
        PermissionCodes.TransportStopCreate,
        PermissionCodes.TransportStopUpdate,
        PermissionCodes.TransportStopDelete,
        PermissionCodes.TransportStopRestore,
        PermissionCodes.TransportRouteCreate,
        PermissionCodes.TransportRouteUpdate,
        PermissionCodes.TransportRouteDelete,
        PermissionCodes.TransportRouteRestore,
        PermissionCodes.TransportRouteReorder,
        PermissionCodes.TransportSimulationStart,

        /* Durdurma, Yolculuk Merkezi Faz 1'de AYRI bir kod olarak eklendi:
           bir hattı herkes için durdurmak, onu başlatmakla aynı yetenek
           değildir ve `transport.view` onu ima etmez. */
        PermissionCodes.TransportSimulationStop
    ];

    private static readonly string[] StopPermissions =
    [
        PermissionCodes.TransportStopCreate,
        PermissionCodes.TransportStopUpdate,
        PermissionCodes.TransportStopDelete,
        PermissionCodes.TransportStopRestore
    ];

    private static readonly string[] RoutePermissions =
    [
        PermissionCodes.TransportRouteCreate,
        PermissionCodes.TransportRouteUpdate,
        PermissionCodes.TransportRouteDelete,
        PermissionCodes.TransportRouteRestore,
        PermissionCodes.TransportRouteReorder
    ];

    private static readonly string[] PoiWritePermissions =
    [
        PermissionCodes.PoiCreate,
        PermissionCodes.PoiUpdate,
        PermissionCodes.PoiDelete,
        PermissionCodes.PoiManage,
        PermissionCodes.PoiCategoriesManage
    ];

    private static readonly string[] DrawingWritePermissions =
    [
        PermissionCodes.DrawingsPointCreate,
        PermissionCodes.DrawingsLineCreate,
        PermissionCodes.DrawingsPolygonCreate,
        PermissionCodes.DrawingsMetadataUpdate,
        PermissionCodes.DrawingsGeometryUpdate,
        PermissionCodes.DrawingsStyleUpdate,
        PermissionCodes.DrawingsDelete,
        PermissionCodes.DrawingsRestore
    ];

    [Fact]
    public void All_transport_permission_codes_exist()
    {
        Assert.Equal(
            [
                "transport.view",
                "transport.stop.create",
                "transport.stop.update",
                "transport.stop.delete",
                "transport.stop.restore",
                "transport.route.create",
                "transport.route.update",
                "transport.route.delete",
                "transport.route.restore",
                "transport.route.reorder",
                "transport.simulation.start",
                "transport.simulation.stop"
            ],
            TransportPermissions);

        Assert.Equal(
            TransportPermissions.OrderBy(code => code, StringComparer.Ordinal),
            PermissionCatalog.All
                .Where(permission => permission.Code.StartsWith("transport.", StringComparison.Ordinal))
                .Select(permission => permission.Code)
                .OrderBy(code => code, StringComparer.Ordinal));
    }

    [Fact]
    public void Transport_user_default_grants_are_read_only()
    {
        var grants = RolePermissionDefaults.For(GisRoles.TransportUser);

        Assert.Contains(PermissionCodes.TransportView, grants);
        Assert.Contains(PermissionCodes.PoiView, grants);
        Assert.DoesNotContain(grants, code => TransportPermissions.Skip(1).Contains(code, StringComparer.Ordinal));
        Assert.DoesNotContain(grants, code => PoiWritePermissions.Contains(code, StringComparer.Ordinal));
        Assert.DoesNotContain(grants, code => DrawingWritePermissions.Contains(code, StringComparer.Ordinal));
    }

    [Fact]
    public void Transport_roles_can_open_the_map_they_are_meant_to_read()
    {
        /* Rolün tanımı "ulaşım ağı ve POI verisini salt okuyan kullanıcı"dır ve
           o veri yalnızca haritada görünür: map.view olmadan rolün taşıdığı iki
           yetkinin de karşılığı olmazdı. Diğer okuyucu profillerin tabanı da
           map.view'dir. */
        Assert.Contains(PermissionCodes.MapView, RolePermissionDefaults.For(GisRoles.TransportUser));
        Assert.Contains(PermissionCodes.MapView, RolePermissionDefaults.For(GisRoles.Viewer));

        // Operatör profili kullanıcı profilinin üzerine kurulduğu için devralır.
        Assert.Contains(PermissionCodes.MapView, RolePermissionDefaults.For(GisRoles.TransportOperator));

        /* Harita GÖRÜNTÜLEME bir yönetim yetkisi değildir: yazma yetkileri
           hâlâ dışarıdadır ve yeni hiçbir yetki eşlik etmez. */
        var user = RolePermissionDefaults.For(GisRoles.TransportUser);
        Assert.Equal(
            new[]
            {
                PermissionCodes.MapView,
                PermissionCodes.PoiView,
                PermissionCodes.TransportView,

                /* Kişisel yolculuk (Yolculuk Merkezi Faz 1) profile EKLENDİ ve
                   yine bir yönetim yetkisi DEĞİLDİR: kullanıcı yalnızca kendi
                   yolculuğunu planlar ve oynatır. Hattı herkes için başlatmak
                   ya da durdurmak hâlâ dışarıdadır. */
                PermissionCodes.JourneyUse
            }.OrderBy(code => code, StringComparer.Ordinal),
            user.OrderBy(code => code, StringComparer.Ordinal));

        // Paylaşılan yaşam döngüsü kodları bu profile GİRMEZ.
        Assert.DoesNotContain(PermissionCodes.TransportSimulationStart, user);
        Assert.DoesNotContain(PermissionCodes.TransportSimulationStop, user);
    }

    [Fact]
    public void An_already_provisioned_transport_role_receives_map_view_through_the_expansion()
    {
        /* Matris YALNIZCA hiç yetkisi olmayan rollere uygulanır; mevcut
           kurulumlarda bu roller çoktan provision edilmiştir ve düzeltme onlara
           başka türlü hiç ulaşmazdı. Genişleme mekanizması tam da bunun için
           vardır (bkz. RolePermissionExpansions). */
        foreach (var role in (string[])[GisRoles.TransportUser, GisRoles.TransportOperator])
        {
            var expansion = RolePermissionExpansions.All
                .Where(item => item.RoleName == role)
                .SelectMany(item => item.PermissionCodes)
                .ToArray();

            Assert.Contains(PermissionCodes.MapView, expansion);

            // Yan etki olarak HİÇBİR yönetim yetkisi dağıtılmaz.
            Assert.DoesNotContain(expansion, code => RoutePermissions.Contains(code, StringComparer.Ordinal));
            Assert.DoesNotContain(expansion, code => PoiWritePermissions.Contains(code, StringComparer.Ordinal));
            Assert.DoesNotContain(expansion, code => DrawingWritePermissions.Contains(code, StringComparer.Ordinal));
        }

        // Ulaşım kullanıcısı yalnızca haritayı açar; simülasyon başlatamaz.
        Assert.DoesNotContain(
            PermissionCodes.TransportSimulationStart,
            RolePermissionExpansions.All
                .Where(item => item.RoleName == GisRoles.TransportUser)
                .SelectMany(item => item.PermissionCodes));

        // Genişlemeler yalnızca kanonik rollere dokunur.
        Assert.All(
            RolePermissionExpansions.All,
            expansion => Assert.Contains(expansion.RoleName, RoleCatalog.Canonical));
    }

    [Fact]
    public void Transport_operator_default_grants_allow_only_stop_management()
    {
        var grants = RolePermissionDefaults.For(GisRoles.TransportOperator);

        Assert.Contains(PermissionCodes.TransportView, grants);
        Assert.All(StopPermissions, permission => Assert.Contains(permission, grants));

        /* Simülasyonu BAŞLATMAK operatörün işidir; hattın güzergahını yeniden
           tanımlamak değil. Rota yetkileri hâlâ dışarıdadır. */
        Assert.Contains(PermissionCodes.TransportSimulationStart, grants);
        Assert.DoesNotContain(grants, code => RoutePermissions.Contains(code, StringComparer.Ordinal));
        Assert.Contains(PermissionCodes.PoiView, grants);
        Assert.DoesNotContain(grants, code => PoiWritePermissions.Contains(code, StringComparer.Ordinal));
        Assert.DoesNotContain(grants, code => DrawingWritePermissions.Contains(code, StringComparer.Ordinal));
    }

    [Fact]
    public void Administrator_receives_transport_permissions_through_all_permissions()
    {
        var administrator = RolePermissionDefaults.For(GisRoles.Administrator);

        Assert.Equal(
            PermissionCatalog.AllCodes.OrderBy(code => code, StringComparer.Ordinal),
            administrator.OrderBy(code => code, StringComparer.Ordinal));
        Assert.All(TransportPermissions, permission => Assert.Contains(permission, administrator));
    }

    [Fact]
    public void Transport_route_and_stop_have_the_expected_ef_model()
    {
        var model = Model();
        var route = model.FindEntityType(typeof(TransportRoute))!;
        var stop = model.FindEntityType(typeof(TransportStop))!;

        var foreignKey = Assert.Single(stop.GetForeignKeys().Where(key => key.PrincipalEntityType == route));
        Assert.Same(route, foreignKey.PrincipalEntityType);
        Assert.Equal(nameof(TransportStop.RouteId), Assert.Single(foreignKey.Properties).Name);
        Assert.False(stop.FindProperty(nameof(TransportStop.RouteId))!.IsNullable);
        Assert.Equal(DeleteBehavior.Restrict, foreignKey.DeleteBehavior);
        Assert.Equal(nameof(TransportRoute.Stops), foreignKey.PrincipalToDependent!.Name);

        var ownerForeignKey = Assert.Single(stop.GetForeignKeys().Where(key => key.PrincipalEntityType.ClrType == typeof(User)));
        Assert.Equal(nameof(TransportStop.UserId), Assert.Single(ownerForeignKey.Properties).Name);
        Assert.True(stop.FindProperty(nameof(TransportStop.UserId))!.IsNullable);
        Assert.Equal(DeleteBehavior.Restrict, ownerForeignKey.DeleteBehavior);

        var coordinate = stop.FindProperty(nameof(TransportStop.Coordinate))!;
        Assert.False(coordinate.IsNullable);
        Assert.Equal(typeof(Point), coordinate.ClrType);
        Assert.Equal("geometry(Point,4326)", coordinate.GetColumnType());

        Assert.Contains(
            stop.GetIndexes(),
            index => IndexMatches(index, nameof(TransportStop.RouteId)));
        Assert.Contains(
            stop.GetIndexes(),
            index => IndexMatches(index, nameof(TransportStop.RouteId), nameof(TransportStop.SequenceOrder))
                && !index.IsUnique);
        Assert.Contains(
            stop.GetIndexes(),
            index => IndexMatches(index, nameof(TransportStop.Coordinate)));

        Assert.NotNull(route.GetQueryFilter());
        Assert.NotNull(stop.GetQueryFilter());

        var zeroStopRoute = new TransportRoute();
        Assert.Empty(zeroStopRoute.Stops);
        Assert.Empty(route.GetForeignKeys());
    }

    private static IModel Model()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(
                "Host=localhost;Database=model-only;Username=none;Password=none",
                npgsql => npgsql.UseNetTopologySuite())
            .Options;

        using var context = new AppDbContext(options);
        return context.Model;
    }

    private static bool IndexMatches(IIndex index, params string[] properties) =>
        index.Properties.Select(property => property.Name).SequenceEqual(properties, StringComparer.Ordinal);
}
