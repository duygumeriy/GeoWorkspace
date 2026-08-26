using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using NetTopologySuite.Geometries;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.OsmPoiImporter;

namespace StajProject.Auth.Tests;

/// <summary>
/// <b>Gerçek veriyle</b> gerekçelendirilmiş kural öncelikleri.
/// </summary>
/// <remarks>
/// <para>
/// Buradaki her iddia, Ankara çıkarımında ELLE incelenmiş bir çakışmadan
/// gelir. Etiket bileşimleri gerçektir; OSM kimlikleri ise testlere
/// GİRMEZ — kural belirli nesnelere değil, aynı biçimde etiketlenmiş her
/// nesneye uygulanmalıdır.
/// </para>
/// <para>
/// <b>Öncelik BİLDİRİMSELDİR.</b> Eşleyicide "amenity her zaman leisure'ı
/// yener" gibi bir etiket-adı kuralı yoktur ve olmamalıdır; karar, kural
/// tanımındaki <see cref="OsmCategoryRule.Priority"/> değerinin
/// karşılaştırılmasından ibarettir. Bu ayrım önemlidir: <c>leisure=park</c> ve
/// <c>leisure=stadium</c> hâlâ tam öncelikli birincil tesislerdir.
/// </para>
/// <para>
/// <b>Amaç atlanan sayısını sıfırlamak DEĞİLDİR.</b> Gerçekten belirsiz kalan
/// çakışmalar atlanmaya devam eder ve son test bunu sabitler.
/// </para>
/// </remarks>
public class OsmCategoryPriorityTests
{
    /* --- 1. power=plant, landuse=industrial'ı yener ------------------------------- */

    [Fact]
    public async Task A_power_plant_on_industrial_land_maps_to_the_energy_category()
    {
        await using var db = await NewDbAsync();

        /* Gerçek örnek: Mamak biyogaz tesisi. `landuse=industrial` arazi
           kullanımıdır; tesisin ne OLDUĞUNU `power=plant` söyler. */
        var statistics = await RunAsync(db,
            Way(1,
                ("power", "plant"),
                ("landuse", "industrial"),
                ("building", "yes"),
                ("plant:source", "biogas")));

        Assert.Equal("enerji-uretim-dagitim", await SlugOfAsync(db, "way/1"));

        var group = Assert.Single(statistics.ResolvedAmbiguities);

        Assert.Equal(AmbiguityResolutionReason.HigherSpecificityWins, group.Key.Reason);
        Assert.Equal("enerji-uretim-dagitim <- sanayi-uretim", group.Key.Signature);
    }

    [Fact]
    public async Task A_factory_without_a_competing_tag_still_maps_to_industry()
    {
        await using var db = await NewDbAsync();

        /* Düşürülen öncelik yalnızca ÇAKIŞMADA anlam taşır: tek aday varsa
           karşılaştırma hiç yapılmaz ve `landuse=industrial` kendi kategorisini
           almaya devam eder. */
        await RunAsync(db, Way(2, ("landuse", "industrial"), ("name", "Organize Sanayi")));

        Assert.Equal("sanayi-uretim", await SlugOfAsync(db, "way/2"));
    }

    /* --- 2. office=government, leisure=garden'ı yener ------------------------------ */

    [Fact]
    public async Task A_government_office_with_a_garden_maps_to_the_institution()
    {
        await using var db = await NewDbAsync();

        // Gerçek örnek: Çankaya Köşkü / Tapu Kadastro — çevresi bahçeli kurum.
        var statistics = await RunAsync(db,
            Way(3, ("office", "government"), ("leisure", "garden"), ("barrier", "wall")));

        Assert.Equal("resmi-kurum", await SlugOfAsync(db, "way/3"));
        Assert.Equal("resmi-kurum <- yesil-alanlar", Assert.Single(statistics.ResolvedAmbiguities).Key.Signature);
    }

    /* --- 3. amenity=social_facility, leisure=garden'ı yener ------------------------ */

    [Fact]
    public async Task A_social_facility_with_a_garden_maps_to_the_facility()
    {
        await using var db = await NewDbAsync();

        // Gerçek örnek: PTT Sosyal Tesisleri.
        await RunAsync(db, Way(4, ("amenity", "social_facility"), ("leisure", "garden")));

        Assert.Equal("sosyal-kurumlar", await SlugOfAsync(db, "way/4"));
    }

