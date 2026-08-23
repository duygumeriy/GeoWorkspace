using Microsoft.EntityFrameworkCore;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Pois;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// POI kategori hiyerarşisini EF Core üzerinden okur ve yönetir. Elle SQL
/// kullanılmaz.
/// </summary>
/// <remarks>
/// <para>
/// <b>Hiyerarşi tek sorguda düz olarak okunur, sonra bellekte kurulur.</b>
/// Alt koleksiyonları <c>Include</c> ile derinlemesine çekmek, derinlik kadar
/// sorgu (veya devasa bir kartezyen sonuç) üretir ve derinliğin üst sınırı
/// yoktur. Kategori sayısı bir taksonomi ölçeğinde kaldığı için düz projeksiyon
/// hem tek sorgudur hem de yol/döngü mantığının tamamını
/// <see cref="PoiCategoryHierarchy"/> içinde saf tutar.
/// </para>
/// </remarks>
public class PoiCategoryService : IPoiCategoryService
{
    private const string NotFoundMessage = "Kategori bulunamadı.";

    private const string CycleMessage =
        "Bir kategori kendisinin ya da kendi alt kategorilerinden birinin altına taşınamaz.";

    private readonly AppDbContext _dbContext;

    public PoiCategoryService(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    /* --- Okuma ------------------------------------------------------------------ */

    public async Task<IReadOnlyList<PoiCategoryResponse>> GetActiveCategoriesAsync(
        CancellationToken cancellationToken = default)
    {
        // Global query filter zaten pasif/silinmiş satırları düşürür; burada
        // IgnoreQueryFilters BİLİNÇLİ olarak kullanılmaz.
        var nodes = await ReadNodesAsync(includeHidden: false, cancellationToken);

        return
        [
            .. nodes.Values
                .Select(node => new PoiCategoryResponse
                {
                    Id = node.Id,
                    Name = node.Name,
                    ParentId = node.ParentId,
                    Path = PoiCategoryHierarchy.BuildPath(nodes, node.Id),
                    Depth = PoiCategoryHierarchy.DepthOf(nodes, node.Id)
                })
                .OrderBy(item => item.Path, StringComparer.OrdinalIgnoreCase)
                .ThenBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
                .ThenBy(item => item.Id)
        ];
    }

    public async Task<IReadOnlyList<AdminPoiCategoryResponse>> GetAdminCategoriesAsync(
        CancellationToken cancellationToken = default)
    {
        /* Yönetim ekranı envanterin TAMAMINI görür. Pasif bir kategorinin
           gizlenmesi, yöneticinin onu neden seçemediğini göremediği bir ekran
           üretirdi; silinmiş satırın gizlenmesi ise bir alt ağacın neden
           kopuk göründüğünü açıklanamaz kılardı. */
        var nodes = await ReadNodesAsync(includeHidden: true, cancellationToken);

        var rows = await _dbContext.PoiCategories
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Select(c => new
            {
                c.Id,
                c.CreatedDate,
                c.ModifiedDate,
                c.IsActive,
                c.IsDeleted
            })
            .ToListAsync(cancellationToken);

        return
        [
            .. rows
                .Select(row =>
                {
                    var node = nodes[row.Id];

                    return new AdminPoiCategoryResponse
                    {
                        Id = node.Id,
                        Name = node.Name,
                        ParentId = node.ParentId,
                        ParentName = node.ParentId is int parentId && nodes.TryGetValue(parentId, out var parent)
                            ? parent.Name
                            : null,
                        Path = PoiCategoryHierarchy.BuildPath(nodes, node.Id),
                        Depth = PoiCategoryHierarchy.DepthOf(nodes, node.Id),
                        CreatedDate = row.CreatedDate,
                        ModifiedDate = row.ModifiedDate,
                        IsActive = row.IsActive,
                        IsDeleted = row.IsDeleted
                    };
                })
                .OrderBy(item => item.Path, StringComparer.OrdinalIgnoreCase)
                .ThenBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
                .ThenBy(item => item.Id)
        ];
    }

    /* --- Yazma ------------------------------------------------------------------ */

    public async Task<ServiceResult<AdminPoiCategoryResponse>> CreateCategoryAsync(
        CreatePoiCategoryRequest request,
        CancellationToken cancellationToken = default)
    {
        var name = ValidateName(request.Name);

        if (!name.IsSuccess)
        {
            return ServiceResult<AdminPoiCategoryResponse>.Failure(name.Error!);
        }

        var parent = await ValidateParentAsync(request.ParentId, cancellationToken);

        if (!parent.IsSuccess)
        {
            return Propagate<int?, AdminPoiCategoryResponse>(parent);
        }

        var category = new PoiCategory
        {
            Name = name.Value!,
            ParentId = parent.Value,
            IsActive = true,
            IsDeleted = false,
            /* CreatedDate AÇIKÇA damgalanır: AppDbContext yalnızca
               ModifiedDate'i IAuditableEntity üzerinden yazar, CreatedDate
               otomatiği çizim arayüzüne bağlıdır ve POI onu uygulamaz. */
            CreatedDate = DateTime.UtcNow
        };

        _dbContext.PoiCategories.Add(category);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return ServiceResult<AdminPoiCategoryResponse>.Success(
            await ToAdminResponseAsync(category.Id, cancellationToken));
    }

    public async Task<ServiceResult<AdminPoiCategoryResponse>> UpdateCategoryAsync(
        int id,
        UpdatePoiCategoryRequest request,
        CancellationToken cancellationToken = default)
    {
        /* Filtre atlanır çünkü yönetim, PASİF bir kategoriyi de düzenleyebilmeli
           (örneğin yeniden aktifleştirmek için). Silinmiş satır yine de
           düzenlenemez: silme bu fazın kapsamı dışındadır ve geri alma ayrı bir
           karardır. */
        var category = await _dbContext.PoiCategories
            .IgnoreQueryFilters()
            .SingleOrDefaultAsync(c => c.Id == id, cancellationToken);

        if (category is null || category.IsDeleted)
        {
            return ServiceResult<AdminPoiCategoryResponse>.NotFound(NotFoundMessage);
        }

        var name = ValidateName(request.Name);

        if (!name.IsSuccess)
        {
            return ServiceResult<AdminPoiCategoryResponse>.Failure(name.Error!);
        }

        // Üst değişmiyorsa yeniden doğrulanmaz: pasifleşmiş bir üstün altındaki
        // kategorinin adını düzenlemek, ilişkiyi yeniden kurmak değildir.
        if (request.ParentId != category.ParentId)
        {
            var parent = await ValidateParentAsync(request.ParentId, cancellationToken);

            if (!parent.IsSuccess)
            {
                return Propagate<int?, AdminPoiCategoryResponse>(parent);
            }

            /* Döngü kontrolü TÜM satırlar üzerinden yapılır: pasif ya da
               silinmiş bir düğümden geçen bir döngü de döngüdür ve gizli
               kalması, ağacı sessizce bozardı. */
            var nodes = await ReadNodesAsync(includeHidden: true, cancellationToken);

            if (PoiCategoryHierarchy.WouldCreateCycle(nodes, category.Id, parent.Value))
            {
                return ServiceResult<AdminPoiCategoryResponse>.Failure(CycleMessage);
            }

            category.ParentId = parent.Value;
        }

        category.Name = name.Value!;
        category.IsActive = request.IsActive;

        // ModifiedDate AppDbContext.SaveChanges içinde UTC damgalanır.
        await _dbContext.SaveChangesAsync(cancellationToken);

        return ServiceResult<AdminPoiCategoryResponse>.Success(
            await ToAdminResponseAsync(category.Id, cancellationToken));
    }

    /* --- Yardımcılar ------------------------------------------------------------ */

    private static ServiceResult<string> ValidateName(string? name)
    {
        var trimmed = (name ?? string.Empty).Trim();

        if (trimmed.Length == 0)
        {
            return ServiceResult<string>.Failure("Kategori adı zorunludur.");
        }

        return trimmed.Length > PoiCategory.MaxNameLength
            ? ServiceResult<string>.Failure(
                $"Kategori adı en fazla {PoiCategory.MaxNameLength} karakter olabilir.")
            : ServiceResult<string>.Success(trimmed);
    }

    /// <summary>
    /// Üst kategoriyi doğrular. <c>null</c> geçerlidir (kök kategori).
    /// </summary>
    /// <remarks>
    /// Sorgu global filtreyi KULLANIR: yeni bir kategori yalnızca aktif ve
    /// silinmemiş bir üstün altına konabilir. Pasif bir üstün altına ekleme,
    /// doğduğu anda görünmeyen bir dal yaratırdı.
    /// </remarks>
    private async Task<ServiceResult<int?>> ValidateParentAsync(
        int? parentId,
        CancellationToken cancellationToken)
    {
        if (parentId is null)
        {
            return ServiceResult<int?>.Success(null);
        }

        if (parentId.Value <= 0)
        {
            return ServiceResult<int?>.Failure("Geçersiz üst kategori.");
        }

        var exists = await _dbContext.PoiCategories
            .AsNoTracking()
            .AnyAsync(c => c.Id == parentId.Value, cancellationToken);

        return exists
            ? ServiceResult<int?>.Success(parentId)
            : ServiceResult<int?>.Failure("Üst kategori bulunamadı veya kullanımda değil.");
    }

    /// <summary>
    /// Hiyerarşinin düz projeksiyonu: tek sorgu, yalnızca yol/döngü mantığının
    /// ihtiyaç duyduğu üç alan.
    /// </summary>
    private async Task<IReadOnlyDictionary<int, PoiCategoryHierarchy.Node>> ReadNodesAsync(
        bool includeHidden,
        CancellationToken cancellationToken)
    {
        var query = _dbContext.PoiCategories.AsNoTracking();

        if (includeHidden)
        {
            query = query.IgnoreQueryFilters();
        }

        var nodes = await query
            .Select(c => new { c.Id, c.Name, c.ParentId })
            .ToListAsync(cancellationToken);

        return nodes.ToDictionary(
            n => n.Id,
            n => new PoiCategoryHierarchy.Node(n.Id, n.Name, n.ParentId));
    }

    private async Task<AdminPoiCategoryResponse> ToAdminResponseAsync(int id, CancellationToken cancellationToken)
    {
        var all = await GetAdminCategoriesAsync(cancellationToken);

        return all.Single(item => item.Id == id);
    }

    private static ServiceResult<TOut> Propagate<TIn, TOut>(ServiceResult<TIn> source) => source.ErrorKind switch
    {
        ServiceErrorKind.NotFound => ServiceResult<TOut>.NotFound(source.Error!),
        ServiceErrorKind.Forbidden => ServiceResult<TOut>.Forbidden(source.Error!),
        ServiceErrorKind.Conflict => ServiceResult<TOut>.Conflict(source.Error!),
        _ => ServiceResult<TOut>.Failure(source.Error!)
    };
}
