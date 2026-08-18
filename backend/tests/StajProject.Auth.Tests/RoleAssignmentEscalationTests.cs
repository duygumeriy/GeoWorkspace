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
/// Yetki yükseltme koruması: kimse sahip olmadığı yetkileri dağıtamaz.
/// </summary>
/// <remarks>
/// <para>
/// Kural: <c>hedef rolün aktif yetkileri ⊆ çağıranın etkin yetkileri</c>.
/// Bu olmadan <c>users.update</c> yetkisi olan biri, bir başkasını
/// <c>Administrator</c> yapıp o hesap üzerinden tüm sisteme erişebilirdi.
/// </para>
/// <para>
/// Testler rol ADINA değil yetki KÜMESİNE bakıldığını da kanıtlar; aksi hâlde
/// özel roller için hiçbir hiyerarşi tanımlanamazdı.
/// </para>
/// </remarks>
public class RoleAssignmentEscalationTests
{
    /* --- Asıl açık: zayıf aktör güçlü rol atayamaz ------------------------------- */

    [Fact]
    public async Task An_actor_holding_only_users_update_cannot_promote_someone_to_administrator()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "helpdesk", PermissionCodes.UsersUpdate);
        var victim = await CreateUserAsync(scope, "victim", GisRoles.Viewer);

        var result = await Management(scope).ChangeRoleAsync(
            victim.Id, new UpdateUserRoleRequest { Role = GisRoles.Administrator }, actor.Id);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);

        // Kurbanın rolü ve yetkileri hiç değişmedi — kısmi uygulama yok.
        Assert.Equal([GisRoles.Viewer], await RolesOfAsync(scope, victim));
        Assert.Equal(6, (await Effective(scope).GetEffectivePermissionCodesAsync(victim.Id)).Count);
    }

    [Fact]
    public async Task The_rejection_does_not_disclose_which_permissions_are_missing()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "prober", PermissionCodes.UsersUpdate);
        var victim = await CreateUserAsync(scope, "probed", GisRoles.Viewer);

        var result = await Management(scope).ChangeRoleAsync(
            victim.Id, new UpdateUserRoleRequest { Role = GisRoles.Administrator }, actor.Id);

        /* Eksik yetkiler sıralansaydı, mesaj saldırgana hedef rolün yetki
           haritasını veren bir keşif aracına dönüşürdü. */
        Assert.DoesNotContain(PermissionCodes.UsersDelete, result.Error);
        Assert.DoesNotContain(PermissionCodes.PermissionsAssign, result.Error);
    }

    /* --- Onay akışı: atomiklik ---------------------------------------------------- */

    [Fact]
    public async Task A_weak_actor_cannot_approve_a_pending_user_as_administrator()
    {
        await using var scope = await CreateScopeAsync();
        var email = scope.ServiceProvider.GetRequiredService<IEmailSender>();
        var actor = await CreateActorAsync(scope, "weak-approver", PermissionCodes.UsersUpdate);
        var pending = await CreatePendingUserAsync(scope, "pending-target");

        var result = await Management(scope).ApproveAsync(
            pending.Id, new ApproveUserRequest { Role = GisRoles.Administrator }, actor.Id);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);

        /* Onay reddedildiğinde hesabın HİÇBİR alanı değişmez: durum, aktiflik
           ve rol olduğu gibi kalır ve bilgilendirme e-postası gönderilmez. */
        var reloaded = await ReloadAsync(scope, pending);
        Assert.Equal(AccountStatus.PendingApproval, reloaded.AccountStatus);
        Assert.False(reloaded.IsActive);
        Assert.Null(reloaded.ApprovedAt);
        Assert.Empty(await RolesOfAsync(scope, pending));
        await email.DidNotReceiveWithAnyArgs().SendAsync(default!, default);
    }

    [Fact]
    public async Task A_sufficient_actor_can_approve_a_pending_user_as_administrator()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateUserAsync(scope, "real-admin", GisRoles.Administrator);
        var pending = await CreatePendingUserAsync(scope, "promoted");

        // Aktör legacy Admin rolüne SAHİP DEĞİL; yetkisi rolünün yetki satırlarından geliyor.
        Assert.DoesNotContain(ApplicationRoles.Admin, await RolesOfAsync(scope, actor));

        var result = await Management(scope).ApproveAsync(
            pending.Id, new ApproveUserRequest { Role = GisRoles.Administrator }, actor.Id);

        Assert.True(result.IsSuccess);
        Assert.Equal([GisRoles.Administrator], await RolesOfAsync(scope, pending));
        Assert.Equal(AccountStatus.Active, (await ReloadAsync(scope, pending)).AccountStatus);
    }

    /* --- Rol değiştirme: atomiklik ------------------------------------------------- */

    [Fact]
    public async Task A_weak_actor_cannot_move_a_viewer_up_to_gis_editor()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "weak-mover", PermissionCodes.UsersUpdate);
        var victim = await CreateUserAsync(scope, "stays-viewer", GisRoles.Viewer);

        var result = await Management(scope).ChangeRoleAsync(
            victim.Id, new UpdateUserRoleRequest { Role = GisRoles.GisEditor }, actor.Id);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);

        // Eski rol önce kaldırılıp sonra ekleme başarısız olmadı: Viewer duruyor.
        Assert.Equal([GisRoles.Viewer], await RolesOfAsync(scope, victim));
    }

    [Fact]
    public async Task An_actor_may_assign_a_role_whose_permissions_it_fully_holds()
    {
        await using var scope = await CreateScopeAsync();

        // Viewer'ın altı yetkisi + users.update taşıyan özel rol.
        var actor = await CreateActorAsync(
            scope,
            "viewer-manager",
            PermissionCodes.UsersUpdate,
            PermissionCodes.MapView,
            PermissionCodes.DrawingsView,
            PermissionCodes.MeasurementUse,
            PermissionCodes.SelectionUse,
            PermissionCodes.InventoryView,
            PermissionCodes.LayersView);

        var target = await CreatePendingUserAsync(scope, "new-viewer");

        var result = await Management(scope).ApproveAsync(
            target.Id, new ApproveUserRequest { Role = GisRoles.Viewer }, actor.Id);

        /* Aktör ne Admin ne Administrator; yalnızca hedef rolün yetkilerinin
           tamamına sahip. Sistem rol ADINA değil yetki KÜMESİNE bakıyor. */
        Assert.True(result.IsSuccess);
        Assert.Equal([GisRoles.Viewer], await RolesOfAsync(scope, target));
    }

    /* --- Özel roller ---------------------------------------------------------------- */

    [Fact]
    public async Task An_actor_may_assign_a_custom_role_it_fully_covers_but_not_one_it_does_not()
    {
        await using var scope = await CreateScopeAsync();
        var roles = Roles(scope);

        var coverable = (await roles.CreateRoleAsync(new CreateRoleRequest { Name = "Read Only Analyst" })).Value!;
        await ReplaceAsync(scope, coverable.Id, PermissionCodes.MapView, PermissionCodes.DrawingsView);

        var beyond = (await roles.CreateRoleAsync(new CreateRoleRequest { Name = "Regional Editor" })).Value!;
        await ReplaceAsync(scope, beyond.Id, PermissionCodes.MapView, PermissionCodes.UsersDelete);

        var actor = await CreateActorAsync(
            scope, "custom-manager",
            PermissionCodes.UsersUpdate, PermissionCodes.MapView, PermissionCodes.DrawingsView);

        var allowed = await CreatePendingUserAsync(scope, "custom-ok");
        Assert.True((await Management(scope).ApproveAsync(
            allowed.Id, new ApproveUserRequest { Role = "Read Only Analyst" }, actor.Id)).IsSuccess);

        var denied = await CreatePendingUserAsync(scope, "custom-denied");
        var result = await Management(scope).ApproveAsync(
            denied.Id, new ApproveUserRequest { Role = "Regional Editor" }, actor.Id);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
    }

    [Fact]
    public async Task A_role_with_no_permissions_can_be_assigned_by_any_authorised_actor()
    {
        await using var scope = await CreateScopeAsync();
        var empty = (await Roles(scope).CreateRoleAsync(new CreateRoleRequest { Name = "Intern GIS" })).Value!;
        var actor = await CreateActorAsync(scope, "intern-manager", PermissionCodes.UsersUpdate);
        var target = await CreatePendingUserAsync(scope, "intern");

        /* Boş küme her kümenin alt kümesidir ve böyle bir rol hiçbir uygulama
           yeteneği vermez; engellemek için güvenlik gerekçesi yoktur. */
        Assert.Equal(0, empty.PermissionCount);
        Assert.True((await Management(scope).ApproveAsync(
            target.Id, new ApproveUserRequest { Role = "Intern GIS" }, actor.Id)).IsSuccess);
    }

    /* --- Legacy Admin: veriyle uyumluluk, adla değil -------------------------------- */

    [Fact]
    public async Task A_legacy_admin_can_still_assign_target_roles_through_its_permission_data()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateUserAsync(scope, "legacy-admin-actor", ApplicationRoles.Admin);
        var pending = await CreatePendingUserAsync(scope, "legacy-approved");

        // 27 yetkiye gerçekten sahip olduğu için geçer.
        Assert.True((await Management(scope).ApproveAsync(
            pending.Id, new ApproveUserRequest { Role = GisRoles.GisManager }, actor.Id)).IsSuccess);
    }

    [Fact]
    public async Task A_legacy_admin_is_rejected_once_it_loses_a_permission_the_target_role_needs()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateUserAsync(scope, "stripped-admin", ApplicationRoles.Admin);
        var victim = await CreateUserAsync(scope, "target", GisRoles.Viewer);

        // Rol adı değişmiyor; yalnızca tek bir yetki satırı kaldırılıyor.
        await RevokeRoleGrantAsync(scope, ApplicationRoles.Admin, PermissionCodes.LayersManage);

        var result = await Management(scope).ChangeRoleAsync(
            victim.Id, new UpdateUserRoleRequest { Role = GisRoles.GisManager }, actor.Id);

        /* Kodda "Admin ise geç" kestirmesi olsaydı bu istek yine geçerdi.
           403 dönmesi, uyumluluğun VERİDEN geldiğini kanıtlar. */
        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
        Assert.Equal([GisRoles.Viewer], await RolesOfAsync(scope, victim));
    }

    /* --- Doğrudan kullanıcı yetkisi sayılır ---------------------------------------- */

    [Fact]
    public async Task A_direct_user_permission_can_complete_the_actors_authority()
    {
        await using var scope = await CreateScopeAsync();

        // GIS Editor'ün 14 yetkisinden biri hariç hepsi + users.update.
        var actor = await CreateActorAsync(
            scope, "almost-editor",
            PermissionCodes.UsersUpdate,
            PermissionCodes.MapView, PermissionCodes.DrawingsView, PermissionCodes.MeasurementUse,
            PermissionCodes.SelectionUse, PermissionCodes.InventoryView, PermissionCodes.LayersView,
            PermissionCodes.DrawingsPointCreate, PermissionCodes.DrawingsLineCreate,
            PermissionCodes.DrawingsPolygonCreate, PermissionCodes.DrawingsMetadataUpdate,
            PermissionCodes.DrawingsGeometryUpdate, PermissionCodes.DrawingsStyleUpdate,
            PermissionCodes.DrawingsDelete);

        var first = await CreatePendingUserAsync(scope, "editor-attempt-1");
        Assert.False((await Management(scope).ApproveAsync(
            first.Id, new ApproveUserRequest { Role = GisRoles.GisEditor }, actor.Id)).IsSuccess);

        // Eksik yetki DOĞRUDAN veriliyor; aktörün rolü değişmiyor.
        await GrantDirectAsync(scope, actor, PermissionCodes.DrawingsRestore);

        var second = await CreatePendingUserAsync(scope, "editor-attempt-2");
        Assert.True((await Management(scope).ApproveAsync(
            second.Id, new ApproveUserRequest { Role = GisRoles.GisEditor }, actor.Id)).IsSuccess);
    }

    /* --- Canlı: hedef rolün yetkileri değişince karar da değişir -------------------- */

    [Fact]
    public async Task Widening_the_target_role_immediately_revokes_the_actors_ability_to_assign_it()
    {
        await using var scope = await CreateScopeAsync();

        var custom = (await Roles(scope).CreateRoleAsync(new CreateRoleRequest { Name = "Field Surveyor" })).Value!;
        await ReplaceAsync(scope, custom.Id, PermissionCodes.MapView);

        var actor = await CreateActorAsync(scope, "surveyor-manager", PermissionCodes.UsersUpdate, PermissionCodes.MapView);

        var first = await CreatePendingUserAsync(scope, "surveyor-1");
        Assert.True((await Management(scope).ApproveAsync(
            first.Id, new ApproveUserRequest { Role = "Field Surveyor" }, actor.Id)).IsSuccess);

        // Rol genişletiliyor; aktörün sahip olmadığı bir yetki ekleniyor.
        await ReplaceAsync(scope, custom.Id, PermissionCodes.MapView, PermissionCodes.UsersDelete);

        var second = await CreatePendingUserAsync(scope, "surveyor-2");
        var result = await Management(scope).ApproveAsync(
            second.Id, new ApproveUserRequest { Role = "Field Surveyor" }, actor.Id);

        /* Yeniden giriş veya token yenilemesi YOK: hedef rolün yetkileri her
           kontrolde canlı okunuyor, anlık görüntü saklanmıyor. */
        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
    }

    [Fact]
    public async Task An_inactive_permission_does_not_block_an_assignment()
    {
        await using var scope = await CreateScopeAsync();

        var custom = (await Roles(scope).CreateRoleAsync(new CreateRoleRequest { Name = "Field Surveyor" })).Value!;
        await ReplaceAsync(scope, custom.Id, PermissionCodes.MapView, PermissionCodes.LayersManage);

        var actor = await CreateActorAsync(scope, "partial-manager", PermissionCodes.UsersUpdate, PermissionCodes.MapView);

        var blocked = await CreatePendingUserAsync(scope, "blocked");
        Assert.False((await Management(scope).ApproveAsync(
            blocked.Id, new ApproveUserRequest { Role = "Field Surveyor" }, actor.Id)).IsSuccess);

        // Yetki kullanımdan kaldırılıyor: artık kimseye bir şey vermiyor.
        await DeactivateAsync(scope, PermissionCodes.LayersManage);

        var allowed = await CreatePendingUserAsync(scope, "allowed");

        /* Pasif tanım karşılaştırmaya girmez: kimseye yetki vermeyen bir satır
           yüzünden atamayı engellemek anlamsız olurdu. */
        Assert.True((await Management(scope).ApproveAsync(
            allowed.Id, new ApproveUserRequest { Role = "Field Surveyor" }, actor.Id)).IsSuccess);
    }

    /* --- Legacy roller hâlâ atanamaz ------------------------------------------------ */

    [Theory]
    [InlineData(ApplicationRoles.Admin)]
    [InlineData(ApplicationRoles.User)]
    public async Task The_subset_rule_does_not_reopen_legacy_role_assignment(string role)
    {
        await using var scope = await CreateScopeAsync();

        // Tam yetkili aktör bile legacy rol atayamaz; sıra: var mı → atanabilir mi → yetki.
        var actor = await CreateUserAsync(scope, "full-admin", GisRoles.Administrator);
        var pending = await CreatePendingUserAsync(scope, $"legacy-{role}");

        var result = await Management(scope).ApproveAsync(
            pending.Id, new ApproveUserRequest { Role = role }, actor.Id);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
        Assert.Empty(await RolesOfAsync(scope, pending));
    }

    /* --- Yardımcılar ----------------------------------------------------------------- */

    private static AppDbContext Db(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<AppDbContext>();

    private static IRoleManagementService Roles(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<IRoleManagementService>();

    private static IUserManagementService Management(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<IUserManagementService>();

    private static IEffectivePermissionService Effective(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<IEffectivePermissionService>();

    private static Task ReplaceAsync(AsyncServiceScope scope, int roleId, params string[] codes) =>
        Roles(scope).ReplaceRolePermissionsAsync(roleId, new UpdateRolePermissionsRequest { PermissionCodes = [.. codes] });

    /// <summary>Verilen yetkilere sahip özel bir rol ve o roldeki aktif kullanıcı.</summary>
    private static async Task<User> CreateActorAsync(AsyncServiceScope scope, string userName, params string[] codes)
    {
        var roleName = $"Role-{userName}";
        var role = (await Roles(scope).CreateRoleAsync(new CreateRoleRequest { Name = roleName })).Value!;
        await ReplaceAsync(scope, role.Id, codes);

        return await CreateUserAsync(scope, userName, roleName);
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

    private static async Task<User> CreatePendingUserAsync(AsyncServiceScope scope, string userName)
    {
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();

        var user = new User
        {
            UserName = userName,
            Email = $"{userName}@example.invalid",
            EmailConfirmed = true,
            AccountStatus = AccountStatus.PendingApproval,
            IsActive = false
        };

        Assert.True((await users.CreateAsync(user, "Str0ng!Password")).Succeeded);
        return user;
    }

    private static async Task<string[]> RolesOfAsync(AsyncServiceScope scope, User user)
    {
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        return [.. await users.GetRolesAsync((await users.FindByIdAsync(user.Id.ToString()))!)];
    }

    private static async Task<User> ReloadAsync(AsyncServiceScope scope, User user) =>
        await Db(scope).Users.AsNoTracking().SingleAsync(u => u.Id == user.Id);

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
            .UseInMemoryDatabase($"escalation-{Guid.NewGuid():N}")
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
        services.AddScoped<IEffectivePermissionService, EffectivePermissionService>();
        services.AddScoped<IRoleManagementService, RoleManagementService>();
        services.AddScoped<IUserManagementService, UserManagementService>();

        var scope = services.BuildServiceProvider().CreateAsyncScope();

        var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

        foreach (var role in ApplicationRoles.All)
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
        await users.AddToRoleAsync(keeper, ApplicationRoles.Admin);

        return scope;
    }
}
