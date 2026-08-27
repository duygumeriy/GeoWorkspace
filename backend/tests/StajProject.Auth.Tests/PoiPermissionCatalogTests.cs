using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Auth.Tests;

/// <summary>
/// POI katalog genişlemesi: <c>poi.view</c>, <c>poi.create</c>,
/// <c>poi.update</c>, <c>poi.delete</c>, <c>poi.manage</c>,
/// <c>poi.categories.manage</c>.
/// </summary>
/// <remarks>
/// <para>
/// Burada kanıtlanan şey, altı POI kodunun sisteme <i>sıradan kanonik
/// yetkiler olarak</i> girdiği ve mevcut yetkilendirme verisinin
/// bozulmadığıdır. <c>poi.update</c> ve <c>poi.delete</c> Phase 3'te
/// eklenmiştir; ikisi de yalnızca KENDİ kayıtlarında yetki verir — sahiplik
/// sınırı kodun değil servis katmanının işidir ve
/// <see cref="PoiOwnershipTests"/> tarafından ölçülür.
/// </para>
/// <para>
/// <b>Rol tarafındaki asıl iddia bir OLUMSUZLUKTUR.</b> Ödevin "Operatör"
/// rolü kanonik role listesine EKLENMEMİŞTİR; ileride normal rol yönetimi
/// ekranından tanımlanacak özel bir roldür. Bu testler o sınırın sessizce
/// aşılmadığını sabitler.
/// </para>
/// </remarks>
public class PoiPermissionCatalogTests
{
    private static readonly string[] Poi =
    [
        PermissionCodes.PoiView,
        PermissionCodes.PoiCreate,
        PermissionCodes.PoiUpdate,
        PermissionCodes.PoiDelete,
        PermissionCodes.PoiManage,
        PermissionCodes.PoiCategoriesManage
    ];

    /* --- Katalog ---------------------------------------------------------------- */

    [Fact]
    public void Poi_permissions_are_declared_with_the_expected_metadata()
    {
        var view = Single(PermissionCodes.PoiView);
        var create = Single(PermissionCodes.PoiCreate);
        var manage = Single(PermissionCodes.PoiManage);
        var categories = Single(PermissionCodes.PoiCategoriesManage);

        Assert.Equal("poi.view", view.Code);
        Assert.Equal("POI Görüntüleme", view.Name);

        Assert.Equal("poi.create", create.Code);
        Assert.Equal("POI Ekleme", create.Name);

        var update = Single(PermissionCodes.PoiUpdate);
        var delete = Single(PermissionCodes.PoiDelete);

        Assert.Equal("poi.update", update.Code);
        Assert.Equal("POI Düzenleme", update.Name);

        Assert.Equal("poi.delete", delete.Code);
        Assert.Equal("POI Silme", delete.Name);

        Assert.Equal("poi.manage", manage.Code);
        Assert.Equal("POI Yönetimi", manage.Name);

        Assert.Equal("poi.categories.manage", categories.Code);
        Assert.Equal("POI Kategori Yönetimi", categories.Name);
    }

    [Fact]
    public void The_expansion_adds_exactly_six_codes()
    {
        /* Ölçülen şey POI genişlemesinin BÜYÜKLÜĞÜDÜR: kataloğa altı kod
           eklemiştir, ne bir eksik ne bir fazla. Sabit bir toplam yerine bu
           FARKA bakılır — başka fazların katkıları bu iddiayı bozmamalıdır. */
        Assert.Equal(6, PermissionCatalog.AllCodes.Count(code => Poi.Contains(code)));

        Assert.Equal(
            PermissionCatalog.AllCodes.Count - 6,
            PermissionCatalog.AllCodes.Count(code => !Poi.Contains(code)));
    }

    [Fact]
    public void Poi_permissions_share_a_category_of_their_own()
    {
        /* POI, DrawingCreate / DrawingManagement kategorilerine SOKULMAZ: POI
           stil taşımayan, sahibine göre gizlenmeyen ortak bir envanterdir ve
           çizim yetkileriyle aynı grupta görünmesi, yetki ekranında iki ayrı
           yeteneği tek bir şeymiş gibi gösterirdi. */
        Assert.Equal(
            Poi.OrderBy(c => c, StringComparer.Ordinal),
            PermissionCatalog.All
                .Where(p => p.Category == PermissionCategories.Poi)
                .Select(p => p.Code)
                .OrderBy(c => c, StringComparer.Ordinal));
    }

    [Fact]
    public void Poi_codes_are_unique_within_the_catalog()
    {
        Assert.Equal(
            PermissionCatalog.AllCodes.Count,
            PermissionCatalog.AllCodes.Distinct(StringComparer.Ordinal).Count());

        Assert.All(Poi, code => Assert.Single(PermissionCatalog.All, p => p.Code == code));
    }

