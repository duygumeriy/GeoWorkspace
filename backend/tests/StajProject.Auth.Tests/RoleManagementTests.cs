using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NSubstitute;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Rol yönetimi ve rol-yetki matrisi iş kuralları.
/// </summary>
/// <remarks>
/// Gerçek <see cref="RoleManagementService"/>, gerçek Identity yöneticileri ve
/// gerçek <see cref="AuthorizationDataSeeder"/> kullanılır; yalnızca
/// veritabanı in-memory'dir. Testler kendi rol/yetki matrisini uydurmaz —
/// üretimde seed edilen veriyle çalışır.
/// </remarks>
public class RoleManagementTests
{
    /* --- Listeleme -------------------------------------------------------------- */

    [Fact]
    public async Task The_role_list_contains_the_canonical_and_legacy_roles_with_correct_metadata()
    {
        await using var scope = await CreateScopeAsync();

        var roles = await Service(scope).GetRolesAsync();

        Assert.Equal(7, roles.Count);

        var administrator = roles.Single(r => r.Name == GisRoles.Administrator);
        Assert.True(administrator.IsSystem);
        Assert.False(administrator.IsLegacy);
        Assert.True(administrator.IsAssignable);
        Assert.False(administrator.CanRename);
        Assert.False(administrator.CanDelete);
        Assert.True(administrator.CanEditPermissions);

        var legacyAdmin = roles.Single(r => r.Name == ApplicationRoles.Admin);
        Assert.True(legacyAdmin.IsSystem);
        Assert.True(legacyAdmin.IsLegacy);
        // Geçiş rolü: korunur ama yeni atamalara ve yetki düzenlemeye kapalı.
        Assert.False(legacyAdmin.IsAssignable);
        Assert.False(legacyAdmin.CanRename);
        Assert.False(legacyAdmin.CanDelete);
        Assert.False(legacyAdmin.CanEditPermissions);
    }

    [Fact]
    public async Task The_role_list_reports_user_and_permission_counts()
    {
        await using var scope = await CreateScopeAsync();
        await CreateUserAsync(scope, "counted", GisRoles.Viewer);

        var roles = await Service(scope).GetRolesAsync();

        var viewer = roles.Single(r => r.Name == GisRoles.Viewer);
        Assert.Equal(1, viewer.UserCount);
        Assert.Equal(6, viewer.PermissionCount);

        Assert.Equal(30, roles.Single(r => r.Name == GisRoles.Administrator).PermissionCount);
        Assert.Equal(0, roles.Single(r => r.Name == GisRoles.GisAnalyst).UserCount);
    }

    [Fact]
    public async Task The_role_list_is_ordered_canonically_then_alphabetically()
    {
        await using var scope = await CreateScopeAsync();
        var service = Service(scope);

        await service.CreateRoleAsync(new CreateRoleRequest { Name = "Zonal Editor" });
        await service.CreateRoleAsync(new CreateRoleRequest { Name = "Field Surveyor" });

        var names = (await service.GetRolesAsync()).Select(r => r.Name).ToArray();

        // Kanonik roller mantıksal sıralarında; geri kalanlar alfabetik.
        Assert.Equal(
            [GisRoles.Viewer, GisRoles.GisEditor, GisRoles.GisAnalyst, GisRoles.GisManager, GisRoles.Administrator],
            names.Take(5));
        Assert.Equal(["Admin", "Field Surveyor", "User", "Zonal Editor"], names.Skip(5));
    }

    /* --- Atanabilir roller ------------------------------------------------------- */

    [Fact]
    public async Task Assignable_roles_contain_the_target_roles_and_exclude_the_legacy_ones()
    {
        await using var scope = await CreateScopeAsync();

        /* Liste çağırana özeldir; burada ölçülen GENEL atanabilirlik filtresi
           olduğu için aktör tam yetkilidir ve yetki alt küme kuralı hiçbir rolü
           elemez. */
        var actor = await CreateUserAsync(scope, "assignable-reader", GisRoles.Administrator);

        var assignable = (await Service(scope).GetAssignableRolesAsync(actor.Id)).Select(r => r.Name).ToArray();

        Assert.Equal(
            [GisRoles.Viewer, GisRoles.GisEditor, GisRoles.GisAnalyst, GisRoles.GisManager, GisRoles.Administrator],
            assignable);

        // Geçiş köprüsü yeni atamalara kapalı; mevcut kullanıcılar etkilenmez.
        Assert.DoesNotContain(ApplicationRoles.Admin, assignable);
        Assert.DoesNotContain(ApplicationRoles.User, assignable);
    }

