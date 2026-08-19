using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO;
using StajProject.Application.Bulk;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Drawings;
using StajProject.Application.Geographic;
using StajProject.Application.Interfaces;
using StajProject.Application.Spatial;
using StajProject.Application.Style;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// WKT tabanlı çizim kayıtlarını EF Core üzerinden tbl_point / tbl_line /
/// tbl_polygon tablolarına yazar, okur, stilini günceller ve siler.
/// Elle SQL kullanılmaz.
/// </summary>
public class DrawingService : IDrawingService
{
    private static readonly WKTWriter WktWriter = new();

    /// <summary>Yetkisiz mutation denemelerinde dönen tek mesaj.</summary>
    private const string ForbiddenMessage =
        "Bu çizim üzerinde işlem yapma yetkiniz yok. Yalnızca kendi çizimlerinizi düzenleyebilir veya silebilirsiniz.";

    private const string BulkForbiddenMessage =
        "Seçimde size ait olmayan çizimler var. Hiçbir kayıt değiştirilmedi.";

    private const string RestoreForbiddenMessage =
        "Geri alınmak istenen çizimlerin bir kısmı size ait değil. Hiçbir kayıt geri alınmadı.";

    /// <summary>
    /// Coğrafi yetki alanı dışına çizim denemesinde dönen mesaj.
    /// </summary>
    /// <remarks>
    /// İzin verilen alanın kendisi BİLİNÇLİ olarak paylaşılmaz: hata mesajı,
    /// yetkisi olmayan bir çağırana sınırı ikili aramayla haritalama imkânı
    /// vermemelidir. Alanını öğrenmek isteyen kullanıcı için ayrı ve
    /// yetkilendirilmiş bir yol vardır.
    /// </remarks>
    private const string OutsideAreaMessage =
        "Bu alanda çizim yapma yetkiniz bulunmuyor.";

    /// <summary>
    /// "Geometri değişmedi" sayılan azami sapma, DERECE cinsinden.
    /// </summary>
    /// <remarks>
    /// Geometri istemciye 4326 → 3857 → 4326 yolundan gidip geldiği için son
    /// basamaklarda kayan nokta gürültüsü taşır; sıfır toleransla değişmemiş
    /// bir geometri pratikte hiç tanınamazdı. 1e-9 derece ekvatorda milimetrenin
    /// onda biri mertebesindedir — gürültüyü yutar, gerçek bir taşımayı asla
    /// gizleyemez.
    /// </remarks>
    private const double UnchangedGeometryTolerance = 1e-9;

    private readonly AppDbContext _dbContext;
    private readonly ICurrentUserService _currentUser;
    private readonly IDrawingAuthorizationService _drawingAuthorization;
    private readonly IGeographicAuthorizationService _geographicAuthorization;

    public DrawingService(
        AppDbContext dbContext,
        ICurrentUserService currentUser,
        IDrawingAuthorizationService drawingAuthorization,
        IGeographicAuthorizationService geographicAuthorization)
    {
        _dbContext = dbContext;
        _currentUser = currentUser;
        _drawingAuthorization = drawingAuthorization;
        _geographicAuthorization = geographicAuthorization;
    }

    public Task<ServiceResult<DrawingResponse>> CreatePointAsync(CreateDrawingRequest request, CancellationToken cancellationToken) =>
        CreateAsync<PointFeature, Point>(request, DrawingKind.Point, cancellationToken);

    public Task<ServiceResult<DrawingResponse>> CreateLineAsync(CreateDrawingRequest request, CancellationToken cancellationToken) =>
        CreateAsync<LineFeature, LineString>(request, DrawingKind.Line, cancellationToken);

    public Task<ServiceResult<DrawingResponse>> CreatePolygonAsync(CreateDrawingRequest request, CancellationToken cancellationToken) =>
        CreateAsync<PolygonFeature, Polygon>(request, DrawingKind.Polygon, cancellationToken);

    public Task<IReadOnlyList<DrawingResponse>> GetPointsAsync(CancellationToken cancellationToken) =>
        GetAllAsync<PointFeature, Point>(DrawingKind.Point, cancellationToken);

    public Task<IReadOnlyList<DrawingResponse>> GetLinesAsync(CancellationToken cancellationToken) =>
        GetAllAsync<LineFeature, LineString>(DrawingKind.Line, cancellationToken);

    public Task<IReadOnlyList<DrawingResponse>> GetPolygonsAsync(CancellationToken cancellationToken) =>
        GetAllAsync<PolygonFeature, Polygon>(DrawingKind.Polygon, cancellationToken);

    /// <summary>
    /// Çöp Kutusu listesi: üç türün silinmiş kayıtları tek listede birleşir.
    /// </summary>
    /// <remarks>
    /// Üç ayrı tablo olduğu için tek bir SQL sorgusu mümkün değildir; birleştirme
    /// servis katmanında yapılır ki controller ve frontend tek bir liste görsün.
    /// Sıralama en son silinen başta olacak şekilde burada yapılır — istemci
    /// tarafındaki sıralama seçeneği bunun üzerine gelen bir tercihtir, veri
    /// kümesinin varsayılan düzeni değil.
    /// </remarks>
    public async Task<IReadOnlyList<DeletedDrawingResponse>> GetDeletedAsync(CancellationToken cancellationToken)
    {
        /* Kimlik yoksa (yapılandırma hatası) boş liste döner: kimliği
           belirlenemeyen bir istek başkasının silinmiş verisini görmektense
           hiçbir şey görmemelidir — GetAllAsync ile aynı kural. */
        var currentUserId = _currentUser.UserId;

        if (currentUserId is null)
        {
            return [];
        }

        var points = await GetDeletedAsync<PointFeature, Point>(DrawingKind.Point, currentUserId.Value, cancellationToken);
        var lines = await GetDeletedAsync<LineFeature, LineString>(DrawingKind.Line, currentUserId.Value, cancellationToken);
        var polygons = await GetDeletedAsync<PolygonFeature, Polygon>(DrawingKind.Polygon, currentUserId.Value, cancellationToken);

        return
        [
            .. points
                .Concat(lines)
                .Concat(polygons)
                // DeletedAt'i olmayan (kural öncesi işaretlenmiş) bir kayıt
                // listenin sonuna düşer, sıranın ortasına değil.
                .OrderByDescending(item => item.DeletedAt ?? DateTime.MinValue)
                .ThenByDescending(item => item.Drawing.Id)
        ];
    }

