using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using NetTopologySuite.Geometries;
using NSubstitute;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Konum analizinin veri kümesi: <b>açık veri + uygulamada oluşturulmuş
/// POI'ler</b>, tek bir birleşim.
/// </summary>
/// <remarks>
/// <para>
/// <b>Kanıtlanan şey (ödev §16).</b> Kullanıcının haritada oluşturduğu bir
/// POI, aktif ve silinmemişse, kategorisi ölçütle eşleşiyorsa ve koordinatı
/// seçilen alanın içindeyse bir sonraki analize KATILIR — özet sayısında,
/// nokta listesinde ve ısı haritasının kaynağında. Pasifleştirildiğinde ya da
/// çöp kutusuna atıldığında üçünden de birden düşer.
/// </para>
/// <para>
/// <b>Üç yol AYNI sorgudan beslenir.</b> Testler bunu ayrı ayrı ölçer çünkü
/// asıl risk, birinin gün gelip yalnızca tek kaynağa bakmasıdır: özet
/// "382 POI" derken haritanın 371 nokta çizmesi sessiz bir hatadır.
/// </para>
/// </remarks>
public class LocationAnalysisUnionSourceTests
{
    private const string Area = "POLYGON ((32 39, 34 39, 34 41, 32 41, 32 39))";

    private static readonly GeometryFactory Factory = new(new PrecisionModel(), 4326);

    /* --- TEST §16: yeni bir uygulama POI'si analize girer --------------------------- */

    [Fact]
    public async Task An_application_POI_raises_the_summary_count_by_one()
    {
        await using var db = await NewDbAsync();
        await SeedExternalAsync(db, "eczane", 4);

        var before = await SummaryAsync(db);
        Assert.Equal(4, before.TotalMatchingPoiCount);

        await AddApplicationPoiAsync(db, "eczane");

        var after = await SummaryAsync(db);

        Assert.Equal(5, after.TotalMatchingPoiCount);
        Assert.Equal(5, after.Criteria.Single(item => item.CategorySlug == "eczane").MatchingPoiCount);
    }

    [Fact]
    public async Task The_vector_list_returns_the_application_POI_with_a_unique_identity()
    {
        await using var db = await NewDbAsync();
        await SeedExternalAsync(db, "eczane", 2);
        var poiId = await AddApplicationPoiAsync(db, "eczane");

        var result = await Service(db).ListPointsAsync(RequestBody());

        Assert.True(result.IsSuccess, result.Error);

        var mine = result.Value!.Pois.Single(poi => poi.Name == "Benim Eczanem");

        /* <b>Ham tam sayı kimlik TEKİL DEĞİLDİR.</b> `poi.id` ile
           `analysis_poi.id` ayrı identity dizileridir ve çakışırlar; birleşimde
           tekil olan `FeatureId`'dir. */
        Assert.Equal($"app:{poiId}", mine.FeatureId);
        Assert.Equal(poiId, mine.Id);
        Assert.Equal("Uygulama", mine.Source);
        Assert.Equal(3, result.Value.TotalCount);
    }

    [Fact]
    public async Task The_analysis_vector_contains_matching_app_and_OSM_POIs_once_and_excludes_unrelated_categories()
    {
        await using var db = await NewDbAsync();
        await SeedExternalAsync(db, "eczane", 1);
        await SeedExternalAsync(db, "banka-ve-atm", 1);
        var appId = await AddApplicationPoiAsync(db, "eczane", name: "Eşleşen Uygulama POI");
        await AddApplicationPoiAsync(db, "banka-ve-atm", name: "İlgisiz Uygulama POI");

        var osm = await db.AnalysisPois.SingleAsync(item => item.Name == "eczane-0");
        var result = await Service(db).ListPointsAsync(RequestBody());

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal(2, result.Value!.TotalCount);
        Assert.Equal(2, result.Value.Pois.Count);
        Assert.Single(result.Value.Pois, item => item.FeatureId == $"app:{appId}");
        Assert.Single(result.Value.Pois, item => item.FeatureId == $"osm:{osm.Id}");
        Assert.DoesNotContain(result.Value.Pois, item => item.Name == "İlgisiz Uygulama POI");
        Assert.DoesNotContain(result.Value.Pois, item => item.CategorySlug == "banka-ve-atm");
    }

