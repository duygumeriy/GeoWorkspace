using System.Net;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.GeoServer;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

public class GeoServerHeatmapGeographicScopeTests
{
    private const string West = "POLYGON ((32 39, 33 39, 33 40, 32 40, 32 39))";
    private const string East = "POLYGON ((35 38, 36 38, 36 39, 35 39, 35 38))";
    private const string Wide = "POLYGON ((30 37, 38 37, 38 42, 30 42, 30 37))";

    [Fact]
    public async Task Direct_user_area_drives_heatmap_and_role_area_is_ignored()
    {
        await using var scope = Scope();
        var role = await CreateRoleAsync(scope, "wide-role");
        var user = await CreateUserAsync(scope, "direct-scoped", role);
        var geographic = scope.ServiceProvider.GetRequiredService<IGeographicAuthorizationService>();
        Assert.True((await geographic.UpsertRoleAuthorizationAsync(
            role.Id, new UpdateGeographicAuthorizationRequest { Wkt = Wide })).IsSuccess);
        Assert.True((await geographic.UpsertUserAuthorizationAsync(
            user.Id, new UpdateGeographicAuthorizationRequest { Wkt = East })).IsSuccess);
        var handler = new CaptureHandler();

        var result = await Service(handler, geographic, user.Id).GetHeatmapAsync(Request(), default);

        Assert.True(result.IsSuccess, result.Error);
        var cql = handler.Form()["CQL_FILTER"];
        Assert.Contains("35 38", cql, StringComparison.Ordinal);
        Assert.DoesNotContain("30 37", cql, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Multiple_role_areas_are_unioned_and_all_components_filter_heatmap()
    {
        await using var scope = Scope();
        var westRole = await CreateRoleAsync(scope, "west-role");
        var eastRole = await CreateRoleAsync(scope, "east-role");
        var user = await CreateUserAsync(scope, "role-scoped", westRole, eastRole);
        var geographic = scope.ServiceProvider.GetRequiredService<IGeographicAuthorizationService>();
        Assert.True((await geographic.UpsertRoleAuthorizationAsync(
            westRole.Id, new UpdateGeographicAuthorizationRequest { Wkt = West })).IsSuccess);
        Assert.True((await geographic.UpsertRoleAuthorizationAsync(
            eastRole.Id, new UpdateGeographicAuthorizationRequest { Wkt = East })).IsSuccess);
        var handler = new CaptureHandler();

        var result = await Service(handler, geographic, user.Id).GetHeatmapAsync(Request(), default);

        Assert.True(result.IsSuccess, result.Error);
        var cql = handler.Form()["CQL_FILTER"];
        Assert.Contains("MULTIPOLYGON", cql, StringComparison.Ordinal);
        Assert.Contains("32 39", cql, StringComparison.Ordinal);
        Assert.Contains("35 38", cql, StringComparison.Ordinal);
    }

    private static GeoServerHeatmapService Service(
        CaptureHandler handler,
        IGeographicAuthorizationService geographic,
        int userId)
    {
        var currentUser = Substitute.For<ICurrentUserService>();
        currentUser.IsAuthenticated.Returns(true);
        currentUser.UserId.Returns(userId);
        return new GeoServerHeatmapService(
            new HttpClient(handler),
            Options(),
            currentUser,
            geographic,
            NullLogger<GeoServerHeatmapService>.Instance);
    }

    private static HeatmapRequest Request() => new()
    {
        Bbox = "-1000,-2000,3000,4000",
        Width = 256,
        Height = 256
    };

    private static GeoServerOptions Options() => new()
    {
        BaseUrl = "http://geoserver.test/geoserver",
        Workspace = "geoworkspace",
        PointLayer = "tbl_point_read",
        LineLayer = "tbl_line_read",
        PolygonLayer = "tbl_polygon_read",
        HeatmapLayer = "tbl_point_heatmap",
        HeatmapStyle = "point_density_heatmap"
    };

    private static AsyncServiceScope Scope()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
        services.AddDbContext<AppDbContext>(options =>
            options.UseInMemoryDatabase($"heatmap-geographic-{Guid.NewGuid():N}"));
        services.AddIdentityCore<User>(options => options.Password.RequiredLength = 8)
            .AddRoles<IdentityRole<int>>()
            .AddEntityFrameworkStores<AppDbContext>()
            .AddDefaultTokenProviders();
        services.AddScoped<IGeographicAuthorizationService, GeographicAuthorizationService>();
        return services.BuildServiceProvider().CreateAsyncScope();
    }

    private static async Task<IdentityRole<int>> CreateRoleAsync(AsyncServiceScope scope, string name)
    {
        var manager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();
        var role = new IdentityRole<int>(name);
        Assert.True((await manager.CreateAsync(role)).Succeeded);
        return role;
    }

    private static async Task<User> CreateUserAsync(
        AsyncServiceScope scope,
        string name,
        params IdentityRole<int>[] roles)
    {
        var manager = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var user = new User
        {
            UserName = name,
            Email = $"{name}@example.invalid",
            EmailConfirmed = true,
            IsActive = true,
            AccountStatus = AccountStatus.Active
        };
        Assert.True((await manager.CreateAsync(user, "Str0ng!Password")).Succeeded);

        foreach (var role in roles)
        {
            Assert.True((await manager.AddToRoleAsync(user, role.Name!)).Succeeded);
        }

        return user;
    }

    private sealed class CaptureHandler : HttpMessageHandler
    {
        private string _body = string.Empty;

        public IReadOnlyDictionary<string, string> Form() => _body
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
            _body = await request.Content!.ReadAsStringAsync(cancellationToken);
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new ByteArrayContent([137, 80, 78, 71, 13, 10, 26, 10])
            };
            response.Content.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            return response;
        }

        private static string Decode(string value) =>
            Uri.UnescapeDataString(value.Replace('+', ' '));
    }
}
