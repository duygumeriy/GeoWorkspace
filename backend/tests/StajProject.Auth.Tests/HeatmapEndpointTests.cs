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
using NSubstitute;
using StajProject.Api.Authorization;
using StajProject.Api.Controllers;
using StajProject.Api.Services;
using StajProject.Application.Geographic;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.GeoServer;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

public class HeatmapEndpointTests
{
    private const string Issuer = "heatmap-tests";
    private const string Audience = "heatmap-client";
    private const string JwtKey = "heatmap-tests-use-a-long-random-key-2026-08-22";
    private static readonly byte[] Png = [137, 80, 78, 71, 13, 10, 26, 10, 1];

    [Fact]
    public async Task Anonymous_request_is_rejected_with_401()
    {
        await using var host = await CreateHostAsync();

        var response = await host.Client().GetAsync(Url());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(0, host.GeoServer.CallCount);
    }

    [Fact]
    public async Task Authenticated_user_without_inventory_analysis_is_rejected_with_403()
    {
        await using var host = await CreateHostAsync();
        var viewer = await host.CreateUserAsync("heatmap-viewer", GisRoles.Viewer);

        var response = await host.Client(viewer).GetAsync(Url());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(0, host.GeoServer.CallCount);
    }

    [Fact]
    public async Task Canonical_analyst_receives_private_raw_PNG()
    {
        await using var host = await CreateHostAsync();
        var analyst = await host.CreateUserAsync("heatmap-analyst", GisRoles.GisAnalyst);

        var response = await host.Client(analyst).GetAsync(Url());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("image/png", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(Png, await response.Content.ReadAsByteArrayAsync());
        Assert.Contains("private", response.Headers.CacheControl!.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.True(response.Headers.CacheControl.NoStore);
    }

    [Fact]
    public async Task Custom_role_with_inventory_analysis_is_allowed()
    {
        await using var host = await CreateHostAsync();
        const string role = "Custom Heatmap Analyst";
        await host.CreateCustomRoleAsync(role, PermissionCodes.InventoryAnalysis);
        var user = await host.CreateUserAsync("custom-heatmap", role);

        Assert.Equal(HttpStatusCode.OK, (await host.Client(user).GetAsync(Url())).StatusCode);
    }

    [Fact]
    public async Task Direct_inventory_analysis_grant_is_allowed()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("direct-heatmap", GisRoles.Viewer);
        await host.GrantDirectAsync(user, PermissionCodes.InventoryAnalysis);

        Assert.Equal(HttpStatusCode.OK, (await host.Client(user).GetAsync(Url())).StatusCode);
    }

    [Fact]
    public async Task Retired_Admin_role_is_not_a_heatmap_bypass()
    {
        await using var host = await CreateHostAsync();
        await host.CreateRoleAsync(ApplicationRoles.Admin);
        var user = await host.CreateUserAsync("legacy-heatmap-admin", ApplicationRoles.Admin);

        Assert.Equal(HttpStatusCode.Forbidden, (await host.Client(user).GetAsync(Url())).StatusCode);
    }

    [Theory]
    [InlineData("bbox=not-a-bbox&width=512&height=320")]
    [InlineData("bbox=1,2,3,4&width=63&height=320")]
    [InlineData("bbox=1,2,3,4&width=512&height=2049")]
    [InlineData("bbox=1,2,3,4&width=2147483647&height=2147483647")]
    public async Task Invalid_render_inputs_return_400_without_calling_GeoServer(string query)
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("invalid-heatmap", GisRoles.GisAnalyst);

        var response = await host.Client(user).GetAsync($"/api/heatmap/image?{query}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, host.GeoServer.CallCount);
    }

    [Fact]
    public async Task Client_security_parameters_are_ignored_and_cannot_target_another_user()
    {
        await using var host = await CreateHostAsync();
        var userA = await host.CreateUserAsync("heatmap-user-a", GisRoles.GisAnalyst);
        var userB = await host.CreateUserAsync("heatmap-user-b", GisRoles.GisAnalyst);

        var response = await host.Client(userA).GetAsync(
            Url() +
            "&userId=" + userB.Id +
            "&ownerId=" + userB.Id +
            "&cql_filter=INCLUDE" +
            "&layers=attacker:all" +
            "&styles=attacker-style" +
            "&workspace=attacker");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var form = host.GeoServer.Form();
        Assert.Equal("geoworkspace:tbl_point_heatmap", form["LAYERS"]);
        Assert.Equal("point_density_heatmap", form["STYLES"]);
        Assert.Equal(
            $"inserted_user_id={userA.Id} AND is_deleted=false AND is_active=true",
            form["CQL_FILTER"]);
        Assert.DoesNotContain($"inserted_user_id={userB.Id}", form["CQL_FILTER"], StringComparison.Ordinal);
        Assert.DoesNotContain("INCLUDE", form["CQL_FILTER"], StringComparison.Ordinal);
    }

    [Fact]
    public async Task Invalid_upstream_response_returns_502_not_a_blank_PNG()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("bad-upstream", GisRoles.GisAnalyst);
        host.GeoServer.ResponseFactory = () => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("<ServiceException/>", Encoding.UTF8, "application/xml")
        };

