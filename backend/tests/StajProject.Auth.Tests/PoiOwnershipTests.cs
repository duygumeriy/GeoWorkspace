using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using StajProject.Application.DTOs;
using StajProject.Application.Common;
using StajProject.Application.Interfaces;

namespace StajProject.Auth.Tests;

/// <summary>
/// POI mutasyonlarının SAHİPLİK sözleşmesi: kim hangi kaydı düzenleyebilir,
/// silebilir ve geri yükleyebilir.
/// </summary>
/// <remarks>
/// <para>
/// Ölçülen kural tek bir cümledir ve her testte aynıdır:
/// <c>poi.manage</c> VEYA (kaydın sahibi VE ilgili kod). İki eksenden birinin
/// tek başına yetmediği, her iki yönde de sınanır — yetkisi olup sahibi
/// olmayan da, sahibi olup yetkisi olmayan da reddedilir.
/// </para>
/// <para>
/// <b>Rol adı hiçbir testte geçmez.</b> "Operatör" ya da "Administrator" bu
/// dosyanın bilmediği kavramlardır; ayrıcalıklı davranışın tek sebebi
/// <c>poi.manage</c> grant'ıdır.
/// </para>
/// <para>
/// <b>Görünürlük sahiplikten AYRIDIR</b> ve burada da ayrı ölçülür: mutasyon
/// kısıtlanırken okuma kısıtlanmamalıdır.
/// </para>
/// </remarks>
public class PoiOwnershipTests
{
    /* --- Görünürlük ---------------------------------------------------------------- */

    [Fact]
    public async Task Map_list_shows_pois_from_every_creator()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var operatorA = await fixture.AddUserAsync("operator-a");
        var operatorB = await fixture.AddUserAsync("operator-b");

        await fixture.AddPoiAsync("A'nın noktası", category.Id, operatorA.Id);
        await fixture.AddPoiAsync("B'nin noktası", category.Id, operatorB.Id);

        fixture.ActAs(operatorA);
        var pois = await fixture.Service.GetMapPoisAsync();

