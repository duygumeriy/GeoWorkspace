using Microsoft.EntityFrameworkCore;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Pois;
using StajProject.Domain.Common;
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

    private const string SlugUnusableMessage =
        "Kategori adından geçerli bir teknik kimlik üretilemedi. Ad en az bir harf ya da rakam içermelidir.";

    /* Çakışma mesajı, çakışan slug'ı BİLİNÇLİ olarak yazmaz ve hiçbir koşulda
       veritabanı hata metni taşımaz: istemciye dönen metin, sunucunun kendi
       sözleşmesinin dilidir. */
    private const string SlugConflictMessage =
        "Bu kategori için oluşturulan teknik kimlik zaten kullanılıyor.";

    private const string IconRequiredMessage = "Kategori simgesi zorunludur.";

    private const string IconUnknownMessage =
        "Seçilen kategori simgesi tanınmıyor. Yalnızca tanımlı simgeler kullanılabilir.";

    private const string ColorRequiredMessage = "Kategori rengi zorunludur.";

    private const string ColorInvalidMessage =
        "Kategori rengi #RRGGBB biçiminde olmalıdır (örn. #EF4444).";

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
        var rows = await ReadProjectionsAsync(includeHidden: false, cancellationToken);
        var nodes = ToNodes(rows);

        return
        [
            .. rows
                .Select(row => new PoiCategoryResponse
                {
                    Id = row.Id,
                    Name = row.Name,
                    ParentId = row.ParentId,
                    Path = PoiCategoryHierarchy.BuildPath(nodes, row.Id),
                    Depth = PoiCategoryHierarchy.DepthOf(nodes, row.Id),
                    Slug = row.Slug,
                    IconKey = row.IconKey,
                    ColorHex = row.ColorHex
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
        var rows = await ReadProjectionsAsync(includeHidden: true, cancellationToken);
        var nodes = ToNodes(rows);

        return
        [
            .. rows
                .Select(row => new AdminPoiCategoryResponse
                {
                    Id = row.Id,
                    Name = row.Name,
                    ParentId = row.ParentId,
                    ParentName = row.ParentId is int parentId && nodes.TryGetValue(parentId, out var parent)
                        ? parent.Name
                        : null,
                    Path = PoiCategoryHierarchy.BuildPath(nodes, row.Id),
                    Depth = PoiCategoryHierarchy.DepthOf(nodes, row.Id),
                    CreatedDate = row.CreatedDate,
                    ModifiedDate = row.ModifiedDate,
                    IsActive = row.IsActive,
                    IsDeleted = row.IsDeleted,
                    Slug = row.Slug,
                    IconKey = row.IconKey,
                    ColorHex = row.ColorHex
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

        /* Teknik kimlik BURADA, bir kez üretilir. Güncelleme yolunda karşılığı
           YOKTUR: slug oluşturulduktan sonra değişmez. */
        if (!PoiCategorySlug.TryCreate(name.Value, out var slug))
        {
            return ServiceResult<AdminPoiCategoryResponse>.Failure(SlugUnusableMessage);
        }

        /* Tekillik denetimi filtreyi ATLAR: slug küresel olarak tekildir ve
           pasif ya da silinmiş bir satırın kimliği de yeniden kullanılamaz.
           Filtreli bir sorgu, gizli bir satırla çakışan slug'ı "boşta" gibi
           gösterir ve kaçınılmaz olarak veritabanı indeks ihlaline düşerdi. */
        var slugTaken = await _dbContext.PoiCategories
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(c => c.Slug == slug, cancellationToken);

        if (slugTaken)
        {
            return ServiceResult<AdminPoiCategoryResponse>.Conflict(SlugConflictMessage);
        }

        var presentation = ValidatePresentation(request.IconKey, request.ColorHex);

        if (!presentation.IsSuccess)
        {
            return Propagate<PresentationMetadata, AdminPoiCategoryResponse>(presentation);
        }

        var category = new PoiCategory
        {
            Name = name.Value!,
            ParentId = parent.Value,
            Slug = slug,
            IconKey = presentation.Value!.IconKey,
            ColorHex = presentation.Value.ColorHex,
            IsActive = true,
            IsDeleted = false,
            /* CreatedDate AÇIKÇA damgalanır: AppDbContext yalnızca
               ModifiedDate'i IAuditableEntity üzerinden yazar, CreatedDate
               otomatiği çizim arayüzüne bağlıdır ve POI onu uygulamaz. */
            CreatedDate = DateTime.UtcNow
        };

        _dbContext.PoiCategories.Add(category);

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            /* Yukarıdaki denetim ile yazma arasında başka bir istek aynı slug'ı
               almış olabilir. Tekilliğin GERÇEK garantisi veritabanı indeksidir;
               buradaki yakalama yalnızca o garantiyi, sağlayıcıya özgü hata
               metnini istemciye sızdırmadan projenin kendi çakışma
               sözleşmesine çevirir. */
            _dbContext.Entry(category).State = EntityState.Detached;

            return ServiceResult<AdminPoiCategoryResponse>.Conflict(SlugConflictMessage);
        }

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
            var nodes = ToNodes(await ReadProjectionsAsync(includeHidden: true, cancellationToken));

            if (PoiCategoryHierarchy.WouldCreateCycle(nodes, category.Id, parent.Value))
            {
                return ServiceResult<AdminPoiCategoryResponse>.Failure(CycleMessage);
            }

            category.ParentId = parent.Value;
        }

        var presentation = ValidatePresentation(request.IconKey, request.ColorHex);

        if (!presentation.IsSuccess)
        {
            return Propagate<PresentationMetadata, AdminPoiCategoryResponse>(presentation);
        }

        category.Name = name.Value!;
        category.IsActive = request.IsActive;
        category.IconKey = presentation.Value!.IconKey;
        category.ColorHex = presentation.Value.ColorHex;

        /* category.Slug'a DOKUNULMAZ. Ad değişse bile teknik kimlik korunur:
           GeoServer stil kuralı slug'a göre eşleşir ve yeniden adlandırma o
           kuralı sahipsiz bırakmamalıdır. Slug, güncelleme sözleşmesinde de
           yoktur — istemci onu gönderemez. */

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

    /// <summary>Doğrulanmış ve kanonikleştirilmiş sunum metadatası.</summary>
    private sealed record PresentationMetadata(string IconKey, string ColorHex);

    /// <summary>Tek satırın düz projeksiyonu.</summary>
    private sealed record CategoryProjection(
        int Id,
        string Name,
        int? ParentId,
        string Slug,
        string? IconKey,
        string? ColorHex,
        DateTime CreatedDate,
        DateTime ModifiedDate,
        bool IsActive,
        bool IsDeleted);

    /// <summary>
    /// Simge ve rengi doğrular; renk kanonik biçime çevrilir.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>İkisi de ZORUNLUDUR.</b> Bu uçlar değiştirme (replacement)
    /// semantiğine sahiptir — <c>isActive</c> zaten her istekte tam olarak
    /// bildirilir — dolayısıyla atlanan bir metadata alanı "değiştirme"
    /// anlamına gelemez; öyle sayılsaydı, kısmi bir istek kategorinin simgesini
    /// ve rengini sessizce silerdi.
    /// </para>
    /// <para>
    /// <b>Simge doğrulaması bir ÜYELİK sorusudur, desen eşleştirmesi değil.</b>
    /// Bu değer ileride hem bir bileşen aramasına hem de bir SLD dosya yoluna
    /// girecektir; kapalı bir küme, dizin geçişi (<c>../</c>), URL ve
    /// <c>&lt;svg&gt;</c> gövdesi gibi girdilerin tamamını tek bir kuralla ve
    /// yapısal olarak dışarıda bırakır.
    /// </para>
    /// </remarks>
    private static ServiceResult<PresentationMetadata> ValidatePresentation(string? iconKey, string? colorHex)
    {
        var icon = (iconKey ?? string.Empty).Trim();

        if (icon.Length == 0)
        {
            return ServiceResult<PresentationMetadata>.Failure(IconRequiredMessage);
        }

        if (!PoiCategoryIcons.IsApproved(icon))
        {
            return ServiceResult<PresentationMetadata>.Failure(IconUnknownMessage);
        }

        if (string.IsNullOrWhiteSpace(colorHex))
        {
            return ServiceResult<PresentationMetadata>.Failure(ColorRequiredMessage);
        }

        return PoiCategoryColor.TryCanonicalize(colorHex, out var canonicalColor)
            ? ServiceResult<PresentationMetadata>.Success(new PresentationMetadata(icon, canonicalColor))
            : ServiceResult<PresentationMetadata>.Failure(ColorInvalidMessage);
    }

    /// <summary>
    /// Kategorilerin düz projeksiyonu: TEK sorgu. Ağaç <c>Include</c> ile
    /// kurulmaz — derinlik kadar sorgu (ya da kartezyen bir sonuç) üretirdi ve
    /// derinliğin üst sınırı yoktur.
    /// </summary>
    private async Task<IReadOnlyList<CategoryProjection>> ReadProjectionsAsync(
        bool includeHidden,
        CancellationToken cancellationToken)
    {
        var query = _dbContext.PoiCategories.AsNoTracking();

        if (includeHidden)
        {
            query = query.IgnoreQueryFilters();
        }

        return await query
            .Select(c => new CategoryProjection(
                c.Id,
                c.Name,
                c.ParentId,
                c.Slug,
                c.IconKey,
                c.ColorHex,
                c.CreatedDate,
                c.ModifiedDate,
                c.IsActive,
                c.IsDeleted))
            .ToListAsync(cancellationToken);
    }

    /// <summary>
    /// Yol/döngü mantığının ihtiyaç duyduğu üç alana indirger. Hiyerarşi
    /// kuralları <see cref="PoiCategoryHierarchy"/> içinde saf kalır.
    /// </summary>
    private static IReadOnlyDictionary<int, PoiCategoryHierarchy.Node> ToNodes(
        IReadOnlyList<CategoryProjection> rows) =>
        rows.ToDictionary(
            row => row.Id,
            row => new PoiCategoryHierarchy.Node(row.Id, row.Name, row.ParentId));

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
