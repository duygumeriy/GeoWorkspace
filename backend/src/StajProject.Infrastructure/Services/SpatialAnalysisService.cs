using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Spatial;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// Kesişim analizini PostGIS üzerinde çalıştırır.
/// <para>
/// <c>geometry.Intersects(polygon)</c> ifadesi Npgsql.NetTopologySuite
/// tarafından <c>ST_Intersects</c>'e çevrilir ve <c>Count</c> ile birlikte tek
/// bir <c>SELECT count(*)</c> sorgusuna iner — hiçbir satır belleğe alınmaz,
/// dolayısıyla geometry kolonlarındaki GiST indeksleri kullanılabilir.
/// </para>
/// <para>
/// Kasıtlı olarak <c>ST_Contains</c> değil <c>ST_Intersects</c> kullanılır:
/// ödev kriteri "objelerin tamamen kapsanması gerekmez, ufak bir kesişim dahi
/// yeterlidir" olduğu için sınıra değen kayıtlar da sayılmalıdır.
/// </para>
/// </summary>
public class SpatialAnalysisService : ISpatialAnalysisService
{
    private readonly AppDbContext _dbContext;

    public SpatialAnalysisService(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<ServiceResult<IntersectionAnalysisResponse>> CountIntersectionsAsync(
        IntersectionAnalysisRequest request,
        CancellationToken cancellationToken)
    {
        // Çizim endpoint'leriyle aynı parser: tip, SRID, boşluk ve koordinat
        // aralığı kontrolleri tek yerde durur, burada tekrar yazılmaz.
        var parsed = WktGeometryParser.Parse<Polygon>(request?.Wkt);

        if (!parsed.IsSuccess)
        {
            return ServiceResult<IntersectionAnalysisResponse>.Failure(parsed.Error!);
        }

        var polygon = parsed.Value!;

        // Kendi kendini kesen (bowtie) bir halka PostGIS tarafında
        // TopologyException'a yol açar; 500 yerine anlaşılır bir 400 döndürülür.
        if (!polygon.IsValid)
        {
            return ServiceResult<IntersectionAnalysisResponse>.Failure(
                "Geçersiz poligon: kenarları kendisiyle kesişiyor. Lütfen alanı yeniden çizin.");
        }

        var pointCount = await _dbContext.Points
            .CountAsync(entity => entity.Geometry.Intersects(polygon), cancellationToken);

        var lineCount = await _dbContext.Lines
            .CountAsync(entity => entity.Geometry.Intersects(polygon), cancellationToken);

        var polygonQuery = _dbContext.Polygons
            .Where(entity => entity.Geometry.Intersects(polygon));

        // Yeni kaydedilen poligon kendi analizini çalıştırdığında kendisiyle
        // kesişmesi matematiksel olarak kaçınılmazdır; sayımdan düşülür.
        if (request!.ExcludePolygonId is { } excludedId)
        {
            polygonQuery = polygonQuery.Where(entity => entity.Id != excludedId);
        }

        var polygonCount = await polygonQuery.CountAsync(cancellationToken);

        return ServiceResult<IntersectionAnalysisResponse>.Success(new IntersectionAnalysisResponse
        {
            TotalCount = pointCount + lineCount + polygonCount,
            PointCount = pointCount,
            LineCount = lineCount,
            PolygonCount = polygonCount
        });
    }
}
