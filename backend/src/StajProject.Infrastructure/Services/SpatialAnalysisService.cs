using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Spatial;
using StajProject.Domain.Common;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// Kesişim analizini PostGIS üzerinde çalıştırır.
/// <para>
/// <b>Veri kümesi: yalnızca çağıran kullanıcının envanteri.</b> Sorgular
/// <see cref="DrawingScopes.InventoryScope"/> üzerinden yürür ve sahiplik
/// yüklemi SQL'e iner. Analiz ile görünürlük aynı sınırdadır: haritasında 1
/// çizgi ve 1 poligon olan bir kullanıcı, o alanla kesişen 2 çizgi 3 poligon
/// göremez. Başkalarının kayıtları ne sayıya ne listeye girer — sayı da bir
/// bilgidir ve başkasının envanterinin büyüklüğünü sızdırmamalıdır.
/// </para>
/// <para>
/// Kasıtlı olarak <c>ST_Contains</c> değil <c>ST_Intersects</c> kullanılır:
/// ödev kriteri "objelerin tamamen kapsanması gerekmez, ufak bir kesişim dahi
/// yeterlidir" olduğu için sınıra değen kayıtlar da sayılır. Tam kapsanma
/// yalnızca <see cref="InventoryAnalysisItemResponse.IntersectionType"/> ile
/// <b>anlatılır</b>, eşleşme ölçütü olarak kullanılmaz.
/// </para>
/// <para>
/// Sorgu sırası önemlidir: sahiplik ve <c>Intersects</c> yüklemleri
/// <c>ToListAsync</c>'ten ÖNCE uygulanır, dolayısıyla veritabanından yalnızca
/// eşleşen satırlar döner ve geometry kolonlarındaki GiST indeksleri
/// kullanılabilir. Tablo belleğe çekilip sonra süzülmez.
/// </para>
/// </summary>
public class SpatialAnalysisService : ISpatialAnalysisService
{
    private readonly AppDbContext _dbContext;
    private readonly ICurrentUserService _currentUser;

    public SpatialAnalysisService(AppDbContext dbContext, ICurrentUserService currentUser)
    {
        _dbContext = dbContext;
        _currentUser = currentUser;
    }

    public async Task<ServiceResult<IntersectionAnalysisResponse>> CountIntersectionsAsync(
        IntersectionAnalysisRequest request,
        CancellationToken cancellationToken)
    {
        // Çizim endpoint'leriyle aynı parser: tip, SRID, boşluk, koordinat aralığı
        // ve kendi kendini kesen (bowtie) halka kontrolü tek yerde durur. Geçersiz
        // poligon burada 400 ile döner ve PostGIS'e hiç gitmez.
        var parsed = WktGeometryParser.Parse<Polygon>(request?.Wkt);

        if (!parsed.IsSuccess)
        {
            return ServiceResult<IntersectionAnalysisResponse>.Failure(parsed.Error!);
        }

        /* Kapsam doğrulanmış kimlikten okunur; istek gövdesinden ASLA. Kimlik
           belirlenemiyorsa (yapılandırma hatası) boş sonuç döner: kimliksiz bir
           istek başkasının envanterini saymaktansa hiçbir şey saymamalıdır. */
        var currentUserId = _currentUser.UserId;

        if (currentUserId is null)
        {
            return ServiceResult<IntersectionAnalysisResponse>.Success(new IntersectionAnalysisResponse());
        }

        var polygon = parsed.Value!;

        var points = await MatchesAsync<Domain.Entities.PointFeature, Point>(
            polygon, currentUserId.Value, DrawingKind.Point, null, cancellationToken);

        var lines = await MatchesAsync<Domain.Entities.LineFeature, LineString>(
            polygon, currentUserId.Value, DrawingKind.Line, null, cancellationToken);

        // Yeni kaydedilen poligon kendi analizini çalıştırdığında kendisiyle
        // kesişmesi matematiksel olarak kaçınılmazdır; sayımdan düşülür.
        var polygons = await MatchesAsync<Domain.Entities.PolygonFeature, Polygon>(
            polygon, currentUserId.Value, DrawingKind.Polygon, request!.ExcludePolygonId, cancellationToken);

        /* Sayılar listelerden türetilir, ayrıca sorgulanmaz: "sayı ile liste
           uyuşmuyor" durumu böylece temsil edilemez hâle gelir. */
        return ServiceResult<IntersectionAnalysisResponse>.Success(new IntersectionAnalysisResponse
        {
            TotalCount = points.Count + lines.Count + polygons.Count,
            PointCount = points.Count,
            LineCount = lines.Count,
            PolygonCount = polygons.Count,
            Points = points,
            Lines = lines,
            Polygons = polygons
        });
    }