    [Fact]
    public async Task A_custom_role_becomes_assignable()
    {
        await using var scope = await CreateScopeAsync();
        var service = Service(scope);

        await service.CreateRoleAsync(new CreateRoleRequest { Name = "Field Surveyor" });
        var actor = await CreateUserAsync(scope, "custom-reader", GisRoles.Administrator);

        Assert.Contains("Field Surveyor", (await service.GetAssignableRolesAsync(actor.Id)).Select(r => r.Name));
    }

    [Theory]
    [InlineData(ApplicationRoles.Admin)]
    [InlineData(ApplicationRoles.User)]
    public async Task A_legacy_role_cannot_be_resolved_for_a_new_assignment(string role)
    {
        await using var scope = await CreateScopeAsync();
        // Tam yetkili bir çağıran: red sebebi yetkisizlik değil, rolün legacy olması.
        var actor = await CreateUserAsync(scope, "resolver-admin", GisRoles.Administrator);

        var result = await Service(scope).ResolveAssignableRoleAsync(role, actor.Id);

        Assert.False(result.IsSuccess);
    }

    [Fact]
    public async Task Role_resolution_is_case_insensitive_and_returns_the_canonical_spelling()
    {
        await using var scope = await CreateScopeAsync();

        var actor = await CreateUserAsync(scope, "resolver", GisRoles.Administrator);

        var result = await Service(scope).ResolveAssignableRoleAsync("  gis editor ", actor.Id);

        Assert.True(result.IsSuccess);
        Assert.Equal(GisRoles.GisEditor, result.Value);
    }

    /* --- Oluşturma ---------------------------------------------------------------- */

    [Fact]
    public async Task Creating_a_custom_role_succeeds_and_starts_with_no_permissions()
    {
        await using var scope = await CreateScopeAsync();
        var service = Service(scope);

        var result = await service.CreateRoleAsync(new CreateRoleRequest { Name = "  Field Surveyor  " });

        Assert.True(result.IsSuccess);
        Assert.Equal("Field Surveyor", result.Value!.Name);
        Assert.False(result.Value.IsSystem);
        Assert.True(result.Value.IsAssignable);
        Assert.True(result.Value.CanRename);
        Assert.True(result.Value.CanDelete);
        Assert.True(result.Value.CanEditPermissions);

        /* Şablondan kopyalama YOK: yeni rol sıfır yetkiyle başlar, aksi hâlde
           yönetici farkında olmadığı yetkiler dağıtırdı. */
        Assert.Equal(0, result.Value.PermissionCount);
        var permissions = await service.GetRolePermissionsAsync(result.Value.Id);
        Assert.DoesNotContain(permissions.Value!.Permissions, p => p.Assigned);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Creating_a_role_without_a_name_is_rejected(string name)
    {
        await using var scope = await CreateScopeAsync();

        var result = await Service(scope).CreateRoleAsync(new CreateRoleRequest { Name = name });

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
    }

    [Theory]
    [InlineData("Administrator")]
    [InlineData("administrator")]
    [InlineData("GIS EDITOR")]
    [InlineData("admin")]
    public async Task Creating_a_role_that_collides_with_a_reserved_name_is_rejected(string name)
    {
        await using var scope = await CreateScopeAsync();

        // Identity normalize edilmiş ada göre eşitler; koruma da öyle davranmalı.
        var result = await Service(scope).CreateRoleAsync(new CreateRoleRequest { Name = name });

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, result.ErrorKind);
    }

    [Fact]
    public async Task Creating_a_duplicate_custom_role_is_rejected_regardless_of_casing()
    {
        await using var scope = await CreateScopeAsync();
        var service = Service(scope);

        Assert.True((await service.CreateRoleAsync(new CreateRoleRequest { Name = "Field Surveyor" })).IsSuccess);

        var duplicate = await service.CreateRoleAsync(new CreateRoleRequest { Name = "field surveyor" });

        Assert.False(duplicate.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, duplicate.ErrorKind);
    }

    /* --- Yeniden adlandırma -------------------------------------------------------- */

