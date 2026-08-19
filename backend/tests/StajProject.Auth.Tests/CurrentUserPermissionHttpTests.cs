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
/// <c>GET /api/auth/me/permissions</c> — arayüzün yetki kaynağının GERÇEK HTTP
/// hattı üzerindeki davranışı.
/// </summary>
/// <remarks>
/// <para>
/// <c>IEffectivePermissionService</c> substitute DEĞİLDİR: ölçülen şey "uç
/// çağrıldı mı" değil, çağıranın veritabanındaki rol ve doğrudan yetki
/// satırlarının gerçekten birleşip döndüğüdür.
/// </para>
/// <para>
/// Bu uç bir güvenlik sınırı değildir — yanıtı yalnızca arayüzü biçimlendirir.
/// Testler bu yüzden "ne döndüğünü" ölçer; korumalı uçların kendi yetki
/// kapıları <see cref="PermissionEnforcementTests"/> ve
/// <see cref="UserPermissionHttpTests"/> tarafından ayrıca doğrulanır.
/// </para>
/// </remarks>
public class CurrentUserPermissionHttpTests
{
    private const string JwtKey = "test-only-key-that-is-long-enough-for-hmac-sha256-signing";
    private const string Issuer = "StajProject.Tests";
    private const string Audience = "StajProject.Tests.Client";

    private const string Route = "/api/auth/me/permissions";

    /* --- Erişim ---------------------------------------------------------------------- */

    [Fact]
    public async Task An_anonymous_read_is_rejected_with_401()
    {
        await using var host = await CreateHostAsync();

        Assert.Equal(HttpStatusCode.Unauthorized, (await host.Client().GetAsync(Route)).StatusCode);
    }

    [Fact]
    public async Task A_password_only_session_still_reads_its_own_permissions()
    {
        /* Zorunlu 2FA yalnızca Admin rolü içindir; sıradan bir GIS kullanıcısı
           password-only token taşır. Bu uca MFA şartı konsaydı, o kullanıcılar
           yetkilerini hiç okuyamaz ve arayüzün tamamı fail-closed kapanırdı. */
        await using var host = await CreateHostAsync();
        var actor = await host.CreateActorAsync("viewer", [PermissionCodes.MapView]);

        var response = await host.Client(actor, AuthenticationLevel.Password).GetAsync(Route);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains(PermissionCodes.MapView, await CodesAsync(response));
    }

    [Fact]
    public async Task A_multi_factor_session_reads_its_own_permissions()
    {
        await using var host = await CreateHostAsync();
        var actor = await host.CreateActorAsync("admin-ish", [PermissionCodes.UsersView, PermissionCodes.RolesView]);

        var response = await host.Client(actor).GetAsync(Route);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(
            [PermissionCodes.RolesView, PermissionCodes.UsersView],
            (await CodesAsync(response)).OrderBy(c => c, StringComparer.Ordinal));
    }

    [Fact]
    public async Task A_token_whose_identity_cannot_be_resolved_reads_as_empty()
    {
        /* Silinmiş bir hesabın hâlâ geçerli imzalı token'ı olabilir. Fail-closed:
           kimlik çözülemiyorsa cevap "hiçbir yetki"dir, 500 değil. */
        await using var host = await CreateHostAsync();

        var response = await host.ClientForUserId(987654).GetAsync(Route);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty(await CodesAsync(response));
    }

    /* --- Kaynakların birleşimi ------------------------------------------------------- */

    [Fact]
    public async Task Role_permissions_are_included()
    {
        await using var host = await CreateHostAsync();
        var actor = await host.CreateActorAsync("by-role", [PermissionCodes.DrawingsView, PermissionCodes.MapView]);

        var codes = await CodesAsync(await host.Client(actor).GetAsync(Route));

        Assert.Contains(PermissionCodes.DrawingsView, codes);
        Assert.Contains(PermissionCodes.MapView, codes);
    }

    [Fact]
    public async Task Direct_user_permissions_are_included()
    {
        await using var host = await CreateHostAsync();
        var actor = await host.CreateActorAsync("by-direct", [PermissionCodes.MapView]);

        await host.GrantDirectAsync(actor.Id, PermissionCodes.InventoryAnalysis);

        var codes = await CodesAsync(await host.Client(actor).GetAsync(Route));

        // Rol DEĞİŞMEDİ; yetki yalnızca doğrudan atamadan geliyor.
        Assert.Contains(PermissionCodes.InventoryAnalysis, codes);
        Assert.Contains(PermissionCodes.MapView, codes);
    }

    [Fact]
    public async Task A_permission_held_both_by_role_and_directly_is_returned_once()
    {
        await using var host = await CreateHostAsync();
        var actor = await host.CreateActorAsync("overlap", [PermissionCodes.MeasurementUse]);

        await host.GrantDirectAsync(actor.Id, PermissionCodes.MeasurementUse);

        var codes = await CodesAsync(await host.Client(actor).GetAsync(Route));

        Assert.Single(codes, code => code == PermissionCodes.MeasurementUse);
    }

