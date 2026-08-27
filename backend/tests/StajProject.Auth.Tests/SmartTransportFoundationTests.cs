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
        PermissionCodes.TransportRouteReorder
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
                "transport.route.reorder"
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
    public void Transport_operator_default_grants_allow_only_stop_management()
    {
        var grants = RolePermissionDefaults.For(GisRoles.TransportOperator);

        Assert.Contains(PermissionCodes.TransportView, grants);
        Assert.All(StopPermissions, permission => Assert.Contains(permission, grants));
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
