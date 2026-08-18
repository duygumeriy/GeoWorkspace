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
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Kullanıcıya doğrudan verilen yetkilerin okunması ve güvenli güncellenmesi.
/// </summary>
/// <remarks>
/// <para>
/// İki soru ayrı ayrı sınanır: <b>kaynak</b> ("bu yetki nereden geliyor") ve
/// <b>etki</b> ("gerçekten işliyor mu"). İkisi karıştırılırsa ekran, duran ama
/// çalışmayan bir yetkiyi "var" gösterir — yetkilendirmede en sinsi hata sınıfı.
/// </para>
/// <para>
/// Yetki yükseltme bariyeri rol yetkisi ucundakiyle aynı kuraldır:
/// <c>yeni eklenenler ⊆ çağıranın etkin yetkileri</c>. Kaldırma ayrıcalığı
/// azalttığı için kapsam dışıdır.
/// </para>
/// </remarks>
public class UserPermissionManagementTests
{
    /* Çağıranı uca taşıyan yetkiler; dağıtma otoritesi bunlardan bağımsızdır. */
    private static readonly string[] Gate = [PermissionCodes.UsersUpdate, PermissionCodes.PermissionsAssign];

    /* --- Okuma modeli: kaynak ---------------------------------------------------------- */

    [Fact]
    public async Task A_permission_granted_by_the_users_role_is_reported_as_inherited()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "reader", Gate);
        var target = await CreateUserAsync(scope, "editor", GisRoles.GisEditor);

        var item = await ItemAsync(scope, actor.Id, target.Id, PermissionCodes.DrawingsPointCreate);

        Assert.Equal([GisRoles.GisEditor], item.InheritedFromRoles);
        Assert.False(item.DirectAssigned);
        Assert.True(item.Effective);

        // Rolden geliyorsa AYRICA doğrudan atanamaz; ikinci satır hiçbir şey eklemez.
        Assert.False(item.CanAssignDirect);
        Assert.False(item.CanRemoveDirect);
    }

    [Fact]
    public async Task A_directly_granted_permission_is_reported_as_direct()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "reader", Gate);
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        await GrantDirectAsync(scope, target, PermissionCodes.InventoryAnalysis);

        var item = await ItemAsync(scope, actor.Id, target.Id, PermissionCodes.InventoryAnalysis);

        Assert.Empty(item.InheritedFromRoles);
        Assert.True(item.DirectAssigned);
        Assert.True(item.Effective);
        Assert.True(item.CanRemoveDirect);
    }

    [Fact]
    public async Task An_unassigned_permission_is_reported_as_neither()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "reader", Gate);
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        var item = await ItemAsync(scope, actor.Id, target.Id, PermissionCodes.UsersDelete);

        Assert.Empty(item.InheritedFromRoles);
        Assert.False(item.DirectAssigned);
        Assert.False(item.Effective);
    }

    [Fact]
    public async Task The_effective_set_is_the_union_of_role_and_direct_grants()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "reader", Gate);
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        await GrantDirectAsync(scope, target, PermissionCodes.InventoryAnalysis);

        var response = await ReadAsync(scope, actor.Id, target.Id);
        var effective = response.Permissions.Where(p => p.Effective).Select(p => p.Code).ToArray();

        // Viewer'ın altı yetkisi + doğrudan verilen bir yetki.
        Assert.Equal(7, effective.Length);
        Assert.Contains(PermissionCodes.InventoryAnalysis, effective);
        Assert.Contains(PermissionCodes.MapView, effective);
    }

    [Fact]
    public async Task A_permission_from_both_sources_appears_once_and_shows_both()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "reader", Gate);
        var target = await CreateUserAsync(scope, "editor", GisRoles.GisEditor);

        // Tarihsel çakışma: rol de veriyor, kişiye özel satır da duruyor.
        await GrantDirectAsync(scope, target, PermissionCodes.DrawingsPointCreate);

        var response = await ReadAsync(scope, actor.Id, target.Id);
        var rows = response.Permissions.Where(p => p.Code == PermissionCodes.DrawingsPointCreate).ToArray();

        /* Katalog satırı TEKTİR: çift kaynak iki satır üretmez, tek satırda iki
           kaynak olarak görünür. Aksi hâlde 27'lik liste sessizce büyürdü. */
        Assert.Single(rows);
        Assert.Equal([GisRoles.GisEditor], rows[0].InheritedFromRoles);
        Assert.True(rows[0].DirectAssigned);
        Assert.True(rows[0].Effective);

        // Fazlalık doğrudan kayıt kaldırılabilir; rol kalıtımı zaten sürer.
        Assert.True(rows[0].CanRemoveDirect);
        Assert.False(rows[0].CanAssignDirect);
    }

    [Fact]
    public async Task Every_role_that_grants_a_permission_is_listed_as_a_source()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "reader", Gate);

        // Aynı yetkiyi veren ikinci bir rol; kullanıcı iki role birden üye.
        await CreateRoleAsync(scope, "Custom Survey Role", PermissionCodes.MapView, PermissionCodes.InventoryAnalysis);
        var target = await CreateUserAsync(scope, "multi", GisRoles.GisEditor);
        await AddToRoleAsync(scope, target, "Custom Survey Role");

        var item = await ItemAsync(scope, actor.Id, target.Id, PermissionCodes.MapView);

        /* Tek bir kaynağa indirgemek, yetkiyi kesmek isteyen yöneticiye eksik
           bilgi vermek olurdu: iki rolden biri kaldırılsa yetki hâlâ durur. */
        Assert.Equal(["Custom Survey Role", GisRoles.GisEditor], item.InheritedFromRoles);

        var single = await ItemAsync(scope, actor.Id, target.Id, PermissionCodes.InventoryAnalysis);
        Assert.Equal(["Custom Survey Role"], single.InheritedFromRoles);
    }

    /* --- Okuma modeli: etki kaynaktan AYRIDIR ------------------------------------------ */

    [Fact]
    public async Task An_assignment_to_a_deactivated_permission_is_not_effective()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "reader", Gate);
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        await GrantDirectAsync(scope, target, PermissionCodes.InventoryAnalysis);
        await DeactivateAsync(scope, PermissionCodes.InventoryAnalysis);

        var item = await ItemAsync(scope, actor.Id, target.Id, PermissionCodes.InventoryAnalysis);

        // Satır DURUYOR ama yetki işlemiyor; ikisi ayrı sorulardır.
        Assert.True(item.DirectAssigned);
        Assert.False(item.IsActive);
        Assert.False(item.Effective);

        // Pasif yetki ne yeni atanabilir ne de aktif küme sözleşmesinden silinebilir.
        Assert.False(item.CanAssignDirect);
        Assert.False(item.CanRemoveDirect);
    }

    [Theory]
    [InlineData(AccountStatus.Suspended)]
    [InlineData(AccountStatus.PendingApproval)]
    [InlineData(AccountStatus.Rejected)]
    public async Task An_ineligible_target_has_assignments_but_no_effective_permissions(AccountStatus status)
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "reader", Gate);
        var target = await CreateUserAsync(scope, "frozen", GisRoles.GisEditor);

        await GrantDirectAsync(scope, target, PermissionCodes.InventoryAnalysis);
        await SetStatusAsync(scope, target, status);

        var response = await ReadAsync(scope, actor.Id, target.Id);

        Assert.False(response.TargetAccountEligible);

        /* Atamalar duruyor — hesap yeniden açılırsa geri gelmeliler — ama
           hiçbiri etkin değil. Uygunluk kapısı motorun içindedir; burada ikinci
           bir uygunluk modeli kurulmaz. */
        Assert.True(response.Permissions.Single(p => p.Code == PermissionCodes.InventoryAnalysis).DirectAssigned);
        Assert.Contains(response.Permissions, p => p.InheritedFromRoles.Count > 0);
        Assert.DoesNotContain(response.Permissions, p => p.Effective);
    }

    /* --- Okuma modeli: mutasyon kabiliyeti -------------------------------------------- */

    [Fact]
    public async Task A_view_only_actor_is_told_it_cannot_manage_anything()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "watcher", [PermissionCodes.UsersView, PermissionCodes.PermissionsView]);
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        var response = await ReadAsync(scope, actor.Id, target.Id);

        Assert.False(response.CanManageDirectPermissions);
        Assert.DoesNotContain(response.Permissions, p => p.CanAssignDirect);
        Assert.DoesNotContain(response.Permissions, p => p.CanRemoveDirect);
    }

    [Fact]
    public async Task Grant_capability_follows_permission_data_not_the_actors_role_name()
    {
        await using var scope = await CreateScopeAsync();

        // Rol adı sıradan; yetkilerin tamamı veriyle verilmiş.
        var actor = await CreateActorAsync(scope, "nobody-special", [.. PermissionCatalog.AllCodes]);
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        var response = await ReadAsync(scope, actor.Id, target.Id);

        Assert.True(response.CanManageDirectPermissions);
        Assert.True(response.Permissions.Single(p => p.Code == PermissionCodes.UsersDelete).CanAssignDirect);
    }

    [Fact]
    public async Task An_actor_is_not_offered_a_permission_it_does_not_hold_itself()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "weak", [.. Gate, PermissionCodes.LayersManage]);
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        var response = await ReadAsync(scope, actor.Id, target.Id);

        Assert.True(response.Permissions.Single(p => p.Code == PermissionCodes.LayersManage).CanAssignDirect);
        Assert.False(response.Permissions.Single(p => p.Code == PermissionCodes.UsersDelete).CanAssignDirect);
    }

    [Fact]
    public async Task The_response_reports_all_identity_roles_of_the_target()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "reader", Gate);

        await CreateRoleAsync(scope, "Custom Survey Role", PermissionCodes.MapView);
        var target = await CreateUserAsync(scope, "multi", GisRoles.GisEditor);
        await AddToRoleAsync(scope, target, "Custom Survey Role");

        var response = await ReadAsync(scope, actor.Id, target.Id);

        Assert.Equal(["Custom Survey Role", GisRoles.GisEditor], response.Roles);
    }

    /* --- Hedef kullanıcı --------------------------------------------------------------- */

    [Fact]
    public async Task A_missing_target_is_a_404()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "reader", Gate);

        var result = await Service(scope).GetUserPermissionsAsync(actor.Id, 987654);

        Assert.Equal(ServiceErrorKind.NotFound, result.ErrorKind);
    }

    [Fact]
    public async Task A_soft_deleted_target_is_a_404()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "reader", Gate);
        var target = await CreateUserAsync(scope, "gone", GisRoles.Viewer);

        await SoftDeleteAsync(scope, target);

        // Silinmiş hesap hiçbir yönetim ekranında sıradan bir hesap gibi görünmez.
        Assert.Equal(ServiceErrorKind.NotFound, (await Service(scope).GetUserPermissionsAsync(actor.Id, target.Id)).ErrorKind);
        Assert.Equal(
            ServiceErrorKind.NotFound,
            (await SaveAsync(scope, actor.Id, target.Id, PermissionCodes.InventoryAnalysis)).ErrorKind);
    }

    /* --- Kalıtım çakışması: rolden gelen yetki doğrudan atanamaz ----------------------- */

    [Theory]
    [InlineData(GisRoles.GisEditor)]
    [InlineData("Custom Survey Role")]
    public async Task A_permission_already_inherited_cannot_be_newly_assigned_directly(string roleName)
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "granter", [.. PermissionCatalog.AllCodes]);

        if (roleName == "Custom Survey Role")
        {
            await CreateRoleAsync(scope, roleName, PermissionCodes.DrawingsPointCreate);
        }

        var target = await CreateUserAsync(scope, "target", roleName);

        var result = await SaveAsync(scope, actor.Id, target.Id, PermissionCodes.DrawingsPointCreate);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
        Assert.Contains("rol üzerinden zaten veriliyor", result.Error);

        // Sessizce yok sayılmaz VE satır yazılmaz.
        Assert.False(await HasDirectAsync(scope, target, PermissionCodes.DrawingsPointCreate));
    }

    [Fact]
    public async Task Inheritance_from_any_of_several_roles_blocks_a_direct_grant()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "granter", [.. PermissionCatalog.AllCodes]);

        await CreateRoleAsync(scope, "Custom Survey Role", PermissionCodes.InventoryAnalysis);
        var target = await CreateUserAsync(scope, "multi", GisRoles.Viewer);
        await AddToRoleAsync(scope, target, "Custom Survey Role");

        // Yetki Viewer'dan değil, İKİNCİ rolden geliyor — kural yine de işler.
        var result = await SaveAsync(scope, actor.Id, target.Id, PermissionCodes.InventoryAnalysis);

        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
        Assert.False(await HasDirectAsync(scope, target, PermissionCodes.InventoryAnalysis));
    }

    /* --- Tarihsel çakışma -------------------------------------------------------------- */

    [Fact]
    public async Task An_existing_direct_grant_that_became_inherited_may_be_kept_or_removed()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "granter", [.. PermissionCatalog.AllCodes]);
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        // Önce doğrudan verilir…
        await GrantDirectAsync(scope, target, PermissionCodes.DrawingsPointCreate);
        // …sonra rol de vermeye başlar.
        await AddToRoleAsync(scope, target, GisRoles.GisEditor);

        // Olduğu gibi yeniden kaydetmek serbesttir: bu YENİ bir atama değildir.
        Assert.True((await SaveAsync(scope, actor.Id, target.Id, PermissionCodes.DrawingsPointCreate)).IsSuccess);
        Assert.True(await HasDirectAsync(scope, target, PermissionCodes.DrawingsPointCreate));

        // Kümeden çıkarmak fazlalık satırı temizler…
        Assert.True((await SaveAsync(scope, actor.Id, target.Id)).IsSuccess);
        Assert.False(await HasDirectAsync(scope, target, PermissionCodes.DrawingsPointCreate));

        // …ama yetki rolden gelmeye devam eder.
        var item = await ItemAsync(scope, actor.Id, target.Id, PermissionCodes.DrawingsPointCreate);
        Assert.True(item.Effective);
        Assert.Equal([GisRoles.GisEditor], item.InheritedFromRoles);
    }

    [Fact]
    public async Task A_removed_redundant_direct_grant_cannot_be_added_back_while_inherited()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "granter", [.. PermissionCatalog.AllCodes]);
        var target = await CreateUserAsync(scope, "editor", GisRoles.GisEditor);

        var result = await SaveAsync(scope, actor.Id, target.Id, PermissionCodes.DrawingsPointCreate);

        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
    }

    /* --- Yetki yükseltme bariyeri ------------------------------------------------------ */

    [Fact]
    public async Task An_actor_cannot_grant_a_permission_it_does_not_hold()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "weak-granter", Gate);
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        var result = await SaveAsync(scope, actor.Id, target.Id, PermissionCodes.InventoryAnalysis);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
        Assert.False(await HasDirectAsync(scope, target, PermissionCodes.InventoryAnalysis));

        // Hedefin etkin yetkileri hiç değişmedi.
        Assert.Equal(6, (await EffectiveAsync(scope, target.Id)).Length);
    }

    [Fact]
    public async Task The_rejection_does_not_disclose_which_permissions_are_missing()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "prober", Gate);
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        var result = await SaveAsync(scope, actor.Id, target.Id, PermissionCodes.UsersDelete);

        /* Mesaj, çağıranın kendi yetki kümesini uç üzerinden haritalamasına
           yarayan bir kâşif aracına dönüşmemelidir. */
        Assert.DoesNotContain(PermissionCodes.UsersDelete, result.Error);
        Assert.Contains("gerekli yetkiye sahip değilsiniz", result.Error);
    }

    [Fact]
    public async Task Authority_may_come_from_the_actors_own_direct_permission()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "direct-holder", Gate);
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        // Çağıranın ROLÜ bu yetkiyi vermiyor; yetki doğrudan kendisine bağlı.
        await GrantDirectAsync(scope, actor, PermissionCodes.InventoryAnalysis);

        var result = await SaveAsync(scope, actor.Id, target.Id, PermissionCodes.InventoryAnalysis);

        /* Otorite etkin yetkilerden okunur. Yalnızca role_permissions okunsaydı
           bu istek haksız yere reddedilirdi. */
        Assert.True(result.IsSuccess);
        Assert.True(await HasDirectAsync(scope, target, PermissionCodes.InventoryAnalysis));
    }

    [Fact]
    public async Task Authority_gained_after_a_refusal_applies_without_a_new_login()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "late-authority", Gate);
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        Assert.Equal(
            ServiceErrorKind.Forbidden,
            (await SaveAsync(scope, actor.Id, target.Id, PermissionCodes.InventoryAnalysis)).ErrorKind);

        // Yetki VERİ üzerinden veriliyor; yeni token/oturum YOK.
        await GrantDirectAsync(scope, actor, PermissionCodes.InventoryAnalysis);

        Assert.True((await SaveAsync(scope, actor.Id, target.Id, PermissionCodes.InventoryAnalysis)).IsSuccess);
    }

    [Fact]
    public async Task Authority_lost_after_a_grant_applies_without_a_new_login()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "revoked", [.. Gate, PermissionCodes.InventoryAnalysis]);
        var first = await CreateUserAsync(scope, "first", GisRoles.Viewer);

        Assert.True((await SaveAsync(scope, actor.Id, first.Id, PermissionCodes.InventoryAnalysis)).IsSuccess);

        // Çağıranın yetki KAYNAĞI siliniyor; token'a dokunulmuyor.
        await RevokeRoleGrantAsync(scope, ActorRoleName("revoked"), PermissionCodes.InventoryAnalysis);

        var second = await CreateUserAsync(scope, "second", GisRoles.Viewer);
        var result = await SaveAsync(scope, actor.Id, second.Id, PermissionCodes.InventoryAnalysis);

        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
    }

    [Fact]
    public async Task The_legacy_admin_role_name_is_not_a_bypass()
    {
        await using var scope = await CreateScopeAsync();

        /* Legacy Admin 27 yetkiyle gelir ve bu yüzden her şeyi dağıtabilir. Tek
           satır silindiğinde otoritesi GERÇEKTEN kaybolmalıdır; kaybolmuyorsa
           bir yerde ada bakan bir kestirme var demektir. Admin rolünün yetkileri
           uçtan düzenlenemediği için satır doğrudan veritabanından kaldırılır. */
        var actor = await CreateUserAsync(scope, "legacy-admin", ApplicationRoles.Admin);
        await RevokeRoleGrantAsync(scope, ApplicationRoles.Admin, PermissionCodes.InventoryAnalysis);

        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);
        var result = await SaveAsync(scope, actor.Id, target.Id, PermissionCodes.InventoryAnalysis);

        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);

        // Kapı yetkileri hâlâ duruyor: reddin sebebi ulaşamamak değil, otorite.
        var effective = await EffectiveAsync(scope, actor.Id);
        Assert.Contains(PermissionCodes.PermissionsAssign, effective);
        Assert.Contains(PermissionCodes.UsersUpdate, effective);
    }

    /* --- Kural yalnızca EKLEMELERE uygulanır ------------------------------------------- */

    [Fact]
    public async Task An_actor_may_remove_a_direct_grant_it_does_not_itself_hold()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "weak-remover", Gate);
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        await GrantDirectAsync(scope, target, PermissionCodes.InventoryAnalysis);
        Assert.DoesNotContain(PermissionCodes.InventoryAnalysis, await EffectiveAsync(scope, actor.Id));

        var result = await SaveAsync(scope, actor.Id, target.Id);

        // Kaldırma ayrıcalığı AZALTIR; yeni bir yetki doğmaz.
        Assert.True(result.IsSuccess);
        Assert.False(await HasDirectAsync(scope, target, PermissionCodes.InventoryAnalysis));
    }

    [Fact]
    public async Task An_actor_may_resave_a_stronger_direct_set_unchanged()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "weak-saver", Gate);
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        await GrantDirectAsync(scope, target, PermissionCodes.InventoryAnalysis);

        // Aynı küme yeniden gönderiliyor: toAdd boş.
        var result = await SaveAsync(scope, actor.Id, target.Id, PermissionCodes.InventoryAnalysis);

        /* Kural "istenen küme ⊆ çağıran" olsaydı burası 403 olurdu ve yönetici
           kendisinden güçlü bir kullanıcıda HİÇBİR değişiklik yapamazdı. */
        Assert.True(result.IsSuccess);
        Assert.True(await HasDirectAsync(scope, target, PermissionCodes.InventoryAnalysis));
    }

    [Fact]
    public async Task An_actor_may_remove_an_unheld_grant_while_adding_one_it_holds()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "swapper", [.. Gate, PermissionCodes.LayersManage]);
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        await GrantDirectAsync(scope, target, PermissionCodes.InventoryAnalysis);

        var result = await SaveAsync(scope, actor.Id, target.Id, PermissionCodes.LayersManage);

        Assert.True(result.IsSuccess);
        Assert.False(await HasDirectAsync(scope, target, PermissionCodes.InventoryAnalysis));
        Assert.True(await HasDirectAsync(scope, target, PermissionCodes.LayersManage));
    }

    [Fact]
    public async Task A_request_mixing_an_allowed_and_a_forbidden_addition_persists_neither()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "half-authorized", [.. Gate, PermissionCodes.LayersManage]);
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        var result = await SaveAsync(
            scope, actor.Id, target.Id,
            PermissionCodes.LayersManage,  // çağıranda VAR
            PermissionCodes.UsersDelete);  // çağıranda YOK

        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);

        /* "Yetkili olan kadarını yaz" YAPILMAZ: kısmi uygulama, yöneticinin
           ekranda gördüğü kümeyle veritabanını sessizce ayrıştırırdı. */
        Assert.False(await HasDirectAsync(scope, target, PermissionCodes.LayersManage));
        Assert.False(await HasDirectAsync(scope, target, PermissionCodes.UsersDelete));
    }

    /* --- Kimlik çözülemiyorsa fail-closed ---------------------------------------------- */

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task An_unresolvable_actor_identity_cannot_add(int actingUserId)
    {
        await using var scope = await CreateScopeAsync();
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        var result = await SaveAsync(scope, actingUserId, target.Id, PermissionCodes.InventoryAnalysis);

        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
        Assert.False(await HasDirectAsync(scope, target, PermissionCodes.InventoryAnalysis));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task An_unresolvable_actor_identity_cannot_remove_either(int actingUserId)
    {
        await using var scope = await CreateScopeAsync();
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        await GrantDirectAsync(scope, target, PermissionCodes.InventoryAnalysis);

        var result = await SaveAsync(scope, actingUserId, target.Id);

        /* Kaldırma yükseltme değildir, ama birinin yetkilerini boşaltmak yıkıcı
           bir işlemdir: "kim olduğunu bilmiyorum" bunun için yeterli bir yetki
           değildir. Rol yetkisi ucundaki fail-closed davranışın aynısı. */
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
        Assert.True(await HasDirectAsync(scope, target, PermissionCodes.InventoryAnalysis));
    }

    [Fact]
    public async Task An_unresolvable_actor_identity_may_still_save_an_unchanged_set()
    {
        await using var scope = await CreateScopeAsync();
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        var result = await SaveAsync(scope, 0, target.Id);

        // Hiçbir satır değişmiyorsa yazma da yoktur; reddedilecek bir şey kalmaz.
        Assert.True(result.IsSuccess);
        Assert.False(result.Value!.CanManageDirectPermissions);
    }

    /* --- Doğrulama --------------------------------------------------------------------- */

    [Fact]
    public async Task An_unknown_permission_code_is_rejected()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "granter", [.. PermissionCatalog.AllCodes]);
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        var result = await SaveAsync(scope, actor.Id, target.Id, "not.a.permission");

        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
        Assert.Contains("Tanınmayan", result.Error);
        Assert.Empty(await DirectCodesAsync(scope, target));
    }

    [Fact]
    public async Task A_deactivated_permission_cannot_be_newly_assigned()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "granter", [.. PermissionCatalog.AllCodes]);
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        await DeactivateAsync(scope, PermissionCodes.InventoryAnalysis);

        var result = await SaveAsync(scope, actor.Id, target.Id, PermissionCodes.InventoryAnalysis);

        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
        Assert.Contains("Kullanımdan kaldırılmış", result.Error);
        Assert.Empty(await DirectCodesAsync(scope, target));
    }

    [Fact]
    public async Task Duplicate_codes_in_the_request_produce_one_row()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "granter", [.. PermissionCatalog.AllCodes]);
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        var result = await SaveAsync(
            scope, actor.Id, target.Id,
            PermissionCodes.InventoryAnalysis, PermissionCodes.InventoryAnalysis, PermissionCodes.InventoryAnalysis);

        Assert.True(result.IsSuccess);
        Assert.Equal([PermissionCodes.InventoryAnalysis], await DirectCodesAsync(scope, target));
    }

    [Fact]
    public async Task An_inactive_historical_direct_grant_survives_a_replacement()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "granter", [.. PermissionCatalog.AllCodes]);
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        await GrantDirectAsync(scope, target, PermissionCodes.InventoryAnalysis);
        await DeactivateAsync(scope, PermissionCodes.InventoryAnalysis);

        // İstek yalnızca AKTİF doğrudan kümeyi tanımlar.
        Assert.True((await SaveAsync(scope, actor.Id, target.Id, PermissionCodes.LayersManage)).IsSuccess);

        /* Pasif yetkiye ait kişiye özel kayıt KORUNUR: aksi hâlde bir yetki
           pasifleştirildikten sonraki ilk kaydetmede kalıcı olarak silinir ve
           yetki yeniden açıldığında geri gelmezdi. */
        Assert.True(await HasDirectAsync(scope, target, PermissionCodes.InventoryAnalysis));
        Assert.True(await HasDirectAsync(scope, target, PermissionCodes.LayersManage));
    }

    /* --- Yanıt tazeliği ---------------------------------------------------------------- */

    [Fact]
    public async Task The_save_response_already_reflects_the_new_state()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "granter", [.. PermissionCatalog.AllCodes]);
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        var result = await SaveAsync(scope, actor.Id, target.Id, PermissionCodes.InventoryAnalysis);
        var item = result.Value!.Permissions.Single(p => p.Code == PermissionCodes.InventoryAnalysis);

        // İstemcinin ikinci bir istek atıp tahmin yürütmesi gerekmez.
        Assert.True(item.DirectAssigned);
        Assert.True(item.Effective);
        Assert.True(item.CanRemoveDirect);
        Assert.False(item.CanAssignDirect);
    }

    /* --- Sorgu maliyeti ---------------------------------------------------------------- */

    [Fact]
    public async Task Reading_resolves_the_actor_authority_exactly_once()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "counted", [.. PermissionCatalog.AllCodes]);
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        var counter = Counter(scope);
        counter.Reset();

        await ReadAsync(scope, actor.Id, target.Id);

        /* Yetki BAŞINA değil, istek başına bir çözümleme — katalog büyüdüğünde
           maliyet sabit kalmalıdır. */
        Assert.Equal(1, counter.CallsFor(actor.Id));
        Assert.Equal(1, counter.CallsFor(target.Id));
    }

    [Fact]
    public async Task Saving_resolves_the_actor_authority_exactly_once()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "counted", [.. PermissionCatalog.AllCodes]);
        var target = await CreateUserAsync(scope, "viewer", GisRoles.Viewer);

        var counter = Counter(scope);
        counter.Reset();

        await SaveAsync(scope, actor.Id, target.Id, PermissionCodes.InventoryAnalysis, PermissionCodes.LayersManage);

        // Doğrulama ve yanıt aynı çözümlemeyi paylaşır.
        Assert.Equal(1, counter.CallsFor(actor.Id));
    }

    [Fact]
    public async Task Editing_your_own_permissions_refreshes_your_authority_for_the_response()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "self-editor", [.. Gate, PermissionCodes.UsersView, PermissionCodes.PermissionsView]);

        await GrantDirectAsync(scope, actor, PermissionCodes.LayersManage);

        var counter = Counter(scope);
        counter.Reset();

        // Çağıran KENDİ doğrudan yetkisini kaldırıyor.
        var result = await SaveAsync(scope, actor.Id, actor.Id);

        Assert.True(result.IsSuccess);

        /* Otorite artık bayat olurdu: kendi yetkisini kaldıran çağıran için
           yanıt, mutasyondan SONRAKİ durumu anlatmak zorundadır. */
        Assert.False(result.Value!.Permissions.Single(p => p.Code == PermissionCodes.LayersManage).CanAssignDirect);

        /* Üç çözümleme: doğrulama otoritesi + mutasyon sonrası tazeleme +
           hedefin etkin yetkileri. Çağıran ile hedef aynı kişi olduğu için
           sonuncusu da aynı kimliğe düşer. Başkası düzenlendiğinde çağıran için
           yalnızca BİR çözümleme yapılır (bkz. Saving_resolves_...). */
        Assert.Equal(3, counter.CallsFor(actor.Id));
    }

    /* --- Yardımcılar ------------------------------------------------------------------- */

    private static string ActorRoleName(string userName) => $"Role-{userName}";

    private static AppDbContext Db(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<AppDbContext>();

    private static IUserPermissionManagementService Service(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<IUserPermissionManagementService>();

    private static EffectivePermissionCallCounter Counter(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<EffectivePermissionCallCounter>();

    private static async Task<UserPermissionsResponse> ReadAsync(AsyncServiceScope scope, int actorId, int targetId)
    {
        var result = await Service(scope).GetUserPermissionsAsync(actorId, targetId);
        Assert.True(result.IsSuccess);
        return result.Value!;
    }

    private static async Task<UserPermissionItem> ItemAsync(
        AsyncServiceScope scope, int actorId, int targetId, string code) =>
        (await ReadAsync(scope, actorId, targetId)).Permissions.Single(p => p.Code == code);

    private static Task<ServiceResult<UserPermissionsResponse>> SaveAsync(
        AsyncServiceScope scope, int actorId, int targetId, params string[] codes) =>
        Service(scope).ReplaceUserPermissionsAsync(
            actorId, targetId, new UpdateUserPermissionsRequest { PermissionCodes = [.. codes] });

    private static async Task<string[]> EffectiveAsync(AsyncServiceScope scope, int userId) =>
        [.. (await scope.ServiceProvider.GetRequiredService<IEffectivePermissionService>()
            .GetEffectivePermissionCodesAsync(userId)).OrderBy(c => c, StringComparer.Ordinal)];

    private static async Task<bool> HasDirectAsync(AsyncServiceScope scope, User user, string code)
    {
        var db = Db(scope);

        return await db.UserPermissions
            .AsNoTracking()
            .AnyAsync(up => up.UserId == user.Id && db.Permissions.Any(p => p.Id == up.PermissionId && p.Code == code));
    }

    private static async Task<string[]> DirectCodesAsync(AsyncServiceScope scope, User user)
    {
        var db = Db(scope);

        var codes = await db.UserPermissions
            .AsNoTracking()
            .Where(up => up.UserId == user.Id)
            .Join(db.Permissions, up => up.PermissionId, p => p.Id, (_, p) => p.Code)
            .ToListAsync();

        return [.. codes.OrderBy(c => c, StringComparer.Ordinal)];
    }

    /// <summary>Verilen yetkilere sahip özel bir rol ve o roldeki aktif kullanıcı.</summary>
    private static async Task<User> CreateActorAsync(AsyncServiceScope scope, string userName, string[] codes)
    {
        await CreateRoleAsync(scope, ActorRoleName(userName), codes);
        return await CreateUserAsync(scope, userName, ActorRoleName(userName));
    }

    private static async Task CreateRoleAsync(AsyncServiceScope scope, string roleName, params string[] codes)
    {
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();
        Assert.True((await roles.CreateAsync(new IdentityRole<int>(roleName))).Succeeded);

        var role = (await roles.FindByNameAsync(roleName))!;
        var db = Db(scope);

        var ids = await db.Permissions.Where(p => codes.Contains(p.Code)).Select(p => p.Id).ToListAsync();
        Assert.Equal(codes.Distinct().Count(), ids.Count);

        db.RolePermissions.AddRange(ids.Select(id => new RolePermission { RoleId = role.Id, PermissionId = id }));
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

    private static async Task AddToRoleAsync(AsyncServiceScope scope, User user, string role)
    {
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        Assert.True((await users.AddToRoleAsync((await users.FindByIdAsync(user.Id.ToString()))!, role)).Succeeded);
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

    private static async Task RevokeRoleGrantAsync(AsyncServiceScope scope, string roleName, string code)
    {
        var db = Db(scope);
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

        var role = (await roles.FindByNameAsync(roleName))!;
        var permission = await db.Permissions.SingleAsync(p => p.Code == code);

        db.RolePermissions.RemoveRange(
            await db.RolePermissions.Where(rp => rp.RoleId == role.Id && rp.PermissionId == permission.Id).ToListAsync());

        await db.SaveChangesAsync();
    }

    private static async Task SetStatusAsync(AsyncServiceScope scope, User user, AccountStatus status)
    {
        var db = Db(scope);
        var tracked = await db.Users.SingleAsync(u => u.Id == user.Id);
        tracked.AccountStatus = status;
        tracked.IsActive = status == AccountStatus.Active;
        await db.SaveChangesAsync();
    }

    private static async Task SoftDeleteAsync(AsyncServiceScope scope, User user)
    {
        var db = Db(scope);
        var tracked = await db.Users.SingleAsync(u => u.Id == user.Id);
        tracked.IsDeleted = true;
        await db.SaveChangesAsync();
    }

    private static async Task<AsyncServiceScope> CreateScopeAsync()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
        services.AddDbContext<AppDbContext>(o => o
            .UseInMemoryDatabase($"user-permissions-{Guid.NewGuid():N}")
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)));

        services.AddIdentityCore<User>(o => o.Password.RequiredLength = 8)
            .AddRoles<IdentityRole<int>>()
            .AddEntityFrameworkStores<AppDbContext>()
            .AddDefaultTokenProviders();

        /* Etkin yetki servisi sayaçla sarılır: "otorite işlem başına bir kez
           çözülür" iddiası ölçülmeden güvenilebilecek bir şey değildir. */
        services.AddSingleton<EffectivePermissionCallCounter>();
        services.AddScoped<EffectivePermissionService>();
        services.AddScoped<IEffectivePermissionService>(sp => new CountingEffectivePermissionService(
            sp.GetRequiredService<EffectivePermissionService>(),
            sp.GetRequiredService<EffectivePermissionCallCounter>()));

        services.AddScoped<IUserPermissionManagementService, UserPermissionManagementService>();
        services.AddSingleton(Substitute.For<ILogger<UserPermissionManagementService>>());

        var scope = services.BuildServiceProvider().CreateAsyncScope();
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

        foreach (var role in ApplicationRoles.All)
        {
            await roles.CreateAsync(new IdentityRole<int>(role));
        }

        await AuthorizationDataSeeder.SeedAsync(
            Db(scope),
            roles,
            scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("seed"));

        return scope;
    }

    internal sealed class EffectivePermissionCallCounter
    {
        private readonly Dictionary<int, int> _calls = [];

        public void Increment(int userId) => _calls[userId] = CallsFor(userId) + 1;

        public int CallsFor(int userId) => _calls.TryGetValue(userId, out var count) ? count : 0;

        public void Reset() => _calls.Clear();
    }

    private sealed class CountingEffectivePermissionService : IEffectivePermissionService
    {
        private readonly IEffectivePermissionService _inner;
        private readonly EffectivePermissionCallCounter _counter;

        public CountingEffectivePermissionService(
            IEffectivePermissionService inner,
            EffectivePermissionCallCounter counter)
        {
            _inner = inner;
            _counter = counter;
        }

        public Task<IReadOnlyCollection<string>> GetEffectivePermissionCodesAsync(
            int userId,
            CancellationToken cancellationToken = default)
        {
            _counter.Increment(userId);
            return _inner.GetEffectivePermissionCodesAsync(userId, cancellationToken);
        }

        public Task<bool> HasPermissionAsync(
            int userId,
            string? permissionCode,
            CancellationToken cancellationToken = default) =>
            _inner.HasPermissionAsync(userId, permissionCode, cancellationToken);
    }
}
