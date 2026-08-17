using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StajProject.Api.Common;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;

namespace StajProject.Api.Controllers;

/// <summary>
/// Admin kullanıcı yönetimi. Tüm uçlar <see cref="AuthorizationPolicies.AdminMfaRequired"/>
/// ile korunur: anonim istek 401, yetkisi olmayan authenticated kullanıcı 403 alır.
/// </summary>
/// <remarks>
/// <para>
/// AUTH-5'ten itibaren policy yalnızca Admin rolünü değil, tamamlanmış ikinci
/// faktörü de (<c>amr=mfa</c>) arar. Bunlar sistemdeki en güçlü uçlar: rol
/// değiştirme ve hesap pasifleştirme. Yalnız şifreyle elde edilmiş bir token
/// — böyle bir token'ın hiç üretilmemesi gerekse de — buraya giremez.
/// </para>
/// <para>
/// Controller kasıtlı olarak incedir; rol mantığı, son aktif Admin koruması ve
/// durum kuralları <see cref="IUserManagementService"/> içindedir.
/// AUTH-6'daki admin UI bu uçları tüketecek.
/// </para>
/// <para>
/// <b>Hata yönetimi.</b> Tüm uçlar <see cref="ApiControllerBase"/> üzerinden
/// aynı try-catch sınırındadır. Yetkilendirme kararı sınırın <i>dışındadır</i>:
/// policy MVC filtresi olarak çalışır, dolayısıyla 401/403 buradaki catch'e
/// hiç uğramaz ve beklenmeyen bir hata yetki kontrolünü maskeleyemez.
/// </para>
/// </remarks>
[ApiController]
[Authorize(Policy = AuthorizationPolicies.AdminMfaRequired)]
[Route("api/admin/users")]
public class AdminUsersController : ApiControllerBase
{
    private readonly IUserManagementService _userManagement;
    private readonly ICurrentUserService _currentUser;

    public AdminUsersController(
        IUserManagementService userManagement,
        ICurrentUserService currentUser,
        ILogger<AdminUsersController> logger)
        : base(logger)
    {
        _userManagement = userManagement;
        _currentUser = currentUser;
    }

    [HttpGet]
    public Task<ActionResult<IReadOnlyList<AdminUserListItem>>> GetUsers(CancellationToken cancellationToken) =>
        Guard<IReadOnlyList<AdminUserListItem>>(
            nameof(GetUsers),
            async () => Ok(await _userManagement.GetUsersAsync(cancellationToken)));

    [HttpGet("{id:int}")]
    public Task<ActionResult<AdminUserDetail>> GetUser(int id, CancellationToken cancellationToken) =>
        GuardUser(nameof(GetUser), () => _userManagement.GetUserAsync(id, cancellationToken));

    /// <summary>
    /// Onay ekranında atanabilecek roller. Rota <c>{id:int}</c> kısıtı
    /// sayesinde kullanıcı detayı ucuyla çakışmaz.
    /// </summary>
    [HttpGet("roles")]
    public Task<ActionResult<IReadOnlyList<AssignableRole>>> GetAssignableRoles() =>
        Guard<IReadOnlyList<AssignableRole>>(
            nameof(GetAssignableRoles),
            () => Task.FromResult<ActionResult<IReadOnlyList<AssignableRole>>>(
                Ok(_userManagement.GetAssignableRoles())));

    [HttpPatch("{id:int}/role")]
    public Task<ActionResult<AdminUserDetail>> ChangeRole(
        int id,
        [FromBody] UpdateUserRoleRequest request,
        CancellationToken cancellationToken) =>
        GuardUser(
            nameof(ChangeRole),
            () => _userManagement.ChangeRoleAsync(id, request, ActingUserId, cancellationToken));

    [HttpPatch("{id:int}/status")]
    public Task<ActionResult<AdminUserDetail>> ChangeStatus(
        int id,
        [FromBody] UpdateUserStatusRequest request,
        CancellationToken cancellationToken) =>
        GuardUser(
            nameof(ChangeStatus),
            () => _userManagement.ChangeStatusAsync(id, request, ActingUserId, cancellationToken));

    /* --- Onay akışı -----------------------------------------------------------
       Gövde yalnızca rol/gerekçe taşır. Aktiflik, onay zamanı ve onaylayan
       kimliği istemciden OKUNMAZ; sunucunun kendi kararlarıdır ve
       ActingUserId doğrulanmış yönetici token'ından gelir. */

    [HttpPost("{id:int}/approve")]
    public Task<ActionResult<AdminUserDetail>> Approve(
        int id,
        [FromBody] ApproveUserRequest request,
        CancellationToken cancellationToken) =>
        GuardUser(
            nameof(Approve),
            () => _userManagement.ApproveAsync(id, request, ActingUserId, cancellationToken));

    [HttpPost("{id:int}/reject")]
    public Task<ActionResult<AdminUserDetail>> Reject(
        int id,
        [FromBody] RejectUserRequest request,
        CancellationToken cancellationToken) =>
        GuardUser(
            nameof(Reject),
            () => _userManagement.RejectAsync(id, request, ActingUserId, cancellationToken));

    /// <summary>
    /// Kullanıcı döndüren uçların ortak sarmalayıcısı: hata sınırı + mevcut
    /// <see cref="Respond"/> eşlemesi. İş kuralı sonuçları (404/409/400) burada
    /// değişmez; catch yalnızca beklenmeyen hatalar içindir.
    /// </summary>
    private Task<ActionResult<AdminUserDetail>> GuardUser(
        string endpoint,
        Func<Task<ServiceResult<AdminUserDetail>>> operation) =>
        Guard<AdminUserDetail>(endpoint, async () => Respond(await operation()));

    /// <summary>
    /// İşlemi yapan Admin'in kimliği. Policy sayesinde buraya yalnızca
    /// doğrulanmış bir Admin gelebilir, dolayısıyla değer daima mevcuttur.
    /// </summary>
    private int ActingUserId => _currentUser.UserId ?? 0;

    private ActionResult<AdminUserDetail> Respond(ServiceResult<AdminUserDetail> result)
    {
        if (result.IsSuccess)
        {
            return Ok(result.Value);
        }

        return result.ErrorKind switch
        {
            ServiceErrorKind.NotFound => NotFound(new { message = result.Error }),
            ServiceErrorKind.Conflict => Conflict(new { message = result.Error }),
            _ => BadRequest(new { message = result.Error })
        };
    }
}
