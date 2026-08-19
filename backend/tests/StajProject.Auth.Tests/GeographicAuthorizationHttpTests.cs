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
/// Coğrafi yetki alanı yönetim uçlarının HTTP sözleşmesi ve yetkilendirmesi.
/// </summary>
/// <remarks>
/// <para>
/// <b>İki BAĞIMSIZ yetki birlikte aranır.</b> Hedefin türü için gereken yetki
/// (<c>users.*</c> / <c>roles.*</c>) ve coğrafi yönetim yeteneği
/// (<c>geography.view</c> / <c>geography.manage</c>). Testlerin ağırlığı
/// buradadır: yalnızca birine sahip olmak yetmemelidir — aksi hâlde kullanıcı
/// düzenleme yetkisi sessizce coğrafi sınır kaldırma yetkisine dönüşürdü.
/// </para>
/// <para>
/// <b>Karar VERİDEN gelir.</b> Uygun kodlara sahip özel bir rol uçları
/// kullanabilir; kodları alınmış bir <c>Administrator</c> kullanamaz. Rol adına
/// bakan hiçbir kural yoktur.
/// </para>
/// </remarks>
public class GeographicAuthorizationHttpTests
{
    private const string JwtKey = "geographic-authorization-http-tests-signing-key-0123456789";
    private const string Issuer = "StajProject.Api";
    private const string Audience = "StajProject.Client";

    private const string Area = "POLYGON ((32 39, 33 39, 33 40, 32 40, 32 39))";
    private const string OtherArea = "POLYGON ((35 38, 36 38, 36 39, 35 39, 35 38))";

    private static readonly string[] UserRead = [PermissionCodes.UsersView, PermissionCodes.GeographyView];
    private static readonly string[] UserWrite = [PermissionCodes.UsersUpdate, PermissionCodes.GeographyManage];
    private static readonly string[] RoleRead = [PermissionCodes.RolesView, PermissionCodes.GeographyView];
    private static readonly string[] RoleWrite = [PermissionCodes.RolesUpdate, PermissionCodes.GeographyManage];

    /* --- Kimlik ve ikinci faktör ---------------------------------------------------- */

    [Fact]
    public async Task An_anonymous_request_is_rejected()
    {
        await using var host = await StartAsync();
        var target = await host.CreateUserAsync("anon-target");

        Assert.Equal(HttpStatusCode.Unauthorized, (await host.Client().GetAsync(UserRoute(target.Id))).StatusCode);
    }

    [Fact]
    public async Task A_password_only_token_is_rejected()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("single-factor", [.. UserRead, .. UserWrite]);
        var target = await host.CreateUserAsync("sf-target");

        // Yetki tam; eksik olan ikinci faktör. MFA şartı bu fazda GEVŞEMEZ.
        var response = await host.Client(actor, AuthenticationLevel.Password).GetAsync(UserRoute(target.Id));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    /* --- Kullanıcı hedefi: okuma ----------------------------------------------------- */

