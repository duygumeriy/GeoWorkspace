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
/// Konum analizi ucunun yetki kapısı, GERÇEK HTTP hattı üzerinde.
/// </summary>
/// <remarks>
/// <para>
/// Gerçek controller, gerçek JWT bearer authentication, gerçek policy
/// sağlayıcı/handler ve gerçek <see cref="EffectivePermissionService"/> aynı
/// hatta bağlanır; yalnızca veritabanı in-memory'dir ve analiz servisi
/// substitute'tur — böylece 403 alan bir istekte servisin <b>HİÇ çağrılmadığı</b>
/// doğrulanabilir. Yetkilendirme, iş mantığı çalışmadan ÖNCE durmalıdır.
/// <see cref="PoiApiAuthorizationTests"/> ile aynı kalıp.
/// </para>
/// <para>
/// <b>Asıl iddia İKİ yetkinin BİRLİKTE arandığıdır.</b>
/// <c>location.analysis</c> analizi ÇALIŞTIRMA yeteneğidir; <c>poi.view</c>
/// POI envanterini GÖRME yeteneğidir. Sayı da bir bilgidir: POI göremeyen
/// birine "burada 382 POI var" demek, göremediği verinin varlığını sızdırmak
/// olurdu.
/// </para>
/// <para>
/// <b>Rol adı hiçbir kararda geçmez.</b> Kanonik bir rol taşımayan, adı bile
/// kaynakta bulunmayan özel bir rol de — hatta hiç rolü olmayan bir kullanıcı
/// da — doğru kodlara sahipse aynı uçtan geçer.
/// </para>
/// </remarks>
public class LocationAnalysisEndpointTests
{
    private const string JwtKey = "test-only-key-that-is-long-enough-for-hmac-sha256-signing";
    private const string Issuer = "StajProject.Tests";
    private const string Audience = "StajProject.Tests.Client";

    private const string Route = "/api/analysis/location";

    private static readonly string[] Both = [PermissionCodes.LocationAnalysis, PermissionCodes.PoiView];

    /* --- Kimlik doğrulama -------------------------------------------------------- */

    [Fact]
    public async Task An_anonymous_request_is_rejected_with_401()
    {
        await using var host = await CreateHostAsync();

        var response = await host.Client().PostAsync(Route, Json(ValidRequest()));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        await host.AssertServiceNeverCalledAsync();
    }

    /* --- Coğrafi yetki reddi: DÖRT uçla AYNI kod ---------------------------------- */

    [Fact]
    public async Task A_geographically_forbidden_area_is_403_on_the_summary_too()
    {
        /* <b>Ölçülen tutarsızlık buydu.</b> Yetki alanı dışındaki bir il için
           raster, nokta listesi, isabet testi ve nokta örtüsü 403 döndürürken
           ÖZET 400 döndürüyordu. İstemci o zaman "gönderdiğin geometri bozuk"
           ile "bu alana yetkin yok"u aynı kodda görür ve yetki uyarısını
           gösteremezdi. */
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync("geo-kisitli", "Coğrafi Kısıtlı", Both);

        host.Analysis
            .AnalyzeAsync(Arg.Any<LocationAnalysisRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<LocationAnalysisResponse>.Forbidden(
                "Seçilen alan coğrafi yetki alanınızın dışında."));

        var response = await host.Client(user).PostAsync(Route, Json(ValidRequest()));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    /* --- Yetki bileşimleri -------------------------------------------------------- */

    [Fact]
    public async Task Both_permissions_together_are_allowed()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync("konum-analisti", "Konum Analisti", Both);

        var response = await host.Client(user).PostAsync(Route, Json(ValidRequest()));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        await host.Analysis.Received(1).AnalyzeAsync(
            Arg.Any<LocationAnalysisRequest>(),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Location_analysis_alone_is_rejected_with_403()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync(
            "yalniz-analiz", "Yalnız Analiz", [PermissionCodes.LocationAnalysis]);

        var response = await host.Client(user).PostAsync(Route, Json(ValidRequest()));

        /* poi.view olmadan sayı bile dönmemelidir: bir sayı da bir bilgidir ve
           görülemeyen envanterin büyüklüğünü sızdırır. */
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        await host.AssertServiceNeverCalledAsync();
    }

    [Fact]
    public async Task Poi_view_alone_is_rejected_with_403()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync(
            "yalniz-poi", "Yalnız POI", [PermissionCodes.PoiView]);

        /* POI görebilmek, ağırlıklı konum analizi ÇALIŞTIRABİLMEK demek
           değildir; ikisi ayrı yeteneklerdir. */
        var response = await host.Client(user).PostAsync(Route, Json(ValidRequest()));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        await host.AssertServiceNeverCalledAsync();
    }

