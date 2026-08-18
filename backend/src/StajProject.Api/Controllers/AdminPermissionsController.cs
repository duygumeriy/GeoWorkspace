using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StajProject.Api.Authorization;
using StajProject.Api.Common;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;

namespace StajProject.Api.Controllers;

/// <summary>
/// Yetki kataloğunun salt okunur listesi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Katalogda CRUD bilinçli olarak YOKTUR.</b> Bir yetki, kodda karşılığı
/// olan bir uygulama yeteneğini temsil eder; yönetici bunları ATAYABİLİR ama
/// yenisini icat edemez. Aksi hâlde hiçbir kodun kontrol etmediği
/// <c>does.anything.user.wants</c> gibi satırlar üretilir ve katalog gerçeği
/// yansıtmayı bırakırdı. Dinamik yetkilendirme, dinamik ATAMA demektir;
/// güvenlik işlemlerinin çalışma zamanında uydurulması demek değil.
/// </para>
/// </remarks>
[ApiController]
[Authorize(Policy = AuthorizationPolicies.MfaRequired)]
[Route("api/admin/permissions")]
public class AdminPermissionsController : ApiControllerBase
{
    private readonly IRoleManagementService _roles;

    public AdminPermissionsController(IRoleManagementService roles, ILogger<AdminPermissionsController> logger)
        : base(logger)
    {
        _roles = roles;
    }

    /// <summary>
    /// Kanonik yetki kataloğu. Kullanımdan kaldırılmış yetkiler de listelenir
    /// ve <c>isActive = false</c> ile işaretlenir: yönetici mevcut durumu
    /// eksiksiz görebilmeli, ama bunları atayamaz.
    /// </summary>
    [RequirePermission(PermissionCodes.PermissionsView)]
    [HttpGet]
    public Task<ActionResult<IReadOnlyList<PermissionCatalogItem>>> GetPermissions(CancellationToken cancellationToken) =>
        Guard<IReadOnlyList<PermissionCatalogItem>>(
            nameof(GetPermissions),
            async () => Ok(await _roles.GetPermissionCatalogAsync(cancellationToken)));
}
