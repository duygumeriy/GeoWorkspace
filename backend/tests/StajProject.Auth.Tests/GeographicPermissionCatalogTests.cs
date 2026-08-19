using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
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
/// Coğrafi yetkilendirme katalog genişlemesi (Phase 8-P):
/// <c>geography.view</c> ve <c>geography.manage</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Bu faz yalnızca KATALOĞU büyütür.</b> Poligon saklama, coğrafi kapsam
/// tablosu ve çizim kısıtlaması yoktur; burada kanıtlanan tek şey, iki yeni
/// kodun sisteme <i>sıradan kanonik yetkiler olarak</i> girdiğidir.
/// </para>
/// <para>
/// <b>Asıl risk genişleme değil, yan etkisidir.</b> Kataloğa yeni bir yetki
/// eklemek, seed'in mevcut yetkilendirme verisine dokunmasına yol açabilirdi:
/// geri alınmış eski yetkilerin geri gelmesi, elle verilmiş grant'ların
/// silinmesi, doğrudan kullanıcı yetkilerinin normalize edilmesi. Testlerin
/// ağırlığı bilinçli olarak oradadır.
/// </para>
/// </remarks>
public class GeographicPermissionCatalogTests
{
    private static readonly string[] Geography =
        [PermissionCodes.GeographyView, PermissionCodes.GeographyManage];

    /* Rol yetkisi düzenleme ucunun "kapı" yetkileri. Hangi yetkinin
       DAĞITILABİLECEĞİ ayrı bir sorudur — testlerin konusu odur. */
    private static readonly string[] Gate = [PermissionCodes.RolesUpdate, PermissionCodes.PermissionsAssign];

    /* Doğrudan kullanıcı yetkisi ucunun kapı yetkileri. */
    private static readonly string[] UserGate = [PermissionCodes.UsersUpdate, PermissionCodes.PermissionsAssign];

    /* --- 1-6: katalog ----------------------------------------------------------------- */

    [Fact]
    public void Geography_permissions_are_declared_with_the_expected_metadata()
    {
        var view = Single(PermissionCodes.GeographyView);
        var manage = Single(PermissionCodes.GeographyManage);

        Assert.Equal("geography.view", view.Code);
        Assert.Equal("Coğrafi Yetkileri Görüntüleme", view.Name);
        Assert.Equal(
            "Kullanıcı ve rol bazlı coğrafi yetki alanlarını görüntüleme yetkisi.",
            view.Description);
        Assert.Equal(PermissionCategories.Geography, view.Category);

        Assert.Equal("geography.manage", manage.Code);
        Assert.Equal("Coğrafi Yetkileri Yönetme", manage.Name);
        Assert.Equal(
            "Kullanıcı ve rol bazlı coğrafi yetki alanlarını oluşturma, düzenleme ve kaldırma yetkisi.",
            manage.Description);
        Assert.Equal(PermissionCategories.Geography, manage.Category);
    }

    [Fact]
    public void Geography_permissions_share_a_category_of_their_own()
    {
        /* Coğrafi yetki, users/roles kategorilerine SOKULMAZ. Coğrafi alan
           tanımlamak bir kullanıcı alanını düzenlemek değil, o kullanıcının
           nerede veri üretebileceğini belirlemektir; users.update altına
           gizlenmesi, kullanıcı düzenleme yetkisinin sessizce coğrafi sınırı da
           kaldırabilmesi demek olurdu. */
        Assert.Equal(
            Geography.OrderBy(c => c, StringComparer.Ordinal),
            PermissionCatalog.All
                .Where(p => p.Category == PermissionCategories.Geography)
                .Select(p => p.Code)
                .OrderBy(c => c, StringComparer.Ordinal));
    }

    [Fact]
    public void View_sorts_before_manage()
    {
        // Görüntüleme → yönetme sırası kategori içinde diğer kategorilerdeki
        // (layers.view → layers.manage) düzenle aynıdır.
        Assert.True(Single(PermissionCodes.GeographyView).SortOrder
            < Single(PermissionCodes.GeographyManage).SortOrder);
    }

