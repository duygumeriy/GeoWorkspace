using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;
using NSubstitute;
using StajProject.Api.Authorization;
using StajProject.Api.Controllers;
using StajProject.Api.Services;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Authentication;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Rol/yetki yönetimi uçlarının gerçek HTTP hattı üzerinden yetkilendirmesi.
/// </summary>
/// <remarks>
/// İş servisi substitute'tur: 401/403 alan bir istekte servisin HİÇ
/// çağrılmadığı doğrulanabilsin diye. Yetkilendirme, iş mantığı çalışmadan
/// önce durmalıdır.
/// </remarks>
public class RoleAdminEnforcementTests
{
    private const string JwtKey = "test-only-key-that-is-long-enough-for-hmac-sha256-signing";
    private const string Issuer = "StajProject.Tests";
    private const string Audience = "StajProject.Tests.Client";

    /* --- 401 --------------------------------------------------------------------- */

    [Theory]
    [InlineData("GET", "/api/admin/roles")]
    [InlineData("GET", "/api/admin/roles/1")]
    [InlineData("POST", "/api/admin/roles")]
    [InlineData("PATCH", "/api/admin/roles/1")]
    [InlineData("DELETE", "/api/admin/roles/1")]
    [InlineData("GET", "/api/admin/permissions")]
    [InlineData("GET", "/api/admin/roles/1/permissions")]
    [InlineData("PUT", "/api/admin/roles/1/permissions")]
    public async Task An_anonymous_request_is_rejected_with_401(string method, string route)
    {
        await using var host = await CreateHostAsync();

        var response = await host.Client().SendAsync(Request(method, route));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /* --- 403: MFA eksik ------------------------------------------------------------ */

    [Fact]
    public async Task A_token_without_a_completed_second_factor_is_rejected()
    {
        await using var host = await CreateHostAsync();
        var admin = await host.CreateUserAsync("admin-no-mfa", ApplicationRoles.Admin);

        // Yetki tam (legacy Admin 29 yetkiye sahip) ama ikinci faktör yok.
        var response = await host.Client(admin, AuthenticationLevel.Password).GetAsync("/api/admin/roles");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        await host.Roles.DidNotReceiveWithAnyArgs().GetRolesAsync(default);
    }

    /* --- 403: yetki eksik ---------------------------------------------------------- */

    [Theory]
    [InlineData("GET", "/api/admin/roles")]
    [InlineData("POST", "/api/admin/roles")]
    [InlineData("PATCH", "/api/admin/roles/1")]
    [InlineData("DELETE", "/api/admin/roles/1")]
    [InlineData("GET", "/api/admin/permissions")]
    [InlineData("GET", "/api/admin/roles/1/permissions")]
    [InlineData("PUT", "/api/admin/roles/1/permissions")]
    public async Task A_gis_manager_with_mfa_but_without_admin_permissions_is_rejected(string method, string route)
    {
        await using var host = await CreateHostAsync();
        var manager = await host.CreateUserAsync($"mgr-{method}-{route.GetHashCode():X}", GisRoles.GisManager);

        // GIS Manager tüm operasyonel GIS yetkilerine sahiptir ama roles.*/permissions.* yoktur.
        var response = await host.Client(manager).SendAsync(Request(method, route));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    /* --- Her yetki ailesi ayrı ayrı ------------------------------------------------ */

    [Theory]
    [InlineData("GET", "/api/admin/roles", PermissionCodes.RolesView)]
    [InlineData("POST", "/api/admin/roles", PermissionCodes.RolesCreate)]
    [InlineData("PATCH", "/api/admin/roles/1", PermissionCodes.RolesUpdate)]
    [InlineData("DELETE", "/api/admin/roles/1", PermissionCodes.RolesDelete)]
    [InlineData("GET", "/api/admin/permissions", PermissionCodes.PermissionsView)]
    public async Task Granting_only_the_required_permission_is_enough(string method, string route, string code)
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync($"grant-{code}", GisRoles.Viewer);

        Assert.Equal(HttpStatusCode.Forbidden, (await host.Client(user).SendAsync(Request(method, route))).StatusCode);

        // Rol değişmeden, yalnızca gereken yetki doğrudan veriliyor.
        await host.GrantDirectAsync(user, code);

        var response = await host.Client(user).SendAsync(Request(method, route));

        Assert.NotEqual(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.NotEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Reading_role_permissions_needs_both_roles_view_and_permissions_view()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("two-perms", GisRoles.Viewer);
        const string Route = "/api/admin/roles/1/permissions";

        await host.GrantDirectAsync(user, PermissionCodes.RolesView);
        // Tek yetki yetmez: yanıt katalogla rolü birleştirdiği için ikisi de gerekir.
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Client(user).GetAsync(Route)).StatusCode);

        await host.GrantDirectAsync(user, PermissionCodes.PermissionsView);
        Assert.Equal(HttpStatusCode.OK, (await host.Client(user).GetAsync(Route)).StatusCode);
    }

