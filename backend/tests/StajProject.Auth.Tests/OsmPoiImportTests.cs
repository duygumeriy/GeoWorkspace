using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using NetTopologySuite.Geometries;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.OsmPoiImporter;

namespace StajProject.Auth.Tests;

/// <summary>
/// OSM içe aktarıcısının eşleme, geometri ve idempotens sözleşmesi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Girdi elle yazılmış küçük bir OSM XML çıkarımıdır</b>
/// (<c>Fixtures/osm-import-fixture.osm</c>): gerçek OSM verisi indirilmez ve
/// hiçbir ağ isteği yapılmaz. Biçim gerçektir, içerik uydurmadır.
/// </para>
/// <para>
/// <b>İddialar KESİNDİR.</b> "satır sayısı > 0" gibi bir kontrol, kategori
/// eşlemesi tamamen yanlışken de yeşil kalırdı; bu yüzden her nesne için dış
/// kimlik, kanonik slug, ad (ya da null) ve koordinat tek tek doğrulanır.
/// Eşleme doğruluğu bu fazın çekirdeğidir.
/// </para>
/// </remarks>
public class OsmPoiImportTests
{
    private static readonly string FixturePath = FindFixture();

    /* --- Yüksek güvenli eşlemeler ------------------------------------------------ */

    [Theory]
    [InlineData("node/101", "okullar", "Atatürk İlkokulu")]
    [InlineData("node/103", "kafe", "Köşe Kahve")]
    [InlineData("node/104", "restoran", "Anadolu Lokantası")]
    [InlineData("node/105", "banka-ve-atm", "Ziraat Bankası Kızılay")]
    [InlineData("node/107", "arac-sarj-istasyonlari", "Şarj Noktası")]
    [InlineData("node/108", "giyim-magazalari", "Moda Giyim")]
    public async Task High_confidence_tags_map_to_their_canonical_category(
        string externalId,
        string expectedSlug,
        string expectedName)
    {
        await using var db = await ImportFixtureAsync();

        var row = await RowAsync(db, externalId);

        Assert.Equal(expectedSlug, await SlugOfAsync(db, row));
        Assert.Equal(expectedName, row.Name);
        Assert.Equal(OsmCategoryMap.SourceName, row.Source);
    }

    [Fact]
    public async Task An_atm_node_maps_to_the_same_category_as_a_bank()
    {
        await using var db = await ImportFixtureAsync();

        // Tek kategori, iki farklı etiket — ayrı satırlar ama aynı slug.
        Assert.Equal("banka-ve-atm", await SlugOfAsync(db, await RowAsync(db, "node/106")));
        Assert.Equal("banka-ve-atm", await SlugOfAsync(db, await RowAsync(db, "node/105")));
    }

    /* --- En özel kategori kazanır -------------------------------------------------- */

    [Fact]
    public async Task A_pharmacy_maps_to_the_child_not_the_health_root()
    {
        await using var db = await ImportFixtureAsync();

        var row = await RowAsync(db, "node/102");

        /* Nesne hem `amenity=pharmacy` hem `healthcare=pharmacy` taşır. Torun
           kazanır: köke yazmak, `eczane` alt kategorisini boş bırakır ve
           kullanıcı "Eczane" seçtiğinde hiçbir sonuç dönmezdi. */
        Assert.Equal("eczane", await SlugOfAsync(db, row));
        Assert.NotEqual("saglik-kurumlari", await SlugOfAsync(db, row));
    }

    [Fact]
    public async Task A_cafe_maps_to_kafe_not_the_food_root()
    {
        await using var db = await ImportFixtureAsync();

        /* Üst kategori toplaması ANALİZDE yapılır (Phase 2B): `yeme-icme`
           seçildiğinde `kafe` zaten kapsanır. Köke yazmak çifte sayım üretirdi. */
        Assert.Equal("kafe", await SlugOfAsync(db, await RowAsync(db, "node/103")));
    }

