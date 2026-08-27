using NetTopologySuite.Geometries;
using NetTopologySuite.Operation.Union;
using NSubstitute;
using StajProject.Application.Common;
using StajProject.Application.Geographic;
using StajProject.Application.Interfaces;
using StajProject.Application.Spatial;
using StajProject.Domain.Common;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>Konum analizinin semantik il/bölge kataloğu ve sert sınırı.</summary>
public sealed class LocationAnalysisTargetCatalogTests
{
    private const string Samsun = "TR-55";
    private const string CentralAnatolia = "IC_ANADOLU";

    [Fact]
    public async Task Explicit_province_assignment_exposes_Samsun()
    {
        var service = await RestrictedToAsync(Province(Samsun));

        var result = await service.GetAuthorizedCatalogAsync();

        Assert.Equal([Samsun], result.Value!.Provinces.Select(item => item.Key));
    }

    [Fact]
    public async Task Explicit_region_assignment_exposes_the_region()
    {
        var service = await RestrictedToAsync(Region(CentralAnatolia));

        var result = await service.GetAuthorizedCatalogAsync();

        Assert.Equal([CentralAnatolia], result.Value!.Regions.Select(item => item.Key));
    }

    [Fact]
    public async Task Region_assignment_exposes_its_catalogued_province_members()
    {
        var service = await RestrictedToAsync(Region(CentralAnatolia));
        var catalog = (await service.GetAuthorizedCatalogAsync()).Value!;

        var region = Assert.Single(catalog.Regions);
        Assert.NotEmpty(region.ProvinceKeys);
        Assert.Equal(
            region.ProvinceKeys.OrderBy(key => key),
            catalog.Provinces.Select(item => item.Key).OrderBy(key => key));
    }

    [Fact]
    public async Task Region_and_standalone_province_are_unioned_without_duplicates()
    {
        var sources = new[] { Region(CentralAnatolia), Province(Samsun), Province(Samsun) };
        var service = await RestrictedToAsync(sources);
        var catalog = (await service.GetAuthorizedCatalogAsync()).Value!;

        Assert.Contains(catalog.Provinces, item => item.Key == Samsun);
        Assert.Equal(catalog.Provinces.Count, catalog.Provinces.Select(item => item.Key).Distinct().Count());
    }

    [Fact]
    public async Task Standalone_province_does_not_expose_its_whole_region()
    {
        var service = await RestrictedToAsync(Province(Samsun));

        var catalog = (await service.GetAuthorizedCatalogAsync()).Value!;

        Assert.Empty(catalog.Regions);
    }

    [Fact]
    public async Task Unauthorized_province_key_is_rejected()
    {
        var samsun = await TargetGeometryAsync("province", Samsun);
        var service = await RestrictedToAsync(Province("TR-06"));

        var result = await service.AuthorizeTargetAsync("province", Samsun, samsun);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
    }

    [Fact]
    public async Task Unauthorized_region_key_is_rejected()
    {
        var region = await TargetGeometryAsync("region", CentralAnatolia);
        var service = await RestrictedToAsync(Province(Samsun));

        var result = await service.AuthorizeTargetAsync("region", CentralAnatolia, region);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
    }

    [Fact]
    public async Task Custom_polygon_intersection_grants_no_whole_province()
    {
        var service = await RestrictedToAsync(
            new EffectiveGeographicAreaSource(GeographicAreaSource.ManualPolygon, null));

        var catalog = (await service.GetAuthorizedCatalogAsync()).Value!;

        Assert.Empty(catalog.Provinces);
        Assert.Empty(catalog.Regions);
    }

    [Fact]
    public async Task Catalog_uses_only_the_sources_returned_by_effective_direct_override_resolution()
    {
        /* GeographicAuthorizationService doğrudan alan varsa rol satırlarını
           bu listeye koymaz. Katalog rol adına bakıp onları geri eklememeli. */
        var service = await RestrictedToAsync(Province(Samsun));
        var catalog = (await service.GetAuthorizedCatalogAsync()).Value!;

        Assert.Equal([Samsun], catalog.Provinces.Select(item => item.Key));
        Assert.DoesNotContain(catalog.Regions, item => item.Key == CentralAnatolia);
    }

