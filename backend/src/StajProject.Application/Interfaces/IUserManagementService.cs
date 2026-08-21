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
    /// Yönetici adına parolasız ve davet bekleyen bir kullanıcı oluşturur;
    /// kullanıcı ile ilk rol üyeliği aynı transaction içinde yazılır.
    /// </summary>
    Task<ServiceResult<AdminUserDetail>> CreateUserAsync(
        CreateAdminUserRequest request,
        int actingUserId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Davet bekleyen hesabın security stamp'ini yeniler ve yeni davet
    /// e-postası gönderir. Eski bağlantı stamp yenilendiği anda geçersizleşir.
    /// </summary>
    Task<ServiceResult<AdminUserDetail>> ResendInvitationAsync(
        int userId,
        CancellationToken cancellationToken = default);

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

    /// <summary>
    /// Onay ekranında seçilebilecek roller. Kaynak Identity'deki gerçek
    /// rollerdir; legacy geçiş rolleri bu listeye girmez ve liste
    /// <b>çağırana göre</b> daraltılır.
    /// </summary>
    /// <param name="actingUserId">
    /// Listeyi isteyen yönetici; doğrulanmış token'dan gelir. Yalnızca kendi
    /// yetkilerinin kapsadığı roller döner, böylece ekranda görünüp mutasyonda
    /// 403 alan bir seçenek oluşmaz.
    /// </param>
    Task<IReadOnlyList<AssignableRole>> GetAssignableRolesAsync(
        int actingUserId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Onay bekleyen hesabı, seçilen rolü atayarak aktifleştirir ve
    /// kullanıcıya bilgilendirme e-postası gönderir.
    /// </summary>
    /// <remarks>
    /// Rol ataması ile aktifleştirme <b>tek transaction</b> içindedir: hesap
    /// hiçbir koşulda "aktif ama rolsüz" kalmaz. E-posta gönderimi transaction
    /// dışındadır ve başarısız olması aktifleştirmeyi geri almaz.
    /// </remarks>
    /// <param name="actingUserId">Onaylayan yönetici; audit alanına yazılır.</param>
    Task<ServiceResult<AdminUserDetail>> ApproveAsync(
        int userId,
        ApproveUserRequest request,
        int actingUserId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Onay bekleyen başvuruyu reddeder. Reddedilen hesap uygulama token'ı
    /// alamaz ve rol kazanmaz.
    /// </summary>
    Task<ServiceResult<AdminUserDetail>> RejectAsync(
        int userId,
        RejectUserRequest request,
        int actingUserId,
        CancellationToken cancellationToken = default);
}