    [Fact]
    public async Task One_external_feature_produces_exactly_one_row()
    {
        await using var db = await ImportFixtureAsync();

        /* Phase 2B'nin değişmezi: aynı dış nesne için hem alt hem üst
           kategoriye satır YAZILMAZ. */
        Assert.Single(await db.AnalysisPois.Where(poi => poi.ExternalId == "node/102").ToListAsync());
        Assert.Single(await db.AnalysisPois.Where(poi => poi.ExternalId == "node/103").ToListAsync());

        var externalIds = await db.AnalysisPois.Select(poi => poi.ExternalId).ToListAsync();
        Assert.Equal(externalIds.Count, externalIds.Distinct(StringComparer.Ordinal).Count());
    }

    /* --- İlgisiz çoklu eşleşme ------------------------------------------------------ */

    [Fact]
    public async Task Unrelated_tags_that_share_a_category_resolve_to_one_row()
    {
        await using var db = await ImportFixtureAsync();

        // amenity=fuel + shop=car_repair → ikisi de otomotiv-sektoru.
        var row = await RowAsync(db, "node/109");

        Assert.Equal("otomotiv-sektoru", await SlugOfAsync(db, row));
    }

    [Fact]
    public async Task Unrelated_categories_with_equal_specificity_are_skipped_not_guessed()
    {
        var (db, statistics) = await ImportFixtureWithStatsAsync();
        await using var _db = db;

        /* amenity=restaurant + shop=clothes: iki İLGİSİZ kategori, aynı
           özgüllük. Tahmin etmek, yoğunluk haritasında sessizce yanlış bir
           sonuç üretirdi; atlanan nesne ise istatistikte görünür. */
        Assert.Empty(await db.AnalysisPois.Where(poi => poi.ExternalId == "node/110").ToListAsync());
        Assert.Equal(1, statistics.Skipped.GetValueOrDefault(ImportSkipReason.AmbiguousMapping));
    }

    /* --- Atlama sebepleri ------------------------------------------------------------ */

    [Fact]
    public async Task An_unmapped_tag_is_skipped_and_never_falls_back_to_a_junk_category()
    {
        var (db, statistics) = await ImportFixtureWithStatsAsync();
        await using var _db = db;

        Assert.Empty(await db.AnalysisPois.Where(poi => poi.ExternalId == "node/111").ToListAsync());
        Assert.True(statistics.Skipped.GetValueOrDefault(ImportSkipReason.UnmappedTag) >= 1);

        // `onemli-noktalar` bir çöp kutusu DEĞİLDİR ve hiçbir satır almaz.
        Assert.DoesNotContain("onemli-noktalar", statistics.RowsPerSlug.Keys);
    }

    [Fact]
    public async Task An_out_of_range_coordinate_is_skipped()
    {
        var (db, statistics) = await ImportFixtureWithStatsAsync();
        await using var _db = db;

        Assert.Empty(await db.AnalysisPois.Where(poi => poi.ExternalId == "node/112").ToListAsync());
        Assert.Equal(1, statistics.Skipped.GetValueOrDefault(ImportSkipReason.InvalidCoordinate));
    }

    [Fact]
    public async Task An_unclosed_way_is_not_treated_as_an_area()
    {
        var (db, statistics) = await ImportFixtureWithStatsAsync();
        await using var _db = db;

        // Açık bir yol bir alan değildir; ilk noktayı sona ekleyip halka
        // UYDURULMAZ.
        Assert.Empty(await db.AnalysisPois.Where(poi => poi.ExternalId == "way/303").ToListAsync());
        Assert.True(statistics.Skipped.GetValueOrDefault(ImportSkipReason.IncompleteGeometry) >= 1);
    }

    [Fact]
    public async Task A_point_only_rule_rejects_an_area_geometry()
    {
        var (db, statistics) = await ImportFixtureWithStatsAsync();
        await using var _db = db;

        /* ATM alan olarak çizilmez; etiket tanınsa bile bu geometriyle
           anlamsızdır ve sebebiyle atlanır. */
        Assert.Empty(await db.AnalysisPois.Where(poi => poi.ExternalId == "way/301").ToListAsync());
        Assert.Equal(1, statistics.Skipped.GetValueOrDefault(ImportSkipReason.UnsupportedAreaFeature));
    }

