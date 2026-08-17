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
/// Çöp Kutusu'nun davranış sözleşmesi: silinen kayıt listede görünür, aktif
/// kayıt görünmez, <b>başka kullanıcının silinmiş kaydı hiçbir koşulda
/// görünmez</b>, ve geri yükleme aynı satırı aynı id ile geri açar.
/// </summary>
/// <remarks>
/// <para>
/// Buradaki asıl risk, listeleme sorgusunun global query filter'ı bilerek
/// atlamasıdır: filtre atlandığı anda sahiplik koruması da atlanmış olsaydı bir
/// kullanıcı başkasının çöp kutusunu okuyabilirdi. Testler bu yüzden hem
/// listeleme hem geri yükleme tarafında sahipliği ayrı ayrı kilitler.
/// </para>
/// <para>
/// Testler servis katmanına doğrudan bakar; yetkilendirme kuralı
/// (<c>Admin OR sahibi</c>) production'daki <c>DrawingAuthorizationHandler</c>
/// ile aynı şekilde taklit edilir, çünkü gerçek handler HttpContext'e bağlıdır.
/// </para>
/// </remarks>
public class DrawingTrashTests
{
    private const int UserAId = 101;
    private const int UserBId = 202;

    /* --- Listeleme ----------------------------------------------------------- */

    [Fact]
    public async Task Deleted_drawing_of_the_current_user_appears_in_the_trash()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var service = ServiceFor(db, UserAId, "user-a");
        var created = await service.CreatePointAsync(Create("POINT (30 40)", "Ankara Ofis"), default);
        Assert.True(created.IsSuccess);

        await service.DeleteAsync(DrawingKind.Point, created.Value!.Id, default);

        var trash = await service.GetDeletedAsync(default);