    /// <summary>
    /// Bir çizim tablosundaki eşleşmeleri getirir.
    /// </summary>
    /// <param name="excludeId">
    /// Sayımdan düşülecek kayıt (analizin öznesi olan poligon). Kapsam zaten
    /// çağıranın kendi envanteri olduğu için yabancı bir kimlik gönderilmesi
    /// etkisizdir.
    /// </param>
    private async Task<List<InventoryAnalysisItemResponse>> MatchesAsync<TEntity, TGeometry>(
        Polygon analysisArea,
        int currentUserId,
        DrawingKind kind,
        int? excludeId,
        CancellationToken cancellationToken)
        where TEntity : class, IDrawingFeature<TGeometry>
        where TGeometry : Geometry
    {
        var query = _dbContext.Set<TEntity>()
            .AsNoTracking()
            // Sahiplik + kesişim: ikisi de SQL'de, ToListAsync'ten önce.
            .InventoryScope(currentUserId)
            .Where(entity => entity.Geometry.Intersects(analysisArea));

        if (excludeId is { } excluded)
        {
            query = query.Where(entity => EF.Property<int>(entity, nameof(IStyledDrawingFeature.Id)) != excluded);
        }

        var matches = await query
            .OrderBy(entity => EF.Property<int>(entity, nameof(IStyledDrawingFeature.Id)))
            .ToListAsync(cancellationToken);

        return matches.Select(entity => ToItem<TEntity, TGeometry>(entity, kind, analysisArea)).ToList();
    }

    private static InventoryAnalysisItemResponse ToItem<TEntity, TGeometry>(
        TEntity entity,
        DrawingKind kind,
        Polygon analysisArea)
        where TEntity : class, IDrawingFeature<TGeometry>
        where TGeometry : Geometry
    {
        var style = DrawingStyleReader.Read(entity, kind);

        /* Sınıflandırma eşleşen (yani zaten küçük) küme üzerinde bellekte
           yapılır. Covers, Contains'ten farklı olarak sınırdaki geometry'i de
           "içeride" sayar; kenarı analiz alanının kenarına oturan bir kayıt
           kullanıcı için "tamamen içeride"dir, "kısmi" değil. */
        var fullyInside = analysisArea.Covers(entity.Geometry);

        return new InventoryAnalysisItemResponse
        {
            Id = entity.Id,
            DrawingType = DrawingTypeName(kind),
            Name = entity.Name,
            Description = entity.Description,
            Category = entity.Category,
            // Kopyalanır: response nesnesi entity'nin listesini paylaşmamalı.
            Tags = [.. entity.Tags ?? []],
            Style = new DrawingStyleDto
            {
                StrokeColor = style.StrokeColor,
                StrokeWidth = style.StrokeWidth,
                FillColor = style.FillColor,
                FillOpacity = style.FillOpacity,
                PointRadius = style.PointRadius,
                LineStyle = style.LineStyle
            },
            CreatedDate = entity.CreatedDate,
            ModifiedDate = entity.ModifiedDate,
            IntersectionType = fullyInside ? IntersectionTypes.FullyInside : IntersectionTypes.Partial
        };
    }

    /// <summary>Frontend'in tür kimlikleriyle birebir aynı yazım.</summary>
    private static string DrawingTypeName(DrawingKind kind) => kind switch
    {
        DrawingKind.Point => "point",
        DrawingKind.Line => "line",
        _ => "polygon"
    };
}
