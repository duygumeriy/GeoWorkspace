using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
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
/// Çoklu coğrafi alan uçlarının HTTP sözleşmesi ve yetkilendirmesi (Phase 9),
/// ve çağıranın kendi kapsamını okuduğu uç.
/// </summary>
/// <remarks>
/// <para>
/// <b>Çoğullaşma bir yetki gevşetmesi DEĞİLDİR.</b> Yeni uçlar tekil uçlarla
/// birebir aynı ikili kuralı arar: hedefin türü için gereken yetki
/// (<c>users.*</c> / <c>roles.*</c>) VE coğrafi yetenek (<c>geography.view</c> /
/// <c>geography.manage</c>). Testlerin ağırlığı buradadır.
/// </para>
/// <para>
/// <b>Kendi kapsamı ayrı bir sözleşmedir.</b> <c>me/geographic-scope</c>
/// bilinçli olarak <c>geography.view</c> ARAMAZ: o yetki başkalarının alanını
/// yönetmek içindir, kişinin kendi çizim sınırını bilmesi haritayı
/// kullanabilmesinin ön koşuludur. Buna karşılık uç, başka bir kullanıcıyı
/// sorgulamanın hiçbir yolunu sunmaz.
/// </para>
/// </remarks>
public class GeographicMultiAreaHttpTests
{
    private const string JwtKey = "geographic-multi-area-http-tests-signing-key-0123456789";
    private const string Issuer = "StajProject.Api";
    private const string Audience = "StajProject.Client";

    private const string West = "POLYGON ((32 39, 33 39, 33 40, 32 40, 32 39))";
    private const string East = "POLYGON ((35 38, 36 38, 36 39, 35 39, 35 38))";
    private const string Wide = "POLYGON ((30 37, 38 37, 38 42, 30 42, 30 37))";

    private static readonly string[] UserRead = [PermissionCodes.UsersView, PermissionCodes.GeographyView];
    private static readonly string[] UserWrite = [PermissionCodes.UsersUpdate, PermissionCodes.GeographyManage];
    private static readonly string[] RoleRead = [PermissionCodes.RolesView, PermissionCodes.GeographyView];
    private static readonly string[] RoleWrite = [PermissionCodes.RolesUpdate, PermissionCodes.GeographyManage];

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /* --- Kullanıcı: listeleme, ekleme, düzenleme, silme ------------------------------- */

    [Fact]
    public async Task An_anonymous_request_is_rejected()
    {
        await using var host = await StartAsync();
        var target = await host.CreateUserAsync("anon-target");

        Assert.Equal(HttpStatusCode.Unauthorized, (await host.Client().GetAsync(UserAreas(target.Id))).StatusCode);
    }

    [Fact]
    public async Task A_password_only_token_is_rejected()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("single-factor", [.. UserRead, .. UserWrite]);
        var target = await host.CreateUserAsync("sf-target");

        // Yönetim uçlarının MFA şartı çoğul uçlarda da aynen geçerlidir.
        var response = await host.Client(actor, AuthenticationLevel.Password).GetAsync(UserAreas(target.Id));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task A_user_with_no_areas_reads_as_an_empty_list_not_a_404()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("reader", UserRead);
        var target = await host.CreateUserAsync("area-less");

        var response = await host.Client(actor).GetAsync(UserAreas(target.Id));
        var body = await ReadAreasAsync(response);

