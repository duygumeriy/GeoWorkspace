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
/// Dinamik yetkilendirme temeli: yetki kataloğu, hedef roller, rol yetki
/// matrisi ve seed'in tekrar çalıştırılabilirliği.
/// </summary>
/// <remarks>
/// Testler gerçek <see cref="AuthorizationDataSeeder"/>, gerçek
/// <see cref="RoleManager{TRole}"/> ve gerçek <see cref="AppDbContext"/> ile
/// çalışır; yalnızca veritabanı in-memory'dir. Böylece doğrulanan şey "seeder
/// hangi metodu çağırdı" değil, <b>veritabanının gerçekten hangi hâle geldiğidir</b>.
/// </remarks>
public class AuthorizationFoundationTests
{
    /* --- Yetki kataloğu -------------------------------------------------------- */

    [Fact]
    public void Permission_catalog_contains_the_expected_codes()
    {
        string[] expected =
        [
            "map.view",

            "drawings.point.create",
            "drawings.line.create",
            "drawings.polygon.create",

            "drawings.view",
            "drawings.metadata.update",
            "drawings.geometry.update",
            "drawings.style.update",
            "drawings.delete",
            "drawings.restore",

            "measurement.use",
            "selection.use",

            "inventory.view",
            "inventory.analysis",

            "heatmap.view",

            "location.analysis",

            "layers.view",
            "layers.manage",

            "users.view",
            "users.create",
            "users.update",
            "users.deactivate",
            "users.delete",

            "roles.view",
            "roles.create",
            "roles.update",
            "roles.delete",

            "permissions.view",
            "permissions.assign",

            "geography.view",
            "geography.manage",

            "activity.view",

            "poi.view",
            "poi.create",
            /* Phase 3: düzenleme ve silme, oluşturmadan AYRI kanonik
               kodlardır ve yalnızca KENDİ kayıtlarında yetki verir; sahiplik
               sınırı kodun değil servis katmanının işidir. */
            "poi.update",
            "poi.delete",
            "poi.manage",
            "poi.categories.manage"
        ];

        /* Beklenen liste kasıtlı olarak literal yazılır: katalog sabitlerinden
           türetilseydi, kodun kendisi yanlışlıkla değiştiğinde test de onunla
           birlikte kayar ve hiçbir şey doğrulamamış olurdu. SÖZLEŞMEYİ ÇİVİLEYEN
           şey bu listedir.

           Toplam sayı artık literal DEĞİL, listeden okunur: aynı gerçeği iki
           yerde (listede ve bir sayıda) tutmak, katalog her büyüdüğünde iki
           ayrı yerin güncellenmesini gerektiriyordu ve testin adı bile eski
           büyüklüğü taşıyordu. Liste zaten hem içeriği hem büyüklüğü sabitler. */
        Assert.Equal(expected.Length, PermissionCatalog.All.Count);
        Assert.Equal(expected.OrderBy(c => c, StringComparer.Ordinal),
            PermissionCatalog.AllCodes.OrderBy(c => c, StringComparer.Ordinal));
    }