    [Fact]
    public async Task A_mosque_with_a_garden_maps_to_the_place_of_worship()
    {
        await using var db = await NewDbAsync();

        await RunAsync(db, Way(5, ("amenity", "place_of_worship"), ("leisure", "garden"), ("religion", "muslim")));

        Assert.Equal("dini-tesisler", await SlugOfAsync(db, "way/5"));
    }

    [Fact]
    public async Task A_mosque_that_is_also_a_tourist_attraction_maps_to_the_place_of_worship()
    {
        await using var db = await NewDbAsync();

        // Gerçek örnek: Kocatepe Camii — `tourism=attraction` bir nitelik.
        await RunAsync(db, Way(6, ("amenity", "place_of_worship"), ("tourism", "attraction"), ("building", "mosque")));

        Assert.Equal("dini-tesisler", await SlugOfAsync(db, "way/6"));
    }

    /* --- Düşürme YALNIZCA adı geçen kurallara uygulanır ---------------------------- */

    [Theory]
    [InlineData("park", "yesil-alanlar")]
    [InlineData("stadium", "spor-tesisleri")]
    [InlineData("sports_centre", "spor-tesisleri")]
    [InlineData("fitness_centre", "spor-tesisleri")]
    [InlineData("pitch", "spor-tesisleri")]
    public void Other_leisure_rules_keep_full_priority(string value, string slug)
    {
        /* "leisure her zaman kaybeder" TÜRÜNDE bir kural YOKTUR: bir park ya da
           stadyum kendi başına birer tesistir ve öncelikleri düşürülmemiştir.
           Düşürülen tek leisure kuralı `garden`dır. */
        var rule = Assert.Single(
            OsmCategoryMap.Rules,
            item => item.Key == "leisure" && item.Value == value);

        Assert.Equal(slug, rule.Slug);
        Assert.Equal(OsmCategoryRule.ExactTag, rule.Specificity);
    }

