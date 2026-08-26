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
/// Ağırlıklı ısı haritası ucunun yetki kapısı ve hata eşlemesi, GERÇEK HTTP
/// hattı üzerinde.
/// </summary>
/// <remarks>
/// <para>
/// <b>Görüntü de bir bilgidir.</b> Uç, özet ucuyla BİREBİR aynı iki yetkiyi
/// arar: aynı veriden üretilen bir yoğunluk resmine, sayıya erişemeyen birinin
/// erişebilmesi yetkilendirmeyi anlamsız kılardı. Kalıp
/// <see cref="LocationAnalysisEndpointTests"/> ile aynıdır; servis
/// substitute'tur, böylece 403 alan bir istekte servisin <b>HİÇ çağrılmadığı</b>
/// doğrulanabilir.
/// </para>
/// <para>
/// GeoServer bu dosyanın konusu DEĞİLDİR: istek bileşimi
/// <see cref="GeoServerLocationAnalysisImageServiceTests"/> içinde ölçülür.
/// </para>
/// </remarks>
public class LocationAnalysisImageEndpointTests
{
    private const string JwtKey = "test-only-key-that-is-long-enough-for-hmac-sha256-signing";
    private const string Issuer = "StajProject.Tests";
    private const string Audience = "StajProject.Tests.Client";

    private const string Route = "/api/analysis/location/image";

    private static readonly byte[] Png = [137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3];
    private static readonly string[] Both = [PermissionCodes.LocationAnalysis, PermissionCodes.PoiView];

    /* --- Kimlik doğrulama -------------------------------------------------------- */

    [Fact]
    public async Task An_anonymous_request_is_rejected_with_401()
    {
        await using var host = await CreateHostAsync();

        var response = await host.Client().PostAsync(Route, Json(ValidRequest()));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        host.AssertServiceNeverCalled();
    }

    /* --- Yetki bileşimleri -------------------------------------------------------- */

    [Fact]
    public async Task Both_permissions_together_return_a_PNG()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync("konum-analisti", "Konum Analisti", Both);

        var response = await host.Client(user).PostAsync(Route, Json(ValidRequest()));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("image/png", response.Content.Headers.ContentType!.MediaType);
        Assert.Equal(Png, await response.Content.ReadAsByteArrayAsync());

        await host.Image.Received(1).RenderAsync(
            Arg.Any<LocationAnalysisImageRequest>(),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Location_analysis_alone_is_rejected_with_403()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync(
            "yalniz-analiz", "Yalnız Analiz", [PermissionCodes.LocationAnalysis]);

        var response = await host.Client(user).PostAsync(Route, Json(ValidRequest()));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        host.AssertServiceNeverCalled();
    }

    [Fact]
    public async Task Poi_view_alone_is_rejected_with_403()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync("yalniz-poi", "Yalnız POI", [PermissionCodes.PoiView]);

