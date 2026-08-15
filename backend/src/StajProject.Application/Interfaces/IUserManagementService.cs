using StajProject.Application.Common;
using StajProject.Application.DTOs;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Admin'e açık kullanıcı yönetimi. Yetki kontrolü burada değil, controller
/// üzerindeki <see cref="AuthorizationPolicies.AdminOnly"/> policy'sinde
/// yapılır; bu servis "çağıran zaten Admin" varsayımıyla iş kurallarını
/// (son aktif Admin koruması, tek primary role) uygular.
/// </summary>
public interface IUserManagementService
{
    Task<IReadOnlyList<AdminUserListItem>> GetUsersAsync(CancellationToken cancellationToken = default);

    Task<ServiceResult<AdminUserDetail>> GetUserAsync(int userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Kullanıcının primary application role'ünü değiştirir (eski rol kaldırılır).
    /// </summary>
    /// <param name="actingUserId">İşlemi yapan Admin; kendi kendini kilitlemeye karşı kontrol için.</param>
    Task<ServiceResult<AdminUserDetail>> ChangeRoleAsync(
        int userId,
        UpdateUserRoleRequest request,
        int actingUserId,
        CancellationToken cancellationToken = default);

    /// <summary>Hesabı aktif/pasif yapar. Pasif hesap yeni login yapamaz.</summary>
    Task<ServiceResult<AdminUserDetail>> ChangeStatusAsync(
        int userId,
        UpdateUserStatusRequest request,
        int actingUserId,
        CancellationToken cancellationToken = default);
}
