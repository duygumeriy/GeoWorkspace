using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.Extensions.DependencyInjection;
using NetTopologySuite.Geometries;
using NSubstitute;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Persistence.Configurations;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Coğrafi yetkilendirmenin çekirdeği: alanın saklanması, kullanıcı için
/// çözülmesi ve çizim geometrilerine uygulanması.
/// </summary>
/// <remarks>
/// <para>
/// <b>Güvenlik sınırı BACKEND'dir.</b> Bu testlerin tamamı servis katmanına
/// doğrudan konuşur — arayüz hiç devrede değildir. Elle hazırlanmış bir WKT ile
/// gelen bir istemci de tam olarak bu yoldan geçer; dolayısıyla burada geçen
/// bir kural, OpenLayers'ı kandırarak aşılamaz.
/// </para>
/// <para>
/// <b>Kapsam ile izin ayrı sınanır.</b> Bir kullanıcının çizim YETKİSİ olması
/// (drawings.point.create) ile o noktaya çizebilmesi farklı sorulardır ve
/// birbirinin yerine geçmez.
/// </para>
/// </remarks>
public class GeographicAuthorizationTests
{
    /* Alanlar bilinçli olarak Türkiye civarındaki gerçekçi koordinatlarla
       kurulur; kural koordinat büyüklüğünden bağımsızdır ama okunurluğu artırır. */

    /// <summary>Batı kutusu (Ankara civarı).</summary>
    private const string West = "POLYGON ((32 39, 33 39, 33 40, 32 40, 32 39))";

    /// <summary>Doğu kutusu (Kayseri civarı) — Batı ile KESİŞMEZ.</summary>
    private const string East = "POLYGON ((35 38, 36 38, 36 39, 35 39, 35 38))";

    /// <summary>Batı'yı tamamen kapsayan geniş alan.</summary>
    private const string Wide = "POLYGON ((30 37, 38 37, 38 42, 30 42, 30 37))";

    /// <summary>
    /// İçbükey ("C" biçimli) alan: iki ucu içeride olan bir çizgi, ortadaki
    /// girintiden geçmek zorunda kalır.
    /// </summary>
    private const string Concave =
        "POLYGON ((0 0, 10 0, 10 10, 8 10, 8 2, 2 2, 2 10, 0 10, 0 0))";

    /* --- Kısıtsızlık (geriye dönük uyumluluk) ------------------------------------ */

