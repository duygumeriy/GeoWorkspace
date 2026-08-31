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
/// Ulaşım simülasyonunun ince HTTP yüzü.
/// </summary>
/// <remarks>
/// <para>
/// <b>İş kuralı burada YOKTUR.</b> Rota/yol denetimleri, bayatlık ve tekillik
/// kararı servistedir; controller yalnızca yetkiyi bildirir ve
/// <see cref="ServiceResult{T}"/>'i mevcut eşlemeyle HTTP'ye çevirir.
/// </para>
/// <para>
/// <b>Yetkiler ayrıktır:</b> başlatmak <c>transport.simulation.start</c>,
/// izlemek mevcut <c>transport.view</c> ister. Simülasyonun konumunu görmek,
/// ulaşım ağını görüntülemenin bir parçasıdır; ayrı bir okuma yetkisi
/// UYDURULMAZ.
/// </para>
/// </remarks>
[ApiController]
[Authorize]
[Route("api/transport/simulations")]
public sealed class TransportSimulationController : ApiControllerBase
{
    private readonly ITransportSimulationService _simulations;

    public TransportSimulationController(
        ITransportSimulationService simulations,
        ILogger<TransportSimulationController> logger)
        : base(logger)
    {
        _simulations = simulations;
    }

    [HttpPost("routes/{routeId:int}/start")]
    [RequirePermission(PermissionCodes.TransportSimulationStart)]
    public Task<ActionResult<TransportSimulationResponse>> Start(int routeId, CancellationToken cancellationToken) =>
        Guard<TransportSimulationResponse>(nameof(Start), async () =>
        {
            var result = await _simulations.StartAsync(routeId, cancellationToken);
            return result.IsSuccess
                ? StatusCode(StatusCodes.Status201Created, result.Value)
                : Error<TransportSimulationResponse>(result);
        });

    [HttpGet("routes/{routeId:int}")]
    [RequirePermission(PermissionCodes.TransportView)]
    public Task<ActionResult<TransportSimulationResponse>> GetActive(int routeId, CancellationToken cancellationToken) =>
        Guard(nameof(GetActive), async () => Respond(await _simulations.GetActiveAsync(routeId, cancellationToken)));

    private ActionResult<T> Respond<T>(ServiceResult<T> result) =>
        result.IsSuccess ? Ok(result.Value!) : Error<T>(result);

    private ObjectResult Error<T>(ServiceResult<T> result)
    {
        var statusCode = result.ErrorKind switch
        {
            ServiceErrorKind.NotFound => StatusCodes.Status404NotFound,
            ServiceErrorKind.Forbidden => StatusCodes.Status403Forbidden,
            ServiceErrorKind.Conflict => StatusCodes.Status409Conflict,
            ServiceErrorKind.Upstream => StatusCodes.Status502BadGateway,
            ServiceErrorKind.Timeout => StatusCodes.Status504GatewayTimeout,
            _ => StatusCodes.Status400BadRequest
        };

        return StatusCode(
            statusCode,
            ApiError.Create(statusCode, result.Error!, HttpContext.TraceIdentifier));
    }
}
