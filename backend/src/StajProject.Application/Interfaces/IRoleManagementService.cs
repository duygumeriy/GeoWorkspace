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
    /// Serbest metinden atanabilir bir rol adı çözer. Onay ve rol değiştirme
    /// akışlarının ikisi de bunu kullanır; doğrulama iki yerde ayrı ayrı
    /// yazılmaz.
    /// </summary>
    Task<ServiceResult<string>> ResolveAssignableRoleAsync(
        string? roleName,
        CancellationToken cancellationToken = default);
}
