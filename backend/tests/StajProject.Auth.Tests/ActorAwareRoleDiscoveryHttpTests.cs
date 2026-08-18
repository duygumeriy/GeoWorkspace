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
/// Atanabilir rol keşfi ile rol atama mutasyonunun GERÇEK HTTP hattı üzerinde
/// aynı cevabı verdiğinin kanıtı.
/// </summary>
/// <remarks>
/// <para>
/// Diğer uç testlerinin aksine burada iş servisleri substitute DEĞİLDİR:
/// ölçülen şey yetkilendirme filtresi değil, listenin ve mutasyonun aynı
/// yetki kuralını paylaşması. Substitute kullanılsaydı test tam da kanıtlaması
/// gereken şeyi atlardı.
/// </para>
/// <para>
/// Senaryo, refinement'ın sebebi olan UX sorunudur: zayıf bir yönetici
/// <c>Administrator</c>'ı dropdown'da GÖRÜYOR, seçiyor ve 403 alıyordu.
/// </para>
/// </remarks>
public class ActorAwareRoleDiscoveryHttpTests
{
    private const string JwtKey = "test-only-key-that-is-long-enough-for-hmac-sha256-signing";
    private const string Issuer = "StajProject.Tests";
    private const string Audience = "StajProject.Tests.Client";

    private const string RolesRoute = "/api/admin/users/roles";

