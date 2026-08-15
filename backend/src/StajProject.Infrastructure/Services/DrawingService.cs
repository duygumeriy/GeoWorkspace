using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO;
using StajProject.Application.Bulk;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Drawings;
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

    private readonly AppDbContext _dbContext;
    private readonly ICurrentUserService _currentUser;
    private readonly IDrawingAuthorizationService _drawingAuthorization;

    public DrawingService(
        AppDbContext dbContext,
        ICurrentUserService currentUser,
        IDrawingAuthorizationService drawingAuthorization)
    {
        _dbContext = dbContext;
        _currentUser = currentUser;
        _drawingAuthorization = drawingAuthorization;
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

        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            var pending = new List<(DrawingKind Kind, Func<DrawingResponse> Render)>();

            foreach (var target in validated.Value!)
            {
                var added = target.Kind switch
                {
                    DrawingKind.Point => AddPending<PointFeature, Point>(target),
                    DrawingKind.Line => AddPending<LineFeature, LineString>(target),
                    _ => AddPending<PolygonFeature, Polygon>(target)
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
    private ServiceResult<Func<DrawingResponse>> AddPending<TEntity, TGeometry>(BulkCreateTarget target)
        where TEntity : class, IDrawingFeature<TGeometry>, new()
        where TGeometry : Geometry
    {
        var parsed = WktGeometryParser.Parse<TGeometry>(target.Wkt);

        if (!parsed.IsSuccess)
        {
            return ServiceResult<Func<DrawingResponse>>.Failure(parsed.Error!);
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

        var owner = RequireOwnerId<DrawingResponse>();

        if (!owner.IsSuccess)
        {
            return Propagate<int, DrawingResponse>(owner);
        }

        var entity = new TEntity
        {
            Name = name.Value!,
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
        /* Sahip kullanıcı adı ilişkiden türetilir (legacy CreatedBy string'i
           değil). Include tek sorguda join yapar; kullanıcı başına ek sorgu
           oluşmaz. Okuma HERKESE açıktır — sahiplik yalnızca mutation'ı
           kısıtlar, görünürlüğü değil; bu yüzden burada filtre yoktur. */
        var entities = await _dbContext.Set<TEntity>()
            .AsNoTracking()
            .Include(entity => entity.CreatedByUser)
            .OrderBy(entity => EF.Property<int>(entity, nameof(IStyledDrawingFeature.Id)))
            .ToListAsync(cancellationToken);

        return entities.Select(entity => ToResponse<TEntity, TGeometry>(entity, kind)).ToList();
    }

    private async Task<ServiceResult<DrawingResponse>> UpdateStyleAsync<TEntity, TGeometry>(
        DrawingKind kind,
        int id,
        DrawingStyleDto? requestedStyle,
        CancellationToken cancellationToken)
        where TEntity : class, IDrawingFeature<TGeometry>
        where TGeometry : Geometry
    {
        var entity = await _dbContext.Set<TEntity>().FindAsync([id], cancellationToken);

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

    private async Task<ServiceResult<int>> DeleteAsync<TEntity>(DrawingKind kind, int id, CancellationToken cancellationToken)
        where TEntity : class, IStyledDrawingFeature
    {
        var entity = await _dbContext.Set<TEntity>().FindAsync([id], cancellationToken);

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
        entity.DeletedAt = DateTime.UtcNow;
        entity.DeletedByUserId = _currentUser.UserId;
    }

    private static ServiceResult<T> NotFound<T>(DrawingKind kind, int id) =>
        ServiceResult<T>.NotFound($"{kind} kaydı bulunamadı (id: {id}).");

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

    /// <summary>Entity kolonlarından mevcut stili okur (PATCH merge tabanı).</summary>
    private static DrawingStyle ReadStyle(IStyledDrawingFeature entity, DrawingKind kind)
    {
        var defaults = DrawingStyleDefaults.For(kind);

        return new DrawingStyle(
            string.IsNullOrWhiteSpace(entity.StrokeColor) ? defaults.StrokeColor : entity.StrokeColor,
            entity.StrokeWidth == 0 ? defaults.StrokeWidth : entity.StrokeWidth,
            entity.FillColor ?? defaults.FillColor,
            entity.FillOpacity ?? defaults.FillOpacity,
            (entity as IPointStyledFeature)?.PointRadius ?? defaults.PointRadius,
            entity.LineStyle ?? defaults.LineStyle);
    }

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
