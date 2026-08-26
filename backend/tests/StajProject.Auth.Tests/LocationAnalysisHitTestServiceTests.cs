using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using NetTopologySuite.Geometries;
using StajProject.Application.Analysis;
using StajProject.Application.DTOs;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// İsabet testinin <b>sorgu ÖNCESİ</b> davranışı ve etiket anlambilimi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Bu dosya mesafe SEMANTİĞİNİ ölçmez ve ölçemez.</b> Mesafe yüklemi
/// <c>ST_DWithin(geography, …)</c>'e çevrilir; in-memory sağlayıcı onu
/// çalıştıramaz ("the query has switched to client-evaluation"). Mesafenin
/// METRE olduğu ve sıralamanın veritabanında yapıldığı
/// <see cref="LocationAnalysisSqlTranslationTests"/> içinde ÇEVİRİ üzerinden
/// sabitlenir; gerçek satır seçimi ise canlı PostGIS üzerinde doğrulanır.
/// </para>
/// <para>
/// Buradaki testler, sorgu hiç açılmadan verilen kararları ölçer: doğrulama
/// sırası, geçersiz koordinat ve alan/ölçüt kurallarının PAYLAŞILDIĞI.
/// </para>
/// </remarks>
public class LocationAnalysisHitTestServiceTests
{
    /* --- Doğrulama sorgudan ÖNCE gelir ---------------------------------------- */

