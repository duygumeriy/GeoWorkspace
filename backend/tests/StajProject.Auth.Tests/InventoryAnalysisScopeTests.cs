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
/// Envanter analizinin <b>çağıran kullanıcının kendi envanteriyle</b> sınırlı
/// kaldığını doğrular (bkz. <see cref="DrawingScopes"/>).
/// </summary>
/// <remarks>
/// <para>
/// <b>Davranış değişikliği.</b> Analiz bir dönem sahiplikten bağımsız "paylaşılan
/// envanter" kümesini sayıyordu ve bu testler o ayrımı kilitliyordu. Proje kuralı
/// tektir — her kullanıcı yalnızca kendi çizimlerine erişir, analiz dahil — ve
/// eski davranış onu ihlal ediyordu: haritasında 1 çizgi 1 poligon olan kullanıcı
/// "2 çizgi 3 poligon" görüyordu. Testler artık yeni kuralı kilitler.
/// </para>
/// <para>
/// Sayı da bir bilgidir: bir kullanıcı, başkalarının kaç kaydının bir alana
/// değdiğini sayı üzerinden bile öğrenmemelidir.
/// </para>
/// </remarks>
public class InventoryAnalysisScopeTests
{
    private const int UserAId = 301;
    private const int UserBId = 302;

    /// <summary>Her iki kullanıcının çizimlerini de kapsayan analiz alanı.</summary>
    private const string AnalysisArea = "POLYGON ((27 37, 34 37, 34 43, 27 43, 27 37))";

    /* --- Harita ve analiz aynı sınırda -------------------------------------- */

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

    [Fact]
    public async Task Analysis_returns_only_current_users_points()
    {
        var result = await AnalyseAsAsync(UserAId);

        Assert.Equal(1, result.PointCount);
        Assert.Equal("A-Point", Assert.Single(result.Points).Name);
    }

    [Fact]
    public async Task Analysis_returns_only_current_users_lines()
    {
        var result = await AnalyseAsAsync(UserAId);

        Assert.Equal(1, result.LineCount);
        Assert.Equal("A-Line", Assert.Single(result.Lines).Name);
    }

    [Fact]
    public async Task Analysis_returns_only_current_users_polygons()
    {
        var result = await AnalyseAsAsync(UserAId);

        Assert.Equal(1, result.PolygonCount);
        Assert.Equal("A-Polygon", Assert.Single(result.Polygons).Name);
    }