    [Fact]
    public async Task A_non_multipolygon_relation_is_skipped()
    {
        var (db, statistics) = await ImportFixtureWithStatsAsync();
        await using var _db = db;

        Assert.Empty(await db.AnalysisPois.Where(poi => poi.ExternalId == "relation/402").ToListAsync());
        Assert.Equal(1, statistics.Skipped.GetValueOrDefault(ImportSkipReason.UnsupportedGeometry));
    }

    /* --- Geometri ---------------------------------------------------------------------- */

    [Fact]
    public async Task A_node_keeps_its_exact_coordinate_without_swapping_lat_and_lon()
    {
        await using var db = await ImportFixtureAsync();

        var row = await RowAsync(db, "node/101");

        // lon = X = 32.85, lat = Y = 39.93 — sıra karıştırılmaz.
        Assert.Equal(32.8500, row.Coordinate.X, 6);
        Assert.Equal(39.9300, row.Coordinate.Y, 6);
        Assert.Equal(4326, row.Coordinate.SRID);
    }

    [Fact]
    public async Task A_closed_way_becomes_a_representative_point_inside_the_area()
    {
        await using var db = await ImportFixtureAsync();

        var row = await RowAsync(db, "way/302");

        Assert.Equal("yesil-alanlar", await SlugOfAsync(db, row));
        Assert.Equal("Kurtuluş Parkı", row.Name);

        // Nokta poligonun İÇİNDE olmalı (32.80..32.81, 39.90..39.91).
        Assert.InRange(row.Coordinate.X, 32.8000, 32.8100);
        Assert.InRange(row.Coordinate.Y, 39.9000, 39.9100);
    }

    [Fact]
    public async Task A_multipolygon_relation_becomes_a_representative_point()
    {
        await using var db = await ImportFixtureAsync();

        var row = await RowAsync(db, "relation/401");

        Assert.Equal("saglik-kurumlari", await SlugOfAsync(db, row));
        Assert.InRange(row.Coordinate.X, 32.7800, 32.7900);
        Assert.InRange(row.Coordinate.Y, 39.8800, 39.8850);
    }

    [Fact]
    public void An_interior_point_of_a_c_shaped_polygon_stays_inside_it()
    {
        /* Ağırlık merkezi (centroid) içbükey bir alanın DIŞINA düşebilir ve o
           zaman POI, temsil ettiği tesisin dışında görünürdü. Bu C biçimli
           poligon tam da o durumu üretir. */
        var factory = new GeometryFactory(new PrecisionModel(), 4326);
        var shell = factory.CreateLinearRing(
        [
            new Coordinate(0, 0), new Coordinate(3, 0), new Coordinate(3, 1),
            new Coordinate(1, 1), new Coordinate(1, 2), new Coordinate(3, 2),
            new Coordinate(3, 3), new Coordinate(0, 3), new Coordinate(0, 0)
        ]);
        var polygon = factory.CreatePolygon(shell);

        var representative = AnalysisPoiImporter.RepresentativePoint(polygon);

        Assert.NotNull(representative);
        Assert.True(polygon.Covers(representative), "Temsilî nokta poligonun dışına düştü.");
        Assert.False(polygon.Covers(polygon.Centroid), "Bu poligonun centroid'i zaten içeride — fikstür anlamını yitirmiş.");
    }

    /* --- Ad ------------------------------------------------------------------------------ */

    [Fact]
    public async Task An_unnamed_feature_keeps_a_null_name()
    {
        await using var db = await ImportFixtureAsync();

        var pharmacy = await RowAsync(db, "node/102");
        var atm = await RowAsync(db, "node/106");

        // "İsimsiz Eczane #123" gibi bir ad UYDURULMAZ; şema null kabul eder.
        Assert.Null(pharmacy.Name);
        Assert.Null(atm.Name);
    }

    /* --- İstatistikler --------------------------------------------------------------------- */

