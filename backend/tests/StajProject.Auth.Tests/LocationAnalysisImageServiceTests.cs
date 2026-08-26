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
/// Sunucuda üretilen ağırlıklı ısı haritasının UÇ sözleşmesi: doğrulama,
/// coğrafi yetki, görünüm seçimi ve GeoServer'a devredilen tek yol.
/// </summary>
/// <remarks>
/// Denklemin kendisi <see cref="LocationAnalysisHeatmapRendererTests"/>'te,
/// veri kümesi <see cref="LocationAnalysisUnionSourceTests"/>'te sabitlenir.
/// Buradaki konu, o hesaba GİRİLMEDEN önce nelerin durduğudur.
/// </remarks>
public class LocationAnalysisImageServiceTests
{
    private const string Ankara = "POLYGON ((32 39, 34 39, 34 41, 32 41, 32 39))";
    private const string Istanbul = "POLYGON ((28 40.5, 29.5 40.5, 29.5 41.5, 28 41.5, 28 40.5))";

    /* --- Coğrafi yetki (ödev §14) --------------------------------------------------- */

    [Fact]
    public async Task An_area_outside_the_users_authorisation_is_refused()
    {
        await using var db = await NewDbAsync();
        var points = Substitute.For<ILocationAnalysisPointsImageService>();

        /* <b>Raster da bir CEVAPTIR.</b> Sayıya erişemeyen birinin aynı
           bilgiyi görüntü olarak alabilmesi, kuralı yalnızca bir uçta
           uygulamak olurdu. Frontend'in listeyi süzmesi bir kolaylıktır;
           sınır BURADADIR. */
        var service = Service(db, points, AreaGuards.Only(Polygon(Istanbul)));

        var result = await service.RenderAsync(Request(), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
    }

    [Fact]
    public async Task An_area_inside_the_users_authorisation_renders_normally()
    {
        await using var db = await NewDbAsync();
        await SeedAsync(db, ("eczane", 5), ("okullar", 5));

        var service = Service(
            db,
            Substitute.For<ILocationAnalysisPointsImageService>(),
            AreaGuards.Only(Polygon("POLYGON ((31 38, 35 38, 35 42, 31 42, 31 38))")));

        var result = await service.RenderAsync(Request(), default);

        Assert.True(result.IsSuccess, result.Error);
    }

    /* --- Doğrulama uçtan ÖNCE ------------------------------------------------------- */

    [Theory]
    [InlineData(10, 10)]
    [InlineData(60, 60)]
    public async Task Weights_that_do_not_total_one_hundred_are_rejected(int first, int second)
    {
        await using var db = await NewDbAsync();

        var result = await Service(db).RenderAsync(Request(("eczane", first), ("okullar", second)), default);

        Assert.False(result.IsSuccess);
    }

    [Theory]
    [InlineData("32,39,34")]
    [InlineData("400,39,34,41")]
    [InlineData("32,95,34,96")]
    [InlineData("34,39,32,41")]
    public async Task A_window_outside_the_shared_contract_is_rejected(string bbox)
    {
        await using var db = await NewDbAsync();

        var request = Request();
        request.Bbox = bbox;

        /* Pencere CRS:84 olarak doğrulanır: sınırlar Web Mercator'a göre
           denetlenseydi 32.74/39.84 gibi coğrafi bir pencere sessizce geçerdi. */
        Assert.False((await Service(db).RenderAsync(request, default)).IsSuccess);
    }

    [Fact]
    public async Task A_criterion_slug_outside_the_request_is_refused()
    {
        await using var db = await NewDbAsync();

        var request = Request();
        request.CriterionSlug = "kafe";

        /* Bu alan analizin KAPSAMINI genişletmek için kullanılamaz: yalnızca
           gönderilmiş bir ölçüte odaklanabilir. */
        Assert.False((await Service(db).RenderAsync(request, default)).IsSuccess);
    }

    [Fact]
    public async Task An_unknown_heatmap_lod_is_refused_before_rendering()
    {
        await using var db = await NewDbAsync();
        var request = Request();
        request.HeatmapLod = "street";

        var result = await Service(db).RenderAsync(request, default);

        Assert.False(result.IsSuccess);
        Assert.Contains("heatmapLod", result.Error, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_focused_render_answers_a_different_question_than_the_combined_one()
    {
        await using var db = await NewDbAsync();
        await SeedAsync(db, ("eczane", 8), ("okullar", 8));

        var combined = await Service(db).RenderAsync(Request(), default);

        var focused = Request();
        focused.CriterionSlug = "eczane";
        var single = await Service(db).RenderAsync(focused, default);

        Assert.True(combined.IsSuccess, combined.Error);
        Assert.True(single.IsSuccess, single.Error);

        /* "Bu kategori nerede yoğun" sorusunu birleşik yüzey yanıtlayamaz;
           iki görüntü aynı olsaydı tek ölçütlü görünümün bir anlamı kalmazdı. */
        Assert.NotEqual(combined.Value!.Content, single.Value!.Content);
    }

    /* --- Mimari sınır --------------------------------------------------------------- */

    [Fact]
    public async Task The_weighted_heatmap_never_calls_GeoServer()
    {
        await using var db = await NewDbAsync();
        await SeedAsync(db, ("eczane", 4), ("okullar", 4));

        var points = Substitute.For<ILocationAnalysisPointsImageService>();

        await Service(db, points).RenderAsync(Request(), default);

        /* <b>Yüzey bir HESAPTIR.</b> vec:Heatmap ölçüt başına normalleştirme
           yapamadığı için denklem tek bir WMS isteğiyle kurulamaz; hesap
           veritabanındaki noktalardan doğrudan üretilir. */
        await points.DidNotReceiveWithAnyArgs().RenderAsync(default!, default);
    }

    [Fact]
    public async Task The_point_overlay_is_delegated_to_GeoServer_untouched()
    {
        await using var db = await NewDbAsync();

        var points = Substitute.For<ILocationAnalysisPointsImageService>();
        points.RenderAsync(Arg.Any<LocationAnalysisImageRequest>(), Arg.Any<CancellationToken>(), Arg.Any<LocationAnalysisImageKind>())
            .Returns(ServiceResult<LocationAnalysisImage>.Success(new LocationAnalysisImage { Content = [1, 2, 3] }));

        var request = Request();
        var result = await Service(db, points).RenderAsync(request, default, LocationAnalysisImageKind.Points);

        /* Nokta örtüsü bir SUNUMdur (kategori işaretleri, ölçek bantları,
           etiket çakışma çözümü) ve GeoServer onu zaten doğru yapıyor. */
        Assert.True(result.IsSuccess, result.Error);
        await points.Received(1).RenderAsync(request, Arg.Any<CancellationToken>(), LocationAnalysisImageKind.Points);
    }

    [Fact]
    public async Task An_empty_area_is_a_successful_transparent_image()
    {
        await using var db = await NewDbAsync();

        /* Seçilen alanda hiç eşleşen kayıt olmaması BİR CEVAPTIR: 404 ya da
           500 değil, geçerli ve tamamen saydam bir PNG. */
        var result = await Service(db).RenderAsync(Request(), default);

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal<byte[]>([137, 80, 78, 71, 13, 10, 26, 10], result.Value!.Content[..8]);
    }

    /* --- Yardımcılar ---------------------------------------------------------------- */

    private static LocationAnalysisImageRequest Request(params (string Slug, int Weight)[] criteria)
    {
        var items = criteria.Length == 0 ? [("eczane", 60), ("okullar", 40)] : criteria;

        return new LocationAnalysisImageRequest
        {
            AreaWkts = [Ankara],
            Criteria = [.. items.Select(item => new LocationAnalysisCriterionRequest
            {
                CategorySlug = item.Slug,
                Weight = item.Weight
            })],
            Bbox = "32,39,34,41",
            Width = 256,
            Height = 256
        };
    }

    private static LocationAnalysisImageService Service(
        AppDbContext db,
        ILocationAnalysisPointsImageService? points = null,
        ILocationAnalysisAreaGuard? guard = null) =>
        new(
            db,
            guard ?? AreaGuards.Unrestricted,
            points ?? Substitute.For<ILocationAnalysisPointsImageService>(),
            Options(),
            NullLogger<LocationAnalysisImageService>.Instance);

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

    private static Geometry Polygon(string wkt)
    {
        var geometry = new NetTopologySuite.IO.WKTReader().Read(wkt);
        geometry.SRID = 4326;

        return geometry;
    }

    private static async Task SeedAsync(AppDbContext db, params (string Slug, int Count)[] rows)
    {
        var factory = new GeometryFactory(new PrecisionModel(), 4326);
        var serial = 0;

        foreach (var (slug, count) in rows)
        {
            var category = await db.PoiCategories.SingleAsync(item => item.Slug == slug);

            for (var index = 0; index < count; index++)
            {
                db.AnalysisPois.Add(new AnalysisPoi
                {
                    Name = $"{slug}-{index}",
                    CategoryId = category.Id,
                    Coordinate = factory.CreatePoint(new Coordinate(
                        32.5 + serial % 10 * 0.05,
                        39.5 + serial % 7 * 0.05)),
                    Source = "osm",
                    ExternalId = $"node/{++serial}",
                    ImportedAt = DateTime.UtcNow
                });
            }
        }

        await db.SaveChangesAsync();
    }

    private static async Task<AppDbContext> NewDbAsync()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"location-analysis-render-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

        var db = new AppDbContext(options);

        var food = new PoiCategory { Name = "Yeme İçme", Slug = "yeme-icme" };
        var health = new PoiCategory { Name = "Sağlık Kurumları", Slug = "saglik-kurumlari" };

        db.PoiCategories.AddRange(food, health);
        await db.SaveChangesAsync();

        db.PoiCategories.AddRange(
            new PoiCategory { Name = "Kafe", Slug = "kafe", ParentId = food.Id },
            new PoiCategory { Name = "Eczane", Slug = "eczane", ParentId = health.Id },
            new PoiCategory { Name = "Okullar", Slug = "okullar" });

        await db.SaveChangesAsync();

        return db;
    }
}
