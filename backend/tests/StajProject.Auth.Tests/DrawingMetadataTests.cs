using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using NSubstitute;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Drawings;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Açıklama / kategori / etiket metadata'sının davranış sözleşmesi:
/// kalıcılık, doğrulama, PATCH semantiği, yetki ve soft delete etkileşimi.
/// </summary>
public class DrawingMetadataTests
{
    private const int OwnerId = 401;
    private const int IntruderId = 402;

    /* --- Kalıcılık ----------------------------------------------------------- */

    [Fact]
    public async Task Create_persists_description_category_and_tags()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var created = await ServiceFor(db, OwnerId).CreatePointAsync(
            new CreateDrawingRequest
            {
                Wkt = "POINT (32.8597 39.9334)",
                Name = "Ankara Deposu",
                Style = new DrawingStyleDto { StrokeColor = "#3366FF" },
                Description = "Ankara merkez depo alanı",
                Category = DrawingCategories.Inventory,
                Tags = ["ankara", "depo"]
            },
            default);

        Assert.True(created.IsSuccess);
        Assert.Equal("Ankara merkez depo alanı", created.Value!.Description);
        Assert.Equal(DrawingCategories.Inventory, created.Value.Category);
        Assert.Equal(["ankara", "depo"], created.Value.Tags);

