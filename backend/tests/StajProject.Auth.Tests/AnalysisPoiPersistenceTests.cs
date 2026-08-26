using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using NetTopologySuite.Geometries;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Auth.Tests;

/// <summary>
/// <c>analysis_poi</c> şema sözleşmesi ve göçün ADDİTİFLİĞİ.
/// </summary>
/// <remarks>
/// <para>
/// <b>Model gerçek ilişkisel sağlayıcıyla kurulur.</b> In-memory sağlayıcı
/// kolon adlarını, kolon tiplerini ve indeks yöntemini taşımaz; bu testler tam
/// da onları doğruladığı için Npgsql sağlayıcısı kullanılır. <b>Hiçbir
/// bağlantı açılmaz</b> — yalnızca <see cref="DbContext.Model"/> okunur,
/// dolayısıyla test bir veritabanı gerektirmez ve hiçbir şeyi değiştirmez.
/// </para>
/// <para>
/// <b>Asıl iddia bir AYRIMDIR:</b> bu tablo açık veri içindir ve normal POI
/// envanterinin sahiplik/çöp kutusu alanlarını TAŞIMAZ. Bir gün biri
/// <c>user_id</c> ya da <c>is_deleted</c> eklerse, kayıt sessizce normal POI
/// akışlarına benzemeye başlar; testler o anı yakalar.
/// </para>
/// </remarks>
public class AnalysisPoiPersistenceTests
{
    private static readonly string RepositoryRoot = FindRepositoryRoot();

    private const string MigrationFile =
        "backend/src/StajProject.Infrastructure/Persistence/Migrations/20260825192028_AddAnalysisPoi.cs";

    /* --- Tablo ve kolonlar ------------------------------------------------------ */

    [Fact]
    public void The_entity_is_mapped_to_its_own_table()
    {
        var entity = Entity();

        Assert.Equal("analysis_poi", entity.GetTableName());

        // Normal POI envanterinin tablosuna DOKUNULMAZ; ikisi ayrı tablolardır.
        Assert.Equal("poi", Model().FindEntityType(typeof(Poi))!.GetTableName());
    }

    [Fact]
    public void Name_is_optional()
    {
        /* Poi.isim ZORUNLUDUR; burada değildir. Açık veri kümelerinde adsız ama
           geçerli kayıtlar sıradandır ve içe aktarıcı ad UYDURMAMALIDIR. */
        var name = Property(nameof(AnalysisPoi.Name));

        Assert.Equal("name", name.GetColumnName());
        Assert.True(name.IsNullable);
        Assert.Equal(AnalysisPoi.MaxNameLength, name.GetMaxLength());

        Assert.False(Model().FindEntityType(typeof(Poi))!.FindProperty(nameof(Poi.Name))!.IsNullable);
    }

    [Fact]
    public void Category_is_required_and_indexed()
    {
        var category = Property(nameof(AnalysisPoi.CategoryId));

        Assert.Equal("category_id", category.GetColumnName());
        Assert.False(category.IsNullable);

        Assert.Contains(
            Entity().GetIndexes(),
            index => index.Properties.Count == 1
                && index.Properties[0].Name == nameof(AnalysisPoi.CategoryId)
                && !index.IsUnique);
    }

    [Fact]
    public void The_category_foreign_key_points_at_the_shared_taxonomy_with_restrict()
    {
        /* İKİNCİ bir kategori tablosu yoktur: analiz veri kümesi normal POI ile
           AYNI taksonomiyi kullanır. Slug'ın tek bir tanımı kalmalıdır — 45
           GeoServer stili ona göre eşleşir. */
        var foreignKey = Assert.Single(Entity().GetForeignKeys());

        Assert.Equal(typeof(PoiCategory), foreignKey.PrincipalEntityType.ClrType);
        Assert.Equal("poi_category", foreignKey.PrincipalEntityType.GetTableName());
        Assert.Equal(DeleteBehavior.Restrict, foreignKey.DeleteBehavior);
        Assert.Equal(nameof(AnalysisPoi.CategoryId), Assert.Single(foreignKey.Properties).Name);
    }

