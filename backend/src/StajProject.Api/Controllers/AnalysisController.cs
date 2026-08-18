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
/// Mekânsal analiz uçları. Çizim uçlarıyla aynı güvenlik modelini kullanır
/// (<c>[Authorize]</c> + JWT) ve hiçbiri veritabanına kayıt yazmaz.
/// </summary>
/// <remarks>
/// Uç <see cref="ApiControllerBase.Guard{TValue}"/> ile sarılıdır: kesişim
/// sorgusu beklenmedik şekilde patlarsa istemci stack trace değil tek tip 500
/// alır. Sorgunun kendisi (PostGIS/EF) <see cref="ISpatialAnalysisService"/>
/// içindedir; controller yalnızca HTTP sınırıdır.
/// </remarks>
[ApiController]
[Authorize]
[Route("api/analysis")]
public class AnalysisController : ApiControllerBase
{
    private readonly ISpatialAnalysisService _spatialAnalysisService;

    public AnalysisController(ISpatialAnalysisService spatialAnalysisService, ILogger<AnalysisController> logger)
        : base(logger)
    {
        _spatialAnalysisService = spatialAnalysisService;
    }

    /// <summary>
    /// Gönderilen poligonla kesişen envanter kayıtlarını sayar. Poligon
    /// yalnızca sorgu parametresidir; hiçbir tabloya yazılmaz.
    /// </summary>
    /// <remarks>
    /// YETKİ: <c>inventory.analysis</c>. Uç envanteri yalnızca okumakla
    /// kalmaz, kesişim analizi çalıştırır; bu yüzden salt görüntüleme yetkisi
    /// (<c>inventory.view</c>) yeterli sayılmaz. Viewer analiz çalıştıramaz,
    /// GIS Analyst çalıştırabilir.
    /// </remarks>
    [RequirePermission(PermissionCodes.InventoryAnalysis)]
    [HttpPost("intersections")]
    public Task<ActionResult<IntersectionAnalysisResponse>> CountIntersections(
        [FromBody] IntersectionAnalysisRequest request,
        CancellationToken cancellationToken) =>
        Guard<IntersectionAnalysisResponse>(nameof(CountIntersections), async () =>
        {
            var result = await _spatialAnalysisService.CountIntersectionsAsync(request, cancellationToken);

            if (result.IsSuccess)
            {
                return Ok(result.Value);
            }

            return result.ErrorKind == ServiceErrorKind.NotFound
                ? NotFound(new { message = result.Error })
                : BadRequest(new { message = result.Error });
        });
}
