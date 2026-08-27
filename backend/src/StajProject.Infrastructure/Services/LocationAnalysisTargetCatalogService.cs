using System.Globalization;
using System.Text.Json;
using NetTopologySuite.Geometries;
using NetTopologySuite.Operation.Union;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Spatial;
using StajProject.Domain.Common;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// Kaydedilmiş il/bölge kaynak kimliklerini uygulamayla paketlenen kanonik
/// Türkiye idari veri kümesiyle eşleştirir.
/// </summary>
public sealed class LocationAnalysisTargetCatalogService : ILocationAnalysisTargetCatalogService
{
    internal const string ProvinceTargetType = "province";
    internal const string RegionTargetType = "region";

    private static readonly Lazy<Catalog> Data = new(LoadCatalog);

    private readonly ICurrentUserService _currentUser;
    private readonly IGeographicAuthorizationService _authorization;

    public LocationAnalysisTargetCatalogService(
        ICurrentUserService currentUser,
        IGeographicAuthorizationService authorization)
    {
        _currentUser = currentUser;
        _authorization = authorization;
    }

    public async Task<ServiceResult<LocationAnalysisTargetCatalogResponse>> GetAuthorizedCatalogAsync(
        CancellationToken cancellationToken = default)
    {
        var context = await ResolveContextAsync(cancellationToken);
        if (!context.IsSuccess)
        {
            return ServiceResult<LocationAnalysisTargetCatalogResponse>.Failure(context.Error!);
        }

        var value = context.Value!;
        return ServiceResult<LocationAnalysisTargetCatalogResponse>.Success(new LocationAnalysisTargetCatalogResponse
        {
            IsRestricted = value.Scope.IsRestricted,
            Regions = Data.Value.Regions
                .Where(region => value.AllowedRegionKeys.Contains(region.Key))
                .Select(ToResponse)
                .ToList(),
            Provinces = Data.Value.Provinces
                .Where(province => value.AllowedProvinceKeys.Contains(province.Key))
                .Select(ToResponse)
                .ToList()
        });
    }

    public async Task<ServiceResult<bool>> AuthorizeTargetAsync(
        string targetType,
        string targetKey,
        Geometry submittedTarget,
        CancellationToken cancellationToken = default)
    {
        var context = await ResolveContextAsync(cancellationToken);
        if (!context.IsSuccess)
        {
            return ServiceResult<bool>.Failure(context.Error!);
        }

        var value = context.Value!;
        var item = targetType switch
        {
            ProvinceTargetType => Data.Value.ProvincesByKey.GetValueOrDefault(targetKey),
            RegionTargetType => Data.Value.RegionsByKey.GetValueOrDefault(targetKey),
            _ => null
        };
        var keyAllowed = targetType switch
        {
            ProvinceTargetType => value.AllowedProvinceKeys.Contains(targetKey),
            RegionTargetType => value.AllowedRegionKeys.Contains(targetKey),
            _ => false
        };

        if (item is null || !keyAllowed)
        {
            return Forbidden();
        }

        Geometry authoritative;
        try
        {
            authoritative = item.Geometry.Value;
            if (!authoritative.EqualsTopologically(submittedTarget))
            {
                return Forbidden();
            }
        }
        catch (TopologyException)
        {
            return Forbidden();
        }

        /* Kaynak kimliği yalnız kataloğa girişi açar. Son karar yine
           saklanan etkin geometriye karşı Covers'tır; eski/stale bir
           SourceKey yeni katalog geometrisiyle yetkiyi genişletemez. */
        return value.Scope.Allows(authoritative)
            ? ServiceResult<bool>.Success(true)
            : Forbidden();
    }

    private async Task<ServiceResult<AuthorizationContext>> ResolveContextAsync(
        CancellationToken cancellationToken)
    {
        var userId = _currentUser.UserId;
        if (userId is null)
        {
            return ServiceResult<AuthorizationContext>.Failure("Oturum bulunamadı.");
        }

        var scope = await _authorization.GetEffectiveAuthorizationAsync(userId.Value, cancellationToken);
        if (!scope.IsRestricted)
        {
            return ServiceResult<AuthorizationContext>.Success(new AuthorizationContext(
                scope,
                Data.Value.RegionsByKey.Keys.ToHashSet(StringComparer.Ordinal),
                Data.Value.ProvincesByKey.Keys.ToHashSet(StringComparer.Ordinal)));
        }

        var sources = await _authorization.GetEffectiveAreaSourcesAsync(userId.Value, cancellationToken);
        var regionKeys = sources
            .Where(source => source.SourceType == GeographicAreaSource.Region && source.SourceKey is not null)
            .Select(source => source.SourceKey!)
            .Where(Data.Value.RegionsByKey.ContainsKey)
            .ToHashSet(StringComparer.Ordinal);
        var provinceKeys = sources
            .Where(source => source.SourceType == GeographicAreaSource.Province && source.SourceKey is not null)
            .Select(source => source.SourceKey!)
            .Where(Data.Value.ProvincesByKey.ContainsKey)
            .ToHashSet(StringComparer.Ordinal);

        foreach (var regionKey in regionKeys)
        {
            provinceKeys.UnionWith(Data.Value.RegionsByKey[regionKey].ProvinceCodes);
        }

        return ServiceResult<AuthorizationContext>.Success(
            new AuthorizationContext(scope, regionKeys, provinceKeys));
    }