    [Fact]
    public void Coordinate_is_a_required_4326_point_with_a_gist_index()
    {
        var coordinate = Property(nameof(AnalysisPoi.Coordinate));

        Assert.Equal("coordinate", coordinate.GetColumnName());
        Assert.False(coordinate.IsNullable);
        Assert.Equal("geometry(Point,4326)", coordinate.GetColumnType());
        Assert.Equal(typeof(Point), coordinate.ClrType);

        var spatial = Assert.Single(
            Entity().GetIndexes(),
            index => index.Properties.Count == 1
                && index.Properties[0].Name == nameof(AnalysisPoi.Coordinate));

        Assert.False(spatial.IsUnique);

        /* İndeksin YÖNTEMİ göç dosyasından doğrulanır: çalışma zamanı modeli
           sağlayıcıya özgü indeks açıklamalarını taşımaz, oysa asıl önemli
           olan üretilecek DDL'dir. GiST — poi.coordinate ile aynı
           yapılandırma; alan yüklemi indekssiz kaldığında veri kümesi
           büyüdükçe tüm tablo taranırdı. */
        Assert.Contains(
            "\"Npgsql:IndexMethod\", \"gist\"",
            Migration(),
            StringComparison.Ordinal);
        Assert.Contains(
            "name: \"IX_analysis_poi_coordinate\"",
            Migration(),
            StringComparison.Ordinal);
    }

    [Fact]
    public void Source_and_external_id_are_required_and_unique_together()
    {
        var source = Property(nameof(AnalysisPoi.Source));
        var externalId = Property(nameof(AnalysisPoi.ExternalId));

        Assert.Equal("source", source.GetColumnName());
        Assert.False(source.IsNullable);
        Assert.Equal(AnalysisPoi.MaxSourceLength, source.GetMaxLength());

        Assert.Equal("external_id", externalId.GetColumnName());
        Assert.False(externalId.IsNullable);
        Assert.Equal(AnalysisPoi.MaxExternalIdLength, externalId.GetMaxLength());

        /* İçe aktarımın fikir birliği anahtarı: kısıt VERİTABANINDADIR, yalnızca
           içe aktarıcının kodunda değil. Yarım kalıp yeniden çalıştırılan bir
           içe aktarım uygulama katmanındaki bir kontrolü atlayabilir; bu
           indeksi atlayamaz. */
        var unique = Assert.Single(Entity().GetIndexes(), index => index.IsUnique);

        Assert.Equal(
            [nameof(AnalysisPoi.Source), nameof(AnalysisPoi.ExternalId)],
            unique.Properties.Select(property => property.Name));
    }

    [Fact]
    public void Imported_at_is_a_required_utc_timestamp()
    {
        var importedAt = Property(nameof(AnalysisPoi.ImportedAt));

        Assert.Equal("imported_at", importedAt.GetColumnName());
        Assert.False(importedAt.IsNullable);
        Assert.Equal("timestamp with time zone", importedAt.GetColumnType());
    }

    /* --- Bilinçli olarak yok olan alanlar ---------------------------------------- */

    [Theory]
    [InlineData("UserId")]
    [InlineData("OwnerId")]
    [InlineData("CreatedBy")]
    [InlineData("IsDeleted")]
    [InlineData("IsActive")]
    public void Ownership_and_lifecycle_columns_do_not_exist(string propertyName)
    {
        /* Bunların YOKLUĞU bir tasarım kararıdır, bir eksiklik değil: açık veri
           kaydının sahibi yoktur ve çöp kutusu akışına girmez. Eklenirlerse,
           kayıt sessizce normal POI gibi davranmaya başlar — PoiAuthority
           üzerinden gerçek düzenleme/silme yetkisi doğar. */
        Assert.Null(Entity().FindProperty(propertyName));
    }

    [Fact]
    public void The_entity_has_no_global_query_filter()
    {
        /* Filtrenin dayanacağı is_deleted/is_active ikilisi bu tabloda yoktur.
           Filtresizlik, "tabloda ne varsa analize girer" sözleşmesini okunur
           kılar. Normal POI'nin filtresi ise DEĞİŞMEDEN durmalıdır. */
        Assert.Null(Entity().GetQueryFilter());
        Assert.NotNull(Model().FindEntityType(typeof(Poi))!.GetQueryFilter());
        Assert.NotNull(Model().FindEntityType(typeof(PoiCategory))!.GetQueryFilter());
    }

