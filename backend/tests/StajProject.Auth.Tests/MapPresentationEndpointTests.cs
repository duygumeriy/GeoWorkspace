using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
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
using StajProject.Api.Authorization;
using StajProject.Api.Controllers;
using StajProject.Api.Services;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.GeoServer;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Phase 5 — <c>/api/map/presentation/*</c> HTTP sınırı. Görüntü uçlarının
/// yetkisi, normal çizim VERİSİNİ görme yetkisiyle aynıdır
/// (<c>drawings.view</c>) ve rol adına bakan hiçbir kural yoktur.
/// </summary>
public class MapPresentationEndpointTests
{
    private const string Issuer = "presentation-tests";
    private const string Audience = "presentation-client";
    private const string JwtKey = "presentation-tests-use-a-long-random-key-2026-08-22";
    private static readonly byte[] Png = [137, 80, 78, 71, 13, 10, 26, 10, 5];

    public static TheoryData<string> Kinds() => new() { "point", "line", "polygon" };

    [Theory]
    [MemberData(nameof(Kinds))]
    public async Task Anonymous_request_is_rejected_with_401(string kind)
    {
        await using var host = await CreateHostAsync();

        var response = await host.Client().GetAsync(Url(kind));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(0, host.GeoServer.CallCount);
    }

    [Fact]
    public async Task Authenticated_user_without_drawings_view_is_rejected_with_403()
    {
        await using var host = await CreateHostAsync();
        await host.CreateCustomRoleAsync("Map Only", PermissionCodes.MapView);
        var user = await host.CreateUserAsync("presentation-map-only", "Map Only");

        var response = await host.Client(user).GetAsync(Url("point"));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(0, host.GeoServer.CallCount);
    }

    /// <summary>
    /// Görüntü ucu <c>inventory.analysis</c> ARAMAZ: sıradan bir kullanıcının
    /// kendi çizimlerini görmesi bir analiz yeteneği değildir.
    /// </summary>
    [Fact]
    public async Task Drawings_view_alone_is_enough()
    {
        await using var host = await CreateHostAsync();
        await host.CreateCustomRoleAsync("Drawing Reader", PermissionCodes.DrawingsView);
        var user = await host.CreateUserAsync("presentation-reader", "Drawing Reader");

        var response = await host.Client(user).GetAsync(Url("polygon"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("image/png", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(Png, await response.Content.ReadAsByteArrayAsync());
        Assert.Contains("private", response.Headers.CacheControl!.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.True(response.Headers.CacheControl.NoStore);
    }

    /// <summary>
    /// Kullanıcıya DOĞRUDAN verilen yetki de çalışır: yetkilendirme rol adına
    /// değil, etkin yetki kümesine bakar.
    /// </summary>
    [Fact]
    public async Task Direct_drawings_view_grant_is_allowed()
    {
        await using var host = await CreateHostAsync();
        await host.CreateRoleAsync("No Permissions");
        var user = await host.CreateUserAsync("presentation-direct", "No Permissions");

        Assert.Equal(HttpStatusCode.Forbidden, (await host.Client(user).GetAsync(Url("line"))).StatusCode);

        await host.GrantDirectAsync(user, PermissionCodes.DrawingsView);

        Assert.Equal(HttpStatusCode.OK, (await host.Client(user).GetAsync(Url("line"))).StatusCode);
    }

    [Fact]
    public async Task Retired_Admin_role_is_not_a_presentation_bypass()
    {
        await using var host = await CreateHostAsync();
        await host.CreateRoleAsync(ApplicationRoles.Admin);
        var user = await host.CreateUserAsync("legacy-presentation-admin", ApplicationRoles.Admin);

        Assert.Equal(HttpStatusCode.Forbidden, (await host.Client(user).GetAsync(Url("point"))).StatusCode);
    }

    [Theory]
    [InlineData("bbox=not-a-bbox&width=512&height=320")]
    [InlineData("bbox=1,2,3,4&width=63&height=320")]
    [InlineData("bbox=1,2,3,4&width=512&height=2049")]
    [InlineData("bbox=1,2,3,4&width=2147483647&height=2147483647")]
    public async Task Invalid_render_inputs_return_400_without_calling_GeoServer(string query)
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("presentation-invalid", GisRoles.GisAnalyst);

        var response = await host.Client(user).GetAsync($"/api/map/presentation/point?{query}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, host.GeoServer.CallCount);
    }

    /// <summary>
    /// İstemcinin gönderdiği hiçbir güvenlik/katalog parametresi dikkate
    /// alınmaz; başka bir kullanıcının çizimleri hedeflenemez.
    /// </summary>
    [Fact]
    public async Task Client_security_parameters_are_ignored_and_cannot_target_another_user()
    {
        await using var host = await CreateHostAsync();
        var userA = await host.CreateUserAsync("presentation-a", GisRoles.GisAnalyst);
        var userB = await host.CreateUserAsync("presentation-b", GisRoles.GisAnalyst);

        var response = await host.Client(userA).GetAsync(
            Url("point") +
            "&userId=" + userB.Id +
            "&ownerId=" + userB.Id +
            "&cql_filter=INCLUDE" +
            "&CQL_FILTER=INCLUDE" +
            "&layers=attacker:all" +
            "&styles=attacker-style" +
            "&workspace=attacker" +
            "&service=WFS" +
            "&request=GetFeature" +
            "&format=text/html");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var form = host.GeoServer.Form();
        Assert.Equal("geoworkspace:tbl_point_read", form["LAYERS"]);
        Assert.Equal("drawing_point_presentation", form["STYLES"]);
        Assert.Equal("image/png", form["FORMAT"]);
        Assert.Equal("WMS", form["SERVICE"]);
        Assert.Equal("GetMap", form["REQUEST"]);
        Assert.Equal(
            $"inserted_user_id={userA.Id} AND is_deleted=false AND is_active=true",
            form["CQL_FILTER"]);
        Assert.DoesNotContain($"inserted_user_id={userB.Id}", form["CQL_FILTER"], StringComparison.Ordinal);
        Assert.DoesNotContain("INCLUDE", form["CQL_FILTER"], StringComparison.Ordinal);
    }

    /// <summary>Uç yalnızca üç sabit türü tanır; serbest bir katman adı yoktur.</summary>
    [Fact]
    public async Task Unknown_kind_is_not_routable()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("presentation-unknown", GisRoles.GisAnalyst);

        var response = await host.Client(user).GetAsync(Url("tbl_point"));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(0, host.GeoServer.CallCount);
    }

    [Fact]
    public async Task Invalid_upstream_response_returns_502_not_a_blank_PNG()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("presentation-bad-upstream", GisRoles.GisAnalyst);
        host.GeoServer.ResponseFactory = () => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("<ServiceException/>", Encoding.UTF8, "application/xml")
        };

        var response = await host.Client(user).GetAsync(Url("line"));

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        Assert.NotEqual("image/png", response.Content.Headers.ContentType?.MediaType);
    }

    /* --- POI sunum ucu (Faz 4) ------------------------------------------------- */

    [Fact]
    public async Task Anonymous_poi_presentation_request_is_rejected_with_401()
    {
        await using var host = await CreateHostAsync();

        var response = await host.Client().GetAsync(Url("poi"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(0, host.GeoServer.CallCount);
    }

    [Fact]
    public async Task Authenticated_user_without_poi_view_is_rejected_with_403()
    {
        await using var host = await CreateHostAsync();
        await host.CreateCustomRoleAsync("Map Only", PermissionCodes.MapView);
        var user = await host.CreateUserAsync("poi-presentation-map-only", "Map Only");

        var response = await host.Client(user).GetAsync(Url("poi"));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        // Yetkisiz istek GeoServer'a HİÇ ulaşmaz.
        Assert.Equal(0, host.GeoServer.CallCount);
    }

    /// <summary>
    /// <c>drawings.view</c> POI görüntüsünü AÇMAZ.
    /// </summary>
    /// <remarks>
    /// İki envanter birbirinden bağımsızdır; çizim yetkisinin POI'yi de
    /// açması, yetki kataloğunu anlamsız kılardı.
    /// </remarks>
    [Fact]
    public async Task Drawings_view_does_not_grant_the_poi_presentation()
    {
        await using var host = await CreateHostAsync();
        await host.CreateCustomRoleAsync("Drawing Reader", PermissionCodes.DrawingsView);
        var user = await host.CreateUserAsync("poi-presentation-drawings-only", "Drawing Reader");

        Assert.Equal(HttpStatusCode.Forbidden, (await host.Client(user).GetAsync(Url("poi"))).StatusCode);
    }

    /// <summary>
    /// <c>poi.view</c> TEK BAŞINA yeterlidir — yönetici olmak gerekmez.
    /// </summary>
    [Fact]
    public async Task Poi_view_alone_is_enough()
    {
        await using var host = await CreateHostAsync();
        await host.CreateCustomRoleAsync("Poi Reader", PermissionCodes.PoiView);
        var user = await host.CreateUserAsync("poi-presentation-reader", "Poi Reader");

        var response = await host.Client(user).GetAsync(Url("poi"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("image/png", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(Png, await response.Content.ReadAsByteArrayAsync());
        Assert.Contains("private", response.Headers.CacheControl!.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.True(response.Headers.CacheControl.NoStore);
    }

    /// <summary>
    /// Doğrudan verilen yetki de çalışır: karar etkin yetki kümesine bakar,
    /// rol adına değil.
    /// </summary>
    [Fact]
    public async Task Direct_poi_view_grant_is_allowed()
    {
        await using var host = await CreateHostAsync();
        await host.CreateRoleAsync("No Permissions");
        var user = await host.CreateUserAsync("poi-presentation-direct", "No Permissions");

        Assert.Equal(HttpStatusCode.Forbidden, (await host.Client(user).GetAsync(Url("poi"))).StatusCode);

        await host.GrantDirectAsync(user, PermissionCodes.PoiView);

        Assert.Equal(HttpStatusCode.OK, (await host.Client(user).GetAsync(Url("poi"))).StatusCode);
    }

    [Fact]
    public async Task Retired_Admin_role_is_not_a_poi_presentation_bypass()
    {
        await using var host = await CreateHostAsync();
        await host.CreateRoleAsync(ApplicationRoles.Admin);
        var user = await host.CreateUserAsync("legacy-poi-presentation-admin", ApplicationRoles.Admin);

        Assert.Equal(HttpStatusCode.Forbidden, (await host.Client(user).GetAsync(Url("poi"))).StatusCode);
    }

    /// <summary>
    /// İstemcinin gönderdiği katman/style/CQL anahtarları GeoServer'a GEÇMEZ.
    /// </summary>
    /// <remarks>
    /// Sorgu dizesi kopyalanmaz; parametreler sunucuda tek tek kurulur.
    /// Tanınmayan her anahtar sessizce yok sayılır ve istek yine
    /// <c>poi_read</c> + <c>poi_all</c> ile gider.
    /// </remarks>
    [Fact]
    public async Task Client_supplied_layer_style_and_filter_are_ignored()
    {
        await using var host = await CreateHostAsync();
        await host.CreateCustomRoleAsync("Poi Reader", PermissionCodes.PoiView);
        var user = await host.CreateUserAsync("poi-presentation-override", "Poi Reader");

        var response = await host.Client(user).GetAsync(
            "/api/map/presentation/poi?bbox=-1000,-2000,3000,4000&width=512&height=320"
            + "&layers=geoworkspace:tbl_point_read&LAYERS=evil&styles=poi_eczane&STYLES=evil"
            + "&cql_filter=1%3D1&CQL_FILTER=1%3D1&sld_body=%3Cx%2F%3E&viewparams=a%3Ab"
            + "&service=WFS&request=GetFeature&workspace=other&format=image%2Fjpeg");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var form = host.GeoServer.Form();
        Assert.Equal("geoworkspace:poi_read", form["LAYERS"]);
        Assert.Equal("poi_all", form["STYLES"]);
        Assert.Equal("WMS", form["SERVICE"]);
        Assert.Equal("GetMap", form["REQUEST"]);
        Assert.Equal("image/png", form["FORMAT"]);
        Assert.DoesNotContain("CQL_FILTER", form.Keys);
        Assert.DoesNotContain("SLD_BODY", form.Keys);
        Assert.DoesNotContain("VIEWPARAMS", form.Keys);
        Assert.DoesNotContain("evil", host.GeoServer.Body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("poi_eczane", host.GeoServer.Body, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("bbox=not-a-bbox&width=512&height=320")]
    [InlineData("bbox=1,2,3&width=512&height=320")]
    [InlineData("bbox=3,2,1,4&width=512&height=320")]
    [InlineData("bbox=1,2,3,4&width=63&height=320")]
    [InlineData("bbox=1,2,3,4&width=512&height=2049")]
    public async Task Invalid_poi_viewport_is_rejected_with_400(string query)
    {
        await using var host = await CreateHostAsync();
        await host.CreateCustomRoleAsync("Poi Reader", PermissionCodes.PoiView);
        var user = await host.CreateUserAsync("poi-presentation-invalid", "Poi Reader");

        var response = await host.Client(user).GetAsync($"/api/map/presentation/poi?{query}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, host.GeoServer.CallCount);
    }

    private static string Url(string kind) =>
        $"/api/map/presentation/{kind}?bbox=-1000,-2000,3000,4000&width=512&height=320";

    private static async Task<PresentationHost> CreateHostAsync()
    {
        var databaseName = $"presentation-http-{Guid.NewGuid():N}";
        var handler = new RecordingHandler();

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

                services.AddSingleton(Options());
                services.AddScoped<ICurrentUserService, CurrentUserService>();
                services.AddScoped<IEffectivePermissionService, EffectivePermissionService>();
                services.AddSingleton<IAuthorizationPolicyProvider, PermissionPolicyProvider>();
                services.AddScoped<IAuthorizationHandler, PermissionAuthorizationHandler>();
                services.AddHttpClient<IGeoServerMapPresentationService, GeoServerMapPresentationService>()
                    .ConfigurePrimaryHttpMessageHandler(() => handler);

                services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
                    .AddJwtBearer(options => options.TokenValidationParameters = ValidationParameters());
                services.AddAuthorization();
                services.AddControllers().AddApplicationPart(typeof(MapPresentationController).Assembly);
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
        var fixture = new PresentationHost(host, handler);
        await fixture.SeedAsync();
        return fixture;
    }

    private static GeoServerOptions Options() => new()
    {
        BaseUrl = "http://geoserver.test/geoserver",
        Workspace = "geoworkspace",
        PointLayer = "tbl_point_read",
        LineLayer = "tbl_line_read",
        PolygonLayer = "tbl_polygon_read",
        HeatmapLayer = "tbl_point_heatmap",
        HeatmapStyle = "point_density_heatmap",
        PointPresentationStyle = "drawing_point_presentation",
        LinePresentationStyle = "drawing_line_presentation",
        PolygonPresentationStyle = "drawing_polygon_presentation",
        PoiLayer = "poi_read",
        PoiStyle = "poi_all",
        HeatmapTimeoutSeconds = 30,
        PresentationTimeoutSeconds = 30
    };

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

    private sealed class PresentationHost : IAsyncDisposable
    {
        private readonly IHost _host;

        public PresentationHost(IHost host, RecordingHandler geoServer)
        {
            _host = host;
            GeoServer = geoServer;
        }

        public RecordingHandler GeoServer { get; }

        public HttpClient Client(User? user = null)
        {
            var client = _host.GetTestClient();

            if (user is not null)
            {
                client.DefaultRequestHeaders.Authorization =
                    new AuthenticationHeaderValue("Bearer", Token(user));
            }

            return client;
        }

        public async Task SeedAsync()
        {
            await using var scope = _host.Services.CreateAsyncScope();
            await AuthorizationDataSeeder.SeedAsync(
                scope.ServiceProvider.GetRequiredService<AppDbContext>(),
                scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>(),
                scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("presentation-seed"));
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
                IsActive = true,
                AccountStatus = AccountStatus.Active
            };

            Assert.True((await users.CreateAsync(user, "Str0ng!Password")).Succeeded);
            Assert.True((await users.AddToRoleAsync(user, role)).Succeeded);
            return user;
        }

        public async Task CreateRoleAsync(string roleName)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

            if (!await roles.RoleExistsAsync(roleName))
            {
                Assert.True((await roles.CreateAsync(new IdentityRole<int>(roleName))).Succeeded);
            }
        }

        public async Task CreateCustomRoleAsync(string roleName, params string[] permissionCodes)
        {
            await CreateRoleAsync(roleName);
            await using var scope = _host.Services.CreateAsyncScope();
            var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var role = (await roles.FindByNameAsync(roleName))!;
            var permissionIds = await db.Permissions
                .Where(permission => permissionCodes.Contains(permission.Code))
                .Select(permission => permission.Id)
                .ToListAsync();
            db.RolePermissions.AddRange(permissionIds.Select(permissionId => new RolePermission
            {
                RoleId = role.Id,
                PermissionId = permissionId
            }));
            await db.SaveChangesAsync();
        }

        public async Task GrantDirectAsync(User user, string permissionCode)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var permission = await db.Permissions.SingleAsync(item => item.Code == permissionCode);
            db.UserPermissions.Add(new UserPermission { UserId = user.Id, PermissionId = permission.Id });
            await db.SaveChangesAsync();
        }

        public async ValueTask DisposeAsync()
        {
            await _host.StopAsync();
            _host.Dispose();
        }

        private string Token(User user)
        {
            using var scope = _host.Services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            var roles = users.GetRolesAsync(user).GetAwaiter().GetResult();
            var claims = new List<Claim>
            {
                new(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new(ClaimTypes.Name, user.UserName!)
            };
            claims.AddRange(roles.Select(role => new Claim(ClaimTypes.Role, role)));

            var token = new JwtSecurityToken(
                Issuer,
                Audience,
                claims,
                expires: DateTime.UtcNow.AddMinutes(5),
                signingCredentials: new SigningCredentials(
                    new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtKey)),
                    SecurityAlgorithms.HmacSha256));
            return new JwtSecurityTokenHandler().WriteToken(token);
        }
    }

    public sealed class RecordingHandler : HttpMessageHandler
    {
        public int CallCount { get; private set; }

        public string Body { get; private set; } = string.Empty;

        public Func<HttpResponseMessage> ResponseFactory { get; set; } = PngResponse;

        public IReadOnlyDictionary<string, string> Form() => Body
            .Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => part.Split('=', 2))
            .ToDictionary(
                part => Decode(part[0]),
                part => Decode(part.Length == 2 ? part[1] : string.Empty),
                StringComparer.Ordinal);

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            CallCount++;
            Body = await request.Content!.ReadAsStringAsync(cancellationToken);
            return ResponseFactory();
        }

        private static HttpResponseMessage PngResponse()
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new ByteArrayContent(Png)
            };
            response.Content.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            return response;
        }

        private static string Decode(string value) =>
            Uri.UnescapeDataString(value.Replace('+', ' '));
    }
}