    [Fact]
    public void Geography_codes_are_unique_within_the_catalog()
    {
        Assert.Equal(
            PermissionCatalog.AllCodes.Count,
            PermissionCatalog.AllCodes.Distinct(StringComparer.Ordinal).Count());

        Assert.All(Geography, code =>
            Assert.Single(PermissionCatalog.All, p => p.Code == code));
    }

    [Fact]
    public void The_expansion_adds_exactly_two_codes()
    {
        /* Ölçülen şey coğrafya genişlemesinin BÜYÜKLÜĞÜDÜR: kataloğa iki kod
           eklemiştir, ne bir eksik ne bir fazla. Toplam sayı yerine bu FARKA
           bakılır — Phase 9'un eklediği activity.view gibi başka fazların
           katkıları bu iddiayı bozmamalıdır. */
        Assert.Equal(2, PermissionCatalog.AllCodes.Count(code => Geography.Contains(code)));

        // Katalog coğrafya dışında da büyümüştür; iddia "sadece bu ikisi
        // coğrafyadır" biçiminde kurulur, sabit bir toplamla değil.
        Assert.Equal(
            PermissionCatalog.AllCodes.Count - 2,
            PermissionCatalog.AllCodes.Count(code => !Geography.Contains(code)));
    }

    [Fact]
    public async Task Seeding_writes_both_codes_as_active_rows()
    {
        await using var scope = await CreateScopeAsync();

        var stored = await Db(scope).Permissions
            .Where(p => Geography.Contains(p.Code))
            .ToListAsync();

        Assert.Equal(2, stored.Count);
        Assert.All(stored, p =>
        {
            Assert.True(p.IsActive);
            Assert.Equal(PermissionCategories.Geography, p.Category);
            Assert.NotEmpty(p.Name);
            Assert.False(string.IsNullOrWhiteSpace(p.Description));
        });
    }

    /* --- 7-14: varsayılan grant politikası -------------------------------------------- */

    [Theory]
    [InlineData(GisRoles.Administrator)]
    [InlineData(ApplicationRoles.Admin)]
    public async Task Privileged_roles_receive_both_geography_permissions(string roleName)
    {
        await using var scope = await CreateScopeAsync();

        var codes = await CodesOfAsync(scope, roleName);

        Assert.Contains(PermissionCodes.GeographyView, codes);
        Assert.Contains(PermissionCodes.GeographyManage, codes);
    }

    [Theory]
    [InlineData(GisRoles.Viewer)]
    [InlineData(GisRoles.GisEditor)]
    [InlineData(GisRoles.GisAnalyst)]
    [InlineData(GisRoles.GisManager)]
    [InlineData(ApplicationRoles.User)]
    public async Task Other_built_in_roles_receive_neither_geography_permission(string roleName)
    {
        await using var scope = await CreateScopeAsync();

        var codes = await CodesOfAsync(scope, roleName);

        /* Coğrafi yetki alanı tanımlamak, başkalarının nerede veri
           üretebileceğine karar vermektir: operasyonel bir yetenek değil,
           yönetimsel bir yetkidir. İsteyen yönetici Rol Yetki Düzenleyicisi'nden
           verebilir; seed kendiliğinden dağıtmaz. */
        Assert.DoesNotContain(PermissionCodes.GeographyView, codes);
        Assert.DoesNotContain(PermissionCodes.GeographyManage, codes);
    }

    [Fact]
    public async Task A_custom_role_is_left_untouched_by_the_expansion()
    {
        await using var scope = await CreateScopeAsync();

        var custom = (await Roles(scope).CreateRoleAsync(new CreateRoleRequest { Name = "Saha Ekibi" })).Value!;
        await SeedGrantsAsync(scope, custom.Id, [PermissionCodes.MapView, PermissionCodes.DrawingsView]);

        await SeedAsync(scope);

        Assert.Equal(
            Sorted(PermissionCodes.MapView, PermissionCodes.DrawingsView),
            await CodesOfAsync(scope, custom.Id));
    }

    /* --- 15-18: seed güvenliği -------------------------------------------------------- */

