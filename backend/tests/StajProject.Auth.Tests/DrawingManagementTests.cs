using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using NSubstitute;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Çizim yönetimi fazının davranış sözleşmesi: veri izolasyonu, IDOR koruması,
/// audit alanları, soft delete ve detay güncellemesi.
/// </summary>
/// <remarks>
/// Testler servis katmanına doğrudan bakar; yetkilendirme kuralı
/// (<c>Admin OR sahibi</c>) production'daki
/// <c>DrawingAuthorizationHandler</c> ile aynı şekilde taklit edilir, çünkü
/// gerçek handler HttpContext'e bağlıdır.
/// </remarks>
public class DrawingManagementTests
{
    private const int UserAId = 101;
    private const int UserBId = 202;

    /* --- Veri izolasyonu ve IDOR --------------------------------------------- */

    [Fact]
    public async Task User_sees_only_own_drawings_on_map_load()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var userA = ServiceFor(db, UserAId, "user-a");
        var userB = ServiceFor(db, UserBId, "user-b");

        await userA.CreatePolygonAsync(Create("POLYGON ((28 38, 32 38, 32 42, 28 42, 28 38))", "A-Polygon"), default);
        await userA.CreatePointAsync(Create("POINT (30 40)", "A-Point"), default);
        await userB.CreatePointAsync(Create("POINT (10 10)", "B-Point"), default);

        // Her kullanıcı yalnızca kendi kayıtlarını görür.
        var aPolygons = await userA.GetPolygonsAsync(default);
        var aPoints = await userA.GetPointsAsync(default);
        Assert.Equal("A-Polygon", Assert.Single(aPolygons).Name);
        Assert.Equal("A-Point", Assert.Single(aPoints).Name);