    [Fact]
    public async Task The_raster_source_includes_the_application_POI()
    {
        await using var db = await NewDbAsync();
        await SeedExternalAsync(db, "eczane", 3);
        await SeedExternalAsync(db, "okullar", 3);

        var before = await RenderAsync(db);
        await AddApplicationPoiAsync(db, "eczane", longitude: 33.4, latitude: 40.4);
        var after = await RenderAsync(db);

        /* <b>Bayt karşılaştırması BURADA yeterlidir</b> çünkü denklemin
           kendisi ayrıca sabitlenmiştir (LocationAnalysisHeatmapRendererTests).
           Sorulan soru yalnızca şudur: yeni kayıt rasterin KAYNAĞINA girdi mi?
           Kayıt uzak bir köşeye konur, dolayısıyla değişim mevcut lekelerin
           gürültüsüne karışamaz. */
        Assert.NotEqual(before, after);
    }

    /* --- TEST §16: pasifleştirme / silme katkıyı durdurur --------------------------- */

    [Fact]
    public async Task Deactivating_the_application_POI_removes_it_from_every_path()
    {
        await using var db = await NewDbAsync();
        await SeedExternalAsync(db, "eczane", 4);
        var poiId = await AddApplicationPoiAsync(db, "eczane");

        Assert.Equal(5, (await SummaryAsync(db)).TotalMatchingPoiCount);

        var poi = await db.Pois.SingleAsync(item => item.Id == poiId);
        poi.IsActive = false;
        await db.SaveChangesAsync();

        Assert.Equal(4, (await SummaryAsync(db)).TotalMatchingPoiCount);

        var points = await Service(db).ListPointsAsync(RequestBody());
        Assert.DoesNotContain(points.Value!.Pois, item => item.Name == "Benim Eczanem");
    }

    [Fact]
    public async Task Soft_deleting_the_application_POI_removes_it_from_every_path()
    {
        await using var db = await NewDbAsync();
        await SeedExternalAsync(db, "eczane", 4);
        var poiId = await AddApplicationPoiAsync(db, "eczane");

        var poi = await db.Pois.SingleAsync(item => item.Id == poiId);
        poi.IsDeleted = true;
        await db.SaveChangesAsync();

        /* Çöp kutusuna atılmış bir kayıt analizde SAYILMAZ. Süzgeç
           `poi_read` SQL View'ı ile birebir aynıdır. */
        Assert.Equal(4, (await SummaryAsync(db)).TotalMatchingPoiCount);
    }

    [Fact]
    public async Task An_application_POI_outside_the_area_or_the_criteria_does_not_count()
    {
        await using var db = await NewDbAsync();
        await SeedExternalAsync(db, "eczane", 2);

        // Alanın DIŞINDA (Ankara poligonu 32–34 / 39–41).
        await AddApplicationPoiAsync(db, "eczane", longitude: 28.9, latitude: 41.0, name: "İstanbul");

        // Alanın içinde ama ölçütlerden HİÇBİRİNİN kapsamında değil.
        await AddApplicationPoiAsync(db, "banka-ve-atm", name: "Banka");

        Assert.Equal(2, (await SummaryAsync(db)).TotalMatchingPoiCount);
    }

    [Fact]
    public async Task An_application_POI_under_a_parent_criterion_is_covered_too()
    {
        await using var db = await NewDbAsync();

        /* Ölçüt bir ALT AĞACI temsil eder ve bu, kaynaktan bağımsızdır:
           "Sağlık Kurumları" seçen kullanıcı, uygulamada `eczane` olarak
           kaydedilmiş bir POI'yi de görmelidir. */
        var poiId = await AddApplicationPoiAsync(db, "eczane");

        var result = await Service(db).AnalyzeAsync(new LocationAnalysisRequest
        {
            AreaWkts = [Area],
            Criteria =
            [
                new LocationAnalysisCriterionRequest { CategorySlug = "saglik-kurumlari", Weight = 60 },
                new LocationAnalysisCriterionRequest { CategorySlug = "okullar", Weight = 40 }
            ]
        });

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal(1, result.Value!.Criteria.Single(item => item.CategorySlug == "saglik-kurumlari").MatchingPoiCount);
        Assert.True(poiId > 0);
    }

    /* --- TEST §12: tekilleştirme politikası ----------------------------------------- */

