using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using NSubstitute;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Harita veri kümesi ile envanter analizi veri kümesinin ayrı kaldığını
/// doğrular (bkz. <see cref="DrawingScopes"/>).
/// </summary>
/// <remarks>
/// <para>
/// Bu testler bir <b>regresyon kilidi</b>dir. Kullanıcı bazlı görünürlük
/// (AUTH-4) doğru davranıştır ve korunmalıdır; ancak aynı filtrenin analiz
/// tarafına da sızması ödevin önceki davranışını sessizce bozar — örneğin
/// ownership filtresi ileride global query filter'a taşınırsa. O durumda
/// aşağıdaki testler kırmızıya döner.
/// </para>
/// <para>
/// Güvenlik tarafı da burada sabitlenir: analiz paylaşılan kümeye baksa bile
/// uçtan yalnızca sayılar döner, ham çizim satırı dönmez.
/// </para>
/// </remarks>
public class InventoryAnalysisScopeTests
{
    private const int UserAId = 301;
    private const int UserBId = 302;

    /// <summary>Her iki kullanıcının çizimlerini de kapsayan analiz alanı.</summary>
    private const string AnalysisArea = "POLYGON ((27 37, 34 37, 34 43, 27 43, 27 37))";

    /* --- Harita: kullanıcı bazlı ------------------------------------------- */

