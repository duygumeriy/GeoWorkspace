using StajProject.Application.Common;
using StajProject.Application.DTOs;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Rollerin ve rol-yetki matrisinin yönetimi.
/// </summary>
/// <remarks>
/// <para>
/// Yetki kontrolü burada DEĞİL, uçlardaki <c>MfaRequired</c> +
/// <c>[RequirePermission]</c> katmanındadır. Bu servis "çağıranın yetkisi
/// var" varsayımıyla iş kurallarını uygular: korunan rollerin dokunulmazlığı,
/// ad benzersizliği, kullanıcısı olan rolün silinememesi ve yetki
/// atamalarının atomikliği.
/// </para>
/// <para>
/// Kullanıcı yönetimi bilinçli olarak kapsam dışıdır; o
/// <see cref="IUserManagementService"/>'in sorumluluğudur. İkisi tek bir
/// "AdminService" altında birleştirilmez.
/// </para>
/// </remarks>
public interface IRoleManagementService
{
    Task<IReadOnlyList<RoleListItem>> GetRolesAsync(CancellationToken cancellationToken = default);

    Task<ServiceResult<RoleDetail>> GetRoleAsync(int roleId, CancellationToken cancellationToken = default);

    Task<ServiceResult<RoleDetail>> CreateRoleAsync(
        CreateRoleRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>Yalnızca özel roller yeniden adlandırılabilir.</summary>
    Task<ServiceResult<RoleDetail>> RenameRoleAsync(
        int roleId,
        UpdateRoleRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Yalnızca kullanıcısı olmayan özel roller silinebilir. Kullanıcılar
    /// başka bir role TAŞINMAZ; bu bilinçli bir yönetici kararı olmalıdır.
    /// </summary>
    Task<ServiceResult<bool>> DeleteRoleAsync(int roleId, CancellationToken cancellationToken = default);

    /// <summary>Yetki kataloğunun tamamı (pasifler dahil, işaretlenmiş olarak).</summary>
    Task<IReadOnlyList<PermissionCatalogItem>> GetPermissionCatalogAsync(
        CancellationToken cancellationToken = default);

    Task<ServiceResult<RolePermissionsResponse>> GetRolePermissionsAsync(
        int roleId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Rolün yetkilerini istenen kümeye eşitler (ekleme + kaldırma farkı).
    /// </summary>
    Task<ServiceResult<RolePermissionsResponse>> ReplaceRolePermissionsAsync(
        int roleId,
        UpdateRolePermissionsRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Yeni atamalarda seçilebilecek roller. Onay ekranı ve rol değiştirme
    /// ucunun <b>tek</b> doğrulama kaynağıdır.
    /// </summary>
    Task<IReadOnlyList<AssignableRole>> GetAssignableRolesAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Serbest metinden atanabilir bir rol adı çözer ve <b>çağıranın o rolü
    /// verme yetkisi olduğunu</b> doğrular. Onay ve rol değiştirme akışlarının
    /// ikisi de bunu kullanır; doğrulama iki yerde ayrı ayrı yazılmaz.
    /// </summary>
    /// <param name="actingUserId">
    /// İşlemi yapan yöneticinin kimliği. <b>İstek gövdesinden değil</b>,
    /// doğrulanmış token'dan gelmelidir.
    /// </param>
    /// <remarks>
    /// <para>
    /// <b>Yetki yükseltme koruması.</b> Bir kullanıcı sahip olmadığı yetkileri
    /// dağıtamaz: hedef rolün AKTİF yetkileri, çağıranın etkin yetkilerinin
    /// alt kümesi olmak zorundadır. Aksi hâlde yalnızca <c>users.update</c>
    /// yetkisi olan biri, bir başkasını 27 yetkili <c>Administrator</c> yapıp
    /// o hesap üzerinden tüm sisteme erişebilirdi.
    /// </para>
    /// <para>
    /// Çağıran kimliği parametre olarak ZORUNLUDUR: kontrolsüz bir aşırı
    /// yükleme bırakılmaz, böylece rol atayan hiçbir yol bu kuralı yanlışlıkla
    /// atlayamaz.
    /// </para>
    /// </remarks>
    Task<ServiceResult<string>> ResolveAssignableRoleAsync(
        string? roleName,
        int actingUserId,
        CancellationToken cancellationToken = default);
}
