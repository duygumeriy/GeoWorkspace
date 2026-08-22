using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NSubstitute;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Atanabilir rol listesinin ÇAĞIRANA göre daraltılması.
/// </summary>
/// <remarks>
/// <para>
/// Mutasyon tarafı zaten korunuyordu (bkz.
/// <see cref="RoleAssignmentEscalationTests"/>): kimse sahip olmadığı
/// yetkileri dağıtamaz. Ama liste ucu herkese aynı cevabı verdiği için zayıf
/// bir yönetici <c>Administrator</c>'ı dropdown'da görüp atamaya çalışıyor ve
/// 403 alıyordu — güvenli, fakat yanıltıcı.
/// </para>
/// <para>
/// Bu testler listenin mutasyonla <b>aynı</b> kuralı kullandığını doğrular:
/// <c>hedef rolün aktif yetkileri ⊆ çağıranın etkin yetkileri</c>. Kararın rol
/// ADINDAN değil canlı yetki verisinden geldiği ayrıca sınanır; aksi hâlde
/// "Admin ise hepsini görsün" gibi bir kestirme sessizce geri sızabilirdi.
/// </para>
/// </remarks>
public class ActorAwareAssignableRoleTests
{
    private static readonly string[] CanonicalOrder =
        [GisRoles.Viewer, GisRoles.GisEditor, GisRoles.GisAnalyst, GisRoles.GisManager, GisRoles.Administrator];

    /* --- Tam yetkili aktörler ------------------------------------------------------ */

    [Fact]
    public async Task A_fully_privileged_administrator_is_offered_every_target_role()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateUserAsync(scope, "target-admin", GisRoles.Administrator);

        // Aktör legacy Admin DEĞİL; yetkisi yalnızca rolünün yetki satırlarından geliyor.
        Assert.DoesNotContain(ApplicationRoles.Admin, await RolesOfAsync(scope, actor));

