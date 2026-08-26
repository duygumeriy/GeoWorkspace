using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using NetTopologySuite.Geometries;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Konum analizinin <b>hiyerarşi</b> sözleşmesi: bir ölçüt bir ALT AĞACI
/// temsil eder.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden gerekli.</b> Taksonomi hiyerarşiktir ve içe aktarıcı her dış
/// nesneyi EN ÖZEL kategorisine yazar. Ölçütler yalnızca birebir kategori
/// kimliğiyle eşleşseydi, "Sağlık Kurumları" seçen bir kullanıcı hiçbir
/// eczaneyi göremezdi — eczaneler <c>eczane</c> altında saklanır. Bu dosya o
/// semantiği çivileler.
/// </para>
/// <para>
/// <b>İkinci iddia ÇAKIŞMANIN reddidir.</b> Üst ve alt kategori birlikte
/// seçilirse aynı kayıt iki ölçüte birden düşerdi; istek 400 ile reddedilir ve
/// bu reddin veritabanına POI sorgusu AÇMADAN önce olması gerekir.
/// </para>
/// <para>
/// Taksonomi burada testin kendi kurduğu küçük bir ağaçtır — kanonik slug'lar
/// kullanılır ama ölçülen şey taksonominin içeriği değil, analizin
/// davranışıdır.
/// </para>
/// </remarks>
public class LocationAnalysisHierarchyTests
{
    private const string Ankara = "POLYGON ((32 39, 34 39, 34 41, 32 41, 32 39))";

    /* Kanonik ağacın bir dilimi:

           yeme-icme            saglik-kurumlari      egitim-kurumlari
           ├── kafe             └── eczane            └── okullar
           └── restoran                                  └── ilkokul   (yapay: üçüncü seviye)
    */
    private const string Food = "yeme-icme";
    private const string Cafe = "kafe";
    private const string Restaurant = "restoran";
    private const string Health = "saglik-kurumlari";
    private const string Pharmacy = "eczane";
    private const string Education = "egitim-kurumlari";
    private const string Schools = "okullar";
    private const string PrimarySchool = "ilkokul";

    /* --- Üst kategori toplaması ---------------------------------------------- */

    [Fact]
    public async Task A_parent_criterion_counts_its_own_rows_and_all_descendants()
    {
        await using var db = await NewDbAsync();

        await SeedAsync(db,
            (Food, 3),          // üst kategoriye DOĞRUDAN bağlı kayıtlar
            (Cafe, 8),
            (Restaurant, 5),
            (Health, 2),
            (Pharmacy, 7));

        var result = await AnalyzeAsync(db, Request((Food, 60), (Pharmacy, 40)));

        Assert.True(result.IsSuccess, result.Error);

        /* yeme-icme = 3 (kendi) + 8 (kafe) + 5 (restoran) = 16
           eczane    = 7 — SAĞLIK KÖKÜNÜN kendi 2 kaydı DEĞİL, çünkü kullanıcı
           yalnızca çocuğu seçti. */
        Assert.Equal(16, Criterion(result.Value!, Food).MatchingPoiCount);
        Assert.Equal(7, Criterion(result.Value!, Pharmacy).MatchingPoiCount);

        // 16 × 0.60 = 9.60 ve 7 × 0.40 = 2.80
        Assert.Equal(9.60m, Criterion(result.Value!, Food).WeightedContribution);
        Assert.Equal(2.80m, Criterion(result.Value!, Pharmacy).WeightedContribution);
        Assert.Equal(23, result.Value!.TotalMatchingPoiCount);
        Assert.Equal(12.40m, result.Value.TotalWeightedContribution);
    }

    [Fact]
    public async Task A_parent_with_two_children_counts_both_subtrees()
    {
        await using var db = await NewDbAsync();

        await SeedAsync(db, (Cafe, 4), (Restaurant, 6));

        var result = await AnalyzeAsync(db, Request((Food, 50), (Health, 50)));

        // Üst kategorinin kendi kaydı yok; sayı tamamen iki çocuktan gelir.
        Assert.Equal(10, Criterion(result.Value!, Food).MatchingPoiCount);
        Assert.Equal(0, Criterion(result.Value!, Health).MatchingPoiCount);
    }