    [Fact]
    public void Poi_sort_orders_are_unique_and_keep_their_internal_order()
    {
        /* Yeni kategoriler POI'den sonra eklenebilir. Kalıcı sözleşme,
           POI satırlarının kendi içindeki deterministik sırası ve katalog
           genelinde çakışmayan sıra değerleridir. */
        var poiOrders = PermissionCatalog.All.Where(p => Poi.Contains(p.Code)).Select(p => p.SortOrder).ToArray();
        Assert.Equal(poiOrders.Length, poiOrders.Distinct().Count());
        Assert.Equal(
            PermissionCatalog.All.Count,
            PermissionCatalog.All.Select(permission => permission.SortOrder).Distinct().Count());

        /* Görüntüleme → ekleme → düzenleme → silme → yönetme sırası kategori
           içinde korunur: yetenekler artan otorite sırasında okunur. */
        Assert.True(Single(PermissionCodes.PoiView).SortOrder < Single(PermissionCodes.PoiCreate).SortOrder);
        Assert.True(Single(PermissionCodes.PoiCreate).SortOrder < Single(PermissionCodes.PoiUpdate).SortOrder);
        Assert.True(Single(PermissionCodes.PoiUpdate).SortOrder < Single(PermissionCodes.PoiDelete).SortOrder);
        Assert.True(Single(PermissionCodes.PoiDelete).SortOrder < Single(PermissionCodes.PoiManage).SortOrder);
        Assert.True(Single(PermissionCodes.PoiManage).SortOrder < Single(PermissionCodes.PoiCategoriesManage).SortOrder);
    }

