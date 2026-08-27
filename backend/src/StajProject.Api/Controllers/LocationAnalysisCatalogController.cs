using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StajProject.Api.Authorization;
using StajProject.Api.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;

namespace StajProject.Api.Controllers;

/// <summary>Konum analizinin kullanıcıya özel idari hedef kataloğu.</summary>
[ApiController]
[Authorize]
[Route("api/analysis/location/catalog")]
public sealed class LocationAnalysisCatalogController : ApiControllerBase
{
    private readonly ILocationAnalysisTargetCatalogService _catalog;

    public LocationAnalysisCatalogController(
        ILocationAnalysisTargetCatalogService catalog,
        ILogger<LocationAnalysisCatalogController> logger)
        : base(logger)
    {
        _catalog = catalog;
    }

    [RequirePermission(PermissionCodes.LocationAnalysis)]
    [RequirePermission(PermissionCodes.PoiView)]
    [HttpGet]
    public Task<ActionResult<LocationAnalysisTargetCatalogResponse>> Get(CancellationToken cancellationToken) =>
        Guard<LocationAnalysisTargetCatalogResponse>(nameof(Get), async () =>
        {
            var result = await _catalog.GetAuthorizedCatalogAsync(cancellationToken);
            if (result.IsSuccess)
            {
                Response.Headers.CacheControl = "private, no-store";
                return Ok(result.Value);
            }

            return Unauthorized(new { message = result.Error });
        });
}
