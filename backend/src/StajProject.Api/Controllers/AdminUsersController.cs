using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
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
/// </remarks>
[ApiController]
[Authorize(Policy = AuthorizationPolicies.AdminMfaRequired)]
[Route("api/admin/users")]
public class AdminUsersController : ControllerBase
{
    private readonly IUserManagementService _userManagement;
    private readonly ICurrentUserService _currentUser;

    public AdminUsersController(IUserManagementService userManagement, ICurrentUserService currentUser)
    {
        _userManagement = userManagement;
        _currentUser = currentUser;
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<AdminUserListItem>>> GetUsers(CancellationToken cancellationToken) =>
        Ok(await _userManagement.GetUsersAsync(cancellationToken));

    [HttpGet("{id:int}")]
    public async Task<ActionResult<AdminUserDetail>> GetUser(int id, CancellationToken cancellationToken) =>
        Respond(await _userManagement.GetUserAsync(id, cancellationToken));

    [HttpPatch("{id:int}/role")]
    public async Task<ActionResult<AdminUserDetail>> ChangeRole(
        int id,
        [FromBody] UpdateUserRoleRequest request,
        CancellationToken cancellationToken) =>
        Respond(await _userManagement.ChangeRoleAsync(id, request, ActingUserId, cancellationToken));

    [HttpPatch("{id:int}/status")]
    public async Task<ActionResult<AdminUserDetail>> ChangeStatus(
        int id,
        [FromBody] UpdateUserStatusRequest request,
        CancellationToken cancellationToken) =>
        Respond(await _userManagement.ChangeStatusAsync(id, request, ActingUserId, cancellationToken));

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
