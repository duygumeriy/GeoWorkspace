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
/// Rol yetkisi düzenlemenin GERÇEK HTTP hattı üzerinde yetki yükseltmeye
/// kapalı olduğunun kanıtı.
/// </summary>
/// <remarks>
/// <para>
/// İş servisleri substitute DEĞİLDİR: ölçülen şey yalnızca filtre katmanı
/// değil, filtrenin geçirdiği isteğin serviste de durdurulmasıdır. Substitute
/// kullanılsaydı test tam da kanıtlaması gereken şeyi atlardı — nitekim açığın
/// kendisi "uç yetkisi var ama servis otoriteyi hiç sormuyor" biçimindeydi.
/// </para>
/// <para>
/// Uçtaki <c>roles.update</c> + <c>permissions.assign</c> ile serviste sorulan
/// "bu yetkiyi dağıtabilir misin" sorusunun İKİ AYRI kapı olduğu burada
/// görünür: aktör ilk kapıdan geçer, ikincisinden geçemez.
/// </para>
/// </remarks>
public class RolePermissionGrantAuthorityHttpTests
{
    private const string JwtKey = "test-only-key-that-is-long-enough-for-hmac-sha256-signing";
    private const string Issuer = "StajProject.Tests";
    private const string Audience = "StajProject.Tests.Client";

    /* Aktörü uca taşıyan yetkiler; dağıtma otoritesi bunlardan bağımsızdır. */
    private static readonly string[] Gate =
    [
        PermissionCodes.RolesView, PermissionCodes.PermissionsView,
        PermissionCodes.RolesUpdate, PermissionCodes.PermissionsAssign
    ];