        // Yanıt değil, satırın kendisi doğrulanır.
        var stored = await db.Points.IgnoreQueryFilters().SingleAsync();
        Assert.Equal("Ankara merkez depo alanı", stored.Description);
        Assert.Equal(DrawingCategories.Inventory, stored.Category);
        Assert.Equal(["ankara", "depo"], stored.Tags);
    }

    [Fact]
    public async Task Create_without_metadata_leaves_the_fields_empty()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var created = await ServiceFor(db, OwnerId)
            .CreatePointAsync(Create("POINT (30 40)", "Metadata'sız"), default);

        Assert.True(created.IsSuccess);
        Assert.Null(created.Value!.Description);
        Assert.Null(created.Value.Category);
        // Etiketsiz kayıtta null değil BOŞ dizi döner; frontend null kontrolü
        // yapmak zorunda kalmasın diye sözleşme böyledir.
        Assert.Empty(created.Value.Tags);
    }

    [Fact]
    public async Task Update_changes_metadata()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var service = ServiceFor(db, OwnerId);
        var created = await service.CreatePointAsync(Create("POINT (30 40)", "Nokta"), default);

        var updated = await service.UpdateAsync(
            DrawingKind.Point,
            created.Value!.Id,
            new UpdateDrawingRequest
            {
                Description = "Yeni açıklama",
                Category = DrawingCategories.Route,
                Tags = ["kontrol"]
            },
            default);

        Assert.True(updated.IsSuccess);
        Assert.Equal("Yeni açıklama", updated.Value!.Description);
        Assert.Equal(DrawingCategories.Route, updated.Value.Category);
        Assert.Equal(["kontrol"], updated.Value.Tags);
        // Gönderilmeyen alanlar korunur.
        Assert.Equal("Nokta", updated.Value.Name);
    }

    /* --- PATCH semantiği: null korur, boş temizler --------------------------- */

    [Fact]
    public async Task Update_without_metadata_fields_preserves_them()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var service = ServiceFor(db, OwnerId);
        var created = await service.CreatePointAsync(
            WithMetadata("POINT (30 40)", "Nokta", "Korunacak açıklama", DrawingCategories.WorkArea, ["a", "b"]),
            default);

        // Yalnızca ad gönderilir: metadata'ya dokunulmamalı.
        var updated = await service.UpdateAsync(
            DrawingKind.Point,
            created.Value!.Id,
            new UpdateDrawingRequest { Name = "Yeni Ad" },
            default);

        Assert.True(updated.IsSuccess);
        Assert.Equal("Korunacak açıklama", updated.Value!.Description);
        Assert.Equal(DrawingCategories.WorkArea, updated.Value.Category);
        Assert.Equal(["a", "b"], updated.Value.Tags);
    }

    [Fact]
    public async Task Update_with_empty_values_clears_metadata()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var service = ServiceFor(db, OwnerId);
        var created = await service.CreatePointAsync(
            WithMetadata("POINT (30 40)", "Nokta", "Silinecek", DrawingCategories.Boundary, ["x"]),
            default);

        /* Boş metin / boş liste "temizle" demektir. Bu ayrım olmadan yanlışlıkla
           girilmiş bir açıklama hiçbir zaman kaldırılamazdı. */
        var updated = await service.UpdateAsync(
            DrawingKind.Point,
            created.Value!.Id,
            new UpdateDrawingRequest { Description = "", Category = "", Tags = [] },
            default);

        Assert.True(updated.IsSuccess);
        Assert.Null(updated.Value!.Description);
        Assert.Null(updated.Value.Category);
        Assert.Empty(updated.Value.Tags);
    }

    /* --- Doğrulama ------------------------------------------------------------ */

    [Fact]
    public async Task Invalid_category_is_rejected_and_leaves_the_record_untouched()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var service = ServiceFor(db, OwnerId);
        var created = await service.CreatePointAsync(
            WithMetadata("POINT (30 40)", "Nokta", "Bozulmayan", DrawingCategories.General, []),
            default);

        var update = await service.UpdateAsync(
            DrawingKind.Point,
            created.Value!.Id,
            new UpdateDrawingRequest { Name = "Yeni Ad", Category = "Uydurma Kategori" },
            default);

        Assert.False(update.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, update.ErrorKind);

        // Doğrulama YAZMADAN önce bittiği için ad da değişmemiş olmalı.
        var stored = await db.Points.IgnoreQueryFilters().SingleAsync();
        Assert.Equal("Nokta", stored.Name);
        Assert.Equal(DrawingCategories.General, stored.Category);
    }

    [Fact]
    public async Task Category_is_normalized_to_its_canonical_spelling()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        // Client küçük harf gönderse de kolona kanonik yazım gider; gruplama ve
        // filtreleme tek bir yazımla çalışabilsin diye.
        var created = await ServiceFor(db, OwnerId).CreatePointAsync(
            WithMetadata("POINT (30 40)", "Nokta", null, "envanter", []),
            default);

        Assert.True(created.IsSuccess);
        Assert.Equal(DrawingCategories.Inventory, created.Value!.Category);
    }

    [Fact]
    public async Task Too_many_tags_are_rejected()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var tooMany = Enumerable.Range(1, DrawingMetadataValidator.MaxTagCount + 1)
            .Select(index => $"etiket-{index}")
            .ToList();

        var created = await ServiceFor(db, OwnerId).CreatePointAsync(
            WithMetadata("POINT (30 40)", "Nokta", null, null, tooMany),
            default);

        Assert.False(created.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, created.ErrorKind);
        Assert.Empty(await db.Points.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async Task Overlong_tag_is_rejected()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var created = await ServiceFor(db, OwnerId).CreatePointAsync(
            WithMetadata("POINT (30 40)", "Nokta", null, null, [new string('a', DrawingMetadataValidator.MaxTagLength + 1)]),
            default);

        Assert.False(created.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, created.ErrorKind);
    }

    [Fact]
    public async Task Duplicate_tags_are_normalized_case_insensitively()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var created = await ServiceFor(db, OwnerId).CreatePointAsync(
            WithMetadata("POINT (30 40)", "Nokta", null, null, ["Ankara", "  ankara ", "ANKARA", "", "  ", "depo"]),
            default);

        Assert.True(created.IsSuccess);
        // İlk yazım korunur, boşlar sessizce düşer.
        Assert.Equal(["Ankara", "depo"], created.Value!.Tags);
    }

    [Fact]
    public async Task Ten_tags_are_accepted_even_when_written_with_duplicates()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        /* Sayı sınırı tekilleştirmeden SONRA uygulanır: aynı etiketi tekrar
           yazan bir istek sınıra takılıp kullanıcıyı şaşırtmamalı. */
        var withDuplicates = Enumerable.Range(1, DrawingMetadataValidator.MaxTagCount)
            .Select(index => $"etiket-{index}")
            .Concat(["ETIKET-1", "etiket-2"])
            .ToList();

        var created = await ServiceFor(db, OwnerId).CreatePointAsync(
            WithMetadata("POINT (30 40)", "Nokta", null, null, withDuplicates),
            default);

        Assert.True(created.IsSuccess);
        Assert.Equal(DrawingMetadataValidator.MaxTagCount, created.Value!.Tags.Count);
    }

    [Fact]
    public async Task Overlong_description_is_rejected()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var created = await ServiceFor(db, OwnerId).CreatePointAsync(
            WithMetadata("POINT (30 40)", "Nokta", new string('a', DrawingMetadataValidator.MaxDescriptionLength + 1), null, []),
            default);

        Assert.False(created.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, created.ErrorKind);
    }

    /* --- Güvenlik ve soft delete --------------------------------------------- */

    [Fact]
    public async Task Another_user_cannot_update_metadata()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var created = await ServiceFor(db, OwnerId).CreatePointAsync(
            WithMetadata("POINT (30 40)", "Nokta", "Sahibinin açıklaması", DrawingCategories.General, ["özel"]),
            default);

        // IDOR denemesi: başkasının id'si elle gönderiliyor.
        var update = await ServiceFor(db, IntruderId).UpdateAsync(
            DrawingKind.Point,
            created.Value!.Id,
            new UpdateDrawingRequest { Description = "ele geçirildi", Tags = ["saldırgan"] },
            default);

        Assert.False(update.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, update.ErrorKind);

        var stored = await db.Points.IgnoreQueryFilters().SingleAsync();
        Assert.Equal("Sahibinin açıklaması", stored.Description);
        Assert.Equal(["özel"], stored.Tags);
    }

    [Fact]
    public async Task Deleted_drawing_metadata_cannot_be_updated()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var service = ServiceFor(db, OwnerId);
        var created = await service.CreatePointAsync(
            WithMetadata("POINT (30 40)", "Nokta", "Açıklama", DrawingCategories.General, ["etiket"]),
            default);

        await service.DeleteAsync(DrawingKind.Point, created.Value!.Id, default);

        var update = await service.UpdateAsync(
            DrawingKind.Point,
            created.Value.Id,
            new UpdateDrawingRequest { Description = "yeniden" },
            default);

        Assert.False(update.IsSuccess);
        Assert.Equal(ServiceErrorKind.NotFound, update.ErrorKind);
    }

    [Fact]
    public async Task Soft_delete_preserves_metadata_and_restore_brings_it_back()
    {
        await using var db = NewDb();
        await SeedUsersAsync(db);

        var service = ServiceFor(db, OwnerId);
        var created = await service.CreatePointAsync(
            WithMetadata("POINT (30 40)", "Nokta", "Kalıcı açıklama", DrawingCategories.ReferencePoint, ["a", "b"]),
            default);

        await service.DeleteAsync(DrawingKind.Point, created.Value!.Id, default);

        // Fiziksel satır metadata'sıyla birlikte duruyor.
        var deleted = await db.Points.IgnoreQueryFilters().SingleAsync();
        Assert.True(deleted.IsDeleted);
        Assert.Equal("Kalıcı açıklama", deleted.Description);
        Assert.Equal(DrawingCategories.ReferencePoint, deleted.Category);
        Assert.Equal(["a", "b"], deleted.Tags);

        var restored = await service.RestoreAsync(
            new BulkRestoreRequest { Items = [new BulkDrawingItem { Type = "point", Id = created.Value.Id }] },
            default);

        Assert.True(restored.IsSuccess);
        var drawing = restored.Value!.Items.Single().Drawing;
        Assert.Equal("Kalıcı açıklama", drawing.Description);
        Assert.Equal(DrawingCategories.ReferencePoint, drawing.Category);
        Assert.Equal(["a", "b"], drawing.Tags);
    }

    /* --- Yardımcılar --------------------------------------------------------- */

    private static AppDbContext NewDb()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"drawing-metadata-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

        return new AppDbContext(options);
    }

    private static async Task SeedUsersAsync(AppDbContext db)
    {
        db.Users.Add(new User { Id = OwnerId, UserName = "owner", EmailConfirmed = true, IsActive = true });
        db.Users.Add(new User { Id = IntruderId, UserName = "intruder", EmailConfirmed = true, IsActive = true });
        await db.SaveChangesAsync();
    }

    private static DrawingService ServiceFor(AppDbContext db, int userId)
    {
        var currentUser = Substitute.For<ICurrentUserService>();
        currentUser.UserId.Returns(userId);
        currentUser.UserName.Returns($"user-{userId}");
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

    private static CreateDrawingRequest WithMetadata(
        string wkt,
        string name,
        string? description,
        string? category,
        List<string> tags)
    {
        var request = Create(wkt, name);
        request.Description = description;
        request.Category = category;
        request.Tags = tags;
        return request;
    }
}
