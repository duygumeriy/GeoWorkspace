using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using NSubstitute;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Spatial;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;
using NetTopologySuite.Geometries;

namespace StajProject.Auth.Tests;

/// <summary>
/// Gelişmiş geometry düzenleyicisinin sunucu tarafındaki sözleşmesi.
/// </summary>
/// <remarks>
/// Düzenleyicinin kendisi frontend'dedir; buradaki testler onun ürettiği
/// geometry'nin backend tarafından <b>kabul veya reddedildiğini</b> doğrular.
/// Vurgu geçersiz girdide kaydın <b>hiç değişmemesi</b> üzerindedir: doğrulama
/// tek bir yazma yapılmadan önce biter.
/// </remarks>
public class DrawingGeometryEditTests
{
    private const int OwnerId = 501;

    /* --- Point ---------------------------------------------------------------- */

    [Fact]
    public async Task Point_accepts_a_manual_coordinate_update()
    {
        await using var db = NewDb();
        await SeedUserAsync(db);

        var service = ServiceFor(db);
        var created = await service.CreatePointAsync(Create("POINT (30 40)", "Nokta"), default);

        var updated = await service.UpdateAsync(
            DrawingKind.Point,
            created.Value!.Id,
            new UpdateDrawingRequest { Wkt = "POINT (32.8597 39.9334)" },
            default);

        Assert.True(updated.IsSuccess);
        Assert.Contains("32.8597", updated.Value!.Wkt);
    }

    [Theory]
    // Boylam aralık dışı.
    [InlineData("POINT (181 40)")]
    [InlineData("POINT (-181 40)")]
    // Enlem aralık dışı.
    [InlineData("POINT (30 91)")]
    [InlineData("POINT (30 -91)")]
    public async Task Point_rejects_out_of_range_coordinates(string wkt)
    {
        await using var db = NewDb();
        await SeedUserAsync(db);

        var service = ServiceFor(db);
        var created = await service.CreatePointAsync(Create("POINT (30 40)", "Bozulmayan"), default);

        var update = await service.UpdateAsync(
            DrawingKind.Point,
            created.Value!.Id,
            new UpdateDrawingRequest { Wkt = wkt },
            default);

        Assert.False(update.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, update.ErrorKind);
        Assert.Contains("30 40", (await db.Points.IgnoreQueryFilters().SingleAsync()).Geometry.AsText());
    }

    /* --- Line ----------------------------------------------------------------- */

    [Fact]
    public async Task Line_accepts_vertex_edits_additions_and_removals()
    {
        await using var db = NewDb();
        await SeedUserAsync(db);

        var service = ServiceFor(db);
        var created = await service.CreateLineAsync(
            Create("LINESTRING (29 39, 31 41)", "Çizgi"), default);

        // Köşe ekleme (araya nokta) — düzenleyicideki "Nokta Ekle".
        var added = await service.UpdateAsync(
            DrawingKind.Line,
            created.Value!.Id,
            new UpdateDrawingRequest { Wkt = "LINESTRING (29 39, 30 40, 31 41)" },
            default);
        Assert.True(added.IsSuccess);

        // Köşe düzenleme + silme: yine iki noktaya inmek geçerlidir.
        var removed = await service.UpdateAsync(
            DrawingKind.Line,
            created.Value.Id,
            new UpdateDrawingRequest { Wkt = "LINESTRING (29.5 39.5, 31 41)" },
            default);
        Assert.True(removed.IsSuccess);
        Assert.Contains("29.5", removed.Value!.Wkt);
    }

    [Fact]
    public async Task Line_with_a_single_point_is_rejected()
    {
        await using var db = NewDb();
        await SeedUserAsync(db);

        var service = ServiceFor(db);
        var created = await service.CreateLineAsync(Create("LINESTRING (29 39, 31 41)", "Çizgi"), default);

        /* Minimum köşe kuralı istemcide de var (silme düğmesi kapanır), ama
           sunucu bağımsız olarak reddetmelidir: tek noktalı bir LineString
           geçerli bir geometry değildir ve WKT'si ayrıştırılamaz. */
        var update = await service.UpdateAsync(
            DrawingKind.Line,
            created.Value!.Id,
            new UpdateDrawingRequest { Wkt = "LINESTRING (29 39)" },
            default);

        Assert.False(update.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, update.ErrorKind);
    }

    [Fact]
    public async Task Line_extend_and_shorten_results_are_persisted()
    {
        await using var db = NewDb();
        await SeedUserAsync(db);

        var service = ServiceFor(db);
        var created = await service.CreateLineAsync(Create("LINESTRING (32.8 39.9, 33.0 40.0)", "Çizgi"), default);

        // Uzat/kısalt/hedef-uzunluk istemcide geodesic olarak hesaplanır; sunucuya
        // sonuç geometry olarak gelir ve normal bir güncelleme gibi işlenir.
        var extended = await service.UpdateAsync(
            DrawingKind.Line,
            created.Value!.Id,
            new UpdateDrawingRequest { Wkt = "LINESTRING (32.8 39.9, 33.0117 40.0058)" },
            default);

        Assert.True(extended.IsSuccess);
        var stored = await db.Lines.IgnoreQueryFilters().SingleAsync();
        Assert.Equal(2, stored.Geometry.Coordinates.Length);
        Assert.Contains("33.0117", stored.Geometry.AsText());
    }