    [Fact]
    public async Task Map_query_returns_only_the_calling_users_drawings()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);
        await SeedTwoUsersDrawingsAsync(db);

        var userA = ServiceFor(db, UserAId, "user-a");
        var userB = ServiceFor(db, UserBId, "user-b");

        Assert.Equal("A-Point", Assert.Single(await userA.GetPointsAsync(default)).Name);
        Assert.Equal("A-Line", Assert.Single(await userA.GetLinesAsync(default)).Name);

        Assert.Equal("B-Point", Assert.Single(await userB.GetPointsAsync(default)).Name);
        Assert.Equal("B-Line", Assert.Single(await userB.GetLinesAsync(default)).Name);
    }

    /* --- Analiz: paylaşılan envanter --------------------------------------- */

    [Fact]
    public async Task Inventory_analysis_counts_the_shared_dataset_not_just_the_callers_drawings()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);
        await SeedTwoUsersDrawingsAsync(db);

        // Analiz servisi kimlik almaz: kapsamı çağırana göre daralmaz.
        var analysis = new SpatialAnalysisService(db);

        var result = await analysis.CountIntersectionsAsync(
            new IntersectionAnalysisRequest { Wkt = AnalysisArea }, default);

        Assert.True(result.IsSuccess);
        // İki kullanıcının kayıtlarının TOPLAMI; A'nın haritada gördüğü 2 değil.
        Assert.Equal(2, result.Value!.PointCount);
        Assert.Equal(2, result.Value.LineCount);
        Assert.Equal(2, result.Value.PolygonCount);
        Assert.Equal(6, result.Value.TotalCount);
    }

    [Fact]
    public async Task Inventory_analysis_result_is_identical_for_both_users()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);
        await SeedTwoUsersDrawingsAsync(db);

        /* Aynı alanın analizi kimin çalıştırdığına göre DEĞİŞMEMELİDİR.
           Bu, "analiz kullanıcı bazlı hâle geldi" regresyonunu yakalayan en
           doğrudan iddiadır: kullanıcı bazlı olsaydı A ile B farklı sayı görürdü. */
        var forUserA = await new SpatialAnalysisService(db)
            .CountIntersectionsAsync(new IntersectionAnalysisRequest { Wkt = AnalysisArea }, default);

        var forUserB = await new SpatialAnalysisService(db)
            .CountIntersectionsAsync(new IntersectionAnalysisRequest { Wkt = AnalysisArea }, default);

        Assert.True(forUserA.IsSuccess);
        Assert.True(forUserB.IsSuccess);
        Assert.Equal(forUserA.Value!.TotalCount, forUserB.Value!.TotalCount);
        Assert.Equal(6, forUserA.Value.TotalCount);
    }

    [Fact]
    public async Task Inventory_analysis_never_returns_raw_drawings()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);
        await SeedTwoUsersDrawingsAsync(db);

        var result = await new SpatialAnalysisService(db)
            .CountIntersectionsAsync(new IntersectionAnalysisRequest { Wkt = AnalysisArea }, default);

        Assert.True(result.IsSuccess);

        /* Sözleşme kontrolü: yanıt yalnızca sayı taşır. Paylaşılan veri kümesine
           bakmak, o kümeyi kullanıcıya AÇMAK anlamına gelmez — response tipine
           ileride bir çizim listesi eklenirse bu test kırılır. */
        var properties = typeof(IntersectionAnalysisResponse).GetProperties();
        Assert.All(properties, property => Assert.Equal(typeof(int), property.PropertyType));
        Assert.Equal(4, properties.Length);
    }

    [Fact]
    public async Task Soft_deleted_drawings_leave_the_inventory_analysis_too()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);
        await SeedTwoUsersDrawingsAsync(db);

        var userA = ServiceFor(db, UserAId, "user-a");
        var point = Assert.Single(await userA.GetPointsAsync(default));
        Assert.True((await userA.DeleteAsync(DrawingKind.Point, point.Id, default)).IsSuccess);

        var result = await new SpatialAnalysisService(db)
            .CountIntersectionsAsync(new IntersectionAnalysisRequest { Wkt = AnalysisArea }, default);

        Assert.True(result.IsSuccess);
        // Paylaşılan küme "silinmişleri de sayar" demek değildir: global query
        // filter analiz yolunda da geçerlidir.
        Assert.Equal(1, result.Value!.PointCount);
        Assert.Equal(5, result.Value.TotalCount);
    }

    [Fact]
    public async Task Excluded_polygon_is_not_counted_as_its_own_match()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);
        await SeedTwoUsersDrawingsAsync(db);

        var ownPolygon = Assert.Single(await ServiceFor(db, UserAId, "user-a").GetPolygonsAsync(default));

        var result = await new SpatialAnalysisService(db).CountIntersectionsAsync(
            new IntersectionAnalysisRequest { Wkt = AnalysisArea, ExcludePolygonId = ownPolygon.Id },
            default);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value!.PolygonCount);
    }

    /* --- Yardımcılar --------------------------------------------------------- */

    private static AppDbContext NewDb()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"inventory-scope-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

        return new AppDbContext(options);
    }

    private static async Task SeedUsersAsync(AppDbContext db)
    {
        db.Users.Add(new User { Id = UserAId, UserName = "user-a", EmailConfirmed = true, IsActive = true });
        db.Users.Add(new User { Id = UserBId, UserName = "user-b", EmailConfirmed = true, IsActive = true });
        await db.SaveChangesAsync();
    }

    /// <summary>
    /// İki kullanıcıya, analiz alanının içinde kalan birer nokta/çizgi/poligon
    /// oluşturur. Toplam 6 kayıt; harita başına 3.
    /// </summary>
    private static async Task SeedTwoUsersDrawingsAsync(AppDbContext db)
    {
        var userA = ServiceFor(db, UserAId, "user-a");
        await userA.CreatePointAsync(Create("POINT (30 40)", "A-Point"), default);
        await userA.CreateLineAsync(Create("LINESTRING (29 39, 31 41)", "A-Line"), default);
        await userA.CreatePolygonAsync(
            Create("POLYGON ((29 39, 31 39, 31 41, 29 41, 29 39))", "A-Polygon"), default);

        var userB = ServiceFor(db, UserBId, "user-b");
        await userB.CreatePointAsync(Create("POINT (33 42)", "B-Point"), default);
        await userB.CreateLineAsync(Create("LINESTRING (32 41, 33.5 42.5)", "B-Line"), default);
        await userB.CreatePolygonAsync(
            Create("POLYGON ((32 41, 33 41, 33 42, 32 42, 32 41))", "B-Polygon"), default);
    }

    private static DrawingService ServiceFor(AppDbContext db, int userId, string userName)
    {
        var currentUser = Substitute.For<ICurrentUserService>();
        currentUser.UserId.Returns(userId);
        currentUser.UserName.Returns(userName);
        currentUser.IsAdmin.Returns(false);

        var authorization = Substitute.For<IDrawingAuthorizationService>();
        authorization.CanManageAsync(Arg.Any<IStyledDrawingFeature>())
            .Returns(call => call.Arg<IStyledDrawingFeature>().CreatedByUserId == userId);
        authorization.CanManageAllAsync(Arg.Any<IEnumerable<IStyledDrawingFeature>>())
            .Returns(call => call.Arg<IEnumerable<IStyledDrawingFeature>>()
                .All(drawing => drawing.CreatedByUserId == userId));

        return new DrawingService(db, currentUser, authorization);
    }

    private static CreateDrawingRequest Create(string wkt, string name) => new()
    {
        Wkt = wkt,
        Name = name,
        Style = new DrawingStyleDto { StrokeColor = "#3366FF" }
    };
}