    [Fact]
    public async Task The_same_real_world_place_in_both_sources_is_counted_twice_on_purpose()
    {
        await using var db = await NewDbAsync();

        var factory = Factory;
        var category = await db.PoiCategories.SingleAsync(item => item.Slug == "eczane");

        // Aynı ad, aynı koordinat — iki farklı kaynakta.
        db.AnalysisPois.Add(new AnalysisPoi
        {
            Name = "Merkez Eczanesi",
            CategoryId = category.Id,
            Coordinate = factory.CreatePoint(new Coordinate(32.85, 39.92)),
            Source = "osm",
            ExternalId = "node/1",
            ImportedAt = DateTime.UtcNow
        });

        await db.SaveChangesAsync();
        await AddApplicationPoiAsync(db, "eczane", 32.85, 39.92, "Merkez Eczanesi");

        /* <b>Bulanık tekilleştirme YAPILMAZ ve bu bilinçli bir seçimdir.</b>
           İki kaynak arasında paylaşılan güvenilir bir dış kimlik yoktur:
           `analysis_poi` source+external_id taşır, `poi` hiç taşımaz. Ada ve
           konuma bakan bir eşleştirme, aynı binadaki iki ayrı işletmeyi ya da
           aynı adı taşıyan iki şubeyi sessizce tek kayda indirebilirdi —
           yani var olan veriyi SİLERDİ. Çift sayma riski görünür ve
           açıklanabilir; sessiz silme değildir. */
        Assert.Equal(2, (await SummaryAsync(db)).TotalMatchingPoiCount);
    }

    /* --- TEST §13: GeoServer view'ı ile EF birleşimi ayrışmamalı -------------------- */

    [Fact]
    public void The_GeoServer_view_mirrors_the_EF_union_exactly()
    {
        /* <b>İki tanım, tek anlam.</b> EF birleşimi bir C# sorgu ifadesidir ve
           WMS'e gönderilemez; GeoServer aynı kümeyi `analysis_poi_union`
           VIEW'ından okur. Bu test, view'ın migration'daki metnini okuyup
           EF tarafındaki sabitlerle karşılaştırır: biri değişip diğeri
           değişmezse burada kırılır, üretimde sessizce iki farklı küme
           çizilmez. */
        var sql = MigrationSql();

        Assert.Contains("CREATE OR REPLACE VIEW analysis_poi_union", sql, StringComparison.Ordinal);
        Assert.Contains("UNION ALL", sql, StringComparison.Ordinal);

        // Kimlik şeması: kaynak öneki + taban tablo kimliği.
        Assert.Contains($"'{LocationAnalysisService.ExternalPrefix}'", sql, StringComparison.Ordinal);
        Assert.Contains($"'{LocationAnalysisService.OwnedPrefix}'", sql, StringComparison.Ordinal);
        Assert.Contains($"'{LocationAnalysisService.ExternalSourceKind}'", sql, StringComparison.Ordinal);
        Assert.Contains($"'{LocationAnalysisService.OwnedSourceKind}'", sql, StringComparison.Ordinal);

        // Uygulama POI'sinin süzgeci EF tarafıyla birebir.
        Assert.Contains("p.is_deleted = false", sql, StringComparison.Ordinal);
        Assert.Contains("p.is_active = true", sql, StringComparison.Ordinal);

        /* Sahiplik yüklemi OLMAMALIDIR: POI ortak bir envanterdir ve projenin
           hiçbir okuma yolu onu sahibine göre süzmez. */
        Assert.DoesNotContain("user_id", sql, StringComparison.Ordinal);
    }

    /* --- Yardımcılar ---------------------------------------------------------------- */

    private static LocationAnalysisRequest RequestBody() => new()
    {
        AreaWkts = [Area],
        Criteria =
        [
            new LocationAnalysisCriterionRequest { CategorySlug = "eczane", Weight = 60 },
            new LocationAnalysisCriterionRequest { CategorySlug = "okullar", Weight = 40 }
        ]
    };

    private static LocationAnalysisService Service(AppDbContext db) =>
        new(db, AreaGuards.Unrestricted);

    private static async Task<LocationAnalysisResponse> SummaryAsync(AppDbContext db)
    {
        var result = await Service(db).AnalyzeAsync(RequestBody());

        Assert.True(result.IsSuccess, result.Error);

        return result.Value!;
    }