    [Fact]
    public async Task Seeding_twice_adds_nothing_the_second_time()
    {
        await using var scope = await CreateScopeAsync();

        var permissions = await Db(scope).Permissions.CountAsync();
        var grants = await Db(scope).RolePermissions.CountAsync();

        await SeedAsync(scope);
        await SeedAsync(scope);

        var db = Db(scope);

        Assert.Equal(permissions, await db.Permissions.CountAsync());
        Assert.Equal(grants, await db.RolePermissions.CountAsync());

        // Sayı korunmuş ama kimlikler çoğalmış olabilir; benzersizlik ayrıca
        // doğrulanır.
        var codes = await db.Permissions.Select(p => p.Code).ToListAsync();
        Assert.Equal(codes.Count, codes.Distinct(StringComparer.Ordinal).Count());

        var pairs = await db.RolePermissions.Select(rp => new { rp.RoleId, rp.PermissionId }).ToListAsync();
        Assert.Equal(pairs.Count, pairs.Distinct().Count());
    }

    [Fact]
    public async Task The_expansion_reaches_a_role_that_was_already_provisioned()
    {
        /* Asıl senaryo budur: gerçek kurulumda Administrator'ın zaten yetkileri
           vardır, dolayısıyla ilk-provision yolu onu ATLAR. Katalog genişlemesi
           olmasaydı yeni kodlar mevcut kurulumlara hiç ulaşmazdı. */
        await using var scope = await CreateScopeAsync();

        var administratorId = await RoleIdAsync(scope, GisRoles.Administrator);
        await RevokeGrantsAsync(scope, administratorId, Geography);

        Assert.DoesNotContain(PermissionCodes.GeographyView, await CodesOfAsync(scope, administratorId));

        await SeedAsync(scope);

        Assert.Contains(PermissionCodes.GeographyView, await CodesOfAsync(scope, administratorId));
        Assert.Contains(PermissionCodes.GeographyManage, await CodesOfAsync(scope, administratorId));
    }

    [Fact]
    public async Task The_expansion_does_not_resurrect_an_unrelated_revoked_permission()
    {
        await using var scope = await CreateScopeAsync();

        var administratorId = await RoleIdAsync(scope, GisRoles.Administrator);
        await RevokeGrantsAsync(scope, administratorId, [PermissionCodes.UsersDelete]);

        var viewerId = await RoleIdAsync(scope, GisRoles.Viewer);
        await RevokeGrantsAsync(scope, viewerId, [PermissionCodes.LayersView]);

        await SeedAsync(scope);

        /* Genişleme YALNIZCA yeni tanıtılan kodlara bakar. Rolün tam profilini
           yeniden hesaplasaydı, yöneticinin bilinçle geri aldığı yetkiler bir
           katalog eklemesi yüzünden sessizce geri gelirdi. */
        Assert.DoesNotContain(PermissionCodes.UsersDelete, await CodesOfAsync(scope, administratorId));
        Assert.DoesNotContain(PermissionCodes.LayersView, await CodesOfAsync(scope, viewerId));
    }

    [Fact]
    public async Task A_manually_added_role_permission_survives_the_expansion()
    {
        await using var scope = await CreateScopeAsync();

        // Gerçek veritabanındaki durumun aynısı: GIS Analyst'e elle eklenmiş,
        // varsayılan matriste olmayan bir yetki.
        var analystId = await RoleIdAsync(scope, GisRoles.GisAnalyst);
        await SeedGrantsAsync(scope, analystId, [PermissionCodes.LayersManage]);

        await SeedAsync(scope);

        var codes = await CodesOfAsync(scope, analystId);

        Assert.Contains(PermissionCodes.LayersManage, codes);
        Assert.DoesNotContain(PermissionCodes.GeographyManage, codes);
    }

