using StajProject.Application.Common;
using StajProject.Application.DTOs;

namespace StajProject.Application.Interfaces;

public interface ITransportService
{
    Task<ServiceResult<IReadOnlyList<TransportRouteResponse>>> GetRoutesAsync(CancellationToken cancellationToken = default);
    Task<ServiceResult<TransportRouteResponse>> GetRouteAsync(int id, CancellationToken cancellationToken = default);
    Task<ServiceResult<TransportRoutePathResponse>> GetRoutePathAsync(int routeId, CancellationToken cancellationToken = default);
    Task<ServiceResult<IReadOnlyList<TransportRouteMapPathResponse>>> GetRoutePathsAsync(CancellationToken cancellationToken = default);
    Task<ServiceResult<IReadOnlyList<TransportStopResponse>>> GetRouteStopsAsync(int routeId, CancellationToken cancellationToken = default);
    Task<ServiceResult<IReadOnlyList<TransportStopResponse>>> GetStopsAsync(CancellationToken cancellationToken = default);
    Task<ServiceResult<IReadOnlyList<TransportStopResponse>>> GetDeletedStopsAsync(CancellationToken cancellationToken = default);
    Task<ServiceResult<IReadOnlyList<TransportStopResponse>>> GetOwnStopsAsync(CancellationToken cancellationToken = default);
    Task<ServiceResult<IReadOnlyList<TransportRouteResponse>>> GetRouteTrashAsync(CancellationToken cancellationToken = default);
    Task<ServiceResult<IReadOnlyList<TransportStopResponse>>> GetStopTrashAsync(CancellationToken cancellationToken = default);

    Task<ServiceResult<TransportRouteResponse>> CreateRouteAsync(CreateTransportRouteRequest request, CancellationToken cancellationToken = default);
    Task<ServiceResult<TransportRouteResponse>> UpdateRouteAsync(int id, UpdateTransportRouteRequest request, CancellationToken cancellationToken = default);
    Task<ServiceResult<int>> DeleteRouteAsync(int id, CancellationToken cancellationToken = default);
    Task<ServiceResult<TransportRouteResponse>> RestoreRouteAsync(int id, CancellationToken cancellationToken = default);
    Task<ServiceResult<TransportRoutePathResponse>> GenerateRoutePathAsync(int routeId, CancellationToken cancellationToken = default);

    Task<ServiceResult<TransportStopResponse>> CreateStopAsync(CreateTransportStopRequest request, CancellationToken cancellationToken = default);
    Task<ServiceResult<TransportStopResponse>> UpdateStopAsync(int id, UpdateTransportStopRequest request, CancellationToken cancellationToken = default);
    Task<ServiceResult<int>> DeleteStopAsync(int id, CancellationToken cancellationToken = default);
    Task<ServiceResult<TransportStopResponse>> RestoreStopAsync(int id, CancellationToken cancellationToken = default);
    Task<ServiceResult<IReadOnlyList<TransportStopResponse>>> ReorderStopsAsync(int routeId, ReorderTransportStopsRequest request, CancellationToken cancellationToken = default);
}
