using System.IdentityModel.Tokens.Jwt;
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
using StajProject.Api.Common;
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
/// Yetki denetiminin GERÇEK HTTP hattı üzerinden doğrulanması.
/// </summary>
/// <remarks>
/// <para>
/// Gerçek controller'lar, gerçek JWT bearer authentication, gerçek policy
/// sağlayıcı/handler ve gerçek <see cref="EffectivePermissionService"/> aynı
/// hatta bağlanır; yalnızca veritabanı in-memory'dir ve <b>iş servisleri
/// substitute'tur</b>.
/// </para>
/// <para>
/// İş servislerinin substitute olması bilinçlidir: böylece 403 alan bir
/// istekte servisin HİÇ çağrılmadığı doğrulanabilir. Yetkilendirme, iş
/// mantığı çalışmadan ÖNCE durmalıdır — veri okunup sonra "aslında
/// göstermeyeyim" denmesi bir bilgi sızıntısı olurdu.
/// </para>
/// </remarks>
public class PermissionEnforcementTests
{
    private const string JwtKey = "test-only-key-that-is-long-enough-for-hmac-sha256-signing";
    private const string Issuer = "StajProject.Tests";
    private const string Audience = "StajProject.Tests.Client";

    /* --- Kimlik doğrulama / 401 ------------------------------------------------ */

    [Fact]
    public async Task An_anonymous_request_is_rejected_with_401()
    {
        await using var host = await CreateHostAsync();

        var response = await host.Client().GetAsync("/api/drawings/points");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        await host.Drawings.DidNotReceive().GetPointsAsync(Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task An_anonymous_request_to_an_admin_endpoint_is_rejected_with_401()
    {
        await using var host = await CreateHostAsync();

        var response = await host.Client().GetAsync("/api/admin/users");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /* --- Yetki yoksa 403 ------------------------------------------------------- */

    [Fact]
    public async Task An_authenticated_user_without_the_permission_is_rejected_with_403()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("viewer", GisRoles.Viewer);

        // Viewer çizim görebilir ama nokta OLUŞTURAMAZ.
        var response = await host.Client(user).PostAsJsonAsync("/api/drawings/point", NewDrawing());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        // Kritik: iş mantığı hiç çalışmadı.
        await host.Drawings.DidNotReceive().CreatePointAsync(
            Arg.Any<CreateDrawingRequest>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task A_role_granted_permission_allows_the_request()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("editor", GisRoles.GisEditor);

        var response = await host.Client(user).PostAsJsonAsync("/api/drawings/point", NewDrawing());

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        await host.Drawings.Received(1).CreatePointAsync(
            Arg.Any<CreateDrawingRequest>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task A_direct_user_permission_allows_the_request_without_changing_the_role()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("viewer-plus", GisRoles.Viewer);

        // Rolü DEĞİŞMEDEN yalnızca kişisel bir yetki ekleniyor.
        await host.GrantDirectAsync(user, PermissionCodes.DrawingsPointCreate);

        var response = await host.Client(user).PostAsJsonAsync("/api/drawings/point", NewDrawing());

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal([GisRoles.Viewer], await host.RolesOfAsync(user));
    }

    [Fact]
    public async Task Viewer_can_read_drawings()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("reader", GisRoles.Viewer);

        var response = await host.Client(user).GetAsync("/api/drawings/points");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("/api/drawings/point", PermissionCodes.DrawingsPointCreate)]
    [InlineData("/api/drawings/line", PermissionCodes.DrawingsLineCreate)]
    [InlineData("/api/drawings/polygon", PermissionCodes.DrawingsPolygonCreate)]
    public async Task Each_create_endpoint_requires_its_own_geometry_permission(string route, string requiredCode)
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync($"creator{route.GetHashCode():X}", GisRoles.Viewer);

        Assert.Equal(HttpStatusCode.Forbidden,
            (await host.Client(user).PostAsJsonAsync(route, NewDrawing())).StatusCode);

        await host.GrantDirectAsync(user, requiredCode);

        Assert.Equal(HttpStatusCode.Created,
            (await host.Client(user).PostAsJsonAsync(route, NewDrawing())).StatusCode);
    }

    [Fact]
    public async Task Analysis_requires_the_inventory_analysis_permission()
    {
        await using var host = await CreateHostAsync();

        var viewer = await host.CreateUserAsync("no-analysis", GisRoles.Viewer);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await host.Client(viewer).PostAsJsonAsync("/api/analysis/intersections", new { wkt = "POLYGON EMPTY" })).StatusCode);

        var analyst = await host.CreateUserAsync("analyst", GisRoles.GisAnalyst);
        Assert.Equal(HttpStatusCode.OK,
            (await host.Client(analyst).PostAsJsonAsync("/api/analysis/intersections", new { wkt = "POLYGON EMPTY" })).StatusCode);
    }