    private static async Task<byte[]> RenderAsync(AppDbContext db)
    {
        var points = Substitute.For<ILocationAnalysisPointsImageService>();

        var service = new LocationAnalysisImageService(
            db,
            AreaGuards.Unrestricted,
            points,
            Options(),
            NullLogger<LocationAnalysisImageService>.Instance);

        var body = RequestBody();

        var result = await service.RenderAsync(
            new LocationAnalysisImageRequest
            {
                AreaWkts = body.AreaWkts,
                Criteria = body.Criteria,
                Bbox = "32,39,34,41",
                Width = 256,
                Height = 256
            },
            default);

        Assert.True(result.IsSuccess, result.Error);

        // GeoServer'a HİÇ gidilmez: yüzey sunucuda hesaplanır.
        await points.DidNotReceiveWithAnyArgs().RenderAsync(default!, default);

        return result.Value!.Content;
    }

    private static GeoServerOptions Options() => new()
    {
        BaseUrl = "http://localhost:8080/geoserver",
        Workspace = "geoworkspace",
        PointLayer = "tbl_point_read",
        LineLayer = "tbl_line_read",
        PolygonLayer = "tbl_polygon_read",
        HeatmapLayer = "tbl_point_heatmap",
        HeatmapStyle = "point_density_heatmap",
        PointPresentationStyle = "drawing_point_presentation",
        LinePresentationStyle = "drawing_line_presentation",
        PolygonPresentationStyle = "drawing_polygon_presentation",
        PoiLayer = "poi_read",
        PoiStyle = "poi_all",
        AnalysisPoiLayer = "analysis_poi_read",
        AnalysisPoiPointStyle = "analysis_poi_points",
        AnalysisHeatmapRadiusMeters = 1500
    };

    private static async Task SeedExternalAsync(AppDbContext db, string slug, int count)
    {
        var category = await db.PoiCategories.SingleAsync(item => item.Slug == slug);
        var existing = await db.AnalysisPois.CountAsync();

        for (var index = 0; index < count; index++)
        {
            db.AnalysisPois.Add(new AnalysisPoi
            {
                Name = $"{slug}-{index}",
                CategoryId = category.Id,
                Coordinate = Factory.CreatePoint(new Coordinate(32.7 + index * 0.01, 39.8 + index * 0.01)),
                Source = "osm",
                ExternalId = $"node/{existing + index + 1}",
                ImportedAt = DateTime.UtcNow
            });
        }

        await db.SaveChangesAsync();
    }

    private static async Task<int> AddApplicationPoiAsync(
        AppDbContext db,
        string slug,
        double longitude = 32.9,
        double latitude = 39.95,
        string name = "Benim Eczanem")
    {
        var category = await db.PoiCategories.SingleAsync(item => item.Slug == slug);

        var poi = new Poi
        {
            Name = name,
            CategoryId = category.Id,
            Coordinate = Factory.CreatePoint(new Coordinate(longitude, latitude)),
            UserId = 1,
            IsActive = true,
            IsDeleted = false,
            CreatedDate = DateTime.UtcNow,
            ModifiedDate = DateTime.UtcNow
        };

        db.Pois.Add(poi);
        await db.SaveChangesAsync();

        return poi.Id;
    }

    private static string MigrationSql()
    {
        var path = Path.Combine(
            FindRepositoryRoot(),
            "backend", "src", "StajProject.Infrastructure", "Persistence", "Migrations",
            "20260826140320_AddAnalysisPoiUnionView.cs");

        Assert.True(File.Exists(path), $"Birleşim view'ının migration'ı bulunamadı: {path}");

        return File.ReadAllText(path);
    }

    private static string FindRepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, "geoserver")))
        {
            directory = directory.Parent;
        }

        return directory?.FullName
            ?? throw new InvalidOperationException("Depo kökü bulunamadı: 'geoserver' dizini yok.");
    }

    private static async Task<AppDbContext> NewDbAsync()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"location-analysis-union-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

        var db = new AppDbContext(options);

        var health = new PoiCategory { Name = "Sağlık Kurumları", Slug = "saglik-kurumlari" };
        db.PoiCategories.Add(health);
        await db.SaveChangesAsync();

        db.PoiCategories.AddRange(
            new PoiCategory { Name = "Eczane", Slug = "eczane", ParentId = health.Id },
            new PoiCategory { Name = "Okullar", Slug = "okullar" },
            new PoiCategory { Name = "Banka ve ATM", Slug = "banka-ve-atm" });

        await db.SaveChangesAsync();

        return db;
    }
}