    [Fact]
    public async Task Rows_per_slug_matches_the_fixture_exactly()
    {
        var (db, statistics) = await ImportFixtureWithStatsAsync();
        await using var _db = db;

        /* Kategori dağılımı, eşlemenin BİRİNCİL sağlık göstergesidir: umbrella
           bir kategori dolup alt kategoriler boş kalsaydı yalnızca burada
           görünürdü. */
        var expected = new Dictionary<string, int>(StringComparer.Ordinal)
        {
            ["okullar"] = 1,
            ["eczane"] = 1,
            ["kafe"] = 1,
            ["restoran"] = 1,
            ["banka-ve-atm"] = 2,
            ["arac-sarj-istasyonlari"] = 1,
            ["giyim-magazalari"] = 1,
            ["otomotiv-sektoru"] = 1,
            ["yesil-alanlar"] = 1,
            ["saglik-kurumlari"] = 1
        };

        Assert.Equal(
            expected.OrderBy(pair => pair.Key, StringComparer.Ordinal),
            statistics.RowsPerSlug.OrderBy(pair => pair.Key, StringComparer.Ordinal));

        Assert.Equal(11, statistics.Mapped);
        Assert.Equal(11, statistics.Inserted);
        Assert.Equal(11, await db.AnalysisPois.CountAsync());
    }

    [Fact]
    public async Task Skip_reasons_are_broken_down_rather_than_lumped_together()
    {
        var (db, statistics) = await ImportFixtureWithStatsAsync();
        await using var _db = db;

        // Tek bir "atlandı: 6" sayısı, eşlemeyi düzeltmek için hiçbir şey söylemezdi.
        Assert.True(statistics.Skipped.Count >= 4);
        Assert.Equal(statistics.TotalSkipped, statistics.Skipped.Values.Sum());

        Assert.Contains(ImportSkipReason.UnmappedTag, statistics.Skipped.Keys);
        Assert.Contains(ImportSkipReason.AmbiguousMapping, statistics.Skipped.Keys);
        Assert.Contains(ImportSkipReason.InvalidCoordinate, statistics.Skipped.Keys);
        Assert.Contains(ImportSkipReason.UnsupportedAreaFeature, statistics.Skipped.Keys);
    }

    /* --- Idempotens ------------------------------------------------------------------------- */

    [Fact]
    public async Task Reimporting_the_same_fixture_creates_no_duplicates()
    {
        await using var db = await NewDbAsync();

        var first = await RunImportAsync(db);
        var countAfterFirst = await db.AnalysisPois.CountAsync();

        var second = await RunImportAsync(db);

        /* Fikir birliği anahtarı (source, external_id) veritabanında tekil bir
           indekstir; ikinci çalıştırma yeni satır üretemez. */
        Assert.Equal(countAfterFirst, await db.AnalysisPois.CountAsync());
        Assert.Equal(11, first.Inserted);
        Assert.Equal(0, second.Inserted);
        Assert.Equal(0, second.Updated);
        Assert.Equal(11, second.Unchanged);

        var externalIds = await db.AnalysisPois.Select(poi => poi.ExternalId).ToListAsync();
        Assert.Equal(externalIds.Count, externalIds.Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public async Task A_changed_feature_updates_the_same_row_rather_than_adding_one()
    {
        await using var db = await NewDbAsync();
        await RunImportAsync(db);

        var before = await RowAsync(db, "node/103");
        var idBefore = before.Id;

        /* Aynı dış kimlik, DEĞİŞMİŞ ad ve konum: kaynağın güncellenmiş hâli. */
        var updated = new[]
        {
            Feature(OsmElementType.Node, 103, new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["amenity"] = "cafe",
                ["name"] = "Yeni Kahve"
            }, 33.0, 40.0)
        };

        var statistics = await RunImportAsync(db, updated);
        var after = await RowAsync(db, "node/103");

        Assert.Equal(idBefore, after.Id);
        Assert.Equal("Yeni Kahve", after.Name);
        Assert.Equal(33.0, after.Coordinate.X, 6);
        Assert.Equal(1, statistics.Updated);
        Assert.Equal(0, statistics.Inserted);
    }

    /* --- Kuru çalıştırma ---------------------------------------------------------------------- */

    [Fact]
    public async Task A_dry_run_writes_nothing_but_reports_what_it_would_do()
    {
        await using var db = await NewDbAsync();

        var statistics = await RunImportAsync(db, options: new ImportOptions(DryRun: true));

        Assert.Equal(0, await db.AnalysisPois.CountAsync());
        Assert.Equal(11, statistics.WouldInsert);
        Assert.Equal(0, statistics.WouldUpdate);
        Assert.Equal(0, statistics.Inserted);

        // Eşleme ve kategori dağılımı kuru çalıştırmada da tam olarak üretilir.
        Assert.Equal(11, statistics.Mapped);
        Assert.Equal(2, statistics.RowsPerSlug["banka-ve-atm"]);
    }

    [Fact]
    public async Task A_dry_run_after_a_real_import_reports_updates_it_would_make()
    {
        await using var db = await NewDbAsync();
        await RunImportAsync(db);

        var updated = new[]
        {
            Feature(OsmElementType.Node, 103, new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["amenity"] = "cafe",
                ["name"] = "Kuru Kahve"
            }, 33.0, 40.0)
        };

        var statistics = await RunImportAsync(db, updated, new ImportOptions(DryRun: true));

        Assert.Equal(1, statistics.WouldUpdate);
        Assert.Equal(0, statistics.Updated);
        Assert.Equal("Köşe Kahve", (await RowAsync(db, "node/103")).Name);
    }