        Assert.Equal(CanonicalOrder, await OfferedAsync(scope, actor));
    }

    [Fact]
    public async Task A_retired_Admin_is_not_granted_any_assignable_roles_by_its_name()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateUserAsync(scope, "legacy-admin", ApplicationRoles.Admin);

        Assert.Empty(await OfferedAsync(scope, actor));
    }

    [Theory]
    [InlineData(GisRoles.Administrator)]
    public async Task The_legacy_roles_are_never_offered_even_to_a_fully_privileged_actor(string actorRole)
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateUserAsync(scope, $"full-{actorRole}", actorRole);

        var offered = await OfferedAsync(scope, actor);

        /* Katalogdaki yetkilerin tamamına sahip olmak legacy geçiş rollerini AÇMAZ: bunlar
           yetki yetersizliğinden değil, genel olarak yeni atamalara kapalı
           oldukları için listede yoktur. İki filtre bağımsızdır. */
        Assert.Equal(31, (await Effective(scope).GetEffectivePermissionCodesAsync(actor.Id)).Count);
        Assert.DoesNotContain(ApplicationRoles.Admin, offered);
        Assert.DoesNotContain(ApplicationRoles.User, offered);
    }

    /* --- Zayıf aktör ---------------------------------------------------------------- */

    [Fact]
    public async Task A_weak_actor_is_offered_only_the_roles_its_own_permissions_cover()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "weak", [.. ViewerCodes(), PermissionCodes.UsersUpdate]);

        var offered = await OfferedAsync(scope, actor);

        // Viewer'ın altı yetkisi tamamen kapsanıyor.
        Assert.Contains(GisRoles.Viewer, offered);

        // Bunlar aktörün taşımadığı yetkiler istiyor.
        Assert.DoesNotContain(GisRoles.GisEditor, offered);
        Assert.DoesNotContain(GisRoles.GisAnalyst, offered);
        Assert.DoesNotContain(GisRoles.GisManager, offered);
        Assert.DoesNotContain(GisRoles.Administrator, offered);
    }

    [Fact]
    public async Task Every_offered_role_is_actually_assignable_by_the_actor_that_was_offered_it()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "consistent", [.. ViewerCodes(), PermissionCodes.UsersUpdate]);
        await Roles(scope).CreateRoleAsync(new CreateRoleRequest { Name = "Field Surveyor" });

        /* Keşif ile uygulama aynı kuralı kullanıyorsa, listedeki HER rol
           gerçekten atanabilir olmalıdır — "gördüm ama 403 aldım" imkânsız. */
        foreach (var role in await OfferedAsync(scope, actor))
        {
            Assert.True((await Roles(scope).ResolveAssignableRoleAsync(role, actor.Id)).IsSuccess, role);
        }
    }

    [Fact]
    public async Task A_role_that_is_not_offered_is_also_refused_by_the_mutation_path()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "denied", [.. ViewerCodes(), PermissionCodes.UsersUpdate]);
        var victim = await CreateUserAsync(scope, "victim", GisRoles.Viewer);

        Assert.DoesNotContain(GisRoles.Administrator, await OfferedAsync(scope, actor));

        var result = await Management(scope).ChangeRoleAsync(
            victim.Id, new UpdateUserRoleRequest { Role = GisRoles.Administrator }, actor.Id);

        // Listeden düşmesi, mutasyon korumasının YERİNE GEÇMEZ; ikisi de durur.
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
    }

    /* --- Rol adı kestirmesi yok ----------------------------------------------------- */

    [Fact]
    public async Task A_retired_Admin_role_name_has_no_assignment_shortcut()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateUserAsync(scope, "shrinking-admin", ApplicationRoles.Admin);

        var offered = await OfferedAsync(scope, actor);
        Assert.DoesNotContain(GisRoles.GisEditor, offered);
        Assert.DoesNotContain(GisRoles.Administrator, offered);
        Assert.Empty(await Effective(scope).GetEffectivePermissionCodesAsync(actor.Id));
    }

    /* --- Canlı veri ----------------------------------------------------------------- */

    [Fact]
    public async Task Widening_a_role_removes_it_from_the_list_without_a_re_login()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "editor-granter", [.. EditorCodes(), PermissionCodes.UsersUpdate]);
        var victim = await CreateUserAsync(scope, "moved", GisRoles.Viewer);

        Assert.Contains(GisRoles.GisEditor, await OfferedAsync(scope, actor));

        // Hedef rol genişliyor; aktörün yetkileri hiç değişmiyor.
        await GrantRoleAsync(scope, GisRoles.GisEditor, PermissionCodes.UsersDelete);

        /* Yetkiler token'a yazılmadığı ve liste her istekte canlı veriden
           türediği için yeniden giriş gerekmez: aynı oturum anında daralır. */
        Assert.DoesNotContain(GisRoles.GisEditor, await OfferedAsync(scope, actor));

        var result = await Management(scope).ChangeRoleAsync(
            victim.Id, new UpdateUserRoleRequest { Role = GisRoles.GisEditor }, actor.Id);

        // Liste ve mutasyon aynı anda daraldı; ikisi birbirinden sapamaz.
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
    }

    [Fact]
    public async Task A_direct_user_permission_brings_a_role_into_the_list()
    {
        await using var scope = await CreateScopeAsync();
        /* Aktör, GIS Analyst'in yetkilerinden TEK BİRİ dışında hepsini taşır.
           Eksik bırakılan yetki, testin birazdan DOĞRUDAN vereceği yetkidir;
           kurgu bu yüzden analistin profilinden yalnızca onu düşürür ve
           katalog büyüdükçe elle güncellenmesi gerekmez. */
        var actor = await CreateActorAsync(
            scope,
            "analyst-granter",
            [
                .. AnalystCodes().Where(code => code != PermissionCodes.InventoryAnalysis),
                PermissionCodes.UsersUpdate
            ]);

        // Tek eksik yetki analisti listenin dışında tutar.
        Assert.DoesNotContain(GisRoles.GisAnalyst, await OfferedAsync(scope, actor));

        /* Eksik yetki ROL DEĞİŞTİRMEDEN, doğrudan veriliyor. Otorite "rol
           yetkileri ∪ doğrudan yetkiler" olduğu için liste bunu görmelidir. */
        await GrantDirectAsync(scope, actor, PermissionCodes.InventoryAnalysis);

        Assert.Contains(GisRoles.GisAnalyst, await OfferedAsync(scope, actor));
    }

    [Fact]
    public async Task An_inactive_permission_on_the_target_role_does_not_hide_it()
    {
        await using var scope = await CreateScopeAsync();
        /* Aktör, analistin PASİFLEŞTİRİLECEK yetkisi dışındaki her aktif
           yetkisini taşır. Testin konusu tam olarak o tek yetkidir: başka bir
           eksik kalsaydı rol, pasiflikle ilgisi olmayan bir sebeple gizlenir
           ve iddia kendi konusunu ölçmemiş olurdu. */
        var actor = await CreateActorAsync(
            scope,
            "inactive-aware",
            [
                .. AnalystCodes().Where(code => code != PermissionCodes.InventoryAnalysis),
                PermissionCodes.UsersUpdate
            ]);

        Assert.DoesNotContain(GisRoles.GisAnalyst, await OfferedAsync(scope, actor));

        /* Yetki kaldırılmıyor, PASİFLEŞTİRİLİYOR. Pasif tanım kimseye bir şey
           vermediği için, birinin onu taşımaması da atamayı engellememelidir —
           mutasyon kuralı da tam olarak böyle davranır. */
        await DeactivateAsync(scope, PermissionCodes.InventoryAnalysis);

        Assert.Contains(GisRoles.GisAnalyst, await OfferedAsync(scope, actor));
        Assert.True((await Roles(scope).ResolveAssignableRoleAsync(GisRoles.GisAnalyst, actor.Id)).IsSuccess);
    }

    /* --- Sıfır yetkili özel rol ------------------------------------------------------ */

    [Fact]
    public async Task A_custom_role_without_permissions_is_offered_to_every_identified_actor()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "minimal", PermissionCodes.UsersUpdate);

        await Roles(scope).CreateRoleAsync(new CreateRoleRequest { Name = "Field Surveyor" });

        /* Boş küme her kümenin alt kümesidir ve sıfır yetkili bir rol hiçbir
           uygulama yeteneği vermez; gizlemek için bir sebep yok. */
        Assert.Contains("Field Surveyor", await OfferedAsync(scope, actor));

        // Hiçbir kanonik rolü kapsamayan aktör onları görmemeye devam eder.
        Assert.DoesNotContain(GisRoles.Viewer, await OfferedAsync(scope, actor));
    }

    /* --- Sıralama -------------------------------------------------------------------- */

    [Fact]
    public async Task The_offered_order_stays_canonical_then_alphabetical_among_grantable_roles()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateUserAsync(scope, "ordering-admin", GisRoles.Administrator);

        await Roles(scope).CreateRoleAsync(new CreateRoleRequest { Name = "Zonal Editor" });
        await Roles(scope).CreateRoleAsync(new CreateRoleRequest { Name = "Field Surveyor" });

        string[] expected = [.. CanonicalOrder, "Field Surveyor", "Zonal Editor"];

        Assert.Equal(expected, await OfferedAsync(scope, actor));
    }

    [Fact]
    public async Task Filtering_does_not_disturb_the_order_of_what_remains()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "partial", [.. AnalystCodes(), PermissionCodes.UsersUpdate]);

        await Roles(scope).CreateRoleAsync(new CreateRoleRequest { Name = "Zonal Editor" });
        await Roles(scope).CreateRoleAsync(new CreateRoleRequest { Name = "Field Surveyor" });

        var offered = await OfferedAsync(scope, actor);

        /* Kanonik roller kendi mantıksal sıralarını korur, özel roller
           alfabetik gelir — eleme araya girse de düzen bozulmaz. Aktörün kendi
           rolü ("Role-partial") de kapsanan bir özel roldür. */
        Assert.Equal(
            [GisRoles.Viewer, GisRoles.GisAnalyst, "Field Surveyor", "Role-partial", "Zonal Editor"],
            offered);
    }

    /* --- Sorgu maliyeti --------------------------------------------------------------- */

    [Fact]
    public async Task The_actors_permissions_are_resolved_once_no_matter_how_many_roles_exist()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateUserAsync(scope, "counted-admin", GisRoles.Administrator);

        for (var i = 0; i < 12; i++)
        {
            await Roles(scope).CreateRoleAsync(new CreateRoleRequest { Name = $"Custom Role {i:D2}" });
        }

        /* Gerçek servisi saran bir casus: davranış değişmez, yalnızca çağrı
           sayılır. */
        var real = Effective(scope);
        var spy = Substitute.For<IEffectivePermissionService>();
        spy.GetEffectivePermissionCodesAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns(call => real.GetEffectivePermissionCodesAsync(call.Arg<int>(), call.Arg<CancellationToken>()));

        var service = new RoleManagementService(
            Db(scope),
            scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>(),
            spy,
            Substitute.For<ILogger<RoleManagementService>>());

        var offered = await service.GetAssignableRolesAsync(actor.Id);

        Assert.Equal(17, offered.Count);

        /* Rol başına yetki sorgusu açan bir uygulama burada 17 çağrı yapardı.
           Otorite bir kez çözülür ve tüm rollere karşı bellekte karşılaştırılır;
           hedef rollerin yetkileri de tek sorguda toplanır. */
        await spy.Received(1).GetEffectivePermissionCodesAsync(actor.Id, Arg.Any<CancellationToken>());
    }

    /* --- Fail-closed ------------------------------------------------------------------ */

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task An_actor_that_cannot_be_identified_is_offered_nothing(int actingUserId)
    {
        await using var scope = await CreateScopeAsync();
        await Roles(scope).CreateRoleAsync(new CreateRoleRequest { Name = "Field Surveyor" });

        /* Controller kimlik çözemezse ActingUserId 0'a düşer. Bu, "yetkisi yok"
           değil "kimliği yok" demektir ve güvenli cevabı "hiçbiri"dir: sıfır
           yetkili özel rol bile dönmez, aksi hâlde kimliksiz bir çağrı rol
           adlarını sızdıran bir keşif ucuna dönüşürdü. */
        Assert.Empty(await Management(scope).GetAssignableRolesAsync(actingUserId));
    }

    [Fact]
    public async Task A_suspended_actor_is_offered_nothing()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateUserAsync(scope, "suspended-admin", GisRoles.Administrator);

        Assert.NotEmpty(await OfferedAsync(scope, actor));

        var db = Db(scope);
        var record = await db.Users.SingleAsync(u => u.Id == actor.Id);
        record.AccountStatus = AccountStatus.Suspended;
        await db.SaveChangesAsync();

        /* Etkin yetki servisi uygun olmayan hesaplar için boş döndüğü için
           otorite de boşalır. Askıya alınan yönetici token'ının süresi
           dolmadan hiçbir rol atayamaz ve hiçbir rol göremez. */
        Assert.Empty(await OfferedAsync(scope, actor));
    }

    /* --- Yardımcılar ------------------------------------------------------------------ */

    private static string[] ViewerCodes() => [.. RolePermissionDefaults.For(GisRoles.Viewer)];

    private static string[] EditorCodes() => [.. RolePermissionDefaults.For(GisRoles.GisEditor)];

    private static string[] AnalystCodes() => [.. RolePermissionDefaults.For(GisRoles.GisAnalyst)];

    private static async Task<string[]> OfferedAsync(AsyncServiceScope scope, User actor) =>
        [.. (await Management(scope).GetAssignableRolesAsync(actor.Id)).Select(r => r.Name)];

    private static AppDbContext Db(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<AppDbContext>();

    private static IRoleManagementService Roles(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<IRoleManagementService>();

    private static IUserManagementService Management(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<IUserManagementService>();

    private static IEffectivePermissionService Effective(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<IEffectivePermissionService>();

    /// <summary>Verilen yetkilere sahip özel bir rol ve o roldeki aktif kullanıcı.</summary>
    private static async Task<User> CreateActorAsync(AsyncServiceScope scope, string userName, params string[] codes)
    {
        var roleName = $"Role-{userName}";
        var role = (await Roles(scope).CreateRoleAsync(new CreateRoleRequest { Name = roleName })).Value!;

        /* Kurgu doğrudan veritabanına yazılır: ReplaceRolePermissionsAsync
           artık grant-authority bariyeri uygular ve kurulmakta olan ZAYIF
           aktörün kendi rolünü donatması o bariyere takılırdı. Buranın konusu
           atanabilir rol keşfidir. */
        await SeedRolePermissionsAsync(scope, role.Id, codes);

        return await CreateUserAsync(scope, userName, roleName);
    }

    private static async Task SeedRolePermissionsAsync(AsyncServiceScope scope, int roleId, string[] codes)
    {
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var ids = await db.Permissions
            .Where(p => codes.Contains(p.Code))
            .Select(p => p.Id)
            .ToListAsync();

        Assert.Equal(codes.Distinct().Count(), ids.Count);

        db.RolePermissions.AddRange(ids.Select(id => new RolePermission { RoleId = roleId, PermissionId = id }));
        await db.SaveChangesAsync();
    }

    private static async Task<User> CreateUserAsync(AsyncServiceScope scope, string userName, string role)
    {
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

    private static async Task<string[]> RolesOfAsync(AsyncServiceScope scope, User user)
    {
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        return [.. await users.GetRolesAsync((await users.FindByIdAsync(user.Id.ToString()))!)];
    }

    private static async Task GrantDirectAsync(AsyncServiceScope scope, User user, string code)
    {
        var db = Db(scope);
        var permission = await db.Permissions.SingleAsync(p => p.Code == code);

        db.UserPermissions.Add(new UserPermission { UserId = user.Id, PermissionId = permission.Id });
        await db.SaveChangesAsync();
    }

    private static async Task DeactivateAsync(AsyncServiceScope scope, string code)
    {
        var db = Db(scope);
        var permission = await db.Permissions.SingleAsync(p => p.Code == code);
        permission.IsActive = false;
        await db.SaveChangesAsync();
    }

    private static async Task GrantRoleAsync(AsyncServiceScope scope, string roleName, string code)
    {
        var db = Db(scope);
        var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

        var role = await roleManager.FindByNameAsync(roleName);
        var permission = await db.Permissions.SingleAsync(p => p.Code == code);

        db.RolePermissions.Add(new RolePermission { RoleId = role!.Id, PermissionId = permission.Id });
        await db.SaveChangesAsync();
    }

    private static async Task RevokeRoleGrantAsync(AsyncServiceScope scope, string roleName, string code)
    {
        var db = Db(scope);
        var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

        var role = await roleManager.FindByNameAsync(roleName);
        var permission = await db.Permissions.SingleAsync(p => p.Code == code);

        db.RolePermissions.Remove(
            await db.RolePermissions.SingleAsync(rp => rp.RoleId == role!.Id && rp.PermissionId == permission.Id));
        await db.SaveChangesAsync();
    }

    private static async Task<AsyncServiceScope> CreateScopeAsync()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
        services.AddDbContext<AppDbContext>(o => o
            .UseInMemoryDatabase($"actor-aware-roles-{Guid.NewGuid():N}")
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)));

        services.AddIdentityCore<User>(o =>
            {
                o.Password.RequiredLength = 8;
                o.User.RequireUniqueEmail = true;
            })
            .AddRoles<IdentityRole<int>>()
            .AddEntityFrameworkStores<AppDbContext>()
            .AddDefaultTokenProviders();

        services.AddSingleton(new ClientAppOptions { BaseUrl = "https://client.example.invalid" });
        services.AddSingleton(Substitute.For<IEmailSender>());

        // Üretimdeki kayıtların aynısı; test kendi yetki mantığını kurmaz.
        services.AddScoped<IEffectivePermissionService, EffectivePermissionService>();
        services.AddScoped<IGeographicAuthorizationService, GeographicAuthorizationService>();
        services.AddScoped<IRoleManagementService, RoleManagementService>();
        services.AddScoped<IUserManagementService, UserManagementService>();

        var scope = services.BuildServiceProvider().CreateAsyncScope();

        var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

        foreach (var role in ApplicationRoles.Retired)
        {
            await roleManager.CreateAsync(new IdentityRole<int>(role));
        }

        await AuthorizationDataSeeder.SeedAsync(
            Db(scope),
            roleManager,
            scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("seed"));

        // Son aktif Admin koruması rol değiştirme testlerini engellemesin.
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var keeper = new User
        {
            UserName = "keeper-admin",
            Email = "keeper-admin@example.invalid",
            EmailConfirmed = true,
            AccountStatus = AccountStatus.Active,
            IsActive = true
        };
        await users.CreateAsync(keeper, "Str0ng!Password");
        await users.AddToRoleAsync(keeper, GisRoles.Administrator);

        return scope;
    }
}
