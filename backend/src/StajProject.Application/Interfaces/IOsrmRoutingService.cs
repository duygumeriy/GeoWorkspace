using StajProject.Application.Common;
using StajProject.Application.Routing;

namespace StajProject.Application.Interfaces;

public interface IOsrmRoutingService
{
    Task<ServiceResult<OsrmRouteResult>> RouteAsync(
        OsrmRouteRequest request,
        CancellationToken cancellationToken = default);
}
