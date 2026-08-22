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
using StajProject.Application.Options;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Authentication;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// POI uçlarının yetki kapıları, GERÇEK HTTP hattı üzerinde.
/// </summary>
/// <remarks>
/// <para>
/// Gerçek controller'lar, gerçek JWT bearer authentication, gerçek policy
/// sağlayıcı/handler ve gerçek <see cref="EffectivePermissionService"/> aynı
/// hatta bağlanır; yalnızca veritabanı in-memory'dir ve <b>iş servisleri
/// substitute'tur</b> — böylece 403 alan bir istekte servisin HİÇ çağrılmadığı
/// doğrulanabilir. Yetkilendirme, iş mantığı çalışmadan ÖNCE durmalıdır.
/// </para>
/// <para>
/// <b>Asıl iddia rol adlarının hiçbir yerde geçmediğidir.</b> Erişimi yalnızca
/// etkin yetki kodları belirler: kanonik bir rol taşımayan, adı bile kaynakta
/// geçmeyen özel bir rol de aynı uçlardan geçebilir.
/// </para>
/// </remarks>
public class PoiApiAuthorizationTests
{
    private const string JwtKey = "test-only-key-that-is-long-enough-for-hmac-sha256-signing";
    private const string Issuer = "StajProject.Tests";
    private const string Audience = "StajProject.Tests.Client";

    private const string MapRoute = "/api/poi";
    private const string MapCategoriesRoute = "/api/poi/categories";
    private const string AdminRoute = "/api/admin/poi";
    private const string AdminCategoriesRoute = "/api/admin/poi/categories";

    /* --- Kimlik doğrulama ------------------------------------------------------- */

    [Theory]
    [InlineData(MapRoute)]
    [InlineData(MapCategoriesRoute)]
    [InlineData(AdminRoute)]
    [InlineData(AdminCategoriesRoute)]
    public async Task An_anonymous_request_is_rejected_with_401(string route)
    {
        await using var host = await CreateHostAsync();

        Assert.Equal(HttpStatusCode.Unauthorized, (await host.Client().GetAsync(route)).StatusCode);
    }

    [Fact]
    public async Task Anonymous_poi_creation_is_rejected_with_401()
    {
        await using var host = await CreateHostAsync();

        var response = await host.Client().PostAsJsonAsync(MapRoute, NewPoi());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        await host.Pois.DidNotReceive().CreatePoiAsync(Arg.Any<CreatePoiRequest>(), Arg.Any<CancellationToken>());
    }

    /* --- poi.view --------------------------------------------------------------- */