    private static LocationAnalysisAdministrativeTargetResponse ToResponse(CatalogItem item) => new()
    {
        Key = item.Key,
        Name = item.Name,
        AreaWkts = [.. item.AreaWkts],
        ProvinceKeys = [.. item.ProvinceCodes]
    };

    private static ServiceResult<bool> Forbidden() => ServiceResult<bool>.Forbidden(
        "Seçilen idari hedef coğrafi yetki alanınızın dışında.");

    private static Catalog LoadCatalog()
    {
        using var stream = typeof(LocationAnalysisTargetCatalogService).Assembly
            .GetManifestResourceStream("StajProject.Infrastructure.Data.turkeyProvinces.json")
            ?? throw new InvalidOperationException("Türkiye idari coğrafya kataloğu bulunamadı.");
        var raw = JsonSerializer.Deserialize<RawCatalog>(stream, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        }) ?? throw new InvalidOperationException("Türkiye idari coğrafya kataloğu okunamadı.");

        var provinces = raw.Provinces
            .Select(row => CatalogItem.Create(row.Code, row.Name, row.Polygons, []))
            .ToList();
        var regions = raw.Regions
            .Select(row => CatalogItem.Create(row.Key, row.Name, row.Polygons, row.ProvinceCodes))
            .ToList();
        return new Catalog(provinces, regions);
    }

    private sealed record AuthorizationContext(
        StajProject.Application.Geographic.EffectiveGeographicAuthorization Scope,
        HashSet<string> AllowedRegionKeys,
        HashSet<string> AllowedProvinceKeys);

    private sealed class Catalog
    {
        public Catalog(List<CatalogItem> provinces, List<CatalogItem> regions)
        {
            Provinces = provinces;
            Regions = regions;
            ProvincesByKey = provinces.ToDictionary(item => item.Key, StringComparer.Ordinal);
            RegionsByKey = regions.ToDictionary(item => item.Key, StringComparer.Ordinal);
        }

        public List<CatalogItem> Provinces { get; }
        public List<CatalogItem> Regions { get; }
        public Dictionary<string, CatalogItem> ProvincesByKey { get; }
        public Dictionary<string, CatalogItem> RegionsByKey { get; }
    }

    private sealed class CatalogItem
    {
        private CatalogItem(string key, string name, List<string> wkts, IReadOnlyList<string> provinceCodes)
        {
            Key = key;
            Name = name;
            AreaWkts = wkts;
            ProvinceCodes = provinceCodes;
            Geometry = new Lazy<Geometry>(() =>
            {
                var parts = wkts.Select(wkt => WktGeometryParser.Parse<Polygon>(wkt).Value!).Cast<Geometry>().ToList();
                var geometry = parts.Count == 1 ? parts[0] : UnaryUnionOp.Union(parts);
                geometry.SRID = WktGeometryParser.Srid4326;
                return geometry;
            });
        }

        public string Key { get; }
        public string Name { get; }
        public List<string> AreaWkts { get; }
        public IReadOnlyList<string> ProvinceCodes { get; }
        public Lazy<Geometry> Geometry { get; }

        public static CatalogItem Create(
            string key,
            string name,
            double[][][][] polygons,
            IReadOnlyList<string> provinceCodes) =>
            new(key, name, polygons.Select(ToWkt).ToList(), provinceCodes);

        private static string ToWkt(double[][][] rings) =>
            $"POLYGON ({string.Join(", ", rings.Select(ring => $"({string.Join(", ", ring.Select(point => $"{point[0].ToString(CultureInfo.InvariantCulture)} {point[1].ToString(CultureInfo.InvariantCulture)}"))})"))})";
    }

    private sealed class RawCatalog
    {
        public RawCatalog() { }

        public List<RawProvince> Provinces { get; set; } = [];
        public List<RawRegion> Regions { get; set; } = [];
    }

    private sealed class RawProvince
    {
        public RawProvince() { }

        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public double[][][][] Polygons { get; set; } = [];
    }

    private sealed class RawRegion
    {
        public RawRegion() { }

        public string Key { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public List<string> ProvinceCodes { get; set; } = [];
        public double[][][][] Polygons { get; set; } = [];
    }
}