        /* "Kayıt yok" ile "hedef yok" farklı cevaplardır. 404 döndürmek,
           yönetici ekranını var olmayan bir hata durumuna sokardı. */
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty(body.Areas);
        Assert.False(body.IsRestricted);
        Assert.Null(body.EffectiveWkt);
    }

    [Fact]
    public async Task A_missing_user_is_a_404()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("missing-reader", UserRead);

        Assert.Equal(HttpStatusCode.NotFound, (await host.Client(actor).GetAsync(UserAreas(999999))).StatusCode);
    }

    [Fact]
    public async Task Posting_a_second_area_keeps_the_first()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("adder", [.. UserRead, .. UserWrite]);
        var target = await host.CreateUserAsync("multi-target");

        await host.Client(actor).PostAsJsonAsync(UserAreas(target.Id), Body(West, "Ankara"));
        var second = await host.Client(actor).PostAsJsonAsync(UserAreas(target.Id), Body(East, "Kayseri"));

        var body = await ReadAreasAsync(second);

        /* Bu, ekranın "Yeni Alan Ekle" davranışının uçtaki karşılığıdır: ekleme
           var olanı SİLMEZ. Tekil PUT'un upsert davranışı burada geçerli
           olsaydı Ankara sessizce kaybolurdu. */
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.Equal(["Ankara", "Kayseri"], body.Areas.Select(a => a.Name));
        Assert.Equal(2, await host.AreaRowCountAsync());
    }

    [Fact]
    public async Task Put_changes_only_the_addressed_area()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("editor", [.. UserRead, .. UserWrite]);
        var target = await host.CreateUserAsync("edit-target");

        var created = await ReadAreasAsync(
            await host.Client(actor).PostAsJsonAsync(UserAreas(target.Id), Body(West, "Ankara")));
        await host.Client(actor).PostAsJsonAsync(UserAreas(target.Id), Body(East, "Kayseri"));

        var first = created.Areas[0].Id;
        var response = await host.Client(actor)
            .PutAsJsonAsync(UserArea(target.Id, first), Body(Wide, "Genişletilmiş Ankara"));

        var body = await ReadAreasAsync(response);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(["Genişletilmiş Ankara", "Kayseri"], body.Areas.Select(a => a.Name));
        // Satır sayısı DEĞİŞMEZ: güncelleme ikinci bir satır açmaz.
        Assert.Equal(2, await host.AreaRowCountAsync());
    }

    [Fact]
    public async Task Delete_removes_only_the_addressed_area()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("remover", [.. UserRead, .. UserWrite]);
        var target = await host.CreateUserAsync("delete-target");

        var created = await ReadAreasAsync(
            await host.Client(actor).PostAsJsonAsync(UserAreas(target.Id), Body(West, "Ankara")));
        await host.Client(actor).PostAsJsonAsync(UserAreas(target.Id), Body(East, "Kayseri"));

        var response = await host.Client(actor).DeleteAsync(UserArea(target.Id, created.Areas[0].Id));
        var body = await ReadAreasAsync(response);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(["Kayseri"], body.Areas.Select(a => a.Name));
        Assert.Equal(1, await host.AreaRowCountAsync());
    }

    [Fact]
    public async Task An_area_id_that_belongs_to_another_target_is_a_404()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("prober", [.. UserRead, .. UserWrite]);
        var owner = await host.CreateUserAsync("owner");
        var other = await host.CreateUserAsync("other");

        var created = await ReadAreasAsync(
            await host.Client(actor).PostAsJsonAsync(UserAreas(owner.Id), Body(West, "Ankara")));
        var areaId = created.Areas[0].Id;

        var response = await host.Client(actor).DeleteAsync(UserArea(other.Id, areaId));

        /* 404, 403 DEĞİL: "yasak" cevabı o kimlikte bir alanın başka bir
           hedefte VAR OLDUĞUNU sızdırırdı. */
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(1, await host.AreaRowCountAsync());
    }

    [Fact]
    public async Task An_invalid_polygon_is_a_400_and_writes_nothing()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("bad-geometry", [.. UserRead, .. UserWrite]);
        var target = await host.CreateUserAsync("bad-target");

        // Kendisiyle kesişen halka: geometri hatası, yetki hatası değil.
        var response = await host.Client(actor)
            .PostAsJsonAsync(UserAreas(target.Id), Body("POLYGON ((0 0, 10 10, 10 0, 0 10, 0 0))", "Bozuk"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, await host.AreaRowCountAsync());
    }

    [Fact]
    public async Task Metric_coordinates_are_refused_rather_than_relabelled()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("mercator", [.. UserRead, .. UserWrite]);
        var target = await host.CreateUserAsync("mercator-target");

        // EPSG:3857 metre değerleri. Sunucu SRID etiketleyip kabul etmez.
        var response = await host.Client(actor).PostAsJsonAsync(
            UserAreas(target.Id),
            Body("POLYGON ((3561000 4720000, 3672000 4720000, 3672000 4860000, 3561000 4860000, 3561000 4720000))", "Metrik"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, await host.AreaRowCountAsync());
    }

    /* --- Kullanıcı: yetki matrisi ----------------------------------------------------- */

    [Fact]
    public async Task Reading_user_areas_needs_both_users_view_and_geography_view()
    {
        await using var host = await StartAsync();
        var target = await host.CreateUserAsync("matrix-target");

        var onlyUsers = await host.CreateActorAsync("only-users-view", [PermissionCodes.UsersView]);
        var onlyGeography = await host.CreateActorAsync("only-geography-view", [PermissionCodes.GeographyView]);
        var both = await host.CreateActorAsync("both-view", UserRead);

        Assert.Equal(HttpStatusCode.Forbidden, (await host.Client(onlyUsers).GetAsync(UserAreas(target.Id))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Client(onlyGeography).GetAsync(UserAreas(target.Id))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await host.Client(both).GetAsync(UserAreas(target.Id))).StatusCode);
    }

    [Fact]
    public async Task Mutating_user_areas_needs_both_users_update_and_geography_manage()
    {
        await using var host = await StartAsync();
        var target = await host.CreateUserAsync("mutation-target");

        /* Yalnızca users.update taşıyan bir aktör coğrafi sınıra dokunamaz:
           aksi hâlde kullanıcı düzenleme yetkisi sessizce coğrafi yetki
           yönetimi anlamına gelirdi. */
        var onlyUsers = await host.CreateActorAsync("only-users-update", [.. UserRead, PermissionCodes.UsersUpdate]);
        var onlyGeography = await host.CreateActorAsync("only-geography-manage", [.. UserRead, PermissionCodes.GeographyManage]);

        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await host.Client(onlyUsers).PostAsJsonAsync(UserAreas(target.Id), Body(West, "A"))).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await host.Client(onlyGeography).PostAsJsonAsync(UserAreas(target.Id), Body(West, "A"))).StatusCode);

        Assert.Equal(0, await host.AreaRowCountAsync());
    }

    [Fact]
    public async Task View_permission_alone_cannot_delete_an_area()
    {
        await using var host = await StartAsync();
        var writer = await host.CreateActorAsync("writer", [.. UserRead, .. UserWrite]);
        var reader = await host.CreateActorAsync("reader-only", UserRead);
        var target = await host.CreateUserAsync("readonly-target");

        var created = await ReadAreasAsync(
            await host.Client(writer).PostAsJsonAsync(UserAreas(target.Id), Body(West, "Ankara")));

        var response = await host.Client(reader).DeleteAsync(UserArea(target.Id, created.Areas[0].Id));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(1, await host.AreaRowCountAsync());
    }

    /* --- Rol hedefi -------------------------------------------------------------------- */

    [Fact]
    public async Task A_role_can_hold_several_areas()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("role-manager", [.. RoleRead, .. RoleWrite]);
        var role = await host.CreateRoleAsync("Saha Ekibi");

        await host.Client(actor).PostAsJsonAsync(RoleAreas(role.Id), Body(West, "Ankara"));
        var response = await host.Client(actor).PostAsJsonAsync(RoleAreas(role.Id), Body(East, "Kayseri"));

        var body = await ReadAreasAsync(response);

        Assert.Equal(["Ankara", "Kayseri"], body.Areas.Select(a => a.Name));
        Assert.True(body.IsRestricted);
        // Kopuk iki alanın birleşimi doğal olarak MultiPolygon'dur.
        Assert.StartsWith("MULTIPOLYGON", body.EffectiveWkt);
    }

    [Fact]
    public async Task Role_areas_need_roles_permissions_not_users_permissions()
    {
        await using var host = await StartAsync();
        var role = await host.CreateRoleAsync("Kapsam Rolü");

        // Kullanıcı tarafının yetkileri rol hedefinde HİÇBİR ŞEY açmaz.
        var userSideActor = await host.CreateActorAsync("user-side", [.. UserRead, .. UserWrite]);
        var roleSideActor = await host.CreateActorAsync("role-side", [.. RoleRead, .. RoleWrite]);

        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await host.Client(userSideActor).GetAsync(RoleAreas(role.Id))).StatusCode);
        Assert.Equal(
            HttpStatusCode.OK,
            (await host.Client(roleSideActor).GetAsync(RoleAreas(role.Id))).StatusCode);
    }

    /* --- Veriye dayalı yetkilendirme --------------------------------------------------- */

    [Fact]
    public async Task A_custom_role_with_the_right_codes_can_manage_many_areas()
    {
        await using var host = await StartAsync();

        /* Adı hiçbir yerde özel anlam taşımayan bir rol. Yetkiyi veren şey adı
           değil, taşıdığı yetki satırlarıdır. */
        var actor = await host.CreateActorAsync("geography-operator", [.. UserRead, .. UserWrite]);
        var target = await host.CreateUserAsync("operated");

        Assert.Equal(
            HttpStatusCode.OK,
            (await host.Client(actor).PostAsJsonAsync(UserAreas(target.Id), Body(West, "A"))).StatusCode);
        Assert.Equal(
            HttpStatusCode.OK,
            (await host.Client(actor).PostAsJsonAsync(UserAreas(target.Id), Body(East, "B"))).StatusCode);
    }

    [Fact]
    public async Task An_administrator_without_the_codes_is_refused()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateUserAsync("nominal-admin", GisRoles.Administrator);
        var target = await host.CreateUserAsync("admin-target");

        await host.RevokeRoleGrantAsync(GisRoles.Administrator, PermissionCodes.GeographyManage);

        var response = await host.Client(actor).PostAsJsonAsync(UserAreas(target.Id), Body(West, "A"));

        /* Rol adı hâlâ "Administrator". Erişim kaybolduysa sebebi tek bir
           satırın silinmiş olmasıdır — adı değil. */
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(0, await host.AreaRowCountAsync());
    }

    /* --- Çağıranın kendi kapsamı ------------------------------------------------------- */

    [Fact]
    public async Task The_self_scope_endpoint_rejects_anonymous_callers()
    {
        await using var host = await StartAsync();

        Assert.Equal(HttpStatusCode.Unauthorized, (await host.Client().GetAsync(SelfScope)).StatusCode);
    }

    [Fact]
    public async Task An_unrestricted_caller_gets_no_boundary_rather_than_a_giant_box()
    {
        await using var host = await StartAsync();
        var caller = await host.CreateUserAsync("free-drawer");

        var body = await ReadScopeAsync(await host.Client(caller).GetAsync(SelfScope));

        /* Kısıtsızlık AÇIK bir durumdur. Dünyayı kaplayan sahte bir poligon
           döndürmek, harita üzerinde var olmayan bir sınırı varmış gibi
           çizerdi ve kenarındaki bir çizim yanlışlıkla engellenirdi. */
        Assert.False(body.IsRestricted);
        Assert.Null(body.EffectiveWkt);
        Assert.Equal(0, body.AreaCount);
    }

    [Fact]
    public async Task The_self_scope_needs_neither_geography_view_nor_mfa()
    {
        await using var host = await StartAsync();
        var manager = await host.CreateActorAsync("scope-manager", [.. UserRead, .. UserWrite]);
        // Hiçbir coğrafi yetkisi olmayan, password-only oturumlu sıradan kullanıcı.
        var caller = await host.CreateUserAsync("ordinary-gis-user");

        await host.Client(manager).PostAsJsonAsync(UserAreas(caller.Id), Body(West, "Ankara"));

        var response = await host.Client(caller, AuthenticationLevel.Password).GetAsync(SelfScope);
        var body = await ReadScopeAsync(response);

        /* geography.view BAŞKALARININ alanını yönetmek içindir. Şart
           koşulsaydı sıradan bir GIS kullanıcısı kendi sınırını ancak
           sunucudan 403 yiyerek — yani çizimi bittikten sonra — öğrenirdi. */
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(body.IsRestricted);
        Assert.Equal(1, body.AreaCount);
    }

    [Fact]
    public async Task The_self_scope_unions_several_direct_areas_into_a_multipolygon()
    {
        await using var host = await StartAsync();
        var manager = await host.CreateActorAsync("multi-manager", [.. UserRead, .. UserWrite]);
        var caller = await host.CreateUserAsync("multi-scoped");

        await host.Client(manager).PostAsJsonAsync(UserAreas(caller.Id), Body(West, "Ankara"));
        await host.Client(manager).PostAsJsonAsync(UserAreas(caller.Id), Body(East, "Kayseri"));

        var body = await ReadScopeAsync(await host.Client(caller).GetAsync(SelfScope));

        Assert.True(body.IsRestricted);
        Assert.Equal(2, body.AreaCount);
        Assert.StartsWith("MULTIPOLYGON", body.EffectiveWkt);
    }

    [Fact]
    public async Task The_self_scope_reports_the_inherited_role_boundary()
    {
        await using var host = await StartAsync();
        var manager = await host.CreateActorAsync("role-scope-manager", [.. RoleRead, .. RoleWrite]);
        var role = await host.CreateRoleAsync("Bölge Ekibi");
        var caller = await host.CreateUserAsync("role-scoped", "Bölge Ekibi");

        await host.Client(manager).PostAsJsonAsync(RoleAreas(role.Id), Body(West, "Ankara"));
        await host.Client(manager).PostAsJsonAsync(RoleAreas(role.Id), Body(East, "Kayseri"));

        var body = await ReadScopeAsync(await host.Client(caller).GetAsync(SelfScope));

        // Sınırın NEREDEN geldiği söylenmez; yalnızca sınırın kendisi.
        Assert.True(body.IsRestricted);
        Assert.Equal(2, body.AreaCount);
    }

    [Fact]
    public async Task The_self_scope_answers_for_the_token_holder_and_nobody_else()
    {
        await using var host = await StartAsync();
        var manager = await host.CreateActorAsync("isolation-manager", [.. UserRead, .. UserWrite]);
        var restricted = await host.CreateUserAsync("restricted-one");
        var caller = await host.CreateUserAsync("curious-one");

        await host.Client(manager).PostAsJsonAsync(UserAreas(restricted.Id), Body(West, "Ankara"));

        /* Hedef parametresi denenir. Uç bir hedef KABUL ETMEZ: query string
           yok sayılır ve cevap daima token sahibinindir. Bu, kuralı bir
           kontrole değil imzanın kendisine bağlar. */
        var body = await ReadScopeAsync(
            await host.Client(caller).GetAsync($"{SelfScope}?userId={restricted.Id}"));

        Assert.False(body.IsRestricted);
        Assert.Null(body.EffectiveWkt);
    }

    [Fact]
    public async Task A_scope_narrowed_mid_session_applies_without_re_login()
    {
        await using var host = await StartAsync();
        var manager = await host.CreateActorAsync("live-manager", [.. UserRead, .. UserWrite]);
        var caller = await host.CreateUserAsync("live-scoped");

        // AYNI token boyunca: önce sınırsız...
        Assert.False((await ReadScopeAsync(await host.Client(caller).GetAsync(SelfScope))).IsRestricted);

        await host.Client(manager).PostAsJsonAsync(UserAreas(caller.Id), Body(West, "Ankara"));

        /* ...sonra kısıtlı. Coğrafi kapsam JWT'ye YAZILMAZ; yazılsaydı
           daraltılan bir alan eski token'ın ömrü boyunca uygulanmazdı. */
        Assert.True((await ReadScopeAsync(await host.Client(caller).GetAsync(SelfScope))).IsRestricted);
    }

    /* --- Yardımcılar -------------------------------------------------------------------- */

    private const string SelfScope = "/api/auth/me/geographic-scope";

    private static string UserAreas(int userId) => $"/api/admin/users/{userId}/geographic-authorizations";

    private static string UserArea(int userId, int areaId) => $"{UserAreas(userId)}/{areaId}";

    private static string RoleAreas(int roleId) => $"/api/admin/roles/{roleId}/geographic-authorizations";

    private static SaveGeographicAreaRequest Body(string? wkt, string? name = null) => new() { Wkt = wkt, Name = name };

    private static async Task<GeographicAreasResponse> ReadAreasAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<GeographicAreasResponse>(Json))!;
    }

    private static async Task<SelfGeographicScopeResponse> ReadScopeAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<SelfGeographicScopeResponse>(Json))!;
    }

    private static async Task<GeographicHost> StartAsync()
    {
        var databaseName = $"geographic-multi-http-{Guid.NewGuid():N}";

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

                /* AuthController'ın kendi kapsamı DIŞINDAKİ bağımlılıkları
                   taklittir: bu dosyanın konusu oturum açma değil, coğrafi
                   kapsamın kime ait olduğudur. */
                services.AddScoped(_ => Substitute.For<IAuthService>());
                services.AddScoped(_ => Substitute.For<IAccountService>());
                services.AddScoped(_ => Substitute.For<ITwoFactorService>());

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

            foreach (var role in ApplicationRoles.Retired)
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

            var distinct = codes.Distinct().ToArray();
            var ids = await db.Permissions.Where(p => distinct.Contains(p.Code)).Select(p => p.Id).ToListAsync();
            Assert.Equal(distinct.Length, ids.Count);

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