    [Fact]
    public async Task A_weak_actor_is_offered_only_what_it_can_actually_assign()
    {
        await using var host = await CreateHostAsync();

        /* Aktör onay ekranını açabilir (roles.view), rol değiştirebilir
           (users.update) ve Viewer'ın altı yetkisini taşır — ama GIS Editor'ün
           düzenleme yetkileri ile Administrator'ın yönetim yetkileri yok. */
        var actor = await host.CreateActorAsync(
            "weak-admin",
            [.. RolePermissionDefaults.For(GisRoles.Viewer), PermissionCodes.RolesView, PermissionCodes.UsersUpdate]);

        var client = host.Client(actor);

        var response = await client.GetAsync(RolesRoute);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var offered = (await response.Content.ReadFromJsonAsync<AssignableRole[]>())!.Select(r => r.Name).ToArray();

        Assert.Contains(GisRoles.Viewer, offered);
        Assert.DoesNotContain(GisRoles.GisEditor, offered);
        Assert.DoesNotContain(GisRoles.GisAnalyst, offered);
        Assert.DoesNotContain(GisRoles.GisManager, offered);
        Assert.DoesNotContain(GisRoles.Administrator, offered);

        // Legacy geçiş rolleri kimseye açılmaz.
        Assert.DoesNotContain(ApplicationRoles.Admin, offered);
        Assert.DoesNotContain(ApplicationRoles.User, offered);

        /* Şimdi asıl iddia: listede GÖRÜNEN rol gerçekten atanabiliyor,
           GÖRÜNMEYEN rol ise reddediliyor. Keşif ile uygulama aynı fikirde. */
        var target = await host.CreateUserAsync("assignment-target", GisRoles.GisAnalyst);

        Assert.Equal(
            HttpStatusCode.OK,
            (await client.PatchAsync($"/api/admin/users/{target.Id}/role", RoleBody(GisRoles.Viewer))).StatusCode);

        Assert.Equal([GisRoles.Viewer], await host.RolesOfAsync(target));

        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await client.PatchAsync($"/api/admin/users/{target.Id}/role", RoleBody(GisRoles.Administrator))).StatusCode);

        // Reddedilen atama hedefi hiç değiştirmedi.
        Assert.Equal([GisRoles.Viewer], await host.RolesOfAsync(target));
    }

    [Fact]
    public async Task A_fully_privileged_administrator_is_offered_every_target_role()
    {
        await using var host = await CreateHostAsync();
        var actor = await host.CreateUserAsync("http-administrator", GisRoles.Administrator);

        // Legacy Admin rolü YOK; yetkisi yalnızca yetki satırlarından geliyor.
        Assert.DoesNotContain(ApplicationRoles.Admin, await host.RolesOfAsync(actor));

        var offered = await host.OfferedAsync(actor);

        Assert.Equal(
            [GisRoles.Viewer, GisRoles.GisEditor, GisRoles.GisAnalyst, GisRoles.GisManager, GisRoles.Administrator],
            offered);
    }

    [Fact]
    public async Task The_endpoint_still_answers_with_only_roles_view_and_mfa()
    {
        await using var host = await CreateHostAsync();

        /* Sözleşme DEĞİŞMEDİ: dönen veri çağırana özel hâle geldi diye uca
           users.update şartı eklenmedi. "Hangi rolleri verebilirdim" sorusunu
           sormak, rol atamakla aynı şey değildir. */
        var reader = await host.CreateActorAsync("reader-only", PermissionCodes.RolesView);

        var response = await host.Client(reader).GetAsync(RolesRoute);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        /* Yetkisi yalnızca roles.view olduğu için kapsadığı tek rol kendi
           sıfır-yetki komşuları değil, roles.view'i olan kendi rolüdür. */
        var offered = (await response.Content.ReadFromJsonAsync<AssignableRole[]>())!.Select(r => r.Name).ToArray();
        Assert.DoesNotContain(GisRoles.Administrator, offered);

        // MFA hâlâ zorunlu.
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await host.Client(reader, AuthenticationLevel.Password).GetAsync(RolesRoute)).StatusCode);
    }

    [Fact]
    public async Task An_anonymous_request_is_still_rejected_with_401()
    {
        await using var host = await CreateHostAsync();

        Assert.Equal(HttpStatusCode.Unauthorized, (await host.Client().GetAsync(RolesRoute)).StatusCode);
    }

    [Fact]
    public async Task The_global_role_inventory_is_not_actor_filtered()
    {
        await using var host = await CreateHostAsync();

        // Zayıf aktör: atayamadığı rolleri de ENVANTERDE görebilmelidir.
        var actor = await host.CreateActorAsync(
            "inventory-reader",
            [.. RolePermissionDefaults.For(GisRoles.Viewer), PermissionCodes.RolesView, PermissionCodes.UsersUpdate]);

        var inventory = (await (await host.Client(actor).GetAsync("/api/admin/roles"))
            .Content.ReadFromJsonAsync<RoleListItem[]>())!.Select(r => r.Name).ToArray();

        /* İki ucun soruları farklıdır: "hangi roller VAR" ile "bu çağıran
           hangilerini VEREBİLİR". Envanter daraltılsaydı yönetim ekranı
           sistemin gerçek hâlini gösteremezdi. */
        Assert.Contains(ApplicationRoles.Admin, inventory);
        Assert.Contains(ApplicationRoles.User, inventory);
        Assert.Contains(GisRoles.Administrator, inventory);
        Assert.Contains(GisRoles.GisEditor, inventory);

        // Aynı aktör, atama listesinde bunları GÖRMÜYOR.
        var offered = await host.OfferedAsync(actor);
        Assert.DoesNotContain(GisRoles.Administrator, offered);
        Assert.DoesNotContain(GisRoles.GisEditor, offered);
    }

    [Fact]
    public async Task A_live_role_permission_change_narrows_the_list_without_a_new_token()
    {
        await using var host = await CreateHostAsync();
        var actor = await host.CreateActorAsync(
            "editor-granter",
            [.. RolePermissionDefaults.For(GisRoles.GisEditor), PermissionCodes.RolesView, PermissionCodes.UsersUpdate]);

        var client = host.Client(actor);
        Assert.Contains(GisRoles.GisEditor, await host.OfferedAsync(client));

        // Hedef rol genişliyor; aktörün yetkileri ve TOKEN'ı hiç değişmiyor.
        await host.GrantRoleAsync(GisRoles.GisEditor, PermissionCodes.UsersDelete);

        /* Aynı client, aynı token. Yetkiler token'a yazılmadığı için liste
           anında daralır — yeniden giriş gerekmez. */
        Assert.DoesNotContain(GisRoles.GisEditor, await host.OfferedAsync(client));

        var target = await host.CreateUserAsync("narrowed-target", GisRoles.Viewer);

        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await client.PatchAsync($"/api/admin/users/{target.Id}/role", RoleBody(GisRoles.GisEditor))).StatusCode);
    }

    /* --- Yardımcılar ------------------------------------------------------------------ */

    private static StringContent RoleBody(string role) =>
        new($"{{\"role\":\"{role}\"}}", Encoding.UTF8, "application/json");

    private static async Task<RoleDiscoveryHost> CreateHostAsync()
    {
        var databaseName = $"actor-aware-http-{Guid.NewGuid():N}";

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

                /* İş servisleri GERÇEK: bu testin konusu listenin ve mutasyonun
                   aynı kuralı paylaşması, dolayısıyla ikisi de çalışmalıdır. */
                services.AddScoped<IEffectivePermissionService, EffectivePermissionService>();
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

        var fixture = new RoleDiscoveryHost(await builder.StartAsync());
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

    private sealed class RoleDiscoveryHost : IAsyncDisposable
    {
        private readonly IHost _host;

        public RoleDiscoveryHost(IHost host) => _host = host;

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

            // Son aktif Admin koruması rol değiştirme senaryolarını engellemesin.
            await CreateUserAsync("keeper-admin", ApplicationRoles.Admin);
        }

        /// <summary>Verilen yetkilere sahip özel bir rol ve o roldeki aktif kullanıcı.</summary>
        public async Task<User> CreateActorAsync(string userName, params string[] codes)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var roles = scope.ServiceProvider.GetRequiredService<IRoleManagementService>();

            var role = (await roles.CreateRoleAsync(new CreateRoleRequest { Name = $"Role-{userName}" })).Value!;

            /* Kurgu doğrudan veritabanına yazılır: ReplaceRolePermissionsAsync
               artık "yeni eklenenler ⊆ çağıranın yetkileri" bariyerini uygular
               ve kurulmakta olan zayıf aktörün rolünü donatmak o bariyere
               takılırdı. Bu dosyanın konusu HTTP rol keşfidir. */
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var ids = await db.Permissions
                .Where(p => codes.Contains(p.Code))
                .Select(p => p.Id)
                .ToListAsync();

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

        public async Task<string[]> RolesOfAsync(User user)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            return [.. await users.GetRolesAsync((await users.FindByIdAsync(user.Id.ToString()))!)];
        }

        public async Task GrantRoleAsync(string roleName, string code)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

            var role = await roles.FindByNameAsync(roleName);
            var permission = await db.Permissions.SingleAsync(p => p.Code == code);

            db.RolePermissions.Add(new RolePermission { RoleId = role!.Id, PermissionId = permission.Id });
            await db.SaveChangesAsync();
        }

        public Task<string[]> OfferedAsync(User actor) => OfferedAsync(Client(actor));

        public async Task<string[]> OfferedAsync(HttpClient client)
        {
            var response = await client.GetAsync(RolesRoute);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);

            return [.. (await response.Content.ReadFromJsonAsync<AssignableRole[]>())!.Select(r => r.Name)];
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