        // B, A'nın hiçbir çizimini göremez.
        Assert.Empty(await userB.GetPolygonsAsync(default));
        Assert.Equal("B-Point", Assert.Single(await userB.GetPointsAsync(default)).Name);
    }

    [Fact]
    public async Task Admin_also_sees_only_own_drawings_on_normal_map_query()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var owner = ServiceFor(db, UserAId, "user-a");
        await owner.CreatePointAsync(Create("POINT (30 40)", "A-Point"), default);

        // Admin, mutation yetkisi olmasına rağmen normal harita sorgusunda
        // başkasının kaydını GÖRMEZ: görünürlük role değil sahipliğe bağlıdır.
        var admin = ServiceFor(db, UserBId, "admin-user", isAdmin: true);
        Assert.Empty(await admin.GetPointsAsync(default));
    }

    [Fact]
    public async Task User_cannot_update_or_delete_another_users_drawing()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var userA = ServiceFor(db, UserAId, "user-a");
        var created = await userA.CreatePolygonAsync(
            Create("POLYGON ((28 38, 32 38, 32 42, 28 42, 28 38))", "A-Polygon"), default);
        Assert.True(created.IsSuccess);

        // B, A'nın id'sini elle göndererek istek yapar (IDOR denemesi).
        var userB = ServiceFor(db, UserBId, "user-b");

        var update = await userB.UpdateAsync(
            DrawingKind.Polygon,
            created.Value!.Id,
            new UpdateDrawingRequest { Name = "ele geçirildi" },
            default);
        Assert.False(update.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, update.ErrorKind);

        var delete = await userB.DeleteAsync(DrawingKind.Polygon, created.Value.Id, default);
        Assert.False(delete.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, delete.ErrorKind);

        // Kayıt hiç değişmedi.
        var stored = await db.Polygons.IgnoreQueryFilters().SingleAsync();
        Assert.Equal("A-Polygon", stored.Name);
        Assert.False(stored.IsDeleted);
        Assert.True(stored.IsActive);
        Assert.Equal(UserAId, stored.CreatedByUserId);
    }

    /* --- Audit alanları ------------------------------------------------------ */

    [Fact]
    public async Task Create_stamps_audit_fields_from_authenticated_identity()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var before = DateTime.UtcNow;
        var created = await ServiceFor(db, UserAId, "user-a")
            .CreatePointAsync(Create("POINT (30 40)", "Denetimli Nokta"), default);
        Assert.True(created.IsSuccess);

        var stored = await db.Points.IgnoreQueryFilters().SingleAsync();

        // Sahiplik istek gövdesinden değil, doğrulanmış kimlikten gelir.
        Assert.Equal(UserAId, stored.CreatedByUserId);
        Assert.False(stored.IsDeleted);
        Assert.True(stored.IsActive);
        Assert.InRange(stored.CreatedDate, before, DateTime.UtcNow);
        Assert.InRange(stored.ModifiedDate, before, DateTime.UtcNow);
        Assert.Null(stored.DeletedAt);
    }

    /* --- Soft delete --------------------------------------------------------- */

    [Fact]
    public async Task Delete_is_soft_and_keeps_the_row_in_the_database()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var service = ServiceFor(db, UserAId, "user-a");
        var created = await service.CreatePointAsync(Create("POINT (30 40)", "Silinecek"), default);
        var createdDate = (await db.Points.IgnoreQueryFilters().SingleAsync()).CreatedDate;

        await Task.Delay(10);
        var deleted = await service.DeleteAsync(DrawingKind.Point, created.Value!.Id, default);
        Assert.True(deleted.IsSuccess);

        // Satır fiziksel olarak DURUYOR; yalnızca işaretleri değişti.
        var stored = await db.Points.IgnoreQueryFilters().SingleAsync();
        Assert.True(stored.IsDeleted);
        Assert.False(stored.IsActive);
        Assert.NotNull(stored.DeletedAt);
        Assert.Equal(UserAId, stored.DeletedByUserId);
        Assert.True(stored.ModifiedDate > createdDate);
        // Sahiplik ve oluşturma zamanı silme sırasında değişmez.
        Assert.Equal(UserAId, stored.CreatedByUserId);
        Assert.Equal(createdDate, stored.CreatedDate);

        // Normal GET sonucunda görünmez.
        Assert.Empty(await service.GetPointsAsync(default));
    }

    [Fact]
    public async Task Deleted_drawing_cannot_be_updated()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var service = ServiceFor(db, UserAId, "user-a");
        var created = await service.CreatePointAsync(Create("POINT (30 40)", "Silinecek"), default);
        await service.DeleteAsync(DrawingKind.Point, created.Value!.Id, default);

        // Silinmiş kayıt query filter nedeniyle bulunamaz: 404.
        var update = await service.UpdateAsync(
            DrawingKind.Point,
            created.Value.Id,
            new UpdateDrawingRequest { Name = "yeniden" },
            default);
        Assert.False(update.IsSuccess);
        Assert.Equal(ServiceErrorKind.NotFound, update.ErrorKind);
    }

    /* --- Detay güncellemesi -------------------------------------------------- */

    [Fact]
    public async Task Update_changes_name_color_geometry_and_advances_modified_date()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var service = ServiceFor(db, UserAId, "user-a");
        var created = await service.CreatePolygonAsync(
            Create("POLYGON ((28 38, 32 38, 32 42, 28 42, 28 38))", "Eski Ad"), default);
        Assert.True(created.IsSuccess);
        var createdDate = created.Value!.CreatedDate;
        var originalModified = created.Value.ModifiedDate;

        await Task.Delay(10);
        var updated = await service.UpdateAsync(
            DrawingKind.Polygon,
            created.Value.Id,
            new UpdateDrawingRequest
            {
                Name = "Yeni Ad",
                Style = new DrawingStyleDto { StrokeColor = "#FF0000" },
                Wkt = "POLYGON ((20 30, 24 30, 24 34, 20 34, 20 30))"
            },
            default);

        Assert.True(updated.IsSuccess);
        Assert.Equal("Yeni Ad", updated.Value!.Name);
        Assert.Equal("#FF0000", updated.Value.Style.StrokeColor);
        Assert.Contains("20 30", updated.Value.Wkt);
        Assert.True(updated.Value.ModifiedDate > originalModified);
        // CreatedDate ve sahiplik güncellemede korunur.
        Assert.Equal(createdDate, updated.Value.CreatedDate);
        Assert.Equal(UserAId, updated.Value.CreatedByUserId);
    }

    [Fact]
    public async Task Update_preserves_fields_that_were_not_sent()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var service = ServiceFor(db, UserAId, "user-a");
        var created = await service.CreatePointAsync(Create("POINT (30 40)", "Korunan Ad"), default);

        // Yalnızca renk gönderilir; ad ve geometry dokunulmadan kalmalı.
        var updated = await service.UpdateAsync(
            DrawingKind.Point,
            created.Value!.Id,
            new UpdateDrawingRequest { Style = new DrawingStyleDto { StrokeColor = "#00FF00" } },
            default);

        Assert.True(updated.IsSuccess);
        Assert.Equal("Korunan Ad", updated.Value!.Name);
        Assert.Equal("#00FF00", updated.Value.Style.StrokeColor);
        Assert.Contains("30 40", updated.Value.Wkt);
    }

    /* --- Geometry doğrulaması ------------------------------------------------ */

    [Theory]
    // Yanlış geometry tipi: polygon ucuna LineString gönderilemez.
    [InlineData("LINESTRING (28 38, 32 42)")]
    // Boş geometry reddedilir.
    [InlineData("POLYGON EMPTY")]
    // Bozuk WKT reddedilir.
    [InlineData("POLYGON ((bozuk))")]
    // 4326 dışı SRID reddedilir; dönüşüm istemci tarafındadır.
    [InlineData("SRID=3857;POLYGON ((28 38, 32 38, 32 42, 28 42, 28 38))")]
    public async Task Update_rejects_invalid_geometry_and_leaves_the_record_untouched(string wkt)
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var service = ServiceFor(db, UserAId, "user-a");
        var created = await service.CreatePolygonAsync(
            Create("POLYGON ((28 38, 32 38, 32 42, 28 42, 28 38))", "Bozulmayan"), default);

        var update = await service.UpdateAsync(
            DrawingKind.Polygon,
            created.Value!.Id,
            new UpdateDrawingRequest { Name = "Yeni Ad", Wkt = wkt },
            default);

        Assert.False(update.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, update.ErrorKind);

        // Geometry reddedildiğinde ad da yazılmamalıdır: yarı uygulanmış
        // güncelleme oluşamaz.
        var stored = await db.Polygons.IgnoreQueryFilters().SingleAsync();
        Assert.Equal("Bozulmayan", stored.Name);
        Assert.Contains("28 38", stored.Geometry.AsText());
    }

    [Fact]
    public async Task Update_rejects_empty_name()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var service = ServiceFor(db, UserAId, "user-a");
        var created = await service.CreatePointAsync(Create("POINT (30 40)", "Adı Var"), default);

        var update = await service.UpdateAsync(
            DrawingKind.Point,
            created.Value!.Id,
            new UpdateDrawingRequest { Name = "   " },
            default);

        Assert.False(update.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, update.ErrorKind);
    }

    /* --- Yardımcılar --------------------------------------------------------- */

    private static AppDbContext NewDb()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"drawing-management-{Guid.NewGuid():N}")
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

    private static DrawingService ServiceFor(AppDbContext db, int userId, string userName, bool isAdmin = false)
    {
        var currentUser = Substitute.For<ICurrentUserService>();
        currentUser.UserId.Returns(userId);
        currentUser.UserName.Returns(userName);
        currentUser.IsAdmin.Returns(isAdmin);

        return new DrawingService(
            db,
            currentUser,
            AuthorizationFor(userId, isAdmin),
            new GeographicAuthorizationService(db),
            new DatabaseDrawingReadService(db));
    }

    /// <summary>
    /// Production kuralının aynısı: <c>Admin OR kaydın sahibi</c>.
    /// Gerçek handler HttpContext'e bağlı olduğu için burada taklit edilir.
    /// </summary>
    private static IDrawingAuthorizationService AuthorizationFor(int userId, bool isAdmin)
    {
        var authorization = Substitute.For<IDrawingAuthorizationService>();

        authorization.CanManageAsync(Arg.Any<IStyledDrawingFeature>())
            .Returns(call => isAdmin || call.Arg<IStyledDrawingFeature>().CreatedByUserId == userId);

        authorization.CanManageAllAsync(Arg.Any<IEnumerable<IStyledDrawingFeature>>())
            .Returns(call => call.Arg<IEnumerable<IStyledDrawingFeature>>()
                .All(drawing => isAdmin || drawing.CreatedByUserId == userId));

        return authorization;
    }

    private static CreateDrawingRequest Create(string wkt, string name) => new()
    {
        Wkt = wkt,
        Name = name,
        Style = new DrawingStyleDto { StrokeColor = "#3366FF" }
    };
}