    [Fact]
    public async Task An_inactive_permission_is_excluded()
    {
        await using var host = await CreateHostAsync();
        var actor = await host.CreateActorAsync("stale", [PermissionCodes.MapView, PermissionCodes.SelectionUse]);

        await host.DeactivatePermissionAsync(PermissionCodes.SelectionUse);

        var codes = await CodesAsync(await host.Client(actor).GetAsync(Route));

        // Satır duruyor ama yetki kullanımdan kaldırıldı: etkin erişim vermez.
        Assert.DoesNotContain(PermissionCodes.SelectionUse, codes);
        Assert.Contains(PermissionCodes.MapView, codes);
    }

    /* --- Hesap uygunluğu ------------------------------------------------------------- */

    [Fact]
    public async Task A_deactivated_account_reads_as_empty()
    {
        await using var host = await CreateHostAsync();
        var actor = await host.CreateActorAsync("suspended", [.. PermissionCatalog.AllCodes]);

        var client = host.Client(actor);
        await host.DeactivateAsync(actor.Id);

        var response = await client.GetAsync(Route);

        /* Token hâlâ geçerli; yetki kaynağı canlı veritabanıdır. Askıya alınan
           hesabın erişimi token'ın süresi dolana kadar sürmemelidir. */
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty(await CodesAsync(response));
    }

    /* --- Canlı yetkilendirme --------------------------------------------------------- */

    [Fact]
    public async Task A_permission_gained_without_re_login_appears_on_the_next_read()
    {
        await using var host = await CreateHostAsync();
        var actor = await host.CreateActorAsync("growing", [PermissionCodes.MapView]);

        // AYNI istemci, AYNI token: yeniden giriş yok.
        var client = host.Client(actor);

        Assert.DoesNotContain(PermissionCodes.InventoryAnalysis, await CodesAsync(await client.GetAsync(Route)));

        await host.GrantDirectAsync(actor.Id, PermissionCodes.InventoryAnalysis);

        Assert.Contains(PermissionCodes.InventoryAnalysis, await CodesAsync(await client.GetAsync(Route)));
    }

    [Fact]
    public async Task A_permission_lost_without_re_login_disappears_on_the_next_read()
    {
        await using var host = await CreateHostAsync();
        var actor = await host.CreateActorAsync("shrinking", [PermissionCodes.MapView, PermissionCodes.MeasurementUse]);

        var client = host.Client(actor);

        Assert.Contains(PermissionCodes.MeasurementUse, await CodesAsync(await client.GetAsync(Route)));

        await host.RevokeRoleGrantAsync($"Role-shrinking", PermissionCodes.MeasurementUse);

        var codes = await CodesAsync(await client.GetAsync(Route));

        Assert.DoesNotContain(PermissionCodes.MeasurementUse, codes);
        Assert.Contains(PermissionCodes.MapView, codes);
    }

    /* --- Rol adı bir kestirme değildir ------------------------------------------------ */

    [Fact]
    public async Task The_Administrator_role_name_grants_nothing_once_its_rows_are_gone()
    {
        /* Administrator 27 yetkiyi ADINDAN değil, seed edilmiş
           role_permissions satırlarından alır. Bir satır silindiğinde erişim
           GERÇEKTEN kapanır — ad bir kestirme olsaydı kapanmazdı. */
        await using var host = await CreateHostAsync();
        var actor = await host.CreateUserAsync("named-admin", GisRoles.Administrator);

        var client = host.Client(actor);

        Assert.Contains(PermissionCodes.UsersView, await CodesAsync(await client.GetAsync(Route)));

        await host.RevokeRoleGrantAsync(GisRoles.Administrator, PermissionCodes.UsersView);

        Assert.DoesNotContain(PermissionCodes.UsersView, await CodesAsync(await client.GetAsync(Route)));
    }

    [Fact]
    public async Task A_role_name_that_looks_administrative_but_has_no_rows_grants_nothing()
    {
        await using var host = await CreateHostAsync();

        // Adı yönetici çağrıştırır, yetki satırı YOKTUR.
        var actor = await host.CreateUserInEmptyRoleAsync("looks-admin", "Administrators");

        Assert.Empty(await CodesAsync(await host.Client(actor).GetAsync(Route)));
    }

    [Fact]
    public async Task A_custom_role_name_is_treated_exactly_like_any_other()
    {
        await using var host = await CreateHostAsync();
        var actor = await host.CreateActorAsync("field-wizard", [PermissionCodes.InventoryAnalysis]);

        Assert.Contains(PermissionCodes.InventoryAnalysis, await CodesAsync(await host.Client(actor).GetAsync(Route)));
    }

