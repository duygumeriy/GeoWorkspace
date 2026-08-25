using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Auth.Tests;

/// <summary>
/// <see cref="PoiCategoryTaxonomySeeder"/> davranışı: idempotency, slug ile
/// eşleşme ve yöneticinin kararlarının korunması.
/// </summary>
/// <remarks>
/// <b>Testlerin ağırlığı "ne YAPMADIĞI" üzerindedir.</b> Bir seeder'ın eksik
/// satır eklemesi kolay doğrulanır; asıl risk, her yeniden başlatmada
/// yöneticinin yaptığı bir düzenlemeyi sessizce geri alması ya da aynı
/// kategoriyi ikinci kez eklemesidir.
/// </remarks>
public class PoiCategoryTaxonomySeederTests
{
    private static AppDbContext NewDb() =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"poi-taxonomy-{Guid.NewGuid():N}")
            .Options);

    private static Task SeedAsync(AppDbContext db) =>
        PoiCategoryTaxonomySeeder.SeedAsync(db, NullLogger.Instance);

    private static Task<List<PoiCategory>> AllAsync(AppDbContext db) =>
        db.PoiCategories.IgnoreQueryFilters().ToListAsync();

    /* --- Temiz kurulum ------------------------------------------------------------ */

    [Fact]
    public async Task A_clean_database_receives_the_entire_canonical_taxonomy()
    {
        await using var db = NewDb();

        await SeedAsync(db);

        var rows = await AllAsync(db);

        Assert.Equal(44, rows.Count);
        Assert.Equal(27, rows.Count(row => row.ParentId is null));
        Assert.Equal(17, rows.Count(row => row.ParentId is not null));

        Assert.Equal(
            PoiCategoryTaxonomy.All.Select(item => item.Slug).OrderBy(slug => slug, StringComparer.Ordinal),
            rows.Select(row => row.Slug).OrderBy(slug => slug, StringComparer.Ordinal));
    }

    [Fact]
    public async Task Newly_inserted_children_point_at_their_canonical_parent()
    {
        /* İki geçişli algoritmanın ASIL sınaması: üst kimlikleri ancak kökler
           kaydedilip identity değerleri üretildikten sonra bilinebilir. */
        await using var db = NewDb();

        await SeedAsync(db);

        var bySlug = (await AllAsync(db)).ToDictionary(row => row.Slug, StringComparer.Ordinal);

        Assert.Equal(bySlug["finansal-kurumlar"].Id, bySlug["banka-ve-atm"].ParentId);
        Assert.Equal(bySlug["saglik-kurumlari"].Id, bySlug["eczane"].ParentId);
        Assert.Equal(bySlug["alisveris"].Id, bySlug["zincir-marketler"].ParentId);
        Assert.Equal(bySlug["resmi-kurum"].Id, bySlug["epdk"].ParentId);
        Assert.Equal(bySlug["yeme-icme"].Id, bySlug["kafe"].ParentId);
    }

    [Fact]
    public async Task Seeded_categories_carry_their_catalog_metadata()
    {
        await using var db = NewDb();

        await SeedAsync(db);

        var bySlug = (await AllAsync(db)).ToDictionary(row => row.Slug, StringComparer.Ordinal);

        Assert.Equal("pill", bySlug["eczane"].IconKey);
        Assert.Equal(PoiCategoryPalette.Health, bySlug["eczane"].ColorHex);
        Assert.Equal("badge-dollar-sign", bySlug["finansal-kurumlar"].IconKey);
        Assert.True(bySlug["eczane"].IsActive);
        Assert.False(bySlug["eczane"].IsDeleted);
        Assert.NotEqual(default, bySlug["eczane"].CreatedDate);
    }

    /* --- Idempotency -------------------------------------------------------------- */

    [Fact]
    public async Task A_second_run_changes_nothing()
    {
        await using var db = NewDb();

        await SeedAsync(db);
        var first = (await AllAsync(db))
            .Select(row => (row.Id, row.Slug, row.Name, row.ParentId))
            .OrderBy(row => row.Id)
            .ToList();

        await SeedAsync(db);
        var second = (await AllAsync(db))
            .Select(row => (row.Id, row.Slug, row.Name, row.ParentId))
            .OrderBy(row => row.Id)
            .ToList();

        Assert.Equal(first, second);
    }

    [Fact]
    public async Task Repeated_runs_never_duplicate_a_slug()
    {
        await using var db = NewDb();

        await SeedAsync(db);
        await SeedAsync(db);
        await SeedAsync(db);

        var slugs = (await AllAsync(db)).Select(row => row.Slug).ToList();

        Assert.Equal(44, slugs.Count);
        Assert.Equal(slugs.Count, slugs.Distinct(StringComparer.Ordinal).Count());
    }

    /* --- Göç edilmiş satırların yeniden kullanımı ---------------------------------- */

    [Fact]
    public async Task Categories_already_present_by_slug_are_reused_not_duplicated()
    {
        /* Göç sonrası gerçek durum: beş satır zaten vardır ve KİMLİKLERİ
           korunmuştur. Seeder onları slug ile bulmalı ve yeniden
           OLUŞTURMAMALIDIR — aksi hâlde POI'lerin bağlı olduğu kategoriler
           envanterde ikiye bölünürdü. */
        await using var db = NewDb();

        db.PoiCategories.AddRange(
            new PoiCategory { Name = "Yeme-İçme Yerleri", Slug = "yeme-icme", IconKey = "utensils", ColorHex = "#F97316", CreatedDate = DateTime.UtcNow },
            new PoiCategory { Name = "Eğlence Yerleri", Slug = "eglence-yerleri", IconKey = "party-popper", ColorHex = "#EC4899", CreatedDate = DateTime.UtcNow });
        await db.SaveChangesAsync();

        var originalIds = (await AllAsync(db)).ToDictionary(row => row.Slug, row => row.Id, StringComparer.Ordinal);

        await SeedAsync(db);

        var rows = await AllAsync(db);

        Assert.Equal(44, rows.Count);
        Assert.Single(rows, row => row.Slug == "yeme-icme");
        Assert.Single(rows, row => row.Slug == "eglence-yerleri");

        // Kimlikler DEĞİŞMEZ: POI foreign key'leri onlara bağlıdır.
        Assert.Equal(originalIds["yeme-icme"], rows.Single(row => row.Slug == "yeme-icme").Id);
        Assert.Equal(originalIds["eglence-yerleri"], rows.Single(row => row.Slug == "eglence-yerleri").Id);
    }

    [Fact]
    public async Task An_inactive_canonical_category_is_not_inserted_a_second_time()
    {
        /* Global query filter pasif satırları düşürür. Seeder filtreyi
           atlamasaydı bu kategoriyi "eksik" sanır ve aynı slug ile ikinci kez
           eklemeye çalışıp tekillik indeksine çarpardı. */
        await using var db = NewDb();

        db.PoiCategories.Add(new PoiCategory
        {
            Name = "Eczane",
            Slug = "eczane",
            IsActive = false,
            CreatedDate = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        await SeedAsync(db);

        var rows = await AllAsync(db);

        Assert.Single(rows, row => row.Slug == "eczane");
        Assert.Equal(44, rows.Count);

        // Pasifleştirme yönetimsel bir karardır; seeder onu geri almaz.
        Assert.False(rows.Single(row => row.Slug == "eczane").IsActive);
    }

    [Fact]
    public async Task A_soft_deleted_canonical_category_is_neither_duplicated_nor_revived()
    {
        await using var db = NewDb();

        db.PoiCategories.Add(new PoiCategory
        {
            Name = "Okullar",
            Slug = "okullar",
            IsDeleted = true,
            CreatedDate = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        await SeedAsync(db);

        var row = (await AllAsync(db)).Single(item => item.Slug == "okullar");

        Assert.True(row.IsDeleted);
    }

    /* --- Yöneticinin kararlarının korunması ---------------------------------------- */

    [Fact]
    public async Task A_display_name_changed_by_an_admin_is_preserved()
    {
        /* Slug teknik kimliktir ve sabittir; AD ise yönetimsel bir tercihtir.
           Seeder adı katalogdakine geri çekseydi, yönetim ekranındaki her
           yeniden adlandırma bir sonraki yeniden başlatmada kaybolurdu. */
        await using var db = NewDb();

        await SeedAsync(db);

        var eczane = await db.PoiCategories.IgnoreQueryFilters().SingleAsync(row => row.Slug == "eczane");
        eczane.Name = "Eczaneler ve Nöbetçi Eczaneler";
        await db.SaveChangesAsync();

        await SeedAsync(db);

        var after = await db.PoiCategories.IgnoreQueryFilters().SingleAsync(row => row.Slug == "eczane");

        Assert.Equal("Eczaneler ve Nöbetçi Eczaneler", after.Name);
        Assert.Equal("eczane", after.Slug);
    }

    [Fact]
    public async Task A_parent_changed_by_an_admin_is_preserved()
    {
        await using var db = NewDb();

        await SeedAsync(db);

        var bySlug = (await AllAsync(db)).ToDictionary(row => row.Slug, StringComparer.Ordinal);
        var eczane = await db.PoiCategories.IgnoreQueryFilters().SingleAsync(row => row.Slug == "eczane");

        // Yönetici eczaneyi ticaret altına taşımış olsun.
        eczane.ParentId = bySlug["ticaret-alanlari"].Id;
        await db.SaveChangesAsync();

        await SeedAsync(db);

        var after = await db.PoiCategories.IgnoreQueryFilters().SingleAsync(row => row.Slug == "eczane");

        Assert.Equal(bySlug["ticaret-alanlari"].Id, after.ParentId);
    }

    [Fact]
    public async Task Non_canonical_categories_are_left_untouched()
    {
        /* Yöneticinin elle oluşturduğu kategoriler taksonominin dışındadır.
           Seeder hiçbir şeyi silmez, pasifleştirmez ya da yeniden
           konumlandırmaz. */
        await using var db = NewDb();

        db.PoiCategories.Add(new PoiCategory
        {
            Name = "Elle Eklenen",
            Slug = "elle-eklenen",
            IconKey = "map-pin",
            ColorHex = "#123456",
            CreatedDate = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        await SeedAsync(db);

        var row = (await AllAsync(db)).Single(item => item.Slug == "elle-eklenen");

        Assert.Equal("Elle Eklenen", row.Name);
        Assert.Null(row.ParentId);
        Assert.Equal("#123456", row.ColorHex);
        Assert.True(row.IsActive);
        Assert.False(row.IsDeleted);
        Assert.Equal(45, (await AllAsync(db)).Count);
    }

    /* --- Metadata tazeleme --------------------------------------------------------- */

    [Fact]
    public async Task Presentation_metadata_is_refreshed_from_the_catalog()
    {
        /* Simge ve rengin tek kaynağı katalogdur: haritanın kategori-renk
           tutarlılığı buna bağlıdır. Ad ve üstün aksine bunlar tazelenir. */
        await using var db = NewDb();

        await SeedAsync(db);

        var eczane = await db.PoiCategories.IgnoreQueryFilters().SingleAsync(row => row.Slug == "eczane");
        eczane.IconKey = "map-pin";
        eczane.ColorHex = "#000000";
        await db.SaveChangesAsync();

        await SeedAsync(db);

        var after = await db.PoiCategories.IgnoreQueryFilters().SingleAsync(row => row.Slug == "eczane");

        Assert.Equal("pill", after.IconKey);
        Assert.Equal(PoiCategoryPalette.Health, after.ColorHex);
    }

    [Fact]
    public async Task Metadata_missing_on_a_migrated_row_is_filled_in()
    {
        /* Göç, bilinmeyen satırlara metadata ATAMAZ (icon_key/color_hex NULL
           kalır). Böyle bir satır kanonik bir slug taşıyorsa seeder eksiği
           tamamlar. */
        await using var db = NewDb();

        db.PoiCategories.Add(new PoiCategory
        {
            Name = "Konser Alanı",
            Slug = "konser-alani",
            IconKey = null,
            ColorHex = null,
            CreatedDate = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        await SeedAsync(db);

        var row = await db.PoiCategories.IgnoreQueryFilters().SingleAsync(item => item.Slug == "konser-alani");

        Assert.Equal("music", row.IconKey);
        Assert.Equal(PoiCategoryPalette.Social, row.ColorHex);
    }

    [Fact]
    public async Task The_seeder_never_removes_a_category()
    {
        await using var db = NewDb();

        db.PoiCategories.Add(new PoiCategory
        {
            Name = "Kaybolmamalı",
            Slug = "kaybolmamali",
            CreatedDate = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        await SeedAsync(db);
        await SeedAsync(db);

        Assert.Contains(await AllAsync(db), row => row.Slug == "kaybolmamali");
    }
}