    public Task<ServiceResult<DrawingResponse>> UpdateStyleAsync(
        DrawingKind kind,
        int id,
        DrawingStyleDto? style,
        CancellationToken cancellationToken) => kind switch
        {
            DrawingKind.Point => UpdateStyleAsync<PointFeature, Point>(kind, id, style, cancellationToken),
            DrawingKind.Line => UpdateStyleAsync<LineFeature, LineString>(kind, id, style, cancellationToken),
            _ => UpdateStyleAsync<PolygonFeature, Polygon>(kind, id, style, cancellationToken)
        };

    public Task<ServiceResult<DrawingResponse>> UpdateAsync(
        DrawingKind kind,
        int id,
        UpdateDrawingRequest request,
        CancellationToken cancellationToken) => kind switch
        {
            DrawingKind.Point => UpdateAsync<PointFeature, Point>(kind, id, request, cancellationToken),
            DrawingKind.Line => UpdateAsync<LineFeature, LineString>(kind, id, request, cancellationToken),
            _ => UpdateAsync<PolygonFeature, Polygon>(kind, id, request, cancellationToken)
        };

    public Task<ServiceResult<int>> DeleteAsync(DrawingKind kind, int id, CancellationToken cancellationToken) => kind switch
    {
        DrawingKind.Point => DeleteAsync<PointFeature>(kind, id, cancellationToken),
        DrawingKind.Line => DeleteAsync<LineFeature>(kind, id, cancellationToken),
        _ => DeleteAsync<PolygonFeature>(kind, id, cancellationToken)
    };

    /* --- Toplu işlemler ------------------------------------------------------
       Üçünün de ortak sözleşmesi: doğrulama TEK transaction açılmadan önce
       biter, veritabanına dokunan her adım o transaction içinde çalışır ve ilk
       eksik kayıtta tamamı geri alınır. Kısmi başarı mümkün değildir. */

