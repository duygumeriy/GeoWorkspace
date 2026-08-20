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
    public async Task Existing_usable_Administrator_prevents_zero_admin_recovery()
    {
        await using var scope = await CreateScopeAsync();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();
        var bootstrap = await CreateUserAsync(users, "bootstrap", ApplicationRoles.User);
        await CreateUserAsync(users, "canonical-admin", GisRoles.Administrator);

        await IdentityDataSeeder.SeedAsync(
            users,
            roles,
            scope.ServiceProvider.GetRequiredService<IEffectivePermissionService>(),
            new AdminSeedOptions
            {
                Username = bootstrap.UserName!,
                Password = "Str0ng!Password",
                EnableZeroAdminRecovery = true
            },
            scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("startup-test"));

        bootstrap = (await users.FindByIdAsync(bootstrap.Id.ToString()))!;
        Assert.True(await users.IsInRoleAsync(bootstrap, ApplicationRoles.User));
        Assert.False(await users.IsInRoleAsync(bootstrap, ApplicationRoles.Admin));
    }

    private static async Task<AsyncServiceScope> CreateScopeAsync()
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

        foreach (var roleName in ApplicationRoles.All)
        {
            Assert.True((await roles.CreateAsync(new IdentityRole<int>(roleName))).Succeeded);
        }

        await AuthorizationDataSeeder.SeedAsync(
            scope.ServiceProvider.GetRequiredService<AppDbContext>(),
            roles,
            scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("authorization-seed"));

        return scope;
    }

    private static async Task<User> CreateUserAsync(
        UserManager<User> users,
        string userName,
        string role)
    {
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
}