    [Fact]
    public async Task Expansion_is_transitive_and_not_limited_to_one_level()
    {
        await using var db = await NewDbAsync();

        // egitim-kurumlari → okullar → ilkokul (üç seviye)
        await SeedAsync(db, (Education, 1), (Schools, 2), (PrimarySchool, 4));

        var result = await AnalyzeAsync(db, Request((Education, 50), (Health, 50)));

        /* Derinlik KODA GÖMÜLMEZ: torunun torunu da sayılır. Bugünkü kanonik
           taksonomi iki seviyelidir ama model daha derinine izin verir. */
        Assert.Equal(7, Criterion(result.Value!, Education).MatchingPoiCount);
        Assert.Equal(3, Criterion(result.Value!, Education).CoveredCategoryCount);
    }

    [Fact]
    public async Task An_intermediate_criterion_counts_only_its_own_subtree()
    {
        await using var db = await NewDbAsync();

        await SeedAsync(db, (Education, 1), (Schools, 2), (PrimarySchool, 4));

        // Ara düğüm seçildi: üstünün doğrudan kaydı (1) HARİÇ, kendisi + torunu.
        var result = await AnalyzeAsync(db, Request((Schools, 50), (Health, 50)));

        Assert.Equal(6, Criterion(result.Value!, Schools).MatchingPoiCount);
        Assert.Equal(2, Criterion(result.Value!, Schools).CoveredCategoryCount);
    }

    /* --- Yaprak davranışı ------------------------------------------------------ */

    [Fact]
    public async Task A_leaf_criterion_counts_neither_its_parent_nor_its_siblings()
    {
        await using var db = await NewDbAsync();

        await SeedAsync(db, (Food, 3), (Cafe, 8), (Restaurant, 5));

        var result = await AnalyzeAsync(db, Request((Cafe, 50), (Health, 50)));

        // Yalnızca kafe: üstün 3 kaydı da kardeşin 5 kaydı da dışarıdadır.
        Assert.Equal(8, Criterion(result.Value!, Cafe).MatchingPoiCount);
        Assert.Equal(1, Criterion(result.Value!, Cafe).CoveredCategoryCount);
        Assert.Equal(8, result.Value!.TotalMatchingPoiCount);
    }

    /* --- Çakışma reddi ---------------------------------------------------------- */