        // Ortak envanter: sahiplik listeyi DARALTMAZ.
        Assert.Equal(2, pois.Count);
    }

    [Fact]
    public async Task Map_list_reports_capabilities_per_record_without_naming_the_creator()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var other = await fixture.AddUserAsync("other");

        var own = await fixture.AddPoiAsync("Kendi", category.Id, owner.Id);
        var foreign = await fixture.AddPoiAsync("Yabancı", category.Id, other.Id);

        fixture.ActAs(owner);
        fixture.Grant(update: true, delete: true);

        var pois = await fixture.Service.GetMapPoisAsync();

        var ownResponse = pois.Single(p => p.Id == own.Id);
        var foreignResponse = pois.Single(p => p.Id == foreign.Id);

        Assert.True(ownResponse.CanUpdate);
        Assert.True(ownResponse.CanDelete);
        // Yabancı kayıt GÖRÜNÜR ama düzenlenemez.
        Assert.False(foreignResponse.CanUpdate);
        Assert.False(foreignResponse.CanDelete);
    }

    /* --- "POI'lerim" ---------------------------------------------------------------- */

    [Fact]
    public async Task My_pois_returns_only_the_callers_own_active_records()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var other = await fixture.AddUserAsync("other");

        var own = await fixture.AddPoiAsync("Kendi", category.Id, owner.Id);
        await fixture.AddPoiAsync("Yabancı", category.Id, other.Id);
        await fixture.AddPoiAsync("Kendi pasif", category.Id, owner.Id, isActive: false);
        await fixture.AddPoiAsync("Kendi silinmiş", category.Id, owner.Id, isActive: false, isDeleted: true);

        fixture.ActAs(owner);

        var mine = await fixture.Service.GetOwnPoisAsync();

        /* Kapsam SUNUCUDA daraltılır: yabancı kayıt, kendi pasif kaydı ve
           kendi silinmiş kaydı listeye girmez — sonuncusu Çöp Kutusu'nun
           konusudur, bu listenin değil. */
        Assert.Equal(own.Id, Assert.Single(mine).Id);
    }

    [Fact]
    public async Task My_pois_never_exposes_creator_identity()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        await fixture.AddPoiAsync("Kendi", category.Id, owner.Id);

        fixture.ActAs(owner);

        /* Gövde harita sözleşmesinin AYNISIDIR: sahiplik zaten sorgunun
           kendisindedir ve ayrıca alan olarak taşınmaz. Tip düzeyindeki
           kanıt PoiServiceTests'tedir; burada sözleşmenin o tip olduğu
           sabitlenir. */
        Assert.IsType<PoiResponse>(Assert.Single(await fixture.Service.GetOwnPoisAsync()));
    }

    [Fact]
    public async Task My_pois_reports_capabilities_from_permissions_not_from_ownership_alone()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        await fixture.AddPoiAsync("Kendi", category.Id, owner.Id);

        fixture.ActAs(owner);

        // Yalnızca poi.view: kendi kaydıdır ama düzenleme/silme yetkisi yoktur.
        fixture.Grant();
        var readOnly = Assert.Single(await fixture.Service.GetOwnPoisAsync());
        Assert.False(readOnly.CanUpdate);
        Assert.False(readOnly.CanDelete);

        // Operatör profili: kendi kaydında iki yetenek de açılır.
        fixture.Grant(update: true, delete: true);
        var editable = Assert.Single(await fixture.Service.GetOwnPoisAsync());
        Assert.True(editable.CanUpdate);
        Assert.True(editable.CanDelete);
    }

    [Fact]
    public async Task My_pois_is_empty_for_an_unauthenticated_caller()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        await fixture.AddPoiAsync("Kendi", category.Id, owner.Id);

        fixture.ActAsAnonymous();

        // Kimliksiz çağıranın "kendi" kaydı yoktur; başkasınınkiler sızmaz.
        Assert.Empty(await fixture.Service.GetOwnPoisAsync());
    }

    [Fact]
    public async Task The_map_list_stays_shared_while_my_pois_is_scoped()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var other = await fixture.AddUserAsync("other");

        await fixture.AddPoiAsync("Kendi", category.Id, owner.Id);
        await fixture.AddPoiAsync("Yabancı", category.Id, other.Id);

        fixture.ActAs(owner);

        /* İki uç AYRI sorulardır ve biri diğerini daraltmaz: harita ortak
           envanterdir, "POI'lerim" kendi alt kümesidir. */
        Assert.Equal(2, (await fixture.Service.GetMapPoisAsync()).Count);
        Assert.Single(await fixture.Service.GetOwnPoisAsync());
    }

    /* --- Güncelleme ---------------------------------------------------------------- */

    [Fact]
    public async Task Owner_with_update_permission_updates_own_poi()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var target = await fixture.AddCategoryAsync("Kafe", category.Id);
        var owner = await fixture.AddUserAsync("owner");
        var poi = await fixture.AddPoiAsync("Eski ad", category.Id, owner.Id);

        fixture.ActAs(owner);
        fixture.Grant(update: true);

        var result = await fixture.Service.UpdatePoiAsync(poi.Id, Update("Yeni ad", target.Id));

        Assert.True(result.IsSuccess);
        Assert.Equal("Yeni ad", result.Value!.Name);
        Assert.Equal(target.Id, result.Value.CategoryId);
    }

    [Fact]
    public async Task Owner_without_update_permission_cannot_update_own_poi()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var poi = await fixture.AddPoiAsync("Eski ad", category.Id, owner.Id);

        fixture.ActAs(owner);
        // Sahiplik TEK BAŞINA yetmez.
        fixture.Grant(delete: true);

        var result = await fixture.Service.UpdatePoiAsync(poi.Id, Update("Yeni ad", category.Id));

        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
    }

    [Fact]
    public async Task Update_permission_does_not_reach_a_foreign_poi()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var intruder = await fixture.AddUserAsync("intruder");
        var poi = await fixture.AddPoiAsync("Sahibinin kaydı", category.Id, owner.Id);

        fixture.ActAs(intruder);
        // Yetki TEK BAŞINA da yetmez.
        fixture.Grant(update: true, delete: true);

        var result = await fixture.Service.UpdatePoiAsync(poi.Id, Update("Ele geçirildi", category.Id));

        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
        Assert.Equal("Sahibinin kaydı", (await fixture.Db.Pois.AsNoTracking().SingleAsync()).Name);
    }

    [Fact]
    public async Task Manage_permission_updates_a_foreign_poi()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var manager = await fixture.AddUserAsync("manager");
        var poi = await fixture.AddPoiAsync("Eski ad", category.Id, owner.Id);

        fixture.ActAs(manager);
        fixture.Grant(manage: true);

        var result = await fixture.Service.UpdatePoiAsync(poi.Id, Update("Düzeltildi", category.Id));

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public async Task Update_preserves_creator_and_creation_date()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var manager = await fixture.AddUserAsync("manager");
        var poi = await fixture.AddPoiAsync("Eski ad", category.Id, owner.Id);
        var createdDate = poi.CreatedDate;

        fixture.ActAs(manager);
        fixture.Grant(manage: true);

        Assert.True((await fixture.Service.UpdatePoiAsync(poi.Id, Update("Yeni ad", category.Id))).IsSuccess);

        var stored = await fixture.Db.Pois.AsNoTracking().SingleAsync();
        // Düzenleyen kişi sahibi OLMAZ; kayıt el değiştirmez.
        Assert.Equal(owner.Id, stored.UserId);
        Assert.Equal(createdDate, stored.CreatedDate);
    }

    [Fact]
    public async Task Update_rejects_an_unusable_category()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var retired = await fixture.AddCategoryAsync("Kaldırılmış", isActive: false);
        var owner = await fixture.AddUserAsync("owner");
        var poi = await fixture.AddPoiAsync("Kayıt", category.Id, owner.Id);

        fixture.ActAs(owner);
        fixture.Grant(update: true);

        var result = await fixture.Service.UpdatePoiAsync(poi.Id, Update("Kayıt", retired.Id));

        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
    }

    /* --- Soft delete --------------------------------------------------------------- */

    [Fact]
    public async Task Owner_with_delete_permission_soft_deletes_own_poi()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var poi = await fixture.AddPoiAsync("Kayıt", category.Id, owner.Id);

        fixture.ActAs(owner);
        fixture.Grant(delete: true);

        Assert.True((await fixture.Service.DeletePoiAsync(poi.Id)).IsSuccess);

        // Satır DURUR; yalnızca işaretlenir.
        var stored = await fixture.Db.Pois.IgnoreQueryFilters().AsNoTracking().SingleAsync();
        Assert.True(stored.IsDeleted);
        Assert.False(stored.IsActive);
        Assert.Equal(owner.Id, stored.UserId);
    }

    [Fact]
    public async Task Delete_permission_does_not_reach_a_foreign_poi()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var intruder = await fixture.AddUserAsync("intruder");
        var poi = await fixture.AddPoiAsync("Kayıt", category.Id, owner.Id);

        fixture.ActAs(intruder);
        fixture.Grant(update: true, delete: true);

        var result = await fixture.Service.DeletePoiAsync(poi.Id);

        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
        Assert.False((await fixture.Db.Pois.AsNoTracking().SingleAsync()).IsDeleted);
    }

    [Fact]
    public async Task Manage_permission_deletes_a_foreign_poi()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var manager = await fixture.AddUserAsync("manager");
        var poi = await fixture.AddPoiAsync("Kayıt", category.Id, owner.Id);

        fixture.ActAs(manager);
        fixture.Grant(manage: true);

        Assert.True((await fixture.Service.DeletePoiAsync(poi.Id)).IsSuccess);
    }

    [Fact]
    public async Task Deleted_poi_leaves_the_map_list()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var poi = await fixture.AddPoiAsync("Kayıt", category.Id, owner.Id);

        fixture.ActAs(owner);
        fixture.Grant(delete: true);
        await fixture.Service.DeletePoiAsync(poi.Id);

        Assert.Empty(await fixture.Service.GetMapPoisAsync());
    }

    /* --- Çöp kutusu ve geri yükleme ------------------------------------------------ */

    [Fact]
    public async Task Trash_lists_only_what_the_caller_may_restore()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var other = await fixture.AddUserAsync("other");

        var own = await fixture.AddPoiAsync("Kendi", category.Id, owner.Id, isActive: false, isDeleted: true);
        await fixture.AddPoiAsync("Yabancı", category.Id, other.Id, isActive: false, isDeleted: true);

        fixture.ActAs(owner);
        fixture.Grant(delete: true);

        var trash = await fixture.Service.GetDeletedPoisAsync();

        Assert.Equal(own.Id, Assert.Single(trash).Poi.Id);
        // Sahibinin adı sıradan çağırana AÇILMAZ.
        Assert.Equal(string.Empty, trash[0].CreatorUsername);
        Assert.Equal("poi", trash[0].Type);
    }

    [Fact]
    public async Task Trash_shows_every_deleted_poi_to_a_manager()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var manager = await fixture.AddUserAsync("manager");

        await fixture.AddPoiAsync("Kayıt", category.Id, owner.Id, isActive: false, isDeleted: true);

        fixture.ActAs(manager);
        fixture.Grant(manage: true);

        var trash = await fixture.Service.GetDeletedPoisAsync();

        // Yönetim yetkisi kimin sildiğini de görür: geri yükleme kararı bunu ister.
        Assert.Equal("owner", Assert.Single(trash).CreatorUsername);
    }

    [Fact]
    public async Task Trash_is_empty_without_any_restore_capability()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var viewer = await fixture.AddUserAsync("viewer");
        await fixture.AddPoiAsync("Kayıt", category.Id, viewer.Id, isActive: false, isDeleted: true);

        fixture.ActAs(viewer);
        // Yalnızca poi.view: silinmiş kayıtlar hiç listelenmez.
        fixture.Grant();

        Assert.Empty(await fixture.Service.GetDeletedPoisAsync());
    }

    [Fact]
    public async Task Owner_restores_own_poi_and_it_returns_to_the_map()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var poi = await fixture.AddPoiAsync("Kayıt", category.Id, owner.Id, isActive: false, isDeleted: true);

        fixture.ActAs(owner);
        fixture.Grant(delete: true);

        Assert.True((await fixture.Service.RestorePoiAsync(poi.Id)).IsSuccess);

        var restored = Assert.Single(await fixture.Service.GetMapPoisAsync());
        Assert.Equal(poi.Id, restored.Id);
        // Sahiplik geri yüklemede de değişmez.
        Assert.Equal(owner.Id, (await fixture.Db.Pois.AsNoTracking().SingleAsync()).UserId);
    }

    [Fact]
    public async Task Manager_restores_a_foreign_poi()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var manager = await fixture.AddUserAsync("manager");
        var poi = await fixture.AddPoiAsync("Kayıt", category.Id, owner.Id, isActive: false, isDeleted: true);

        fixture.ActAs(manager);
        fixture.Grant(manage: true);

        Assert.True((await fixture.Service.RestorePoiAsync(poi.Id)).IsSuccess);
    }

    [Fact]
    public async Task Restore_of_a_foreign_poi_is_forbidden()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var intruder = await fixture.AddUserAsync("intruder");
        var poi = await fixture.AddPoiAsync("Kayıt", category.Id, owner.Id, isActive: false, isDeleted: true);

        fixture.ActAs(intruder);
        fixture.Grant(delete: true);

        var result = await fixture.Service.RestorePoiAsync(poi.Id);

        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
        Assert.True((await fixture.Db.Pois.IgnoreQueryFilters().AsNoTracking().SingleAsync()).IsDeleted);
    }

    [Fact]
    public async Task Restore_fails_safely_when_the_category_is_no_longer_usable()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var retired = await fixture.AddCategoryAsync("Kaldırılmış", isActive: false);
        var owner = await fixture.AddUserAsync("owner");
        var poi = await fixture.AddPoiAsync("Kayıt", retired.Id, owner.Id, isActive: false, isDeleted: true);

        fixture.ActAs(owner);
        fixture.Grant(delete: true);

        var result = await fixture.Service.RestorePoiAsync(poi.Id);

        Assert.False(result.IsSuccess);
        var stored = await fixture.Db.Pois.IgnoreQueryFilters().AsNoTracking().SingleAsync();
        // Kayıt silinmiş KALIR ve kategorisi sessizce değiştirilmez.
        Assert.True(stored.IsDeleted);
        Assert.Equal(retired.Id, stored.CategoryId);
    }

    /* --- Konum güncellemesi ---------------------------------------------------------
       POI artık TAŞINABİLİR bir kayıttır. Taşımak da yazmaktır, dolayısıyla iki
       sınırdan birden geçer: kaydın SAHİPLİĞİ (bu dosyanın konusu olan kural)
       ve YENİ KONUMUN coğrafi yetkisi. İkisi birbirinin yerine geçmez. */

    [Fact]
    public async Task Owner_with_update_permission_can_move_their_own_poi()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var poi = await fixture.AddPoiAsync("Kendi", category.Id, owner.Id, longitude: 32.85, latitude: 39.93);

        fixture.ActAs(owner);
        fixture.Grant(update: true);

        var result = await fixture.Service.UpdatePoiAsync(poi.Id, Move("Kendi", category.Id, 30.5, 38.2));

        Assert.True(result.IsSuccess);
        // Yanıt kaydın kanonik hâlidir: yeni konumu TAŞIR.
        Assert.Equal(30.5, result.Value!.Longitude);
        Assert.Equal(38.2, result.Value.Latitude);

        var stored = await fixture.Db.Pois.AsNoTracking().SingleAsync(p => p.Id == poi.Id);
        Assert.Equal(30.5, stored.Coordinate.X);
        Assert.Equal(38.2, stored.Coordinate.Y);
        // Geometri EPSG:4326 KALIR; harita projeksiyonu hiçbir yoldan sızmaz.
        Assert.Equal(4326, stored.Coordinate.SRID);
    }

    [Fact]
    public async Task Update_permission_does_not_reach_a_foreign_pois_location()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var intruder = await fixture.AddUserAsync("intruder");
        var poi = await fixture.AddPoiAsync("Yabancı", category.Id, owner.Id, longitude: 32.85, latitude: 39.93);

        fixture.ActAs(intruder);
        fixture.Grant(update: true);

        var result = await fixture.Service.UpdatePoiAsync(poi.Id, Move("Ele geçirildi", category.Id, 30.5, 38.2));

        // Koordinat düzenlemesi sahiplik denetimini ATLAMAZ: aynı kapıdan geçer.
        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);

        var stored = await fixture.Db.Pois.AsNoTracking().SingleAsync(p => p.Id == poi.Id);
        Assert.Equal(32.85, stored.Coordinate.X);
        Assert.Equal(39.93, stored.Coordinate.Y);
    }

    [Fact]
    public async Task Manage_permission_can_move_a_foreign_poi()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var manager = await fixture.AddUserAsync("manager");
        var poi = await fixture.AddPoiAsync("Yabancı", category.Id, owner.Id);

        fixture.ActAs(manager);
        fixture.Grant(manage: true);

        var result = await fixture.Service.UpdatePoiAsync(poi.Id, Move("Düzeltildi", category.Id, 31.1, 37.7));

        Assert.True(result.IsSuccess);
        var stored = await fixture.Db.Pois.AsNoTracking().SingleAsync(p => p.Id == poi.Id);
        Assert.Equal(31.1, stored.Coordinate.X);
        // Sahiplik DEVREDİLMEZ: taşıyan kişi kaydın sahibi olmaz.
        Assert.Equal(owner.Id, stored.UserId);
    }

    [Theory]
    [InlineData(180.1, 39.93)]
    [InlineData(-180.1, 39.93)]
    [InlineData(32.85, 90.1)]
    [InlineData(32.85, -90.1)]
    [InlineData(double.NaN, 39.93)]
    [InlineData(32.85, double.PositiveInfinity)]
    public async Task Update_rejects_a_coordinate_outside_EPSG4326(double longitude, double latitude)
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var poi = await fixture.AddPoiAsync("Kendi", category.Id, owner.Id, longitude: 32.85, latitude: 39.93);

        fixture.ActAs(owner);
        fixture.Grant(update: true);

        var result = await fixture.Service.UpdatePoiAsync(poi.Id, Move("Kendi", category.Id, longitude, latitude));

        /* Geçersiz koordinat 400'dür, 403 DEĞİL: "yanlış yerdesin" demek,
           haritalanabilir bir bilgi olurdu ve burada ortada bir yer yoktur. */
        Assert.False(result.IsSuccess);
        Assert.NotEqual(ServiceErrorKind.Forbidden, result.ErrorKind);

        var stored = await fixture.Db.Pois.AsNoTracking().SingleAsync(p => p.Id == poi.Id);
        Assert.Equal(32.85, stored.Coordinate.X);
        Assert.Equal(39.93, stored.Coordinate.Y);
    }

    [Fact]
    public async Task Update_rejects_half_a_coordinate()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var poi = await fixture.AddPoiAsync("Kendi", category.Id, owner.Id, longitude: 32.85, latitude: 39.93);

        fixture.ActAs(owner);
        fixture.Grant(update: true);

        /* Eksik yarı, kaydın eski değeriyle TAMAMLANMAZ: yalnızca boylamı
           gönderen bir hata, POI'yi paralel boyunca kilometrelerce öteye
           taşırdı ve bunu kimse istememiş olurdu. */
        var half = new UpdatePoiRequest { Name = "Kendi", CategoryId = category.Id, Longitude = 30.5 };

        Assert.False((await fixture.Service.UpdatePoiAsync(poi.Id, half)).IsSuccess);

        var stored = await fixture.Db.Pois.AsNoTracking().SingleAsync(p => p.Id == poi.Id);
        Assert.Equal(32.85, stored.Coordinate.X);
        Assert.Equal(39.93, stored.Coordinate.Y);
    }

    [Fact]
    public async Task Update_without_a_coordinate_leaves_the_record_where_it_is()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var poi = await fixture.AddPoiAsync("Kendi", category.Id, owner.Id, longitude: 32.85, latitude: 39.93);

        fixture.ActAs(owner);
        fixture.Grant(update: true);

        // Koordinat OPSİYONELDİR: alanı sunmayan çağıranlar (ve eski istemciler)
        // aynı ucu değiştirmeden kullanmaya devam eder.
        Assert.True((await fixture.Service.UpdatePoiAsync(poi.Id, Update("Yalnızca ad", category.Id))).IsSuccess);

        var stored = await fixture.Db.Pois.AsNoTracking().SingleAsync(p => p.Id == poi.Id);
        Assert.Equal("Yalnızca ad", stored.Name);
        Assert.Equal(32.85, stored.Coordinate.X);
        Assert.Equal(39.93, stored.Coordinate.Y);
    }

    [Fact]
    public async Task A_move_outside_the_allowed_area_is_forbidden_and_writes_nothing()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var poi = await fixture.AddPoiAsync("Kendi", category.Id, owner.Id, longitude: 32.85, latitude: 39.93);

        fixture.ActAs(owner);
        fixture.Grant(update: true);
        // Kaydın bulunduğu yeri KAPSAYAN küçük bir alan.
        fixture.RestrictTo(owner, Box(32.8, 39.9, 32.9, 40.0));

        var result = await fixture.Service.UpdatePoiAsync(poi.Id, Move("Uzağa", category.Id, 10.0, 10.0));

        /* Coğrafi sınır sahiplikten AYRI bir eksendir: kendi kaydı olması, onu
           her yere taşıyabilmek anlamına gelmez. Sunucu tek otoritedir; harita
           üzerindeki kısıt bir güvenlik sınırı değildir. */
        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
        // İzin verilen alan sızdırılmaz.
        Assert.DoesNotContain("32.8", result.Error);

        var stored = await fixture.Db.Pois.AsNoTracking().SingleAsync(p => p.Id == poi.Id);
        // Reddedilen taşımadan sonra AD DA değişmemiş olmalıdır: kısmen
        // uygulanmış bir güncelleme, kullanıcının göremediği bir durum olurdu.
        Assert.Equal("Kendi", stored.Name);
        Assert.Equal(32.85, stored.Coordinate.X);
        Assert.Equal(39.93, stored.Coordinate.Y);
    }

    [Fact]
    public async Task A_move_inside_the_allowed_area_is_written()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var poi = await fixture.AddPoiAsync("Kendi", category.Id, owner.Id, longitude: 32.85, latitude: 39.93);

        fixture.ActAs(owner);
        fixture.Grant(update: true);
        fixture.RestrictTo(owner, Box(32.8, 39.9, 32.9, 40.0));

        Assert.True((await fixture.Service.UpdatePoiAsync(poi.Id, Move("Kendi", category.Id, 32.88, 39.95))).IsSuccess);

        var stored = await fixture.Db.Pois.AsNoTracking().SingleAsync(p => p.Id == poi.Id);
        Assert.Equal(32.88, stored.Coordinate.X);
    }

    [Fact]
    public async Task Editing_only_the_name_is_not_treated_as_a_move()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var poi = await fixture.AddPoiAsync("Kendi", category.Id, owner.Id, longitude: 32.85, latitude: 39.93);

        fixture.ActAs(owner);
        fixture.Grant(update: true);
        /* Kaydın BULUNDUĞU yeri kapsamayan bir alan: kayıt, kullanıcının alanı
           sonradan daraltılmış olduğu için sınırın dışında kalmıştır. */
        fixture.RestrictTo(owner, Box(10.0, 10.0, 11.0, 11.0));

        // Form konumu bir alan olarak sunar, dolayısıyla değişmemiş koordinat da
        // gövdede gelir. Bu bir taşıma DEĞİLDİR ve coğrafi denetime sokulmaz —
        // aksi hâlde kullanıcı kendi kaydının adını bir daha düzeltemezdi.
        var result = await fixture.Service.UpdatePoiAsync(poi.Id, Move("Yeni ad", category.Id, 32.85, 39.93));

        Assert.True(result.IsSuccess);
        Assert.Equal("Yeni ad", (await fixture.Db.Pois.AsNoTracking().SingleAsync(p => p.Id == poi.Id)).Name);
    }

    [Fact]
    public async Task A_moved_record_still_reports_no_creator_identity()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");
        var poi = await fixture.AddPoiAsync("Kendi", category.Id, owner.Id);

        fixture.ActAs(owner);
        fixture.Grant(update: true);

        var result = await fixture.Service.UpdatePoiAsync(poi.Id, Move("Kendi", category.Id, 30.5, 38.2));

        // Konum düzenlenebilir oldu diye harita sözleşmesi genişlemez.
        Assert.IsType<PoiResponse>(result.Value);
        Assert.DoesNotContain(
            typeof(PoiResponse).GetProperties(),
            property => property.Name.Contains("User", StringComparison.Ordinal)
                || property.Name.Contains("Creator", StringComparison.Ordinal)
                || property.Name.Contains("Owner", StringComparison.Ordinal));
    }

    /* --- Yardımcı ------------------------------------------------------------------ */

    private static UpdatePoiRequest Update(string name, int categoryId) =>
        new() { Name = name, CategoryId = categoryId };

    /// <summary>Konumu da taşıyan düzenleme gövdesi.</summary>
    private static UpdatePoiRequest Move(string name, int categoryId, double longitude, double latitude) =>
        new() { Name = name, CategoryId = categoryId, Longitude = longitude, Latitude = latitude };

    /// <summary>Coğrafi yetki testleri için eksene hizalı dikdörtgen (EPSG:4326).</summary>
    private static Polygon Box(double minX, double minY, double maxX, double maxY) =>
        new GeometryFactory(new PrecisionModel(), 4326).CreatePolygon(
        [
            new Coordinate(minX, minY),
            new Coordinate(maxX, minY),
            new Coordinate(maxX, maxY),
            new Coordinate(minX, maxY),
            new Coordinate(minX, minY)
        ]);
}
