using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using NetTopologySuite.Geometries;
using NSubstitute;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Envanter analizinin POI kırılımı.
/// </summary>
/// <remarks>
/// <para>
/// İki ayrı kural birlikte ölçülür:
/// </para>
/// <para>
/// <b>Mekânsal:</b> POI, koordinatı analiz alanıyla kesiştiğinde sayılır ve
/// yalnızca aktif/silinmemiş kayıtlar sayıma girer. Eşleşme ölçütü çizimlerle
/// AYNIdır (<c>Intersects</c>) ve sorgu veritabanı tarafında çalışır.
/// </para>
/// <para>
/// <b>Yetki:</b> POI kırılımı <c>poi.view</c>'a bağlıdır ve
/// <c>inventory.analysis</c> onu ima etmez. Yetkisiz çağıran için ne liste, ne
/// sayı, ne de TOPLAMDA bir iz kalır — bir sayı da bir bilgidir.
/// </para>
/// <para>
/// POI'ler çizimlerin aksine SAHİPLİĞE göre daraltılmaz: ortak envanterdir ve
/// <c>poi.view</c> taşıyan herkes hepsini görür.
/// </para>
/// </remarks>
public class InventoryAnalysisPoiTests
{
    private const int CallerId = 401;
    private const int OtherUserId = 402;

    /// <summary>Ankara çevresini kapsayan analiz alanı.</summary>
    private const string AnalysisArea = "POLYGON ((32 39, 34 39, 34 41, 32 41, 32 39))";

    [Fact]
    public async Task Poi_inside_the_area_is_counted_and_listed()
    {
        await using var db = NewDb();
        await SeedAsync(db, ("İçeride", 32.85, 39.93, true, false, CallerId));

        var result = await AnalyseAsync(db, canViewPois: true);

        Assert.Equal(1, result.PoiCount);
        Assert.Equal("İçeride", Assert.Single(result.Pois).Name);
    }

    [Fact]
    public async Task Poi_outside_the_area_is_excluded()
    {
        await using var db = NewDb();
        // İstanbul: analiz alanının tamamen dışında.
        await SeedAsync(db, ("Dışarıda", 28.97, 41.01, true, false, CallerId));

        var result = await AnalyseAsync(db, canViewPois: true);

        Assert.Equal(0, result.PoiCount);
        Assert.Empty(result.Pois);
    }

    [Fact]
    public async Task Inactive_and_deleted_pois_are_excluded()
    {
        await using var db = NewDb();
        await SeedAsync(
            db,
            ("Pasif", 32.85, 39.93, false, false, CallerId),
            ("Silinmiş", 32.86, 39.94, false, true, CallerId),
            ("Aktif", 32.87, 39.95, true, false, CallerId));

        var result = await AnalyseAsync(db, canViewPois: true);

        Assert.Equal(1, result.PoiCount);
        Assert.Equal("Aktif", Assert.Single(result.Pois).Name);
    }

    [Fact]
    public async Task Pois_of_other_creators_are_counted_too()
    {
        await using var db = NewDb();
        await SeedAsync(
            db,
            ("Kendi", 32.85, 39.93, true, false, CallerId),
            ("Başkasının", 32.86, 39.94, true, false, OtherUserId));

        var result = await AnalyseAsync(db, canViewPois: true);

        // Çizimlerin aksine POI ortak envanterdir; sahiplik sayıyı daraltmaz.
        Assert.Equal(2, result.PoiCount);
    }

    [Fact]
    public async Task Total_includes_the_poi_count()
    {
        await using var db = NewDb();
        await SeedAsync(
            db,
            ("Bir", 32.85, 39.93, true, false, CallerId),
            ("İki", 32.86, 39.94, true, false, CallerId));

        var result = await AnalyseAsync(db, canViewPois: true);

        // Hiç çizim yok; toplam tamamen POI'lerden gelir.
        Assert.Equal(result.PointCount + result.LineCount + result.PolygonCount + result.PoiCount, result.TotalCount);
        Assert.Equal(2, result.TotalCount);
    }

    [Fact]
    public async Task Without_poi_view_nothing_about_pois_leaks()
    {
        await using var db = NewDb();
        await SeedAsync(db, ("Gizli", 32.85, 39.93, true, false, CallerId));

        var result = await AnalyseAsync(db, canViewPois: false);

        Assert.Equal(0, result.PoiCount);
        Assert.Empty(result.Pois);
        // Varlıkları TOPLAM üzerinden de sızmaz.
        Assert.Equal(0, result.TotalCount);
    }

    /* --- Yardımcılar ---------------------------------------------------------------- */

    private static async Task<IntersectionAnalysisResponse> AnalyseAsync(AppDbContext db, bool canViewPois)
    {
        var currentUser = Substitute.For<ICurrentUserService>();
        currentUser.UserId.Returns(CallerId);

        var permissions = Substitute.For<IEffectivePermissionService>();
        permissions.HasPermissionAsync(CallerId, PermissionCodes.PoiView, Arg.Any<CancellationToken>())
            .Returns(canViewPois);

        var service = new SpatialAnalysisService(db, currentUser, permissions);
        var result = await service.CountIntersectionsAsync(
            new IntersectionAnalysisRequest { Wkt = AnalysisArea },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        return result.Value!;
    }

    private static async Task SeedAsync(
        AppDbContext db,
        params (string Name, double Longitude, double Latitude, bool IsActive, bool IsDeleted, int UserId)[] pois)
    {
        db.Users.Add(new User { Id = CallerId, UserName = "caller", EmailConfirmed = true, IsActive = true });
        db.Users.Add(new User { Id = OtherUserId, UserName = "other", EmailConfirmed = true, IsActive = true });

        var category = new PoiCategory { Name = "Yeme-İçme", IsActive = true, CreatedDate = DateTime.UtcNow };
        db.PoiCategories.Add(category);
        await db.SaveChangesAsync();

        foreach (var (name, longitude, latitude, isActive, isDeleted, userId) in pois)
        {
            db.Pois.Add(new Poi
            {
                Name = name,
                CategoryId = category.Id,
                UserId = userId,
                Coordinate = new Point(longitude, latitude) { SRID = 4326 },
                IsActive = isActive,
                IsDeleted = isDeleted,
                CreatedDate = DateTime.UtcNow
            });
        }

        await db.SaveChangesAsync();
    }

    private static AppDbContext NewDb()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"inventory-poi-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

        return new AppDbContext(options);
    }
}
