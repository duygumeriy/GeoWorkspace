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
/// Rol yönetimi ve rol-yetki matrisi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Güvenlik iki bağımsız boyuttur:</b> controller seviyesinde
/// <see cref="AuthorizationPolicies.MfaRequired"/> (ikinci faktör kanıtı) ve
/// action seviyesinde gereken yetki. Hiçbir uçta rol adı kontrolü YOKTUR —
/// legacy <c>Admin</c> ve <c>Administrator</c> buradan geçebiliyorsa bunun
/// sebebi sahip oldukları yetki satırlarıdır. Bu yetkiler verilirse özel bir
/// rol de rol yönetimi yapabilir; dinamik yetkilendirmenin amacı budur.
/// </para>
/// <para>
/// Controller yalnızca HTTP sınırıdır: rollerin korunması, ad benzersizliği ve
/// yetki atamalarının atomikliği <see cref="IRoleManagementService"/>
/// içindedir.
/// </para>
/// </remarks>
[ApiController]
[Authorize(Policy = AuthorizationPolicies.MfaRequired)]
[Route("api/admin/roles")]
public class AdminRolesController : ApiControllerBase
{
    private readonly IRoleManagementService _roles;
    private readonly ICurrentUserService _currentUser;

    public AdminRolesController(
        IRoleManagementService roles,
        ICurrentUserService currentUser,
        ILogger<AdminRolesController> logger)
        : base(logger)
    {
        _roles = roles;
        _currentUser = currentUser;
    }

    /// <summary>
    /// Sistemdeki rollerin envanteri: legacy, kanonik ve özel rollerin tamamı,
    /// metadata'sıyla birlikte.
    /// </summary>
    /// <remarks>
    /// <b>Bu uç çağırana göre filtrelenmez</b> ve bilinçli olarak öyledir.
    /// Sorusu "sistemde hangi roller VAR"dır; yönetim ekranı, atayamayacağı
    /// rolleri de görebilmelidir (kullanıcı sayıları, yetki matrisi, silme /
    /// yeniden adlandırma kuralları). "Bu çağıran hangi rolleri VEREBİLİR"
    /// sorusu ayrı bir uçtadır: <c>GET /api/admin/users/roles</c>. İki soru
    /// karıştırılırsa ya envanter eksik görünür ya da atama listesi yanıltıcı
    /// olur.
    /// </remarks>
    [RequirePermission(PermissionCodes.RolesView)]
    [HttpGet]
    public Task<ActionResult<IReadOnlyList<RoleListItem>>> GetRoles(CancellationToken cancellationToken) =>
        Guard<IReadOnlyList<RoleListItem>>(
            nameof(GetRoles),
            async () => Ok(await _roles.GetRolesAsync(cancellationToken)));

    [RequirePermission(PermissionCodes.RolesView)]
    [HttpGet("{id:int}")]
    public Task<ActionResult<RoleDetail>> GetRole(int id, CancellationToken cancellationToken) =>
        Guard<RoleDetail>(
            nameof(GetRole),
            async () => Respond(await _roles.GetRoleAsync(id, cancellationToken)));

    [RequirePermission(PermissionCodes.RolesCreate)]
    [HttpPost]
    public Task<ActionResult<RoleDetail>> CreateRole(
        [FromBody] CreateRoleRequest request,
        CancellationToken cancellationToken) =>
        Guard<RoleDetail>(nameof(CreateRole), async () =>
        {
            var result = await _roles.CreateRoleAsync(request, cancellationToken);

            return result.IsSuccess
                ? CreatedAtAction(nameof(GetRole), new { id = result.Value!.Id }, result.Value)
                : Respond(result);
        });

    [RequirePermission(PermissionCodes.RolesUpdate)]
    [HttpPatch("{id:int}")]
    public Task<ActionResult<RoleDetail>> RenameRole(
        int id,
        [FromBody] UpdateRoleRequest request,
        CancellationToken cancellationToken) =>
        Guard<RoleDetail>(
            nameof(RenameRole),
            async () => Respond(await _roles.RenameRoleAsync(id, request, cancellationToken)));

    [RequirePermission(PermissionCodes.RolesDelete)]
    [HttpDelete("{id:int}")]
    public Task<IActionResult> DeleteRole(int id, CancellationToken cancellationToken) =>
        GuardAction(nameof(DeleteRole), async () =>
        {
            var result = await _roles.DeleteRoleAsync(id, cancellationToken);

            return result.IsSuccess ? NoContent() : Error(result);
        });