    /* --- Polygon -------------------------------------------------------------- */

    [Fact]
    public async Task Polygon_accepts_a_closed_ring_built_from_unique_vertices()
    {
        await using var db = NewDb();
        await SeedUserAsync(db);

        var service = ServiceFor(db);
        var created = await service.CreatePolygonAsync(
            Create("POLYGON ((28 38, 32 38, 32 42, 28 42, 28 38))", "Poligon"), default);

        /* Düzenleyici kullanıcıya A,B,C,D gösterir ve kaydederken halkayı
           A,B,C,D,A olarak kapatır. Sunucuya ulaşan WKT budur. */
        var updated = await service.UpdateAsync(
            DrawingKind.Polygon,
            created.Value!.Id,
            new UpdateDrawingRequest { Wkt = "POLYGON ((20 30, 24 30, 24 34, 20 34, 20 30))" },
            default);

        Assert.True(updated.IsSuccess);
        var stored = await db.Polygons.IgnoreQueryFilters().SingleAsync();
        // Halka kapalıdır: ilk ve son koordinat aynıdır.
        var ring = stored.Geometry.ExteriorRing.Coordinates;
        Assert.Equal(ring[0], ring[^1]);
        Assert.Equal(5, ring.Length);
    }

    [Fact]
    public async Task Self_intersecting_polygon_is_rejected_and_leaves_the_record_untouched()
    {
        await using var db = NewDb();
        await SeedUserAsync(db);

        var service = ServiceFor(db);
        var created = await service.CreatePolygonAsync(
            Create("POLYGON ((28 38, 32 38, 32 42, 28 42, 28 38))", "Bozulmayan"), default);

        // Bowtie: kenarları kendisiyle kesişen halka.
        var update = await service.UpdateAsync(
            DrawingKind.Polygon,
            created.Value!.Id,
            new UpdateDrawingRequest { Name = "Yeni Ad", Wkt = "POLYGON ((0 0, 4 4, 4 0, 0 4, 0 0))" },
            default);

        Assert.False(update.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, update.ErrorKind);

        var stored = await db.Polygons.IgnoreQueryFilters().SingleAsync();
        Assert.Equal("Bozulmayan", stored.Name);
        Assert.Contains("28 38", stored.Geometry.AsText());
    }

    [Fact]
    public async Task Self_intersecting_polygon_cannot_be_created_either()
    {
        await using var db = NewDb();
        await SeedUserAsync(db);

        // Kural tek yerdedir (WktGeometryParser), bu yüzden kayıt yolunda da geçerlidir.
        var created = await ServiceFor(db).CreatePolygonAsync(
            Create("POLYGON ((0 0, 4 4, 4 0, 0 4, 0 0))", "Geçersiz"), default);

        Assert.False(created.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, created.ErrorKind);
        Assert.Empty(await db.Polygons.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public void Valid_polygon_and_self_intersecting_line_pass_the_parser()
    {
        // Geçerli poligon kırılmamalı.
        Assert.True(WktGeometryParser.Parse<Polygon>("POLYGON ((28 38, 32 38, 32 42, 28 42, 28 38))").IsSuccess);

        /* Geçerlilik kontrolü YALNIZCA yüzey geometrilerine uygulanır: kendisiyle
           kesişen bir LineString (kavşaklı güzergâh) tamamen geçerli bir çizimdir
           ve reddedilmemelidir. */
        Assert.True(WktGeometryParser.Parse<LineString>("LINESTRING (0 0, 4 4, 4 0, 0 4)").IsSuccess);
    }

    /* --- Yardımcılar --------------------------------------------------------- */

    private static AppDbContext NewDb()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"geometry-edit-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

        return new AppDbContext(options);
    }

    private static async Task SeedUserAsync(AppDbContext db)
    {
        db.Users.Add(new User { Id = OwnerId, UserName = "owner", EmailConfirmed = true, IsActive = true });
        await db.SaveChangesAsync();
    }

    private static DrawingService ServiceFor(AppDbContext db)
    {
        var currentUser = Substitute.For<ICurrentUserService>();
        currentUser.UserId.Returns(OwnerId);
        currentUser.UserName.Returns("owner");
        currentUser.IsAdmin.Returns(false);

        var authorization = Substitute.For<IDrawingAuthorizationService>();
        authorization.CanManageAsync(Arg.Any<IStyledDrawingFeature>())
            .Returns(call => call.Arg<IStyledDrawingFeature>().CreatedByUserId == OwnerId);
        authorization.CanManageAllAsync(Arg.Any<IEnumerable<IStyledDrawingFeature>>())
            .Returns(call => call.Arg<IEnumerable<IStyledDrawingFeature>>()
                .All(drawing => drawing.CreatedByUserId == OwnerId));

        return new DrawingService(db, currentUser, authorization);
    }

    private static CreateDrawingRequest Create(string wkt, string name) => new()
    {
        Wkt = wkt,
        Name = name,
        Style = new DrawingStyleDto { StrokeColor = "#3366FF" }
    };
}