    [Fact]
    public async Task Neither_permission_is_rejected_with_403()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync(
            "yetkisiz", "Yetkisiz Rol", [PermissionCodes.MapView]);

        var response = await host.Client(user).PostAsync(Route, Json(ValidRequest()));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        await host.AssertServiceNeverCalledAsync();
    }

    [Fact]
    public async Task Neighbouring_analysis_permissions_do_not_open_this_endpoint()
    {
        await using var host = await CreateHostAsync();

        /* inventory.analysis ve heatmap.view, konum analizini AÇMAZ: üçü ayrı
           yeteneklerdir ve farklı veri kümelerine bakar. poi.view de veriliyor
           ki reddin sebebi yalnızca location.analysis'in eksikliği olsun. */
        var user = await host.CreateUserWithCustomRoleAsync(
            "diger-analist",
            "Diğer Analist",
            [PermissionCodes.InventoryAnalysis, PermissionCodes.HeatmapView, PermissionCodes.PoiView]);

        var response = await host.Client(user).PostAsync(Route, Json(ValidRequest()));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        await host.AssertServiceNeverCalledAsync();
    }

    /* --- Rol adından bağımsızlık --------------------------------------------------- */

    [Fact]
    public async Task A_direct_grant_without_any_role_is_allowed()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithoutRoleAsync("dogrudan-yetkili");

        await host.GrantDirectAsync(user, PermissionCodes.LocationAnalysis);
        await host.GrantDirectAsync(user, PermissionCodes.PoiView);

        var response = await host.Client(user).PostAsync(Route, Json(ValidRequest()));

        /* Kullanıcının HİÇ rolü yoktur; erişim tamamen doğrudan grant'lardan
           gelir. Rol adına dayanan bir kestirme olsaydı bu istek reddedilirdi. */
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

        /* Yetki CANLI okunur: satır silindiğinde erişim gerçekten kapanır.
           Bir rol adı kestirmesi olsaydı, satır gitse bile kapı açık kalırdı. */
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await host.Client(user).PostAsync(Route, Json(ValidRequest()))).StatusCode);
    }

    /* --- Hata eşlemesi -------------------------------------------------------------- */

    [Fact]
    public async Task A_validation_failure_from_the_service_becomes_400()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync("dogrulama", "Doğrulama Rolü", Both);

        host.Analysis
            .AnalyzeAsync(Arg.Any<LocationAnalysisRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<LocationAnalysisResponse>.Failure("Ağırlıkların toplamı tam olarak 100 olmalıdır."));

        var response = await host.Client(user).PostAsync(Route, Json(ValidRequest()));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        // Mesaj kullanıcıya dönüktür; SQL, geometri ayrıştırıcısı ya da yığın
        // izi sızdırmaz.
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Ağırlıkların toplamı", body, StringComparison.Ordinal);
        Assert.DoesNotContain("Npgsql", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("at StajProject", body, StringComparison.Ordinal);
    }

    /* --- Mevcut uçlara dokunulmadı --------------------------------------------------- */

    [Fact]
    public async Task The_existing_intersection_endpoint_still_requires_only_inventory_analysis()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync(
            "envanter-analisti", "Envanter Analisti", [PermissionCodes.InventoryAnalysis]);

        /* Regresyon kapısı: yeni uç eklenirken kardeşinin yetki sözleşmesi
           DEĞİŞMEMİŞTİR. */
        var response = await host.Client(user)
            .PostAsync("/api/analysis/intersections", Json(new IntersectionAnalysisRequest { Wkt = "POLYGON EMPTY" }));

        Assert.NotEqual(HttpStatusCode.Forbidden, response.StatusCode);
    }

    /* --- Yardımcılar ----------------------------------------------------------------- */

    /* --- İsabet testi ucu: AYNI yetki kapısı -------------------------------------

       Nokta örtüsündeki bir noktayı incelemek için AYRI bir izin tanımlanmadı:
       aynı veriye üçüncü bir kapı açmak, yetkilendirmeyi anlamsız kılardı.
       Kapının gerçekten kapalı olduğu burada, gerçek HTTP hattında ölçülür. */

    private const string HitTestRoute = "/api/analysis/location/points/hit-test";

    [Fact]
    public async Task An_anonymous_hit_test_is_rejected_with_401()
    {
        await using var host = await CreateHostAsync();

        var response = await host.Client().PostAsync(HitTestRoute, Json(ValidHitTest()));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        await host.Analysis.DidNotReceive().HitTestAsync(
            Arg.Any<LocationAnalysisHitTestRequest>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Both_permissions_together_open_the_hit_test()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync("konum-analisti", "Konum Analisti", Both);

        var response = await host.Client(user).PostAsync(HitTestRoute, Json(ValidHitTest()));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await host.Analysis.Received(1).HitTestAsync(
            Arg.Any<LocationAnalysisHitTestRequest>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Location_analysis_alone_does_not_open_the_hit_test()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync(
            "yalniz-analiz-ht", "Yalnız Analiz", [PermissionCodes.LocationAnalysis]);

        var response = await host.Client(user).PostAsync(HitTestRoute, Json(ValidHitTest()));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        await host.Analysis.DidNotReceive().HitTestAsync(
            Arg.Any<LocationAnalysisHitTestRequest>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Poi_view_alone_does_not_open_the_hit_test()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync(
            "yalniz-poi-ht", "Yalnız POI", [PermissionCodes.PoiView]);

        var response = await host.Client(user).PostAsync(HitTestRoute, Json(ValidHitTest()));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        await host.Analysis.DidNotReceive().HitTestAsync(
            Arg.Any<LocationAnalysisHitTestRequest>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task An_empty_hit_test_result_is_a_200_not_an_error()
    {
        /* Boşluğa tıklamak sıradan bir kullanıcı davranışıdır; 404 döndürmek
           onu hataya çevirirdi. Arayüz yalnızca hiçbir şey açmaz. */
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync("bos-sonuc", "Boş Sonuç", Both);

        var response = await host.Client(user).PostAsync(HitTestRoute, Json(ValidHitTest()));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("\"poi\":null", await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task A_rejected_hit_test_becomes_a_400()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync("gecersiz-ht", "Geçersiz", Both);

        host.Analysis
            .HitTestAsync(Arg.Any<LocationAnalysisHitTestRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<LocationAnalysisHitTestResponse>.Failure(
                "latitude -90 ile 90 arasında olmalıdır."));

        var response = await host.Client(user).PostAsync(HitTestRoute, Json(ValidHitTest()));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    /* --- Vektör listesi ucu: AYNI yetki kapısı ------------------------------------ */

    private const string PointsRoute = "/api/analysis/location/points";

    [Fact]
    public async Task An_anonymous_points_request_is_rejected_with_401()
    {
        await using var host = await CreateHostAsync();

        var response = await host.Client().PostAsync(PointsRoute, Json(ValidRequest()));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        await host.Analysis.DidNotReceive().ListPointsAsync(
            Arg.Any<LocationAnalysisRequest>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Both_permissions_together_open_the_points_endpoint()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync("vektor-analist", "Vektör Analist", Both);

        var response = await host.Client(user).PostAsync(PointsRoute, Json(ValidRequest()));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await host.Analysis.Received(1).ListPointsAsync(
            Arg.Any<LocationAnalysisRequest>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Location_analysis_alone_does_not_open_the_points_endpoint()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync(
            "yalniz-analiz-pt", "Yalnız Analiz", [PermissionCodes.LocationAnalysis]);

        var response = await host.Client(user).PostAsync(PointsRoute, Json(ValidRequest()));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        await host.Analysis.DidNotReceive().ListPointsAsync(
            Arg.Any<LocationAnalysisRequest>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Poi_view_alone_does_not_open_the_points_endpoint()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync(
            "yalniz-poi-pt", "Yalnız POI", [PermissionCodes.PoiView]);

        var response = await host.Client(user).PostAsync(PointsRoute, Json(ValidRequest()));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        await host.Analysis.DidNotReceive().ListPointsAsync(
            Arg.Any<LocationAnalysisRequest>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task A_rejected_points_request_becomes_a_400()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserWithCustomRoleAsync("gecersiz-pt", "Geçersiz", Both);

        host.Analysis
            .ListPointsAsync(Arg.Any<LocationAnalysisRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<LocationAnalysisPointsResponse>.Failure(
                "Ağırlıkların toplamı 100 olmalıdır."));

        var response = await host.Client(user).PostAsync(PointsRoute, Json(ValidRequest()));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private static LocationAnalysisHitTestRequest ValidHitTest() => new()
    {
        AreaWkts = ["POLYGON ((32 39, 34 39, 34 41, 32 41, 32 39))"],
        Criteria =
        [
            new LocationAnalysisCriterionRequest { CategorySlug = "saglik-kurumlari", Weight = 60 },
            new LocationAnalysisCriterionRequest { CategorySlug = "okullar", Weight = 40 }
        ],
        Longitude = 32.852724,
        Latitude = 39.885072,
        ToleranceMeters = 250
    };

    private static LocationAnalysisRequest ValidRequest() => new()
    {
        AreaWkts = ["POLYGON ((32 39, 34 39, 34 41, 32 41, 32 39))"],
        Criteria =
        [
            new LocationAnalysisCriterionRequest { CategorySlug = "saglik-kurumlari", Weight = 60 },
            new LocationAnalysisCriterionRequest { CategorySlug = "okullar", Weight = 40 }
        ]
    };

    private static StringContent Json<T>(T body) =>
        new(System.Text.Json.JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    private static async Task<LocationAnalysisTestHost> CreateHostAsync()
    {
        var analysis = Substitute.For<ILocationAnalysisService>();
        analysis
            .AnalyzeAsync(Arg.Any<LocationAnalysisRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<LocationAnalysisResponse>.Success(new LocationAnalysisResponse()));

        analysis
            .ListPointsAsync(Arg.Any<LocationAnalysisRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<LocationAnalysisPointsResponse>.Success(
                new LocationAnalysisPointsResponse()));

        analysis
            .HitTestAsync(Arg.Any<LocationAnalysisHitTestRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<LocationAnalysisHitTestResponse>.Success(
                new LocationAnalysisHitTestResponse { Poi = null }));

        /* Envanter analizi servisi de substitute'tur: bu dosyanın konusu
           yetkilendirme hattıdır, kesişim sorgusu değil. */
        var spatial = Substitute.For<ISpatialAnalysisService>();
        spatial
            .CountIntersectionsAsync(Arg.Any<IntersectionAnalysisRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<IntersectionAnalysisResponse>.Failure("Geçersiz poligon."));

        var databaseName = $"location-analysis-endpoint-{Guid.NewGuid():N}";

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

                services.AddSingleton(analysis);
                services.AddSingleton(spatial);

                /* Görüntü ucu bu dosyanın konusu DEĞİLDİR ama controller onu
                   yapıcıda ister; kaydedilmezse DI çözümlemesi patlar ve
                   yetkilendirmeyi ölçen testler ilgisiz bir sebeple düşerdi.
                   Sözleşmesi LocationAnalysisImageEndpointTests içinde
                   ölçülür. */
                services.AddSingleton(Substitute.For<ILocationAnalysisImageService>());
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
        var fixture = new LocationAnalysisTestHost(host, analysis);
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

    private sealed class LocationAnalysisTestHost : IAsyncDisposable
    {
        private readonly IHost _host;

        public LocationAnalysisTestHost(IHost host, ILocationAnalysisService analysis)
        {
            _host = host;
            Analysis = analysis;
        }

        public ILocationAnalysisService Analysis { get; }

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

        public Task AssertServiceNeverCalledAsync()
        {
            Analysis.DidNotReceive().AnalyzeAsync(
                Arg.Any<LocationAnalysisRequest>(),
                Arg.Any<CancellationToken>());

            return Task.CompletedTask;
        }

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
