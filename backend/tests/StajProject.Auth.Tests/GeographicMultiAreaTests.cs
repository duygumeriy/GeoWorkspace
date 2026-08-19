using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using NetTopologySuite.Geometries;
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
/// Hedef başına ÇOK coğrafi alan (Phase 9): birleşim, öncelik ve tek tek
/// yönetim.
/// </summary>
/// <remarks>
/// <para>
/// <b>Değişen şey sayı, kural DEĞİL.</b> Phase 8A'nın iki kuralı aynen
/// yürürlüktedir ve buradaki testlerin yarısı tam olarak onların çok alanlı
/// hâlde de bozulmadığını ölçer: (1) kullanıcının kendi alanları rollerini
/// EZER, (2) aday geometri alanın TAMAMINCA kapsanmalıdır.
/// </para>
/// <para>
/// <b>Boşluklar izinsizdir.</b> Kopuk iki alan arasındaki bölge hiçbir alanın
/// içinde değildir ve öyle kalmalıdır. Birleşimi kapsayan dikdörtgenle ya da
/// halkaları uç uca ekleyerek hesaplayan bir uygulama bu testlerde düşer —
/// aradaki koridor bir anda izinli görünürdü.
/// </para>
/// <para>
/// Testler servis katmanına doğrudan konuşur; arayüz hiç devrede değildir.
/// </para>
/// </remarks>
public class GeographicMultiAreaTests
{
    /// <summary>Batı kutusu (Ankara civarı).</summary>
    private const string West = "POLYGON ((32 39, 33 39, 33 40, 32 40, 32 39))";

    /// <summary>Doğu kutusu (Kayseri civarı) — Batı ile KESİŞMEZ.</summary>
    private const string East = "POLYGON ((35 38, 36 38, 36 39, 35 39, 35 38))";

    /// <summary>Üçüncü, yine kopuk bir kutu (Sivas civarı).</summary>
    private const string North = "POLYGON ((37 39.5, 38 39.5, 38 40.5, 37 40.5, 37 39.5))";

    /// <summary>Batı'yı tamamen kapsayan geniş alan.</summary>
    private const string Wide = "POLYGON ((30 37, 38 37, 38 42, 30 42, 30 37))";

    /* --- Kullanıcının doğrudan alanlarının birleşimi ---------------------------- */

