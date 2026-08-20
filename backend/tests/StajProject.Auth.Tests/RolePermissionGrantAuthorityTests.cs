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
/// Rol yetkisi düzenlemenin yetki yükseltmeye kapalı olduğunun kanıtı.
/// </summary>
/// <remarks>
/// <para>
/// <b>Kapatılan açık.</b> Uçtaki <c>roles.update</c> + <c>permissions.assign</c>
/// yalnızca "rol yetkisi düzenleyebilirsin" der. Servis çağıranın kimliğini
/// bilmediği sürece bu iki yetkiye sahip biri KENDİ rolüne <c>users.delete</c>
/// ekleyip aynı oturumda tüm sisteme erişebiliyordu — yetkilendirme canlı
/// okunduğu için yeniden girişe bile gerek yoktu.
/// </para>
/// <para>
/// <b>Kural.</b> <c>yeni eklenenler ⊆ çağıranın etkin yetkileri</c>. Kural
/// yalnızca EKLEMELERE uygulanır; aksi hâlde (<c>istenen küme ⊆ çağıran</c>)
/// bir yönetici kendisinden güçlü bir rolü olduğu gibi kaydedemez, hatta o
/// rolden yetki ÇIKARAMAZ hâle gelirdi — ayrıcalık azaltan bir işlem ayrıcalık
/// gerektirirdi.
/// </para>
/// <para>
/// <b>Rol adına göre kestirme yoktur.</b> Testler otoritenin yalnızca yetki
/// VERİSİNDEN geldiğini gösterir: legacy <c>Admin</c> bile satırı silinince
/// yetkisini kaybeder.
/// </para>
/// </remarks>
public class RolePermissionGrantAuthorityTests
{
    /* Aktörü uca taşıyan yetkiler. Bunlar "düzenleme kapısı"dır; hangi yetkinin
       DAĞITILABİLECEĞİ ayrı bir sorudur ve testlerin konusu odur. */
    private static readonly string[] Gate = [PermissionCodes.RolesUpdate, PermissionCodes.PermissionsAssign];

    /* --- Asıl açık: kendi rolünü genişletme ------------------------------------------ */

