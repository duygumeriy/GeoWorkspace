using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;

namespace StajProject.Api.Controllers;

/// <summary>
/// Mekânsal analiz uçları. Çizim uçlarıyla aynı güvenlik modelini kullanır
/// (<c>[Authorize]</c> + JWT) ve hiçbiri veritabanına kayıt yazmaz.
/// </summary>
[ApiController]
[Authorize]
[Route("api/analysis")]
public class AnalysisController : ControllerBase
{
    private readonly ISpatialAnalysisService _spatialAnalysisService;

    public AnalysisController(ISpatialAnalysisService spatialAnalysisService)
    {
        _spatialAnalysisService = spatialAnalysisService;
    }

    /// <summary>
    /// Gönderilen poligonla kesişen envanter kayıtlarını sayar. Poligon
    /// yalnızca sorgu parametresidir; hiçbir tabloya yazılmaz.
    /// </summary>
    [HttpPost("intersections")]
    public async Task<ActionResult<IntersectionAnalysisResponse>> CountIntersections(
        [FromBody] IntersectionAnalysisRequest request,
        CancellationToken cancellationToken)
    {
        var result = await _spatialAnalysisService.CountIntersectionsAsync(request, cancellationToken);

        if (result.IsSuccess)
        {
            return Ok(result.Value);
        }

        return result.ErrorKind == ServiceErrorKind.NotFound
            ? NotFound(new { message = result.Error })
            : BadRequest(new { message = result.Error });
    }
}
