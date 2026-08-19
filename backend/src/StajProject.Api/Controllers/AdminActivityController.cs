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
/// Aktivite geçmişi: sistemde kimin neyi ne zaman değiştirdiği.
/// </summary>
/// <remarks>
/// <para>
/// <b>Yalnızca OKUMA.</b> Yazma, düzenleme ve silme uçları bilinçli olarak
/// YOKTUR. Silinebilen bir denetim kaydı denetim kaydı değildir: geçmişi
/// düzeltebilen bir yönetici, kendi hareketini de silebilirdi.
/// </para>
/// <para>
/// <b>Yetki: <c>activity.view</c> + MFA.</b> Diğer yönetim uçlarıyla aynı
/// ikinci faktör şartı geçerlidir — kayıt, tüm yöneticilerin hareketlerini
/// gösterir ve en az onlar kadar korunmalıdır. Yetki <c>users.view</c> altına
/// gizlenmez: kullanıcı listesini görebilmek, yönetim geçmişini okuyabilmekle
/// aynı şey değildir.
/// </para>
/// <para>
/// <b>Rol adına bakan hiçbir kural yoktur.</b> Kodu taşıyan özel bir rol de,
/// kullanıcıya doğrudan verilmiş bir yetki de bu ucu açar; kodu alınmış bir
/// "Administrator" açamaz.
/// </para>
/// </remarks>
[ApiController]
[Authorize(Policy = AuthorizationPolicies.MfaRequired)]
[Route("api/admin/activity")]
public class AdminActivityController : ApiControllerBase
{
    private readonly IActivityLogQueryService _activity;

    public AdminActivityController(
        IActivityLogQueryService activity,
        ILogger<AdminActivityController> logger)
        : base(logger)
    {
        _activity = activity;
    }

    /// <summary>
    /// Aktivite geçmişi — en yeniden eskiye, sayfalanmış.
    /// </summary>
    /// <remarks>
    /// Sorgu parametreleri isteğe bağlıdır ve hepsi indeksli kolonlar
    /// üzerindedir. Sayfa boyutu sunucuda sınırlanır; istemcinin verdiği
    /// büyük bir değer hata değil, kırpmadır.
    /// </remarks>
    [RequirePermission(PermissionCodes.ActivityView)]
    [HttpGet]
    public Task<ActionResult<ActivityLogPage>> GetActivity(
        [FromQuery] ActivityLogQuery query,
        CancellationToken cancellationToken) =>
        Guard<ActivityLogPage>(
            nameof(GetActivity),
            async () => Ok(await _activity.GetAsync(query, cancellationToken)));
}