    [Fact]
    public void The_entity_is_not_auditable_and_carries_no_drawing_contract()
    {
        /* IAuditableEntity, AppDbContext'in ModifiedDate damgalamasını tetikler
           ve bu kayıtta ModifiedDate yoktur. IDrawingFeature ise kaydı çizim
           listelerine, toplu işlemlere ve stil düzenleyicisine sokardı. */
        Assert.False(typeof(Domain.Common.IAuditableEntity).IsAssignableFrom(typeof(AnalysisPoi)));

        Assert.DoesNotContain(
            typeof(AnalysisPoi).GetInterfaces(),
            contract => contract.Name.Contains("DrawingFeature", StringComparison.Ordinal));
    }

    /* --- Göç -------------------------------------------------------------------- */

    [Fact]
    public void The_migration_only_creates_the_new_table()
    {
        var migration = Migration();

        Assert.Contains("CreateTable", migration, StringComparison.Ordinal);
        Assert.Contains("name: \"analysis_poi\"", migration, StringComparison.Ordinal);

        /* Bir yetki kodu eklemek gibi, bir analiz tablosu eklemek de MEVCUT
           şemaya dokunmamalıdır. Göç yalnızca yeni tabloyu kurar; hiçbir kolon
           değiştirmez, düşürmez veya yeniden adlandırmaz. */
        foreach (var forbidden in (string[])["AlterTable", "AlterColumn", "DropColumn", "RenameColumn", "RenameTable", "Sql("])
        {
            Assert.DoesNotContain(forbidden, migration, StringComparison.Ordinal);
        }
    }

    [Theory]
    [InlineData("poi")]
    [InlineData("poi_category")]
    [InlineData("geographic_authorizations")]
    [InlineData("tbl_point")]
    [InlineData("tbl_line")]
    [InlineData("tbl_polygon")]
    [InlineData("permissions")]
    public void The_migration_touches_no_existing_table(string tableName)
    {
        var migration = Migration();

        /* `poi_category` yalnızca FK'nın PRINCIPAL tablosu olarak geçebilir —
           bu, o tabloyu DEĞİŞTİRMEK değildir. Diğer her tablo adı için hiçbir
           geçiş beklenmez. */
        foreach (var line in migration.Split('\n'))
        {
            if (!line.Contains($"\"{tableName}\"", StringComparison.Ordinal))
            {
                continue;
            }

            Assert.Contains("principalTable", line, StringComparison.Ordinal);
            Assert.Equal("poi_category", tableName);
        }
    }

    [Fact]
    public void The_migration_drops_only_its_own_table_on_rollback()
    {
        var migration = Migration();
        var down = migration[migration.IndexOf("protected override void Down", StringComparison.Ordinal)..];

        Assert.Contains("name: \"analysis_poi\"", down, StringComparison.Ordinal);
        Assert.Single(down.Split(["DropTable"], StringSplitOptions.None)[1..]);
    }

    /* --- Yardımcılar ------------------------------------------------------------ */

    private static IModel Model()
    {
        /* Bağlantı AÇILMAZ: yalnızca model kurulur. Bağlantı dizesi geçerli bir
           biçimdir ama hiçbir zaman kullanılmaz. */
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(
                "Host=localhost;Database=model-only;Username=none;Password=none",
                npgsql => npgsql.UseNetTopologySuite())
            .Options;

        using var context = new AppDbContext(options);
        return context.Model;
    }

    private static IEntityType Entity() => Model().FindEntityType(typeof(AnalysisPoi))!;

    /// <summary>Göç dosyasının kaynak metni; üretilecek DDL'in kendisidir.</summary>
    private static string Migration() =>
        File.ReadAllText(
            Path.Combine(RepositoryRoot, MigrationFile.Replace('/', Path.DirectorySeparatorChar)));

    private static IProperty Property(string name) => Entity().FindProperty(name)!;

    private static string FindRepositoryRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);

        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "global.json"))
                && Directory.Exists(Path.Combine(current.FullName, "geoserver")))
            {
                return current.FullName;
            }

            current = current.Parent;
        }

        throw new InvalidOperationException("Depo kökü bulunamadı.");
    }
}
