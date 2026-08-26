using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using NetTopologySuite.Geometries;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.OsmPoiImporter;

namespace StajProject.Auth.Tests;

/// <summary>
/// İçe aktarıcının <b>belirsizlik tanılaması</b>: 874 otomatik kararın
/// arkasında ne olduğu.
/// </summary>
/// <remarks>
/// <para>
/// <b>Tanılama kararı DEĞİŞTİRMEZ.</b> Bu dosyanın ilk işi, eşleme
/// semantiğinin (torun atayı yener, özgüllük ilgisizi yener, eşit özgüllükte
/// atla) tanılama açıkken de kapalıyken de birebir aynı kaldığını
/// sabitlemektir. Sayıyı küçültmek için kural değiştirmek, gerçek bir eşleme
/// hatasını görünmez kılardı.
/// </para>
/// <para>
/// <b>Bellek SINIRLIDIR.</b> Saklanan şey özellikler değil, çakışma
/// imzalarıdır; grup başına en fazla üç örnek kimlik tutulur. Testler bu sınırı
/// da ölçer.
/// </para>
/// </remarks>
public class OsmImportDiagnosticsTests
{
    /* --- 1. Torun atayı yener ---------------------------------------------------- */

    [Fact]
    public async Task A_pharmacy_conflict_is_recorded_as_descendant_beats_ancestor()
    {
        await using var db = await NewDbAsync();

        var statistics = await RunAsync(db, diagnostics: true,
            Node(1, ("amenity", "pharmacy"), ("healthcare", "pharmacy")));

        var group = Assert.Single(statistics.ResolvedAmbiguities);

        Assert.Equal(AmbiguityResolutionReason.DescendantBeatsAncestor, group.Key.Reason);

        // Kazanan ve KAYBEDEN ayrı ayrı görünür: "eczane <- saglik-kurumlari".
        Assert.Equal("eczane <- saglik-kurumlari", group.Key.Signature);
        Assert.Equal(1, group.Value.Count);
        Assert.Equal(["node/1"], group.Value.Samples);

        // Karar değişmedi: satır hâlâ eczane altında.
        Assert.Equal("eczane", await SlugOfAsync(db, "node/1"));
        Assert.Equal(1, statistics.AmbiguousResolved);
    }

    [Fact]
    public async Task The_losing_slug_is_recorded_not_just_the_winner()
    {
        await using var db = await NewDbAsync();

        var statistics = await RunAsync(db, diagnostics: true,
            Node(1, ("amenity", "pharmacy"), ("healthcare", "pharmacy")));

        var key = Assert.Single(statistics.ResolvedAmbiguities).Key;

        /* Kaybeden olmadan imza bir şey anlatmazdı: "eczane 312" satırı,
           hangi kuralın gereksiz yere eşleştiğini göstermez. */
        Assert.Contains("saglik-kurumlari", key.Signature, StringComparison.Ordinal);
        Assert.StartsWith("eczane <-", key.Signature, StringComparison.Ordinal);
    }

    /* --- 2. İlgisiz, eşit olmayan özgüllük ---------------------------------------- */

    [Fact]
    public async Task An_unrelated_conflict_resolved_by_specificity_is_recorded_as_such()
    {
        await using var db = await NewDbAsync();

        /* `amenity=theatre` (tam değer, kulturel-tesisler) ile `historic=*`
           (joker, tarihi-turistik): ilgisiz iki kategori, farklı özgüllük.
           Tam değer kazanır. */
        var statistics = await RunAsync(db, diagnostics: true,
            Node(2, ("amenity", "theatre"), ("historic", "yes")));

        var group = Assert.Single(statistics.ResolvedAmbiguities);

        Assert.Equal(AmbiguityResolutionReason.HigherSpecificityWins, group.Key.Reason);
        Assert.Equal("kulturel-tesisler <- tarihi-turistik", group.Key.Signature);
        Assert.Equal("kulturel-tesisler", await SlugOfAsync(db, "node/2"));
    }