    [Fact]
    public async Task A_parent_and_its_child_together_are_rejected()
    {
        await using var db = await NewDbAsync();
        await SeedAsync(db, (Cafe, 8));

        var result = await AnalyzeAsync(db, Request((Food, 60), (Cafe, 40)));

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
        Assert.Contains(Cafe, result.Error!, StringComparison.Ordinal);
        Assert.Contains(Food, result.Error!, StringComparison.Ordinal);
        Assert.Contains("kapsamındadır", result.Error!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_order_of_the_conflicting_pair_does_not_matter()
    {
        await using var db = await NewDbAsync();

        // Çocuk önce gönderildiğinde de aynı ret gelir.
        var result = await AnalyzeAsync(db, Request((Pharmacy, 40), (Health, 60)));

        Assert.False(result.IsSuccess);
        Assert.Contains("kapsamındadır", result.Error!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_grandparent_and_a_grandchild_together_are_rejected()
    {
        await using var db = await NewDbAsync();

        /* Çakışma denetimi DERİNLİKTEN bağımsızdır: yalnızca doğrudan
           ebeveynliğe bakan bir kontrol bunu kaçırırdı. */
        var result = await AnalyzeAsync(db, Request((Education, 60), (PrimarySchool, 40)));

        Assert.False(result.IsSuccess);
        Assert.Contains("kapsamındadır", result.Error!, StringComparison.Ordinal);
    }

    /* --- Geçerli kombinasyonlar -------------------------------------------------- */

    [Fact]
    public async Task Sibling_criteria_are_valid()
    {
        await using var db = await NewDbAsync();
        await SeedAsync(db, (Cafe, 8), (Restaurant, 5), (Food, 3));

        var result = await AnalyzeAsync(db, Request((Cafe, 50), (Restaurant, 50)));

        Assert.True(result.IsSuccess, result.Error);

        // Kardeşler kesişmez ve üstün DOĞRUDAN kayıtları hiçbirine düşmez.
        Assert.Equal(8, Criterion(result.Value!, Cafe).MatchingPoiCount);
        Assert.Equal(5, Criterion(result.Value!, Restaurant).MatchingPoiCount);
        Assert.Equal(13, result.Value!.TotalMatchingPoiCount);
    }

    [Fact]
    public async Task Unrelated_roots_are_valid()
    {
        await using var db = await NewDbAsync();
        await SeedAsync(db, (Cafe, 4), (Pharmacy, 6));

        var result = await AnalyzeAsync(db, Request((Food, 50), (Health, 50)));

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal(4, Criterion(result.Value!, Food).MatchingPoiCount);
        Assert.Equal(6, Criterion(result.Value!, Health).MatchingPoiCount);
    }

    /* --- Çifte sayım yok ---------------------------------------------------------- */

    [Fact]
    public async Task Every_matching_poi_contributes_to_exactly_one_criterion()
    {
        await using var db = await NewDbAsync();

        await SeedAsync(db,
            (Food, 3), (Cafe, 8), (Restaurant, 5),
            (Health, 2), (Pharmacy, 7),
            (Education, 1), (Schools, 2), (PrimarySchool, 4));

        var result = await AnalyzeAsync(db, Request((Food, 40), (Health, 30), (Schools, 30)));

        var value = result.Value!;

        /* Toplam, seçili alt ağaçlardaki GERÇEK satır sayısına eşittir:
           yeme-icme 16 + saglik 9 (2 + 7) + okullar 6 (2 + 4) = 31.
           egitim-kurumlari'nın doğrudan 1 kaydı hiçbir ölçüte girmez. */
        Assert.Equal(31, value.TotalMatchingPoiCount);
        Assert.Equal(
            value.Criteria.Sum(criterion => criterion.MatchingPoiCount),
            value.TotalMatchingPoiCount);

        var storedRowCount = await db.AnalysisPois.CountAsync();
        Assert.Equal(32, storedRowCount);

        // Tam olarak BİR satır (egitim-kurumlari kökünün kendi kaydı) kapsam dışıdır.
        Assert.Equal(storedRowCount - 1, value.TotalMatchingPoiCount);
    }

    [Fact]
    public async Task Descendant_rows_carry_the_parent_criterion_weight()
    {
        await using var db = await NewDbAsync();

        // Yalnızca TORUN kayıtları var; üst kategorinin doğrudan kaydı yok.
        await SeedAsync(db, (Cafe, 10));

        var result = await AnalyzeAsync(db, Request((Food, 70), (Health, 30)));

        var food = Criterion(result.Value!, Food);

        /* Torunlar üstün ağırlığını alır — kendi ayrı bir ağırlıkları yoktur ve
           kazara eşit dağıtım da yapılmaz. */
        Assert.Equal(0.70m, food.NormalizedWeight);
        Assert.Equal(10, food.MatchingPoiCount);
        Assert.Equal(7.00m, food.WeightedContribution);
        Assert.Equal(7.00m, result.Value!.TotalWeightedContribution);
    }

    /* --- Aktif taksonomi ---------------------------------------------------------- */

    [Fact]
    public async Task A_soft_deleted_descendant_leaves_the_subtree()
    {
        await using var db = await NewDbAsync();
        await SeedAsync(db, (Food, 3), (Cafe, 8), (Restaurant, 5));

        var cafe = await db.PoiCategories.SingleAsync(item => item.Slug == Cafe);
        cafe.IsDeleted = true;
        await db.SaveChangesAsync();

        var result = await AnalyzeAsync(db, Request((Food, 50), (Health, 50)));

        /* Emekliye ayrılmış kategori global query filter'la okunan kümeye hiç
           girmez; ne ölçüt olarak seçilebilir ne de alt ağaca katılır.
           Uygulamanın geri kalanı da o kategoriyi görmüyor — ayrı bir kural
           yazılmaz. */
        Assert.Equal(8, Criterion(result.Value!, Food).MatchingPoiCount);
        Assert.Equal(2, Criterion(result.Value!, Food).CoveredCategoryCount);
    }

    [Fact]
    public async Task An_inactive_category_cannot_be_selected_as_a_criterion()
    {
        await using var db = await NewDbAsync();

        var pharmacy = await db.PoiCategories.SingleAsync(item => item.Slug == Pharmacy);
        pharmacy.IsActive = false;
        await db.SaveChangesAsync();

        var result = await AnalyzeAsync(db, Request((Pharmacy, 50), (Food, 50)));

        Assert.False(result.IsSuccess);
        Assert.Contains(Pharmacy, result.Error!, StringComparison.Ordinal);
    }

    /* --- Kapsam sayacı ------------------------------------------------------------- */

    [Fact]
    public async Task Matched_category_count_explains_what_the_number_covers()
    {
        await using var db = await NewDbAsync();

        var result = await AnalyzeAsync(db, Request((Food, 50), (Pharmacy, 50)));

        // yeme-icme: kendisi + kafe + restoran = 3; eczane: yalnızca kendisi.
        Assert.Equal(3, Criterion(result.Value!, Food).CoveredCategoryCount);
        Assert.Equal(1, Criterion(result.Value!, Pharmacy).CoveredCategoryCount);
    }

    /* --- Yardımcılar ---------------------------------------------------------------- */

    private static LocationAnalysisCriterionResponse Criterion(LocationAnalysisResponse response, string slug) =>
        Assert.Single(response.Criteria, criterion => criterion.CategorySlug == slug);

    /* --- Vektör listesi: ALT AĞAÇ ve TAM YOL ----------------------------------------

       Analiz POI'leri haritada normal POI'lerin kategori rozetleriyle çizilir
       ve kartta tam yol gösterilir. İkisi de kaydın KENDİ kategorisinden
       türer — onu kapsayan ölçütten değil. "Sağlık Kurumları" seçen bir
       kullanıcı haritada hap simgeli eczaneler görmelidir, hepsi aynı
       hastane simgesine düşmemelidir. */

    [Fact]
    public async Task A_root_criterion_returns_its_descendants_with_their_own_identity()
    {
        await using var db = await NewDbAsync();
        await SeedAsync(db, (Health, 1), (Pharmacy, 1), (Schools, 1));

        var result = await ListPointsAsync(db, Request((Health, 50), (Education, 50)));

        Assert.True(result.IsSuccess, result.Error);

        var bySlug = result.Value!.Pois.ToDictionary(poi => poi.CategorySlug);

        Assert.Equal(3, result.Value!.TotalCount);

        /* Torun KENDİ kategorisiyle döner: rozet eczane simgesini, kart da
           tam yolu gösterebilsin diye. */
        Assert.Equal("Sağlık Kurumları / Eczane", bySlug[Pharmacy].CategoryPath);
        Assert.Equal("Eczane", bySlug[Pharmacy].CategoryName);

        Assert.Equal("Eğitim Kurumları / Okullar", bySlug[Schools].CategoryPath);
        Assert.Equal("Okullar", bySlug[Schools].CategoryName);

        // Kökün kendi kaydı da kendi kimliğini korur.
        Assert.Equal("Sağlık Kurumları", bySlug[Health].CategoryPath);
    }

    [Fact]
    public async Task Each_returned_record_carries_a_distinct_category_id_for_its_badge()
    {
        /* Rozet `categoryId` ile çözülür; kapsanan tüm kayıtlar ölçütün
           kimliğini taşısaydı harita tek bir simgeye düşerdi. */
        await using var db = await NewDbAsync();
        await SeedAsync(db, (Health, 1), (Pharmacy, 1));

        var ids = (await ListPointsAsync(db, Request((Health, 50), (Education, 50))))
            .Value!.Pois.Select(poi => poi.CategoryId).ToHashSet();

        Assert.Equal(2, ids.Count);
    }

    [Fact]
    public async Task An_unselected_branch_never_reaches_the_map()
    {
        await using var db = await NewDbAsync();
        await SeedAsync(db, (Health, 1), (Pharmacy, 1), ("kafe", 3));

        var slugs = (await ListPointsAsync(db, Request((Health, 50), (Education, 50))))
            .Value!.Pois.Select(poi => poi.CategorySlug).ToHashSet();

        Assert.DoesNotContain("kafe", slugs);
    }

    private static Task<ServiceResult<LocationAnalysisPointsResponse>> ListPointsAsync(
        AppDbContext db,
        LocationAnalysisRequest request) =>
        new LocationAnalysisService(db, AreaGuards.Unrestricted).ListPointsAsync(request, CancellationToken.None);

    private static LocationAnalysisRequest Request(params (string Slug, int Weight)[] criteria) =>
        new()
        {
            AreaWkts = [Ankara],
            Criteria =
            [
                .. criteria.Select(item => new LocationAnalysisCriterionRequest
                {
                    CategorySlug = item.Slug,
                    Weight = item.Weight
                })
            ]
        };

    private static Task<ServiceResult<LocationAnalysisResponse>> AnalyzeAsync(
        AppDbContext db,
        LocationAnalysisRequest request) =>
        new LocationAnalysisService(db, AreaGuards.Unrestricted).AnalyzeAsync(request, CancellationToken.None);

    /// <summary>Kategori başına N adet, hedef alanın İÇİNDE POI üretir.</summary>
    private static async Task SeedAsync(AppDbContext db, params (string Slug, int Count)[] rows)
    {
        var factory = new GeometryFactory(new PrecisionModel(), 4326);
        var serial = 0;

        foreach (var (slug, count) in rows)
        {
            var category = await db.PoiCategories.SingleAsync(item => item.Slug == slug);

            for (var index = 0; index < count; index++)
            {
                /* Koordinatlar hedef alanın (32..34, 39..41) içinde kalır ve
                   birbirinden ayrıktır; mekânsal yüklem değil HİYERARŞİ
                   ölçülüyor. */
                db.AnalysisPois.Add(new AnalysisPoi
                {
                    Name = $"{slug}-{index}",
                    CategoryId = category.Id,
                    Coordinate = factory.CreatePoint(new Coordinate(
                        32.5 + (serial % 20) * 0.05,
                        39.5 + (serial % 20) * 0.05)),
                    Source = "test",
                    ExternalId = $"node/{++serial}",
                    ImportedAt = DateTime.UtcNow
                });
            }
        }

        await db.SaveChangesAsync();
    }

    /// <summary>Üç seviyeli küçük bir taksonomi kuran in-memory context.</summary>
    private static async Task<AppDbContext> NewDbAsync()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"location-analysis-hierarchy-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

        var db = new AppDbContext(options);

        var food = Add(db, Food, "Yeme-İçme Yerleri", null);
        var health = Add(db, Health, "Sağlık Kurumları", null);
        var education = Add(db, Education, "Eğitim Kurumları", null);
        await db.SaveChangesAsync();

        Add(db, Cafe, "Kafe", food.Id);
        Add(db, Restaurant, "Restoran", food.Id);
        Add(db, Pharmacy, "Eczane", health.Id);
        var schools = Add(db, Schools, "Okullar", education.Id);
        await db.SaveChangesAsync();

        /* Üçüncü seviye kanonik taksonomide bugün YOKTUR; model buna izin
           verdiği için genişletmenin derinlikten bağımsız olduğunu
           kanıtlayabilmek adına test kendi düğümünü ekler. */
        Add(db, PrimarySchool, "İlkokul", schools.Id);
        await db.SaveChangesAsync();

        return db;
    }

    private static PoiCategory Add(AppDbContext db, string slug, string name, int? parentId)
    {
        var category = new PoiCategory { Name = name, Slug = slug, ParentId = parentId };
        db.PoiCategories.Add(category);
        return category;
    }
}