    [Fact]
    public async Task A_user_with_no_area_anywhere_is_unrestricted()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "free-drawer");

        var effective = await Geographic(scope).GetEffectiveAuthorizationAsync(user.Id);

        /* Mevcut kurulumlarda tek bir alan bile tanımlı değildir. Kısıtsızlık
           "hiçbir yere çizemez" diye yorumlansaydı, bu faz tüm çizim
           özelliğini sessizce kapatırdı. */
        Assert.False(effective.IsRestricted);
        Assert.Null(effective.AllowedArea);
        Assert.True(effective.Allows(Wkt("POINT (100 80)")));
    }

    [Fact]
    public async Task An_unrestricted_user_may_draw_anywhere()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "unbounded");

        var result = await Drawings(scope, user).CreatePointAsync(Point("POINT (120 45)"), default);

        Assert.True(result.IsSuccess);
    }

    /* --- Doğrudan kullanıcı alanı ------------------------------------------------ */

    [Fact]
    public async Task A_direct_user_area_restricts_that_user()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "scoped");
        await AssignUserAreaAsync(scope, user.Id, West);

        var effective = await Geographic(scope).GetEffectiveAuthorizationAsync(user.Id);

        Assert.True(effective.IsRestricted);
        Assert.NotNull(effective.AllowedArea);
    }

    [Fact]
    public async Task A_direct_user_area_overrides_every_role_area()
    {
        await using var scope = await CreateScopeAsync();
        var role = await CreateRoleAsync(scope, "Geniş Bölge");
        var user = await CreateUserAsync(scope, "narrowed", role);

        await AssignRoleAreaAsync(scope, role.Id, Wide);
        await AssignUserAreaAsync(scope, user.Id, East);

        var drawings = Drawings(scope, user);

        /* Kritik davranış: BİRLEŞİM DEĞİL, DEĞİŞTİRME. Kullanıcı ∪ rol
           olsaydı, yönetici bir kişiyi rolünün altına daraltamazdı — daraltma
           yönetimin temel aracıdır. */
        var insideRoleOnly = await drawings.CreatePointAsync(Point("POINT (31 41)"), default);
        Assert.False(insideRoleOnly.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, insideRoleOnly.ErrorKind);

        var insideUserArea = await drawings.CreatePointAsync(Point("POINT (35.5 38.5)"), default);
        Assert.True(insideUserArea.IsSuccess);
    }

    /* --- Rol alanları ve birleşim ------------------------------------------------- */

    [Fact]
    public async Task A_user_inherits_the_area_of_its_role()
    {
        await using var scope = await CreateScopeAsync();
        var role = await CreateRoleAsync(scope, "Batı Ekibi");
        var user = await CreateUserAsync(scope, "inheritor", role);
        await AssignRoleAreaAsync(scope, role.Id, West);

        var drawings = Drawings(scope, user);

        Assert.True((await drawings.CreatePointAsync(Point("POINT (32.5 39.5)"), default)).IsSuccess);
        Assert.Equal(
            ServiceErrorKind.Forbidden,
            (await drawings.CreatePointAsync(Point("POINT (35.5 38.5)"), default)).ErrorKind);
    }

    [Fact]
    public async Task Areas_of_all_identity_roles_are_unioned()
    {
        await using var scope = await CreateScopeAsync();
        var west = await CreateRoleAsync(scope, "Batı");
        var east = await CreateRoleAsync(scope, "Doğu");
        var user = await CreateUserAsync(scope, "two-regions", west, east);

        await AssignRoleAreaAsync(scope, west.Id, West);
        await AssignRoleAreaAsync(scope, east.Id, East);

        var drawings = Drawings(scope, user);

        // Admin ekranında hangi rolün göründüğü değil, user_roles'daki GERÇEK
        // üyelikler esastır: ikisinin de alanı geçerlidir.
        Assert.True((await drawings.CreatePointAsync(Point("POINT (32.5 39.5)"), default)).IsSuccess);
        Assert.True((await drawings.CreatePointAsync(Point("POINT (35.5 38.5)"), default)).IsSuccess);

        // Aradaki boşluk hiçbir alanın içinde değildir.
        Assert.Equal(
            ServiceErrorKind.Forbidden,
            (await drawings.CreatePointAsync(Point("POINT (34 38.5)"), default)).ErrorKind);
    }

    [Fact]
    public async Task A_line_bridging_two_disconnected_role_areas_is_refused()
    {
        await using var scope = await CreateScopeAsync();
        var west = await CreateRoleAsync(scope, "Batı");
        var east = await CreateRoleAsync(scope, "Doğu");
        var user = await CreateUserAsync(scope, "bridger", west, east);

        await AssignRoleAreaAsync(scope, west.Id, West);
        await AssignRoleAreaAsync(scope, east.Id, East);

        /* Birleşim gerçek bir mekânsal işlemdir. Kapsayan dikdörtgenler
           birleştirilseydi bu çizgi kabul edilirdi — aradaki boşluk izinli
           görünürdü. */
        var result = await Drawings(scope, user).CreateLineAsync(
            Line("LINESTRING (32.5 39.5, 35.5 38.5)"), default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
    }

    /* --- Nokta --------------------------------------------------------------------- */

    [Theory]
    [InlineData("POINT (32.5 39.5)", true)]   // içeride
    [InlineData("POINT (32 39.5)", true)]     // TAM SINIRDA
    [InlineData("POINT (31.9 39.5)", false)]  // dışarıda
    public async Task Point_creation_follows_coverage(string wkt, bool allowed)
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "point-drawer");
        await AssignUserAreaAsync(scope, user.Id, West);

        var result = await Drawings(scope, user).CreatePointAsync(Point(wkt), default);

        Assert.Equal(allowed, result.IsSuccess);

        if (!allowed)
        {
            /* Sınır İZİNLİDİR: predicate Covers'tır, Contains değil. Kullanıcının
               alanının kenarı, alanının dışı değildir. */
            Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
        }
    }

    /* --- Çizgi --------------------------------------------------------------------- */

    [Fact]
    public async Task A_line_fully_inside_is_allowed_and_one_crossing_out_is_not()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "line-drawer");
        await AssignUserAreaAsync(scope, user.Id, West);

        var drawings = Drawings(scope, user);

        Assert.True((await drawings.CreateLineAsync(
            Line("LINESTRING (32.2 39.2, 32.8 39.8)"), default)).IsSuccess);

        Assert.Equal(ServiceErrorKind.Forbidden, (await drawings.CreateLineAsync(
            Line("LINESTRING (32.5 39.5, 34 39.5)"), default)).ErrorKind);
    }

    [Fact]
    public async Task A_line_with_both_endpoints_inside_a_concave_area_can_still_be_refused()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "concave-liner");
        await AssignUserAreaAsync(scope, user.Id, Concave);

        var drawings = Drawings(scope, user);

        /* Uçların ikisi de "C"nin kollarının içindedir, ama aradaki düz hat
           girintiden — alanın DIŞINDAN — geçer.

           Bu test uç-nokta kestirmesini tek başına yakalar: yalnızca uçlara
           bakan bir uygulama burada izin verirdi. Aynı şey merkez noktası ve
           kapsayan dikdörtgen için de geçerlidir. */
        var crossing = await drawings.CreateLineAsync(Line("LINESTRING (1 5, 9 5)"), default);

        Assert.False(crossing.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, crossing.ErrorKind);

        // Aynı alanda, girintiye girmeyen bir çizgi kabul edilir.
        Assert.True((await drawings.CreateLineAsync(Line("LINESTRING (0.5 1, 9.5 1)"), default)).IsSuccess);
    }

    /* --- Poligon ------------------------------------------------------------------- */

    [Fact]
    public async Task Polygon_creation_requires_full_coverage()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "polygon-drawer");
        await AssignUserAreaAsync(scope, user.Id, West);

        var drawings = Drawings(scope, user);

        Assert.True((await drawings.CreatePolygonAsync(
            Polygon("POLYGON ((32.2 39.2, 32.8 39.2, 32.8 39.8, 32.2 39.8, 32.2 39.2))"), default)).IsSuccess);

        // Büyük kısmı içeride ama bir köşesi dışarıda: "çoğunlukla içeride"
        // yeterli DEĞİLDİR.
        Assert.Equal(ServiceErrorKind.Forbidden, (await drawings.CreatePolygonAsync(
            Polygon("POLYGON ((32.2 39.2, 33.5 39.2, 33.5 39.8, 32.2 39.8, 32.2 39.2))"), default)).ErrorKind);
    }

    [Fact]
    public async Task A_polygon_that_exactly_matches_the_allowed_area_is_allowed()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "edge-matcher");
        await AssignUserAreaAsync(scope, user.Id, West);

        // Kenarları izin verilen alanın kenarlarıyla ÇAKIŞIR. Contains kullanılsaydı
        // bu reddedilirdi; kullanıcı kendi alanının tamamını çizemezdi.
        var result = await Drawings(scope, user).CreatePolygonAsync(Polygon(West), default);

        Assert.True(result.IsSuccess);
    }

    /* --- Toplu oluşturma ----------------------------------------------------------- */

    [Fact]
    public async Task Bulk_create_is_refused_entirely_when_one_item_falls_outside()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "bulk-drawer");
        await AssignUserAreaAsync(scope, user.Id, West);

        var result = await Drawings(scope, user).BulkCreateAsync(new BulkCreateRequest
        {
            Items =
            [
                new BulkCreateItem { Type = "point", Wkt = "POINT (32.5 39.5)", Name = "İçeride", Style = Style() },
                new BulkCreateItem { Type = "point", Wkt = "POINT (34 39.5)", Name = "Dışarıda", Style = Style() }
            ]
        }, default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);

        // Kısmi başarı yok: içerideki öğe de yazılmadı.
        Assert.Equal(0, await Db(scope).Points.CountAsync());
    }

    /* --- Geometri güncelleme ------------------------------------------------------- */

    [Fact]
    public async Task Moving_a_drawing_outside_the_area_is_refused()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "mover");
        await AssignUserAreaAsync(scope, user.Id, West);

        var drawings = Drawings(scope, user);
        var created = await drawings.CreatePointAsync(Point("POINT (32.5 39.5)"), default);
        Assert.True(created.IsSuccess);

        // Bir kaydı alanın dışına sürüklemek, oraya yeni çizmekle aynı şeydir.
        var moved = await drawings.UpdateAsync(
            DrawingKind.Point, created.Value!.Id, new UpdateDrawingRequest { Wkt = "POINT (34 39.5)" }, default);

        Assert.False(moved.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, moved.ErrorKind);

        var stored = await Db(scope).Points.SingleAsync();
        Assert.Equal(32.5, stored.Geometry.X, 6);
    }

    [Fact]
    public async Task Moving_a_drawing_within_the_area_still_works()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "inner-mover");
        await AssignUserAreaAsync(scope, user.Id, West);

        var drawings = Drawings(scope, user);
        var created = await drawings.CreatePointAsync(Point("POINT (32.2 39.2)"), default);

        var moved = await drawings.UpdateAsync(
            DrawingKind.Point, created.Value!.Id, new UpdateDrawingRequest { Wkt = "POINT (32.8 39.8)" }, default);

        Assert.True(moved.IsSuccess);
    }

    /* --- Coğrafi olarak kapsanmayan işlemler --------------------------------------- */

    [Fact]
    public async Task Metadata_and_style_edits_survive_an_area_that_no_longer_covers_the_drawing()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "recolorer");

        // Önce kısıtsızken çizilir.
        var drawings = Drawings(scope, user);
        var created = await drawings.CreatePointAsync(Point("POINT (34 39.5)"), default);
        Assert.True(created.IsSuccess);

        // Sonra kaydı KAPSAMAYAN bir alan atanır.
        await AssignUserAreaAsync(scope, user.Id, West);

        /* Coğrafi yetkinin cevapladığı soru "geometri NEREYE konabilir"dir,
           "bu kayda dokunulabilir mi" değil. Rengini değiştirmek yeni bir yere
           çizmek değildir; engellenirse eski kayıtlar düzenlenemez hâle gelirdi. */
        var restyled = await drawings.UpdateStyleAsync(
            DrawingKind.Point, created.Value!.Id, new DrawingStyleDto { StrokeColor = "#FF0000" }, default);
        Assert.True(restyled.IsSuccess);

        var renamed = await drawings.UpdateAsync(
            DrawingKind.Point, created.Value!.Id, new UpdateDrawingRequest { Name = "Yeni Ad" }, default);
        Assert.True(renamed.IsSuccess);
    }

    [Fact]
    public async Task Deleting_and_restoring_a_drawing_outside_the_area_still_works()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "trasher");

        var drawings = Drawings(scope, user);
        var created = await drawings.CreatePointAsync(Point("POINT (34 39.5)"), default);

        await AssignUserAreaAsync(scope, user.Id, West);

        /* Silme yeni geometri üretmez; alanın dışında kalan bir kaydı
           silememek, kullanıcıyı temizleyemediği veriyle baş başa bırakırdı. */
        var deleted = await drawings.DeleteAsync(DrawingKind.Point, created.Value!.Id, default);
        Assert.True(deleted.IsSuccess);

        /* Geri yükleme de create DEĞİLDİR: kayıt zaten sunucudadır, geometrisi
           korunur ve istemci onu belirleyemez. Aynı geometriyi geri açmak,
           yeni bir yere çizmek sayılmaz. */
        var restored = await drawings.RestoreAsync(new BulkRestoreRequest
        {
            Items = [new BulkDrawingItem { Type = "point", Id = created.Value!.Id }]
        }, default);

        Assert.True(restored.IsSuccess);
    }

    /* --- Canlılık ------------------------------------------------------------------- */

    [Fact]
    public async Task An_area_change_applies_immediately_without_a_new_token()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "live-scoped");
        await AssignUserAreaAsync(scope, user.Id, West);

        var drawings = Drawings(scope, user);

        Assert.True((await drawings.CreatePointAsync(Point("POINT (32.5 39.5)"), default)).IsSuccess);

        // Alan değişir; yeniden giriş YOK, yeni token YOK.
        await Geographic(scope).UpsertUserAuthorizationAsync(user.Id, new UpdateGeographicAuthorizationRequest { Wkt = East });

        /* Coğrafi yetki JWT'ye yazılsaydı, daraltma eski token'ın ömrü boyunca
           uygulanmaz ve kullanıcı saatlerce eski alanında çizmeye devam ederdi. */
        Assert.Equal(
            ServiceErrorKind.Forbidden,
            (await drawings.CreatePointAsync(Point("POINT (32.6 39.6)"), default)).ErrorKind);

        Assert.True((await drawings.CreatePointAsync(Point("POINT (35.5 38.5)"), default)).IsSuccess);
    }

    /* --- Rol adı bypass'ı yok ------------------------------------------------------- */

    [Theory]
    [InlineData(GisRoles.Administrator)]
    [InlineData(ApplicationRoles.Admin)]
    public async Task A_privileged_role_name_grants_no_geographic_bypass(string roleName)
    {
        await using var scope = await CreateScopeAsync();
        var role = await CreateRoleAsync(scope, roleName);
        var admin = await CreateUserAsync(scope, "geo-bounded-admin", role);
        await AssignUserAreaAsync(scope, admin.Id, West);

        /* Coğrafi kısıt VERİDEN gelir ve rol adına bakmaz. "Admin her yere
           çizebilir" gibi bir kestirme, kısıtı yönetici hesapları için sessizce
           anlamsız kılardı. */
        var outside = await Drawings(scope, admin).CreatePointAsync(Point("POINT (34 39.5)"), default);

        Assert.False(outside.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, outside.ErrorKind);
    }

    /* --- Sıra: geçersiz geometri yetki hatası DEĞİLDİR ------------------------------ */

    [Theory]
    [InlineData("not a wkt at all")]
    [InlineData("POLYGON ((32 39, 33 40, 33 39, 32 40, 32 39))")]  // kendisiyle kesişen
    [InlineData("SRID=3857;POINT (3500000 4800000)")]
    public async Task Malformed_geometry_stays_a_validation_error_even_when_restricted(string wkt)
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "malformer");
        await AssignUserAreaAsync(scope, user.Id, West);

        var result = await Drawings(scope, user).CreatePolygonAsync(Polygon(wkt), default);

        /* Doğrulama coğrafi kontrolden ÖNCE çalışır: bozuk bir WKT "yanlış
           yerdesin" diye raporlanmamalıdır. Aksi hâlde istemci hatayı düzeltmek
           yerine alanını sorgulardı. */
        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
    }

    /* --- Şema kısıtları -------------------------------------------------------------- */

    [Fact]
    public void The_model_stores_the_area_as_a_postgis_polygon_with_srid_4326()
    {
        using var scope = CreateModelScope();

        var property = DesignModel(scope)
            .FindEntityType(typeof(GeographicAuthorization))!
            .FindProperty(nameof(GeographicAuthorization.Area))!;

        Assert.Equal("geometry(Polygon,4326)", property.GetColumnType());
        Assert.False(property.IsNullable);
    }

    /// <summary>
    /// Hedef başına ÇOK alan (Phase 9): hedef kolonlarındaki indeksler
    /// benzersiz OLMAMALIDIR.
    /// </summary>
    /// <remarks>
    /// Bu test, kaldırılan bir kuralın geri gelmesini engeller. Eski kısmi
    /// UNIQUE indeksler yerinde bırakılsaydı, servis ikinci alanı eklemeye
    /// çalıştığında veritabanı reddederdi ve hata yalnızca çalışma zamanında,
    /// yöneticinin ekranında görünürdü. İndekslerin kendileri KORUNUR: çizim
    /// yolu her istekte "bu hedefin alanları" sorgusunu çalıştırır.
    /// </remarks>
    [Fact]
    public void The_model_allows_many_areas_per_user_and_per_role()
    {
        using var scope = CreateModelScope();

        var entity = DesignModel(scope).FindEntityType(typeof(GeographicAuthorization))!;

        foreach (var column in new[] { "user_id", "role_id" })
        {
            var index = entity.GetIndexes().Single(i =>
                i.Properties.Count == 1 && i.Properties[0].GetColumnName() == column);

            Assert.False(index.IsUnique);
            // Kısmi filtre korunur: kolonlardan biri her satırda NULL'dur ve
            // filtresiz bir indeks o yarıyı boşuna taşırdı.
            Assert.Equal($"{column} IS NOT NULL", index.GetFilter());
        }
    }

    [Fact]
    public void The_model_declares_the_single_target_check_constraint_and_a_gist_index()
    {
        using var scope = CreateModelScope();

        var entity = DesignModel(scope).FindEntityType(typeof(GeographicAuthorization))!;

        var check = entity.GetCheckConstraints()
            .Single(c => c.Name == GeographicAuthorizationConfiguration.SingleTargetConstraint);

        Assert.Contains("user_id IS NOT NULL AND role_id IS NULL", check.Sql);
        Assert.Contains("user_id IS NULL AND role_id IS NOT NULL", check.Sql);

        var spatial = entity.GetIndexes().Single(i =>
            i.Properties.Count == 1 && i.Properties[0].Name == nameof(GeographicAuthorization.Area));

        Assert.Equal("gist", spatial.GetMethod());
    }

    /* --- Yardımcılar ----------------------------------------------------------------- */

    private static AppDbContext Db(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<AppDbContext>();

    /// <summary>
    /// CHECK kısıtları ve kolon tipleri yalnızca design-time modelde durur;
    /// çalışma zamanı modeli okuma için sadeleştirilmiştir.
    /// </summary>
    private static IModel DesignModel(IServiceScope scope) =>
        scope.ServiceProvider
            .GetRequiredService<AppDbContext>()
            .GetService<IDesignTimeModel>()
            .Model;

    private static IGeographicAuthorizationService Geographic(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<IGeographicAuthorizationService>();

    private static Geometry Wkt(string wkt) =>
        StajProject.Application.Spatial.WktGeometryParser.Parse<Geometry>(wkt).Value!;

    private static DrawingStyleDto Style() => new() { StrokeColor = "#3366FF" };

    private static CreateDrawingRequest Point(string wkt) => new() { Wkt = wkt, Name = "Nokta", Style = Style() };

    private static CreateDrawingRequest Line(string wkt) => new() { Wkt = wkt, Name = "Çizgi", Style = Style() };

    private static CreateDrawingRequest Polygon(string wkt) => new() { Wkt = wkt, Name = "Alan", Style = Style() };

    /// <summary>Çağıranı verilen kullanıcı olan bir çizim servisi.</summary>
    private static DrawingService Drawings(AsyncServiceScope scope, User user)
    {
        var currentUser = Substitute.For<ICurrentUserService>();
        currentUser.UserId.Returns(user.Id);
        currentUser.UserName.Returns(user.UserName);

        // Sahiplik kuralı bu testlerin konusu değildir; kendi kaydına daima yetkili.
        var authorization = Substitute.For<IDrawingAuthorizationService>();
        authorization.CanManageAsync(Arg.Any<IStyledDrawingFeature>())
            .Returns(call => call.Arg<IStyledDrawingFeature>().CreatedByUserId == user.Id);
        authorization.CanManageAllAsync(Arg.Any<IEnumerable<IStyledDrawingFeature>>())
            .Returns(call => call.Arg<IEnumerable<IStyledDrawingFeature>>()
                .All(d => d.CreatedByUserId == user.Id));

        return new DrawingService(
            Db(scope),
            currentUser,
            authorization,
            Geographic(scope),
            new DatabaseDrawingReadService(Db(scope)));
    }

    private static async Task AssignUserAreaAsync(AsyncServiceScope scope, int userId, string wkt)
    {
        var result = await Geographic(scope).UpsertUserAuthorizationAsync(
            userId, new UpdateGeographicAuthorizationRequest { Wkt = wkt });

        Assert.True(result.IsSuccess, result.Error);
    }

    private static async Task AssignRoleAreaAsync(AsyncServiceScope scope, int roleId, string wkt)
    {
        var result = await Geographic(scope).UpsertRoleAuthorizationAsync(
            roleId, new UpdateGeographicAuthorizationRequest { Wkt = wkt });

        Assert.True(result.IsSuccess, result.Error);
    }

    private static async Task<IdentityRole<int>> CreateRoleAsync(AsyncServiceScope scope, string name)
    {
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();
        var role = new IdentityRole<int>(name);
        Assert.True((await roles.CreateAsync(role)).Succeeded);
        return role;
    }

    private static async Task<User> CreateUserAsync(
        AsyncServiceScope scope,
        string userName,
        params IdentityRole<int>[] roles)
    {
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();

        var user = new User
        {
            UserName = userName,
            Email = $"{userName}@example.invalid",
            EmailConfirmed = true,
            AccountStatus = AccountStatus.Active,
            IsActive = true
        };

        Assert.True((await users.CreateAsync(user, "Str0ng!Password")).Succeeded);

        foreach (var role in roles)
        {
            Assert.True((await users.AddToRoleAsync(user, role.Name!)).Succeeded);
        }

        return user;
    }

    private static ServiceCollection BaseServices(string databaseName)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
        services.AddDbContext<AppDbContext>(o => o
            .UseInMemoryDatabase(databaseName)
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)));

        services.AddIdentityCore<User>(o => o.Password.RequiredLength = 8)
            .AddRoles<IdentityRole<int>>()
            .AddEntityFrameworkStores<AppDbContext>()
            .AddDefaultTokenProviders();

        services.AddScoped<IGeographicAuthorizationService, GeographicAuthorizationService>();
        return services;
    }

    private static Task<AsyncServiceScope> CreateScopeAsync() =>
        Task.FromResult(BaseServices($"geographic-authz-{Guid.NewGuid():N}")
            .BuildServiceProvider()
            .CreateAsyncScope());

    /// <summary>
    /// Şema iddiaları için GERÇEK relational model.
    /// </summary>
    /// <remarks>
    /// In-memory sağlayıcı relational değildir: kolon tipi, CHECK kısıtı ve
    /// index metodu gibi bilgileri hiç taşımaz, dolayısıyla bu iddiaları onun
    /// üzerinde kurmak "test geçti ama hiçbir şey doğrulanmadı" demek olurdu.
    /// Npgsql sağlayıcısı model kurarken veritabanına BAĞLANMAZ; bağlantı
    /// metni yalnızca sağlayıcıyı seçmek için vardır ve hiçbir sorgu
    /// çalıştırılmaz.
    /// </remarks>
    private static IServiceScope CreateModelScope()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDbContext<AppDbContext>(o => o.UseNpgsql(
            "Host=localhost;Database=schema-only;Username=none",
            npgsql => npgsql.UseNetTopologySuite()));

        return services.BuildServiceProvider().CreateScope();
    }
}