    [Fact]
    public async Task An_existing_direct_user_permission_survives_the_expansion()
    {
        await using var scope = await CreateScopeAsync();

        var user = await CreateUserAsync(scope, "direct-holder", GisRoles.Viewer);
        await GrantDirectAsync(scope, user, PermissionCodes.RolesView);

        await SeedAsync(scope);

        var db = Db(scope);
        var rows = await db.UserPermissions
            .Where(up => up.UserId == user.Id)
            .Join(db.Permissions, up => up.PermissionId, p => p.Id, (_, p) => p.Code)
            .ToListAsync();

        // Seed doğrudan yetkilere HİÇ dokunmaz: ne siler, ne normalize eder,
        // ne de yenisini dağıtır.
        Assert.Equal([PermissionCodes.RolesView], rows);
    }

    /* --- 19-20: rol grant otoritesi --------------------------------------------------- */

    [Fact]
    public async Task An_actor_without_geography_manage_cannot_grant_it_to_a_role()
    {
        await using var scope = await CreateScopeAsync();

        var actor = await CreateActorAsync(scope, "weak-granter", Gate);
        var targetId = await RoleIdAsync(scope, GisRoles.Viewer);
        var before = await CodesOfAsync(scope, targetId);

        var result = await ReplaceRoleAsync(
            scope, actor.Id, targetId,
            [.. RolePermissionDefaults.For(GisRoles.Viewer), PermissionCodes.GeographyManage]);

        /* Yeni kodlar için ÖZEL bir kural yazılmadı: mevcut
           "yeni eklenenler ⊆ çağıranın etkin yetkileri" kuralı onları
           kendiliğinden kapsar. Kanıtı budur. */
        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
        Assert.Equal(before, await CodesOfAsync(scope, targetId));
    }

    [Fact]
    public async Task An_actor_holding_geography_manage_can_grant_it_to_a_role()
    {
        await using var scope = await CreateScopeAsync();

        var actor = await CreateActorAsync(scope, "strong-granter", [.. Gate, PermissionCodes.GeographyManage]);
        var targetId = await RoleIdAsync(scope, GisRoles.GisManager);

        var result = await ReplaceRoleAsync(
            scope, actor.Id, targetId,
            [.. RolePermissionDefaults.For(GisRoles.GisManager), PermissionCodes.GeographyManage]);

        Assert.True(result.IsSuccess);
        Assert.Contains(PermissionCodes.GeographyManage, await CodesOfAsync(scope, targetId));
    }

    /* --- 21-22: doğrudan kullanıcı yetkisi -------------------------------------------- */

    [Fact]
    public async Task The_user_permission_catalog_lists_both_geography_codes()
    {
        await using var scope = await CreateScopeAsync();

        var actor = await CreateActorAsync(scope, "reader", UserGate);
        var target = await CreateUserAsync(scope, "read-target", GisRoles.Viewer);

        var result = await UserPermissions(scope).GetUserPermissionsAsync(actor.Id, target.Id);

        Assert.True(result.IsSuccess);

        var rows = result.Value!.Permissions.Where(p => Geography.Contains(p.Code)).ToArray();

        Assert.Equal(2, rows.Length);
        Assert.All(rows, row =>
        {
            Assert.Equal(PermissionCategories.Geography, row.Category);
            Assert.True(row.IsActive);
            // Viewer coğrafi yetki almaz: ne kalıtım var, ne doğrudan atama.
            Assert.Empty(row.InheritedFromRoles);
            Assert.False(row.DirectAssigned);
            Assert.False(row.Effective);
            // Aktör kendisi taşımıyor, dolayısıyla veremez.
            Assert.False(row.CanAssignDirect);
        });
    }

    [Fact]
    public async Task An_actor_without_geography_manage_cannot_grant_it_directly()
    {
        await using var scope = await CreateScopeAsync();

        var actor = await CreateActorAsync(scope, "weak-direct", UserGate);
        var target = await CreateUserAsync(scope, "weak-direct-target", GisRoles.Viewer);

        var result = await ReplaceUserAsync(scope, actor.Id, target.Id, [PermissionCodes.GeographyManage]);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
        Assert.Empty(await Db(scope).UserPermissions.Where(up => up.UserId == target.Id).ToListAsync());
    }

