using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Konum analizi katalog genişlemesi: <c>location.analysis</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Bu faz yalnızca KATALOĞU büyütür.</b> Uç, servis, DTO, tablo ve arayüz
/// yoktur; burada kanıtlanan tek şey, yeni kodun sisteme <i>sıradan kanonik
/// bir yetki olarak</i> girdiği ve mevcut yetkilendirme verisinin bozulmadığıdır.
/// </para>
/// <para>
/// <b>Asıl iddia bir AYRIMDIR.</b> Konum analizi ne <c>inventory.analysis</c>
/// ne de <c>heatmap.view</c> demektir: üçünün verisi de kapsamı da farklıdır.
/// Testlerin ağırlığı bilinçli olarak oradadır — bir gün biri "analiz
/// yetkisi zaten var" diyerek kodu birine bağlarsa buradan düşer.
/// </para>
/// </remarks>
public class LocationAnalysisPermissionCatalogTests
{
    private const string Code = "location.analysis";

    /* Konum analizinin YANINDA duran ama ONU İMA ETMEYEN yetkiler. */
    private static readonly string[] Neighbours =
        [PermissionCodes.InventoryAnalysis, PermissionCodes.HeatmapView];

    /* --- Katalog ---------------------------------------------------------------- */

    [Fact]
    public void The_canonical_code_is_location_analysis()
    {
        /* Kod DEĞİŞTİRİLEMEZ: veritabanındaki permissions.code satırı ve ona
           bağlı tüm grant'lar bu değere göre eşleşir. Sabitin kendisinden
           türetilmeyen literal bir iddia, kodun sessizce yeniden
           adlandırılmasını yakalar. */
        Assert.Equal(Code, PermissionCodes.LocationAnalysis);

        /* Alan-önce/yetenek-sonra: inventory.analysis ile aynı biçim. */
        Assert.EndsWith(".analysis", PermissionCodes.LocationAnalysis, StringComparison.Ordinal);
    }

    [Fact]
    public void The_permission_is_declared_with_the_expected_metadata()
    {
        var definition = Single(PermissionCodes.LocationAnalysis);

        Assert.Equal(Code, definition.Code);
        Assert.Equal("Konum Analizi", definition.Name);
        Assert.Equal(
            "Bir analiz alanı seçip POI kategorilerini ağırlıklandırarak konum analizi çalıştırabilir.",
            definition.Description);
        Assert.Equal(PermissionCategories.Heatmap, definition.Category);
    }

    [Fact]
    public void The_sort_order_renumbers_no_existing_permission()
    {
        var definition = Single(PermissionCodes.LocationAnalysis);

        /* 550 (ısı haritası) ile 600 (katmanlar) arasındaki BOŞLUĞA girer:
           gösterim sırası için tek bir mevcut satır bile güncellenmemiştir. */
        Assert.True(definition.SortOrder > Single(PermissionCodes.HeatmapView).SortOrder);
        Assert.True(definition.SortOrder < Single(PermissionCodes.LayersView).SortOrder);

        // Sıra numaraları katalog genelinde tekildir.
        Assert.Equal(
            PermissionCatalog.All.Count,
            PermissionCatalog.All.Select(p => p.SortOrder).Distinct().Count());
    }

    [Fact]
    public void The_expansion_adds_exactly_one_code()
    {
        /* Ölçülen şey bu fazın BÜYÜKLÜĞÜDÜR: kataloğa tek bir kod eklemiştir,
           ne bir eksik ne bir fazla. Sabit bir toplam yerine bu FARKA bakılır —
           başka fazların katkıları bu iddiayı bozmamalıdır. */
        Assert.Equal(1, PermissionCatalog.AllCodes.Count(code => code == Code));

        Assert.Equal(
            PermissionCatalog.AllCodes.Count - 1,
            PermissionCatalog.AllCodes.Count(code => code != Code));
    }