    [Fact]
    public async Task Removed_or_inactive_source_absent_from_effective_rows_is_not_resurrected()
    {
        var service = await RestrictedToAsync([]);

        var catalog = (await service.GetAuthorizedCatalogAsync()).Value!;

        Assert.Empty(catalog.Provinces);
        Assert.Empty(catalog.Regions);
    }

    [Fact]
    public async Task Authorized_key_with_manipulated_geometry_is_rejected()
    {
        var samsun = await TargetGeometryAsync("province", Samsun);
        var service = await RestrictedToAsync(Province(Samsun));
        var elsewhere = samsun.Factory.CreatePolygon([
            new Coordinate(0, 0), new Coordinate(1, 0), new Coordinate(1, 1),
            new Coordinate(0, 1), new Coordinate(0, 0)]);
        elsewhere.SRID = 4326;

        var result = await service.AuthorizeTargetAsync("province", Samsun, elsewhere);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
    }

    [Fact]
    public async Task Authorized_administrative_geometry_still_must_be_covered_by_effective_scope()
    {
        var samsun = await TargetGeometryAsync("province", Samsun);
        var tiny = samsun.Factory.CreatePolygon([
            new Coordinate(35, 41), new Coordinate(35.1, 41), new Coordinate(35.1, 41.1),
            new Coordinate(35, 41.1), new Coordinate(35, 41)]);
        tiny.SRID = 4326;
        var service = Service(EffectiveGeographicAuthorization.Restricted(tiny), [Province(Samsun)]);

        var result = await service.AuthorizeTargetAsync("province", Samsun, samsun);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
    }

    private static EffectiveGeographicAreaSource Province(string key) =>
        new(GeographicAreaSource.Province, key);

    private static EffectiveGeographicAreaSource Region(string key) =>
        new(GeographicAreaSource.Region, key);

    private static async Task<LocationAnalysisTargetCatalogService> RestrictedToAsync(
        params EffectiveGeographicAreaSource[] sources)
    {
        var geometries = new List<Geometry>();
        foreach (var source in sources.Distinct())
        {
            if (source.SourceKey is null || source.SourceType is not (GeographicAreaSource.Province or GeographicAreaSource.Region))
            {
                continue;
            }

            geometries.Add(await TargetGeometryAsync(
                source.SourceType == GeographicAreaSource.Province ? "province" : "region",
                source.SourceKey));
        }

        var fallback = WktGeometryParser.Parse<Polygon>(
            "POLYGON ((35 41, 35.1 41, 35.1 41.1, 35 41.1, 35 41))").Value!;
        var allowed = geometries.Count switch
        {
            0 => fallback,
            1 => geometries[0],
            _ => UnaryUnionOp.Union(geometries)
        };
        allowed.SRID = 4326;
        return Service(EffectiveGeographicAuthorization.Restricted(allowed), sources);
    }

    private static LocationAnalysisTargetCatalogService Service(
        EffectiveGeographicAuthorization scope,
        IReadOnlyList<EffectiveGeographicAreaSource> sources)
    {
        var current = Substitute.For<ICurrentUserService>();
        current.UserId.Returns(42);
        var authorization = Substitute.For<IGeographicAuthorizationService>();
        authorization.GetEffectiveAuthorizationAsync(42, Arg.Any<CancellationToken>()).Returns(scope);
        authorization.GetEffectiveAreaSourcesAsync(42, Arg.Any<CancellationToken>()).Returns(sources);
        return new LocationAnalysisTargetCatalogService(current, authorization);
    }

    private static async Task<Geometry> TargetGeometryAsync(string type, string key)
    {
        var catalog = (await Service(EffectiveGeographicAuthorization.Unrestricted, [])
            .GetAuthorizedCatalogAsync()).Value!;
        var item = (type == "province" ? catalog.Provinces : catalog.Regions).Single(row => row.Key == key);
        var parts = item.AreaWkts
            .Select(wkt => (Geometry)WktGeometryParser.Parse<Polygon>(wkt).Value!)
            .ToList();
        var geometry = parts.Count == 1 ? parts[0] : UnaryUnionOp.Union(parts);
        geometry.SRID = 4326;
        return geometry;
    }
}
