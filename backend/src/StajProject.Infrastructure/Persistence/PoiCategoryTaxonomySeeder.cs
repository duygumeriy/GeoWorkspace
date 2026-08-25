using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;

namespace StajProject.Infrastructure.Persistence;

/// <summary>
/// Kanonik POI kategori taksonomisinin startup provisioning'i:
/// <see cref="PoiCategoryTaxonomy"/> içindeki kategorilerin veritabanında var
/// olmasını sağlar.
/// </summary>
/// <remarks>
/// <para>
/// <b>Idempotent.</b> Kaç kez çalışırsa çalışsın çift satır üretmez; kimlik
/// olarak her zaman <see cref="PoiCategory.Slug"/> kullanılır, görünen ad
/// değil. Ad zaten değişebilir bir alandır ve ona göre eşleşmek, her yeniden
/// adlandırmadan sonra kategorinin bir kopyasını üretirdi.
/// </para>
/// <para>
/// <b>Hiçbir şey silmez, hiçbir şeyi pasifleştirmez.</b> Katalog dışında kalan
/// kategoriler — yöneticinin elle oluşturdukları dâhil — olduğu gibi bırakılır.
/// POI'lerin <c>kategori_id</c> bağları hiçbir koşulda yeniden yazılmaz.
/// </para>
/// <para>
/// <b>Yöneticinin kararlarını EZMEZ.</b> Var olan bir satırın <c>Name</c> ve
/// <c>ParentId</c> değerlerine dokunulmaz: bir yönetici görünen adı
/// değiştirebilir ya da bir kategoriyi başka bir üstün altına taşıyabilir ve bu
/// bilinçli bir karardır; her yeniden başlatmada geri alınması, yönetim
/// ekranını anlamsız kılardı. <see cref="AuthorizationDataSeeder"/> ile aynı
/// ayrım.
/// </para>
/// <para>
/// <b>Tek istisna: sunum metadatası.</b> <c>IconKey</c> ve <c>ColorHex</c>
/// tazelenir çünkü onların tek kaynağı katalogdur ve haritanın kategori-renk
/// tutarlılığı buna bağlıdır.
/// </para>
/// <para>
/// <b>Kimlikler 1–5 arası mevcut satırlar bu seeder'ın konusu DEĞİLDİR.</b>
/// Onların yeniden adlandırılması ve metadata dolumu <c>migration</c>
/// tarafından, bir kereye mahsus yapılır; seeder onları yalnızca slug ile
/// bulur ve yeniden oluşturmaz.
/// </para>
/// <para>
/// <b>Şema önce gelmelidir.</b> Bu seeder <c>slug</c>, <c>icon_key</c> ve
/// <c>color_hex</c> kolonlarını okur; göç uygulanmamış bir veritabanında
/// çalıştırılırsa açık bir hata verir (bkz. <c>SeedAsync</c>). Proje
/// göçleri elle uygular — <c>Database.Migrate()</c> çağrısı yoktur ve bu
/// seeder de eklemez.
/// </para>
/// </remarks>
public static class PoiCategoryTaxonomySeeder
{
    public static async Task SeedAsync(
        AppDbContext dbContext,
        ILogger logger,
        CancellationToken cancellationToken = default)
    {
        /* İKİ GEÇİŞ zorunludur, bir tercih değil: katalog üstü SLUG ile
           gösterir, veritabanı ise ParentId ister. Bir alt kategorinin üstünün
           kimliği, o üst satır eklenip identity kolonu değerini üretmeden
           BİLİNEMEZ. */
        var existing = await ReadBySlugAsync(dbContext, cancellationToken);

        var createdRoots = await EnsureAsync(
            dbContext, existing, PoiCategoryTaxonomy.Roots, logger, cancellationToken);

        if (createdRoots > 0)
        {
            // Yeni köklerin kimlikleri ikinci geçişte gerekli.
            existing = await ReadBySlugAsync(dbContext, cancellationToken);
        }

        var createdChildren = await EnsureAsync(
            dbContext, existing, PoiCategoryTaxonomy.Children, logger, cancellationToken);

        var refreshed = await RefreshPresentationAsync(dbContext, logger, cancellationToken);

        if (createdRoots + createdChildren + refreshed > 0)
        {
            logger.LogInformation(
                "POI kategori taksonomisi güncellendi: {Roots} kök, {Children} alt kategori eklendi, "
                + "{Refreshed} kategorinin sunum metadatası tazelendi.",
                createdRoots,
                createdChildren,
                refreshed);
        }
    }

    /* --- Okuma ------------------------------------------------------------------ */