    [Fact]
    public void Only_three_rules_carry_a_lowered_priority()
    {
        /* Değişikliğin BÜYÜKLÜĞÜ sabitlenir: gerçek veriyle gerekçelendirilmiş
           üç kural düşürülmüştür, ne bir eksik ne bir fazla. Dördüncü bir
           düşürme, gerekçesiyle birlikte bu testi de güncellemeyi gerektirir. */
        var lowered = OsmCategoryMap.Rules
            .Where(rule => rule.Specificity == OsmCategoryRule.Contextual)
            .Select(rule => $"{rule.Key}={rule.Value}")
            .Order(StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(
            ["landuse=industrial", "leisure=garden", "tourism=attraction"],
            lowered);
    }

    [Fact]
    public void The_related_rules_that_were_not_lowered_stay_at_full_priority()
    {
        // Aynı anahtarın kardeş kuralları etkilenmemiştir.
        Assert.Equal(
            OsmCategoryRule.ExactTag,
            Single("tourism", "museum").Specificity);
        Assert.Equal(
            OsmCategoryRule.ExactTag,
            Single("man_made", "works").Specificity);
        Assert.Equal(
            OsmCategoryRule.ExactTag,
            Single("landuse", "military").Specificity);
    }

    /* --- 4. Hiyerarşi DEĞİŞMEDİ ----------------------------------------------------- */

    [Fact]
    public async Task A_pharmacy_still_beats_the_health_root_through_the_hierarchy()
    {
        await using var db = await NewDbAsync();

        /* 872 gerçek vaka bu yolun doğru çalıştığını kanıtladı. Öncelik modeli
           yalnızca İLGİSİZ çakışmaları çözer ve ata/torun elemesinden SONRA
           devreye girer. */
        var statistics = await RunAsync(db, Node(7, ("amenity", "pharmacy"), ("healthcare", "pharmacy")));

        Assert.Equal("eczane", await SlugOfAsync(db, "node/7"));

        var group = Assert.Single(statistics.ResolvedAmbiguities);

        Assert.Equal(AmbiguityResolutionReason.DescendantBeatsAncestor, group.Key.Reason);
        Assert.Equal("eczane <- saglik-kurumlari", group.Key.Signature);
    }

    /* --- 5. Gerçekten belirsiz olan HÂLÂ atlanır ------------------------------------ */

    [Fact]
    public async Task A_military_aerodrome_stays_ambiguous_and_is_skipped()
    {
        await using var db = await NewDbAsync();

        /* Gerçek örnek: Güvercinlik Üssü — hem askerî tesis hem havaalanı.
           `aerodrome:type=military/public` ikisinin de doğru olduğunu söyler.
           Burada bir tarafı seçmek TAHMİN olurdu; nesne atlanır ve tanılamada
           görünür. */
        var statistics = await RunAsync(db,
            Way(8, ("aeroway", "aerodrome"), ("landuse", "military"), ("military", "airfield")));

        Assert.Equal(0, await db.AnalysisPois.CountAsync());
        Assert.Equal(1, statistics.Skipped.GetValueOrDefault(ImportSkipReason.AmbiguousMapping));
        Assert.Equal(0, statistics.AmbiguousResolved);

        var group = Assert.Single(statistics.UnresolvedAmbiguities);

        Assert.Equal("askeri-kurumlar <> havayolu", group.Key);
    }

    [Fact]
    public async Task A_government_run_social_facility_stays_ambiguous_and_is_skipped()
    {
        await using var db = await NewDbAsync();

        /* Gerçek örnek: Seyranbağları Huzur Evi — `amenity=social_facility` ve
           `office=government` birlikte. İkisi de birincil tesis etiketidir ve
           tek bir gerçek nesneden (iki OSM kimliğiyle iki kez modellenmiş)
           genel bir kural çıkarmak TAHMİN olurdu. Atlanır. */
        var statistics = await RunAsync(db,
            Way(9,
                ("amenity", "social_facility"),
                ("office", "government"),
                ("social_facility", "group_home")));

        Assert.Equal(0, await db.AnalysisPois.CountAsync());
        Assert.Equal("resmi-kurum <> sosyal-kurumlar", Assert.Single(statistics.UnresolvedAmbiguities).Key);
    }

    /* --- 6-8. Çözülemeyen çakışmaların toplanması ----------------------------------- */

    [Fact]
    public async Task The_same_unresolved_conflict_is_aggregated_into_one_group()
    {
        await using var db = await NewDbAsync();

        var statistics = await RunAsync(db,
            Way(11, ("aeroway", "aerodrome"), ("landuse", "military")),
            Way(12, ("aeroway", "aerodrome"), ("landuse", "military")),
            Way(13, ("aeroway", "aerodrome"), ("landuse", "military")));

        var group = Assert.Single(statistics.UnresolvedAmbiguities);

        Assert.Equal("askeri-kurumlar <> havayolu", group.Key);
        Assert.Equal(3, group.Value.Count);
    }

    [Fact]
    public async Task Candidate_order_does_not_split_an_unresolved_conflict_into_two_groups()
    {
        await using var db = await NewDbAsync();

        /* Aday kümesi SIRALANIR. Sıralanmasaydı, etiketlerin okunma sırası
           değiştiğinde aynı çakışma "askeri-kurumlar <> havayolu" ve
           "havayolu <> askeri-kurumlar" olarak iki kez sayılırdı. */
        var statistics = await RunAsync(db,
            Way(14, ("landuse", "military"), ("aeroway", "aerodrome")),
            Way(15, ("aeroway", "aerodrome"), ("landuse", "military")));

        Assert.Single(statistics.UnresolvedAmbiguities);
        Assert.Equal(2, statistics.UnresolvedAmbiguities.Values.Single().Count);
    }

    [Fact]
    public async Task Unresolved_group_samples_are_bounded_to_three()
    {
        await using var db = await NewDbAsync();

        var features = Enumerable.Range(1, 12)
            .Select(index => Way(100 + index, ("aeroway", "aerodrome"), ("landuse", "military")))
            .ToArray();

        var statistics = await RunAsync(db, features);

        var group = Assert.Single(statistics.UnresolvedAmbiguities).Value;

        // Sayaç sınırsız, örnek listesi SABİT: tanılama bellek sızdırmaz.
        Assert.Equal(12, group.Count);
        Assert.Equal(ImportStatistics.MaxSamplesPerGroup, group.Samples.Count);
    }

    /* --- 9. Tanılama kapalıyken ------------------------------------------------------ */

    [Fact]
    public async Task Disabling_diagnostics_keeps_the_same_outcome_and_stores_nothing()
    {
        await using var on = await NewDbAsync();
        await using var off = await NewDbAsync();

        OsmSourceFeature[] Features() =>
        [
            Way(21, ("power", "plant"), ("landuse", "industrial")),
            Way(22, ("office", "government"), ("leisure", "garden")),
            Way(23, ("aeroway", "aerodrome"), ("landuse", "military"))
        ];

        var withDiagnostics = await RunAsync(on, Features());
        var without = await RunAsync(off, diagnostics: false, dryRun: false, Features());

        Assert.Equal(withDiagnostics.Mapped, without.Mapped);
        Assert.Equal(withDiagnostics.TotalSkipped, without.TotalSkipped);
        Assert.Equal("enerji-uretim-dagitim", await SlugOfAsync(off, "way/21"));
        Assert.Equal("resmi-kurum", await SlugOfAsync(off, "way/22"));

        Assert.Empty(without.ResolvedAmbiguities);
        Assert.Empty(without.UnresolvedAmbiguities);
        Assert.NotEmpty(withDiagnostics.UnresolvedAmbiguities);
    }

    [Fact]
    public async Task Dry_run_with_diagnostics_writes_nothing()
    {
        await using var db = await NewDbAsync();

        var statistics = await RunAsync(db, diagnostics: true, dryRun: true,
            Way(31, ("power", "plant"), ("landuse", "industrial")),
            Way(32, ("aeroway", "aerodrome"), ("landuse", "military")));

        Assert.Equal(0, await db.AnalysisPois.CountAsync());
        Assert.Equal(1, statistics.WouldInsert);
        Assert.NotEmpty(statistics.ResolvedAmbiguities);
        Assert.NotEmpty(statistics.UnresolvedAmbiguities);
    }

    /* --- Yardımcılar ------------------------------------------------------------------ */

    private static OsmCategoryRule Single(string key, string value) =>
        Assert.Single(OsmCategoryMap.Rules, rule => rule.Key == key && rule.Value == value);

    private static OsmSourceFeature Node(long id, params (string Key, string Value)[] tags)
    {
        var factory = new GeometryFactory(new PrecisionModel(), 4326);

        return new OsmSourceFeature(
            OsmElementType.Node,
            id,
            Tags(tags),
            factory.CreatePoint(new Coordinate(32.85, 39.93)));
    }

    /// <summary>Küçük bir kapalı alan; temsilî nokta içine düşer.</summary>
    private static OsmSourceFeature Way(long id, params (string Key, string Value)[] tags)
    {
        var factory = new GeometryFactory(new PrecisionModel(), 4326);
        var ring = factory.CreateLinearRing(
        [
            new Coordinate(32.80, 39.90), new Coordinate(32.81, 39.90),
            new Coordinate(32.81, 39.91), new Coordinate(32.80, 39.91),
            new Coordinate(32.80, 39.90)
        ]);

        return new OsmSourceFeature(OsmElementType.Way, id, Tags(tags), factory.CreatePolygon(ring));
    }

    private static Dictionary<string, string> Tags((string Key, string Value)[] tags) =>
        tags.ToDictionary(tag => tag.Key, tag => tag.Value, StringComparer.Ordinal);

    private static Task<ImportStatistics> RunAsync(AppDbContext db, params OsmSourceFeature[] features) =>
        RunAsync(db, diagnostics: true, dryRun: false, features);

    private static async Task<ImportStatistics> RunAsync(
        AppDbContext db,
        bool diagnostics,
        bool dryRun,
        params OsmSourceFeature[] features)
    {
        var importer = new AnalysisPoiImporter(
            db,
            new ImportOptions(DryRun: dryRun, MappingDiagnostics: diagnostics));

        var mapper = await importer.CreateMapperAsync();

        return await importer.ImportAsync(features, mapper, new ImportStatistics());
    }

    private static async Task<string> SlugOfAsync(AppDbContext db, string externalId)
    {
        var row = await db.AnalysisPois.AsNoTracking().SingleAsync(poi => poi.ExternalId == externalId);

        return await db.PoiCategories
            .Where(category => category.Id == row.CategoryId)
            .Select(category => category.Slug)
            .SingleAsync();
    }

    private static async Task<AppDbContext> NewDbAsync()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"osm-priority-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

        var db = new AppDbContext(options);
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
}