    /// <summary>
    /// Isı haritası kendi katalog satırıdır ve envanter analizinden AYRIDIR.
    /// </summary>
    /// <remarks>
    /// Tek bir kanonik kod olduğunu da sabitler: takma ad ya da eşdeğer ikinci
    /// bir kod eklenirse bu test düşer.
    /// </remarks>
    [Fact]
    public void Heatmap_is_a_capability_of_its_own()
    {
        var heatmap = Assert.Single(
            PermissionCatalog.All,
            p => p.Code == PermissionCodes.HeatmapView);

        Assert.Equal("heatmap.view", heatmap.Code);
        Assert.Equal("Isı Haritası Görüntüleme", heatmap.Name);
        Assert.NotEqual(PermissionCodes.InventoryAnalysis, heatmap.Code);

        // Isı haritasına atıfta bulunan başka bir kod yoktur.
        Assert.Single(
            PermissionCatalog.AllCodes,
            code => code.Contains("heatmap", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Permission_codes_are_unique()
    {
        Assert.Equal(
            PermissionCatalog.AllCodes.Count,
            PermissionCatalog.AllCodes.Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void Permission_codes_carry_no_scope_suffix()
    {
        // Kapsam (OWN / ALL) koda gömülmez; ayrı bir eksen olarak sonraki fazda
        // ele alınır. drawings.view.own gibi bir kod bu ayrımı sessizce bozardı.
        Assert.DoesNotContain(
            PermissionCatalog.AllCodes,
            code => code.EndsWith(".own", StringComparison.Ordinal)
                || code.EndsWith(".all", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Seeding_writes_every_catalog_permission_to_the_database()
    {
        await using var scope = CreateScope();

        await SeedAsync(scope);

        var stored = await Db(scope).Permissions.ToListAsync();

        /* Değişmez, bir SAYI değil bir KÜME eşitliğidir: "katalogdaki her kod
           yazılır ve katalogda olmayan hiçbir kod yazılmaz". Sabit bir toplam,
           katalog her büyüdüğünde güncellenmesi gereken ikinci bir gerçek
           olurdu ve iki kodun yanlışlıkla takas edilmesini de yakalamazdı. */
        var storedCodes = stored.Select(p => p.Code).ToHashSet(StringComparer.Ordinal);

        Assert.True(storedCodes.SetEquals(PermissionCatalog.AllCodes));
        // Aynı kod iki satır olarak yazılmamıştır.
        Assert.Equal(PermissionCatalog.All.Count, stored.Count);
        Assert.All(stored, p =>
        {
            Assert.True(p.IsActive);
            Assert.NotEmpty(p.Name);
            Assert.NotEmpty(p.Category);
        });
    }

    /* --- Roller ---------------------------------------------------------------- */

    [Fact]
    public async Task Target_gis_roles_are_seeded()
    {
        await using var scope = CreateScope();

        await SeedAsync(scope);

        var roles = await Roles(scope).Roles.Select(r => r.Name).ToListAsync();

        Assert.Contains(GisRoles.Viewer, roles);
        Assert.Contains(GisRoles.GisEditor, roles);
        Assert.Contains(GisRoles.GisAnalyst, roles);
        Assert.Contains(GisRoles.GisManager, roles);
        Assert.Contains(GisRoles.Administrator, roles);
    }

    [Fact]
    public async Task Legacy_roles_are_preserved()
    {
        await using var scope = CreateScope();

        await SeedAsync(scope);

        var roles = await Roles(scope).Roles.Select(r => r.Name).ToListAsync();

        // Seeder does not delete rows; the explicit hard-retirement migration owns deletion.
        Assert.Contains(ApplicationRoles.Admin, roles);
        Assert.Contains(ApplicationRoles.User, roles);
    }

    [Fact]
    public async Task Retired_names_are_tombstones_not_assignable_roles()
    {
        await using var scope = CreateScope();

        await SeedAsync(scope);

        Assert.Equal(new[] { ApplicationRoles.Admin, ApplicationRoles.User }, ApplicationRoles.Retired);
    }

    /* --- Rol yetki matrisi ----------------------------------------------------- */

    [Fact]
    public async Task Viewer_has_the_expected_permissions()
    {
        await using var scope = CreateScope();
        await SeedAsync(scope);

        Assert.Equal(
            Sorted(
                "map.view",
                "drawings.view",
                "measurement.use",
                "selection.use",
                "inventory.view",
                "layers.view",
                "poi.view",
                /* Konum analizi Viewer profilindedir: ödev normal kullanıcının
                   konum analizi yapabilmesini açıkça ister. inventory.analysis
                   ve heatmap.view hâlâ YOKTUR — üçü ayrı yeteneklerdir. */
                "location.analysis"),
            await PermissionCodesOfAsync(scope, GisRoles.Viewer));
    }

    [Fact]
    public async Task Gis_editor_has_the_expected_permissions()
    {
        await using var scope = CreateScope();
        await SeedAsync(scope);

        var codes = await PermissionCodesOfAsync(scope, GisRoles.GisEditor);

        Assert.Equal(
            Sorted(
                "map.view",
                "drawings.view",
                "measurement.use",
                "selection.use",
                "inventory.view",
                "layers.view",

                "drawings.point.create",
                "drawings.line.create",
                "drawings.polygon.create",

                "drawings.metadata.update",
                "drawings.geometry.update",
                "drawings.style.update",

                "drawings.delete",
                "drawings.restore",

                "poi.view",
                "poi.create",
                /* Düzenleme ve silme, oluşturmanın doğal tamamlayıcısıdır:
                   kendi eklediği noktanın adını düzeltemeyen bir veri
                   üreticisi envanteri yalnızca büyütebilir. İkisi de YALNIZCA
                   kendi kayıtlarında geçerlidir. */
                "poi.update",
                "poi.delete",

                // Viewer profilinden devralınır; çizim yetkilerinden bağımsızdır.
                "location.analysis"),
            codes);

        // Varsayılan olarak verilmeyenler açıkça doğrulanır: bir "hepsini ver"
        // regresyonu, yalnızca beklenenleri saymakla yakalanmayabilir.
        Assert.DoesNotContain("inventory.analysis", codes);
        Assert.DoesNotContain("heatmap.view", codes);
        Assert.DoesNotContain("layers.manage", codes);

        /* POI envanteri ve kategori taksonomisi yönetimi Editor profilinde YOK:
           POI üretebilmek, herkesin kaydını listeleyebilmek ya da
           sınıflandırmayı tanımlayabilmek demek değildir. Bu, poi.update /
           poi.delete eklendikten sonra daha da önemlidir — o iki kod sahiplikle
           SINIRLIDIR, poi.manage ise herkesin kaydını açar. */
        Assert.DoesNotContain("poi.manage", codes);
        Assert.DoesNotContain("poi.categories.manage", codes);
        Assert.DoesNotContain(codes, c => c.StartsWith("users.", StringComparison.Ordinal));
        Assert.DoesNotContain(codes, c => c.StartsWith("roles.", StringComparison.Ordinal));
        Assert.DoesNotContain(codes, c => c.StartsWith("permissions.", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Gis_analyst_has_the_expected_permissions()
    {
        await using var scope = CreateScope();
        await SeedAsync(scope);

        var codes = await PermissionCodesOfAsync(scope, GisRoles.GisAnalyst);

        Assert.Equal(
            Sorted(
                "map.view",
                "drawings.view",
                "measurement.use",
                "selection.use",
                "inventory.view",
                "inventory.analysis",
                "heatmap.view",
                "layers.view",
                "poi.view",
                "location.analysis"),
            codes);

        // Analist operasyonel çizim verisini düzenlemez.
        Assert.DoesNotContain(codes, c => c.EndsWith(".create", StringComparison.Ordinal));
        Assert.DoesNotContain(codes, c => c.EndsWith(".update", StringComparison.Ordinal));
        Assert.DoesNotContain("drawings.delete", codes);
    }

    [Fact]
    public async Task Gis_manager_has_the_expected_permissions()
    {
        await using var scope = CreateScope();
        await SeedAsync(scope);

        var codes = await PermissionCodesOfAsync(scope, GisRoles.GisManager);

        Assert.Equal(
            Sorted(
                "map.view",

                "drawings.point.create",
                "drawings.line.create",
                "drawings.polygon.create",

                "drawings.view",
                "drawings.metadata.update",
                "drawings.geometry.update",
                "drawings.style.update",
                "drawings.delete",
                "drawings.restore",

                "measurement.use",
                "selection.use",

                "inventory.view",
                "inventory.analysis",
                "heatmap.view",

                "layers.view",
                "layers.manage",

                "poi.view",
                "poi.create",
                "poi.update",
                "poi.delete",
                "poi.manage",
                "poi.categories.manage",

                "location.analysis"),
            codes);

        // Sistem yönetimi yetkileri GIS Manager'a varsayılan olarak verilmez.
        Assert.DoesNotContain(codes, c => c.StartsWith("users.", StringComparison.Ordinal));
        Assert.DoesNotContain(codes, c => c.StartsWith("roles.", StringComparison.Ordinal));
        Assert.DoesNotContain(codes, c => c.StartsWith("permissions.", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Administrator_has_all_permissions()
    {
        await using var scope = CreateScope();
        await SeedAsync(scope);

        Assert.Equal(
            PermissionCatalog.AllCodes.OrderBy(c => c, StringComparer.Ordinal),
            await PermissionCodesOfAsync(scope, GisRoles.Administrator));
    }

    /* --- Retired roles are not provisioned ------------------------------------ */

    [Fact]
    public async Task Retired_Admin_receives_no_seeded_permissions()
    {
        await using var scope = CreateScope();
        await SeedAsync(scope);

        Assert.Empty(await PermissionCodesOfAsync(scope, ApplicationRoles.Admin));
    }

    [Fact]
    public async Task Retired_User_receives_no_seeded_permissions()
    {
        await using var scope = CreateScope();
        await SeedAsync(scope);

        Assert.Empty(await PermissionCodesOfAsync(scope, ApplicationRoles.User));
    }

    /* --- Idempotency ----------------------------------------------------------- */

    [Fact]
    public async Task Seeding_twice_creates_no_duplicates()
    {
        await using var scope = CreateScope();

        await SeedAsync(scope);

        var permissionsAfterFirst = await Db(scope).Permissions.CountAsync();
        var rolesAfterFirst = await Roles(scope).Roles.CountAsync();
        var grantsAfterFirst = await Db(scope).RolePermissions.CountAsync();

        await SeedAsync(scope);
        await SeedAsync(scope);

        var db = Db(scope);

        Assert.Equal(permissionsAfterFirst, await db.Permissions.CountAsync());
        Assert.Equal(rolesAfterFirst, await Roles(scope).Roles.CountAsync());
        Assert.Equal(grantsAfterFirst, await db.RolePermissions.CountAsync());

        // Sayı korunmuş olabilir ama kimlikler kaymış olabilir: kod başına tek
        // satır ve rol-yetki çifti başına tek bağ olduğu ayrıca doğrulanır.
        var codes = await db.Permissions.Select(p => p.Code).ToListAsync();
        Assert.Equal(codes.Count, codes.Distinct(StringComparer.Ordinal).Count());

        var pairs = await db.RolePermissions.Select(rp => new { rp.RoleId, rp.PermissionId }).ToListAsync();
        Assert.Equal(pairs.Count, pairs.Distinct().Count());
    }

    [Fact]
    public async Task Reseeding_does_not_restore_a_revoked_role_permission()
    {
        await using var scope = CreateScope();
        await SeedAsync(scope);

        var db = Db(scope);
        var viewer = await Roles(scope).FindByNameAsync(GisRoles.Viewer);
        var layersView = await db.Permissions.SingleAsync(p => p.Code == PermissionCodes.LayersView);

        db.RolePermissions.Remove(
            await db.RolePermissions.SingleAsync(rp => rp.RoleId == viewer!.Id && rp.PermissionId == layersView.Id));
        await db.SaveChangesAsync();

        await SeedAsync(scope);

        /* Seed başlangıç değeri verir, kural dayatmaz. Yöneticinin bilinçli
           olarak geri aldığı bir yetkiyi her yeniden başlatmada geri getirmek,
           yetki yönetimini anlamsız kılardı. */
        Assert.DoesNotContain(PermissionCodes.LayersView, await PermissionCodesOfAsync(scope, GisRoles.Viewer));
    }

    /* --- Grant benzersizliği ---------------------------------------------------- */

    [Fact]
    public void Role_permission_is_keyed_by_role_and_permission()
    {
        using var scope = CreateScope();

        var key = Db(scope).Model.FindEntityType(typeof(RolePermission))!.FindPrimaryKey()!;

        Assert.Equal(
            new[] { nameof(RolePermission.PermissionId), nameof(RolePermission.RoleId) },
            key.Properties.Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal));
    }

    [Fact]
    public void User_permission_is_keyed_by_user_and_permission()
    {
        using var scope = CreateScope();

        var key = Db(scope).Model.FindEntityType(typeof(UserPermission))!.FindPrimaryKey()!;

        Assert.Equal(
            new[] { nameof(UserPermission.PermissionId), nameof(UserPermission.UserId) },
            key.Properties.Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal));
    }

    [Fact]
    public void Permission_code_is_backed_by_a_unique_index()
    {
        using var scope = CreateScope();

        var index = Db(scope).Model
            .FindEntityType(typeof(Permission))!
            .GetIndexes()
            .Single(i => i.Properties.Count == 1 && i.Properties[0].Name == nameof(Permission.Code));

        Assert.True(index.IsUnique);
    }

    [Fact]
    public async Task A_user_permission_cannot_be_granted_twice()
    {
        await using var scope = CreateScope();
        await SeedAsync(scope);

        var db = Db(scope);
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();

        var user = new User { UserName = "grant-target", Email = "grant-target@example.invalid" };
        Assert.True((await users.CreateAsync(user, "Str0ng!Password")).Succeeded);

        var permission = await db.Permissions.SingleAsync(p => p.Code == PermissionCodes.InventoryAnalysis);

        db.UserPermissions.Add(new UserPermission { UserId = user.Id, PermissionId = permission.Id });
        await db.SaveChangesAsync();

        /* Aynı çift bileşik birincil anahtarı ihlal eder; ikinci kayıt kabul
           edilemez. Ekleme ve kaydetme birlikte sarmalanır: reddin hangi
           katmanda gerçekleştiği (change tracker mı, veritabanı kısıtı mı)
           sağlayıcıya göre değişir — doğrulanan şey, çiftin hiçbir yoldan iki
           kez var olamamasıdır. */
        await Assert.ThrowsAnyAsync<Exception>(async () =>
        {
            db.UserPermissions.Add(new UserPermission { UserId = user.Id, PermissionId = permission.Id });
            await db.SaveChangesAsync();
        });

        Assert.Equal(1, await db.UserPermissions.CountAsync(up => up.UserId == user.Id));
    }

    [Fact]
    public async Task Seeding_grants_no_direct_user_permissions()
    {
        await using var scope = CreateScope();

        await SeedAsync(scope);

        // Doğrudan kullanıcı yetkisi bir istisnadır ve elle verilir; seed
        // kimseye kişisel yetki dağıtmaz.
        Assert.Empty(await Db(scope).UserPermissions.ToListAsync());
    }

    /* --- Yardımcılar ----------------------------------------------------------- */

    private static AppDbContext Db(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<AppDbContext>();

    private static RoleManager<IdentityRole<int>> Roles(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

    private static string[] Sorted(params string[] codes) =>
        codes.OrderBy(c => c, StringComparer.Ordinal).ToArray();

    private static async Task<string[]> PermissionCodesOfAsync(AsyncServiceScope scope, string roleName)
    {
        var db = Db(scope);
        var role = await Roles(scope).FindByNameAsync(roleName);

        Assert.NotNull(role);

        var codes = await db.RolePermissions
            .Where(rp => rp.RoleId == role!.Id)
            .Join(db.Permissions, rp => rp.PermissionId, p => p.Id, (_, p) => p.Code)
            .ToListAsync();

        // Sıralama bilinçli olarak bellekte yapılır: ordinal karşılaştırıcı
        // sorgu diline çevrilemez ve testin karşılaştırdığı şey zaten sonucun
        // kendisidir, veritabanının sıralama davranışı değil.
        return [.. codes.OrderBy(code => code, StringComparer.Ordinal)];
    }

    private static Task SeedAsync(AsyncServiceScope scope) =>
        AuthorizationDataSeeder.SeedAsync(
            Db(scope),
            Roles(scope),
            scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("AuthorizationSeed"));

    private static AsyncServiceScope CreateScope()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        // AddDefaultTokenProviders() bunu ister; testler kalıcı bir anahtar
        // deposuna bağlanmasın diye ephemeral olanı kullanılır.
        services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
        services.AddDbContext<AppDbContext>(options =>
            options.UseInMemoryDatabase($"authz-foundation-{Guid.NewGuid():N}"));
        services
            .AddIdentityCore<User>(options => options.Password.RequiredLength = 8)
            .AddRoles<IdentityRole<int>>()
            .AddEntityFrameworkStores<AppDbContext>()
            .AddDefaultTokenProviders();

        var scope = services.BuildServiceProvider().CreateAsyncScope();

        /* Legacy roller normalde IdentityDataSeeder tarafından oluşturulur ve
           yetki seed'i onlardan SONRA çalışır. Geçiş dönemi davranışının
           doğrulanabilmesi için aynı sıra burada da kurulur. */
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

        foreach (var role in ApplicationRoles.Retired)
        {
            roles.CreateAsync(new IdentityRole<int>(role)).GetAwaiter().GetResult();
        }

        return scope;
    }
}
