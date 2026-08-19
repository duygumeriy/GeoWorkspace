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
/// Etkin yetki motoru: rol yetkileri ∪ doğrudan yetkiler.
/// </summary>
/// <remarks>
/// Gerçek <see cref="EffectivePermissionService"/>, gerçek
/// <see cref="UserManager{TUser}"/>/<see cref="RoleManager{TRole}"/> ve gerçek
/// <see cref="AppDbContext"/> kullanılır; yalnızca veritabanı in-memory'dir.
/// Doğrulanan şey servisin hangi metodu çağırdığı değil, <b>gerçekten hangi
/// yetkileri döndürdüğüdür</b>.
/// </remarks>
public class EffectivePermissionServiceTests
{
    /* --- Rol yetkileri --------------------------------------------------------- */

    [Fact]
    public async Task Effective_permissions_include_role_permissions()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "editor", GisRoles.GisEditor);

        var codes = await Service(scope).GetEffectivePermissionCodesAsync(user.Id);

        // GIS Editor matristeki 14 yetkiye sahiptir.
        Assert.Equal(14, codes.Count);
        Assert.Contains(PermissionCodes.DrawingsPointCreate, codes);
        Assert.Contains(PermissionCodes.MapView, codes);
        Assert.DoesNotContain(PermissionCodes.UsersDelete, codes);
    }

    [Fact]
    public async Task Multiple_role_memberships_are_unioned()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "multi", GisRoles.Viewer);

        // Motor "tek primary role" iş kuralına yaslanmaz; gerçek user_roles
        // üyeliklerini okur. İş kuralı bu fazda DEĞİŞMİYOR, motor ona bağımlı
        // olmuyor sadece.
        await AddToRoleAsync(scope, user, GisRoles.GisAnalyst);

        var codes = await Service(scope).GetEffectivePermissionCodesAsync(user.Id);

        // Viewer(6) ∪ GIS Analyst(7) = 7; ortak altı yetki tekrarlanmaz.
        Assert.Equal(7, codes.Count);
        Assert.Contains(PermissionCodes.InventoryAnalysis, codes);
    }

    /* --- Doğrudan yetkiler ----------------------------------------------------- */

    [Fact]
    public async Task Effective_permissions_include_direct_user_permissions()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "direct", GisRoles.Viewer);

        await GrantDirectAsync(scope, user, PermissionCodes.InventoryAnalysis);

        var codes = await Service(scope).GetEffectivePermissionCodesAsync(user.Id);

        Assert.Contains(PermissionCodes.InventoryAnalysis, codes);
    }

    [Fact]
    public async Task Effective_permissions_union_role_and_direct_permissions()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "union", GisRoles.GisEditor);

        await GrantDirectAsync(scope, user, PermissionCodes.InventoryAnalysis);

        var codes = await Service(scope).GetEffectivePermissionCodesAsync(user.Id);

        // GIS Editor'ün 14 yetkisi + rolde olmayan 1 doğrudan yetki = 15.
        // Doğrudan yetki rolü değiştirmeden erişimi genişletir.
        Assert.Equal(15, codes.Count);
        Assert.Contains(PermissionCodes.DrawingsPointCreate, codes);
        Assert.Contains(PermissionCodes.InventoryAnalysis, codes);
    }

    [Fact]
    public async Task Duplicate_role_and_direct_grant_appears_once()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "duplicate", GisRoles.Viewer);

        // map.view zaten Viewer rolünden geliyor; aynısı doğrudan da veriliyor.
        // İleride UI bunu engelleyecek olsa da motor böyle bir veriye karşı
        // kendi başına dayanıklı olmalıdır.
        await GrantDirectAsync(scope, user, PermissionCodes.MapView);

        var codes = await Service(scope).GetEffectivePermissionCodesAsync(user.Id);

        Assert.Single(codes, code => code == PermissionCodes.MapView);
        Assert.Equal(6, codes.Count);
        Assert.Equal(codes.Count, codes.Distinct(StringComparer.Ordinal).Count());
    }

    /* --- Pasif yetkiler -------------------------------------------------------- */

    [Fact]
    public async Task Inactive_role_permission_is_excluded()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "inactive-role-perm", GisRoles.GisEditor);

        await DeactivatePermissionAsync(scope, PermissionCodes.DrawingsDelete);

        var service = Service(scope);

        // İlişki satırı (role_permissions) hâlâ duruyor; elenmesinin sebebi
        // tanımın pasifleştirilmiş olması.
        Assert.DoesNotContain(PermissionCodes.DrawingsDelete,
            await service.GetEffectivePermissionCodesAsync(user.Id));
        Assert.False(await service.HasPermissionAsync(user.Id, PermissionCodes.DrawingsDelete));
        Assert.Equal(13, (await service.GetEffectivePermissionCodesAsync(user.Id)).Count);
    }

    [Fact]
    public async Task Inactive_direct_permission_is_excluded()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "inactive-direct-perm", GisRoles.Viewer);

        await GrantDirectAsync(scope, user, PermissionCodes.DrawingsDelete);
        await DeactivatePermissionAsync(scope, PermissionCodes.DrawingsDelete);

        var service = Service(scope);

        // Aktiflik filtresi her iki kolda da uygulanır, yalnızca rol kolunda değil.
        Assert.DoesNotContain(PermissionCodes.DrawingsDelete,
            await service.GetEffectivePermissionCodesAsync(user.Id));
        Assert.False(await service.HasPermissionAsync(user.Id, PermissionCodes.DrawingsDelete));
    }

    /* --- HasPermission --------------------------------------------------------- */

    [Fact]
    public async Task Has_permission_returns_true_for_a_role_grant()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "role-grant", GisRoles.GisEditor);

        Assert.True(await Service(scope).HasPermissionAsync(user.Id, PermissionCodes.DrawingsPointCreate));
    }

    [Fact]
    public async Task Has_permission_returns_true_for_a_direct_grant()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "direct-grant", GisRoles.GisAnalyst);

        await GrantDirectAsync(scope, user, PermissionCodes.DrawingsPointCreate);

        Assert.True(await Service(scope).HasPermissionAsync(user.Id, PermissionCodes.DrawingsPointCreate));
    }

    [Fact]
    public async Task Has_permission_returns_false_for_a_missing_grant()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "missing-grant", GisRoles.GisEditor);

        Assert.False(await Service(scope).HasPermissionAsync(user.Id, PermissionCodes.UsersDelete));
    }

    [Fact]
    public async Task Has_permission_returns_false_for_an_unknown_permission_code()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "unknown-code", GisRoles.Administrator);

        // Katalogda olmayan kod istisna değil, false üretir — yönetici bile olsa.
        Assert.False(await Service(scope).HasPermissionAsync(user.Id, "does.not.exist"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Has_permission_returns_false_for_a_blank_permission_code(string? code)
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, $"blank-{code?.Length ?? -1}", GisRoles.Administrator);

        Assert.False(await Service(scope).HasPermissionAsync(user.Id, code));
    }

    /* --- Rol adı kestirmesi olmadığının kanıtı --------------------------------- */

    [Fact]
    public async Task Administrator_permissions_come_from_rows_not_from_the_role_name()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "admin-rows", GisRoles.Administrator);

        var service = Service(scope);
        Assert.Equal(30, (await service.GetEffectivePermissionCodesAsync(user.Id)).Count);

        // Tek bir grant satırı kaldırılınca yetki GERÇEKTEN kaybolur. Kodda bir
        // süper kullanıcı kestirmesi olsaydı bu assert geçmezdi.
        await RevokeRoleGrantAsync(scope, GisRoles.Administrator, PermissionCodes.UsersDelete);

        Assert.False(await service.HasPermissionAsync(user.Id, PermissionCodes.UsersDelete));
        Assert.Equal(29, (await service.GetEffectivePermissionCodesAsync(user.Id)).Count);
    }

    [Fact]
    public async Task Legacy_admin_permissions_come_from_rows_not_from_the_role_name()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "legacy-admin-rows", ApplicationRoles.Admin);

        var service = Service(scope);
        Assert.Equal(30, (await service.GetEffectivePermissionCodesAsync(user.Id)).Count);

        await RevokeRoleGrantAsync(scope, ApplicationRoles.Admin, PermissionCodes.UsersDelete);

        Assert.False(await service.HasPermissionAsync(user.Id, PermissionCodes.UsersDelete));
    }

    /* --- Hesap yaşam döngüsü --------------------------------------------------- */

    [Theory]
    [InlineData(AccountStatus.PendingEmailVerification)]
    [InlineData(AccountStatus.PendingApproval)]
    [InlineData(AccountStatus.Suspended)]
    [InlineData(AccountStatus.Rejected)]
    public async Task A_user_outside_the_active_status_has_no_effective_permissions(AccountStatus status)
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, $"status-{status}", GisRoles.Administrator);

        await SetAccountStateAsync(scope, user, status: status);

        var service = Service(scope);

        /* Rolü ve grant satırları hâlâ yerinde; erişimi kesen şey hesabın
           durumu. "Aktif JWT ile gezerken yönetici askıya alır → sonraki yetki
           kontrolü reddeder" senaryosu bu davranışa dayanır. */
        Assert.Empty(await service.GetEffectivePermissionCodesAsync(user.Id));
        Assert.False(await service.HasPermissionAsync(user.Id, PermissionCodes.MapView));
    }

    [Fact]
    public async Task An_inactive_user_has_no_effective_permissions()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "deactivated", GisRoles.GisManager);

        await SetAccountStateAsync(scope, user, isActive: false);

        var service = Service(scope);
        Assert.Empty(await service.GetEffectivePermissionCodesAsync(user.Id));
        Assert.False(await service.HasPermissionAsync(user.Id, PermissionCodes.MapView));
    }

    [Fact]
    public async Task A_deleted_user_has_no_effective_permissions()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "soft-deleted", GisRoles.GisManager);

        await SetAccountStateAsync(scope, user, isDeleted: true);

        var service = Service(scope);
        Assert.Empty(await service.GetEffectivePermissionCodesAsync(user.Id));
        Assert.False(await service.HasPermissionAsync(user.Id, PermissionCodes.MapView));
    }

    [Fact]
    public async Task A_missing_user_has_no_effective_permissions()
    {
        await using var scope = await CreateScopeAsync();

        var service = Service(scope);

        // Var olmayan kimlik istisna üretmez; güvenli cevap "hiçbir yetki".
        Assert.Empty(await service.GetEffectivePermissionCodesAsync(987654));
        Assert.False(await service.HasPermissionAsync(987654, PermissionCodes.MapView));
    }

    /* --- Rolsüz hesaplar ------------------------------------------------------- */

    [Fact]
    public async Task A_user_without_a_role_and_without_direct_grants_has_no_permissions()
    {
        await using var scope = await CreateScopeAsync();

        // Kayıt akışının ürettiği hâl: onay bekliyor, rolü yok.
        var user = await CreateUserAsync(scope, "fresh-registration", role: null,
            status: AccountStatus.PendingApproval, isActive: false);

        var service = Service(scope);
        Assert.Empty(await service.GetEffectivePermissionCodesAsync(user.Id));
        Assert.False(await service.HasPermissionAsync(user.Id, PermissionCodes.MapView));
    }

    [Fact]
    public async Task An_active_user_without_a_role_still_resolves_direct_grants()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "roleless-active", role: null);

        await GrantDirectAsync(scope, user, PermissionCodes.MapView);

        /* Motor gizli bir "rolü olmalı" şartı UYDURMAZ: hesap uygunsa doğrudan
           grant normal şekilde çözülür. Mevcut mimaride aktif+rolsüz hesap
           zaten geçici bir durumdur (IdentityDataSeeder açılışta bu hesapları
           User rolüne taşır), ama bu bir yetkilendirme kuralı değil, seed
           davranışıdır ve buraya kopyalanmaz. */
        var codes = await Service(scope).GetEffectivePermissionCodesAsync(user.Id);

        Assert.Equal([PermissionCodes.MapView], codes);
        Assert.True(await Service(scope).HasPermissionAsync(user.Id, PermissionCodes.MapView));
    }

    /* --- Yardımcılar ----------------------------------------------------------- */

    private static AppDbContext Db(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<AppDbContext>();

    private static IEffectivePermissionService Service(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<IEffectivePermissionService>();

    private static async Task<User> CreateUserAsync(
        AsyncServiceScope scope,
        string userName,
        string? role,
        AccountStatus status = AccountStatus.Active,
        bool isActive = true)
    {
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();

        var user = new User
        {
            UserName = userName,
            Email = $"{userName}@example.invalid",
            EmailConfirmed = true,
            AccountStatus = status,
            IsActive = isActive,
            IsDeleted = false
        };

        Assert.True((await users.CreateAsync(user, "Str0ng!Password")).Succeeded);

        if (role is not null)
        {
            Assert.True((await users.AddToRoleAsync(user, role)).Succeeded);
        }

        return user;
    }

    private static async Task AddToRoleAsync(AsyncServiceScope scope, User user, string role)
    {
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        Assert.True((await users.AddToRoleAsync(user, role)).Succeeded);
    }

    private static async Task SetAccountStateAsync(
        AsyncServiceScope scope,
        User user,
        AccountStatus? status = null,
        bool? isActive = null,
        bool? isDeleted = null)
    {
        var db = Db(scope);
        var tracked = await db.Users.SingleAsync(u => u.Id == user.Id);

        if (status is not null)
        {
            tracked.AccountStatus = status.Value;
        }

        if (isActive is not null)
        {
            tracked.IsActive = isActive.Value;
        }

        if (isDeleted is not null)
        {
            tracked.IsDeleted = isDeleted.Value;
        }

        await db.SaveChangesAsync();
    }

    private static async Task GrantDirectAsync(AsyncServiceScope scope, User user, string permissionCode)
    {
        var db = Db(scope);
        var permission = await db.Permissions.SingleAsync(p => p.Code == permissionCode);

        db.UserPermissions.Add(new UserPermission { UserId = user.Id, PermissionId = permission.Id });
        await db.SaveChangesAsync();
    }

    private static async Task DeactivatePermissionAsync(AsyncServiceScope scope, string permissionCode)
    {
        var db = Db(scope);
        var permission = await db.Permissions.SingleAsync(p => p.Code == permissionCode);

        permission.IsActive = false;
        await db.SaveChangesAsync();
    }

    private static async Task RevokeRoleGrantAsync(AsyncServiceScope scope, string roleName, string permissionCode)
    {
        var db = Db(scope);
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

        var role = await roles.FindByNameAsync(roleName);
        var permission = await db.Permissions.SingleAsync(p => p.Code == permissionCode);

        db.RolePermissions.Remove(
            await db.RolePermissions.SingleAsync(rp => rp.RoleId == role!.Id && rp.PermissionId == permission.Id));

        await db.SaveChangesAsync();
    }

    private static async Task<AsyncServiceScope> CreateScopeAsync()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
        services.AddDbContext<AppDbContext>(options =>
            options.UseInMemoryDatabase($"effective-permissions-{Guid.NewGuid():N}"));
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

        /* Gerçek startup sırası: önce legacy roller, sonra yetki kataloğu ve
           hedef roller. Testler kendi yetki matrisini uydurmaz — üretimde
           çalışan seeder'ın ürettiği veriyle çalışır. */
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

        foreach (var role in ApplicationRoles.All)
        {
            await roles.CreateAsync(new IdentityRole<int>(role));
        }

        await AuthorizationDataSeeder.SeedAsync(
            Db(scope),
            roles,
            scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("AuthorizationSeed"));

        return scope;
    }
}