    [Fact]
    public async Task Two_direct_user_areas_both_become_drawable()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "two-area-user");

        await AddUserAreaAsync(scope, user.Id, West, "Ankara");
        await AddUserAreaAsync(scope, user.Id, East, "Kayseri");

        var effective = await Geographic(scope).GetEffectiveAuthorizationAsync(user.Id);

        Assert.True(effective.IsRestricted);
        // İkisi de: birleşim gerçekten iki bölgeyi de içerir.
        Assert.True(effective.Allows(Wkt("POINT (32.5 39.5)")));
        Assert.True(effective.Allows(Wkt("POINT (35.5 38.5)")));
    }

    [Fact]
    public async Task The_gap_between_two_disconnected_areas_stays_unauthorized()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "gap-user");

        await AddUserAreaAsync(scope, user.Id, West, "Ankara");
        await AddUserAreaAsync(scope, user.Id, East, "Kayseri");

        var effective = await Geographic(scope).GetEffectiveAuthorizationAsync(user.Id);

        /* İki kutunun ARASI. Birleşim kapsayan dikdörtgenle hesaplansaydı bu
           nokta izinli görünürdü; gerçek mekânsal birleşimde görünmez. */
        Assert.False(effective.Allows(Wkt("POINT (34 39)")));
    }

    [Fact]
    public async Task A_line_crossing_the_gap_is_rejected_even_though_both_ends_are_inside()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "bridging-user");

        await AddUserAreaAsync(scope, user.Id, West, "Ankara");
        await AddUserAreaAsync(scope, user.Id, East, "Kayseri");

        var result = await Drawings(scope, user).CreateLineAsync(
            Line("LINESTRING (32.5 39.5, 35.5 38.5)"), default);

        /* İki uç da izinli bölgelerin içindedir. Uç noktalarına ya da tüm
           köşelere bakan bir denetim bunu KABUL ederdi; geometrinin tamamını
           sınayan Covers reddeder. */
        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
    }

    [Fact]
    public async Task A_drawing_inside_the_second_area_is_accepted()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "second-area-drawer");

        await AddUserAreaAsync(scope, user.Id, West, "Ankara");
        await AddUserAreaAsync(scope, user.Id, East, "Kayseri");

        // Sonradan eklenen alan da tam anlamıyla çizilebilir olmalıdır.
        var result = await Drawings(scope, user).CreatePointAsync(Point("POINT (35.5 38.5)"), default);

        Assert.True(result.IsSuccess);
    }

    /* --- Öncelik: doğrudan alanlar rolleri EZER -------------------------------- */

    [Fact]
    public async Task Direct_user_areas_override_role_areas_entirely()
    {
        await using var scope = await CreateScopeAsync();
        var role = await CreateRoleAsync(scope, "Geniş Rol");
        var user = await CreateUserAsync(scope, "narrowed-user", role);

        await AddRoleAreaAsync(scope, role.Id, Wide, "Geniş");
        await AddUserAreaAsync(scope, user.Id, East, "Kayseri");
        await AddUserAreaAsync(scope, user.Id, North, "Sivas");

        var effective = await Geographic(scope).GetEffectiveAuthorizationAsync(user.Id);

        /* Rol alanı Batı'yı kapsıyor ama kullanıcının KENDİ alanları var:
           birleşme YOKTUR, tamamen devre dışı kalırlar. Daraltma yönetimin
           temel aracıdır; birleştirilseydi Ankara da izinli kalırdı. */
        Assert.False(effective.Allows(Wkt("POINT (32.5 39.5)")));
        Assert.True(effective.Allows(Wkt("POINT (35.5 38.5)")));
        Assert.True(effective.Allows(Wkt("POINT (37.5 40)")));
    }

    /* --- Rol alanlarının birleşimi --------------------------------------------- */

    [Fact]
    public async Task A_role_with_three_areas_grants_all_three_to_its_members()
    {
        await using var scope = await CreateScopeAsync();
        var role = await CreateRoleAsync(scope, "Saha Ekibi");
        var user = await CreateUserAsync(scope, "field-worker", role);

        await AddRoleAreaAsync(scope, role.Id, West, "Ankara");
        await AddRoleAreaAsync(scope, role.Id, East, "Kayseri");
        await AddRoleAreaAsync(scope, role.Id, North, "Sivas");

        var effective = await Geographic(scope).GetEffectiveAuthorizationAsync(user.Id);

        Assert.True(effective.IsRestricted);
        Assert.True(effective.Allows(Wkt("POINT (32.5 39.5)")));
        Assert.True(effective.Allows(Wkt("POINT (35.5 38.5)")));
        Assert.True(effective.Allows(Wkt("POINT (37.5 40)")));
        // Üç kutunun hiçbirinde olmayan bir nokta hâlâ izinsizdir.
        Assert.False(effective.Allows(Wkt("POINT (34 39)")));
    }

    [Fact]
    public async Task Areas_of_every_role_the_user_belongs_to_are_combined()
    {
        await using var scope = await CreateScopeAsync();
        var west = await CreateRoleAsync(scope, "Batı Ekibi");
        var east = await CreateRoleAsync(scope, "Doğu Ekibi");
        var user = await CreateUserAsync(scope, "two-role-user", west, east);

        // Her rolün KENDİ içinde de birden çok alanı var.
        await AddRoleAreaAsync(scope, west.Id, West, "Ankara");
        await AddRoleAreaAsync(scope, east.Id, East, "Kayseri");
        await AddRoleAreaAsync(scope, east.Id, North, "Sivas");

        var effective = await Geographic(scope).GetEffectiveAuthorizationAsync(user.Id);

        Assert.True(effective.Allows(Wkt("POINT (32.5 39.5)")));
        Assert.True(effective.Allows(Wkt("POINT (35.5 38.5)")));
        Assert.True(effective.Allows(Wkt("POINT (37.5 40)")));
    }

    /* --- Tek tek yönetim -------------------------------------------------------- */

    [Fact]
    public async Task Adding_an_area_leaves_the_existing_ones_untouched()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "adder");

        var first = await AddUserAreaAsync(scope, user.Id, West, "Ankara");
        var second = await AddUserAreaAsync(scope, user.Id, East, "Kayseri");

        var areas = (await Geographic(scope).GetUserAreasAsync(user.Id)).Value!.Areas;

        /* EKLEME, DEĞİŞTİRME DEĞİLDİR. Phase 8A'nın upsert davranışı burada
           sürseydi ikinci çağrı birinciyi sessizce silerdi. */
        Assert.Equal(2, areas.Count);
        Assert.Equal([first, second], areas.Select(a => a.Id));
        Assert.Equal(["Ankara", "Kayseri"], areas.Select(a => a.Name));
    }

    [Fact]
    public async Task Updating_one_area_changes_only_that_area()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "updater");

        var first = await AddUserAreaAsync(scope, user.Id, West, "Ankara");
        var second = await AddUserAreaAsync(scope, user.Id, East, "Kayseri");

        var updated = await Geographic(scope).UpdateUserAreaAsync(
            user.Id, second, Save(North, "Sivas", GeographicAreaSource.Province, "TR-58"));

        Assert.True(updated.IsSuccess, updated.Error);

        var areas = updated.Value!.Areas;
        Assert.Equal(2, areas.Count);

        // Dokunulmayan alan bit düzeyinde aynıdır.
        var untouched = areas.Single(a => a.Id == first);
        Assert.Equal("Ankara", untouched.Name);
        Assert.Equal(GeographicAreaSource.ManualPolygon, untouched.SourceType);

        var changed = areas.Single(a => a.Id == second);
        Assert.Equal("Sivas", changed.Name);
        Assert.Equal(GeographicAreaSource.Province, changed.SourceType);
        Assert.Equal("TR-58", changed.SourceKey);
    }

    [Fact]
    public async Task Deleting_one_area_leaves_the_others_in_place()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "deleter");

        var first = await AddUserAreaAsync(scope, user.Id, West, "Ankara");
        await AddUserAreaAsync(scope, user.Id, East, "Kayseri");

        var afterDelete = await Geographic(scope).DeleteUserAreaAsync(user.Id, first);

        Assert.True(afterDelete.IsSuccess, afterDelete.Error);
        Assert.Equal(["Kayseri"], afterDelete.Value!.Areas.Select(a => a.Name));

        var effective = await Geographic(scope).GetEffectiveAuthorizationAsync(user.Id);
        Assert.False(effective.Allows(Wkt("POINT (32.5 39.5)")));
        Assert.True(effective.Allows(Wkt("POINT (35.5 38.5)")));
    }

    [Fact]
    public async Task Deleting_the_last_direct_area_falls_back_to_the_role_areas()
    {
        await using var scope = await CreateScopeAsync();
        var role = await CreateRoleAsync(scope, "Geniş Rol");
        var user = await CreateUserAsync(scope, "falling-back", role);

        await AddRoleAreaAsync(scope, role.Id, Wide, "Geniş");
        var only = await AddUserAreaAsync(scope, user.Id, East, "Kayseri");

        // Kullanıcının kendi alanı varken Batı izinsizdi.
        Assert.False((await Geographic(scope).GetEffectiveAuthorizationAsync(user.Id))
            .Allows(Wkt("POINT (32.5 39.5)")));

        await Geographic(scope).DeleteUserAreaAsync(user.Id, only);

        var effective = await Geographic(scope).GetEffectiveAuthorizationAsync(user.Id);

        // Son doğrudan alan gidince miras yeniden devreye girer — kısıtsızlığa
        // DEĞİL, rolün alanına düşülür.
        Assert.True(effective.IsRestricted);
        Assert.True(effective.Allows(Wkt("POINT (32.5 39.5)")));
    }

    [Fact]
    public async Task A_user_with_neither_direct_nor_role_areas_is_unrestricted()
    {
        await using var scope = await CreateScopeAsync();
        var role = await CreateRoleAsync(scope, "Alansız Rol");
        var user = await CreateUserAsync(scope, "unbounded-user", role);

        var effective = await Geographic(scope).GetEffectiveAuthorizationAsync(user.Id);

        // Mevcut kurulumların davranışı korunur: alan yoksa kısıt da yoktur.
        Assert.False(effective.IsRestricted);
        Assert.Null(effective.AllowedArea);
    }

    /* --- Alanın hedefe aidiyeti -------------------------------------------------- */

    [Fact]
    public async Task An_area_belonging_to_another_user_cannot_be_updated_or_deleted()
    {
        await using var scope = await CreateScopeAsync();
        var owner = await CreateUserAsync(scope, "area-owner");
        var other = await CreateUserAsync(scope, "area-outsider");

        var owned = await AddUserAreaAsync(scope, owner.Id, West, "Ankara");

        var update = await Geographic(scope).UpdateUserAreaAsync(other.Id, owned, Save(East, "Kayseri"));
        var delete = await Geographic(scope).DeleteUserAreaAsync(other.Id, owned);

        /* Alan HEDEFİYLE BİRLİKTE aranır. Yalnızca id ile arayan bir uygulama,
           kimliği tahmin eden bir isteğe başkasının alanını düzenletirdi. */
        Assert.Equal(ServiceErrorKind.NotFound, update.ErrorKind);
        Assert.Equal(ServiceErrorKind.NotFound, delete.ErrorKind);

        // Sahibinin alanı olduğu gibi durur.
        Assert.Equal(["Ankara"], (await Geographic(scope).GetUserAreasAsync(owner.Id)).Value!.Areas.Select(a => a.Name));
    }

    [Fact]
    public async Task A_role_area_cannot_be_managed_through_the_user_routes()
    {
        await using var scope = await CreateScopeAsync();
        var role = await CreateRoleAsync(scope, "Rol");
        var user = await CreateUserAsync(scope, "role-member", role);

        var roleArea = await AddRoleAreaAsync(scope, role.Id, Wide, "Geniş");

        var deleted = await Geographic(scope).DeleteUserAreaAsync(user.Id, roleArea);

        /* Miras alınan alan kullanıcı ekranından SİLİNEMEZ. Silinebilseydi,
           bir kullanıcıyı düzenleyen yönetici farkında olmadan o rolü taşıyan
           herkesin sınırını değiştirirdi. */
        Assert.Equal(ServiceErrorKind.NotFound, deleted.ErrorKind);
        Assert.Single((await Geographic(scope).GetRoleAreasAsync(role.Id)).Value!.Areas);
    }

    /* --- Cevabın biçimi ---------------------------------------------------------- */

    [Fact]
    public async Task The_user_response_separates_direct_areas_from_the_effective_boundary()
    {
        await using var scope = await CreateScopeAsync();
        var role = await CreateRoleAsync(scope, "Miras Rolü");
        var user = await CreateUserAsync(scope, "inheritor", role);

        await AddRoleAreaAsync(scope, role.Id, Wide, "Geniş");

        var response = (await Geographic(scope).GetUserAreasAsync(user.Id)).Value!;

        /* Miras alınan alan `Areas` listesine GİRMEZ: girseydi arayüz onu
           silinebilir bir kullanıcı alanı gibi gösterirdi. Yürürlükteki sınır
           ayrı alanda taşınır. */
        Assert.Empty(response.Areas);
        Assert.True(response.IsRestricted);
        Assert.NotNull(response.EffectiveWkt);
    }

    [Fact]
    public async Task The_effective_boundary_of_disconnected_areas_is_a_multipolygon()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "multipolygon-user");

        await AddUserAreaAsync(scope, user.Id, West, "Ankara");
        await AddUserAreaAsync(scope, user.Id, East, "Kayseri");

        var response = (await Geographic(scope).GetUserAreasAsync(user.Id)).Value!;

        Assert.StartsWith("MULTIPOLYGON", response.EffectiveWkt);
        // Alanların KENDİLERİ hâlâ ayrı ayrı Polygon'dur; birleşim hesaplanandır.
        Assert.All(response.Areas, area => Assert.StartsWith("POLYGON", area.Wkt));
    }

    [Fact]
    public async Task A_missing_name_falls_back_to_a_readable_default_rather_than_being_rejected()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "nameless");

        var created = await Geographic(scope).CreateUserAreaAsync(
            user.Id, new SaveGeographicAreaRequest { Wkt = West });

        Assert.True(created.IsSuccess, created.Error);

        /* Ad zorunlu değildir: yetkilendirmeyi etkilemez ve zorunlu kılmak
           "hızlıca bir bölge daha ekle" akışını form doldurmaya çevirirdi. */
        Assert.Equal("Çizilen alan", Assert.Single(created.Value!.Areas).Name);
    }

    [Fact]
    public async Task An_invalid_polygon_is_refused_and_nothing_is_written()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "bowtie-drawer");

        await AddUserAreaAsync(scope, user.Id, West, "Ankara");

        // Kendisiyle kesişen halka ("bowtie").
        var created = await Geographic(scope).CreateUserAreaAsync(
            user.Id, Save("POLYGON ((0 0, 10 10, 10 0, 0 10, 0 0))", "Bozuk"));

        Assert.False(created.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, created.ErrorKind);

        // Var olan alan reddedilen bir istekten etkilenmez.
        Assert.Single((await Geographic(scope).GetUserAreasAsync(user.Id)).Value!.Areas);
    }

    [Fact]
    public async Task The_source_type_never_widens_the_area()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "liar");

        /* İstemci "bu bir il alanı" diyor ve anahtar olarak Ankara'yı
           gösteriyor — ama gönderdiği poligon küçük bir kutu. Kaydedilen ve
           sınanan şey daima GEOMETRİDİR; etiket kapsamı değiştirmez. */
        await Geographic(scope).CreateUserAreaAsync(
            user.Id, Save(East, "Ankara ili", GeographicAreaSource.Province, "TR-06"));

        var effective = await Geographic(scope).GetEffectiveAuthorizationAsync(user.Id);

        Assert.False(effective.Allows(Wkt("POINT (32.5 39.5)")));
        Assert.True(effective.Allows(Wkt("POINT (35.5 38.5)")));
    }

    /* --- Yardımcılar ------------------------------------------------------------- */

    private static AppDbContext Db(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<AppDbContext>();

    private static IGeographicAuthorizationService Geographic(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<IGeographicAuthorizationService>();

    private static Geometry Wkt(string wkt) =>
        StajProject.Application.Spatial.WktGeometryParser.Parse<Geometry>(wkt).Value!;

    private static SaveGeographicAreaRequest Save(
        string wkt,
        string? name = null,
        GeographicAreaSource? source = null,
        string? sourceKey = null) =>
        new() { Wkt = wkt, Name = name, SourceType = source, SourceKey = sourceKey };

    private static DrawingStyleDto Style() => new() { StrokeColor = "#3366FF" };

    private static CreateDrawingRequest Point(string wkt) => new() { Wkt = wkt, Name = "Nokta", Style = Style() };

    private static CreateDrawingRequest Line(string wkt) => new() { Wkt = wkt, Name = "Çizgi", Style = Style() };

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

        return new DrawingService(Db(scope), currentUser, authorization, Geographic(scope));
    }

    /// <summary>Alan ekler ve YENİ alanın kimliğini döner.</summary>
    private static async Task<int> AddUserAreaAsync(AsyncServiceScope scope, int userId, string wkt, string name)
    {
        var before = (await Geographic(scope).GetUserAreasAsync(userId)).Value!.Areas.Select(a => a.Id).ToHashSet();
        var result = await Geographic(scope).CreateUserAreaAsync(userId, Save(wkt, name));

        Assert.True(result.IsSuccess, result.Error);
        return result.Value!.Areas.Single(a => !before.Contains(a.Id)).Id;
    }

    private static async Task<int> AddRoleAreaAsync(AsyncServiceScope scope, int roleId, string wkt, string name)
    {
        var before = (await Geographic(scope).GetRoleAreasAsync(roleId)).Value!.Areas.Select(a => a.Id).ToHashSet();
        var result = await Geographic(scope).CreateRoleAreaAsync(roleId, Save(wkt, name));

        Assert.True(result.IsSuccess, result.Error);
        return result.Value!.Areas.Single(a => !before.Contains(a.Id)).Id;
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

    private static Task<AsyncServiceScope> CreateScopeAsync()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
        services.AddDbContext<AppDbContext>(o => o
            .UseInMemoryDatabase($"geographic-multi-area-{Guid.NewGuid():N}")
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)));

        services.AddIdentityCore<User>(o => o.Password.RequiredLength = 8)
            .AddRoles<IdentityRole<int>>()
            .AddEntityFrameworkStores<AppDbContext>()
            .AddDefaultTokenProviders();

        services.AddScoped<IGeographicAuthorizationService, GeographicAuthorizationService>();

        return Task.FromResult(services.BuildServiceProvider().CreateAsyncScope());
    }
}
