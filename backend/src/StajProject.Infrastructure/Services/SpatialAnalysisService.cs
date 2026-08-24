using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Pois;
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

    /* POI kırılımı AYRI bir yetkiyle (poi.view) korunur ve envanter analizi
       yetkisi onu ima etmez: biri "analiz çalıştırabilir", diğeri "POI'leri
       görebilir" der. Etkin yetki hesabı burada tekrarlanmaz; kaynak Phase 2
       servisidir. */
    private readonly IEffectivePermissionService _permissions;

    public SpatialAnalysisService(
        AppDbContext dbContext,
        ICurrentUserService currentUser,
        IEffectivePermissionService permissions)
    {
        _dbContext = dbContext;
        _currentUser = currentUser;
        _permissions = permissions;
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

        /* POI'ler SAHİPLİĞE göre daraltılmaz — çizimlerin aksine ortak bir
           envanterdir ve poi.view taşıyan herkes hepsini görür. Kapı bu yüzden
           sahiplik değil YETKİdir: yetki yoksa liste boş, sayı 0 ve toplam
           POI'ler hiç yokmuş gibi hesaplanır. */
        var pois = await MatchingPoisAsync(polygon, cancellationToken);

        /* Sayılar listelerden türetilir, ayrıca sorgulanmaz: "sayı ile liste
           uyuşmuyor" durumu böylece temsil edilemez hâle gelir. */
        return ServiceResult<IntersectionAnalysisResponse>.Success(new IntersectionAnalysisResponse
        {
            TotalCount = points.Count + lines.Count + polygons.Count + pois.Count,
            PointCount = points.Count,
            LineCount = lines.Count,
            PolygonCount = polygons.Count,
            PoiCount = pois.Count,
            Points = points,
            Lines = lines,
            Polygons = polygons,
            Pois = pois
        });
    }

    /// <summary>
    /// Analiz alanıyla kesişen POI'ler.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Kesişim VERİTABANINDA hesaplanır.</b> <c>Coordinate.Intersects</c>,
    /// Npgsql tarafından <c>ST_Intersects</c>'e çevrilir ve <c>coordinate</c>
    /// kolonundaki GiST indeksi kullanılabilir. Tüm POI'leri belleğe (ya da
    /// tarayıcıya) çekip nokta-poligon testi yazmak, aynı cevabı indekssiz ve
    /// tablonun tamamını taşıyarak üretirdi.
    /// </para>
    /// <para>
    /// <b>Aktiflik/silinmişlik filtresi global query filter'dan gelir</b> —
    /// <c>IgnoreQueryFilters</c> BİLİNÇLİ olarak kullanılmaz, dolayısıyla pasif
    /// ve soft-delete edilmiş POI'ler sayıma hiç girmez.
    /// </para>
    /// </remarks>
    private async Task<List<AnalysisPoiResponse>> MatchingPoisAsync(
        Polygon analysisArea,
        CancellationToken cancellationToken)
    {
        var currentUserId = _currentUser.UserId;

        if (currentUserId is null
            || !await _permissions.HasPermissionAsync(currentUserId.Value, PermissionCodes.PoiView, cancellationToken))
        {
            // Sızıntı yok: ne sayı, ne liste, ne de toplamda bir iz.
            return [];
        }

        var rows = await _dbContext.Pois
            .AsNoTracking()
            .Where(poi => poi.Coordinate.Intersects(analysisArea))
            .OrderBy(poi => poi.Id)
            .Select(poi => new
            {
                poi.Id,
                poi.Name,
                poi.CategoryId,
                Longitude = poi.Coordinate.X,
                Latitude = poi.Coordinate.Y
            })
            .ToListAsync(cancellationToken);

        if (rows.Count == 0)
        {
            // Eşleşme yoksa kategori ağacını hiç okumaya gerek yok.
            return [];
        }

        /* Kategori adları TEK sorguda okunur ve yol aynı saf yardımcıyla
           kurulur (PoiCategoryHierarchy): harita listesindeki "Yeme-İçme /
           Kafe" ile analiz sonucundaki yol ikinci bir tanım değil, aynı
           tanımdır. */
        var categories = await _dbContext.PoiCategories
            .AsNoTracking()
            .Select(category => new { category.Id, category.Name, category.ParentId })
            .ToListAsync(cancellationToken);

        var nodes = categories.ToDictionary(
            node => node.Id,
            node => new PoiCategoryHierarchy.Node(node.Id, node.Name, node.ParentId));

        return
        [
            .. rows.Select(row => new AnalysisPoiResponse
            {
                Id = row.Id,
                Name = row.Name,
                CategoryName = nodes.TryGetValue(row.CategoryId, out var node) ? node.Name : string.Empty,
                CategoryPath = PoiCategoryHierarchy.BuildPath(nodes, row.CategoryId),
                Longitude = row.Longitude,
                Latitude = row.Latitude
            })
        ];
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