    [Fact]
    public async Task An_actor_holding_geography_manage_can_grant_it_directly()
    {
        await using var scope = await CreateScopeAsync();

        var actor = await CreateActorAsync(scope, "strong-direct", [.. UserGate, PermissionCodes.GeographyManage]);
        var target = await CreateUserAsync(scope, "strong-direct-target", GisRoles.Viewer);

        var result = await ReplaceUserAsync(scope, actor.Id, target.Id, [PermissionCodes.GeographyManage]);

        Assert.True(result.IsSuccess);

        var row = result.Value!.Permissions.Single(p => p.Code == PermissionCodes.GeographyManage);

        // Doğrudan atama KAYNAK olarak görünür ve etkindir; kalıtım iddia
        // edilmez.
        Assert.True(row.DirectAssigned);
        Assert.True(row.Effective);
        Assert.Empty(row.InheritedFromRoles);
    }

    [Fact]
    public void No_geography_special_case_exists_in_the_authorization_services()
    {
        /* Yeni kodlar SIRADAN kanonik yetkilerdir. Servislerin kaynağında
           "geography" geçmesi, genel yolun yetmediği ve bir istisna yazıldığı
           anlamına gelirdi — bu fazın açıkça kaçındığı şey odur. */
        foreach (var file in AuthorizationServiceSources())
        {
            Assert.DoesNotContain("geography", File.ReadAllText(file), StringComparison.OrdinalIgnoreCase);
        }
    }

    /* --- Yardımcılar ------------------------------------------------------------------ */

    private static PermissionCatalog.Definition Single(string code) =>
        PermissionCatalog.All.Single(p => p.Code == code);

    private static string[] Sorted(params string[] codes) =>
        [.. codes.OrderBy(c => c, StringComparer.Ordinal)];