    /// <summary>
    /// Tüm kategoriler, slug ile anahtarlanmış.
    /// </summary>
    /// <remarks>
    /// <b><c>IgnoreQueryFilters</c> ZORUNLUDUR.</b> Global filtre pasif ve
    /// silinmiş satırları düşürür; onlar görünmeseydi seeder, kullanımdan
    /// kaldırılmış kanonik bir kategoriyi "eksik" sanıp aynı slug ile ikinci
    /// kez eklemeye çalışır ve tekillik indeksine çarpardı.
    /// </remarks>
    private static async Task<Dictionary<string, PoiCategory>> ReadBySlugAsync(
        AppDbContext dbContext,
        CancellationToken cancellationToken) =>
        await dbContext.PoiCategories
            .IgnoreQueryFilters()
            .ToDictionaryAsync(category => category.Slug, StringComparer.Ordinal, cancellationToken);

    /* --- Ekleme ----------------------------------------------------------------- */

    /// <summary>
    /// Verilen tanımlardan eksik olanları ekler. Var olanlara DOKUNMAZ.
    /// </summary>
    private static async Task<int> EnsureAsync(
        AppDbContext dbContext,
        IReadOnlyDictionary<string, PoiCategory> existing,
        IEnumerable<PoiCategoryTaxonomy.Definition> definitions,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        var created = 0;

        foreach (var definition in definitions)
        {
            if (existing.ContainsKey(definition.Slug))
            {
                // Zaten var: adı ve üstü yöneticinin kararıdır, ezilmez.
                continue;
            }

            int? parentId = null;

            if (definition.ParentSlug is not null)
            {
                if (!existing.TryGetValue(definition.ParentSlug, out var parent))
                {
                    /* Üst bulunamadı. Bu, katalogda tutarsız bir ParentSlug ya
                       da başarısız bir kök eklemesi demektir. Kategoriyi KÖK
                       olarak eklemek, taksonomiyi sessizce bozmak olurdu —
                       satır atlanır ve durum açıkça raporlanır. */
                    logger.LogError(
                        "POI kategorisi eklenemedi: {Slug} için üst kategori {ParentSlug} bulunamadı.",
                        definition.Slug,
                        definition.ParentSlug);

                    continue;
                }

                parentId = parent.Id;
            }

            dbContext.PoiCategories.Add(new PoiCategory
            {
                Name = definition.Name,
                Slug = definition.Slug,
                ParentId = parentId,
                IconKey = definition.IconKey,
                ColorHex = definition.ColorHex,
                IsActive = true,
                IsDeleted = false,
                /* CreatedDate AÇIKÇA damgalanır — PoiCategoryService ile aynı
                   gerekçe: AppDbContext yalnızca ModifiedDate'i yazar. */
                CreatedDate = DateTime.UtcNow
            });

            created++;
        }

        if (created > 0)
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return created;
    }

    /* --- Metadata tazeleme ------------------------------------------------------ */

    /// <summary>
    /// Kanonik satırların simge ve rengini katalogla eşitler.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Yalnızca bu iki alan tazelenir. <c>Name</c> ve <c>ParentId</c> bilinçli
    /// olarak DIŞARIDA bırakılır — bkz. sınıf açıklaması.
    /// </para>
    /// <para>
    /// <b><c>Slug</c> asla yazılmaz.</b> Eşleşme zaten slug üzerinden
    /// yapıldığı için yazılacak bir şey yoktur; teknik kimlik oluşturulduğu
    /// anda dondurulur.
    /// </para>
    /// </remarks>
    private static async Task<int> RefreshPresentationAsync(
        AppDbContext dbContext,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        var bySlug = PoiCategoryTaxonomy.All.ToDictionary(
            definition => definition.Slug,
            StringComparer.Ordinal);

        /* Düz bir List üzerinden filtrelenir. `Dictionary.Keys` bir
           KeyCollection'dır ve sorgu çevirisinde güvenilir biçimde bir SQL
           `IN` listesine dönüşmesi garanti DEĞİLDİR; liste ise her sağlayıcıda
           çevrilir. */
        var canonicalSlugs = bySlug.Keys.ToList();

        // Takip edilen (tracked) varlıklar gerekir: değişiklikler kaydedilecek.
        var rows = await dbContext.PoiCategories
            .IgnoreQueryFilters()
            .Where(category => canonicalSlugs.Contains(category.Slug))
            .ToListAsync(cancellationToken);

        var refreshed = 0;

        foreach (var row in rows)
        {
            var definition = bySlug[row.Slug];

            if (string.Equals(row.IconKey, definition.IconKey, StringComparison.Ordinal)
                && string.Equals(row.ColorHex, definition.ColorHex, StringComparison.Ordinal))
            {
                continue;
            }

            logger.LogInformation(
                "POI kategorisinin sunum metadatası tazelendi: {Slug}.",
                row.Slug);

            row.IconKey = definition.IconKey;
            row.ColorHex = definition.ColorHex;
            refreshed++;
        }

        if (refreshed > 0)
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return refreshed;
    }
}