    /* --- Rol yetkileri ---------------------------------------------------------
       İki yetki birden istenir: rolü görmek (roles.view) ve yetki kataloğunu
       görmek (permissions.view). Yanıt ikisini birleştirdiği için tek bir
       yetkiyle açmak, diğer kaynağı dolaylı olarak sızdırmak olurdu. */

    [RequirePermission(PermissionCodes.RolesView)]
    [RequirePermission(PermissionCodes.PermissionsView)]
    [HttpGet("{id:int}/permissions")]
    public Task<ActionResult<RolePermissionsResponse>> GetRolePermissions(int id, CancellationToken cancellationToken) =>
        Guard<RolePermissionsResponse>(
            nameof(GetRolePermissions),
            async () => Respond(await _roles.GetRolePermissionsAsync(id, cancellationToken)));

    /// <summary>
    /// Rolün yetkilerini gönderilen kümeye eşitler.
    /// </summary>
    /// <remarks>
    /// Değişiklik anında geçerlidir: yetki denetimi her istekte canlı
    /// veritabanını okur, dolayısıyla yeniden giriş, token yenilemesi veya
    /// sunucu yeniden başlatması GEREKMEZ.
    /// </para>
    /// <para>
    /// Tam da bu canlılık yüzünden servise çağıranın kimliği geçilir: aksi
    /// hâlde <c>permissions.assign</c> sahibi kendi rolünü genişletip aynı
    /// oturumda yetkilenebilirdi. Servis <c>yeni eklenenler ⊆ çağıranın etkin
    /// yetkileri</c> kuralını uygular ve ihlalde 403 döner.
    /// </remarks>
    [RequirePermission(PermissionCodes.RolesUpdate)]
    [RequirePermission(PermissionCodes.PermissionsAssign)]
    [HttpPut("{id:int}/permissions")]
    public Task<ActionResult<RolePermissionsResponse>> ReplaceRolePermissions(
        int id,
        [FromBody] UpdateRolePermissionsRequest request,
        CancellationToken cancellationToken) =>
        Guard<RolePermissionsResponse>(
            nameof(ReplaceRolePermissions),
            async () => Respond(await _roles.ReplaceRolePermissionsAsync(
                ActingUserId, id, request, cancellationToken)));

    /* --- Sonuç eşlemesi --------------------------------------------------------
       İş kuralı sonuçlarının HTTP karşılığı tek yerde tutulur; her action
       kendi eşlemesini yazmaz. */

    /// <summary>
    /// İşlemi yapan yöneticinin kimliği; daima doğrulanmış token'dan gelir,
    /// istek gövdesinden veya query'den ASLA okunmaz.
    /// </summary>
    /// <remarks>
    /// Policy sayesinde buraya yalnızca doğrulanmış bir kullanıcı gelebilir,
    /// dolayısıyla değer pratikte daima mevcuttur. Yine de <c>0</c>'a düşüş
    /// fail-closed'dır: servis bu kimlikle hiçbir YENİ yetki ekleyemez.
    /// </remarks>
    private int ActingUserId => _currentUser.UserId ?? 0;

    private ActionResult<TValue> Respond<TValue>(ServiceResult<TValue> result) =>
        result.IsSuccess ? Ok(result.Value!) : Error(result);

    /// <summary>
    /// Gövde biçimi mevcut yönetim uçlarıyla birebir aynıdır
    /// (<c>{ message }</c>), böylece istemcinin hata okuyucusu değişmez.
    /// </summary>
    private ObjectResult Error<TValue>(ServiceResult<TValue> result) =>
        result.ErrorKind switch
        {
            ServiceErrorKind.NotFound => NotFound(new { message = result.Error }),
            ServiceErrorKind.Conflict => Conflict(new { message = result.Error }),
            /* Yetki yükseltme reddi: istek biçimsel olarak geçerli, rol ve
               yetki kodları da var — eksik olan çağıranın o yetkiyi DAĞITMA
               otoritesidir. 400 "isteğin bozuk" derdi ve nedeni yanlış
               anlatırdı; kullanıcı yönetimi ucu da aynı eşlemeyi kullanır. */
            ServiceErrorKind.Forbidden => StatusCode(StatusCodes.Status403Forbidden, new { message = result.Error }),
            _ => BadRequest(new { message = result.Error })
        };
}