    private static AppDbContext Db(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<AppDbContext>();

    private static IRoleManagementService Roles(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<IRoleManagementService>();

    private static IUserPermissionManagementService UserPermissions(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<IUserPermissionManagementService>();

    private static RoleManager<IdentityRole<int>> RoleManager(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

    private static Task<ServiceResult<RolePermissionsResponse>> ReplaceRoleAsync(
        AsyncServiceScope scope, int actingUserId, int roleId, string[] codes) =>
        Roles(scope).ReplaceRolePermissionsAsync(
            actingUserId, roleId, new UpdateRolePermissionsRequest { PermissionCodes = [.. codes] });

    private static Task<ServiceResult<UserPermissionsResponse>> ReplaceUserAsync(
        AsyncServiceScope scope, int actingUserId, int targetUserId, string[] codes) =>
        UserPermissions(scope).ReplaceUserPermissionsAsync(
            actingUserId, targetUserId, new UpdateUserPermissionsRequest { PermissionCodes = [.. codes] });

    private static async Task<int> RoleIdAsync(AsyncServiceScope scope, string name)
    {
        var role = await RoleManager(scope).FindByNameAsync(name);
        Assert.NotNull(role);
        return role!.Id;
    }

    private static Task<string[]> CodesOfAsync(AsyncServiceScope scope, string roleName) =>
        RoleIdAsync(scope, roleName).ContinueWith(t => CodesOfAsync(scope, t.Result)).Unwrap();

    private static async Task<string[]> CodesOfAsync(AsyncServiceScope scope, int roleId)
    {
        var db = Db(scope);

        var codes = await db.RolePermissions
            .AsNoTracking()
            .Where(rp => rp.RoleId == roleId)
            .Join(db.Permissions, rp => rp.PermissionId, p => p.Id, (_, p) => p.Code)
            .ToListAsync();

        // Sıralama bilinçli olarak bellekte: ordinal karşılaştırıcı sorgu
        // diline çevrilemez.
        return [.. codes.OrderBy(c => c, StringComparer.Ordinal)];
    }

    private static async Task<User> CreateActorAsync(AsyncServiceScope scope, string userName, string[] codes)
    {
        var roleName = $"Role-{userName}";
        var created = (await Roles(scope).CreateRoleAsync(new CreateRoleRequest { Name = roleName })).Value!;

        // Kurgu doğrudan veritabanına yazılır: zayıf aktörü kurmak için tam da
        // sınanan bariyerden geçmek gerekmemelidir.
        await SeedGrantsAsync(scope, created.Id, codes);

        return await CreateUserAsync(scope, userName, roleName);
    }

    private static async Task SeedGrantsAsync(AsyncServiceScope scope, int roleId, string[] codes)
    {
        var db = Db(scope);

        var ids = await db.Permissions.Where(p => codes.Contains(p.Code)).Select(p => p.Id).ToListAsync();
        Assert.Equal(codes.Distinct(StringComparer.Ordinal).Count(), ids.Count);

        db.RolePermissions.AddRange(ids.Select(id => new RolePermission { RoleId = roleId, PermissionId = id }));
        await db.SaveChangesAsync();
    }

    private static async Task RevokeGrantsAsync(AsyncServiceScope scope, int roleId, string[] codes)
    {
        var db = Db(scope);

        var ids = await db.Permissions.Where(p => codes.Contains(p.Code)).Select(p => p.Id).ToListAsync();

        db.RolePermissions.RemoveRange(
            await db.RolePermissions.Where(rp => rp.RoleId == roleId && ids.Contains(rp.PermissionId)).ToListAsync());

        await db.SaveChangesAsync();
    }

    private static async Task GrantDirectAsync(AsyncServiceScope scope, User user, string code)
    {
        var db = Db(scope);
        var permission = await db.Permissions.SingleAsync(p => p.Code == code);

        db.UserPermissions.Add(new UserPermission { UserId = user.Id, PermissionId = permission.Id });
        await db.SaveChangesAsync();
    }

    private static async Task<User> CreateUserAsync(AsyncServiceScope scope, string userName, string role)
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
        Assert.True((await users.AddToRoleAsync(user, role)).Succeeded);
        return user;
    }

    private static Task SeedAsync(AsyncServiceScope scope) =>
        AuthorizationDataSeeder.SeedAsync(
            Db(scope),
            RoleManager(scope),
            scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("authz-seed"));

    /// <summary>
    /// Yetkilendirme kararı veren servislerin kaynak dosyaları. Yol, derlenen
    /// test dosyasının konumundan türetilir; çalışma dizinine bağlı değildir.
    /// </summary>
    private static string[] AuthorizationServiceSources()
    {
        var services = Path.GetFullPath(Path.Combine(
            Path.GetDirectoryName(SourceFile())!,
            "..", "..", "src", "StajProject.Infrastructure", "Services"));

        string[] files =
        [
            Path.Combine(services, "EffectivePermissionService.cs"),
            Path.Combine(services, "RoleManagementService.cs"),
            Path.Combine(services, "UserPermissionManagementService.cs")
        ];

        Assert.All(files, file => Assert.True(File.Exists(file), $"Kaynak bulunamadı: {file}"));
        return files;
    }

    private static string SourceFile([System.Runtime.CompilerServices.CallerFilePath] string path = "") => path;

    private static async Task<AsyncServiceScope> CreateScopeAsync()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
        services.AddDbContext<AppDbContext>(o => o
            .UseInMemoryDatabase($"geography-catalog-{Guid.NewGuid():N}")
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)));

        services.AddIdentityCore<User>(o => o.Password.RequiredLength = 8)
            .AddRoles<IdentityRole<int>>()
            .AddEntityFrameworkStores<AppDbContext>()
            .AddDefaultTokenProviders();

        services.AddScoped<IEffectivePermissionService, EffectivePermissionService>();
        services.AddScoped<IRoleManagementService, RoleManagementService>();
        services.AddScoped<IUserPermissionManagementService, UserPermissionManagementService>();
        services.AddSingleton(Substitute.For<ILogger<RoleManagementService>>());
        services.AddSingleton(Substitute.For<ILogger<UserPermissionManagementService>>());

        var scope = services.BuildServiceProvider().CreateAsyncScope();

        /* Legacy roller normalde IdentityDataSeeder tarafından oluşturulur ve
           yetki seed'i onlardan SONRA çalışır; aynı sıra burada da kurulur. */
        foreach (var role in ApplicationRoles.All)
        {
            await RoleManager(scope).CreateAsync(new IdentityRole<int>(role));
        }

        await SeedAsync(scope);

        return scope;
    }
}
