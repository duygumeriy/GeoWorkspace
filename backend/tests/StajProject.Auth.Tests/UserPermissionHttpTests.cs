using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
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
using StajProject.Application.Options;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Authentication;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Doğrudan yetki uçlarının GERÇEK HTTP hattı üzerindeki davranışı.
/// </summary>
/// <remarks>
/// <para>
/// İş servisleri substitute DEĞİLDİR. Ölçülen şey yalnızca filtre katmanı
/// olsaydı test, asıl riski — "filtre geçirdi, servis otoriteyi hiç sormadı" —
/// göremezdi; rol yetkisi ucundaki açık tam olarak bu biçimdeydi.
/// </para>
/// <para>
/// İki kapı ayrı ayrı görünür: uçtaki <c>users.update</c> +
/// <c>permissions.assign</c> "bu ekranı kullanabilirsin" der, servisteki
/// otorite kuralı "bu yetkiyi dağıtabilirsin" der. Çağıran ilkinden geçip
/// ikincisinde durabilir.
/// </para>
/// </remarks>
public class UserPermissionHttpTests
{
    private const string JwtKey = "test-only-key-that-is-long-enough-for-hmac-sha256-signing";
    private const string Issuer = "StajProject.Tests";
    private const string Audience = "StajProject.Tests.Client";

    private static readonly string[] ReadGate = [PermissionCodes.UsersView, PermissionCodes.PermissionsView];

    private static readonly string[] WriteGate =
    [
        PermissionCodes.UsersView, PermissionCodes.PermissionsView,
        PermissionCodes.UsersUpdate, PermissionCodes.PermissionsAssign
    ];

    /* --- GET ---------------------------------------------------------------------------- */

    [Fact]
    public async Task An_anonymous_read_is_rejected_with_401()
    {
        await using var host = await CreateHostAsync();
        var target = await host.CreateUserAsync("target", GisRoles.Viewer);

        Assert.Equal(HttpStatusCode.Unauthorized, (await host.Client().GetAsync(Route(target.Id))).StatusCode);
    }

