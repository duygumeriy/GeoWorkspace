using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StajProject.Api.Authorization;
using StajProject.Api.Common;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;

namespace StajProject.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/transport")]
public sealed class TransportController : ApiControllerBase
{
    private readonly ITransportService _transport;

    public TransportController(ITransportService transport, ILogger<TransportController> logger)
        : base(logger)
    {
        _transport = transport;
    }

    [HttpGet("routes")]
    [RequirePermission(PermissionCodes.TransportView)]
    public Task<ActionResult<IReadOnlyList<TransportRouteResponse>>> GetRoutes(CancellationToken cancellationToken) =>
        Guard(nameof(GetRoutes), async () => Respond(await _transport.GetRoutesAsync(cancellationToken)));

    [HttpGet("routes/{id:int}")]
    [RequirePermission(PermissionCodes.TransportView)]
    public Task<ActionResult<TransportRouteResponse>> GetRoute(int id, CancellationToken cancellationToken) =>
        Guard(nameof(GetRoute), async () => Respond(await _transport.GetRouteAsync(id, cancellationToken)));

    [HttpGet("routes/paths")]
    [RequirePermission(PermissionCodes.TransportView)]
    public Task<ActionResult<IReadOnlyList<TransportRouteMapPathResponse>>> GetRoutePaths(CancellationToken cancellationToken) =>
        Guard(nameof(GetRoutePaths), async () => Respond(await _transport.GetRoutePathsAsync(cancellationToken)));

    [HttpGet("routes/{routeId:int}/path")]
    [RequirePermission(PermissionCodes.TransportView)]
    public Task<ActionResult<TransportRoutePathResponse>> GetRoutePath(int routeId, CancellationToken cancellationToken) =>
        Guard(nameof(GetRoutePath), async () => Respond(await _transport.GetRoutePathAsync(routeId, cancellationToken)));

    [HttpPost("routes/{routeId:int}/path/generate")]
    [RequirePermission(PermissionCodes.TransportRouteUpdate)]
    public Task<ActionResult<TransportRoutePathResponse>> GenerateRoutePath(int routeId, CancellationToken cancellationToken) =>
        Guard(nameof(GenerateRoutePath), async () => Respond(await _transport.GenerateRoutePathAsync(routeId, cancellationToken)));

    [HttpGet("routes/{id:int}/stops")]
    [RequirePermission(PermissionCodes.TransportView)]
    public Task<ActionResult<IReadOnlyList<TransportStopResponse>>> GetRouteStops(int id, CancellationToken cancellationToken) =>
        Guard(nameof(GetRouteStops), async () => Respond(await _transport.GetRouteStopsAsync(id, cancellationToken)));

    [HttpGet("stops")]
    [RequirePermission(PermissionCodes.TransportView)]
    public Task<ActionResult<IReadOnlyList<TransportStopResponse>>> GetStops(CancellationToken cancellationToken) =>
        Guard(nameof(GetStops), async () => Respond(await _transport.GetStopsAsync(cancellationToken)));

    [HttpGet("stops/deleted")]
    [RequirePermission(PermissionCodes.TransportStopRestore)]
    public Task<ActionResult<IReadOnlyList<TransportStopResponse>>> GetDeletedStops(CancellationToken cancellationToken) =>
        Guard(nameof(GetDeletedStops), async () => Respond(await _transport.GetDeletedStopsAsync(cancellationToken)));

    [HttpGet("stops/mine")]
    [RequirePermission(PermissionCodes.TransportView)]
    public Task<ActionResult<IReadOnlyList<TransportStopResponse>>> GetOwnStops(CancellationToken cancellationToken) =>
        Guard(nameof(GetOwnStops), async () => Respond(await _transport.GetOwnStopsAsync(cancellationToken)));

    [HttpGet("routes/trash")]
    [RequirePermission(PermissionCodes.TransportRouteRestore)]
    public Task<ActionResult<IReadOnlyList<TransportRouteResponse>>> GetRouteTrash(CancellationToken cancellationToken) =>
        Guard(nameof(GetRouteTrash), async () => Respond(await _transport.GetRouteTrashAsync(cancellationToken)));

    [HttpGet("stops/trash")]
    [RequirePermission(PermissionCodes.TransportStopRestore)]
    public Task<ActionResult<IReadOnlyList<TransportStopResponse>>> GetStopTrash(CancellationToken cancellationToken) =>
        Guard(nameof(GetStopTrash), async () => Respond(await _transport.GetStopTrashAsync(cancellationToken)));

