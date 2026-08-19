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
using StajProject.Application.Options;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Onay ve rol değiştirme akışlarının dinamik rol modeline geçişi.
/// </summary>
/// <remarks>
/// Bu fazın en hassas noktası şudur: legacy <c>Admin</c>/<c>User</c> rolleri
/// YENİ atamalara kapanır, ama bu rollere sahip MEVCUT kullanıcılar hiçbir
/// şekilde etkilenmez. "Tanınan rol" ile "yeni atanabilir rol" ayrı
/// kavramlardır ve testler ikisini de doğrular.
/// </remarks>
public class AssignableRoleTransitionTests
{
    private const int ApproverId = 1;

    /* --- Onay: hedef ve özel roller --------------------------------------------- */

    [Theory]
    [InlineData(GisRoles.Viewer)]
    [InlineData(GisRoles.GisEditor)]
    [InlineData(GisRoles.GisAnalyst)]
    [InlineData(GisRoles.GisManager)]
    [InlineData(GisRoles.Administrator)]
    public async Task A_pending_user_can_be_approved_into_any_target_role(string role)
    {
        await using var scope = await CreateScopeAsync();
        var management = Management(scope);
        var user = await CreatePendingUserAsync(scope, $"pending-{role.Replace(" ", "")}");

        var result = await management.ApproveAsync(user.Id, new ApproveUserRequest { Role = role }, ApproverId);

        Assert.True(result.IsSuccess);
        Assert.Equal(role, result.Value!.Role);
        Assert.Equal([role], await RolesOfAsync(scope, user));

        var reloaded = await ReloadAsync(scope, user);
        Assert.Equal(AccountStatus.Active, reloaded.AccountStatus);
        Assert.True(reloaded.IsActive);
    }

    [Fact]
    public async Task A_pending_user_can_be_approved_into_a_custom_role()
    {
        await using var scope = await CreateScopeAsync();
        var created = await Roles(scope).CreateRoleAsync(new CreateRoleRequest { Name = "Field Surveyor" });
        Assert.True(created.IsSuccess);

        var user = await CreatePendingUserAsync(scope, "pending-custom");

        var result = await Management(scope).ApproveAsync(
            user.Id, new ApproveUserRequest { Role = "Field Surveyor" }, ApproverId);

        Assert.True(result.IsSuccess);
        Assert.Equal(["Field Surveyor"], await RolesOfAsync(scope, user));
    }

    [Theory]
    [InlineData(ApplicationRoles.Admin)]
    [InlineData(ApplicationRoles.User)]
    public async Task A_pending_user_cannot_be_approved_into_a_legacy_role(string role)
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreatePendingUserAsync(scope, $"pending-legacy-{role}");

        var result = await Management(scope).ApproveAsync(user.Id, new ApproveUserRequest { Role = role }, ApproverId);

        Assert.False(result.IsSuccess);