    [Fact]
    public async Task Updating_role_permissions_needs_both_roles_update_and_permissions_assign()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("assign-perms", GisRoles.Viewer);
        const string Route = "/api/admin/roles/1/permissions";

        await host.GrantDirectAsync(user, PermissionCodes.RolesUpdate);
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Client(user).SendAsync(Request("PUT", Route))).StatusCode);

        await host.GrantDirectAsync(user, PermissionCodes.PermissionsAssign);
        Assert.Equal(HttpStatusCode.OK, (await host.Client(user).SendAsync(Request("PUT", Route))).StatusCode);
    }

    /* --- Rol adı kestirmesi yok ---------------------------------------------------- */

    [Fact]
    public async Task Administrator_with_mfa_manages_roles_without_the_legacy_admin_role()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("target-admin", GisRoles.Administrator);

        Assert.DoesNotContain(ApplicationRoles.Admin, await host.RolesOfAsync(user));

        Assert.Equal(HttpStatusCode.OK, (await host.Client(user).GetAsync("/api/admin/roles")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await host.Client(user).GetAsync("/api/admin/permissions")).StatusCode);
    }

    [Fact]
    public async Task Legacy_admin_is_not_a_bypass_when_the_permission_row_is_removed()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("legacy-admin", ApplicationRoles.Admin);
        var client = host.Client(user);

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/admin/roles")).StatusCode);

        await host.RevokeRoleGrantAsync(ApplicationRoles.Admin, PermissionCodes.RolesView);

        /* Rol adı hâlâ "Admin". Kodda bir süper kullanıcı kestirmesi olsaydı
           istek yine geçerdi; 403 dönmesi erişimin veri güdümlü olduğunu
           kanıtlar. */
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/admin/roles")).StatusCode);
    }

    /* --- Yardımcılar ---------------------------------------------------------------- */

    private static HttpRequestMessage Request(string method, string route) =>
        new(new HttpMethod(method), route)
        {
            Content = method is "POST" or "PATCH" or "PUT"
                ? new StringContent("{\"name\":\"X\",\"permissionCodes\":[]}", Encoding.UTF8, "application/json")
                : null
        };

    private static async Task<RoleAdminHost> CreateHostAsync()
    {
        var roles = Substitute.For<IRoleManagementService>();
        roles.GetRolesAsync(Arg.Any<CancellationToken>()).Returns(Array.Empty<RoleListItem>());
        roles.GetPermissionCatalogAsync(Arg.Any<CancellationToken>()).Returns(Array.Empty<PermissionCatalogItem>());
        roles.GetRoleAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<RoleDetail>.Success(new RoleDetail { Id = 1, Name = "X" }));
        roles.CreateRoleAsync(Arg.Any<CreateRoleRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<RoleDetail>.Success(new RoleDetail { Id = 1, Name = "X" }));
        roles.RenameRoleAsync(Arg.Any<int>(), Arg.Any<UpdateRoleRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<RoleDetail>.Success(new RoleDetail { Id = 1, Name = "X" }));
        roles.DeleteRoleAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<bool>.Success(true));
        roles.GetRolePermissionsAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<RolePermissionsResponse>.Success(new RolePermissionsResponse()));
        roles.ReplaceRolePermissionsAsync(
            Arg.Any<int>(), Arg.Any<int>(), Arg.Any<UpdateRolePermissionsRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<RolePermissionsResponse>.Success(new RolePermissionsResponse()));

        var databaseName = $"role-admin-http-{Guid.NewGuid():N}";

        var builder = new HostBuilder().ConfigureWebHost(web =>
        {
            web.UseTestServer();
            web.ConfigureServices(services =>
            {
                services.AddLogging(l => l.SetMinimumLevel(LogLevel.Warning));
                services.AddHttpContextAccessor();
                services.AddDbContext<AppDbContext>(o => o.UseInMemoryDatabase(databaseName));

                services.AddIdentityCore<User>(o => o.Password.RequiredLength = 8)
                    .AddRoles<IdentityRole<int>>()
                    .AddEntityFrameworkStores<AppDbContext>();

                services.AddSingleton(roles);
                services.AddScoped<ICurrentUserService, CurrentUserService>();

                // Üretimdeki yetkilendirme hattının aynısı.
                services.AddScoped<IEffectivePermissionService, EffectivePermissionService>();
                services.AddSingleton<IAuthorizationPolicyProvider, PermissionPolicyProvider>();
                services.AddScoped<IAuthorizationHandler, PermissionAuthorizationHandler>();

                services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
                    .AddJwtBearer(o => o.TokenValidationParameters = ValidationParameters());

                services.AddAuthorization(o =>
                {
                    o.AddPolicy(AuthorizationPolicies.MfaRequired, p =>
                    {
                        p.RequireAuthenticatedUser();
                        p.RequireAssertion(c => AuthenticationMethods.IsMultiFactor(c.User));
                    });
                });

                services.AddControllers().AddApplicationPart(typeof(AdminRolesController).Assembly);
            });

            web.Configure(app =>
            {
                app.UseRouting();
                app.UseAuthentication();
                app.UseAuthorization();
                app.UseEndpoints(e => e.MapControllers());
            });
        });

        var host = await builder.StartAsync();
        var fixture = new RoleAdminHost(host, roles);
        await fixture.SeedAsync();
        return fixture;
    }

    private static TokenValidationParameters ValidationParameters() => new()
    {
        ValidateIssuer = true,
        ValidIssuer = Issuer,
        ValidateAudience = true,
        ValidAudience = Audience,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtKey)),
        ClockSkew = TimeSpan.Zero
    };

    private sealed class RoleAdminHost : IAsyncDisposable
    {
        private readonly IHost _host;

        public RoleAdminHost(IHost host, IRoleManagementService roles)
        {
            _host = host;
            Roles = roles;
        }

        public IRoleManagementService Roles { get; }

        public async Task SeedAsync()
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

            foreach (var role in ApplicationRoles.All)
            {
                await roles.CreateAsync(new IdentityRole<int>(role));
            }

            await AuthorizationDataSeeder.SeedAsync(
                scope.ServiceProvider.GetRequiredService<AppDbContext>(),
                roles,
                scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("seed"));
        }

        public async Task<User> CreateUserAsync(string userName, string role)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();

            var user = new User
            {
                UserName = userName,
                Email = $"{Guid.NewGuid():N}@example.invalid",
                EmailConfirmed = true,
                AccountStatus = AccountStatus.Active,
                IsActive = true
            };

            Assert.True((await users.CreateAsync(user, "Str0ng!Password")).Succeeded);
            Assert.True((await users.AddToRoleAsync(user, role)).Succeeded);
            return user;
        }

        public async Task<string[]> RolesOfAsync(User user)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            return [.. await users.GetRolesAsync((await users.FindByIdAsync(user.Id.ToString()))!)];
        }

        public async Task GrantDirectAsync(User user, string code)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var permission = await db.Permissions.SingleAsync(p => p.Code == code);

            db.UserPermissions.Add(new UserPermission { UserId = user.Id, PermissionId = permission.Id });
            await db.SaveChangesAsync();
        }

        public async Task RevokeRoleGrantAsync(string roleName, string code)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

            var role = await roles.FindByNameAsync(roleName);
            var permission = await db.Permissions.SingleAsync(p => p.Code == code);

            db.RolePermissions.Remove(
                await db.RolePermissions.SingleAsync(rp => rp.RoleId == role!.Id && rp.PermissionId == permission.Id));
            await db.SaveChangesAsync();
        }

        public HttpClient Client() => _host.GetTestClient();

        public HttpClient Client(User user, AuthenticationLevel level = AuthenticationLevel.MultiFactor)
        {
            var roles = RolesOfAsync(user).GetAwaiter().GetResult();
            var tokens = new JwtTokenService(new JwtOptions
            {
                Key = JwtKey,
                Issuer = Issuer,
                Audience = Audience,
                ExpireMinutes = 10
            });

            var (token, _) = tokens.GenerateToken(user.Id, user.UserName!, roles, level);

            var client = _host.GetTestClient();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            return client;
        }

        public async ValueTask DisposeAsync()
        {
            await _host.StopAsync();
            _host.Dispose();
        }
    }
}