    [Fact]
    public async Task Analysis_result_differs_per_user()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);
        await SeedTwoUsersDrawingsAsync(db);

        var forUserA = await AnalysisFor(db, UserAId)
            .CountIntersectionsAsync(new IntersectionAnalysisRequest { Wkt = AnalysisArea }, default);
        var forUserB = await AnalysisFor(db, UserBId)
            .CountIntersectionsAsync(new IntersectionAnalysisRequest { Wkt = AnalysisArea }, default);

        /* Aynı alanın analizi artık kimin çalıştırdığına GÖRE değişir. Eskiden
           tersini iddia eden bir test vardı; kural değiştiği için iddia da
           tersine döndü. */
        Assert.Equal(3, forUserA.Value!.TotalCount);
        Assert.Equal(3, forUserB.Value!.TotalCount);
        Assert.DoesNotContain(forUserA.Value.Points, item => item.Name.StartsWith("B-"));
        Assert.DoesNotContain(forUserB.Value.Points, item => item.Name.StartsWith("A-"));
    }

    [Fact]
    public async Task Analysis_does_not_expose_other_users_inventory()
    {
        var result = await AnalyseAsAsync(UserAId);

        var everyItem = result.Points.Concat(result.Lines).Concat(result.Polygons).ToList();

        Assert.Equal(3, everyItem.Count);
        // Ne satır, ne isim, ne kimlik: B'ye ait hiçbir iz olmamalı.
        Assert.All(everyItem, item => Assert.StartsWith("A-", item.Name));
    }

    [Fact]
    public async Task Analysis_scope_comes_from_the_identity_not_the_request()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);
        await SeedTwoUsersDrawingsAsync(db);

        /* İstek gövdesinde sahiplik alanı YOKTUR: kapsamı değiştirmek isteyen bir
           client'ın tutunacağı bir alan bulunmaması, sözleşmenin kendisidir. */
        var ownership = typeof(IntersectionAnalysisRequest)
            .GetProperties()
            .Where(property => property.Name.Contains("User", StringComparison.OrdinalIgnoreCase)
                || property.Name.Contains("Owner", StringComparison.OrdinalIgnoreCase));

        Assert.Empty(ownership);

        // Kimliksiz istek hiçbir şey saymaz — başkasının envanterini saymaktansa.
        var anonymous = await AnalysisFor(db, null)
            .CountIntersectionsAsync(new IntersectionAnalysisRequest { Wkt = AnalysisArea }, default);

        Assert.True(anonymous.IsSuccess);
        Assert.Equal(0, anonymous.Value!.TotalCount);
        Assert.Empty(anonymous.Value.Points);
    }

    [Fact]
    public async Task Analysis_items_carry_no_ownership_or_geometry()
    {
        var result = await AnalyseAsAsync(UserAId);

        /* Dar DTO sözleşmesi: sahiplik, soft-delete izi ve geometry taşınmaz.
           Response tipine ileride bunlardan biri eklenirse bu test kırılır. */
        var fields = typeof(InventoryAnalysisItemResponse).GetProperties().Select(property => property.Name).ToList();

        Assert.DoesNotContain("CreatedByUserId", fields);
        Assert.DoesNotContain("CreatedBy", fields);
        Assert.DoesNotContain("Wkt", fields);
        Assert.DoesNotContain("Geometry", fields);
        Assert.DoesNotContain("IsDeleted", fields);

        // Ama kullanıcıya sonucu açıklayan alanlar var.
        var item = Assert.Single(result.Lines);
        Assert.Equal("line", item.DrawingType);
        Assert.Equal("Rota", item.Category);
        Assert.Equal("#3366FF", item.Style.StrokeColor);
    }

    /* --- İki kullanıcı izolasyonu (asimetrik kurulum) ----------------------- */

    [Fact]
    public async Task Two_user_isolation_gives_each_user_only_their_own_matches()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        // A: 1 çizgi + 1 poligon. B: 2 çizgi + 3 poligon. Hepsi aynı alanla keser.
        var userA = ServiceFor(db, UserAId, "user-a");
        await userA.CreateLineAsync(Create("LINESTRING (29 39, 31 41)", "A-Line"), default);
        await userA.CreatePolygonAsync(Create("POLYGON ((29 39, 31 39, 31 41, 29 41, 29 39))", "A-Polygon"), default);

        var userB = ServiceFor(db, UserBId, "user-b");
        await userB.CreateLineAsync(Create("LINESTRING (28 38, 30 40)", "B-Line-1"), default);
        await userB.CreateLineAsync(Create("LINESTRING (32 41, 33 42)", "B-Line-2"), default);
        await userB.CreatePolygonAsync(Create("POLYGON ((28 38, 29 38, 29 39, 28 39, 28 38))", "B-Polygon-1"), default);
        await userB.CreatePolygonAsync(Create("POLYGON ((31 40, 32 40, 32 41, 31 41, 31 40))", "B-Polygon-2"), default);
        await userB.CreatePolygonAsync(Create("POLYGON ((32 41, 33 41, 33 42, 32 42, 32 41))", "B-Polygon-3"), default);

        var forA = (await AnalysisFor(db, UserAId)
            .CountIntersectionsAsync(new IntersectionAnalysisRequest { Wkt = AnalysisArea }, default)).Value!;

        Assert.Equal(0, forA.PointCount);
        Assert.Equal(1, forA.LineCount);
        Assert.Equal(1, forA.PolygonCount);
        Assert.Equal(2, forA.TotalCount);
        Assert.Equal("A-Line", Assert.Single(forA.Lines).Name);
        Assert.Equal("A-Polygon", Assert.Single(forA.Polygons).Name);

        var forB = (await AnalysisFor(db, UserBId)
            .CountIntersectionsAsync(new IntersectionAnalysisRequest { Wkt = AnalysisArea }, default)).Value!;

        Assert.Equal(2, forB.LineCount);
        Assert.Equal(3, forB.PolygonCount);
        Assert.Equal(5, forB.TotalCount);
        Assert.All(forB.Lines.Concat(forB.Polygons), item => Assert.StartsWith("B-", item.Name));
    }

    /* --- Kesişim anlamı ------------------------------------------------------ */

    [Fact]
    public async Task Partial_line_intersection_is_counted()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        // Yalnızca bir ucu alanın içinde: "tamamen kapsanma" aranmaz.
        await ServiceFor(db, UserAId, "user-a")
            .CreateLineAsync(Create("LINESTRING (33 42, 40 42)", "Yarı-Çizgi"), default);

        var result = await RunAsync(db, UserAId);

        Assert.Equal(1, result.LineCount);
        Assert.Equal(IntersectionTypes.Partial, Assert.Single(result.Lines).IntersectionType);
    }

    [Fact]
    public async Task Partial_polygon_intersection_is_counted()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        await ServiceFor(db, UserAId, "user-a")
            .CreatePolygonAsync(Create("POLYGON ((33 42, 40 42, 40 45, 33 45, 33 42))", "Yarı-Alan"), default);

        var result = await RunAsync(db, UserAId);

        Assert.Equal(1, result.PolygonCount);
        Assert.Equal(IntersectionTypes.Partial, Assert.Single(result.Polygons).IntersectionType);
    }

    [Fact]
    public async Task Point_inside_the_analysis_area_is_counted_as_fully_inside()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        await ServiceFor(db, UserAId, "user-a").CreatePointAsync(Create("POINT (30 40)", "İç-Nokta"), default);

        var result = await RunAsync(db, UserAId);

        Assert.Equal(1, result.PointCount);
        Assert.Equal(IntersectionTypes.FullyInside, Assert.Single(result.Points).IntersectionType);
    }

    [Fact]
    public async Task Point_on_the_analysis_boundary_is_counted()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        // Tam sınırın üzerinde: ST_Intersects sınırı da kesişim sayar.
        await ServiceFor(db, UserAId, "user-a").CreatePointAsync(Create("POINT (27 40)", "Sınır-Nokta"), default);

        var result = await RunAsync(db, UserAId);

        Assert.Equal(1, result.PointCount);
    }

    [Fact]
    public async Task Non_intersecting_inventory_is_not_counted()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        await ServiceFor(db, UserAId, "user-a").CreatePointAsync(Create("POINT (10 10)", "Uzak-Nokta"), default);

        var result = await RunAsync(db, UserAId);

        Assert.Equal(0, result.TotalCount);
        Assert.Empty(result.Points);
    }

    /* --- Soft delete / aktiflik --------------------------------------------- */

    [Fact]
    public async Task Deleted_inventory_is_not_counted()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);
        await SeedTwoUsersDrawingsAsync(db);

        var userA = ServiceFor(db, UserAId, "user-a");
        var point = Assert.Single(await userA.GetPointsAsync(default));
        Assert.True((await userA.DeleteAsync(DrawingKind.Point, point.Id, default)).IsSuccess);

        var result = await RunAsync(db, UserAId);

        Assert.Equal(0, result.PointCount);
        Assert.Equal(2, result.TotalCount);
    }

    [Fact]
    public async Task Inactive_inventory_is_not_counted()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);
        await SeedTwoUsersDrawingsAsync(db);

        // IsDeleted'a dokunmadan yalnızca pasifleştir: global query filter
        // ikisini birden şart koşar.
        var stored = await db.Points.IgnoreQueryFilters()
            .SingleAsync(entity => entity.CreatedByUserId == UserAId);
        stored.IsActive = false;
        await db.SaveChangesAsync();

        var result = await RunAsync(db, UserAId);

        Assert.Equal(0, result.PointCount);
    }

    /* --- Kendi kendini sayma ------------------------------------------------- */

    [Fact]
    public async Task Saved_subject_polygon_does_not_count_itself()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var userA = ServiceFor(db, UserAId, "user-a");
        await userA.CreateLineAsync(Create("LINESTRING (29 39, 31 41)", "Mevcut-Çizgi"), default);
        await userA.CreatePolygonAsync(
            Create("POLYGON ((28 38, 30 38, 30 40, 28 40, 28 38))", "Mevcut-Alan"), default);

        // Sonradan kaydedilen ve ikisiyle de kesişen ÖZNE poligon.
        var subject = (await userA.CreatePolygonAsync(
            Create("POLYGON ((29 39, 32 39, 32 42, 29 42, 29 39))", "Yeni-Alan"), default)).Value!;

        var result = (await AnalysisFor(db, UserAId).CountIntersectionsAsync(
            new IntersectionAnalysisRequest { Wkt = subject.Wkt, ExcludePolygonId = subject.Id },
            default)).Value!;

        // Özne kendini saymaz: 2 değil 1 poligon.
        Assert.Equal(1, result.LineCount);
        Assert.Equal(1, result.PolygonCount);
        Assert.Equal("Mevcut-Alan", Assert.Single(result.Polygons).Name);
        Assert.DoesNotContain(result.Polygons, item => item.Id == subject.Id);
    }

    /* --- Sayı / liste tutarlılığı -------------------------------------------- */

    [Fact]
    public async Task Counts_match_detail_list_lengths_and_total()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);
        await SeedTwoUsersDrawingsAsync(db);

        var result = await RunAsync(db, UserAId);

        Assert.Equal(result.Points.Count, result.PointCount);
        Assert.Equal(result.Lines.Count, result.LineCount);
        Assert.Equal(result.Polygons.Count, result.PolygonCount);
        Assert.Equal(result.PointCount + result.LineCount + result.PolygonCount, result.TotalCount);
    }

    /* --- Yardımcılar --------------------------------------------------------- */

    /// <summary>Standart iki kullanıcılı kurulum üzerinde tek analiz çalıştırır.</summary>
    private static async Task<IntersectionAnalysisResponse> AnalyseAsAsync(int userId)
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);
        await SeedTwoUsersDrawingsAsync(db);
        return await RunAsync(db, userId);
    }

    private static async Task<IntersectionAnalysisResponse> RunAsync(AppDbContext db, int userId)
    {
        var result = await AnalysisFor(db, userId)
            .CountIntersectionsAsync(new IntersectionAnalysisRequest { Wkt = AnalysisArea }, default);

        Assert.True(result.IsSuccess);
        return result.Value!;
    }

    private static SpatialAnalysisService AnalysisFor(AppDbContext db, int? userId)
    {
        var currentUser = Substitute.For<ICurrentUserService>();
        currentUser.UserId.Returns(userId);
        return new SpatialAnalysisService(db, currentUser);
    }

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
    /// oluşturur. Toplam 6 kayıt; kullanıcı başına 3.
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

        return new DrawingService(db, currentUser, authorization, new GeographicAuthorizationService(db));
    }

    private static CreateDrawingRequest Create(string wkt, string name) => new()
    {
        Wkt = wkt,
        Name = name,
        Category = DrawingCategories.Route,
        Style = new DrawingStyleDto { StrokeColor = "#3366FF" }
    };
}