    [Fact]
    public async Task The_two_resolution_reasons_are_reported_separately()
    {
        await using var db = await NewDbAsync();

        var statistics = await RunAsync(db, diagnostics: true,
            Node(1, ("amenity", "pharmacy"), ("healthcare", "pharmacy")),
            Node(2, ("amenity", "theatre"), ("historic", "yes")));

        /* İki farklı SEBEP, iki farklı grup: "874" tek bir sayı olarak
           kalsaydı, hangisinin taksonomiden hangisinin kural tablosundan
           geldiği ayırt edilemezdi. */
        Assert.Equal(2, statistics.ResolvedAmbiguities.Count);

        Assert.Contains(
            statistics.ResolvedAmbiguities.Keys,
            key => key.Reason == AmbiguityResolutionReason.DescendantBeatsAncestor);
        Assert.Contains(
            statistics.ResolvedAmbiguities.Keys,
            key => key.Reason == AmbiguityResolutionReason.HigherSpecificityWins);
    }

    /* --- 3. Eşit özgüllük: hâlâ atlanır ------------------------------------------- */

    [Fact]
    public async Task An_equal_specificity_conflict_is_still_skipped_and_not_counted_as_resolved()
    {
        await using var db = await NewDbAsync();

        // `amenity=restaurant` + `shop=clothes`: ilgisiz, ikisi de tam değer.
        var statistics = await RunAsync(db, diagnostics: true,
            Node(3, ("amenity", "restaurant"), ("shop", "clothes")));

        Assert.Equal(1, statistics.Skipped.GetValueOrDefault(ImportSkipReason.AmbiguousMapping));

        /* Çözülmemiş bir belirsizlik ÇÖZÜLMÜŞ sayılmaz: karıştırmak, "874"ün
           içine hiç yazılmamış kayıtları da katardı. */
        Assert.Equal(0, statistics.AmbiguousResolved);
        Assert.Empty(statistics.ResolvedAmbiguities);

        /* Ama çakışma TÜRÜ kaydedilir: hangi kategori çiftinin çarpıştığı,
           hangi kuralın gözden geçirileceğini söyler. */
        var group = Assert.Single(statistics.UnresolvedAmbiguities);

        Assert.Equal("giyim-magazalari <> restoran", group.Key);
        Assert.Equal(1, group.Value.Count);
        Assert.Equal(["node/3"], group.Value.Samples);
        Assert.Equal(0, await db.AnalysisPois.CountAsync());
    }

    /* --- 4. Aynı çakışma tekrar ederse toplanır ----------------------------------- */

    [Fact]
    public async Task Repeating_the_same_conflict_increments_one_group()
    {
        await using var db = await NewDbAsync();

        var statistics = await RunAsync(db, diagnostics: true,
            Node(11, ("amenity", "pharmacy"), ("healthcare", "pharmacy")),
            Node(12, ("amenity", "pharmacy"), ("healthcare", "pharmacy")),
            Node(13, ("amenity", "pharmacy"), ("healthcare", "pharmacy")),
            Node(14, ("amenity", "pharmacy"), ("healthcare", "pharmacy")));

        /* Dört karar, TEK satır: rapor özellik başına değil çakışma başına
           büyür. 874 kararın birkaç satıra inmesinin sebebi budur. */
        var group = Assert.Single(statistics.ResolvedAmbiguities);

        Assert.Equal(4, group.Value.Count);
        Assert.Equal(4, statistics.AmbiguousResolved);
        Assert.Equal(4, await db.AnalysisPois.CountAsync());
    }

    [Fact]
    public async Task The_loser_order_does_not_split_one_conflict_into_two_groups()
    {
        await using var db = await NewDbAsync();

        /* Kaybeden listesi SIRALANIR. Sıralanmasaydı, kuralların eşleşme sırası
           değiştiğinde aynı çakışma iki ayrı imza üretebilirdi. */
        var statistics = await RunAsync(db, diagnostics: true,
            Node(21, ("healthcare", "pharmacy"), ("amenity", "pharmacy")),
            Node(22, ("amenity", "pharmacy"), ("healthcare", "pharmacy")));

        Assert.Single(statistics.ResolvedAmbiguities);
        Assert.Equal(2, statistics.ResolvedAmbiguities.Values.Single().Count);
    }