    [Fact]
    public void The_code_is_unique_within_the_catalog()
    {
        Assert.Equal(
            PermissionCatalog.AllCodes.Count,
            PermissionCatalog.AllCodes.Distinct(StringComparer.Ordinal).Count());

        Assert.Single(PermissionCatalog.All, p => p.Code == PermissionCodes.LocationAnalysis);

        // Takma ad ya da eşdeğer ikinci bir "konum" kodu yoktur.
        Assert.Single(
            PermissionCatalog.AllCodes,
            code => code.Contains("location", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void The_code_carries_no_scope_suffix()
    {
        Assert.False(Code.EndsWith(".own", StringComparison.Ordinal));
        Assert.False(Code.EndsWith(".all", StringComparison.Ordinal));
    }

    /* --- Ayrım: komşu yetkiler --------------------------------------------------- */

    [Fact]
    public void Location_analysis_is_a_capability_of_its_own()
    {
        /* Üç ayrı kod, üç ayrı satır. Biri diğerinin takma adı DEĞİLDİR. */
        Assert.NotEqual(PermissionCodes.InventoryAnalysis, PermissionCodes.LocationAnalysis);
        Assert.NotEqual(PermissionCodes.HeatmapView, PermissionCodes.LocationAnalysis);

        Assert.All(Neighbours, code => Assert.Single(PermissionCatalog.All, p => p.Code == code));

        /* Isı haritasının tek kanonik kodu hâlâ heatmap.view'dur: konum
           analizi aynı GÖSTERİM kategorisinde durur ama "heatmap" adını
           taşımaz ve o yetkinin yerine geçmez. */
        Assert.Single(
            PermissionCatalog.AllCodes,
            code => code.Contains("heatmap", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Neighbouring_permissions_keep_their_own_metadata()
    {
        /* Regresyon kapısı: bu faz mevcut yetkilerin adını, açıklamasını,
           kategorisini ya da sırasını DEĞİŞTİRMEZ. */
        var inventory = Single(PermissionCodes.InventoryAnalysis);
        var heatmap = Single(PermissionCodes.HeatmapView);

        Assert.Equal("Envanter Analizi", inventory.Name);
        Assert.Equal(PermissionCategories.Inventory, inventory.Category);
        Assert.Equal(510, inventory.SortOrder);

        Assert.Equal("Isı Haritası Görüntüleme", heatmap.Name);
        Assert.Equal(PermissionCategories.Heatmap, heatmap.Category);
        Assert.Equal(550, heatmap.SortOrder);
    }

    [Fact]
    public async Task Seeding_writes_the_code_as_an_active_row()
    {
        await using var scope = CreateScope();
        await SeedAsync(scope);

        var stored = await Db(scope).Permissions.SingleAsync(p => p.Code == Code);

        Assert.True(stored.IsActive);
        Assert.Equal(PermissionCategories.Heatmap, stored.Category);
        Assert.Equal("Konum Analizi", stored.Name);
        Assert.False(string.IsNullOrWhiteSpace(stored.Description));
    }

    /* --- Varsayılan rol matrisi ------------------------------------------------- */

    [Fact]
    public void The_default_matrix_grants_location_analysis_to_the_normal_user_profile()
    {
        /* Ödev, NORMAL kullanıcının konum analizi yapabilmesini ister ve Viewer
           o profilin karşılığıdır. Erişim rol ADIYLA değil, bu grant ile
           kurulur. */
        Assert.Contains(Code, RolePermissionDefaults.For(GisRoles.Viewer));

        /* Profiller birbirinin üzerine kurulduğu için operasyonel roller de
           devralır; hiçbiri elle sayılmaz. */
        Assert.Contains(Code, RolePermissionDefaults.For(GisRoles.GisEditor));
        Assert.Contains(Code, RolePermissionDefaults.For(GisRoles.GisAnalyst));
        Assert.Contains(Code, RolePermissionDefaults.For(GisRoles.GisManager));

        /* Amaç-odaklı ulaşım rolleri bu ilgisiz analizi devralmaz. */
        Assert.DoesNotContain(Code, RolePermissionDefaults.For(GisRoles.TransportOperator));
        Assert.DoesNotContain(Code, RolePermissionDefaults.For(GisRoles.TransportUser));
    }

    [Fact]
    public void Viewer_still_holds_neither_inventory_analysis_nor_heatmap_view()
    {
        /* Ayrımın ASIL kanıtı burada: normal kullanıcı konum analizi
           yapabilir ama envanter analizi çalıştıramaz ve ısı haritasını
           göremez. Üçü tek bir "analiz" yeteneğine çökerse bu test düşer. */
        var viewer = RolePermissionDefaults.For(GisRoles.Viewer);

        Assert.DoesNotContain(PermissionCodes.InventoryAnalysis, viewer);
        Assert.DoesNotContain(PermissionCodes.HeatmapView, viewer);
    }

    [Fact]
    public void Administrator_receives_it_through_all_codes_not_a_special_case()
    {
        /* Yönetici yetkilerini elle sayılan bir listeden DEĞİL katalogdan alır.
           İddia bu yüzden "yöneticide vardır" değil, "yöneticinin listesi
           kataloğun kendisidir" biçiminde kurulur — yeni kod için ayrıca bir
           özel durum EKLENMEMİŞTİR. */
        Assert.Equal(
            PermissionCatalog.AllCodes.OrderBy(c => c, StringComparer.Ordinal),
            RolePermissionDefaults.For(GisRoles.Administrator).OrderBy(c => c, StringComparer.Ordinal));

        Assert.Contains(Code, RolePermissionDefaults.For(GisRoles.Administrator));
    }

    [Fact]
    public async Task Seeded_roles_receive_the_expected_grant()
    {
        await using var scope = CreateScope();
        await SeedAsync(scope);

        foreach (var roleName in GisRoles.All)
        {
            Assert.Equal(
                RolePermissionDefaults.For(roleName).Contains(Code),
                await HasGrantAsync(scope, roleName));
        }

        Assert.False(await HasGrantAsync(scope, GisRoles.TransportOperator));
        Assert.False(await HasGrantAsync(scope, GisRoles.TransportUser));
    }

    /* --- Mevcut kurulum genişlemesi --------------------------------------------- */

    [Fact]
    public void The_expansion_distribution_matches_the_default_matrix()
    {
        /* Genişlemenin işi yeni kodu zaten provision edilmiş rollere
           ULAŞTIRMAKTIR — farklı bir profil tanımlamak değil. İki liste
           ayrışırsa taze veritabanı ile mevcut veritabanı sessizce farklı
           davranmaya başlar. */
        foreach (var roleName in GisRoles.All)
        {
            Assert.Equal(
                RolePermissionDefaults.For(roleName).Contains(Code),
                ExpansionCodesOf(roleName).Contains(Code));
        }
    }

    [Fact]
    public void The_expansion_touches_no_role_outside_the_canonical_set()
    {
        Assert.All(
            RolePermissionExpansions.All,
            expansion => Assert.Contains(expansion.RoleName, RoleCatalog.Canonical));
    }

    [Fact]
    public async Task An_already_provisioned_role_still_receives_the_new_code()
    {
        /* Asıl regresyon riski burada: RolePermissionDefaults YALNIZCA hiç
           yetkisi olmayan rolleri doldurur, dolayısıyla mevcut bir kurulumda
           yeni kod hiçbir role ulaşmazdı. Rol önce tek bir grant ile
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

        Assert.True(await HasGrantAsync(scope, GisRoles.Viewer));
    }

    [Fact]
    public async Task The_expansion_does_not_resurrect_an_administrator_revoked_permission()
    {
        /* Genişleme DAR kalmalıdır: yalnızca yeni kodu ekler, rolün tam
           profilini yeniden hesaplamaz. Yöneticinin bilinçli olarak geri
           aldığı ESKİ bir yetki, bu faz yüzünden geri gelmemelidir. */
        await using var scope = CreateScope();
        await SeedAsync(scope);

        var db = Db(scope);
        var viewer = await Roles(scope).FindByNameAsync(GisRoles.Viewer);
        var drawingsView = await db.Permissions.SingleAsync(p => p.Code == PermissionCodes.DrawingsView);

        db.RolePermissions.Remove(await db.RolePermissions
            .SingleAsync(rp => rp.RoleId == viewer!.Id && rp.PermissionId == drawingsView.Id));
        await db.SaveChangesAsync();

        await SeedAsync(scope);

        // Geri alınan yetki geri GELMEZ; yeni kod ise yerinde kalır.
        Assert.False(await HasGrantAsync(scope, GisRoles.Viewer, PermissionCodes.DrawingsView));
        Assert.True(await HasGrantAsync(scope, GisRoles.Viewer));
    }

    [Fact]
    public async Task Reseeding_creates_no_duplicate_grants()
    {
        await using var scope = CreateScope();

        await SeedAsync(scope);
        await SeedAsync(scope);

        var db = Db(scope);
        var permissionId = await db.Permissions.Where(p => p.Code == Code).Select(p => p.Id).SingleAsync();

        var pairs = await db.RolePermissions
            .Where(rp => rp.PermissionId == permissionId)
            .Select(rp => rp.RoleId)
            .ToListAsync();

        Assert.Equal(pairs.Count, pairs.Distinct().Count());
    }

    [Fact]
    public async Task Retired_role_names_receive_no_location_analysis_grant()
    {
        await using var scope = CreateScope();
        await SeedAsync(scope);

        Assert.False(await HasGrantAsync(scope, ApplicationRoles.Admin));
        Assert.False(await HasGrantAsync(scope, ApplicationRoles.User));
    }

    /* --- Doğrudan kullanıcı yetkisi ----------------------------------------------
       Motorun kendisi kod-agnostiktir ve EffectivePermissionServiceTests
       tarafından kapsamlıca ölçülür (doğrudan grant, rol ∪ doğrudan birleşimi,
       rolsüz hesap, pasif satır). Burada tekrarlanan tek şey, YENİ kodun o
       motordan geçtiğidir — ve özellikle rol ADINDAN bağımsız olduğudur. */

    [Fact]
    public async Task A_direct_grant_makes_location_analysis_effective_without_any_role()
    {
        await using var scope = CreateScope();
        await SeedAsync(scope);

        var user = await CreateUserAsync(scope, "konum-analizi-direct");

        var db = Db(scope);
        var permission = await db.Permissions.SingleAsync(p => p.Code == Code);
        db.UserPermissions.Add(new UserPermission { UserId = user.Id, PermissionId = permission.Id });
        await db.SaveChangesAsync();

        var service = scope.ServiceProvider.GetRequiredService<IEffectivePermissionService>();

        /* Kullanıcının HİÇ rolü yoktur: erişim tamamen doğrudan grant'tan
           gelir, hiçbir rol adı okunmaz. */
        Assert.Empty(await Users(scope).GetRolesAsync(user));
        Assert.True(await service.HasPermissionAsync(user.Id, PermissionCodes.LocationAnalysis));
        Assert.Equal([Code], await service.GetEffectivePermissionCodesAsync(user.Id));
    }

    /* --- Yardımcılar ------------------------------------------------------------ */

    private static PermissionCatalog.Definition Single(string code) =>
        Assert.Single(PermissionCatalog.All, p => p.Code == code);

    private static string[] ExpansionCodesOf(string roleName) =>
    [
        .. RolePermissionExpansions.All
            .Where(e => e.RoleName == roleName)
            .SelectMany(e => e.PermissionCodes)
            .Distinct(StringComparer.Ordinal)
    ];

    private static AppDbContext Db(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<AppDbContext>();

    private static RoleManager<IdentityRole<int>> Roles(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

    private static UserManager<User> Users(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<UserManager<User>>();

    private static async Task<User> CreateUserAsync(AsyncServiceScope scope, string userName)
    {
        var user = new User
        {
            UserName = userName,
            Email = $"{userName}@example.invalid",
            EmailConfirmed = true,
            AccountStatus = AccountStatus.Active,
            IsActive = true,
            IsDeleted = false
        };

        Assert.True((await Users(scope).CreateAsync(user, "Str0ng!Password")).Succeeded);

        return user;
    }

    private static async Task<bool> HasGrantAsync(
        AsyncServiceScope scope,
        string roleName,
        string? permissionCode = null)
    {
        var code = permissionCode ?? Code;
        var db = Db(scope);
        var role = await Roles(scope).FindByNameAsync(roleName);

        Assert.NotNull(role);

        return await db.RolePermissions
            .Where(rp => rp.RoleId == role!.Id)
            .Join(db.Permissions, rp => rp.PermissionId, p => p.Id, (_, p) => p.Code)
            .AnyAsync(stored => stored == code);
    }

    private static Task SeedAsync(AsyncServiceScope scope) =>
        AuthorizationDataSeeder.SeedAsync(
            Db(scope),
            Roles(scope),
            scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("LocationAnalysisSeed"));

    private static AsyncServiceScope CreateScope()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
        services.AddDbContext<AppDbContext>(options =>
            options.UseInMemoryDatabase($"location-analysis-catalog-{Guid.NewGuid():N}"));
        services
            .AddIdentityCore<User>(options =>
            {
                options.Password.RequiredLength = 8;
                options.User.RequireUniqueEmail = true;
            })
            .AddRoles<IdentityRole<int>>()
            .AddEntityFrameworkStores<AppDbContext>()
            .AddDefaultTokenProviders();

        services.AddScoped<IEffectivePermissionService, EffectivePermissionService>();

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