    /* --- Kapsam ---------------------------------------------------------------------- */

    [Fact]
    public async Task The_response_reports_the_caller_identity_and_never_another_user()
    {
        await using var host = await CreateHostAsync();
        var actor = await host.CreateActorAsync("self", [PermissionCodes.MapView]);
        var other = await host.CreateActorAsync("other", [.. PermissionCatalog.AllCodes]);

        var body = await BodyAsync(await host.Client(actor).GetAsync(Route));

        Assert.Equal(actor.Id, body.UserId);
        Assert.NotEqual(other.Id, body.UserId);
        Assert.Equal([PermissionCodes.MapView], body.Permissions);
    }

    [Fact]
    public async Task A_user_id_supplied_by_the_client_is_ignored()
    {
        /* Uç bir kimlik parametresi tanımaz; query ile başkasının kimliğini
           söylemek yanıtı DEĞİŞTİRMEZ. */
        await using var host = await CreateHostAsync();
        var actor = await host.CreateActorAsync("self-only", [PermissionCodes.MapView]);
        var victim = await host.CreateActorAsync("victim", [.. PermissionCatalog.AllCodes]);

        var body = await BodyAsync(await host.Client(actor).GetAsync($"{Route}?userId={victim.Id}"));

        Assert.Equal(actor.Id, body.UserId);
        Assert.Equal([PermissionCodes.MapView], body.Permissions);
    }

    /* --- Yardımcılar ----------------------------------------------------------------- */

    private static async Task<CurrentUserPermissionsResponse> BodyAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CurrentUserPermissionsResponse>())!;
    }

    private static async Task<IReadOnlyCollection<string>> CodesAsync(HttpResponseMessage response) =>
        (await BodyAsync(response)).Permissions;

    private static async Task<CurrentUserPermissionHost> CreateHostAsync()
    {
        var databaseName = $"me-permissions-http-{Guid.NewGuid():N}";

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
                services.AddSingleton(Substitute.For<IAuthService>());
                services.AddSingleton(Substitute.For<IAccountService>());
                services.AddSingleton(Substitute.For<ITwoFactorService>());
                services.AddScoped<ICurrentUserService, CurrentUserService>();

                // Yetki çözümü GERÇEK: testin konusu tam olarak bu.
                services.AddScoped<IEffectivePermissionService, EffectivePermissionService>();

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

                services.AddControllers().AddApplicationPart(typeof(AuthController).Assembly);
            });

            web.Configure(app =>
            {
                app.UseRouting();
                app.UseAuthentication();
                app.UseAuthorization();
                app.UseEndpoints(e => e.MapControllers());
            });
        });

        var fixture = new CurrentUserPermissionHost(await builder.StartAsync());
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

    private sealed class CurrentUserPermissionHost : IAsyncDisposable
    {
        private readonly IHost _host;

        public CurrentUserPermissionHost(IHost host) => _host = host;

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

        /// <summary>Var olan ama HİÇ yetki satırı olmayan bir roldeki kullanıcı.</summary>
        public async Task<User> CreateUserInEmptyRoleAsync(string userName, string roleName)
        {
            await using (var scope = _host.Services.CreateAsyncScope())
            {
                var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

                if (await roles.FindByNameAsync(roleName) is null)
                {
                    Assert.True((await roles.CreateAsync(new IdentityRole<int>(roleName))).Succeeded);
                }
            }

            return await CreateUserAsync(userName, roleName);
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

        public async Task GrantDirectAsync(int userId, string code)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var permission = await db.Permissions.SingleAsync(p => p.Code == code);
            db.UserPermissions.Add(new UserPermission { UserId = userId, PermissionId = permission.Id });
            await db.SaveChangesAsync();
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

        public async Task DeactivatePermissionAsync(string code)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var permission = await db.Permissions.SingleAsync(p => p.Code == code);
            permission.IsActive = false;
            await db.SaveChangesAsync();
        }

        public async Task DeactivateAsync(int userId)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var user = await db.Users.SingleAsync(u => u.Id == userId);
            user.IsActive = false;
            user.AccountStatus = AccountStatus.Suspended;
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
            return Authorized(user.Id, user.UserName!, roles, level);
        }

        /// <summary>Var olmayan bir kimliğe imzalanmış, biçimsel olarak geçerli token.</summary>
        public HttpClient ClientForUserId(int userId) =>
            Authorized(userId, $"ghost-{userId}", [], AuthenticationLevel.MultiFactor);

        private HttpClient Authorized(int userId, string userName, string[] roles, AuthenticationLevel level)
        {
            var tokens = new JwtTokenService(new JwtOptions
            {
                Key = JwtKey,
                Issuer = Issuer,
                Audience = Audience,
                ExpireMinutes = 10
            });

            var (token, _) = tokens.GenerateToken(userId, userName, roles, level);

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