    [Fact]
    public async Task An_actor_cannot_add_a_permission_it_lacks_to_its_own_role()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "self-escalator", Gate);
        var ownRoleId = await RoleIdAsync(scope, ActorRoleName("self-escalator"));

        var before = await EffectiveAsync(scope, actor.Id);

        // Mevcut yetkiler korunuyor, üzerine iki yeni yetki ekleniyor.
        var result = await ReplaceAsync(
            scope, actor.Id, ownRoleId,
            [.. Gate, PermissionCodes.InventoryAnalysis, PermissionCodes.UsersDelete]);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);

        // Rol hiç değişmedi ve aktör hiçbir şey kazanmadı.
        Assert.Equal(Gate.OrderBy(c => c, StringComparer.Ordinal), await CodesOfAsync(scope, ownRoleId));
        Assert.Equal(before, await EffectiveAsync(scope, actor.Id));
    }

    /* --- Başkasının rolünü genişletme ------------------------------------------------ */

    [Fact]
    public async Task An_actor_cannot_add_a_permission_it_lacks_to_a_role_it_does_not_hold()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "outsider", Gate);
        var targetId = await RoleIdAsync(scope, GisRoles.Viewer);

        var before = await CodesOfAsync(scope, targetId);

        var result = await ReplaceAsync(
            scope, actor.Id, targetId,
            [.. RolePermissionDefaults.For(GisRoles.Viewer), PermissionCodes.InventoryAnalysis]);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);

        /* Koruma yalnızca "kendi rolü" için özel-durum DEĞİLDİR: aktör bir
           başkasını güçlendirip o hesap üzerinden erişemez. */
        Assert.Equal(before, await CodesOfAsync(scope, targetId));
        Assert.False(await HasGrantAsync(scope, targetId, PermissionCodes.InventoryAnalysis));
    }

    [Fact]
    public async Task An_actor_cannot_widen_the_canonical_administrator_role()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "admin-widener", Gate);

        // Administrator'dan bir yetki çıkarılır ki aktör onu geri EKLEMEYİ denesin.
        var administratorId = await RoleIdAsync(scope, GisRoles.Administrator);
        await RevokeGrantAsync(scope, administratorId, PermissionCodes.InventoryAnalysis);

        var result = await ReplaceAsync(
            scope, actor.Id, administratorId,
            [.. RolePermissionDefaults.For(GisRoles.Administrator)]);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
        Assert.False(await HasGrantAsync(scope, administratorId, PermissionCodes.InventoryAnalysis));
    }

    /* --- Kapsam: kural yalnızca EKLEMELERE uygulanır --------------------------------- */

    [Fact]
    public async Task An_actor_may_resave_a_role_that_is_stronger_than_itself()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "weak-saver", Gate);
        var targetId = await RoleIdAsync(scope, GisRoles.GisAnalyst);

        var existing = await CodesOfAsync(scope, targetId);
        Assert.Contains(PermissionCodes.InventoryAnalysis, existing);

        // Aynı küme yeniden gönderiliyor: toAdd boş.
        var result = await ReplaceAsync(scope, actor.Id, targetId, [.. existing]);

        /* Kural "istenen küme ⊆ aktör" olsaydı burası 403 olurdu ve yönetici
           kendisinden güçlü bir rolde HİÇBİR değişiklik yapamazdı. */
        Assert.True(result.IsSuccess);
        Assert.Equal(existing, await CodesOfAsync(scope, targetId));
    }

    [Fact]
    public async Task An_actor_may_remove_a_permission_it_does_not_itself_hold()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "weak-remover", Gate);
        var targetId = await RoleIdAsync(scope, GisRoles.GisAnalyst);

        Assert.DoesNotContain(PermissionCodes.InventoryAnalysis, await EffectiveAsync(scope, actor.Id));

        var desired = RolePermissionDefaults.For(GisRoles.GisAnalyst)
            .Where(c => c != PermissionCodes.InventoryAnalysis)
            .ToArray();

        var result = await ReplaceAsync(scope, actor.Id, targetId, desired);

        // Kaldırma ayrıcalığı AZALTIR; yeni bir yetki doğmaz.
        Assert.True(result.IsSuccess);
        Assert.False(await HasGrantAsync(scope, targetId, PermissionCodes.InventoryAnalysis));
    }

    [Fact]
    public async Task An_actor_may_remove_an_unheld_permission_while_adding_one_it_holds()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "swapper", [.. Gate, PermissionCodes.LayersManage]);
        var targetId = await RoleIdAsync(scope, GisRoles.GisAnalyst);

        var desired = RolePermissionDefaults.For(GisRoles.GisAnalyst)
            .Where(c => c != PermissionCodes.InventoryAnalysis)
            .Append(PermissionCodes.LayersManage)
            .ToArray();

        var result = await ReplaceAsync(scope, actor.Id, targetId, desired);

        Assert.True(result.IsSuccess);
        Assert.False(await HasGrantAsync(scope, targetId, PermissionCodes.InventoryAnalysis));
        Assert.True(await HasGrantAsync(scope, targetId, PermissionCodes.LayersManage));
    }

    /* --- Atomiklik ------------------------------------------------------------------- */

    [Fact]
    public async Task A_request_mixing_an_allowed_and_a_forbidden_addition_persists_neither()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "half-authorized", [.. Gate, PermissionCodes.LayersManage]);
        var targetId = await RoleIdAsync(scope, GisRoles.Viewer);

        var before = await CodesOfAsync(scope, targetId);

        var result = await ReplaceAsync(
            scope, actor.Id, targetId,
            [
                .. RolePermissionDefaults.For(GisRoles.Viewer),
                PermissionCodes.LayersManage,   // aktörde VAR
                PermissionCodes.UsersDelete     // aktörde YOK
            ]);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);

        /* "Yetkili olan kadarını yaz" YAPILMAZ: kısmi uygulama, yöneticinin
           ekranda gördüğü kümeyle veritabanını sessizce ayrıştırırdı. */
        Assert.Equal(before, await CodesOfAsync(scope, targetId));
        Assert.False(await HasGrantAsync(scope, targetId, PermissionCodes.LayersManage));
    }

    /* --- Otoritenin kaynağı: etkin yetkiler (rol ∪ doğrudan) ------------------------- */

    [Fact]
    public async Task Authority_may_come_from_a_direct_user_permission()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "direct-holder", Gate);

        // Aktörün ROLÜ inventory.analysis vermiyor; yetki doğrudan kullanıcıya bağlı.
        await GrantDirectAsync(scope, actor, PermissionCodes.InventoryAnalysis);

        var targetId = await RoleIdAsync(scope, GisRoles.Viewer);

        var result = await ReplaceAsync(
            scope, actor.Id, targetId,
            [.. RolePermissionDefaults.For(GisRoles.Viewer), PermissionCodes.InventoryAnalysis]);

        /* Otorite IEffectivePermissionService'ten okunur; yalnızca
           role_permissions okunsaydı bu istek haksız yere reddedilirdi. */
        Assert.True(result.IsSuccess);
        Assert.True(await HasGrantAsync(scope, targetId, PermissionCodes.InventoryAnalysis));
    }

    /* --- Canlılık: token anlık görüntüsü yok ----------------------------------------- */

    [Fact]
    public async Task Authority_gained_after_the_first_refusal_applies_without_a_new_login()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "late-authority", Gate);
        var targetId = await RoleIdAsync(scope, GisRoles.Viewer);

        string[] desired = [.. RolePermissionDefaults.For(GisRoles.Viewer), PermissionCodes.InventoryAnalysis];

        Assert.Equal(ServiceErrorKind.Forbidden, (await ReplaceAsync(scope, actor.Id, targetId, desired)).ErrorKind);

        // Aktöre yetki VERİ üzerinden veriliyor; yeni token/oturum YOK.
        await GrantDirectAsync(scope, actor, PermissionCodes.InventoryAnalysis);

        Assert.True((await ReplaceAsync(scope, actor.Id, targetId, desired)).IsSuccess);
    }

    [Fact]
    public async Task Authority_lost_after_a_successful_grant_applies_without_a_new_login()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "revoked-authority", [.. Gate, PermissionCodes.InventoryAnalysis]);
        var actorRoleId = await RoleIdAsync(scope, ActorRoleName("revoked-authority"));

        var viewerId = await RoleIdAsync(scope, GisRoles.Viewer);
        Assert.True((await ReplaceAsync(
            scope, actor.Id, viewerId,
            [.. RolePermissionDefaults.For(GisRoles.Viewer), PermissionCodes.InventoryAnalysis])).IsSuccess);

        // Aktörün yetki KAYNAĞI siliniyor; token'a dokunulmuyor.
        await RevokeGrantAsync(scope, actorRoleId, PermissionCodes.InventoryAnalysis);

        var analystId = await RoleIdAsync(scope, GisRoles.GisEditor);
        var result = await ReplaceAsync(
            scope, actor.Id, analystId,
            [.. RolePermissionDefaults.For(GisRoles.GisEditor), PermissionCodes.InventoryAnalysis]);

        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
    }

    /* --- Rol adı bir kestirme değildir ------------------------------------------------ */

    [Fact]
    public async Task The_retired_Admin_role_name_has_no_grant_authority()
    {
        await using var scope = await CreateScopeAsync();

        var actor = await CreateUserAsync(scope, "legacy-admin", ApplicationRoles.Admin);
        Assert.Empty(await EffectiveAsync(scope, actor.Id));

        var targetId = await RoleIdAsync(scope, GisRoles.Viewer);

        var result = await ReplaceAsync(
            scope, actor.Id, targetId,
            [.. RolePermissionDefaults.For(GisRoles.Viewer), PermissionCodes.InventoryAnalysis]);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);

    }

    [Fact]
    public async Task A_fully_privileged_actor_succeeds_because_of_data_not_its_role_name()
    {
        await using var scope = await CreateScopeAsync();

        // Rol adı "Admin" değil; yetkilerin tamamı veriyle verilmiş özel bir rol.
        var actor = await CreateActorAsync(scope, "nobody-special", [.. PermissionCatalog.AllCodes]);
        var targetId = await RoleIdAsync(scope, GisRoles.Viewer);

        var result = await ReplaceAsync(
            scope, actor.Id, targetId,
            [.. RolePermissionDefaults.For(GisRoles.Viewer), PermissionCodes.UsersDelete]);

        Assert.True(result.IsSuccess);
        Assert.True(await HasGrantAsync(scope, targetId, PermissionCodes.UsersDelete));
    }

    /* --- Kimlik çözülemiyorsa fail-closed -------------------------------------------- */

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(int.MinValue)]
    public async Task An_unresolvable_actor_identity_cannot_add_anything(int actingUserId)
    {
        await using var scope = await CreateScopeAsync();
        var targetId = await RoleIdAsync(scope, GisRoles.Viewer);
        var before = await CodesOfAsync(scope, targetId);

        var result = await ReplaceAsync(
            scope, actingUserId, targetId,
            [.. RolePermissionDefaults.For(GisRoles.Viewer), PermissionCodes.LayersManage]);

        /* Controller'ın `?? 0` düşüşü ayrıcalık DEĞİL, yokluk anlamına gelir.
           Yetkilendirme sorusunun belirsizlikteki güvenli cevabı "hayır"dır. */
        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
        Assert.Equal(before, await CodesOfAsync(scope, targetId));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task An_unresolvable_actor_identity_cannot_remove_anything_either(int actingUserId)
    {
        await using var scope = await CreateScopeAsync();
        var targetId = await RoleIdAsync(scope, GisRoles.GisAnalyst);
        var before = await CodesOfAsync(scope, targetId);

        var result = await ReplaceAsync(scope, actingUserId, targetId, [PermissionCodes.MapView]);

        /* Kaldırma ayrıcalık yükseltmez, ama bir rolü boşaltmak yıkıcı bir
           işlemdir: "kim olduğunu bilmiyorum" bunun için yeterli bir yetki
           değildir. Kimliği bilinen zayıf bir aktör aynı işlemi yapabilir
           (bkz. An_actor_may_remove_a_permission_it_does_not_itself_hold). */
        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
        Assert.Equal(before, await CodesOfAsync(scope, targetId));
    }

    [Fact]
    public async Task An_unresolvable_actor_identity_may_still_save_an_unchanged_set()
    {
        await using var scope = await CreateScopeAsync();
        var targetId = await RoleIdAsync(scope, GisRoles.Viewer);
        var before = await CodesOfAsync(scope, targetId);

        var result = await ReplaceAsync(scope, 0, targetId, before);

        /* Hiçbir satır değişmiyorsa yazma da yoktur; reddetmek için bir sebep
           kalmaz. Kural mutasyonu korur, okuma-benzeri bir no-op'u değil. */
        Assert.True(result.IsSuccess);
        Assert.Equal(before, await CodesOfAsync(scope, targetId));
    }

    [Fact]
    public async Task A_suspended_actor_has_no_grant_authority()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "suspended-actor", [.. PermissionCatalog.AllCodes]);

        await SuspendAsync(scope, actor);

        var targetId = await RoleIdAsync(scope, GisRoles.Viewer);

        var result = await ReplaceAsync(
            scope, actor.Id, targetId,
            [.. RolePermissionDefaults.For(GisRoles.Viewer), PermissionCodes.UsersDelete]);

        /* Hesap uygunluğu için ikinci bir model kurulmaz: uygunluk zaten
           IEffectivePermissionService sorgusunun içindedir. */
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
    }

    /* --- Sızıntı yok ------------------------------------------------------------------ */

    [Fact]
    public async Task The_rejection_does_not_disclose_which_permissions_are_missing()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "prober", Gate);
        var targetId = await RoleIdAsync(scope, GisRoles.Viewer);

        var result = await ReplaceAsync(
            scope, actor.Id, targetId,
            [.. RolePermissionDefaults.For(GisRoles.Viewer), PermissionCodes.UsersDelete]);

        /* Mesaj, aktörün kendi yetki kümesini uç üzerinden haritalamasına
           yarayacak bir kâşif aracına dönüşmemelidir. */
        Assert.DoesNotContain(PermissionCodes.UsersDelete, result.Error);
        Assert.Contains("yeterli yetkiye sahip değilsiniz", result.Error);
    }

    /* --- Mevcut doğrulama sırası korunur --------------------------------------------- */

    [Fact]
    public async Task An_unknown_code_is_still_a_400_even_for_a_weak_actor()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "typo-actor", Gate);
        var targetId = await RoleIdAsync(scope, GisRoles.Viewer);

        var result = await ReplaceAsync(scope, actor.Id, targetId, [.. Gate, "not.a.permission"]);

        // Biçim hatası, otorite sorusundan ÖNCE gelir: 400, 403 değil.
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
    }

    [Fact]
    public async Task A_legacy_role_is_still_a_conflict_even_for_a_fully_privileged_actor()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "legacy-editor", [.. PermissionCatalog.AllCodes]);
        var legacyId = await RoleIdAsync(scope, ApplicationRoles.Admin);

        var result = await ReplaceAsync(scope, actor.Id, legacyId, [PermissionCodes.MapView]);

        // Legacy dondurulmuşluğu otoriteden bağımsız bir kuraldır ve önce gelir.
        Assert.Equal(ServiceErrorKind.Conflict, result.ErrorKind);
    }

    [Fact]
    public async Task An_inactive_historical_grant_still_survives_a_replacement()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "deactivator", [.. PermissionCatalog.AllCodes]);
        var targetId = await RoleIdAsync(scope, GisRoles.GisEditor);

        await DeactivateAsync(scope, PermissionCodes.DrawingsDelete);

        Assert.True((await ReplaceAsync(scope, actor.Id, targetId, [PermissionCodes.MapView])).IsSuccess);

        /* Otorite kontrolü fark hesabının üzerine eklendi; pasif satırların
           korunması bundan ETKİLENMEMELİDİR. Pasif satır ne "istenen ekleme"
           gibi görünmeli ne de sessizce silinmelidir. */
        Assert.True(await HasGrantAsync(scope, targetId, PermissionCodes.DrawingsDelete));
    }

    /* --- Sorgu maliyeti ---------------------------------------------------------------- */

    [Fact]
    public async Task Actor_authority_is_resolved_at_most_once_per_mutation()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "counted-actor", [.. PermissionCatalog.AllCodes]);
        var targetId = await RoleIdAsync(scope, GisRoles.Viewer);

        var counter = scope.ServiceProvider.GetRequiredService<EffectivePermissionCallCounter>();
        counter.Reset();

        var result = await ReplaceAsync(
            scope, actor.Id, targetId,
            [.. RolePermissionDefaults.For(GisRoles.Viewer), PermissionCodes.UsersDelete, PermissionCodes.LayersManage]);

        Assert.True(result.IsSuccess);

        /* Yetki BAŞINA değil, istek başına bir çözümleme. Katalog büyüdüğünde
           maliyet sabit kalmalıdır. */
        Assert.Equal(1, counter.Calls);
    }

    [Fact]
    public async Task A_pure_removal_resolves_actor_authority_exactly_once()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(scope, "remover-only", Gate);
        var targetId = await RoleIdAsync(scope, GisRoles.GisAnalyst);

        var counter = scope.ServiceProvider.GetRequiredService<EffectivePermissionCallCounter>();
        counter.Reset();

        var desired = RolePermissionDefaults.For(GisRoles.GisAnalyst)
            .Where(c => c != PermissionCodes.InventoryAnalysis)
            .ToArray();

        Assert.True((await ReplaceAsync(scope, actor.Id, targetId, desired)).IsSuccess);

        /* Kaldırma da kimlik doğrulaması ister, ama bedeli yine tek sorgudur —
           yetki başına değil, istek başına. */
        Assert.Equal(1, counter.Calls);
    }

    /* --- Preflight'ta bulunan somut istismarların yeniden denenmesi ------------------- */

    [Fact]
    public async Task The_reported_exploit_against_another_role_is_blocked()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(
            scope, "probe-a",
            [PermissionCodes.RolesView, PermissionCodes.PermissionsView, .. Gate]);

        var targetId = await RoleIdAsync(scope, GisRoles.Viewer);

        var result = await ReplaceAsync(scope, actor.Id, targetId, [PermissionCodes.InventoryAnalysis]);

        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
        Assert.False(await HasGrantAsync(scope, targetId, PermissionCodes.InventoryAnalysis));
    }

    [Fact]
    public async Task The_reported_self_escalation_exploit_is_blocked()
    {
        await using var scope = await CreateScopeAsync();
        var actor = await CreateActorAsync(
            scope, "probe-b",
            [PermissionCodes.RolesView, PermissionCodes.PermissionsView, .. Gate]);

        var ownRoleId = await RoleIdAsync(scope, ActorRoleName("probe-b"));
        var before = await EffectiveAsync(scope, actor.Id);
        Assert.Equal(4, before.Length);

        var result = await ReplaceAsync(
            scope, actor.Id, ownRoleId,
            [
                PermissionCodes.RolesView, PermissionCodes.PermissionsView, .. Gate,
                PermissionCodes.InventoryAnalysis, PermissionCodes.UsersDelete
            ]);

        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);

        var after = await EffectiveAsync(scope, actor.Id);
        Assert.Equal(before, after);
        Assert.DoesNotContain(PermissionCodes.InventoryAnalysis, after);
        Assert.DoesNotContain(PermissionCodes.UsersDelete, after);
    }

    /* --- Yardımcılar ------------------------------------------------------------------ */

    private static string ActorRoleName(string userName) => $"Role-{userName}";

    private static AppDbContext Db(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<AppDbContext>();

    private static IRoleManagementService Roles(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<IRoleManagementService>();

    private static Task<ServiceResult<RolePermissionsResponse>> ReplaceAsync(
        AsyncServiceScope scope,
        int actingUserId,
        int roleId,
        string[] codes) =>
        Roles(scope).ReplaceRolePermissionsAsync(
            actingUserId, roleId, new UpdateRolePermissionsRequest { PermissionCodes = [.. codes] });

    private static async Task<string[]> EffectiveAsync(AsyncServiceScope scope, int userId) =>
        [.. (await scope.ServiceProvider.GetRequiredService<IEffectivePermissionService>()
            .GetEffectivePermissionCodesAsync(userId)).OrderBy(c => c, StringComparer.Ordinal)];

    private static async Task<int> RoleIdAsync(AsyncServiceScope scope, string name)
    {
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();
        var role = await roles.FindByNameAsync(name);
        Assert.NotNull(role);
        return role!.Id;
    }

    /// <summary>Rolün AKTİF yetki kodları, sıralı.</summary>
    private static async Task<string[]> CodesOfAsync(AsyncServiceScope scope, int roleId)
    {
        var db = Db(scope);

        var codes = await db.RolePermissions
            .AsNoTracking()
            .Where(rp => rp.RoleId == roleId)
            .Join(db.Permissions.Where(p => p.IsActive), rp => rp.PermissionId, p => p.Id, (_, p) => p.Code)
            .ToListAsync();

        return [.. codes.OrderBy(c => c, StringComparer.Ordinal)];
    }

    private static async Task<bool> HasGrantAsync(AsyncServiceScope scope, int roleId, string code)
    {
        var db = Db(scope);

        return await db.RolePermissions
            .AsNoTracking()
            .AnyAsync(rp => rp.RoleId == roleId && db.Permissions.Any(p => p.Id == rp.PermissionId && p.Code == code));
    }

    /// <summary>Verilen yetkilere sahip özel bir rol ve o roldeki aktif kullanıcı.</summary>
    private static async Task<User> CreateActorAsync(AsyncServiceScope scope, string userName, string[] codes)
    {
        var roleName = ActorRoleName(userName);
        var created = (await Roles(scope).CreateRoleAsync(new CreateRoleRequest { Name = roleName })).Value!;

        /* Kurgu doğrudan veritabanına yazılır; zayıf aktörü kurmak için tam da
           sınanan bariyerden geçmek gerekmemelidir. */
        await SeedGrantsAsync(scope, created.Id, codes);

        return await CreateUserAsync(scope, userName, roleName);
    }

    private static async Task SeedGrantsAsync(AsyncServiceScope scope, int roleId, string[] codes)
    {
        var db = Db(scope);

        var ids = await db.Permissions.Where(p => codes.Contains(p.Code)).Select(p => p.Id).ToListAsync();
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

    private static async Task GrantDirectAsync(AsyncServiceScope scope, User user, string code)
    {
        var db = Db(scope);
        var permission = await db.Permissions.SingleAsync(p => p.Code == code);

        db.UserPermissions.Add(new UserPermission { UserId = user.Id, PermissionId = permission.Id });
        await db.SaveChangesAsync();
    }

    private static async Task RevokeGrantAsync(AsyncServiceScope scope, int roleId, string code)
    {
        var db = Db(scope);
        var permission = await db.Permissions.SingleAsync(p => p.Code == code);

        db.RolePermissions.RemoveRange(
            await db.RolePermissions.Where(rp => rp.RoleId == roleId && rp.PermissionId == permission.Id).ToListAsync());

        await db.SaveChangesAsync();
    }

    private static async Task DeactivateAsync(AsyncServiceScope scope, string code)
    {
        var db = Db(scope);
        var permission = await db.Permissions.SingleAsync(p => p.Code == code);
        permission.IsActive = false;
        await db.SaveChangesAsync();
    }

    private static async Task SuspendAsync(AsyncServiceScope scope, User user)
    {
        var db = Db(scope);
        var tracked = await db.Users.SingleAsync(u => u.Id == user.Id);
        tracked.AccountStatus = AccountStatus.Suspended;
        tracked.IsActive = false;
        await db.SaveChangesAsync();
    }

    private static async Task<AsyncServiceScope> CreateScopeAsync()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
        services.AddDbContext<AppDbContext>(o => o
            .UseInMemoryDatabase($"grant-authority-{Guid.NewGuid():N}")
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)));

        services.AddIdentityCore<User>(o => o.Password.RequiredLength = 8)
            .AddRoles<IdentityRole<int>>()
            .AddEntityFrameworkStores<AppDbContext>()
            .AddDefaultTokenProviders();

        /* Etkin yetki servisi sayaçla sarılır: otoritenin istek başına BİR kez
           çözüldüğünü iddia etmek, ölçmeden güvenilebilecek bir şey değildir. */
        services.AddSingleton<EffectivePermissionCallCounter>();
        services.AddScoped<EffectivePermissionService>();
        services.AddScoped<IEffectivePermissionService>(sp => new CountingEffectivePermissionService(
            sp.GetRequiredService<EffectivePermissionService>(),
            sp.GetRequiredService<EffectivePermissionCallCounter>()));

        services.AddScoped<IGeographicAuthorizationService, GeographicAuthorizationService>();

        services.AddScoped<IRoleManagementService, RoleManagementService>();
        services.AddSingleton(Substitute.For<ILogger<RoleManagementService>>());

        var scope = services.BuildServiceProvider().CreateAsyncScope();
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

        foreach (var role in ApplicationRoles.Retired)
        {
            await roles.CreateAsync(new IdentityRole<int>(role));
        }

        await AuthorizationDataSeeder.SeedAsync(
            Db(scope),
            roles,
            scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("seed"));

        return scope;
    }

    private sealed class EffectivePermissionCallCounter
    {
        public int Calls { get; private set; }

        public void Increment() => Calls++;

        public void Reset() => Calls = 0;
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
            _counter.Increment();
            return _inner.GetEffectivePermissionCodesAsync(userId, cancellationToken);
        }

        public Task<bool> HasPermissionAsync(
            int userId,
            string? permissionCode,
            CancellationToken cancellationToken = default) =>
            _inner.HasPermissionAsync(userId, permissionCode, cancellationToken);
    }
}