    [Theory]
    [InlineData(PermissionCodes.UsersView)]
    [InlineData(PermissionCodes.GeographyView)]
    public async Task Reading_a_user_area_needs_both_permissions(string onlyCode)
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync($"read-{onlyCode}", [onlyCode]);
        var target = await host.CreateUserAsync("read-target");

        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await host.Client(actor).GetAsync(UserRoute(target.Id))).StatusCode);
    }

    [Fact]
    public async Task Reading_a_user_without_an_area_reports_no_restriction_rather_than_404()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("reader", UserRead);
        var target = await host.CreateUserAsync("unscoped-target");

        var response = await host.Client(actor).GetAsync(UserRoute(target.Id));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<GeographicAuthorizationResponse>();

        /* Kullanıcı VAR, yalnızca kısıtı yok. 404 döndürmek "hedef yok" derdi ve
           yönetici ekranını var olmayan bir hata durumuna sokardı. */
        Assert.NotNull(body);
        Assert.False(body!.HasDirectAuthorization);
        Assert.Null(body.Wkt);
        Assert.False(body.IsRestricted);
    }

    [Fact]
    public async Task Reading_a_missing_user_is_a_404()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("missing-reader", UserRead);

        Assert.Equal(HttpStatusCode.NotFound, (await host.Client(actor).GetAsync(UserRoute(999999))).StatusCode);
    }

    /* --- Kullanıcı hedefi: yazma ----------------------------------------------------- */

    [Theory]
    [InlineData(PermissionCodes.UsersUpdate)]
    [InlineData(PermissionCodes.GeographyManage)]
    public async Task Writing_a_user_area_needs_both_permissions(string onlyCode)
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync($"write-{onlyCode}", [onlyCode]);
        var target = await host.CreateUserAsync("write-target");

        var response = await host.Client(actor).PutAsJsonAsync(UserRoute(target.Id), Body(Area));

        /* Asıl güvenlik iddiası: users.update TEK BAŞINA coğrafi sınırı
           değiştirmeye yetmez. Yetseydi, kullanıcı düzenleyebilen herkes
           kendi kısıtını da kaldırabilirdi. */
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.False(await host.HasAreaForUserAsync(target.Id));
    }

    [Fact]
    public async Task An_authorized_actor_assigns_and_replaces_a_user_area()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("writer", [.. UserRead, .. UserWrite]);
        var target = await host.CreateUserAsync("assigned");

        var created = await host.Client(actor).PutAsJsonAsync(UserRoute(target.Id), Body(Area));
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);

        var replaced = await host.Client(actor).PutAsJsonAsync(UserRoute(target.Id), Body(OtherArea));
        Assert.Equal(HttpStatusCode.OK, replaced.StatusCode);

        var body = await replaced.Content.ReadFromJsonAsync<GeographicAuthorizationResponse>();
        Assert.True(body!.HasDirectAuthorization);
        Assert.True(body.IsRestricted);

        // PUT upsert'tir: ikinci çağrı aynı satırı günceller, yenisini açmaz.
        Assert.Equal(1, await host.AreaRowCountAsync());
    }

    [Fact]
    public async Task Deleting_a_user_area_is_idempotent()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("deleter", [.. UserRead, .. UserWrite]);
        var target = await host.CreateUserAsync("to-clear");

        await host.Client(actor).PutAsJsonAsync(UserRoute(target.Id), Body(Area));

        Assert.Equal(HttpStatusCode.OK, (await host.Client(actor).DeleteAsync(UserRoute(target.Id))).StatusCode);
        Assert.False(await host.HasAreaForUserAsync(target.Id));

        /* İkinci DELETE de başarılıdır: istenen son durum ("bu kullanıcıya özel
           alan yok") zaten sağlanmıştır. İki kez tıklayan yöneticiye var
           olmayan bir sorun bildirilmez. */
        Assert.Equal(HttpStatusCode.OK, (await host.Client(actor).DeleteAsync(UserRoute(target.Id))).StatusCode);
    }

    [Fact]
    public async Task Deleting_a_user_area_falls_back_to_the_role_area()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("fallback-admin", [.. UserRead, .. UserWrite, .. RoleWrite]);
        var role = await host.CreateRoleAsync("Bölge Ekibi");
        var target = await host.CreateUserAsync("inheritor", role.Name!);

        await host.Client(actor).PutAsJsonAsync(RoleRoute(role.Id), Body(OtherArea));
        await host.Client(actor).PutAsJsonAsync(UserRoute(target.Id), Body(Area));

        await host.Client(actor).DeleteAsync(UserRoute(target.Id));

        var body = await (await host.Client(actor).GetAsync(UserRoute(target.Id)))
            .Content.ReadFromJsonAsync<GeographicAuthorizationResponse>();

        // Kendi alanı gitti ama rolünden gelen kısıt sürüyor.
        Assert.False(body!.HasDirectAuthorization);
        Assert.True(body.IsRestricted);
        Assert.NotNull(body.EffectiveWkt);
    }

    /* --- Rol hedefi ------------------------------------------------------------------ */

    [Theory]
    [InlineData(PermissionCodes.RolesView)]
    [InlineData(PermissionCodes.GeographyView)]
    public async Task Reading_a_role_area_needs_both_permissions(string onlyCode)
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync($"role-read-{onlyCode}", [onlyCode]);
        var role = await host.CreateRoleAsync("Okunacak Rol");

        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await host.Client(actor).GetAsync(RoleRoute(role.Id))).StatusCode);
    }

    [Theory]
    [InlineData(PermissionCodes.RolesUpdate)]
    [InlineData(PermissionCodes.GeographyManage)]
    public async Task Writing_a_role_area_needs_both_permissions(string onlyCode)
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync($"role-write-{onlyCode}", [onlyCode]);
        var role = await host.CreateRoleAsync("Yazılacak Rol");

        var response = await host.Client(actor).PutAsJsonAsync(RoleRoute(role.Id), Body(Area));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(0, await host.AreaRowCountAsync());
    }

    [Fact]
    public async Task An_authorized_actor_manages_a_role_area()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("role-manager", [.. RoleRead, .. RoleWrite]);
        var role = await host.CreateRoleAsync("Saha Ekibi");

        Assert.Equal(HttpStatusCode.OK, (await host.Client(actor).PutAsJsonAsync(RoleRoute(role.Id), Body(Area))).StatusCode);

        var body = await (await host.Client(actor).GetAsync(RoleRoute(role.Id)))
            .Content.ReadFromJsonAsync<GeographicAuthorizationResponse>();

        // Rol için "kendi alanı" ile "yürürlükteki alan" daima aynıdır.
        Assert.True(body!.HasDirectAuthorization);
        Assert.True(body.IsRestricted);
        Assert.Equal(body.Wkt, body.EffectiveWkt);

        Assert.Equal(HttpStatusCode.OK, (await host.Client(actor).DeleteAsync(RoleRoute(role.Id))).StatusCode);
        Assert.Equal(0, await host.AreaRowCountAsync());
    }

    [Fact]
    public async Task A_missing_role_is_a_404()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("role-missing", [.. RoleRead, .. RoleWrite]);

        Assert.Equal(HttpStatusCode.NotFound, (await host.Client(actor).GetAsync(RoleRoute(999999))).StatusCode);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await host.Client(actor).PutAsJsonAsync(RoleRoute(999999), Body(Area))).StatusCode);
    }

    /* --- Geometri doğrulaması --------------------------------------------------------- */

    [Theory]
    [InlineData("POINT (32 39)")]
    [InlineData("LINESTRING (32 39, 33 40)")]
    [InlineData("POLYGON EMPTY")]
    [InlineData("POLYGON ((32 39, 33 40, 33 39, 32 40, 32 39))")]   // kendisiyle kesişen
    [InlineData("SRID=3857;POLYGON ((3500000 4800000, 3600000 4800000, 3600000 4900000, 3500000 4900000, 3500000 4800000))")]
    [InlineData("POLYGON ((200 39, 201 39, 201 40, 200 40, 200 39))")] // boylam aralık dışı
    [InlineData("kesinlikle wkt değil")]
    [InlineData(null)]
    public async Task An_invalid_area_is_a_400_and_writes_nothing(string? wkt)
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync($"invalid-{Math.Abs(wkt?.GetHashCode() ?? 0)}", [.. UserRead, .. UserWrite]);
        var target = await host.CreateUserAsync("invalid-target");

        var response = await host.Client(actor).PutAsJsonAsync(UserRoute(target.Id), Body(wkt));

        /* Bozuk geometri bir YETKİ sorunu değildir: 403 demek, isteği düzeltmek
           yerine yetkisini sorgulamasına yol açardı. */
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, await host.AreaRowCountAsync());
    }

    /* --- Veriye dayalı yetkilendirme --------------------------------------------------- */

    [Fact]
    public async Task A_custom_role_with_the_right_codes_can_manage_areas()
    {
        await using var host = await StartAsync();

        /* Adı hiçbir yerde özel anlam taşımayan bir rol ("Role-geography-operator").
           Yetkiyi veren şey adı değil, taşıdığı yetki satırlarıdır. */
        var actor = await host.CreateActorAsync("geography-operator", [.. UserRead, .. UserWrite]);
        var target = await host.CreateUserAsync("operated");

        Assert.Equal(
            HttpStatusCode.OK,
            (await host.Client(actor).PutAsJsonAsync(UserRoute(target.Id), Body(Area))).StatusCode);
    }

    [Fact]
    public async Task An_administrator_without_the_codes_is_refused()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateUserAsync("nominal-admin", GisRoles.Administrator);
        var target = await host.CreateUserAsync("admin-target");

        // Administrator rolünden coğrafi yönetim yetkisi geri alınır.
        await host.RevokeRoleGrantAsync(GisRoles.Administrator, PermissionCodes.GeographyManage);

        var response = await host.Client(actor).PutAsJsonAsync(UserRoute(target.Id), Body(Area));

        /* Rol adı hâlâ "Administrator". Erişim kaybolduysa sebebi tek bir
           satırın silinmiş olmasıdır — adı değil. */
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(0, await host.AreaRowCountAsync());
    }

    /* --- Yardımcılar -------------------------------------------------------------------- */

    private static string UserRoute(int userId) => $"/api/admin/users/{userId}/geographic-authorization";

    private static string RoleRoute(int roleId) => $"/api/admin/roles/{roleId}/geographic-authorization";

    private static UpdateGeographicAuthorizationRequest Body(string? wkt) => new() { Wkt = wkt };

    private static async Task<GeographicHost> StartAsync()
    {
        var databaseName = $"geographic-http-{Guid.NewGuid():N}";

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

                // İş servisleri GERÇEK: sınanan şey filtrenin geçirdiği isteğin
                // serviste de doğru karşılanmasıdır.
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

        var host = new GeographicHost(await builder.StartAsync());
        await host.SeedAsync();
        return host;
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

    private sealed class GeographicHost : IAsyncDisposable
    {
        private readonly IHost _host;

        public GeographicHost(IHost host) => _host = host;

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

        public async Task<IdentityRole<int>> CreateRoleAsync(string name)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();
            var role = new IdentityRole<int>(name);
            Assert.True((await roles.CreateAsync(role)).Succeeded);
            return role;
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

        public async Task<User> CreateUserAsync(string userName, string? role = null)
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

            if (role is not null)
            {
                Assert.True((await users.AddToRoleAsync(user, role)).Succeeded);
            }

            return user;
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

        public async Task<bool> HasAreaForUserAsync(int userId)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>()
                .GeographicAuthorizations.AsNoTracking().AnyAsync(g => g.UserId == userId);
        }

        public async Task<int> AreaRowCountAsync()
        {
            await using var scope = _host.Services.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>()
                .GeographicAuthorizations.AsNoTracking().CountAsync();
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