    [Fact]
    public async Task An_anonymous_update_is_rejected_with_401()
    {
        await using var host = await CreateHostAsync();
        var viewerId = await host.RoleIdAsync(GisRoles.Viewer);

        var response = await host.Client().PutAsync(Route(viewerId), Body(PermissionCodes.MapView));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task A_token_without_a_completed_second_factor_is_rejected_with_403()
    {
        await using var host = await CreateHostAsync();
        var actor = await host.CreateActorAsync("no-mfa", [.. PermissionCatalog.AllCodes]);
        var viewerId = await host.RoleIdAsync(GisRoles.Viewer);

        var client = host.Client(actor, AuthenticationLevel.Password);
        var response = await client.PutAsync(Route(viewerId), Body(PermissionCodes.MapView));

        // Yetkiler tamam; eksik olan ikinci faktör kanıtı.
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [InlineData(PermissionCodes.RolesUpdate)]
    [InlineData(PermissionCodes.PermissionsAssign)]
    public async Task Missing_either_endpoint_permission_is_rejected_with_403(string missing)
    {
        await using var host = await CreateHostAsync();

        var actor = await host.CreateActorAsync(
            $"missing-{missing.Replace('.', '-')}",
            [.. Gate.Where(c => c != missing)]);

        var viewerId = await host.RoleIdAsync(GisRoles.Viewer);
        var response = await host.Client(actor).PutAsync(Route(viewerId), Body(PermissionCodes.MapView));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task An_actor_past_the_endpoint_gate_is_still_refused_a_permission_it_lacks()
    {
        await using var host = await CreateHostAsync();

        // Uç kapısını geçen yetkiler VAR; inventory.analysis YOK.
        var actor = await host.CreateActorAsync("gate-passer", Gate);
        var viewerId = await host.RoleIdAsync(GisRoles.Viewer);

        var response = await host.Client(actor).PutAsync(
            Route(viewerId),
            Body([.. RolePermissionDefaults.For(GisRoles.Viewer), PermissionCodes.InventoryAnalysis]));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        // Filtre geçirdi, servis durdurdu: satır yazılmadı.
        Assert.False(await host.HasGrantAsync(viewerId, PermissionCodes.InventoryAnalysis));
    }

    [Fact]
    public async Task An_actor_that_holds_every_new_addition_succeeds_with_200()
    {
        await using var host = await CreateHostAsync();

        var actor = await host.CreateActorAsync("authorized-granter", [.. Gate, PermissionCodes.InventoryAnalysis]);
        var viewerId = await host.RoleIdAsync(GisRoles.Viewer);

        var response = await host.Client(actor).PutAsync(
            Route(viewerId),
            Body([.. RolePermissionDefaults.For(GisRoles.Viewer), PermissionCodes.InventoryAnalysis]));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(await host.HasGrantAsync(viewerId, PermissionCodes.InventoryAnalysis));
    }

    [Fact]
    public async Task Authority_is_re_evaluated_on_every_request_without_a_new_token()
    {
        await using var host = await CreateHostAsync();

        var actor = await host.CreateActorAsync("live-authority", [.. Gate, PermissionCodes.InventoryAnalysis]);
        var actorRoleId = await host.RoleIdAsync($"Role-live-authority");

        // Aynı client, aynı token boyunca.
        var client = host.Client(actor);

        var editorId = await host.RoleIdAsync(GisRoles.GisEditor);
        Assert.Equal(
            HttpStatusCode.OK,
            (await client.PutAsync(
                Route(editorId),
                Body([.. RolePermissionDefaults.For(GisRoles.GisEditor), PermissionCodes.InventoryAnalysis]))).StatusCode);

        // Aktörün yetki KAYNAĞI siliniyor; token'a dokunulmuyor.
        await host.RevokeGrantAsync(actorRoleId, PermissionCodes.InventoryAnalysis);

        var viewerId = await host.RoleIdAsync(GisRoles.Viewer);
        var response = await client.PutAsync(
            Route(viewerId),
            Body([.. RolePermissionDefaults.For(GisRoles.Viewer), PermissionCodes.InventoryAnalysis]));

        /* Yetkiler token'a yazılmadığı için otorite anında daralır: yeniden
           giriş, token yenilemesi veya restart GEREKMEZ. */
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.False(await host.HasGrantAsync(viewerId, PermissionCodes.InventoryAnalysis));
    }

    [Fact]
    public async Task A_weak_actor_cannot_escalate_the_role_it_holds_itself()
    {
        await using var host = await CreateHostAsync();

        var actor = await host.CreateActorAsync("self-escalator", Gate);
        var ownRoleId = await host.RoleIdAsync("Role-self-escalator");

        var response = await host.Client(actor).PutAsync(
            Route(ownRoleId),
            Body([.. Gate, PermissionCodes.UsersDelete]));

        // Preflight'ta bulunan asıl istismar: kendi rolünü genişletip yetkilenmek.
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.False(await host.HasGrantAsync(ownRoleId, PermissionCodes.UsersDelete));
    }

    /* --- Yardımcılar ------------------------------------------------------------------ */

    private static string Route(int roleId) => $"/api/admin/roles/{roleId}/permissions";

    private static StringContent Body(params string[] codes) =>
        new(
            $"{{\"permissionCodes\":[{string.Join(",", codes.Select(c => $"\"{c}\""))}]}}",
            Encoding.UTF8,
            "application/json");

    private static async Task<GrantAuthorityHost> CreateHostAsync()
    {
        var databaseName = $"grant-authority-http-{Guid.NewGuid():N}";

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

                /* İş servisi GERÇEK: açık tam olarak "filtre geçirdi, servis
                   sormadı" biçimindeydi. Substitute bunu göremezdi. */
                services.AddScoped<IEffectivePermissionService, EffectivePermissionService>();
                services.AddScoped<IRoleManagementService, RoleManagementService>();

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

        var fixture = new GrantAuthorityHost(await builder.StartAsync());
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

    private sealed class GrantAuthorityHost : IAsyncDisposable
    {
        private readonly IHost _host;

        public GrantAuthorityHost(IHost host) => _host = host;

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
            var roles = scope.ServiceProvider.GetRequiredService<IRoleManagementService>();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var role = (await roles.CreateRoleAsync(new CreateRoleRequest { Name = $"Role-{userName}" })).Value!;

            /* Kurgu doğrudan veritabanına yazılır: zayıf aktörü kurmak için tam
               da sınanan bariyerden geçmek gerekmemelidir. */
            var ids = await db.Permissions.Where(p => codes.Contains(p.Code)).Select(p => p.Id).ToListAsync();
            Assert.Equal(codes.Distinct().Count(), ids.Count);

            db.RolePermissions.AddRange(ids.Select(id => new RolePermission { RoleId = role.Id, PermissionId = id }));
            await db.SaveChangesAsync();

            return await CreateUserAsync(userName, role.Name);
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

        public async Task<int> RoleIdAsync(string name)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

            var role = await roles.FindByNameAsync(name);
            Assert.NotNull(role);
            return role!.Id;
        }

        public async Task<bool> HasGrantAsync(int roleId, string code)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            return await db.RolePermissions
                .AsNoTracking()
                .AnyAsync(rp => rp.RoleId == roleId && db.Permissions.Any(p => p.Id == rp.PermissionId && p.Code == code));
        }

        public async Task RevokeGrantAsync(int roleId, string code)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var permission = await db.Permissions.SingleAsync(p => p.Code == code);

            db.RolePermissions.RemoveRange(
                await db.RolePermissions
                    .Where(rp => rp.RoleId == roleId && rp.PermissionId == permission.Id)
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
