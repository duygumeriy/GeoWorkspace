using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

public class AdministratorStartupRecoveryTests
{
    [Fact]
    public async Task Fresh_seed_creates_canonical_roles_before_assigning_bootstrap_and_roleless_users()
    {
        await using var scope = await CreateScopeAsync();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();
        var roleless = await CreateUserAsync(users, "roleless");

        await SeedIdentityAsync(scope, new AdminSeedOptions
        {
            Username = "bootstrap",
            Email = "bootstrap@example.invalid",
            Password = "Str0ng!Password",
            EnableZeroAdminRecovery = true
        });

        var bootstrap = (await users.FindByNameAsync("bootstrap"))!;
        Assert.True(await roles.RoleExistsAsync(GisRoles.Administrator));
        Assert.True(await roles.RoleExistsAsync(GisRoles.GisEditor));
        Assert.True(await users.IsInRoleAsync(bootstrap, GisRoles.Administrator));
        Assert.False(await users.IsInRoleAsync(bootstrap, ApplicationRoles.Admin));
        Assert.True(await users.IsInRoleAsync(roleless, GisRoles.GisEditor));
        Assert.False(await roles.RoleExistsAsync(ApplicationRoles.Admin));
        Assert.False(await roles.RoleExistsAsync(ApplicationRoles.User));
    }

    [Fact]
    public async Task Startup_does_not_modify_retired_rows_when_a_canonical_admin_exists()
    {
        await using var scope = await CreateScopeAsync(includeLegacyRoles: true);
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();
        await CreateUserAsync(users, "canonical-admin", GisRoles.Administrator);
        var legacyAdmin = await CreateUserAsync(users, "legacy-admin", ApplicationRoles.Admin);
        var legacyUser = await CreateUserAsync(users, "legacy-user", ApplicationRoles.User);
        var options = new AdminSeedOptions
        {
            Username = legacyUser.UserName!,
            Password = "Str0ng!Password",
            EnableZeroAdminRecovery = true
        };

        await SeedIdentityAsync(scope, options);
        await SeedAuthorizationAsync(scope);
        await SeedIdentityAsync(scope, options);

        Assert.True(await roles.RoleExistsAsync(ApplicationRoles.Admin));
        Assert.True(await roles.RoleExistsAsync(ApplicationRoles.User));
        Assert.True(await users.IsInRoleAsync(legacyAdmin, ApplicationRoles.Admin));
        Assert.False(await users.IsInRoleAsync(legacyAdmin, GisRoles.Administrator));
        Assert.True(await users.IsInRoleAsync(legacyUser, ApplicationRoles.User));
        Assert.False(await users.IsInRoleAsync(legacyUser, GisRoles.GisEditor));
    }

    [Fact]
    public async Task Zero_usable_admin_recovery_assigns_Administrator_instead_of_Admin()
    {
        await using var scope = await CreateScopeAsync(includeLegacyRoles: true);
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var bootstrap = await CreateUserAsync(users, "bootstrap", ApplicationRoles.User);

        await SeedIdentityAsync(scope, new AdminSeedOptions
        {
            Username = bootstrap.UserName!,
            Password = "Str0ng!Password",
            EnableZeroAdminRecovery = true
        });

        Assert.True(await users.IsInRoleAsync(bootstrap, GisRoles.Administrator));
        Assert.False(await users.IsInRoleAsync(bootstrap, ApplicationRoles.Admin));
        Assert.False(await users.IsInRoleAsync(bootstrap, ApplicationRoles.User));
    }

    [Fact]
    public async Task Existing_usable_Administrator_prevents_zero_admin_recovery()
    {
        await using var scope = await CreateScopeAsync(includeLegacyRoles: true);
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var bootstrap = await CreateUserAsync(users, "bootstrap", ApplicationRoles.User);
        await CreateUserAsync(users, "canonical-admin", GisRoles.Administrator);

        await SeedIdentityAsync(scope, new AdminSeedOptions
        {
            Username = bootstrap.UserName!,
            Password = "Str0ng!Password",
            EnableZeroAdminRecovery = true
        });

        Assert.True(await users.IsInRoleAsync(bootstrap, ApplicationRoles.User));
        Assert.False(await users.IsInRoleAsync(bootstrap, ApplicationRoles.Admin));
        Assert.False(await users.IsInRoleAsync(bootstrap, GisRoles.Administrator));
    }