    /* --- Canlı veritabanı durumu anında etkili ---------------------------------- */

    [Fact]
    public async Task Deactivating_a_permission_denies_the_request_without_a_new_token()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("editor-revoked", GisRoles.GisEditor);
        var client = host.Client(user);

        Assert.Equal(HttpStatusCode.Created,
            (await client.PostAsJsonAsync("/api/drawings/point", NewDrawing())).StatusCode);

        await host.DeactivatePermissionAsync(PermissionCodes.DrawingsPointCreate);

        /* AYNI token, yeni login yok, token yenilemesi yok. Yetkiler JWT'ye
           claim olarak yazılmadığı için değişiklik anında etkilidir. */
        Assert.Equal(HttpStatusCode.Forbidden,
            (await client.PostAsJsonAsync("/api/drawings/point", NewDrawing())).StatusCode);
    }

    [Fact]
    public async Task Suspending_an_account_denies_the_existing_token_immediately()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("to-be-suspended", GisRoles.GisEditor);
        var client = host.Client(user);

        Assert.Equal(HttpStatusCode.Created,
            (await client.PostAsJsonAsync("/api/drawings/point", NewDrawing())).StatusCode);

        await host.SetAccountStatusAsync(user, AccountStatus.Suspended);

        // Token hâlâ imza/süre olarak geçerli — reddi sağlayan şey canlı hesap durumu.
        Assert.Equal(HttpStatusCode.Forbidden,
            (await client.PostAsJsonAsync("/api/drawings/point", NewDrawing())).StatusCode);
    }

    [Fact]
    public async Task Deactivating_an_account_denies_the_existing_token_immediately()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("to-be-deactivated", GisRoles.GisEditor);
        var client = host.Client(user);

        await host.SetAccountActiveAsync(user, isActive: false);

        Assert.Equal(HttpStatusCode.Forbidden,
            (await client.PostAsJsonAsync("/api/drawings/point", NewDrawing())).StatusCode);
    }

    /* --- Yönetim uçları: MFA + yetki ------------------------------------------- */

    [Fact]
    public async Task An_admin_endpoint_rejects_a_token_without_a_completed_second_factor()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("admin-no-mfa", GisRoles.Administrator);

        // Yetki tam ama ikinci faktör yok.
        var response = await host.Client(user, AuthenticationLevel.Password).GetAsync("/api/admin/users");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        await host.Users.DidNotReceive().GetUsersAsync(Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task An_admin_endpoint_rejects_a_completed_second_factor_without_the_permission()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("editor-with-mfa", GisRoles.GisEditor);

        // MFA tamam ama users.view yok.
        var response = await host.Client(user).GetAsync("/api/admin/users");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        await host.Users.DidNotReceive().GetUsersAsync(Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Retired_Admin_with_mfa_cannot_read_the_user_list_by_role_name()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("legacy-admin", ApplicationRoles.Admin);

        var response = await host.Client(user).GetAsync("/api/admin/users");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Administrator_role_with_mfa_can_read_the_user_list_without_the_legacy_admin_role()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("target-administrator", GisRoles.Administrator);

        /* Bu, fazın asıl kazancıdır: kullanıcı legacy `Admin` rolüne SAHİP
           DEĞİL. Eskiden AdminMfaRequired rol adını şart koştuğu için
           engellenirdi; artık erişimi yetki satırları belirliyor. */
        Assert.DoesNotContain(ApplicationRoles.Admin, await host.RolesOfAsync(user));

        var response = await host.Client(user).GetAsync("/api/admin/users");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Retired_Admin_is_not_a_permission_bypass()
    {
        await using var host = await CreateHostAsync();
        var user = await host.CreateUserAsync("legacy-admin-stripped", ApplicationRoles.Admin);
        var client = host.Client(user);

        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/admin/users")).StatusCode);
    }

    [Fact]
    public async Task The_approval_role_list_requires_the_roles_view_permission()
    {
        await using var host = await CreateHostAsync();

        var manager = await host.CreateUserAsync("gis-manager", GisRoles.GisManager);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await host.Client(manager).GetAsync("/api/admin/users/roles")).StatusCode);

        var admin = await host.CreateUserAsync("roles-admin", GisRoles.Administrator);
        Assert.Equal(HttpStatusCode.OK,
            (await host.Client(admin).GetAsync("/api/admin/users/roles")).StatusCode);
    }

    [Fact]
    public async Task Anonymous_user_creation_is_rejected_with_401()
    {
        await using var host = await CreateHostAsync();

        var response = await host.Client().PostAsJsonAsync("/api/admin/users", NewAdminUser());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        await host.Users.DidNotReceive().CreateUserAsync(
            Arg.Any<CreateAdminUserRequest>(), Arg.Any<int>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task User_creation_without_completed_mfa_is_rejected_with_403()
    {
        await using var host = await CreateHostAsync();
        var administrator = await host.CreateUserAsync("create-no-mfa", GisRoles.Administrator);

        var response = await host.Client(administrator, AuthenticationLevel.Password)
            .PostAsJsonAsync("/api/admin/users", NewAdminUser());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        await host.Users.DidNotReceive().CreateUserAsync(
            Arg.Any<CreateAdminUserRequest>(), Arg.Any<int>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task User_creation_without_users_create_is_rejected_with_403()
    {
        await using var host = await CreateHostAsync();
        var editor = await host.CreateUserAsync("create-no-permission", GisRoles.GisEditor);

        var response = await host.Client(editor)
            .PostAsJsonAsync("/api/admin/users", NewAdminUser());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        await host.Users.DidNotReceive().CreateUserAsync(
            Arg.Any<CreateAdminUserRequest>(), Arg.Any<int>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Anonymous_invitation_resend_is_rejected_with_401()
    {
        await using var host = await CreateHostAsync();

        var response = await host.Client().PostAsync("/api/admin/users/42/resend-invitation", null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        await host.Users.DidNotReceive().ResendInvitationAsync(42, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Invitation_resend_without_completed_mfa_is_rejected_with_403()
    {
        await using var host = await CreateHostAsync();
        var administrator = await host.CreateUserAsync("resend-no-mfa", GisRoles.Administrator);

        var response = await host.Client(administrator, AuthenticationLevel.Password)
            .PostAsync("/api/admin/users/42/resend-invitation", null);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        await host.Users.DidNotReceive().ResendInvitationAsync(42, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Invitation_resend_without_users_create_is_rejected_with_403()
    {
        await using var host = await CreateHostAsync();
        var editor = await host.CreateUserAsync("resend-no-permission", GisRoles.GisEditor);

        var response = await host.Client(editor)
            .PostAsync("/api/admin/users/42/resend-invitation", null);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        await host.Users.DidNotReceive().ResendInvitationAsync(42, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Authorized_invitation_resend_is_accepted_and_rate_limited_per_actor_and_target()
    {
        await using var host = await CreateHostAsync();
        var administrator = await host.CreateUserAsync("resend-authorized", GisRoles.Administrator);
        var client = host.Client(administrator);

        var accepted = await client.PostAsync("/api/admin/users/42/resend-invitation", null);
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        var body = await accepted.Content.ReadAsStringAsync();
        Assert.DoesNotContain("token", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("securityStamp", body, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(HttpStatusCode.TooManyRequests,
            (await client.PostAsync("/api/admin/users/42/resend-invitation", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await client.PostAsync("/api/admin/users/43/resend-invitation", null)).StatusCode);

        await host.Users.Received(1).ResendInvitationAsync(42, Arg.Any<CancellationToken>());
        await host.Users.Received(1).ResendInvitationAsync(43, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Public_confirmation_resend_keeps_generic_response_and_throttles_same_ip()
    {
        await using var host = await CreateHostAsync();

        var first = await host.Client().PostAsJsonAsync(
            "/api/auth/resend-confirmation",
            new ResendConfirmationRequest { Email = "someone@example.invalid" });
        var second = await host.Client().PostAsJsonAsync(
            "/api/auth/resend-confirmation",
            new ResendConfirmationRequest { Email = "someone@example.invalid" });

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Contains("hesap varsa", await first.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.Equal(HttpStatusCode.TooManyRequests, second.StatusCode);
    }

    /* --- Yardımcılar ----------------------------------------------------------- */

    private static CreateDrawingRequest NewDrawing() => new() { Name = "test", Wkt = "POINT (1 1)" };

    private static CreateAdminUserRequest NewAdminUser() => new()
    {
        Username = "invited-user",
        Email = "invited-user@example.invalid",
        Role = GisRoles.Viewer
    };

    private static async Task<TestHostFixture> CreateHostAsync()
    {
        var drawings = Substitute.For<IDrawingService>();
        drawings.CreatePointAsync(Arg.Any<CreateDrawingRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<DrawingResponse>.Success(new DrawingResponse()));
        drawings.CreateLineAsync(Arg.Any<CreateDrawingRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<DrawingResponse>.Success(new DrawingResponse()));
        drawings.CreatePolygonAsync(Arg.Any<CreateDrawingRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<DrawingResponse>.Success(new DrawingResponse()));
        drawings.GetPointsAsync(Arg.Any<CancellationToken>())
            .Returns(Array.Empty<DrawingResponse>());

        var users = Substitute.For<IUserManagementService>();
        users.GetUsersAsync(Arg.Any<CancellationToken>()).Returns(Array.Empty<AdminUserListItem>());
        users.GetAssignableRolesAsync(Arg.Any<int>(), Arg.Any<CancellationToken>()).Returns(Array.Empty<AssignableRole>());
        users.ResendInvitationAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns(call => ServiceResult<AdminUserDetail>.Success(new AdminUserDetail
            {
                Id = call.ArgAt<int>(0),
                AccountStatus = AccountStatus.InvitationPending
            }));

        var accounts = Substitute.For<IAccountService>();
        accounts.ResendConfirmationAsync(Arg.Any<ResendConfirmationRequest>(), Arg.Any<CancellationToken>())
            .Returns(AccountResult.Success(
                "Bu adresle eşleşen bir hesap varsa, e-posta gönderildi. Lütfen gelen kutunuzu kontrol edin."));

        var analysis = Substitute.For<ISpatialAnalysisService>();
        analysis.CountIntersectionsAsync(Arg.Any<IntersectionAnalysisRequest>(), Arg.Any<CancellationToken>())
            .Returns(ServiceResult<IntersectionAnalysisResponse>.Success(new IntersectionAnalysisResponse()));

        var databaseName = $"permission-enforcement-{Guid.NewGuid():N}";

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

                services.AddSingleton(drawings);
                services.AddSingleton(users);
                services.AddSingleton(analysis);
                services.AddSingleton(accounts);
                services.AddScoped(_ => Substitute.For<IAuthService>());
                services.AddScoped(_ => Substitute.For<ITwoFactorService>());
                services.AddScoped<ICurrentUserService, CurrentUserService>();
                services.AddScoped<IDrawingAuthorizationService>(_ => Substitute.For<IDrawingAuthorizationService>());

                /* Bu dosyanın konusu filtre katmanıdır; doğrudan yetki servisi
                   yalnızca controller'ın kurulabilmesi için gerekir. */
                services.AddScoped(_ => Substitute.For<IUserPermissionManagementService>());

                /* AnalysisController konum analizi uçlarını da taşır; bu dosya
                   yalnızca FİLTRE katmanını sınadığı için servislerin gerçek
                   uygulamaları değil, controller kurulabilsin diye taklitleri
                   kaydedilir. */
                services.AddScoped(_ => Substitute.For<ILocationAnalysisService>());
                services.AddScoped(_ => Substitute.For<ILocationAnalysisImageService>());

                /* Üretimdeki kayıtların AYNISI. Test kendi yetkilendirme
                   mantığını kurmaz; Program.cs'teki hattı çalıştırır. */
                services.AddScoped(_ => Substitute.For<IGeographicAuthorizationService>());
                services.AddScoped<IEffectivePermissionService, EffectivePermissionService>();
                services.AddInvitationRateLimiting();
                services.AddSingleton<IAuthorizationPolicyProvider, PermissionPolicyProvider>();
                services.AddScoped<IAuthorizationHandler, PermissionAuthorizationHandler>();

                services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
                    .AddJwtBearer(options => options.TokenValidationParameters = ValidationParameters());

                services.AddAuthorization(options =>
                {
                    options.AddPolicy(AuthorizationPolicies.AuthenticatedUser, p => p.RequireAuthenticatedUser());
                    options.AddPolicy(AuthorizationPolicies.AdminOnly, p =>
                    {
                        p.RequireAuthenticatedUser();
                        p.RequireRole(ApplicationRoles.Admin);
                    });
                    options.AddPolicy(AuthorizationPolicies.AdminMfaRequired, p =>
                    {
                        p.RequireAuthenticatedUser();
                        p.RequireRole(ApplicationRoles.Admin);
                        p.RequireAssertion(c => AuthenticationMethods.IsMultiFactor(c.User));
                    });
                    options.AddPolicy(AuthorizationPolicies.MfaRequired, p =>
                    {
                        p.RequireAuthenticatedUser();
                        p.RequireAssertion(c => AuthenticationMethods.IsMultiFactor(c.User));
                    });
                });

                services.AddControllers().AddApplicationPart(typeof(DrawingsController).Assembly);
            });

            web.Configure(app =>
            {
                app.UseRouting();
                app.UseAuthentication();
                app.UseAuthorization();
                app.UseRateLimiter();
                app.UseEndpoints(endpoints => endpoints.MapControllers());
            });
        });

        var host = await builder.StartAsync();
        var fixture = new TestHostFixture(host, drawings, users);
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

    private sealed class TestHostFixture : IAsyncDisposable
    {
        private readonly IHost _host;

        public TestHostFixture(IHost host, IDrawingService drawings, IUserManagementService users)
        {
            _host = host;
            Drawings = drawings;
            Users = users;
        }

        public IDrawingService Drawings { get; }

        public IUserManagementService Users { get; }

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

        public async Task<string[]> RolesOfAsync(User user)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var manager = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            var tracked = await manager.FindByIdAsync(user.Id.ToString());
            return [.. await manager.GetRolesAsync(tracked!)];
        }

        public async Task GrantDirectAsync(User user, string permissionCode)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var permission = await db.Permissions.SingleAsync(p => p.Code == permissionCode);

            db.UserPermissions.Add(new UserPermission { UserId = user.Id, PermissionId = permission.Id });
            await db.SaveChangesAsync();
        }

        public async Task DeactivatePermissionAsync(string permissionCode)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var permission = await db.Permissions.SingleAsync(p => p.Code == permissionCode);

            permission.IsActive = false;
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

        public async Task SetAccountStatusAsync(User user, AccountStatus status)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var tracked = await db.Users.SingleAsync(u => u.Id == user.Id);

            tracked.AccountStatus = status;
            await db.SaveChangesAsync();
        }

        public async Task SetAccountActiveAsync(User user, bool isActive)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var tracked = await db.Users.SingleAsync(u => u.Id == user.Id);

            tracked.IsActive = isActive;
            await db.SaveChangesAsync();
        }

        /// <summary>Anonim istemci.</summary>
        public HttpClient Client() => _host.GetTestClient();

        /// <summary>
        /// Gerçek <see cref="JwtTokenService"/> ile üretilmiş token taşıyan
        /// istemci. Varsayılan olarak ikinci faktör tamamlanmış sayılır.
        /// </summary>
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

file static class HttpClientJsonExtensions
{
    public static Task<HttpResponseMessage> PostAsJsonAsync<T>(this HttpClient client, string route, T body) =>
        client.PostAsync(route, new StringContent(
            System.Text.Json.JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"));
}