    /* --- Sınırlar ------------------------------------------------------------------------------ */

    [Fact]
    public async Task The_importer_writes_no_normal_poi_rows()
    {
        await using var db = await NewDbAsync();

        var poiCountBefore = await db.Pois.CountAsync();
        var categoryCountBefore = await db.PoiCategories.CountAsync();

        await RunImportAsync(db);

        /* Açık veri, kullanıcı envanterine KARIŞMAZ: POI'lerim, çöp kutusu,
           arama ve poi_read katmanı bu içe aktarımdan etkilenmez. */
        Assert.Equal(poiCountBefore, await db.Pois.CountAsync());
        Assert.Equal(categoryCountBefore, await db.PoiCategories.CountAsync());
        Assert.Equal(11, await db.AnalysisPois.CountAsync());
    }

    [Fact]
    public async Task An_unknown_mapping_target_never_creates_a_category()
    {
        await using var db = await NewDbAsync();

        var before = await db.PoiCategories.CountAsync();

        var features = new[]
        {
            Feature(OsmElementType.Node, 900, new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["amenity"] = "bench"
            }, 32.85, 39.93)
        };

        await RunImportAsync(db, features);

        // Taksonominin sahibi seed ve yönetim ekranıdır; içe aktarıcı değil.
        Assert.Equal(before, await db.PoiCategories.CountAsync());
        Assert.Equal(0, await db.AnalysisPois.CountAsync());
    }

    [Fact]
    public async Task A_mapping_target_missing_from_the_database_is_reported_before_importing()
    {
        await using var db = await NewDbAsync(seedCategories: false);

        var importer = new AnalysisPoiImporter(db);
        var mapper = await importer.CreateMapperAsync();

        /* Eksik bir hedef, o kategoriye ait TÜM nesnelerin sessizce atlanması
           demek olurdu; araç bunu içe aktarım başlamadan bildirir. */
        Assert.NotEmpty(mapper.MissingSlugs);
        Assert.Contains("eczane", mapper.MissingSlugs);
    }

    [Fact]
    public void Deliberately_unmapped_categories_are_documented_not_forgotten()
    {
        var mapped = OsmCategoryMap.Rules.Select(rule => rule.Slug).ToHashSet(StringComparer.Ordinal);

        foreach (var slug in OsmCategoryMap.DeliberatelyUnmapped.Keys)
        {
            // Bir kategori ya eşlenir ya da NEDEN eşlenmediği yazılıdır; ikisi
            // birden olamaz.
            Assert.DoesNotContain(slug, mapped);
            Assert.False(string.IsNullOrWhiteSpace(OsmCategoryMap.DeliberatelyUnmapped[slug]));
        }
    }

    [Fact]
    public void Every_mapping_rule_targets_a_canonical_taxonomy_slug()
    {
        var canonical = Domain.Common.PoiCategoryTaxonomy.All
            .Select(definition => definition.Slug)
            .ToHashSet(StringComparer.Ordinal);

        /* Eşleme tablosu slug ile çalışır ve slug'lar kanonik taksonomiden
           gelmelidir: yazım hatası olan bir slug, o kuralı sessizce ölü
           bırakırdı. */
        foreach (var rule in OsmCategoryMap.Rules)
        {
            Assert.Contains(rule.Slug, canonical);
        }

        foreach (var slug in OsmCategoryMap.DeliberatelyUnmapped.Keys)
        {
            Assert.Contains(slug, canonical);
        }
    }

    /* --- Yardımcılar -------------------------------------------------------------------------- */

    private static async Task<AnalysisPoi> RowAsync(AppDbContext db, string externalId) =>
        await db.AnalysisPois.AsNoTracking().SingleAsync(poi => poi.ExternalId == externalId);

    private static async Task<string> SlugOfAsync(AppDbContext db, AnalysisPoi row) =>
        await db.PoiCategories
            .Where(category => category.Id == row.CategoryId)
            .Select(category => category.Slug)
            .SingleAsync();

    private static OsmSourceFeature Feature(
        OsmElementType type,
        long id,
        IReadOnlyDictionary<string, string> tags,
        double longitude,
        double latitude)
    {
        var factory = new GeometryFactory(new PrecisionModel(), 4326);

        return new OsmSourceFeature(type, id, tags, factory.CreatePoint(new Coordinate(longitude, latitude)));
    }

    private static async Task<ImportStatistics> RunImportAsync(
        AppDbContext db,
        IEnumerable<OsmSourceFeature>? features = null,
        ImportOptions? options = null)
    {
        var importer = new AnalysisPoiImporter(db, options);
        var mapper = await importer.CreateMapperAsync();
        var statistics = new ImportStatistics();

        var source = features ?? new OsmXmlSource(FixturePath).Read(
            tags => OsmCategoryMap.Rules.Any(rule => rule.Matches(tags)),
            (_, _, reason) => statistics.Skip(reason));

        return await importer.ImportAsync(source, mapper, statistics);
    }

    private static async Task<AppDbContext> ImportFixtureAsync()
    {
        var db = await NewDbAsync();
        await RunImportAsync(db);

        return db;
    }

    /// <summary>Fikstürü içe aktarır ve istatistikleri de döndürür.</summary>
    private static async Task<(AppDbContext Db, ImportStatistics Statistics)> ImportFixtureWithStatsAsync()
    {
        var db = await NewDbAsync();
        var statistics = await RunImportAsync(db);

        return (db, statistics);
    }

    /// <summary>Kanonik taksonominin tamamıyla in-memory context.</summary>
    private static async Task<AppDbContext> NewDbAsync(bool seedCategories = true)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"osm-import-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

        var db = new AppDbContext(options);

        if (!seedCategories)
        {
            return db;
        }

        /* Taksonomi KANONİK listeden kurulur: testin kendi kategori listesini
           uydurması, eşleme tablosunun gerçek taksonomiyi hedeflediğini
           doğrulamazdı. İki geçiş — önce kökler, sonra çocuklar. */
        var idBySlug = new Dictionary<string, int>(StringComparer.Ordinal);

        foreach (var definition in Domain.Common.PoiCategoryTaxonomy.Roots)
        {
            var category = new PoiCategory { Name = definition.Name, Slug = definition.Slug };
            db.PoiCategories.Add(category);
            await db.SaveChangesAsync();
            idBySlug[definition.Slug] = category.Id;
        }

        foreach (var definition in Domain.Common.PoiCategoryTaxonomy.Children)
        {
            db.PoiCategories.Add(new PoiCategory
            {
                Name = definition.Name,
                Slug = definition.Slug,
                ParentId = idBySlug[definition.ParentSlug!]
            });
        }

        await db.SaveChangesAsync();

        return db;
    }

    private static string FindFixture()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);

        while (current is not null)
        {
            var candidate = Path.Combine(current.FullName, "Fixtures", "osm-import-fixture.osm");

            if (File.Exists(candidate))
            {
                return candidate;
            }

            current = current.Parent;
        }

        throw new InvalidOperationException("OSM test fikstürü bulunamadı.");
    }
}
