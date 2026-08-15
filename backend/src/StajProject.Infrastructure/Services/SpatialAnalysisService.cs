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
/// <para>
/// <b>Veri kümesi.</b> Sorgular <see cref="DrawingScopes.InventoryScope"/>
/// üzerinden yürür: analiz <b>paylaşılan envanter</b> kümesine bakar, çağıranın
/// kendi çizimlerine değil. Haritanın kullandığı kullanıcı bazlı kapsam
/// (<see cref="DrawingScopes.UserMapScope"/>) buraya <b>bilinçli olarak</b>
/// uygulanmaz; uygulansaydı "bu alan kaç envanter kaydına değiyor" sorusunun
/// cevabı kullanıcıdan kullanıcıya değişir ve önceki ödevin davranışı bozulurdu.
/// </para>
/// <para>
/// Bu, veri sızıntısı değildir: uçtan yalnızca <b>sayılar</b> döner
/// (<see cref="IntersectionAnalysisResponse"/>), hiçbir zaman çizim satırı,
/// geometry'si, adı veya sahibi dönmez.
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

        /* Kendi kendini kesen (bowtie) bir halka PostGIS tarafında
           TopologyException'a (500) yol açardı. Bu kontrol artık
           WktGeometryParser içindedir — kayıt yolu da aynı kuralı uyguladığı
           için tek yerde durur ve burada tekrarlanmaz: geçersiz poligon zaten
           yukarıdaki Parse çağrısında 400 ile geri döner. */
        var polygon = parsed.Value!;

        /* InventoryScope: sahiplik filtresi YOK. Bu çağrılar paylaşılan envanteri
           sayar; harita sorgusunun UserMapScope'u buraya taşınmamalıdır. */
        var pointCount = await _dbContext.Points
            .InventoryScope()
            .CountAsync(entity => entity.Geometry.Intersects(polygon), cancellationToken);

        var lineCount = await _dbContext.Lines
            .InventoryScope()
            .CountAsync(entity => entity.Geometry.Intersects(polygon), cancellationToken);

        var polygonQuery = _dbContext.Polygons
            .InventoryScope()
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