        var response = await host.Client(user).GetAsync(Url());

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        Assert.NotEqual("image/png", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Live_authenticated_backend_to_GeoServer_smoke()
    {
        if (!string.Equals(
                Environment.GetEnvironmentVariable("RUN_LIVE_HEATMAP_SMOKE"),
                "1",
                StringComparison.Ordinal))
        {
            return;
        }

        await using var host = await CreateHostAsync(useLiveGeoServer: true);
        var user = await host.CreateUserAsync("live-heatmap-analyst", GisRoles.GisAnalyst);
        var response = await host.Client(user).GetAsync(
            "/api/heatmap/image?bbox=2782987,4163881,5009377,5311972&width=512&height=320");
        var bytes = await response.Content.ReadAsByteArrayAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("image/png", response.Content.Headers.ContentType?.MediaType);
        Assert.True(bytes.AsSpan().StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }));
        Assert.Equal(512, ReadBigEndianInt32(bytes, 16));
        Assert.Equal(320, ReadBigEndianInt32(bytes, 20));
        Assert.True(response.Headers.CacheControl!.NoStore);
        Assert.Contains("private", response.Headers.CacheControl.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.Contains(
            $"inserted_user_id={user.Id} AND is_deleted=false AND is_active=true",
            host.GeoServer.Form()["CQL_FILTER"],
            StringComparison.Ordinal);
    }

    private static string Url() =>
        "/api/heatmap/image?bbox=-1000,-2000,3000,4000&width=512&height=320";

    private static async Task<HeatmapHost> CreateHostAsync(bool useLiveGeoServer = false)
    {
        var databaseName = $"heatmap-http-{Guid.NewGuid():N}";
        var handler = new RecordingHandler(useLiveGeoServer);
        var geographic = Substitute.For<IGeographicAuthorizationService>();
        geographic.GetEffectiveAuthorizationAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns(EffectiveGeographicAuthorization.Unrestricted);

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

                services.AddSingleton(Options(useLiveGeoServer));
                services.AddSingleton(geographic);
                services.AddScoped<ICurrentUserService, CurrentUserService>();
                services.AddScoped<IEffectivePermissionService, EffectivePermissionService>();
                services.AddSingleton<IAuthorizationPolicyProvider, PermissionPolicyProvider>();
                services.AddScoped<IAuthorizationHandler, PermissionAuthorizationHandler>();
                services.AddHttpClient<IGeoServerHeatmapService, GeoServerHeatmapService>()
                    .ConfigurePrimaryHttpMessageHandler(() => handler);

                services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
                    .AddJwtBearer(options => options.TokenValidationParameters = ValidationParameters());
                services.AddAuthorization();
                services.AddControllers().AddApplicationPart(typeof(HeatmapController).Assembly);
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
        var fixture = new HeatmapHost(host, handler);
        await fixture.SeedAsync();
        return fixture;
    }

    private static GeoServerOptions Options(bool useLiveGeoServer) => new()
    {
        BaseUrl = useLiveGeoServer
            ? "http://127.0.0.1:8080/geoserver"
            : "http://geoserver.test/geoserver",
        Workspace = "geoworkspace",
        PointLayer = "tbl_point_read",
        LineLayer = "tbl_line_read",
        PolygonLayer = "tbl_polygon_read",
        HeatmapLayer = "tbl_point_heatmap",
        HeatmapStyle = "point_density_heatmap",
        PointPresentationStyle = "drawing_point_presentation",
        LinePresentationStyle = "drawing_line_presentation",
        PolygonPresentationStyle = "drawing_polygon_presentation",
        HeatmapTimeoutSeconds = 30
    };

    private static int ReadBigEndianInt32(byte[] bytes, int offset) =>
        (bytes[offset] << 24)
        | (bytes[offset + 1] << 16)
        | (bytes[offset + 2] << 8)
        | bytes[offset + 3];

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

    private sealed class HeatmapHost : IAsyncDisposable
    {
        private readonly IHost _host;

        public HeatmapHost(IHost host, RecordingHandler geoServer)
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
                scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("heatmap-seed"));
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
        private readonly HttpMessageInvoker? _liveInvoker;

        public RecordingHandler(bool useLiveGeoServer = false)
        {
            if (useLiveGeoServer)
            {
                _liveInvoker = new HttpMessageInvoker(new HttpClientHandler());
            }
        }

        public int CallCount { get; private set; }

        public string Body { get; private set; } = string.Empty;

        public Func<HttpResponseMessage> ResponseFactory { get; set; } = () => PngResponse();

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
            return _liveInvoker is null
                ? ResponseFactory()
                : await _liveInvoker.SendAsync(request, cancellationToken);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _liveInvoker?.Dispose();
            }

            base.Dispose(disposing);
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