        var item = Assert.Single(trash);
        Assert.Equal("point", item.Type);
        Assert.Equal(created.Value.Id, item.Drawing.Id);
        Assert.Equal("Ankara Ofis", item.Drawing.Name);
        // Silinme tarihi listenin sıralama anahtarıdır; boş dönerse panel
        // tarihe göre sıralayamaz.
        Assert.NotNull(item.DeletedAt);
        // Kayıt gövdesi normal listeyle aynı sözleşmedir: stil ve WKT dolu gelir.
        Assert.Equal("#3366FF", item.Drawing.Style.StrokeColor);
        Assert.Contains("30 40", item.Drawing.Wkt);
    }

    [Fact]
    public async Task Active_drawing_is_not_in_the_trash()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var service = ServiceFor(db, UserAId, "user-a");
        await service.CreatePointAsync(Create("POINT (30 40)", "Duran Nokta"), default);

        // Silinmemiş kayıt Çöp Kutusu'na düşmez; buna karşılık haritada durur.
        Assert.Empty(await service.GetDeletedAsync(default));
        Assert.Single(await service.GetPointsAsync(default));
    }

    [Fact]
    public async Task Trash_never_shows_another_users_deleted_drawing()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var userB = ServiceFor(db, UserBId, "user-b");
        var created = await userB.CreatePolygonAsync(
            Create("POLYGON ((28 38, 32 38, 32 42, 28 42, 28 38))", "B-Poligon"), default);
        await userB.DeleteAsync(DrawingKind.Polygon, created.Value!.Id, default);

        // A'nın çöp kutusu boştur: kayıt veritabanında silinmiş olarak DURUYOR,
        // ama sahibi B.
        Assert.Empty(await ServiceFor(db, UserAId, "user-a").GetDeletedAsync(default));

        // Sahibi kendi çöp kutusunda görmeye devam eder.
        Assert.Single(await userB.GetDeletedAsync(default));
    }

    /// <summary>
    /// Admin'in mutation yetkisi görünürlüğü genişletmez: Çöp Kutusu, normal
    /// harita sorgusuyla aynı sahiplik sınırındadır.
    /// </summary>
    [Fact]
    public async Task Admin_trash_shows_only_the_admins_own_deleted_drawings()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var owner = ServiceFor(db, UserAId, "user-a");
        var created = await owner.CreatePointAsync(Create("POINT (30 40)", "A-Nokta"), default);
        await owner.DeleteAsync(DrawingKind.Point, created.Value!.Id, default);

        var admin = ServiceFor(db, UserBId, "admin-user", isAdmin: true);
        Assert.Empty(await admin.GetDeletedAsync(default));
    }

    /// <summary>
    /// Üç tür tek listede döner — kullanıcı için tek bir Çöp Kutusu vardır.
    /// </summary>
    [Fact]
    public async Task Trash_combines_all_three_types_newest_deleted_first()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var service = ServiceFor(db, UserAId, "user-a");

        var point = await service.CreatePointAsync(Create("POINT (30 40)", "Nokta"), default);
        var line = await service.CreateLineAsync(Create("LINESTRING (28 38, 32 42)", "Çizgi"), default);
        var polygon = await service.CreatePolygonAsync(
            Create("POLYGON ((28 38, 32 38, 32 42, 28 42, 28 38))", "Poligon"), default);

        // Silme sırası: nokta, çizgi, poligon. Beklenen liste bunun tersidir.
        await service.DeleteAsync(DrawingKind.Point, point.Value!.Id, default);
        await Task.Delay(10);
        await service.DeleteAsync(DrawingKind.Line, line.Value!.Id, default);
        await Task.Delay(10);
        await service.DeleteAsync(DrawingKind.Polygon, polygon.Value!.Id, default);

        var trash = await service.GetDeletedAsync(default);

        Assert.Equal(3, trash.Count);
        Assert.Equal(["polygon", "line", "point"], trash.Select(item => item.Type));
    }

    /* --- Geri yükleme -------------------------------------------------------- */

    [Fact]
    public async Task Restore_reopens_the_same_row_and_clears_the_delete_marks()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var service = ServiceFor(db, UserAId, "user-a");
        var created = await service.CreatePointAsync(Create("POINT (30 40)", "Geri Gelecek"), default);
        var id = created.Value!.Id;

        await service.DeleteAsync(DrawingKind.Point, id, default);

        var deleted = await db.Points.IgnoreQueryFilters().SingleAsync();
        Assert.True(deleted.IsDeleted);
        Assert.False(deleted.IsActive);

        var restored = await service.RestoreAsync(RestoreRequest("point", id), default);
        Assert.True(restored.IsSuccess);

        // YENİ kayıt oluşmaz: tabloda hâlâ tek satır ve aynı id var.
        var stored = await db.Points.IgnoreQueryFilters().SingleAsync();
        Assert.Equal(id, stored.Id);
        Assert.False(stored.IsDeleted);
        Assert.True(stored.IsActive);
        Assert.Null(stored.DeletedAt);
        Assert.Null(stored.DeletedByUserId);
        // Sahiplik ve içerik geri yüklemede değişmez.
        Assert.Equal(UserAId, stored.CreatedByUserId);
        Assert.Equal("Geri Gelecek", stored.Name);

        // Kayıt haritaya döner ve Çöp Kutusu'ndan kalkar.
        Assert.Equal(id, Assert.Single(await service.GetPointsAsync(default)).Id);
        Assert.Empty(await service.GetDeletedAsync(default));
    }

    [Fact]
    public async Task User_cannot_restore_another_users_deleted_drawing()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var owner = ServiceFor(db, UserAId, "user-a");
        var created = await owner.CreatePointAsync(Create("POINT (30 40)", "A-Nokta"), default);
        await owner.DeleteAsync(DrawingKind.Point, created.Value!.Id, default);

        // B, id'yi elle göndererek geri yüklemeyi dener (IDOR).
        var restore = await ServiceFor(db, UserBId, "user-b")
            .RestoreAsync(RestoreRequest("point", created.Value.Id), default);

        Assert.False(restore.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, restore.ErrorKind);

        // Kayıt silinmiş olarak KALIR: yetkisiz istek hiçbir işareti değiştirmez.
        var stored = await db.Points.IgnoreQueryFilters().SingleAsync();
        Assert.True(stored.IsDeleted);
        Assert.False(stored.IsActive);
        Assert.NotNull(stored.DeletedAt);
        Assert.Equal(UserAId, stored.CreatedByUserId);
    }

    /* --- Yardımcılar --------------------------------------------------------- */

    private static BulkRestoreRequest RestoreRequest(string type, int id) => new()
    {
        Items = [new BulkDrawingItem { Type = type, Id = id }]
    };

    private static AppDbContext NewDb()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"drawing-trash-{Guid.NewGuid():N}")
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

        return new DrawingService(db, currentUser, AuthorizationFor(userId, isAdmin));
    }

    /// <summary>Production kuralının aynısı: <c>Admin OR kaydın sahibi</c>.</summary>
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