    [HttpPost("routes")]
    [RequirePermission(PermissionCodes.TransportRouteCreate)]
    public Task<ActionResult<TransportRouteResponse>> CreateRoute(
        [FromBody] CreateTransportRouteRequest request,
        CancellationToken cancellationToken) =>
        Guard<TransportRouteResponse>(nameof(CreateRoute), async () =>
        {
            var result = await _transport.CreateRouteAsync(request, cancellationToken);
            return result.IsSuccess
                ? CreatedAtAction(nameof(GetRoute), new { id = result.Value!.Id }, result.Value)
                : Error<TransportRouteResponse>(result);
        });

    [HttpPut("routes/{id:int}")]
    [RequirePermission(PermissionCodes.TransportRouteUpdate)]
    public Task<ActionResult<TransportRouteResponse>> UpdateRoute(
        int id,
        [FromBody] UpdateTransportRouteRequest request,
        CancellationToken cancellationToken) =>
        Guard(nameof(UpdateRoute), async () => Respond(await _transport.UpdateRouteAsync(id, request, cancellationToken)));

    [HttpDelete("routes/{id:int}")]
    [RequirePermission(PermissionCodes.TransportRouteDelete)]
    public Task<IActionResult> DeleteRoute(int id, CancellationToken cancellationToken) =>
        GuardAction(nameof(DeleteRoute), async () => Deleted(await _transport.DeleteRouteAsync(id, cancellationToken)));

    [HttpPost("routes/{id:int}/restore")]
    [RequirePermission(PermissionCodes.TransportRouteRestore)]
    public Task<ActionResult<TransportRouteResponse>> RestoreRoute(int id, CancellationToken cancellationToken) =>
        Guard(nameof(RestoreRoute), async () => Respond(await _transport.RestoreRouteAsync(id, cancellationToken)));

    [HttpPost("stops")]
    [RequirePermission(PermissionCodes.TransportStopCreate)]
    public Task<ActionResult<TransportStopResponse>> CreateStop(
        [FromBody] CreateTransportStopRequest request,
        CancellationToken cancellationToken) =>
        Guard<TransportStopResponse>(nameof(CreateStop), async () =>
        {
            var result = await _transport.CreateStopAsync(request, cancellationToken);
            return result.IsSuccess ? StatusCode(StatusCodes.Status201Created, result.Value) : Error<TransportStopResponse>(result);
        });

    [HttpPut("stops/{id:int}")]
    [RequirePermission(PermissionCodes.TransportStopUpdate)]
    public Task<ActionResult<TransportStopResponse>> UpdateStop(
        int id,
        [FromBody] UpdateTransportStopRequest request,
        CancellationToken cancellationToken) =>
        Guard(nameof(UpdateStop), async () => Respond(await _transport.UpdateStopAsync(id, request, cancellationToken)));

    [HttpDelete("stops/{id:int}")]
    [RequirePermission(PermissionCodes.TransportStopDelete)]
    public Task<IActionResult> DeleteStop(int id, CancellationToken cancellationToken) =>
        GuardAction(nameof(DeleteStop), async () => Deleted(await _transport.DeleteStopAsync(id, cancellationToken)));

    [HttpPost("stops/{id:int}/restore")]
    [RequirePermission(PermissionCodes.TransportStopRestore)]
    public Task<ActionResult<TransportStopResponse>> RestoreStop(int id, CancellationToken cancellationToken) =>
        Guard(nameof(RestoreStop), async () => Respond(await _transport.RestoreStopAsync(id, cancellationToken)));

    [HttpPut("routes/{routeId:int}/stops/order")]
    [RequirePermission(PermissionCodes.TransportRouteReorder)]
    public Task<ActionResult<IReadOnlyList<TransportStopResponse>>> ReorderStops(
        int routeId,
        [FromBody] ReorderTransportStopsRequest request,
        CancellationToken cancellationToken) =>
        Guard(nameof(ReorderStops), async () => Respond(await _transport.ReorderStopsAsync(routeId, request, cancellationToken)));

    private ActionResult<T> Respond<T>(ServiceResult<T> result) =>
        result.IsSuccess ? Ok(result.Value!) : Error<T>(result);

    private IActionResult Deleted(ServiceResult<int> result) =>
        result.IsSuccess ? NoContent() : Error<int>(result);

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