    [Fact]
    public async Task Reading_pois_without_poi_view_is_rejected_with_403()
    {
        await using var host = await CreateHostAsync();

        // Emekli rolün hiçbir yetki satırı yoktur.
        var user = await host.CreateUserAsync("no-poi-view", ApplicationRoles.Admin);

        var response = await host.Client(user).GetAsync(MapRoute);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        // Kritik: iş mantığı hiç çalışmadı.
        await host.Pois.DidNotReceive().GetMapPoisAsync(Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Poi_view_allows_reading_the_map_list()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("viewer", GisRoles.Viewer);

        Assert.Equal(HttpStatusCode.OK, (await host.Client(user).GetAsync(MapRoute)).StatusCode);
        await host.Pois.Received(1).GetMapPoisAsync(Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task The_category_dropdown_is_gated_by_poi_view_not_category_management()
    {
        /* POI ekleyebilen ama taksonomiyi yönetemeyen biri formu doldurabilmeli.
           Kapı poi.categories.manage olsaydı, açılır liste asla yüklenmezdi. */
        await using var host = await CreateHostAsync();
        var viewer = await host.CreateUserAsync("dropdown-viewer", GisRoles.Viewer);

        Assert.Equal(HttpStatusCode.OK, (await host.Client(viewer).GetAsync(MapCategoriesRoute)).StatusCode);
        await host.Categories.Received(1).GetActiveCategoriesAsync(Arg.Any<CancellationToken>());

        var stranger = await host.CreateUserAsync("dropdown-stranger", ApplicationRoles.User);
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Client(stranger).GetAsync(MapCategoriesRoute)).StatusCode);
    }

    /* --- poi.create ------------------------------------------------------------- */

    [Fact]
    public async Task Creating_a_poi_without_poi_create_is_rejected_with_403()
    {
        await using var host = await CreateHostAsync();

        // Viewer POI görebilir ama EKLEYEMEZ.
        var user = await host.CreateUserAsync("viewer-cannot-create", GisRoles.Viewer);

        var response = await host.Client(user).PostAsJsonAsync(MapRoute, NewPoi());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        await host.Pois.DidNotReceive().CreatePoiAsync(Arg.Any<CreatePoiRequest>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Poi_create_allows_posting_a_poi()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("editor", GisRoles.GisEditor);

        var response = await host.Client(user).PostAsJsonAsync(MapRoute, NewPoi());

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        await host.Pois.Received(1).CreatePoiAsync(Arg.Any<CreatePoiRequest>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task A_direct_user_permission_allows_creation_without_changing_the_role()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("viewer-plus", GisRoles.Viewer);

        await host.GrantDirectAsync(user, PermissionCodes.PoiCreate);

        Assert.Equal(HttpStatusCode.Created,
            (await host.Client(user).PostAsJsonAsync(MapRoute, NewPoi())).StatusCode);
        Assert.Equal([GisRoles.Viewer], await host.RolesOfAsync(user));
    }

    /* --- poi.manage ------------------------------------------------------------- */

    [Fact]
    public async Task The_admin_poi_list_requires_poi_manage()
    {
        await using var host = await CreateHostAsync();

        // GIS Editor POI ekleyebilir ama envanteri YÖNETEMEZ.
        var editor = await host.CreateUserAsync("editor-not-manager", GisRoles.GisEditor);
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Client(editor).GetAsync(AdminRoute)).StatusCode);
        await host.Pois.DidNotReceive().GetAdminPoisAsync(Arg.Any<CancellationToken>());

        var manager = await host.CreateUserAsync("manager", GisRoles.GisManager);
        Assert.Equal(HttpStatusCode.OK, (await host.Client(manager).GetAsync(AdminRoute)).StatusCode);
        await host.Pois.Received(1).GetAdminPoisAsync(Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Poi_view_alone_does_not_open_the_admin_list()
    {
        /* Haritada pin görmek ile kimin neyi eklediğini listeleyebilmek farklı
           yeteneklerdir; poi.manage bilinçli olarak poi.view'in altına
           gizlenmemiştir. */
        await using var host = await CreateHostAsync();
        var viewer = await host.CreateUserAsync("viewer-not-manager", GisRoles.Viewer);

        Assert.Equal(HttpStatusCode.Forbidden, (await host.Client(viewer).GetAsync(AdminRoute)).StatusCode);
    }

    /* --- poi.categories.manage --------------------------------------------------- */

    [Fact]
    public async Task Admin_category_reads_require_poi_categories_manage()
    {
        await using var host = await CreateHostAsync();

        var editor = await host.CreateUserAsync("editor-no-categories", GisRoles.GisEditor);
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Client(editor).GetAsync(AdminCategoriesRoute)).StatusCode);
        await host.Categories.DidNotReceive().GetAdminCategoriesAsync(Arg.Any<CancellationToken>());

        var manager = await host.CreateUserAsync("manager-categories", GisRoles.GisManager);
        Assert.Equal(HttpStatusCode.OK, (await host.Client(manager).GetAsync(AdminCategoriesRoute)).StatusCode);
    }

    [Fact]
    public async Task Creating_a_category_requires_poi_categories_manage()
    {
        await using var host = await CreateHostAsync();

        var editor = await host.CreateUserAsync("editor-no-create-category", GisRoles.GisEditor);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await host.Client(editor).PostAsJsonAsync(AdminCategoriesRoute, NewCategory())).StatusCode);
        await host.Categories.DidNotReceive().CreateCategoryAsync(
            Arg.Any<CreatePoiCategoryRequest>(), Arg.Any<CancellationToken>());