        var response = await host.Client(user).PostAsync(Route, Json(ValidRequest()));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        host.AssertServiceNeverCalled();
    }

    [Fact]
    public async Task Neither_permission_is_rejected_with_403()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync("yetkisiz", "Yetkisiz Rol", [PermissionCodes.MapView]);

        var response = await host.Client(user).PostAsync(Route, Json(ValidRequest()));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        host.AssertServiceNeverCalled();
    }

    [Fact]
    public async Task Heatmap_view_does_not_open_this_endpoint()
    {
        await using var host = await CreateHostAsync();

        /* Mevcut ısı haritası yetkisi, konum analizinin ısı haritasını AÇMAZ:
           iki özellik farklı veri kümelerine bakar ve farklı sorular yanıtlar.
           poi.view de veriliyor ki reddin sebebi yalnızca location.analysis'in
           eksikliği olsun. */
        var user = await host.CreateUserWithCustomRoleAsync(
            "isi-haritasi", "Isı Haritası Rolü", [PermissionCodes.HeatmapView, PermissionCodes.PoiView]);

        var response = await host.Client(user).PostAsync(Route, Json(ValidRequest()));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        host.AssertServiceNeverCalled();
    }

    [Fact]
    public async Task A_direct_grant_without_any_role_is_allowed()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithoutRoleAsync("dogrudan-yetkili");

        await host.GrantDirectAsync(user, PermissionCodes.LocationAnalysis);
        await host.GrantDirectAsync(user, PermissionCodes.PoiView);

        var response = await host.Client(user).PostAsync(Route, Json(ValidRequest()));

        Assert.Empty(await host.RolesOfAsync(user));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Revoking_location_analysis_closes_the_endpoint_immediately()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync("gecici-analist", "Geçici Analist", Both);

        Assert.Equal(HttpStatusCode.OK, (await host.Client(user).PostAsync(Route, Json(ValidRequest()))).StatusCode);

        await host.RevokeRoleGrantAsync("Geçici Analist", PermissionCodes.LocationAnalysis);

        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await host.Client(user).PostAsync(Route, Json(ValidRequest()))).StatusCode);
    }

    /* --- Önbellek ------------------------------------------------------------------- */

    [Fact]
    public async Task The_image_is_never_cached_by_an_intermediary()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync("onbellek", "Önbellek Rolü", Both);

        var response = await host.Client(user).PostAsync(Route, Json(ValidRequest()));

        /* Görüntü kullanıcının seçtiği ölçütlere özeldir; paylaşılan bir ara
           önbellekte tutulması, bir kullanıcının analizini başkasına
           göstermek olurdu. */
        var cacheControl = response.Headers.CacheControl!;

        // Yönergeler üzerinden sınanır, metin üzerinden DEĞİL: HTTP yığını
        // sıralamayı yeniden yazabilir ve test o sıralamaya bağlı olmamalıdır.
        Assert.True(cacheControl.Private);
        Assert.True(cacheControl.NoStore);
        Assert.Equal("no-cache", response.Headers.Pragma.Single().Name);
    }

    /* --- Hata eşlemesi -------------------------------------------------------------- */

    [Fact]
    public async Task A_validation_failure_becomes_400()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync("dogrulama", "Doğrulama Rolü", Both);

        host.Image
            .RenderAsync(Arg.Any<LocationAnalysisImageRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<LocationAnalysisImage>.Failure("Ağırlıkların toplamı tam olarak 100 olmalıdır."));

        var response = await host.Client(user).PostAsync(Route, Json(ValidRequest()));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Ağırlıkların toplamı", body, StringComparison.Ordinal);
        Assert.DoesNotContain("Npgsql", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("at StajProject", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_upstream_failure_becomes_502()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync("upstream", "Upstream Rolü", Both);

        host.Image
            .RenderAsync(Arg.Any<LocationAnalysisImageRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<LocationAnalysisImage>.Upstream("GeoServer geçerli bir PNG yanıtı döndürmedi."));

        var response = await host.Client(user).PostAsync(Route, Json(ValidRequest()));

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
    }

    [Fact]
    public async Task An_upstream_timeout_becomes_504()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync("zaman-asimi", "Zaman Aşımı Rolü", Both);

        host.Image
            .RenderAsync(Arg.Any<LocationAnalysisImageRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<LocationAnalysisImage>.Timeout("GeoServer isteği zaman aşımına uğradı."));

        var response = await host.Client(user).PostAsync(Route, Json(ValidRequest()));

        Assert.Equal(HttpStatusCode.GatewayTimeout, response.StatusCode);
    }

    [Fact]
    public async Task An_unexpected_exception_becomes_a_uniform_500()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync("patlama", "Patlama Rolü", Both);

        host.Image
            .RenderAsync(Arg.Any<LocationAnalysisImageRequest>(), Arg.Any<CancellationToken>())
            .Returns<ServiceResult<LocationAnalysisImage>>(_ =>
                throw new InvalidOperationException("Host=localhost;Password=gizli"));

        var response = await host.Client(user).PostAsync(Route, Json(ValidRequest()));

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);

        // Bağlantı dizesi ya da yığın izi ASLA istemciye ulaşmaz.
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("Password", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("localhost", body, StringComparison.OrdinalIgnoreCase);
    }

    /* --- Kardeş uç değişmedi --------------------------------------------------------- */

    [Fact]
    public async Task The_summary_endpoint_still_answers_on_its_own_route()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync("ozet", "Özet Rolü", Both);

        /* Regresyon kapısı: görüntü ucu eklenirken özet ucu bir raster ucuna
           DÖNÜŞTÜRÜLMEDİ. */
        var response = await host.Client(user).PostAsync("/api/analysis/location", Json(ValidRequest()));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType!.MediaType);
    }

    /* --- Yardımcılar ----------------------------------------------------------------- */

    private static LocationAnalysisImageRequest ValidRequest() => new()
    {
        AreaWkts = ["POLYGON ((32 39, 34 39, 34 41, 32 41, 32 39))"],
        Criteria =
        [
            new LocationAnalysisCriterionRequest { CategorySlug = "saglik-kurumlari", Weight = 60 },
            new LocationAnalysisCriterionRequest { CategorySlug = "okullar", Weight = 40 }
        ],
        // EPSG:4326 pencere: uç artık analiz alanıyla aynı CRS'i kullanır.
        Bbox = "32.5,39.5,33.5,40.5",
        Width = 512,
        Height = 320
    };

    private static StringContent Json<T>(T body) =>
        new(System.Text.Json.JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    private static async Task<ImageTestHost> CreateHostAsync()
    {
        var image = Substitute.For<ILocationAnalysisImageService>();
        image
            .RenderAsync(Arg.Any<LocationAnalysisImageRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<LocationAnalysisImage>.Success(new LocationAnalysisImage { Content = Png }));

        var analysis = Substitute.For<ILocationAnalysisService>();
        analysis
            .AnalyzeAsync(Arg.Any<LocationAnalysisRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<LocationAnalysisResponse>.Success(new LocationAnalysisResponse()));

        var spatial = Substitute.For<ISpatialAnalysisService>();

        var databaseName = $"location-analysis-image-endpoint-{Guid.NewGuid():N}";

        var builder = new HostBuilder().ConfigureWebHost(web =>
        {
            web.UseTestServer();
            web.ConfigureServices(services =>
            {
                services.AddLogging(logging => logging.SetMinimumLevel(LogLevel.Critical));
                services.AddHttpContextAccessor();

                services.AddDbContext<AppDbContext>(options => options.UseInMemoryDatabase(databaseName));

                services.AddIdentityCore<User>(options => options.Password.RequiredLength = 8)
                    .AddRoles<IdentityRole<int>>()
                    .AddEntityFrameworkStores<AppDbContext>();

                services.AddSingleton(image);
                services.AddSingleton(analysis);
                services.AddSingleton(spatial);
                services.AddScoped<ICurrentUserService, CurrentUserService>();

                services.AddScoped<IEffectivePermissionService, EffectivePermissionService>();
                services.AddSingleton<IAuthorizationPolicyProvider, PermissionPolicyProvider>();
                services.AddScoped<IAuthorizationHandler, PermissionAuthorizationHandler>();

                services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
                    .AddJwtBearer(options => options.TokenValidationParameters = ValidationParameters());

                services.AddAuthorization(options =>
                    options.AddPolicy(AuthorizationPolicies.AuthenticatedUser, p => p.RequireAuthenticatedUser()));

                services.AddControllers().AddApplicationPart(typeof(AnalysisController).Assembly);
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
        var fixture = new ImageTestHost(host, image);
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

    private sealed class ImageTestHost : IAsyncDisposable
    {
        private readonly IHost _host;

        public ImageTestHost(IHost host, ILocationAnalysisImageService image)
        {
            _host = host;
            Image = image;
        }

        public ILocationAnalysisImageService Image { get; }

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

        public void AssertServiceNeverCalled() =>
            Image.DidNotReceive().RenderAsync(
                Arg.Any<LocationAnalysisImageRequest>(),
                Arg.Any<CancellationToken>());

        public async Task<User> CreateUserWithoutRoleAsync(string userName)
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

            return user;
        }

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

            var user = await CreateUserWithoutRoleAsync(userName);

            var manager = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            var tracked = await manager.FindByIdAsync(user.Id.ToString());
            Assert.True((await manager.AddToRoleAsync(tracked!, roleName)).Succeeded);

            return user;
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
