using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StajProject.Api.Authorization;
using StajProject.Api.Common;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;

namespace StajProject.Api.Controllers;

/// <summary>Kullanıcıya ve etkin coğrafi yetkisine özel heatmap PNG sınırı.</summary>
[ApiController]
[Authorize]
[Route("api/heatmap")]
public sealed class HeatmapController : ApiControllerBase
{
    private readonly IGeoServerHeatmapService _heatmap;

    public HeatmapController(IGeoServerHeatmapService heatmap, ILogger<HeatmapController> logger)
        : base(logger)
    {
        _heatmap = heatmap;
    }

    [HttpGet("image")]
    [RequirePermission(PermissionCodes.InventoryAnalysis)]
    public Task<IActionResult> GetImage(
        [FromQuery] HeatmapRequest request,
        CancellationToken cancellationToken) =>
        GuardAction(nameof(GetImage), async () =>
        {
            var result = await _heatmap.GetHeatmapAsync(request, cancellationToken);

            if (!result.IsSuccess)
            {
                return Problem(result);
            }

            Response.Headers.CacheControl = "private, no-store";
            Response.Headers.Pragma = "no-cache";
            return File(result.Value!.Content, "image/png");
        });

    private ObjectResult Problem(ServiceResult<HeatmapImage> result)
    {
        var statusCode = result.ErrorKind switch
        {
            ServiceErrorKind.Forbidden => StatusCodes.Status403Forbidden,
            ServiceErrorKind.Upstream => StatusCodes.Status502BadGateway,
            ServiceErrorKind.Timeout => StatusCodes.Status504GatewayTimeout,
            _ => StatusCodes.Status400BadRequest
        };

        return StatusCode(
            statusCode,
            ApiError.Create(statusCode, result.Error!, HttpContext.TraceIdentifier));
    }
}