        var manager = await host.CreateUserAsync("manager-create-category", GisRoles.GisManager);
        Assert.Equal(HttpStatusCode.Created,
            (await host.Client(manager).PostAsJsonAsync(AdminCategoriesRoute, NewCategory())).StatusCode);
    }

    [Fact]
    public async Task Updating_a_category_requires_poi_categories_manage()
    {
        await using var host = await CreateHostAsync();

        var editor = await host.CreateUserAsync("editor-no-update-category", GisRoles.GisEditor);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await host.Client(editor).PutAsJsonAsync($"{AdminCategoriesRoute}/7", NewCategoryUpdate())).StatusCode);
        await host.Categories.DidNotReceive().UpdateCategoryAsync(
            Arg.Any<int>(), Arg.Any<UpdatePoiCategoryRequest>(), Arg.Any<CancellationToken>());

        var manager = await host.CreateUserAsync("manager-update-category", GisRoles.GisManager);
        Assert.Equal(HttpStatusCode.OK,
            (await host.Client(manager).PutAsJsonAsync($"{AdminCategoriesRoute}/7", NewCategoryUpdate())).StatusCode);
        await host.Categories.Received(1).UpdateCategoryAsync(
            7, Arg.Any<UpdatePoiCategoryRequest>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task There_is_no_category_delete_endpoint()
    {
        // Silme ödevin kapsamında değildir ve uç YOKTUR; yetkili bir çağıran
        // bile 404/405 alır, sessizce çalışan bir yol bulamaz.
        await using var host = await CreateHostAsync();
        var manager = await host.CreateUserAsync("manager-delete-attempt", GisRoles.GisManager);

        var response = await host.Client(manager).DeleteAsync($"{AdminCategoriesRoute}/7");

        Assert.NotEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.NotEqual(HttpStatusCode.NoContent, response.StatusCode);
    }

    /* --- Rol adına bağlı olmama --------------------------------------------------- */

    [Fact]
    public async Task A_custom_role_with_the_poi_codes_passes_every_operator_gate()
    {
        /* Ödevin "Operatör" rolü KANONİK DEĞİLDİR ve kaynakta hiç geçmez;
           yalnızca rol yönetimi ekranından tanımlanmış bir özel roldür.
           Uçlardan geçebilmesinin tek sebebi taşıdığı yetki KODLARIDIR. */
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync(
            "operator-user",
            "Operatör",
            [PermissionCodes.MapView, PermissionCodes.PoiView, PermissionCodes.PoiCreate]);

        var client = host.Client(user);

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(MapRoute)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(MapCategoriesRoute)).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync(MapRoute, NewPoi())).StatusCode);

        // Operatör bir yönetici DEĞİLDİR: yönetim uçları kapalı kalır.
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(AdminRoute)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(AdminCategoriesRoute)).StatusCode);
    }

    [Fact]
    public async Task Revoking_the_role_grant_closes_the_endpoint()
    {
        // Erişim gerçekten yetki satırındandır: satır silinince uç kapanır.
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("viewer-losing-access", GisRoles.Viewer);

        Assert.Equal(HttpStatusCode.OK, (await host.Client(user).GetAsync(MapRoute)).StatusCode);

        await host.RevokeRoleGrantAsync(GisRoles.Viewer, PermissionCodes.PoiView);

        Assert.Equal(HttpStatusCode.Forbidden, (await host.Client(user).GetAsync(MapRoute)).StatusCode);
    }

    /* --- Yardımcılar --------------------------------------------------------------- */

    private static CreatePoiRequest NewPoi() => new()
    {
        Name = "Test POI",
        CategoryId = 1,
        Longitude = 32.85,
        Latitude = 39.93
    };

    private static CreatePoiCategoryRequest NewCategory() => new() { Name = "Yeme-İçme" };

    private static UpdatePoiCategoryRequest NewCategoryUpdate() => new() { Name = "Yeme-İçme", IsActive = true };

    private static async Task<PoiTestHost> CreateHostAsync()
    {
        var pois = Substitute.For<IPoiService>();
        pois.GetMapPoisAsync(Arg.Any<CancellationToken>()).Returns(Array.Empty<PoiResponse>());
        pois.GetAdminPoisAsync(Arg.Any<CancellationToken>()).Returns(Array.Empty<AdminPoiResponse>());
        pois.CreatePoiAsync(Arg.Any<CreatePoiRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<PoiResponse>.Success(new PoiResponse()));

        var categories = Substitute.For<IPoiCategoryService>();
        categories.GetActiveCategoriesAsync(Arg.Any<CancellationToken>()).Returns(Array.Empty<PoiCategoryResponse>());
        categories.GetAdminCategoriesAsync(Arg.Any<CancellationToken>()).Returns(Array.Empty<AdminPoiCategoryResponse>());
        categories.CreateCategoryAsync(Arg.Any<CreatePoiCategoryRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<AdminPoiCategoryResponse>.Success(new AdminPoiCategoryResponse()));
        categories.UpdateCategoryAsync(Arg.Any<int>(), Arg.Any<UpdatePoiCategoryRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<AdminPoiCategoryResponse>.Success(new AdminPoiCategoryResponse()));

        var databaseName = $"poi-authorization-{Guid.NewGuid():N}";

        var builder = new HostBuilder().ConfigureWebHost(web =>
        {
            web.UseTestServer();
            web.ConfigureServices(services =>
            {
                services.AddLogging(logging => logging.SetMinimumLevel(LogLevel.Warning));
                services.AddHttpContextAccessor();

                services.AddDbContext<AppDbContext>(options => options.UseInMemoryDatabase(databaseName));

                services.AddIdentityCore<User>(options => options.Password.RequiredLength = 8)
                    .AddRoles<IdentityRole<int>>()
                    .AddEntityFrameworkStores<AppDbContext>();

                services.AddSingleton(pois);
                services.AddSingleton(categories);
                services.AddScoped<ICurrentUserService, CurrentUserService>();

                /* Üretimdeki yetkilendirme hattının AYNISI; test kendi
                   yetkilendirme mantığını kurmaz. */
                services.AddScoped<IEffectivePermissionService, EffectivePermissionService>();
                services.AddSingleton<IAuthorizationPolicyProvider, PermissionPolicyProvider>();
                services.AddScoped<IAuthorizationHandler, PermissionAuthorizationHandler>();

                services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
                    .AddJwtBearer(options => options.TokenValidationParameters = ValidationParameters());

                services.AddAuthorization(options =>
                    options.AddPolicy(AuthorizationPolicies.AuthenticatedUser, p => p.RequireAuthenticatedUser()));

                services.AddControllers().AddApplicationPart(typeof(PoiController).Assembly);
            });

            web.Configure(app =>
            {
                app.UseRouting();
                app.UseAuthentication();
                app.UseAuthorization();
                app.UseEndpoints(endpoints => endpoints.MapControllers());
            });
        });

        var host = await builder.StartAsync();
        var fixture = new PoiTestHost(host, pois, categories);
        await fixture.SeedAuthorizationAsync();
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

    private sealed class PoiTestHost : IAsyncDisposable
    {
        private readonly IHost _host;

        public PoiTestHost(IHost host, IPoiService pois, IPoiCategoryService categories)
        {
            _host = host;
            Pois = pois;
            Categories = categories;
        }

        public IPoiService Pois { get; }

        public IPoiCategoryService Categories { get; }

        public async Task SeedAuthorizationAsync()
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

            foreach (var role in ApplicationRoles.Retired)
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
            var manager = scope.ServiceProvider.GetRequiredService<UserManager<User>>();

            var user = new User
            {
                UserName = userName,
                Email = $"{userName}@example.invalid",
                EmailConfirmed = true,
                AccountStatus = AccountStatus.Active,
                IsActive = true
            };

            Assert.True((await manager.CreateAsync(user, "Str0ng!Password")).Succeeded);
            Assert.True((await manager.AddToRoleAsync(user, role)).Succeeded);
            return user;
        }

        /// <summary>
        /// Yöneticinin rol ekranından tanımlayabileceği ÖZEL bir rol ve ona
        /// açıkça verilmiş yetkiler. Kanonik listeye hiçbir şey eklenmez.
        /// </summary>
        public async Task<User> CreateUserWithCustomRoleAsync(
            string userName,
            string roleName,
            string[] permissionCodes)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            Assert.True(RoleCatalog.IsCustom(roleName));
            Assert.True((await roles.CreateAsync(new IdentityRole<int>(roleName))).Succeeded);

            var role = await roles.FindByNameAsync(roleName);

            foreach (var code in permissionCodes)
            {
                var permission = await db.Permissions.SingleAsync(p => p.Code == code);
                db.RolePermissions.Add(new RolePermission { RoleId = role!.Id, PermissionId = permission.Id });
            }

            await db.SaveChangesAsync();

            return await CreateUserAsync(userName, roleName);
        }

        public async Task GrantDirectAsync(User user, string permissionCode)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var permission = await db.Permissions.SingleAsync(p => p.Code == permissionCode);

            db.UserPermissions.Add(new UserPermission { UserId = user.Id, PermissionId = permission.Id });
            await db.SaveChangesAsync();
        }

        public async Task RevokeRoleGrantAsync(string roleName, string permissionCode)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

            var role = await roles.FindByNameAsync(roleName);
            var permission = await db.Permissions.SingleAsync(p => p.Code == permissionCode);

            db.RolePermissions.Remove(
                await db.RolePermissions.SingleAsync(rp => rp.RoleId == role!.Id && rp.PermissionId == permission.Id));
            await db.SaveChangesAsync();
        }

        public async Task<string[]> RolesOfAsync(User user)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var manager = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            var tracked = await manager.FindByIdAsync(user.Id.ToString());
            return [.. await manager.GetRolesAsync(tracked!)];
        }

        public HttpClient Client() => _host.GetTestClient();

        public HttpClient Client(User user)
        {
            var roles = RolesOfAsync(user).GetAwaiter().GetResult();
            var tokens = new JwtTokenService(new JwtOptions
            {
                Key = JwtKey,
                Issuer = Issuer,
                Audience = Audience,
                ExpireMinutes = 10
            });

            var (token, _) = tokens.GenerateToken(user.Id, user.UserName!, roles, AuthenticationLevel.MultiFactor);

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

file static class PoiHttpClientJsonExtensions
{
    public static Task<HttpResponseMessage> PostAsJsonAsync<T>(this HttpClient client, string route, T body) =>
        client.PostAsync(route, Json(body));

    public static Task<HttpResponseMessage> PutAsJsonAsync<T>(this HttpClient client, string route, T body) =>
        client.PutAsync(route, Json(body));

    private static StringContent Json<T>(T body) =>
        new(System.Text.Json.JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
}