    /* --- 5. Örnekler sınırlıdır ---------------------------------------------------- */

    [Fact]
    public async Task Samples_are_bounded_while_the_counter_keeps_growing()
    {
        await using var db = await NewDbAsync();

        var features = Enumerable.Range(1, 25)
            .Select(index => Node(100 + index, ("amenity", "pharmacy"), ("healthcare", "pharmacy")))
            .ToArray();

        var statistics = await RunAsync(db, diagnostics: true, features);

        var group = Assert.Single(statistics.ResolvedAmbiguities).Value;

        // Sayaç 25, örnekler EN FAZLA 3: tanılama bir bellek sızıntısı değildir.
        Assert.Equal(25, group.Count);
        Assert.Equal(ImportStatistics.MaxSamplesPerGroup, group.Samples.Count);
        Assert.All(group.Samples, sample => Assert.StartsWith("node/", sample, StringComparison.Ordinal));
    }

    [Fact]
    public async Task Unresolved_ambiguity_samples_are_bounded_too()
    {
        await using var db = await NewDbAsync();

        var features = Enumerable.Range(1, 10)
            .Select(index => Node(200 + index, ("amenity", "restaurant"), ("shop", "clothes")))
            .ToArray();

        var statistics = await RunAsync(db, diagnostics: true, features);

        Assert.Equal(10, statistics.Skipped.GetValueOrDefault(ImportSkipReason.AmbiguousMapping));

        var group = Assert.Single(statistics.UnresolvedAmbiguities).Value;

        Assert.Equal(10, group.Count);
        Assert.Equal(ImportStatistics.MaxSamplesPerGroup, group.Samples.Count);
    }

    /* --- 6. Tanılama kapalıyken davranış aynı -------------------------------------- */

    [Fact]
    public async Task Disabling_diagnostics_changes_no_mapping_result()
    {
        await using var withDiagnostics = await NewDbAsync();
        await using var without = await NewDbAsync();

        OsmSourceFeature[] Features() =>
        [
            Node(1, ("amenity", "pharmacy"), ("healthcare", "pharmacy")),
            Node(2, ("amenity", "theatre"), ("historic", "yes")),
            Node(3, ("amenity", "restaurant"), ("shop", "clothes")),
            Node(4, ("amenity", "cafe"))
        ];

        var on = await RunAsync(withDiagnostics, diagnostics: true, Features());
        var off = await RunAsync(without, diagnostics: false, Features());

        /* Eşleme sonucu, sayaçlar ve yazılan satırlar BİREBİR aynı; fark
           yalnızca ek raporun toplanmasıdır. */
        Assert.Equal(on.Mapped, off.Mapped);
        Assert.Equal(on.AmbiguousResolved, off.AmbiguousResolved);
        Assert.Equal(on.TotalSkipped, off.TotalSkipped);
        Assert.Equal(
            on.RowsPerSlug.OrderBy(pair => pair.Key, StringComparer.Ordinal),
            off.RowsPerSlug.OrderBy(pair => pair.Key, StringComparer.Ordinal));

        Assert.Equal(
            await SlugOfAsync(withDiagnostics, "node/1"),
            await SlugOfAsync(without, "node/1"));

        // Kapalıyken HİÇBİR grup/örnek saklanmaz.
        Assert.Empty(off.ResolvedAmbiguities);
        Assert.Empty(off.UnresolvedAmbiguities);
        Assert.NotEmpty(on.ResolvedAmbiguities);
    }

    [Fact]
    public async Task The_summary_only_prints_the_diagnostics_section_when_enabled()
    {
        await using var db = await NewDbAsync();

        var on = await RunAsync(db, diagnostics: true,
            Node(1, ("amenity", "pharmacy"), ("healthcare", "pharmacy")));

        await using var other = await NewDbAsync();
        var off = await RunAsync(other, diagnostics: false,
            Node(1, ("amenity", "pharmacy"), ("healthcare", "pharmacy")));

        Assert.Contains("Çözülen belirsizlikler", on.Format(dryRun: true), StringComparison.Ordinal);
        Assert.Contains("eczane <- saglik-kurumlari", on.Format(dryRun: true), StringComparison.Ordinal);

        // Bayraksız çıktı KISA kalır.
        Assert.DoesNotContain("Çözülen belirsizlikler", off.Format(dryRun: true), StringComparison.Ordinal);
    }