        /* Reddedilen onay hesabı hiç değiştirmez: ne rol verilir ne de
           aktifleştirilir. */
        Assert.Empty(await RolesOfAsync(scope, user));
        var reloaded = await ReloadAsync(scope, user);
        Assert.Equal(AccountStatus.PendingApproval, reloaded.AccountStatus);
        Assert.False(reloaded.IsActive);
    }

    /* --- Rol değiştirme ----------------------------------------------------------- */

    [Fact]
    public async Task An_active_user_can_be_moved_to_a_target_role()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateActiveUserAsync(scope, "mover", GisRoles.Viewer);

        var result = await Management(scope).ChangeRoleAsync(
            user.Id, new UpdateUserRoleRequest { Role = GisRoles.GisEditor }, ApproverId);

        Assert.True(result.IsSuccess);

        /* Tek primary role kuralı korunur: eski rol kaldırılır. Eskiden yalnızca
           Admin/User süzüldüğü için Viewer -> GIS Editor geçişinde kullanıcı iki
           rolde birden kalırdı. */
        Assert.Equal([GisRoles.GisEditor], await RolesOfAsync(scope, user));
    }

    [Fact]
    public async Task An_active_user_can_be_moved_to_a_custom_role()
    {
        await using var scope = await CreateScopeAsync();
        await Roles(scope).CreateRoleAsync(new CreateRoleRequest { Name = "Field Surveyor" });
        var user = await CreateActiveUserAsync(scope, "to-custom", GisRoles.Viewer);

        var result = await Management(scope).ChangeRoleAsync(
            user.Id, new UpdateUserRoleRequest { Role = "field surveyor" }, ApproverId);

        Assert.True(result.IsSuccess);
        // Kanonik yazım atanır, istekteki serbest yazım değil.
        Assert.Equal(["Field Surveyor"], await RolesOfAsync(scope, user));
    }

    [Theory]
    [InlineData(ApplicationRoles.Admin)]
    [InlineData(ApplicationRoles.User)]
    public async Task An_active_user_cannot_be_moved_into_a_legacy_role(string role)
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateActiveUserAsync(scope, $"no-legacy-{role}", GisRoles.Viewer);

        var result = await Management(scope).ChangeRoleAsync(
            user.Id, new UpdateUserRoleRequest { Role = role }, ApproverId);

        Assert.False(result.IsSuccess);
        Assert.Equal([GisRoles.Viewer], await RolesOfAsync(scope, user));
    }

    /* --- Mevcut legacy kullanıcılar bozulmaz -------------------------------------- */

    [Theory]
    [InlineData(ApplicationRoles.Admin)]
    [InlineData(ApplicationRoles.User)]
    public async Task An_existing_legacy_user_stays_valid_and_keeps_its_permissions(string role)
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateActiveUserAsync(scope, $"legacy-{role}", role);

        /* Rolün yeni atamalara kapalı olması, o role SAHİP kullanıcıyı
           geçersiz kılmaz. Yetkileri Phase 1'deki eşitliğe göre aynen durur. */
        var codes = await Effective(scope).GetEffectivePermissionCodesAsync(user.Id);

        Assert.Equal(role == ApplicationRoles.Admin ? 30 : 14, codes.Count);
        Assert.Equal([role], await RolesOfAsync(scope, user));

        // Yönetim listesinde de rolü doğru görünür.
        var detail = await Management(scope).GetUserAsync(user.Id);
        Assert.True(detail.IsSuccess);
        Assert.Equal(role, detail.Value!.Role);
    }

    [Fact]
    public async Task A_user_holding_a_target_role_is_reported_with_that_role()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateActiveUserAsync(scope, "viewer-user", GisRoles.Viewer);

        /* Rol çözümlemesi sabit ApplicationRoles.All listesine bakmayı bıraktı;
           aksi hâlde Viewer kullanıcısı yönetim ekranında "rolsüz" görünürdü. */
        var detail = await Management(scope).GetUserAsync(user.Id);

        Assert.True(detail.IsSuccess);
        Assert.Equal(GisRoles.Viewer, detail.Value!.Role);
    }

    /* --- Atanabilir rol listesi ---------------------------------------------------- */

    [Fact]
    public async Task The_approval_role_list_offers_target_and_custom_roles_but_not_legacy_ones()
    {
        await using var scope = await CreateScopeAsync();
        await Roles(scope).CreateRoleAsync(new CreateRoleRequest { Name = "Field Surveyor" });

        /* Tam yetkili çağıran: ölçülen şey GENEL atanabilirlik filtresidir,
           çağırana özel daraltma değil. */
        var actor = await CreateActiveUserAsync(scope, "offer-reader", GisRoles.Administrator);

        var offered = (await Management(scope).GetAssignableRolesAsync(actor.Id)).Select(r => r.Name).ToArray();

        Assert.Equal(
            [
                GisRoles.Viewer, GisRoles.GisEditor, GisRoles.GisAnalyst,
                GisRoles.GisManager, GisRoles.Administrator, "Field Surveyor"
            ],
            offered);

        Assert.DoesNotContain(ApplicationRoles.Admin, offered);
        Assert.DoesNotContain(ApplicationRoles.User, offered);
    }

    [Fact]
    public async Task Every_offered_role_is_actually_acceptable_by_the_server()
    {
        await using var scope = await CreateScopeAsync();
        await Roles(scope).CreateRoleAsync(new CreateRoleRequest { Name = "Field Surveyor" });

        // Tam yetkili çağıran: liste ile kabul kümesi arasındaki fark ölçülüyor,
        // yetki yükseltme kuralı değil.
        var actor = await CreateActiveUserAsync(scope, "full-admin", GisRoles.Administrator);

        /* İstemcinin gördüğü liste ile sunucunun kabul ettiği küme aynı yerden
           türer; ekranda görünüp reddedilen bir rol oluşamaz. */
        foreach (var offered in await Management(scope).GetAssignableRolesAsync(actor.Id))
        {
            Assert.True((await Roles(scope).ResolveAssignableRoleAsync(offered.Name, actor.Id)).IsSuccess, offered.Name);
        }
    }

    /* --- Yardımcılar ---------------------------------------------------------------- */

    private static AppDbContext Db(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<AppDbContext>();

    private static IRoleManagementService Roles(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<IRoleManagementService>();

    private static IEffectivePermissionService Effective(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<IEffectivePermissionService>();

    private static IUserManagementService Management(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<IUserManagementService>();

    private static async Task<User> CreatePendingUserAsync(AsyncServiceScope scope, string userName)
    {
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();

        var user = new User
        {
            UserName = userName,
            Email = $"{userName}@example.invalid",
            EmailConfirmed = true,
            AccountStatus = AccountStatus.PendingApproval,
            IsActive = false
        };

        Assert.True((await users.CreateAsync(user, "Str0ng!Password")).Succeeded);
        return user;
    }

    private static async Task<User> CreateActiveUserAsync(AsyncServiceScope scope, string userName, string role)
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

        // Son aktif Admin koruması testlerin konusu değil; ayrı bir Admin durur.
        return user;
    }

    private static async Task<string[]> RolesOfAsync(AsyncServiceScope scope, User user)
    {
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        return [.. await users.GetRolesAsync((await users.FindByIdAsync(user.Id.ToString()))!)];
    }

    private static async Task<User> ReloadAsync(AsyncServiceScope scope, User user) =>
        await Db(scope).Users.AsNoTracking().SingleAsync(u => u.Id == user.Id);

    private static async Task<AsyncServiceScope> CreateScopeAsync()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
        services.AddDbContext<AppDbContext>(options => options
            .UseInMemoryDatabase($"assignable-roles-{Guid.NewGuid():N}")
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)));

        services.AddIdentityCore<User>(o =>
            {
                o.Password.RequiredLength = 8;
                o.User.RequireUniqueEmail = true;
            })
            .AddRoles<IdentityRole<int>>()
            .AddEntityFrameworkStores<AppDbContext>()
            .AddDefaultTokenProviders();

        services.AddSingleton(new ClientAppOptions { BaseUrl = "https://client.example.invalid" });
        services.AddSingleton(Substitute.For<IEmailSender>());
        services.AddScoped<IEffectivePermissionService, EffectivePermissionService>();
        services.AddScoped<IGeographicAuthorizationService, GeographicAuthorizationService>();
        services.AddScoped<IRoleManagementService, RoleManagementService>();
        services.AddScoped<IUserManagementService, UserManagementService>();

        var scope = services.BuildServiceProvider().CreateAsyncScope();

        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

        foreach (var role in ApplicationRoles.All)
        {
            await roles.CreateAsync(new IdentityRole<int>(role));
        }

        await AuthorizationDataSeeder.SeedAsync(
            scope.ServiceProvider.GetRequiredService<AppDbContext>(),
            roles,
            scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("seed"));

        // Son aktif Admin koruması rol değiştirme testlerini engellemesin.
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var keeper = new User
        {
            UserName = "keeper-admin",
            Email = "keeper-admin@example.invalid",
            EmailConfirmed = true,
            AccountStatus = AccountStatus.Active,
            IsActive = true
        };
        await users.CreateAsync(keeper, "Str0ng!Password");
        await users.AddToRoleAsync(keeper, ApplicationRoles.Admin);

        return scope;
    }
}