    [Fact]
    public void Poi_codes_carry_no_scope_suffix()
    {
        Assert.DoesNotContain(
            Poi,
            code => code.EndsWith(".own", StringComparison.Ordinal)
                || code.EndsWith(".all", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Seeding_writes_all_four_codes_as_active_rows()
    {
        await using var scope = CreateScope();

        await SeedAsync(scope);

        var stored = await Db(scope).Permissions.Where(p => Poi.Contains(p.Code)).ToListAsync();

        Assert.Equal(6, stored.Count);
        Assert.All(stored, p =>
        {
            Assert.True(p.IsActive);
            Assert.Equal(PermissionCategories.Poi, p.Category);
            Assert.NotEmpty(p.Name);
        });
    }

    /* --- Varsayılan rol matrisi ------------------------------------------------- */

    [Fact]
    public void Default_matrix_grants_the_expected_poi_codes()
    {
        Assert.Equal(
            [PermissionCodes.PoiView],
            PoiCodesOf(GisRoles.Viewer));

        Assert.Equal(
            [PermissionCodes.PoiCreate, PermissionCodes.PoiDelete, PermissionCodes.PoiUpdate, PermissionCodes.PoiView],
            PoiCodesOf(GisRoles.GisEditor));

        Assert.Equal(
            [PermissionCodes.PoiView],
            PoiCodesOf(GisRoles.GisAnalyst));

        Assert.Equal(
            [PermissionCodes.PoiCategoriesManage, PermissionCodes.PoiCreate, PermissionCodes.PoiDelete,
             PermissionCodes.PoiManage, PermissionCodes.PoiUpdate, PermissionCodes.PoiView],
            PoiCodesOf(GisRoles.GisManager));
    }

    [Fact]
    public void Administrator_receives_poi_permissions_through_all_codes()
    {
        /* Yönetici POI yetkilerini elle sayılan bir listeden DEĞİL, katalogdan
           alır: matris PermissionCatalog.AllCodes'a bağlıdır. İddia bu yüzden
           "dördü de yöneticidedir" değil, "yöneticinin listesi kataloğun
           kendisidir" biçiminde kurulur. */
        Assert.Equal(
            PermissionCatalog.AllCodes.OrderBy(c => c, StringComparer.Ordinal),
            RolePermissionDefaults.For(GisRoles.Administrator).OrderBy(c => c, StringComparer.Ordinal));

        Assert.All(Poi, code => Assert.Contains(code, RolePermissionDefaults.For(GisRoles.Administrator)));
    }

    [Fact]
    public async Task Seeded_roles_receive_the_expected_poi_grants()
    {
        await using var scope = CreateScope();
        await SeedAsync(scope);

        Assert.Equal([PermissionCodes.PoiView], await PoiCodesOfAsync(scope, GisRoles.Viewer));
        Assert.Equal([PermissionCodes.PoiCreate, PermissionCodes.PoiDelete, PermissionCodes.PoiUpdate, PermissionCodes.PoiView], await PoiCodesOfAsync(scope, GisRoles.GisEditor));
        Assert.Equal([PermissionCodes.PoiView], await PoiCodesOfAsync(scope, GisRoles.GisAnalyst));
        Assert.Equal(
            [PermissionCodes.PoiCategoriesManage, PermissionCodes.PoiCreate, PermissionCodes.PoiDelete,
             PermissionCodes.PoiManage, PermissionCodes.PoiUpdate, PermissionCodes.PoiView],
            await PoiCodesOfAsync(scope, GisRoles.GisManager));
        Assert.Equal(
            [PermissionCodes.PoiCategoriesManage, PermissionCodes.PoiCreate, PermissionCodes.PoiDelete,
             PermissionCodes.PoiManage, PermissionCodes.PoiUpdate, PermissionCodes.PoiView],
            await PoiCodesOfAsync(scope, GisRoles.Administrator));
    }

    /* --- Mevcut kurulum genişlemesi --------------------------------------------- */

    [Fact]
    public void Expansions_carry_the_same_poi_distribution_as_the_default_matrix()
    {
        /* Genişlemenin işi yeni kodları zaten provision edilmiş rollere
           ULAŞTIRMAKTIR — farklı bir profil tanımlamak değil. İki listenin POI
           tarafı ayrışırsa, taze veritabanı ile mevcut veritabanı sessizce
           farklı davranmaya başlar. */
        foreach (var roleName in (string[])[GisRoles.Viewer, GisRoles.GisEditor, GisRoles.GisAnalyst, GisRoles.GisManager, GisRoles.Administrator])
        {
            Assert.Equal(PoiCodesOf(roleName), ExpansionPoiCodesOf(roleName));
        }
    }

    [Fact]
    public void Expansions_touch_no_role_outside_the_canonical_set()
    {
        Assert.All(
            RolePermissionExpansions.All,
            expansion => Assert.Contains(expansion.RoleName, RoleCatalog.Canonical));
    }

    [Fact]
    public async Task An_already_provisioned_role_still_receives_the_new_poi_codes()
    {
        /* Asıl regresyon riski burada: RolePermissionDefaults YALNIZCA hiç
           yetkisi olmayan rolleri doldurur, dolayısıyla mevcut bir kurulumda
           POI kodları hiçbir role ulaşmazdı. Rol önce tek bir grant ile
           "provision edilmiş" hâle getirilir, sonra seed çalıştırılır. */
        await using var scope = CreateScope();

        var db = Db(scope);
        var roles = Roles(scope);

        await roles.CreateAsync(new IdentityRole<int>(GisRoles.Viewer));
        var viewer = await roles.FindByNameAsync(GisRoles.Viewer);

        db.Permissions.Add(new Permission
        {
            Code = PermissionCodes.MapView,
            Name = "Haritayı Görüntüleme",
            Category = PermissionCategories.Map
        });
        await db.SaveChangesAsync();

        var mapView = await db.Permissions.SingleAsync(p => p.Code == PermissionCodes.MapView);
        db.RolePermissions.Add(new RolePermission { RoleId = viewer!.Id, PermissionId = mapView.Id });
        await db.SaveChangesAsync();

        await SeedAsync(scope);

        Assert.Equal([PermissionCodes.PoiView], await PoiCodesOfAsync(scope, GisRoles.Viewer));
    }

    [Fact]
    public async Task Reseeding_creates_no_duplicate_poi_grants()
    {
        await using var scope = CreateScope();

        await SeedAsync(scope);
        await SeedAsync(scope);

        var db = Db(scope);
        var poiIds = await db.Permissions.Where(p => Poi.Contains(p.Code)).Select(p => p.Id).ToListAsync();

        Assert.Equal(6, poiIds.Count);

        var pairs = await db.RolePermissions
            .Where(rp => poiIds.Contains(rp.PermissionId))
            .Select(rp => new { rp.RoleId, rp.PermissionId })
            .ToListAsync();

        Assert.Equal(pairs.Count, pairs.Distinct().Count());
    }

    /* --- Rol sınırları ---------------------------------------------------------- */

    [Fact]
    public async Task Retired_roles_receive_no_poi_permissions()
    {
        await using var scope = CreateScope();
        await SeedAsync(scope);

        Assert.Empty(await PoiCodesOfAsync(scope, ApplicationRoles.Admin));
        Assert.Empty(await PoiCodesOfAsync(scope, ApplicationRoles.User));

        // Emekli adlar tombstone olarak kalır; POI fazı onları diriltmez.
        Assert.Equal(new[] { ApplicationRoles.Admin, ApplicationRoles.User }, ApplicationRoles.Retired);
        Assert.True(RoleCatalog.IsLegacy(ApplicationRoles.Admin));
        Assert.True(RoleCatalog.IsLegacy(ApplicationRoles.User));
    }

    [Fact]
    public void Legacy_generic_operator_is_not_a_canonical_role()
    {
        /* Yasaklanan eski genel ad tam olarak "Operatör"dür. Alanı belli olan
           "Ulaşım Operatörü" ayrı ve meşru bir kanonik roldür. */
        Assert.Equal(
            new[]
            {
                GisRoles.Viewer,
                GisRoles.GisEditor,
                GisRoles.GisAnalyst,
                GisRoles.GisManager,
                GisRoles.TransportOperator,
                GisRoles.TransportUser,
                GisRoles.Administrator
            },
            GisRoles.All);

        Assert.DoesNotContain(GisRoles.All, role => string.Equals(role, "Operatör", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(RoleCatalog.Reserved, role => string.Equals(role, "Operatör", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(GisRoles.TransportOperator, GisRoles.All);

        // Kanonik olmadığı için özel roldür ve serbestçe tanımlanabilir.
        Assert.True(RoleCatalog.IsCustom("Operatör"));
        Assert.True(RoleCatalog.IsAssignable("Operatör"));
    }

    [Fact]
    public async Task Seeding_provisions_no_legacy_generic_operator_role()
    {
        await using var scope = CreateScope();
        await SeedAsync(scope);

        var roles = await Roles(scope).Roles.Select(r => r.Name).ToListAsync();

        Assert.DoesNotContain(roles, role => string.Equals(role, "Operatör", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(GisRoles.TransportOperator, roles);
    }

    [Fact]
    public void Gis_editor_was_not_renamed()
    {
        // Operatör eşlemesi mevcut profili YENİDEN ADLANDIRMAZ; GIS Editor
        // adına bağlı rol atamaları olduğu gibi kalır.
        Assert.Equal("GIS Editor", GisRoles.GisEditor);
        Assert.Contains(GisRoles.GisEditor, RoleCatalog.Canonical);
    }

    /* --- Yardımcılar ------------------------------------------------------------ */

    private static PermissionCatalog.Definition Single(string code) =>
        Assert.Single(PermissionCatalog.All, p => p.Code == code);

    private static string[] PoiCodesOf(string roleName) =>
        [.. RolePermissionDefaults.For(roleName).Where(Poi.Contains).OrderBy(c => c, StringComparer.Ordinal)];

    private static string[] ExpansionPoiCodesOf(string roleName) =>
    [
        .. RolePermissionExpansions.All
            .Where(e => e.RoleName == roleName)
            .SelectMany(e => e.PermissionCodes)
            .Where(Poi.Contains)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(c => c, StringComparer.Ordinal)
    ];

    private static AppDbContext Db(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<AppDbContext>();

    private static RoleManager<IdentityRole<int>> Roles(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

    private static async Task<string[]> PoiCodesOfAsync(AsyncServiceScope scope, string roleName)
    {
        var db = Db(scope);
        var role = await Roles(scope).FindByNameAsync(roleName);

        Assert.NotNull(role);

        var codes = await db.RolePermissions
            .Where(rp => rp.RoleId == role!.Id)
            .Join(db.Permissions, rp => rp.PermissionId, p => p.Id, (_, p) => p.Code)
            .Where(code => Poi.Contains(code))
            .ToListAsync();

        // Sıralama bellekte yapılır: ordinal karşılaştırıcı sorgu diline
        // çevrilemez ve doğrulanan şey sonucun kendisidir.
        return [.. codes.OrderBy(code => code, StringComparer.Ordinal)];
    }

    private static Task SeedAsync(AsyncServiceScope scope) =>
        AuthorizationDataSeeder.SeedAsync(
            Db(scope),
            Roles(scope),
            scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("PoiAuthorizationSeed"));

    private static AsyncServiceScope CreateScope()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
        services.AddDbContext<AppDbContext>(options =>
            options.UseInMemoryDatabase($"poi-catalog-{Guid.NewGuid():N}"));
        services
            .AddIdentityCore<User>(options => options.Password.RequiredLength = 8)
            .AddRoles<IdentityRole<int>>()
            .AddEntityFrameworkStores<AppDbContext>()
            .AddDefaultTokenProviders();

        var scope = services.BuildServiceProvider().CreateAsyncScope();

        /* Legacy roller normalde IdentityDataSeeder tarafından oluşturulur ve
           yetki seed'i onlardan SONRA çalışır; aynı sıra burada da kurulur. */
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

        foreach (var role in ApplicationRoles.Retired)
        {
            roles.CreateAsync(new IdentityRole<int>(role)).GetAwaiter().GetResult();
        }

        return scope;
    }
}