    [Fact]
    public async Task Default_role_only_changes_genuinely_roleless_eligible_accounts()
    {
        await using var scope = await CreateScopeAsync(includeLegacyRoles: true);
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        await CreateUserAsync(users, "canonical-admin", GisRoles.Administrator);
        var roleless = await CreateUserAsync(users, "roleless");
        var legacyUser = await CreateUserAsync(users, "legacy-user", ApplicationRoles.User);
        var editor = await CreateUserAsync(users, "editor", GisRoles.GisEditor);
        var inactiveWithActiveStatus = await CreateUserAsync(users, "inactive", isActive: false);
        var suspended = await CreateUserAsync(users, "suspended", status: AccountStatus.Suspended, isActive: false);
        var deleted = await CreateUserAsync(users, "deleted", isDeleted: true);
        var pending = await CreateUserAsync(users, "pending", status: AccountStatus.PendingApproval, isActive: false);

        await SeedIdentityAsync(scope, new AdminSeedOptions());

        Assert.Equal(new[] { GisRoles.GisEditor }, await users.GetRolesAsync(roleless));
        Assert.Equal(new[] { ApplicationRoles.User }, await users.GetRolesAsync(legacyUser));
        Assert.Equal(new[] { GisRoles.GisEditor }, await users.GetRolesAsync(editor));
        // Preserve the pre-transition predicate exactly: eligibility is based on
        // non-deleted + AccountStatus.Active; IsActive is not a separate filter.
        Assert.Equal(new[] { GisRoles.GisEditor }, await users.GetRolesAsync(inactiveWithActiveStatus));
        Assert.Empty(await users.GetRolesAsync(suspended));
        Assert.Empty(await users.GetRolesAsync(deleted));
        Assert.Empty(await users.GetRolesAsync(pending));
    }

    [Fact]
    public async Task Repeated_seed_is_idempotent_and_does_not_duplicate_memberships()
    {
        await using var scope = await CreateScopeAsync();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var roleless = await CreateUserAsync(users, "roleless");
        var options = new AdminSeedOptions
        {
            Username = "bootstrap",
            Password = "Str0ng!Password",
            EnableZeroAdminRecovery = true
        };

        await SeedIdentityAsync(scope, options);
        await SeedAuthorizationAsync(scope);
        await SeedIdentityAsync(scope, options);

        var bootstrap = (await users.FindByNameAsync("bootstrap"))!;
        Assert.Equal(1, await db.UserRoles.CountAsync(ur => ur.UserId == bootstrap.Id));
        Assert.Equal(1, await db.UserRoles.CountAsync(ur => ur.UserId == roleless.Id));
        Assert.Equal(GisRoles.All.Count, await db.Roles.CountAsync());
        Assert.Equal(new[] { GisRoles.Administrator }, await users.GetRolesAsync(bootstrap));
        Assert.Equal(new[] { GisRoles.GisEditor }, await users.GetRolesAsync(roleless));
    }

    private static async Task<AsyncServiceScope> CreateScopeAsync(bool includeLegacyRoles = false)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
        services.AddDbContext<AppDbContext>(options =>
            options.UseInMemoryDatabase($"administrator-startup-{Guid.NewGuid():N}"));
        services.AddIdentityCore<User>(options => options.Password.RequiredLength = 8)
            .AddRoles<IdentityRole<int>>()
            .AddEntityFrameworkStores<AppDbContext>()
            .AddDefaultTokenProviders();
        services.AddScoped<IEffectivePermissionService, EffectivePermissionService>();

        var scope = services.BuildServiceProvider().CreateAsyncScope();
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

        if (includeLegacyRoles)
        {
            Assert.True((await roles.CreateAsync(new IdentityRole<int>(ApplicationRoles.Admin))).Succeeded);
            Assert.True((await roles.CreateAsync(new IdentityRole<int>(ApplicationRoles.User))).Succeeded);
        }

        // Production startup uses this same ordering: canonical role definitions
        // and their permissions must exist before identity assignments run.
        await SeedAuthorizationAsync(scope);

        return scope;
    }

    private static Task SeedIdentityAsync(AsyncServiceScope scope, AdminSeedOptions options) =>
        IdentityDataSeeder.SeedAsync(
            scope.ServiceProvider.GetRequiredService<UserManager<User>>(),
            scope.ServiceProvider.GetRequiredService<IEffectivePermissionService>(),
            options,
            scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("identity-seed"));

    private static Task SeedAuthorizationAsync(AsyncServiceScope scope) =>
        AuthorizationDataSeeder.SeedAsync(
            scope.ServiceProvider.GetRequiredService<AppDbContext>(),
            scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>(),
            scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("authorization-seed"));

    private static async Task<User> CreateUserAsync(
        UserManager<User> users,
        string userName,
        string? role = null,
        AccountStatus status = AccountStatus.Active,
        bool isActive = true,
        bool isDeleted = false)
    {
        var user = new User
        {
            UserName = userName,
            Email = $"{userName}@example.invalid",
            EmailConfirmed = true,
            AccountStatus = status,
            IsActive = isActive,
            IsDeleted = isDeleted
        };

        Assert.True((await users.CreateAsync(user, "Str0ng!Password")).Succeeded);

        if (role is not null)
        {
            Assert.True((await users.AddToRoleAsync(user, role)).Succeeded);
        }

        return user;
    }
}