    [Fact]
    public async Task A_read_without_a_completed_second_factor_is_rejected_with_403()
    {
        await using var host = await CreateHostAsync();
        var actor = await host.CreateActorAsync("no-mfa", [.. PermissionCatalog.AllCodes]);
        var target = await host.CreateUserAsync("target", GisRoles.Viewer);

        var client = host.Client(actor, AuthenticationLevel.Password);

        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(Route(target.Id))).StatusCode);
    }

    [Theory]
    [InlineData(PermissionCodes.UsersView)]
    [InlineData(PermissionCodes.PermissionsView)]
    public async Task A_read_missing_either_endpoint_permission_is_rejected_with_403(string missing)
    {
        await using var host = await CreateHostAsync();

        var actor = await host.CreateActorAsync(
            $"read-missing-{missing.Replace('.', '-')}",
            [.. ReadGate.Where(c => c != missing)]);

        var target = await host.CreateUserAsync("target", GisRoles.Viewer);

        /* Yanıt kullanıcı verisini ve yetki kataloğunu BİRLEŞTİRİR; tek bir
           yetkiyle açmak diğer kaynağı dolaylı olarak sızdırmak olurdu. */
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Client(actor).GetAsync(Route(target.Id))).StatusCode);
    }

    [Fact]
    public async Task A_view_only_actor_reads_the_table_but_is_told_it_cannot_manage()
    {
        await using var host = await CreateHostAsync();
        var actor = await host.CreateActorAsync("watcher", ReadGate);
        var target = await host.CreateUserAsync("editor", GisRoles.GisEditor);

        var response = await host.Client(actor).GetAsync(Route(target.Id));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = (await response.Content.ReadFromJsonAsync<UserPermissionsResponse>())!;

        Assert.Equal(30, body.Permissions.Count);
        Assert.False(body.CanManageDirectPermissions);
        Assert.DoesNotContain(body.Permissions, p => p.CanAssignDirect);

        // Okuma çağırana göre filtrelenmez: veremeyeceği yetkileri de görür.
        Assert.Contains(body.Permissions, p => p.Code == PermissionCodes.UsersDelete);
    }

    [Fact]
    public async Task A_missing_target_reads_as_404()
    {
        await using var host = await CreateHostAsync();
        var actor = await host.CreateActorAsync("reader", ReadGate);

        Assert.Equal(HttpStatusCode.NotFound, (await host.Client(actor).GetAsync(Route(987654))).StatusCode);
    }

    /* --- PUT ---------------------------------------------------------------------------- */

    [Fact]
    public async Task An_anonymous_update_is_rejected_with_401()
    {
        await using var host = await CreateHostAsync();
        var target = await host.CreateUserAsync("target", GisRoles.Viewer);

        var response = await host.Client().PutAsync(Route(target.Id), Body(PermissionCodes.InventoryAnalysis));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task An_update_without_a_completed_second_factor_is_rejected_with_403()
    {
        await using var host = await CreateHostAsync();
        var actor = await host.CreateActorAsync("no-mfa", [.. PermissionCatalog.AllCodes]);
        var target = await host.CreateUserAsync("target", GisRoles.Viewer);

        var client = host.Client(actor, AuthenticationLevel.Password);
        var response = await client.PutAsync(Route(target.Id), Body(PermissionCodes.InventoryAnalysis));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [InlineData(PermissionCodes.UsersUpdate)]
    [InlineData(PermissionCodes.PermissionsAssign)]
    public async Task An_update_missing_either_endpoint_permission_is_rejected_with_403(string missing)
    {
        await using var host = await CreateHostAsync();

        var actor = await host.CreateActorAsync(
            $"write-missing-{missing.Replace('.', '-')}",
            [.. WriteGate.Where(c => c != missing), PermissionCodes.InventoryAnalysis]);

        var target = await host.CreateUserAsync("target", GisRoles.Viewer);

        var response = await host.Client(actor).PutAsync(Route(target.Id), Body(PermissionCodes.InventoryAnalysis));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.False(await host.HasDirectAsync(target.Id, PermissionCodes.InventoryAnalysis));
    }

    [Fact]
    public async Task An_actor_past_the_endpoint_gate_is_still_refused_a_permission_it_lacks()
    {
        await using var host = await CreateHostAsync();

        // Uç kapısını geçen yetkiler VAR; inventory.analysis YOK.
        var actor = await host.CreateActorAsync("gate-passer", WriteGate);
        var target = await host.CreateUserAsync("target", GisRoles.Viewer);

        var response = await host.Client(actor).PutAsync(Route(target.Id), Body(PermissionCodes.InventoryAnalysis));

        // Filtre geçirdi, servis durdurdu.
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.False(await host.HasDirectAsync(target.Id, PermissionCodes.InventoryAnalysis));
    }

    [Fact]
    public async Task An_inherited_permission_is_refused_with_400()
    {
        await using var host = await CreateHostAsync();
        var actor = await host.CreateActorAsync("granter", [.. PermissionCatalog.AllCodes]);
        var target = await host.CreateUserAsync("editor", GisRoles.GisEditor);

        var response = await host.Client(actor).PutAsync(
            Route(target.Id), Body(PermissionCodes.DrawingsPointCreate));

        /* 403 DEĞİL: çağıranın yetkisi tamdır. İstek, kullanıcının zaten sahip
           olduğu bir yetkiyi ikinci kez vermeye çalıştığı için geçersizdir. */
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.False(await host.HasDirectAsync(target.Id, PermissionCodes.DrawingsPointCreate));
    }

    [Fact]
    public async Task An_authorized_grant_succeeds_with_200_and_returns_the_new_state()
    {
        await using var host = await CreateHostAsync();
        var actor = await host.CreateActorAsync("authorized", [.. WriteGate, PermissionCodes.InventoryAnalysis]);
        var target = await host.CreateUserAsync("target", GisRoles.Viewer);

        var response = await host.Client(actor).PutAsync(Route(target.Id), Body(PermissionCodes.InventoryAnalysis));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = (await response.Content.ReadFromJsonAsync<UserPermissionsResponse>())!;
        var item = body.Permissions.Single(p => p.Code == PermissionCodes.InventoryAnalysis);

        Assert.True(item.DirectAssigned);
        Assert.True(item.Effective);
        Assert.True(await host.HasDirectAsync(target.Id, PermissionCodes.InventoryAnalysis));
    }

    [Fact]
    public async Task Authority_is_re_evaluated_on_every_request_without_a_new_token()
    {
        await using var host = await CreateHostAsync();
        var actor = await host.CreateActorAsync("live", [.. WriteGate, PermissionCodes.InventoryAnalysis]);

        // Aynı client, aynı token boyunca.
        var client = host.Client(actor);

        var first = await host.CreateUserAsync("first", GisRoles.Viewer);
        Assert.Equal(
            HttpStatusCode.OK,
            (await client.PutAsync(Route(first.Id), Body(PermissionCodes.InventoryAnalysis))).StatusCode);

        // Çağıranın yetki KAYNAĞI siliniyor; token'a dokunulmuyor.
        await host.RevokeRoleGrantAsync($"Role-live", PermissionCodes.InventoryAnalysis);

        var second = await host.CreateUserAsync("second", GisRoles.Viewer);
        var response = await client.PutAsync(Route(second.Id), Body(PermissionCodes.InventoryAnalysis));

        /* Yetkiler token'a yazılmadığı için otorite anında daralır: yeniden
           giriş, token yenilemesi veya restart GEREKMEZ. */
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.False(await host.HasDirectAsync(second.Id, PermissionCodes.InventoryAnalysis));
    }

    /* --- Yardımcılar -------------------------------------------------------------------- */

    private static string Route(int userId) => $"/api/admin/users/{userId}/permissions";

    private static StringContent Body(params string[] codes) =>
        new(
            $"{{\"permissionCodes\":[{string.Join(",", codes.Select(c => $"\"{c}\""))}]}}",
            Encoding.UTF8,
            "application/json");

    private static async Task<UserPermissionHost> CreateHostAsync()
    {
        var databaseName = $"user-permissions-http-{Guid.NewGuid():N}";

        var builder = new HostBuilder().ConfigureWebHost(web =>
        {
            web.UseTestServer();
            web.ConfigureServices(services =>
            {
                services.AddLogging(l => l.SetMinimumLevel(LogLevel.Warning));
                services.AddHttpContextAccessor();

                services.AddDbContext<AppDbContext>(o => o
                    .UseInMemoryDatabase(databaseName)
                    .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)));

                services.AddIdentityCore<User>(o => o.Password.RequiredLength = 8)
                    .AddRoles<IdentityRole<int>>()
                    .AddEntityFrameworkStores<AppDbContext>();

                services.AddSingleton(new ClientAppOptions { BaseUrl = "https://client.example.invalid" });
                services.AddSingleton(Substitute.For<IEmailSender>());
                services.AddScoped<ICurrentUserService, CurrentUserService>();

                /* İş servisleri GERÇEK: bu testin konusu filtrenin geçirdiği
                   isteğin serviste de doğru karşılanması. */
                services.AddScoped<IEffectivePermissionService, EffectivePermissionService>();
                services.AddScoped<IGeographicAuthorizationService, GeographicAuthorizationService>();
                services.AddScoped<IRoleManagementService, RoleManagementService>();
                services.AddScoped<IUserManagementService, UserManagementService>();
                services.AddScoped<IUserPermissionManagementService, UserPermissionManagementService>();

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

                services.AddControllers().AddApplicationPart(typeof(AdminUsersController).Assembly);
            });

            web.Configure(app =>
            {
                app.UseRouting();
                app.UseAuthentication();
                app.UseAuthorization();
                app.UseEndpoints(e => e.MapControllers());
            });
        });

        var fixture = new UserPermissionHost(await builder.StartAsync());
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

    private sealed class UserPermissionHost : IAsyncDisposable
    {
        private readonly IHost _host;

        public UserPermissionHost(IHost host) => _host = host;

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

        /// <summary>Verilen yetkilere sahip özel bir rol ve o roldeki aktif kullanıcı.</summary>
        public async Task<User> CreateActorAsync(string userName, string[] codes)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var roleName = $"Role-{userName}";
            Assert.True((await roles.CreateAsync(new IdentityRole<int>(roleName))).Succeeded);
            var role = (await roles.FindByNameAsync(roleName))!;

            var ids = await db.Permissions.Where(p => codes.Contains(p.Code)).Select(p => p.Id).ToListAsync();
            Assert.Equal(codes.Distinct().Count(), ids.Count);

            db.RolePermissions.AddRange(ids.Select(id => new RolePermission { RoleId = role.Id, PermissionId = id }));
            await db.SaveChangesAsync();

            return await CreateUserAsync(userName, roleName);
        }

        public async Task<User> CreateUserAsync(string userName, string role)
        {
            await using var scope = _host.Services.CreateAsyncScope();
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

        public async Task<bool> HasDirectAsync(int userId, string code)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            return await db.UserPermissions
                .AsNoTracking()
                .AnyAsync(up => up.UserId == userId
                    && db.Permissions.Any(p => p.Id == up.PermissionId && p.Code == code));
        }

        public async Task RevokeRoleGrantAsync(string roleName, string code)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

            var role = (await roles.FindByNameAsync(roleName))!;
            var permission = await db.Permissions.SingleAsync(p => p.Code == code);

            db.RolePermissions.RemoveRange(
                await db.RolePermissions
                    .Where(rp => rp.RoleId == role.Id && rp.PermissionId == permission.Id)
                    .ToListAsync());

            await db.SaveChangesAsync();
        }

        private async Task<string[]> RolesOfAsync(User user)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            return [.. await users.GetRolesAsync((await users.FindByIdAsync(user.Id.ToString()))!)];
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