    [Fact]
    public async Task An_out_of_range_click_is_rejected_before_any_query()
    {
        /* Geçersiz koordinat veritabanına HİÇ gitmez. Gitseydi, eksenleri ters
           gönderen bir istemci sessizce boş sonuç alır ve hatasını hiç
           göremezdi. */
        await using var db = await NewDbAsync();

        var result = await new LocationAnalysisService(db, AreaGuards.Unrestricted).HitTestAsync(Request(longitude: 39.9, latitude: 120));

        Assert.False(result.IsSuccess);
        Assert.Contains("latitude", result.Error!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task An_out_of_range_longitude_is_rejected()
    {
        await using var db = await NewDbAsync();

        var result = await new LocationAnalysisService(db, AreaGuards.Unrestricted).HitTestAsync(Request(longitude: 181, latitude: 39.9));

        Assert.False(result.IsSuccess);
        Assert.Contains("longitude", result.Error!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task The_analysis_rules_are_shared_with_the_summary_endpoint()
    {
        /* İsabet testi kendi alan/ölçüt kurallarını YAZMAZ: aynı doğrulayıcıdan
           geçer. Ağırlık toplamı 100 değilse istek buradan da düşer. */
        await using var db = await NewDbAsync();
        var service = new LocationAnalysisService(db, AreaGuards.Unrestricted);

        var badWeights = Request();
        badWeights.Criteria[0].Weight = 10;
        badWeights.Criteria[1].Weight = 10;

        Assert.False((await service.HitTestAsync(badWeights)).IsSuccess);

        var noArea = Request();
        noArea.AreaWkts = [];

        Assert.False((await service.HitTestAsync(noArea)).IsSuccess);

        var unknownCategory = Request();
        unknownCategory.Criteria[0].CategorySlug = "boyle-bir-kategori-yok";

        Assert.False((await service.HitTestAsync(unknownCategory)).IsSuccess);
    }

    [Fact]
    public async Task A_null_request_is_a_failure_not_a_crash()
    {
        await using var db = await NewDbAsync();

        Assert.False((await new LocationAnalysisService(db, AreaGuards.Unrestricted).HitTestAsync(null!)).IsSuccess);
    }

    /* --- Kaynak etiketi -------------------------------------------------------- */

    [Fact]
    public void The_raw_source_column_is_never_shown_to_the_user()
    {
        /* "osm" bir uygulama ayrıntısıdır. */
        Assert.Equal("OpenStreetMap", LocationAnalysisService.DisplaySource("osm"));
        Assert.Equal("OpenStreetMap", LocationAnalysisService.DisplaySource("OSM"));
    }

    [Fact]
    public void An_unknown_source_passes_through_instead_of_being_invented()
    {
        /* Bilinmeyen bir kaynağa "OpenStreetMap" demek, verinin nereden
           geldiği sorusunu YANLIŞ yanıtlamak olurdu. */
        Assert.Equal("tuik", LocationAnalysisService.DisplaySource("tuik"));
        Assert.Equal(string.Empty, LocationAnalysisService.DisplaySource(null));
    }

    /* --- Kategori etiketi: GERÇEK taksonomi ------------------------------------ */

    [Fact]
    public async Task A_matched_descendant_carries_its_own_full_path()
    {
        /* Kartta gösterilecek etiket, panelin ölçüt seçicisiyle AYNI biçimdir:
           tam yol. Yalın "Okullar" göstermek, kullanıcının seçtiği ölçütle
           kaydın kendi kategorisini ayırt edilemez kılardı — Phase 5B'de
           özet satırlarında düzeltilen karışıklığın aynısı. */
        await using var db = await NewDbAsync();

        var scope = await ResolveAsync(db, "saglik-kurumlari", "egitim-kurumlari");

        Assert.Equal("Sağlık Kurumları / Eczane", scope.PathOf(2));
        Assert.Equal("Eğitim Kurumları / Okullar", scope.PathOf(4));

        /* Kaydın KENDİ kategorisi döner, onu kapsayan ölçüt değil. */
        Assert.Equal("eczane", scope.SlugOf(2));
        Assert.Equal("Eczane", scope.NameOf(2));
        Assert.Equal("okullar", scope.SlugOf(4));
    }

    [Fact]
    public async Task A_root_criterion_expands_to_its_descendants()
    {
        /* Taksonomi genişletmesi YENİDEN YAZILMAZ: isabet testi de özet ve
           rasterle aynı çözücüyü kullanır. "Sağlık Kurumları" seçen bir
           kullanıcı eczaneleri de tıklayabilmelidir. */
        await using var db = await NewDbAsync();

        var scope = await ResolveAsync(db, "saglik-kurumlari", "egitim-kurumlari");

        Assert.Equal([1, 2, 3, 4], scope.MatchedCategoryIds.OrderBy(id => id));
    }

    [Fact]
    public async Task An_unrelated_category_never_enters_the_search_set()
    {
        await using var db = await NewDbAsync();
        db.PoiCategories.Add(new PoiCategory { Id = 5, Slug = "kafe", Name = "Kafe", ParentId = null });
        await db.SaveChangesAsync();

        var scope = await ResolveAsync(db, "saglik-kurumlari", "egitim-kurumlari");

        Assert.DoesNotContain(5, scope.MatchedCategoryIds);
    }

    private static async Task<ResolvedLocationAnalysisCriteria> ResolveAsync(
        AppDbContext db,
        params string[] slugs)
    {
        var criteria = slugs
            .Select(slug => new ValidatedLocationCriterion(slug, 100 / slugs.Length))
            .ToList();

        var result = await new LocationAnalysisCriterionResolver(db).ResolveAsync(criteria, default);

        Assert.True(result.IsSuccess, result.Error);
        return result.Value!;
    }

    /* --- Kurulum -------------------------------------------------------------- */

    private static LocationAnalysisHitTestRequest Request(
        double longitude = 32.85,
        double latitude = 39.92) => new()
    {
        AreaWkts = ["POLYGON ((32 39, 34 39, 34 41, 32 41, 32 39))"],
        Criteria =
        [
            new LocationAnalysisCriterionRequest { CategorySlug = "eczane", Weight = 50 },
            new LocationAnalysisCriterionRequest { CategorySlug = "okullar", Weight = 50 }
        ],
        Longitude = longitude,
        Latitude = latitude,
        ToleranceMeters = 250
    };

    private static async Task<AppDbContext> NewDbAsync()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"hit-test-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

        var db = new AppDbContext(options);

        db.PoiCategories.AddRange(
            new PoiCategory { Id = 1, Slug = "saglik-kurumlari", Name = "Sağlık Kurumları", ParentId = null },
            new PoiCategory { Id = 2, Slug = "eczane", Name = "Eczane", ParentId = 1 },
            new PoiCategory { Id = 3, Slug = "egitim-kurumlari", Name = "Eğitim Kurumları", ParentId = null },
            new PoiCategory { Id = 4, Slug = "okullar", Name = "Okullar", ParentId = 3 });

        await db.SaveChangesAsync();
        return db;
    }
}