    /* --- 7. Kuru çalıştırma: yazma yok --------------------------------------------- */

    [Fact]
    public async Task Diagnostics_in_dry_run_write_nothing()
    {
        await using var db = await NewDbAsync();

        var statistics = await RunAsync(db, diagnostics: true, dryRun: true,
            Node(1, ("amenity", "pharmacy"), ("healthcare", "pharmacy")),
            Node(2, ("amenity", "theatre"), ("historic", "yes")));

        Assert.Equal(0, await db.AnalysisPois.CountAsync());
        Assert.Equal(2, statistics.WouldInsert);
        Assert.Equal(0, statistics.Inserted);

        // Tanılama kuru çalıştırmada da TAM olarak üretilir.
        Assert.Equal(2, statistics.ResolvedAmbiguities.Count);
        Assert.Equal(2, statistics.AmbiguousResolved);
    }

    /* --- Sayaç anlambilimi --------------------------------------------------------- */

    [Fact]
    public void Tagged_elements_explain_why_skipped_can_exceed_emitted_features()
    {
        var path = FindFixture();
        var statistics = new ImportStatistics();

        var features = new OsmXmlSource(path).Read(
            tags => OsmCategoryMap.Rules.Any(rule => rule.Matches(tags)),
            (_, _, reason) => statistics.Skip(reason),
            (_, _) => statistics.TaggedElements++).ToList();

        /* DEĞİŞMEZ: etiketli her eleman ya bir özelliğe dönüşür ya da kaynakta
           atlanır. "Atlanan > üretilen özellik" bu yüzden bir muhasebe hatası
           değil, beklenen sonuçtur — etiketli elemanların çoğu POI değildir. */
        var sourceSkips = statistics.TotalSkipped;

        Assert.Equal(statistics.TaggedElements, features.Count + sourceSkips);
        Assert.True(statistics.TaggedElements > features.Count);
    }

    [Fact]
    public async Task The_summary_labels_describe_what_the_counters_actually_measure()
    {
        await using var db = await NewDbAsync();
        var statistics = await RunAsync(db, diagnostics: false, Node(1, ("amenity", "cafe")));
        statistics.TaggedElements = 42;

        var report = statistics.Format(dryRun: true);

        /* Eski "Okunan eleman" başlığı sayacın ölçtüğü şeyi YANLIŞ anlatıyordu:
           sayaç dosyadaki elemanları değil, üretilen özellikleri sayar. */
        Assert.DoesNotContain("Okunan eleman", report, StringComparison.Ordinal);
        Assert.Contains("Üretilen özellik", report, StringComparison.Ordinal);
        Assert.Contains("Etiketli OSM elemanı", report, StringComparison.Ordinal);
    }

    /* --- Yardımcılar ---------------------------------------------------------------- */

    private static OsmSourceFeature Node(long id, params (string Key, string Value)[] tags)
    {
        var factory = new GeometryFactory(new PrecisionModel(), 4326);

        return new OsmSourceFeature(
            OsmElementType.Node,
            id,
            tags.ToDictionary(tag => tag.Key, tag => tag.Value, StringComparer.Ordinal),
            factory.CreatePoint(new Coordinate(32.85, 39.93)));
    }

    private static async Task<ImportStatistics> RunAsync(
        AppDbContext db,
        bool diagnostics,
        params OsmSourceFeature[] features) =>
        await RunAsync(db, diagnostics, dryRun: false, features);

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

    /// <summary>Kanonik taksonominin tamamıyla in-memory context.</summary>
    private static async Task<AppDbContext> NewDbAsync()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"osm-diagnostics-{Guid.NewGuid():N}")
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