    [Fact]
    public async Task Renaming_a_custom_role_keeps_its_id_and_permissions()
    {
        await using var scope = await CreateScopeAsync();
        var service = Service(scope);

        var created = (await service.CreateRoleAsync(new CreateRoleRequest { Name = "Field Surveyor" })).Value!;
        await service.ReplaceRolePermissionsAsync(await AuthorityAsync(scope), created.Id, Codes(PermissionCodes.MapView, PermissionCodes.DrawingsView));

        var renamed = await service.RenameRoleAsync(created.Id, new UpdateRoleRequest { Name = "Regional Editor" });

        Assert.True(renamed.IsSuccess);
        Assert.Equal("Regional Editor", renamed.Value!.Name);

        /* Yeniden adlandırma bir KİMLİK değişikliği değildir: satır silinip
           yeniden oluşturulsaydı rolün yetkileri ve kullanıcı üyelikleri
           sessizce kaybolurdu. */
        Assert.Equal(created.Id, renamed.Value.Id);
        Assert.Equal(2, renamed.Value.PermissionCount);
    }

    [Theory]
    [InlineData(ApplicationRoles.Admin)]
    [InlineData(ApplicationRoles.User)]
    [InlineData(GisRoles.Viewer)]
    [InlineData(GisRoles.GisEditor)]
    [InlineData(GisRoles.GisAnalyst)]
    [InlineData(GisRoles.GisManager)]
    [InlineData(GisRoles.Administrator)]
    public async Task Renaming_a_reserved_role_is_rejected(string roleName)
    {
        await using var scope = await CreateScopeAsync();
        var service = Service(scope);
        var role = await FindRoleAsync(scope, roleName);

        var result = await service.RenameRoleAsync(role.Id, new UpdateRoleRequest { Name = "Something Else" });

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, result.ErrorKind);
        Assert.Equal(roleName, (await FindRoleAsync(scope, roleName)).Name);
    }

    [Fact]
    public async Task Renaming_a_custom_role_onto_an_existing_name_is_rejected()
    {
        await using var scope = await CreateScopeAsync();
        var service = Service(scope);

        var first = (await service.CreateRoleAsync(new CreateRoleRequest { Name = "Field Surveyor" })).Value!;
        await service.CreateRoleAsync(new CreateRoleRequest { Name = "Regional Editor" });

        Assert.False((await service.RenameRoleAsync(first.Id, new UpdateRoleRequest { Name = "regional editor" })).IsSuccess);
        Assert.False((await service.RenameRoleAsync(first.Id, new UpdateRoleRequest { Name = "Viewer" })).IsSuccess);
    }

    /* --- Silme ---------------------------------------------------------------------- */

    [Fact]
    public async Task Deleting_an_unassigned_custom_role_removes_its_grants_but_not_the_permissions()
    {
        await using var scope = await CreateScopeAsync();
        var service = Service(scope);
        var db = Db(scope);

        var created = (await service.CreateRoleAsync(new CreateRoleRequest { Name = "Field Surveyor" })).Value!;
        await service.ReplaceRolePermissionsAsync(await AuthorityAsync(scope), created.Id, Codes(PermissionCodes.MapView, PermissionCodes.DrawingsView));

        Assert.True((await service.DeleteRoleAsync(created.Id)).IsSuccess);

        // Grant satırları FK cascade ile gider…
        Assert.Empty(await db.RolePermissions.Where(rp => rp.RoleId == created.Id).ToListAsync());
        // …ama yetki TANIMLARI sistem tanımlarıdır ve asla silinmez.
        Assert.Equal(30, await db.Permissions.CountAsync());
    }

    [Fact]
    public async Task Deleting_a_custom_role_that_still_has_users_is_rejected()
    {
        await using var scope = await CreateScopeAsync();
        var service = Service(scope);

        var created = (await service.CreateRoleAsync(new CreateRoleRequest { Name = "Field Surveyor" })).Value!;
        var user = await CreateUserAsync(scope, "surveyor", "Field Surveyor");

        var result = await service.DeleteRoleAsync(created.Id);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, result.ErrorKind);

        /* Kullanıcılar sessizce başka bir role TAŞINMAZ ve üyelikleri
           kaldırılmaz; taşıma bilinçli bir yönetim kararı olmalıdır. */
        Assert.Contains("Field Surveyor", await RolesOfAsync(scope, user));
    }

    [Theory]
    [InlineData(ApplicationRoles.Admin)]
    [InlineData(ApplicationRoles.User)]
    [InlineData(GisRoles.Viewer)]
    [InlineData(GisRoles.Administrator)]
    public async Task Deleting_a_reserved_role_is_rejected(string roleName)
    {
        await using var scope = await CreateScopeAsync();
        var role = await FindRoleAsync(scope, roleName);

        var result = await Service(scope).DeleteRoleAsync(role.Id);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, result.ErrorKind);
        Assert.NotNull(await FindRoleAsync(scope, roleName));
    }

    /* --- Yetki kataloğu -------------------------------------------------------------- */

    [Fact]
    public async Task The_permission_catalog_returns_all_30_codes_in_a_deterministic_order()
    {
        await using var scope = await CreateScopeAsync();

        var catalog = await Service(scope).GetPermissionCatalogAsync();

        Assert.Equal(30, catalog.Count);
        Assert.Equal(30, catalog.Select(p => p.Code).Distinct(StringComparer.Ordinal).Count());

        var expectedOrder = catalog
            .OrderBy(p => p.Category, StringComparer.Ordinal)
            .ThenBy(p => p.SortOrder)
            .ThenBy(p => p.Code, StringComparer.Ordinal)
            .Select(p => p.Code);

        Assert.Equal(expectedOrder, catalog.Select(p => p.Code));
        Assert.All(catalog, p => Assert.True(p.IsActive));
    }

    [Fact]
    public async Task An_inactive_permission_stays_visible_but_is_marked_inactive()
    {
        await using var scope = await CreateScopeAsync();
        await DeactivateAsync(scope, PermissionCodes.DrawingsDelete);

        var catalog = await Service(scope).GetPermissionCatalogAsync();

        // Yönetici mevcut durumu eksiksiz görebilmeli; gizlemek kafa karıştırırdı.
        Assert.Equal(30, catalog.Count);
        Assert.False(catalog.Single(p => p.Code == PermissionCodes.DrawingsDelete).IsActive);
    }

    /* --- Rol yetkileri: okuma -------------------------------------------------------- */

    [Fact]
    public async Task Role_permissions_expose_the_assignment_state_for_the_whole_catalog()
    {
        await using var scope = await CreateScopeAsync();
        var role = await FindRoleAsync(scope, GisRoles.Viewer);

        var result = await Service(scope).GetRolePermissionsAsync(role.Id);

        Assert.True(result.IsSuccess);
        Assert.Equal(GisRoles.Viewer, result.Value!.Role.Name);
        Assert.Equal(30, result.Value.Permissions.Count);
        Assert.Equal(6, result.Value.Permissions.Count(p => p.Assigned));
        Assert.True(result.Value.Permissions.Single(p => p.Code == PermissionCodes.MapView).Assigned);
        Assert.False(result.Value.Permissions.Single(p => p.Code == PermissionCodes.UsersDelete).Assigned);
    }

    [Fact]
    public async Task Retired_role_has_no_new_seeded_permissions()
    {
        await using var scope = await CreateScopeAsync();
        var role = await FindRoleAsync(scope, ApplicationRoles.Admin);

        var result = await Service(scope).GetRolePermissionsAsync(role.Id);

        // Okuma serbesttir; seeder emekli role yeni grant vermez.
        Assert.True(result.IsSuccess);
        Assert.Empty(result.Value!.Permissions.Where(p => p.Assigned));
        Assert.False(result.Value.Role.CanEditPermissions);
    }

    /* --- Rol yetkileri: güncelleme ----------------------------------------------------- */

    [Fact]
    public async Task Replacing_target_role_permissions_applies_the_difference()
    {
        await using var scope = await CreateScopeAsync();
        var service = Service(scope);
        var role = await FindRoleAsync(scope, GisRoles.GisAnalyst);

        var result = await service.ReplaceRolePermissionsAsync(
            await AuthorityAsync(scope),
            role.Id,
            Codes(PermissionCodes.MapView, PermissionCodes.DrawingsView, PermissionCodes.LayersManage));

        Assert.True(result.IsSuccess);

        var assigned = result.Value!.Permissions.Where(p => p.Assigned).Select(p => p.Code).ToArray();
        Assert.Equal(
            [PermissionCodes.DrawingsView, PermissionCodes.LayersManage, PermissionCodes.MapView],
            assigned.OrderBy(c => c, StringComparer.Ordinal));

        // Analist'in varsayılan analiz yetkisi istekte yoktu; kaldırılmış olmalı.
        Assert.DoesNotContain(PermissionCodes.InventoryAnalysis, assigned);
    }

    [Fact]
    public async Task Critical_permission_cannot_be_removed_from_the_final_usable_administrator_role()
    {
        await using var scope = await CreateScopeAsync();
        var actorId = await AuthorityAsync(scope);
        var role = await FindRoleAsync(scope, GisRoles.Administrator);
        var before = await Service(scope).GetRolePermissionsAsync(role.Id);
        var desired = before.Value!.Permissions
            .Where(permission => permission.Assigned && permission.Code != PermissionCodes.RolesView)
            .Select(permission => permission.Code)
            .ToArray();

        var result = await Service(scope).ReplaceRolePermissionsAsync(
            actorId,
            role.Id,
            Codes(desired));

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, result.ErrorKind);
        Assert.Contains(PermissionCodes.RolesView, await Effective(scope).GetEffectivePermissionCodesAsync(actorId));
    }

    [Fact]
    public async Task Replacing_custom_role_permissions_succeeds()
    {
        await using var scope = await CreateScopeAsync();
        var service = Service(scope);
        var created = (await service.CreateRoleAsync(new CreateRoleRequest { Name = "Field Surveyor" })).Value!;

        var result = await service.ReplaceRolePermissionsAsync(
            await AuthorityAsync(scope),
            created.Id,
            Codes(PermissionCodes.MapView, PermissionCodes.DrawingsView, PermissionCodes.DrawingsPointCreate));

        Assert.True(result.IsSuccess);
        Assert.Equal(3, result.Value!.Permissions.Count(p => p.Assigned));
    }

    [Fact]
    public async Task Duplicate_permission_codes_in_the_request_are_treated_as_a_set()
    {
        await using var scope = await CreateScopeAsync();
        var service = Service(scope);
        var role = await FindRoleAsync(scope, GisRoles.Viewer);

        var result = await service.ReplaceRolePermissionsAsync(
            await AuthorityAsync(scope),
            role.Id,
            Codes(PermissionCodes.MapView, PermissionCodes.MapView, " " + PermissionCodes.MapView + " "));

        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value!.Permissions.Count(p => p.Assigned));
        Assert.Equal(1, await Db(scope).RolePermissions.CountAsync(rp => rp.RoleId == role.Id));
    }

    [Fact]
    public async Task An_unknown_permission_code_is_rejected_without_partial_application()
    {
        await using var scope = await CreateScopeAsync();
        var service = Service(scope);
        var role = await FindRoleAsync(scope, GisRoles.Viewer);

        var result = await service.ReplaceRolePermissionsAsync(
            await AuthorityAsync(scope),
            role.Id,
            Codes(PermissionCodes.MapView, "does.not.exist"));

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);

        /* Geçersiz kod sessizce atılmaz ve isteğin geçerli kısmı da
           uygulanmaz: yarı uygulanmış bir yetki kümesi, yöneticinin gördüğü
           ekranla veritabanını ayrıştırırdı. */
        Assert.Equal(6, await Db(scope).RolePermissions.CountAsync(rp => rp.RoleId == role.Id));
    }

    [Fact]
    public async Task Assigning_an_inactive_permission_is_rejected()
    {
        await using var scope = await CreateScopeAsync();
        var service = Service(scope);
        var role = await FindRoleAsync(scope, GisRoles.Viewer);

        await DeactivateAsync(scope, PermissionCodes.LayersManage);

        var result = await service.ReplaceRolePermissionsAsync(
            await AuthorityAsync(scope),
            role.Id,
            Codes(PermissionCodes.MapView, PermissionCodes.LayersManage));

        Assert.False(result.IsSuccess);

        // Bu uç bir yetkiyi yeniden aktifleştiremez.
        Assert.False(await Db(scope).Permissions.Where(p => p.Code == PermissionCodes.LayersManage).Select(p => p.IsActive).SingleAsync());
    }

    [Theory]
    [InlineData(ApplicationRoles.Admin)]
    [InlineData(ApplicationRoles.User)]
    public async Task Editing_a_legacy_role_permission_set_is_rejected(string roleName)
    {
        await using var scope = await CreateScopeAsync();
        var role = await FindRoleAsync(scope, roleName);
        var before = await Db(scope).RolePermissions.CountAsync(rp => rp.RoleId == role.Id);

        var result = await Service(scope).ReplaceRolePermissionsAsync(await AuthorityAsync(scope), role.Id, Codes(PermissionCodes.MapView));

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, result.ErrorKind);

        /* Admin ≡ Administrator ve User ≡ GIS Editor eşitliği, legacy roller
           bilinçli olarak emekliye ayrılana kadar korunmalıdır. */
        Assert.Equal(before, await Db(scope).RolePermissions.CountAsync(rp => rp.RoleId == role.Id));
    }

    [Fact]
    public async Task An_inactive_grant_survives_a_permission_replacement()
    {
        await using var scope = await CreateScopeAsync();
        var service = Service(scope);
        var role = await FindRoleAsync(scope, GisRoles.GisEditor);

        await DeactivateAsync(scope, PermissionCodes.DrawingsDelete);

        // İstek yalnızca AKTİF yetki kümesini tanımlar.
        Assert.True((await service.ReplaceRolePermissionsAsync(await AuthorityAsync(scope), role.Id, Codes(PermissionCodes.MapView))).IsSuccess);

        /* Pasif yetkiye ait bağ korunur: aksi hâlde bir yetki pasifleştirilip
           ilk kaydetme yapıldığında ilişki kalıcı olarak silinir ve yetki
           yeniden aktifleştirildiğinde geri gelmezdi. */
        var deleteId = await Db(scope).Permissions
            .Where(p => p.Code == PermissionCodes.DrawingsDelete).Select(p => p.Id).SingleAsync();

        Assert.True(await Db(scope).RolePermissions.AnyAsync(rp => rp.RoleId == role.Id && rp.PermissionId == deleteId));
    }

    /* --- Canlı yetkilendirmeye etki -------------------------------------------------- */

    [Fact]
    public async Task Removing_a_role_permission_changes_effective_permissions_immediately()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "analyst", GisRoles.GisAnalyst);
        var permissions = Effective(scope);
        var role = await FindRoleAsync(scope, GisRoles.GisAnalyst);

        Assert.True(await permissions.HasPermissionAsync(user.Id, PermissionCodes.InventoryAnalysis));

        await Service(scope).ReplaceRolePermissionsAsync(await AuthorityAsync(scope), role.Id, Codes(PermissionCodes.MapView));

        // Yeniden giriş, token yenilemesi veya restart YOK.
        Assert.False(await permissions.HasPermissionAsync(user.Id, PermissionCodes.InventoryAnalysis));
    }

    [Fact]
    public async Task Adding_a_role_permission_changes_effective_permissions_immediately()
    {
        await using var scope = await CreateScopeAsync();
        var user = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);
        var permissions = Effective(scope);
        var role = await FindRoleAsync(scope, GisRoles.Viewer);

        Assert.False(await permissions.HasPermissionAsync(user.Id, PermissionCodes.DrawingsPointCreate));

        await Service(scope).ReplaceRolePermissionsAsync(
            await AuthorityAsync(scope),
            role.Id,
            Codes(PermissionCodes.MapView, PermissionCodes.DrawingsPointCreate));

        Assert.True(await permissions.HasPermissionAsync(user.Id, PermissionCodes.DrawingsPointCreate));
    }

    [Fact]
    public async Task A_custom_role_grants_real_authorization()
    {
        await using var scope = await CreateScopeAsync();
        var service = Service(scope);

        var created = (await service.CreateRoleAsync(new CreateRoleRequest { Name = "Field Surveyor" })).Value!;
        var user = await CreateUserAsync(scope, "field", "Field Surveyor");

        Assert.Empty(await Effective(scope).GetEffectivePermissionCodesAsync(user.Id));

        await service.ReplaceRolePermissionsAsync(
            await AuthorityAsync(scope),
            created.Id,
            Codes(PermissionCodes.MapView, PermissionCodes.DrawingsView, PermissionCodes.DrawingsPointCreate));

        var codes = await Effective(scope).GetEffectivePermissionCodesAsync(user.Id);

        Assert.Equal(3, codes.Count);
        Assert.Contains(PermissionCodes.DrawingsPointCreate, codes);
    }

    /* --- Seeder ile birlikte yaşam ---------------------------------------------------- */

    [Fact]
    public async Task Reseeding_does_not_restore_permissions_an_administrator_removed()
    {
        await using var scope = await CreateScopeAsync();
        var role = await FindRoleAsync(scope, GisRoles.GisEditor);

        await Service(scope).ReplaceRolePermissionsAsync(await AuthorityAsync(scope), role.Id, Codes(PermissionCodes.MapView));

        await SeedAsync(scope);

        /* Seeder başlangıç değeri verir, kural dayatmaz: yöneticinin bilinçli
           düzenlemesi yeniden başlatmada geri alınmamalıdır. */
        var permissions = await Service(scope).GetRolePermissionsAsync(role.Id);
        Assert.Equal(1, permissions.Value!.Permissions.Count(p => p.Assigned));
    }

    [Fact]
    public async Task Reseeding_never_grants_permissions_to_a_custom_role()
    {
        await using var scope = await CreateScopeAsync();
        var created = (await Service(scope).CreateRoleAsync(new CreateRoleRequest { Name = "Field Surveyor" })).Value!;

        await SeedAsync(scope);

        Assert.Equal(0, await Db(scope).RolePermissions.CountAsync(rp => rp.RoleId == created.Id));
    }

    /* --- Yardımcılar ------------------------------------------------------------------- */

    private static UpdateRolePermissionsRequest Codes(params string[] codes) => new() { PermissionCodes = [.. codes] };

    private static AppDbContext Db(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<AppDbContext>();

    private static IRoleManagementService Service(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<IRoleManagementService>();

    private static IEffectivePermissionService Effective(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<IEffectivePermissionService>();

    /// <summary>
    /// Bu dosyadaki yetki düzenleme testlerinin çağıranı: katalogdaki tüm
    /// yetkilere sahip bir Administrator.
    /// </summary>
    /// <remarks>
    /// <c>ReplaceRolePermissionsAsync</c> artık <c>yeni eklenenler ⊆ çağıranın
    /// etkin yetkileri</c> kuralını uygular. Buradaki testlerin konusu o kural
    /// DEĞİL, fark hesabı ve doğrulama semantiğidir; bu yüzden çağıran bilerek
    /// tam yetkilidir ve bariyer testlerin konusunu gölgelemez. Bariyerin
    /// kendisi <c>RolePermissionGrantAuthorityTests</c> içinde sınanır.
    /// </remarks>
    private static async Task<int> AuthorityAsync(AsyncServiceScope scope)
    {
        const string userName = "permission-authority";

        var existing = await Db(scope).Users.AsNoTracking().SingleOrDefaultAsync(u => u.UserName == userName);

        return existing?.Id ?? (await CreateUserAsync(scope, userName, GisRoles.Administrator)).Id;
    }

    private static async Task<IdentityRole<int>> FindRoleAsync(AsyncServiceScope scope, string name)
    {
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();
        var role = await roles.FindByNameAsync(name);
        Assert.NotNull(role);
        return role!;
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

    private static async Task DeactivateAsync(AsyncServiceScope scope, string code)
    {
        var db = Db(scope);
        var permission = await db.Permissions.SingleAsync(p => p.Code == code);
        permission.IsActive = false;
        await db.SaveChangesAsync();
    }

    private static Task SeedAsync(AsyncServiceScope scope) =>
        AuthorizationDataSeeder.SeedAsync(
            Db(scope),
            scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>(),
            scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("seed"));

    private static async Task<AsyncServiceScope> CreateScopeAsync()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
        services.AddDbContext<AppDbContext>(options => options
            .UseInMemoryDatabase($"role-management-{Guid.NewGuid():N}")
            .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.InMemoryEventId.TransactionIgnoredWarning)));

        services.AddIdentityCore<User>(options => options.Password.RequiredLength = 8)
            .AddRoles<IdentityRole<int>>()
            .AddEntityFrameworkStores<AppDbContext>()
            .AddDefaultTokenProviders();

        services.AddScoped<IEffectivePermissionService, EffectivePermissionService>();
        services.AddScoped<IGeographicAuthorizationService, GeographicAuthorizationService>();
        services.AddScoped<IRoleManagementService, RoleManagementService>();
        services.AddSingleton(Substitute.For<ILogger<RoleManagementService>>());

        var scope = services.BuildServiceProvider().CreateAsyncScope();

        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

        foreach (var role in ApplicationRoles.Retired)
        {
            await roles.CreateAsync(new IdentityRole<int>(role));
        }

        await SeedAsync(scope);
        return scope;
    }
}