    public async Task<ServiceResult<BulkDeleteResponse>> BulkDeleteAsync(
        BulkDeleteRequest request,
        CancellationToken cancellationToken)
    {
        var validated = BulkRequestValidator.ValidateTargets(request?.Items);

        if (!validated.IsSuccess)
        {
            return Propagate<IReadOnlyList<BulkTarget>, BulkDeleteResponse>(validated);
        }

        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            var deletedCount = 0;

            foreach (var group in validated.Value!.GroupBy(target => target.Kind))
            {
                var ids = group.Select(target => target.Id).ToList();

                var removed = group.Key switch
                {
                    DrawingKind.Point => await RemoveRangeAsync<PointFeature>(group.Key, ids, cancellationToken),
                    DrawingKind.Line => await RemoveRangeAsync<LineFeature>(group.Key, ids, cancellationToken),
                    _ => await RemoveRangeAsync<PolygonFeature>(group.Key, ids, cancellationToken)
                };

                if (!removed.IsSuccess)
                {
                    // Eksik kayıt: hiçbir şey silinmiş sayılmaz.
                    await transaction.RollbackAsync(cancellationToken);
                    return Propagate<int, BulkDeleteResponse>(removed);
                }

                deletedCount += removed.Value;
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            return ServiceResult<BulkDeleteResponse>.Success(new BulkDeleteResponse { DeletedCount = deletedCount });
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<ServiceResult<BulkDrawingsResponse>> BulkUpdateStyleAsync(
        BulkStyleRequest request,
        CancellationToken cancellationToken)
    {
        var validated = BulkRequestValidator.ValidateTargets(request?.Items);

        if (!validated.IsSuccess)
        {
            return Propagate<IReadOnlyList<BulkTarget>, BulkDrawingsResponse>(validated);
        }

        var targets = validated.Value!;
        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            // Yanıtı istek sırasıyla kurabilmek için her kaydın "response üretici"si
            // saklanır; gerçek üretim SaveChanges sonrasında yapılır.
            var renderers = new Dictionary<(DrawingKind, int), Func<DrawingResponse>>();

            foreach (var group in targets.GroupBy(target => target.Kind))
            {
                var items = group.ToList();

                var styled = group.Key switch
                {
                    DrawingKind.Point => await StyleRangeAsync<PointFeature, Point>(group.Key, items, request!.Style, cancellationToken),
                    DrawingKind.Line => await StyleRangeAsync<LineFeature, LineString>(group.Key, items, request!.Style, cancellationToken),
                    _ => await StyleRangeAsync<PolygonFeature, Polygon>(group.Key, items, request!.Style, cancellationToken)
                };

                if (!styled.IsSuccess)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return Propagate<IReadOnlyList<(int, Func<DrawingResponse>)>, BulkDrawingsResponse>(styled);
                }

                foreach (var (id, render) in styled.Value!)
                {
                    renderers[(group.Key, id)] = render;
                }
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            return ServiceResult<BulkDrawingsResponse>.Success(
                BuildResponse(targets.Select(target => (target.Kind, renderers[(target.Kind, target.Id)]))));
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<ServiceResult<BulkDrawingsResponse>> BulkCreateAsync(
        BulkCreateRequest request,
        CancellationToken cancellationToken)
    {
        var validated = BulkRequestValidator.ValidateCreateTargets(request?.Items);

        if (!validated.IsSuccess)
        {
            return Propagate<IReadOnlyList<BulkCreateTarget>, BulkDrawingsResponse>(validated);
        }

        var owner = RequireOwnerId<BulkDrawingsResponse>();

        if (!owner.IsSuccess)
        {
            return Propagate<int, BulkDrawingsResponse>(owner);
        }

        // Tek çözüm, tüm öğeler için: coğrafi yetki istek boyunca değişmez.
        var area = await _geographicAuthorization.GetEffectiveAuthorizationAsync(owner.Value, cancellationToken);

        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            var pending = new List<(DrawingKind Kind, Func<DrawingResponse> Render)>();

            foreach (var target in validated.Value!)
            {
                var added = target.Kind switch
                {
                    DrawingKind.Point => AddPending<PointFeature, Point>(target, area),
                    DrawingKind.Line => AddPending<LineFeature, LineString>(target, area),
                    _ => AddPending<PolygonFeature, Polygon>(target, area)
                };

                if (!added.IsSuccess)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return Propagate<Func<DrawingResponse>, BulkDrawingsResponse>(added);
                }

                pending.Add((target.Kind, added.Value!));
            }

            // Tek SaveChanges: id'ler ancak burada oluşur, o yüzden response
            // üreticileri bundan sonra çalıştırılır.
            await _dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            return ServiceResult<BulkDrawingsResponse>.Success(BuildResponse(pending));
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<ServiceResult<BulkDrawingsResponse>> RestoreAsync(
        BulkRestoreRequest request,
        CancellationToken cancellationToken)
    {
        var validated = BulkRequestValidator.ValidateTargets(request?.Items);

        if (!validated.IsSuccess)
        {
            return Propagate<IReadOnlyList<BulkTarget>, BulkDrawingsResponse>(validated);
        }

        var targets = validated.Value!;
        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            var renderers = new Dictionary<(DrawingKind, int), Func<DrawingResponse>>();

            foreach (var group in targets.GroupBy(target => target.Kind))
            {
                var ids = group.Select(target => target.Id).ToList();

                var restored = group.Key switch
                {
                    DrawingKind.Point => await RestoreRangeAsync<PointFeature, Point>(group.Key, ids, cancellationToken),
                    DrawingKind.Line => await RestoreRangeAsync<LineFeature, LineString>(group.Key, ids, cancellationToken),
                    _ => await RestoreRangeAsync<PolygonFeature, Polygon>(group.Key, ids, cancellationToken)
                };

                if (!restored.IsSuccess)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return Propagate<IReadOnlyList<(int, Func<DrawingResponse>)>, BulkDrawingsResponse>(restored);
                }

                foreach (var (id, render) in restored.Value!)
                {
                    renderers[(group.Key, id)] = render;
                }
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            return ServiceResult<BulkDrawingsResponse>.Success(
                BuildResponse(targets.Select(target => (target.Kind, renderers[(target.Kind, target.Id)]))));
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    /// <summary>
    /// Bir türün soft-delete edilmiş kayıtlarını geri açar.
    /// </summary>
    /// <remarks>
    /// <see cref="IgnoreQueryFilters"/> burada zorunludur: kayıtlar silinmiş
    /// işaretli olduğu için normal sorgularda görünmezler. Yetki, kaydın
    /// <b>veritabanındaki sahibi</b> üzerinden değerlendirilir — yani bir
    /// kullanıcı başkasının sildiği kaydı geri açamaz, Admin açabilir ve
    /// açtığında sahiplik değişmez.
    /// </remarks>
    private async Task<ServiceResult<IReadOnlyList<(int Id, Func<DrawingResponse> Render)>>> RestoreRangeAsync<TEntity, TGeometry>(
        DrawingKind kind,
        List<int> ids,
        CancellationToken cancellationToken)
        where TEntity : class, IDrawingFeature<TGeometry>
        where TGeometry : Geometry
    {
        var entities = await _dbContext.Set<TEntity>()
            .IgnoreQueryFilters()
            .Include(entity => entity.CreatedByUser)
            .Where(entity => ids.Contains(EF.Property<int>(entity, nameof(IStyledDrawingFeature.Id))))
            .ToListAsync(cancellationToken);

        if (entities.Count != ids.Count)
        {
            return MissingFailure<IReadOnlyList<(int, Func<DrawingResponse>)>>(kind, ids, entities.Select(entity => entity.Id));
        }

        // Yetki, hiçbir kayıt geri açılmadan önce tüm hedefler için doğrulanır.
        if (!await _drawingAuthorization.CanManageAllAsync(entities))
        {
            return ServiceResult<IReadOnlyList<(int, Func<DrawingResponse>)>>.Forbidden(RestoreForbiddenMessage);
        }

        var rendered = new List<(int, Func<DrawingResponse>)>(entities.Count);

        foreach (var entity in entities)
        {
            /* Yalnızca silinme işaretleri temizlenir. CreatedByUserId,
               CreatedBy, geometry, ad ve stil kolonlarına DOKUNULMAZ —
               sahiplik bu yüzden hiçbir client girdisine ihtiyaç duymadan
               kendiliğinden korunur. */
            entity.IsDeleted = false;
            // Silme her iki işareti birden düşürdüğü için geri alma da
            // ikisini birden geri açar; aksi hâlde kayıt "silinmemiş ama
            // pasif" kalır ve query filter onu yine gizlerdi.
            entity.IsActive = true;
            entity.DeletedAt = null;
            entity.DeletedByUserId = null;

            rendered.Add((entity.Id, () => ToResponse<TEntity, TGeometry>(entity, kind)));
        }

        return ServiceResult<IReadOnlyList<(int, Func<DrawingResponse>)>>.Success(rendered);
    }

    /// <summary>Bir türün verilen id'lerini tek sorguda yükleyip siler; eksik varsa NotFound.</summary>
    private async Task<ServiceResult<int>> RemoveRangeAsync<TEntity>(
        DrawingKind kind,
        List<int> ids,
        CancellationToken cancellationToken)
        where TEntity : class, IStyledDrawingFeature
    {
        var entities = await _dbContext.Set<TEntity>()
            .Where(entity => ids.Contains(EF.Property<int>(entity, nameof(IStyledDrawingFeature.Id))))
            .ToListAsync(cancellationToken);

        if (entities.Count != ids.Count)
        {
            return MissingFailure<int>(kind, ids, entities.Select(entity => entity.Id));
        }

        // Yetki kontrolü, tek bir kayıt bile silinmeden önce TÜM hedefler için
        // yapılır: karışık sahiplikli bir istekte kısmi silme oluşamaz.
        if (!await _drawingAuthorization.CanManageAllAsync(entities))
        {
            return ServiceResult<int>.Forbidden(BulkForbiddenMessage);
        }

        foreach (var entity in entities)
        {
            MarkDeleted(entity);
        }

        return ServiceResult<int>.Success(entities.Count);
    }

    /// <summary>Bir türün verilen kayıtlarına stil uygular; eksik varsa NotFound.</summary>
    private async Task<ServiceResult<IReadOnlyList<(int Id, Func<DrawingResponse> Render)>>> StyleRangeAsync<TEntity, TGeometry>(
        DrawingKind kind,
        List<BulkTarget> targets,
        DrawingStyleDto? sharedStyle,
        CancellationToken cancellationToken)
        where TEntity : class, IDrawingFeature<TGeometry>
        where TGeometry : Geometry
    {
        var ids = targets.Select(target => target.Id).ToList();

        var entities = await _dbContext.Set<TEntity>()
            .Where(entity => ids.Contains(EF.Property<int>(entity, nameof(IStyledDrawingFeature.Id))))
            .ToListAsync(cancellationToken);

        if (entities.Count != ids.Count)
        {
            return MissingFailure<IReadOnlyList<(int, Func<DrawingResponse>)>>(kind, ids, entities.Select(entity => entity.Id));
        }

        // Aynı kural: hiçbir stil yazılmadan önce tüm hedefler yetkilendirilir.
        if (!await _drawingAuthorization.CanManageAllAsync(entities))
        {
            return ServiceResult<IReadOnlyList<(int, Func<DrawingResponse>)>>.Forbidden(BulkForbiddenMessage);
        }

        var byId = entities.ToDictionary(entity => entity.Id);
        var rendered = new List<(int, Func<DrawingResponse>)>(targets.Count);

        foreach (var target in targets)
        {
            var entity = byId[target.Id];
            // Kayda özel stil (undo) varsa ortak stilin yerine geçer. Her iki
            // durumda da taban kaydın mevcut stilidir: gönderilmeyen alanlar
            // korunur, tür için anlamsız alanlar validator tarafından düşürülür.
            var merged = DrawingStyleValidator.ValidateForUpdate(target.Style ?? sharedStyle, ReadStyle(entity, kind), kind);

            if (!merged.IsSuccess)
            {
                return ServiceResult<IReadOnlyList<(int, Func<DrawingResponse>)>>.Failure(merged.Error!);
            }

            ApplyStyle(entity, merged.Value!);
            rendered.Add((target.Id, () => ToResponse<TEntity, TGeometry>(entity, kind)));
        }

        return ServiceResult<IReadOnlyList<(int, Func<DrawingResponse>)>>.Success(rendered);
    }

    /// <summary>Toplu oluşturmada tek kaydı context'e ekler; id sonra oluşur.</summary>
    private ServiceResult<Func<DrawingResponse>> AddPending<TEntity, TGeometry>(
        BulkCreateTarget target,
        EffectiveGeographicAuthorization area)
        where TEntity : class, IDrawingFeature<TGeometry>, new()
        where TGeometry : Geometry
    {
        var parsed = WktGeometryParser.Parse<TGeometry>(target.Wkt);

        if (!parsed.IsSuccess)
        {
            return ServiceResult<Func<DrawingResponse>>.Failure(parsed.Error!);
        }

        /* Toplu oluşturma da YENİ geometri üretir; tekil yoldaki coğrafi kural
           burada da geçerlidir. Yürürlükteki alan çağrı başına BİR kez çözülüp
           parametreyle taşınır — her öğe için yeniden sorgulamak, çok öğeli bir
           istekte aynı cevabı N kez hesaplamak olurdu. */
        if (!area.Allows(parsed.Value!))
        {
            return ServiceResult<Func<DrawingResponse>>.Forbidden(OutsideAreaMessage);
        }

        // Geri yükleme yolu: isim boş olabilir (kural öncesi kayıtlar), renk
        // zaten silinen kaydın kendi stilinden gelir.
        var name = DrawingAttributeValidator.ValidateNameForRestore(target.Name);

        if (!name.IsSuccess)
        {
            return ServiceResult<Func<DrawingResponse>>.Failure(name.Error!);
        }

        var style = DrawingStyleValidator.ValidateForCreate(target.Style, target.Kind);

        if (!style.IsSuccess)
        {
            return ServiceResult<Func<DrawingResponse>>.Failure(style.Error!);
        }

        // Metadata tekil create ile aynı doğrulamadan geçer.
        var description = DrawingMetadataValidator.ValidateDescription(target.Description);

        if (!description.IsSuccess)
        {
            return ServiceResult<Func<DrawingResponse>>.Failure(description.Error!);
        }

        var category = DrawingMetadataValidator.ValidateCategory(target.Category);

        if (!category.IsSuccess)
        {
            return ServiceResult<Func<DrawingResponse>>.Failure(category.Error!);
        }

        var tags = DrawingMetadataValidator.ValidateTags(target.Tags);

        if (!tags.IsSuccess)
        {
            return ServiceResult<Func<DrawingResponse>>.Failure(tags.Error!);
        }

        var owner = RequireOwnerId<Func<DrawingResponse>>();

        if (!owner.IsSuccess)
        {
            return Propagate<int, Func<DrawingResponse>>(owner);
        }

        /* Geri yükleme (undo) yolunda da sahiplik daima ÇAĞIRAN kullanıcıdır.
           İstek gövdesindeki hiçbir sahiplik bilgisi kabul edilmez: aksi hâlde
           bir kullanıcı eski bir payload'ı tekrar göndererek başkasına ait
           görünen kayıt oluşturabilirdi. Normal kullanıcı zaten yalnızca kendi
           kaydını silebildiği için undo ettiği kayıt da kendisinindir. */
        var entity = new TEntity
        {
            Name = name.Value!,
            Description = description.Value,
            Category = category.Value,
            Tags = tags.Value!,
            Geometry = parsed.Value!,
            CreatedByUserId = owner.Value,
            CreatedBy = _currentUser.UserName
        };

        ApplyStyle(entity, style.Value!);
        _dbContext.Set<TEntity>().Add(entity);

        return ServiceResult<Func<DrawingResponse>>.Success(() => ToResponse<TEntity, TGeometry>(entity, target.Kind));
    }

    private static BulkDrawingsResponse BuildResponse(IEnumerable<(DrawingKind Kind, Func<DrawingResponse> Render)> items)
    {
        var results = items
            .Select(item => new BulkDrawingResult { Type = BulkRequestValidator.NameOf(item.Kind), Drawing = item.Render() })
            .ToList();

        return new BulkDrawingsResponse { Count = results.Count, Items = results };
    }

    private static ServiceResult<T> MissingFailure<T>(DrawingKind kind, IEnumerable<int> requested, IEnumerable<int> found)
    {
        var missing = requested.Except(found).OrderBy(id => id);

        return ServiceResult<T>.NotFound(
            $"{kind} kaydı bulunamadı (id: {string.Join(", ", missing)}). Hiçbir kayıt değiştirilmedi.");
    }

    /// <summary>Hata türünü (400/403/404/409) koruyarak sonucu başka bir değer tipine taşır.</summary>
    private static ServiceResult<TOut> Propagate<TIn, TOut>(ServiceResult<TIn> source) => source.ErrorKind switch
    {
        ServiceErrorKind.NotFound => ServiceResult<TOut>.NotFound(source.Error!),
        ServiceErrorKind.Forbidden => ServiceResult<TOut>.Forbidden(source.Error!),
        ServiceErrorKind.Conflict => ServiceResult<TOut>.Conflict(source.Error!),
        _ => ServiceResult<TOut>.Failure(source.Error!)
    };

    /// <summary>
    /// Yeni kaydın sahibi: doğrulanmış JWT'deki kullanıcı kimliği. Endpoint'ler
    /// <c>[Authorize]</c> olduğu için normalde daima doludur; boş gelmesi
    /// yapılandırma hatasıdır ve kayıt oluşturulmaz.
    /// </summary>
    private ServiceResult<int> RequireOwnerId<T>()
    {
        var userId = _currentUser.UserId;

        return userId is null
            ? ServiceResult<int>.Forbidden("Kimlik doğrulanamadı; çizim oluşturulamaz.")
            : ServiceResult<int>.Success(userId.Value);
    }

    private async Task<ServiceResult<DrawingResponse>> CreateAsync<TEntity, TGeometry>(
        CreateDrawingRequest request,
        DrawingKind kind,
        CancellationToken cancellationToken)
        where TEntity : class, IDrawingFeature<TGeometry>, new()
        where TGeometry : Geometry
    {
        var parsed = WktGeometryParser.Parse<TGeometry>(request.Wkt);

        if (!parsed.IsSuccess)
        {
            return ServiceResult<DrawingResponse>.Failure(parsed.Error!);
        }

        // Yeni kayıtta isim ve renk zorunludur; ikisi de öznitelik popup'ından gelir.
        var name = DrawingAttributeValidator.ValidateNameForCreate(request.Name);

        if (!name.IsSuccess)
        {
            return ServiceResult<DrawingResponse>.Failure(name.Error!);
        }

        var style = DrawingStyleValidator.ValidateForCreate(request.Style, kind, requireStrokeColor: true);

        if (!style.IsSuccess)
        {
            return ServiceResult<DrawingResponse>.Failure(style.Error!);
        }

        /* Metadata: üçü de opsiyoneldir, ama gönderildiyse kayıt oluşmadan ÖNCE
           doğrulanır — geçersiz bir kategori yüzünden yarım kayıt kalmasın. */
        var description = DrawingMetadataValidator.ValidateDescription(request.Description);

        if (!description.IsSuccess)
        {
            return ServiceResult<DrawingResponse>.Failure(description.Error!);
        }

        var category = DrawingMetadataValidator.ValidateCategory(request.Category);

        if (!category.IsSuccess)
        {
            return ServiceResult<DrawingResponse>.Failure(category.Error!);
        }

        var tags = DrawingMetadataValidator.ValidateTags(request.Tags);

        if (!tags.IsSuccess)
        {
            return ServiceResult<DrawingResponse>.Failure(tags.Error!);
        }

        var owner = RequireOwnerId<DrawingResponse>();

        if (!owner.IsSuccess)
        {
            return Propagate<int, DrawingResponse>(owner);
        }

        /* Coğrafi yetki, geometri DOĞRULANDIKTAN sonra ve kayıt açılmadan ÖNCE
           sınanır. Sıra önemlidir: bozuk bir WKT "yanlış yerdesin" (403) diye
           raporlanmamalıdır — o 400'dür ve yukarıda çoktan dönmüştür. */
        var area = await _geographicAuthorization.GetEffectiveAuthorizationAsync(owner.Value, cancellationToken);

        if (!area.Allows(parsed.Value!))
        {
            return ServiceResult<DrawingResponse>.Forbidden(OutsideAreaMessage);
        }

        var entity = new TEntity
        {
            Name = name.Value!,
            Description = description.Value,
            Category = category.Value,
            Tags = tags.Value!,
            Geometry = parsed.Value!,
            // Sahiplik client'tan DEĞİL, doğrulanmış JWT kimliğinden gelir.
            // İstek gövdesindeki createdByUserId/createdBy/ownerId alanları
            // DTO'da tanımlı olmadığı için zaten bind edilmez, edilse de
            // burada kullanılmazdı.
            CreatedByUserId = owner.Value,
            CreatedBy = _currentUser.UserName
        };

        ApplyStyle(entity, style.Value!);

        _dbContext.Set<TEntity>().Add(entity);
        // CreatedDate / ModifiedDate AppDbContext.SaveChanges içinde UTC damgalanır.
        await _dbContext.SaveChangesAsync(cancellationToken);

        return ServiceResult<DrawingResponse>.Success(ToResponse<TEntity, TGeometry>(entity, kind));
    }

    private async Task<IReadOnlyList<DrawingResponse>> GetAllAsync<TEntity, TGeometry>(
        DrawingKind kind,
        CancellationToken cancellationToken)
        where TEntity : class, IDrawingFeature<TGeometry>
        where TGeometry : Geometry
    {
        /* Veri izolasyonu: harita ve "Çizimlerim" yalnızca ÇAĞIRAN kullanıcının
           kendi çizimlerini görür. Kapsam DrawingScopes.UserMapScope içinde
           adlandırılmıştır — envanter analizinin kullandığı paylaşılan kümeden
           (DrawingScopes.InventoryScope) ayrıldığı yer orasıdır.

           IsDeleted/IsActive koşulunu global query filter ekler.

           Kimlik yoksa (yapılandırma hatası) boş liste döner: kimliği
           belirlenemeyen bir istek başkasının verisini görmektense hiçbir şey
           görmemelidir.

           Sahip kullanıcı adı ilişkiden türetilir (legacy CreatedBy string'i
           değil); Include tek sorguda join yapar. */
        var currentUserId = _currentUser.UserId;

        if (currentUserId is null)
        {
            return [];
        }

        var entities = await _dbContext.Set<TEntity>()
            .AsNoTracking()
            .Include(entity => entity.CreatedByUser)
            .UserMapScope(currentUserId.Value)
            .OrderBy(entity => EF.Property<int>(entity, nameof(IStyledDrawingFeature.Id)))
            .ToListAsync(cancellationToken);

        return entities.Select(entity => ToResponse<TEntity, TGeometry>(entity, kind)).ToList();
    }

    /// <summary>
    /// Bir türün silinmiş kayıtlarını Çöp Kutusu gövdesine çevirir.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <see cref="IgnoreQueryFilters"/> burada zorunludur — aranan kayıtlar
    /// "silinmiş" işaretli olduğu için global query filter onları normal
    /// sorgularda tamamen gizler. Filtre atlandığı anda sahiplik korumasını da
    /// atlamış olmamak için kapsam hemen ardından <c>DeletedScope</c> ile
    /// <b>açıkça</b> daraltılır: <c>IsDeleted &amp;&amp; CreatedByUserId == çağıran</c>.
    /// </para>
    /// <para>
    /// Yüklem LINQ üzerinden SQL'e iner; tablo belleğe çekilip sonra süzülmez.
    /// Sahip kullanıcı adı, normal listede olduğu gibi ilişkiden türetilir.
    /// </para>
    /// </remarks>
    private async Task<List<DeletedDrawingResponse>> GetDeletedAsync<TEntity, TGeometry>(
        DrawingKind kind,
        int currentUserId,
        CancellationToken cancellationToken)
        where TEntity : class, IDrawingFeature<TGeometry>
        where TGeometry : Geometry
    {
        var entities = await _dbContext.Set<TEntity>()
            .AsNoTracking()
            .IgnoreQueryFilters()
            .Include(entity => entity.CreatedByUser)
            .DeletedScope(currentUserId)
            .ToListAsync(cancellationToken);

        return entities
            .Select(entity => new DeletedDrawingResponse
            {
                // Tür adı, geri yükleme isteğinin beklediği yazımın TEK kaynağından
                // okunur; "point"/"line"/"polygon" burada tekrar yazılmaz.
                Type = BulkRequestValidator.NameOf(kind),
                DeletedAt = entity.DeletedAt,
                Drawing = ToResponse<TEntity, TGeometry>(entity, kind)
            })
            .ToList();
    }

    private async Task<ServiceResult<DrawingResponse>> UpdateStyleAsync<TEntity, TGeometry>(
        DrawingKind kind,
        int id,
        DrawingStyleDto? requestedStyle,
        CancellationToken cancellationToken)
        where TEntity : class, IDrawingFeature<TGeometry>
        where TGeometry : Geometry
    {
        var entity = await SingleOrDefaultAsync<TEntity>(id, cancellationToken);

        if (entity is null)
        {
            return NotFound<DrawingResponse>(kind, id);
        }

        // Sahiplik kontrolü kaydı DEĞİŞTİRMEDEN önce. Kayıt herkes tarafından
        // okunabildiği için varlığını gizlemeye gerek yok: 404 yerine 403.
        if (!await _drawingAuthorization.CanManageAsync(entity))
        {
            return ServiceResult<DrawingResponse>.Forbidden(ForbiddenMessage);
        }

        // Gönderilmeyen alanların mevcut değerini koruması için fallback = kayıtlı stil.
        var merged = DrawingStyleValidator.ValidateForUpdate(requestedStyle, ReadStyle(entity, kind), kind);

        if (!merged.IsSuccess)
        {
            return ServiceResult<DrawingResponse>.Failure(merged.Error!);
        }

        ApplyStyle(entity, merged.Value!);

        // Geometry bu endpoint ile hiç okunmaz/yazılmaz; yalnızca stil kolonları
        // değişir. ModifiedDate SaveChanges içinde damgalanır.
        await _dbContext.SaveChangesAsync(cancellationToken);

        return ServiceResult<DrawingResponse>.Success(ToResponse<TEntity, TGeometry>(entity, kind));
    }

    /// <summary>
    /// Ad + stil + geometry güncellemesi. Doğrulamaların TAMAMI kayda tek bir
    /// yazma yapılmadan önce biter: yarı uygulanmış bir güncelleme (adı değişip
    /// geometry'si reddedilen kayıt) oluşamaz.
    /// </summary>
    private async Task<ServiceResult<DrawingResponse>> UpdateAsync<TEntity, TGeometry>(
        DrawingKind kind,
        int id,
        UpdateDrawingRequest request,
        CancellationToken cancellationToken)
        where TEntity : class, IDrawingFeature<TGeometry>
        where TGeometry : Geometry
    {
        /* Global query filter burada bilerek AKTİFTİR: silinmiş veya pasif bir
           kayıt bulunamaz, dolayısıyla güncellenemez de. */
        var entity = await SingleOrDefaultAsync<TEntity>(id, cancellationToken);

        if (entity is null)
        {
            return NotFound<DrawingResponse>(kind, id);
        }

        // IDOR koruması: kayıt DEĞİŞTİRİLMEDEN önce sahiplik doğrulanır.
        // Başka kullanıcının id'sini elle gönderen istek burada durur.
        if (!await _drawingAuthorization.CanManageAsync(entity))
        {
            return ServiceResult<DrawingResponse>.Forbidden(ForbiddenMessage);
        }

        // Ad: gönderilmediyse korunur, gönderildiyse create ile aynı kurala tabi.
        var name = entity.Name;

        if (request.Name is not null)
        {
            var validatedName = DrawingAttributeValidator.ValidateNameForCreate(request.Name);

            if (!validatedName.IsSuccess)
            {
                return ServiceResult<DrawingResponse>.Failure(validatedName.Error!);
            }

            name = validatedName.Value!;
        }

        /* Metadata: her biri gönderilmediyse (null) korunur, gönderildiyse
           doğrulanır. Boş metin / boş liste "temizle" demektir ve geçerlidir —
           ayrım DTO'da açıklanmıştır. */
        var description = entity.Description;

        if (request.Description is not null)
        {
            var validatedDescription = DrawingMetadataValidator.ValidateDescription(request.Description);

            if (!validatedDescription.IsSuccess)
            {
                return ServiceResult<DrawingResponse>.Failure(validatedDescription.Error!);
            }

            description = validatedDescription.Value;
        }

        var category = entity.Category;

        if (request.Category is not null)
        {
            var validatedCategory = DrawingMetadataValidator.ValidateCategory(request.Category);

            if (!validatedCategory.IsSuccess)
            {
                return ServiceResult<DrawingResponse>.Failure(validatedCategory.Error!);
            }

            category = validatedCategory.Value;
        }

        var tags = entity.Tags;

        if (request.Tags is not null)
        {
            var validatedTags = DrawingMetadataValidator.ValidateTags(request.Tags);

            if (!validatedTags.IsSuccess)
            {
                return ServiceResult<DrawingResponse>.Failure(validatedTags.Error!);
            }

            tags = validatedTags.Value!;
        }

        // Stil: gönderilmeyen alanlar kaydın mevcut stilinden korunur.
        var merged = DrawingStyleValidator.ValidateForUpdate(request.Style, ReadStyle(entity, kind), kind);

        if (!merged.IsSuccess)
        {
            return ServiceResult<DrawingResponse>.Failure(merged.Error!);
        }

        /* Geometry: create yolundaki parser'ın aynısı kullanılır — tip
           uyumu, boş geometry reddi, SRID ve koordinat aralığı kontrolleri
           tek bir yerde tanımlıdır, burada kopyalanmaz. */
        TGeometry? geometry = null;

        if (request.Wkt is not null)
        {
            var parsed = WktGeometryParser.Parse<TGeometry>(request.Wkt);

            if (!parsed.IsSuccess)
            {
                return ServiceResult<DrawingResponse>.Failure(parsed.Error!);
            }

            geometry = parsed.Value!;

            /* Geometri DEĞİŞİYORSA yeni konum coğrafi yetkiye tabidir: bir
               kaydı sürükleyerek alanın dışına taşımak, oraya yeni çizmekle
               aynı şeydir.

               Kontrol bilinçli olarak yalnızca bu blokta durur. Ad, açıklama,
               kategori, etiket veya renk değiştiren bir istek geometriye
               dokunmaz ve coğrafi olarak sınanmaz — aksi hâlde sonradan
               daraltılan bir alanın dışında kalan eski bir kaydın rengi bile
               değiştirilemezdi. Coğrafi yetkinin cevapladığı soru "geometri
               NEREYE konabilir"dir, "bu kayda dokunulabilir mi" değil.

               <b>Gönderilen geometri kayıtlının AYNISI ise değişiklik yoktur.</b>
               İstemcinin, dokunmadığı geometriyi de gövdeye koyması sıradan bir
               durumdur (tek bir PUT ile ad + renk + geometri taşınır) ve o
               isteği coğrafi olarak reddetmek, alanı sonradan daraltılan bir
               kullanıcının eski kaydının adını bile değiştirememesi demekti.
               Karar İSTEMCİYE bırakılmaz: değişip değişmediğini sunucu, kayıtlı
               geometriyle karşılaştırarak kendisi belirler.

               Karşılaştırma küçük bir toleransla yapılır çünkü geometri
               tarayıcıya 4326 → 3857 → 4326 yolundan gider gelir ve bu gidiş
               dönüş son basamaklarda kayan nokta gürültüsü bırakır; sıfır
               toleransla "değişmedi" durumu pratikte hiç yakalanamazdı. Tolerans
               derece cinsinden 1e-9'dur — ekvatorda milimetrenin onda biri
               mertebesinde, yani hiçbir gerçek taşımayı gizleyemez. */
            var unchanged = entity.Geometry is not null
                && geometry.EqualsExact(entity.Geometry, UnchangedGeometryTolerance);

            // Değişmemiş bir geometri için kapsam hiç ÇÖZÜLMEZ: sorulacak bir
            // soru yoktur ve her metadata güncellemesi boşuna bir sorgu açardı.
            if (!unchanged)
            {
                var area = await _geographicAuthorization.GetEffectiveAuthorizationAsync(
                    _currentUser.UserId!.Value, cancellationToken);

                if (!area.Allows(geometry))
                {
                    return ServiceResult<DrawingResponse>.Forbidden(OutsideAreaMessage);
                }
            }
        }

        // Buradan sonrası yazma: her girdi doğrulanmış durumda.
        entity.Name = name;
        entity.Description = description;
        entity.Category = category;
        entity.Tags = tags;
        ApplyStyle(entity, merged.Value!);

        if (geometry is not null)
        {
            entity.Geometry = geometry;
        }

        // ModifiedDate SaveChanges içinde UTC damgalanır; CreatedDate ve
        // sahiplik alanları değişmez.
        await _dbContext.SaveChangesAsync(cancellationToken);

        return ServiceResult<DrawingResponse>.Success(ToResponse<TEntity, TGeometry>(entity, kind));
    }

    private async Task<ServiceResult<int>> DeleteAsync<TEntity>(DrawingKind kind, int id, CancellationToken cancellationToken)
        where TEntity : class, IStyledDrawingFeature
    {
        var entity = await SingleOrDefaultAsync<TEntity>(id, cancellationToken);

        if (entity is null)
        {
            return NotFound<int>(kind, id);
        }

        if (!await _drawingAuthorization.CanManageAsync(entity))
        {
            return ServiceResult<int>.Forbidden(ForbiddenMessage);
        }

        // Satır silinmez, işaretlenir: geri alma aynı satırı — aynı Id ve aynı
        // sahiple — geri açabilsin diye. Sahiplik alanlarına DOKUNULMAZ.
        MarkDeleted(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return ServiceResult<int>.Success(id);
    }

    /// <summary>
    /// Kaydı silinmiş olarak işaretler. Sahiplik alanlarına dokunmaz; kimin
    /// sildiği ayrı bir alanda denetim izi olarak tutulur.
    /// </summary>
    private void MarkDeleted(IStyledDrawingFeature entity)
    {
        entity.IsDeleted = true;
        // Silinen kayıt aynı anda pasife de düşer; normal sorgular ikisini
        // birden şart koştuğu için kayıt hiçbir listede görünmez.
        entity.IsActive = false;
        entity.DeletedAt = DateTime.UtcNow;
        entity.DeletedByUserId = _currentUser.UserId;
        // ModifiedDate SaveChanges içinde UTC damgalanır.
    }

    private static ServiceResult<T> NotFound<T>(DrawingKind kind, int id) =>
        ServiceResult<T>.NotFound($"{kind} kaydı bulunamadı (id: {id}).");

    /// <summary>
    /// Tek kaydı id ile yükler; <b>global query filter uygulanır</b>, yani
    /// silinmiş veya pasif kayıt bulunamaz.
    /// </summary>
    /// <remarks>
    /// <c>FindAsync</c> burada bilerek KULLANILMAZ: change tracker'da zaten
    /// izlenen bir entity varsa Find sorgu çalıştırmaz ve onu doğrudan
    /// döndürür — bu durumda query filter atlanır ve aynı context içinde
    /// silinmiş bir kayıt hâlâ güncellenebilir hâle gelirdi. Açık sorgu
    /// filtrenin her koşulda uygulanmasını garanti eder.
    /// </remarks>
    private Task<TEntity?> SingleOrDefaultAsync<TEntity>(int id, CancellationToken cancellationToken)
        where TEntity : class, IStyledDrawingFeature =>
        _dbContext.Set<TEntity>()
            .Where(entity => EF.Property<int>(entity, nameof(IStyledDrawingFeature.Id)) == id)
            .FirstOrDefaultAsync(cancellationToken);

    /// <summary>Entity kolonlarını doğrulanmış stile göre yazar.</summary>
    private static void ApplyStyle(IStyledDrawingFeature entity, DrawingStyle style)
    {
        entity.StrokeColor = style.StrokeColor;
        entity.StrokeWidth = style.StrokeWidth;
        entity.FillColor = style.FillColor;
        entity.FillOpacity = style.FillOpacity;
        entity.LineStyle = style.LineStyle;

        if (entity is IPointStyledFeature pointStyled)
        {
            pointStyled.PointRadius = style.PointRadius;
        }
    }

    /// <summary>
    /// Entity kolonlarından mevcut stili okur (PATCH merge tabanı).
    /// Okuma <see cref="DrawingStyleReader"/> içindedir: envanter analizi sonucu
    /// da aynı yerden okur, böylece bir kayıt iki ekranda farklı renkte görünemez.
    /// </summary>
    private static DrawingStyle ReadStyle(IStyledDrawingFeature entity, DrawingKind kind) =>
        DrawingStyleReader.Read(entity, kind);

    private static DrawingResponse ToResponse<TEntity, TGeometry>(TEntity entity, DrawingKind kind)
        where TEntity : class, IDrawingFeature<TGeometry>
        where TGeometry : Geometry
    {
        var style = ReadStyle(entity, kind);

        return new DrawingResponse
        {
            Id = entity.Id,
            Wkt = WktWriter.Write(entity.Geometry),
            Name = entity.Name,
            Description = entity.Description,
            Category = entity.Category,
            // Kopyalanır: response nesnesi entity'nin listesini paylaşmamalı.
            // Null gelen bir kolon (migration öncesi satır) boş diziye düşer.
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
            CreatedByUserId = entity.CreatedByUserId,
            /* Kullanıcı adı ilişkiden türetilir; legacy kolon yalnızca ilişki
               yüklenmediğinde (ör. yeni oluşturulan entity) yedek olarak
               kullanılır — o durumda da değer aynı kaynaktan, doğrulanmış
               kimlikten yazılmıştır. */
            CreatedBy = entity.CreatedByUser?.UserName ?? entity.CreatedBy
        };
    }
}
