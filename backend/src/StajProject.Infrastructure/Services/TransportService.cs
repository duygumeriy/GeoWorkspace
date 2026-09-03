using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO;
using StajProject.Application.Common;
using StajProject.Application.Activity;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Routing;
using StajProject.Application.Simulation;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

public sealed class TransportService : ITransportService
{
    private const int Srid = 4326;
    private const double CoordinateEpsilon = 1e-9;
    private const string RouteNotFoundMessage = "Ulaşım rotası bulunamadı veya kullanımda değil.";
    private const string StopNotFoundMessage = "Ulaşım durağı bulunamadı veya kullanımda değil.";
    private const string OutsideAreaMessage = "Bu alanda ulaşım durağı yazma yetkiniz bulunmuyor.";
    private const string PathNotFoundMessage = "Bu güzergah için henüz hesaplanmış bir rota bulunmuyor.";
    private const string MinimumStopsMessage = "Rota oluşturmak için en az iki aktif durak gereklidir.";
    private const string RouteCalculationFailedMessage = RouteGenerationMessages.Unknown;
    private const string TopologyChangedMessage = "Duraklar rota hesaplanırken değişti. Lütfen yeniden deneyin.";

    private static readonly Regex ColorHexPattern = new(
        "^#[0-9A-Fa-f]{6}$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly WKTWriter WktWriter = new();

    private readonly AppDbContext _dbContext;
    private readonly ICurrentUserService _currentUser;
    private readonly IGeographicAuthorizationService _geographicAuthorization;
    private readonly IOsrmRoutingService _osrmRouting;
    private readonly TransportActivityContext? _transportActivity;

    /* Simülasyon tarafı OPSİYONEL bir bağımlılıktır: ulaşım CRUD'u, canlı
       simülasyon hiç kayıtlı olmasa da (ve mevcut testlerde olduğu gibi)
       eksiksiz çalışmalıdır. Servis yalnızca "bu rotanın otoriter güzergahı
       artık geçerli değil" olgusunu BİLDİRİR; durdurma ve yayın kararının
       sahibi simülasyon tarafıdır. */
    private readonly ITransportSimulationCanceller? _simulationCanceller;

    public TransportService(
        AppDbContext dbContext,
        ICurrentUserService currentUser,
        IGeographicAuthorizationService geographicAuthorization,
        IOsrmRoutingService osrmRouting,
        TransportActivityContext? transportActivity = null,
        ITransportSimulationCanceller? simulationCanceller = null)
    {
        _dbContext = dbContext;
        _currentUser = currentUser;
        _geographicAuthorization = geographicAuthorization;
        _osrmRouting = osrmRouting;
        _transportActivity = transportActivity;
        _simulationCanceller = simulationCanceller;
    }

    public async Task<ServiceResult<IReadOnlyList<TransportRouteResponse>>> GetRoutesAsync(
        CancellationToken cancellationToken = default)
    {
        var routes = await VisibleRouteProjection()
            .OrderBy(route => route.Name)
            .ThenBy(route => route.Id)
            .ToListAsync(cancellationToken);

        return ServiceResult<IReadOnlyList<TransportRouteResponse>>.Success(routes);
    }

    public async Task<ServiceResult<TransportRouteResponse>> GetRouteAsync(
        int id,
        CancellationToken cancellationToken = default)
    {
        var route = await VisibleRouteProjection()
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        return route is null
            ? ServiceResult<TransportRouteResponse>.NotFound(RouteNotFoundMessage)
            : ServiceResult<TransportRouteResponse>.Success(route);
    }

    public async Task<ServiceResult<TransportRoutePathResponse>> GetRoutePathAsync(
        int routeId,
        CancellationToken cancellationToken = default)
    {
        if (!await _dbContext.TransportRoutes.AnyAsync(route => route.Id == routeId, cancellationToken))
        {
            return ServiceResult<TransportRoutePathResponse>.NotFound(RouteNotFoundMessage);
        }

        var path = await _dbContext.TransportRoutePaths
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.RouteId == routeId, cancellationToken);

        return path is null
            ? ServiceResult<TransportRoutePathResponse>.NotFound(PathNotFoundMessage)
            : ServiceResult<TransportRoutePathResponse>.Success(ToPathResponse(path));
    }

    public async Task<ServiceResult<IReadOnlyList<TransportRouteMapPathResponse>>> GetRoutePathsAsync(
        CancellationToken cancellationToken = default)
    {
        var records = await _dbContext.TransportRoutePaths
            .AsNoTracking()
            .OrderBy(path => path.RouteId)
            .Select(path => new
            {
                Path = path,
                RouteName = path.Route != null ? path.Route.Name : string.Empty,
                ColorHex = path.Route != null ? path.Route.ColorHex : string.Empty
            })
            .ToListAsync(cancellationToken);

        var response = records.Select(record => new TransportRouteMapPathResponse
        {
            Id = record.Path.Id,
            RouteId = record.Path.RouteId,
            RouteName = record.RouteName,
            ColorHex = record.ColorHex,
            GeometryWkt = WktWriter.Write(record.Path.Geometry),
            DistanceMeters = record.Path.DistanceMeters,
            DurationSeconds = record.Path.DurationSeconds,
            GeneratedAt = record.Path.GeneratedAt,
            IsStale = record.Path.IsStale,
            LastFailureReason = record.Path.LastFailureReason
        }).ToList();

        return ServiceResult<IReadOnlyList<TransportRouteMapPathResponse>>.Success(response);
    }

    public async Task<ServiceResult<IReadOnlyList<TransportStopResponse>>> GetRouteStopsAsync(
        int routeId,
        CancellationToken cancellationToken = default)
    {
        if (!await _dbContext.TransportRoutes
                .IgnoreQueryFilters()
                .AnyAsync(route => route.Id == routeId && !route.IsDeleted, cancellationToken))
        {
            return ServiceResult<IReadOnlyList<TransportStopResponse>>.NotFound(RouteNotFoundMessage);
        }

        var stops = await VisibleStopProjection()
            .Where(stop => stop.RouteId == routeId)
            .OrderBy(stop => stop.SequenceOrder)
            .ThenBy(stop => stop.Id)
            .ToListAsync(cancellationToken);

        return ServiceResult<IReadOnlyList<TransportStopResponse>>.Success(stops);
    }

    public async Task<ServiceResult<IReadOnlyList<TransportStopResponse>>> GetStopsAsync(
        CancellationToken cancellationToken = default)
    {
        var stops = await VisibleStopProjection()
            .Where(stop => _dbContext.TransportRoutes.Any(route => route.Id == stop.RouteId))
            .OrderBy(stop => stop.RouteName)
            .ThenBy(stop => stop.RouteId)
            .ThenBy(stop => stop.SequenceOrder)
            .ThenBy(stop => stop.Id)
            .ToListAsync(cancellationToken);

        return ServiceResult<IReadOnlyList<TransportStopResponse>>.Success(stops);
    }

    public async Task<ServiceResult<IReadOnlyList<TransportStopResponse>>> GetDeletedStopsAsync(
        CancellationToken cancellationToken = default)
    {
        var stops = await _dbContext.TransportStops
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(stop => stop.IsDeleted && stop.Route != null && stop.Route.IsActive && !stop.Route.IsDeleted)
            .Select(stop => new TransportStopResponse
            {
                Id = stop.Id,
                RouteId = stop.RouteId,
                RouteName = stop.Route != null ? stop.Route.Name : string.Empty,
                RouteColor = stop.Route != null ? stop.Route.ColorHex : string.Empty,
                Name = stop.Name,
                Longitude = stop.Coordinate.X,
                Latitude = stop.Coordinate.Y,
                SequenceOrder = stop.SequenceOrder,
                IsActive = stop.IsActive,
                IsDeleted = true,
                CreatedDate = stop.CreatedDate,
                ModifiedDate = stop.ModifiedDate
            })
            .OrderBy(stop => stop.RouteName)
            .ThenBy(stop => stop.RouteId)
            .ThenByDescending(stop => stop.ModifiedDate)
            .ThenBy(stop => stop.Id)
            .ToListAsync(cancellationToken);

        return ServiceResult<IReadOnlyList<TransportStopResponse>>.Success(stops);
    }

    public async Task<ServiceResult<IReadOnlyList<TransportStopResponse>>> GetOwnStopsAsync(
        CancellationToken cancellationToken = default)
    {
        var userId = _currentUser.UserId;
        if (userId is null)
        {
            return ServiceResult<IReadOnlyList<TransportStopResponse>>.Success([]);
        }

        var stops = await _dbContext.TransportStops
            .AsNoTracking()
            .Where(stop => stop.UserId == userId.Value
                && stop.Route != null
                && stop.Route.IsActive
                && !stop.Route.IsDeleted)
            .Select(stop => new TransportStopResponse
            {
                Id = stop.Id,
                RouteId = stop.RouteId,
                RouteName = stop.Route != null ? stop.Route.Name : string.Empty,
                RouteColor = stop.Route != null ? stop.Route.ColorHex : string.Empty,
                Name = stop.Name,
                Longitude = stop.Coordinate.X,
                Latitude = stop.Coordinate.Y,
                SequenceOrder = stop.SequenceOrder,
                IsActive = stop.IsActive,
                IsDeleted = false,
                CreatedDate = stop.CreatedDate,
                ModifiedDate = stop.ModifiedDate
            })
            .OrderBy(stop => stop.Name)
            .ThenBy(stop => stop.Id)
            .ToListAsync(cancellationToken);

        return ServiceResult<IReadOnlyList<TransportStopResponse>>.Success(stops);
    }

    public async Task<ServiceResult<IReadOnlyList<TransportRouteResponse>>> GetRouteTrashAsync(
        CancellationToken cancellationToken = default)
    {
        var routes = await _dbContext.TransportRoutes
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(route => route.IsDeleted)
            .Select(route => new TransportRouteResponse
            {
                Id = route.Id,
                Name = route.Name,
                ColorHex = route.ColorHex,
                StopCount = route.Stops.Count(stop => stop.IsActive && !stop.IsDeleted),
                IsActive = route.IsActive,
                CreatedDate = route.CreatedDate,
                ModifiedDate = route.ModifiedDate
            })
            .OrderByDescending(route => route.ModifiedDate)
            .ThenBy(route => route.Id)
            .ToListAsync(cancellationToken);

        return ServiceResult<IReadOnlyList<TransportRouteResponse>>.Success(routes);
    }

    public async Task<ServiceResult<IReadOnlyList<TransportStopResponse>>> GetStopTrashAsync(
        CancellationToken cancellationToken = default)
    {
        var userId = _currentUser.UserId;
        if (userId is null)
        {
            return ServiceResult<IReadOnlyList<TransportStopResponse>>.Success([]);
        }

        var stops = await _dbContext.TransportStops
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(stop => stop.IsDeleted && stop.UserId == userId.Value)
            .Select(stop => new TransportStopResponse
            {
                Id = stop.Id,
                RouteId = stop.RouteId,
                RouteName = stop.Route != null ? stop.Route.Name : string.Empty,
                RouteColor = stop.Route != null ? stop.Route.ColorHex : string.Empty,
                Name = stop.Name,
                Longitude = stop.Coordinate.X,
                Latitude = stop.Coordinate.Y,
                SequenceOrder = stop.SequenceOrder,
                IsActive = stop.IsActive,
                IsDeleted = true,
                CreatedDate = stop.CreatedDate,
                ModifiedDate = stop.ModifiedDate
            })
            .OrderByDescending(stop => stop.ModifiedDate)
            .ThenBy(stop => stop.Id)
            .ToListAsync(cancellationToken);

        return ServiceResult<IReadOnlyList<TransportStopResponse>>.Success(stops);
    }

    public async Task<ServiceResult<TransportRouteResponse>> CreateRouteAsync(
        CreateTransportRouteRequest request,
        CancellationToken cancellationToken = default)
    {
        var validated = ValidateRoute(request?.Name, request?.ColorHex);

        if (!validated.IsSuccess)
        {
            return ServiceResult<TransportRouteResponse>.Failure(validated.Error!);
        }

        var route = new TransportRoute
        {
            Name = validated.Value.Name,
            ColorHex = validated.Value.ColorHex,
            IsActive = true,
            IsDeleted = false,
            CreatedDate = DateTime.UtcNow
        };

        _dbContext.TransportRoutes.Add(route);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return ServiceResult<TransportRouteResponse>.Success(ToRouteResponse(route, 0));
    }

    public async Task<ServiceResult<TransportRouteResponse>> UpdateRouteAsync(
        int id,
        UpdateTransportRouteRequest request,
        CancellationToken cancellationToken = default)
    {
        var route = await _dbContext.TransportRoutes
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.Id == id && !item.IsDeleted, cancellationToken);

        if (route is null)
        {
            return ServiceResult<TransportRouteResponse>.NotFound(RouteNotFoundMessage);
        }

        var validated = ValidateRoute(request?.Name, request?.ColorHex);

        if (!validated.IsSuccess)
        {
            return ServiceResult<TransportRouteResponse>.Failure(validated.Error!);
        }

        route.Name = validated.Value.Name;
        route.ColorHex = validated.Value.ColorHex;
        await _dbContext.SaveChangesAsync(cancellationToken);

        var stopCount = await _dbContext.TransportStops
            .IgnoreQueryFilters()
            .CountAsync(stop => stop.RouteId == id && stop.IsActive && !stop.IsDeleted, cancellationToken);
        return ServiceResult<TransportRouteResponse>.Success(ToRouteResponse(route, stopCount));
    }

    public async Task<ServiceResult<int>> DeleteRouteAsync(int id, CancellationToken cancellationToken = default)
    {
        var route = await _dbContext.TransportRoutes
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.Id == id && !item.IsDeleted, cancellationToken);

        if (route is null)
        {
            return ServiceResult<int>.NotFound(RouteNotFoundMessage);
        }

        route.IsDeleted = true;
        await _dbContext.SaveChangesAsync(cancellationToken);
        return ServiceResult<int>.Success(id);
    }

    public async Task<ServiceResult<TransportRouteResponse>> RestoreRouteAsync(
        int id,
        CancellationToken cancellationToken = default)
    {
        var route = await _dbContext.TransportRoutes
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.Id == id && item.IsDeleted, cancellationToken);

        if (route is null)
        {
            return ServiceResult<TransportRouteResponse>.NotFound("Silinmiş ulaşım rotası bulunamadı.");
        }

        route.IsDeleted = false;
        await _dbContext.SaveChangesAsync(cancellationToken);

        var stopCount = await _dbContext.TransportStops
            .IgnoreQueryFilters()
            .CountAsync(stop => stop.RouteId == id && stop.IsActive && !stop.IsDeleted, cancellationToken);

        return ServiceResult<TransportRouteResponse>.Success(ToRouteResponse(route, stopCount));
    }

    public async Task<ServiceResult<TransportRoutePathResponse>> GenerateRoutePathAsync(
        int routeId,
        CancellationToken cancellationToken = default)
    {
        if (_transportActivity is not null) _transportActivity.Outcome = null;
        var result = await GenerateRoutePathCoreAsync(routeId, requireExistingPath: false, cancellationToken: cancellationToken);
        var routeName = await _dbContext.TransportRoutes
            .IgnoreQueryFilters()
            .Where(route => route.Id == routeId)
            .Select(route => route.Name)
            .FirstOrDefaultAsync(cancellationToken);
        if (_transportActivity is not null)
        {
            _transportActivity.Outcome = new TransportActivityOutcome(
                TransportActivityKind.RouteGeneration,
                RouteId: routeId,
                RouteName: routeName,
                RouteGenerated: result.IsSuccess,
                DistanceMeters: result.Value?.DistanceMeters,
                DurationSeconds: result.Value?.DurationSeconds);
        }
        return result;
    }

    public async Task<ServiceResult<TransportStopResponse>> CreateStopAsync(
        CreateTransportStopRequest request,
        CancellationToken cancellationToken = default)
    {
        var validated = ValidateStop(request?.Name, request?.RouteId ?? 0, request?.Longitude ?? double.NaN, request?.Latitude ?? double.NaN);

        if (!validated.IsSuccess)
        {
            return ServiceResult<TransportStopResponse>.Failure(validated.Error!);
        }

        var route = await _dbContext.TransportRoutes
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == validated.Value.RouteId, cancellationToken);

        if (route is null)
        {
            return ServiceResult<TransportStopResponse>.Failure(RouteNotFoundMessage);
        }

        var point = CreatePoint(validated.Value.Longitude, validated.Value.Latitude);
        var owner = RequireOwnerId();
        if (!owner.IsSuccess)
        {
            return ServiceResult<TransportStopResponse>.Forbidden(owner.Error!);
        }

        var authorized = await AuthorizeCoordinateAsync(point, cancellationToken);

        if (!authorized.IsSuccess)
        {
            return ServiceResult<TransportStopResponse>.Forbidden(authorized.Error!);
        }

        var maxOrder = await _dbContext.TransportStops
            .Where(stop => stop.RouteId == route.Id)
            .Select(stop => (int?)stop.SequenceOrder)
            .MaxAsync(cancellationToken) ?? 0;

        var stop = new TransportStop
        {
            RouteId = route.Id,
            UserId = owner.Value,
            Name = validated.Value.Name,
            Coordinate = point,
            SequenceOrder = maxOrder + 1,
            IsActive = true,
            IsDeleted = false,
            CreatedDate = DateTime.UtcNow
        };

        _dbContext.TransportStops.Add(stop);
        await MarkRoutePathsStaleAsync([route.Id], cancellationToken);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return ServiceResult<TransportStopResponse>.Success(ToStopResponse(stop, route.Name));
    }

    public async Task<ServiceResult<TransportStopResponse>> UpdateStopAsync(
        int id,
        UpdateTransportStopRequest request,
        CancellationToken cancellationToken = default)
    {
        if (_transportActivity is not null) _transportActivity.Outcome = null;
        var stop = await _dbContext.TransportStops.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (stop is null)
        {
            return ServiceResult<TransportStopResponse>.NotFound(StopNotFoundMessage);
        }

        var validated = ValidateStop(request?.Name, request?.RouteId ?? 0, request?.Longitude ?? double.NaN, request?.Latitude ?? double.NaN);

        if (!validated.IsSuccess)
        {
            return ServiceResult<TransportStopResponse>.Failure(validated.Error!);
        }

        var routeChanged = stop.RouteId != validated.Value.RouteId;
        var destinationQuery = _dbContext.TransportRoutes.AsNoTracking();
        if (!routeChanged)
        {
            destinationQuery = destinationQuery.IgnoreQueryFilters().Where(route => !route.IsDeleted);
        }

        var destination = await destinationQuery
            .FirstOrDefaultAsync(route => route.Id == validated.Value.RouteId, cancellationToken);

        if (destination is null)
        {
            return ServiceResult<TransportStopResponse>.Failure(RouteNotFoundMessage);
        }

        var coordinateChanged = HasMoved(stop.Coordinate, validated.Value.Longitude, validated.Value.Latitude);
        Point? targetPoint = null;

        if (coordinateChanged)
        {
            targetPoint = CreatePoint(validated.Value.Longitude, validated.Value.Latitude);
            var authorized = await AuthorizeCoordinateAsync(targetPoint, cancellationToken);

            if (!authorized.IsSuccess)
            {
                return ServiceResult<TransportStopResponse>.Forbidden(authorized.Error!);
            }
        }

        var oldRouteId = stop.RouteId;

        if (!routeChanged)
        {
            stop.Name = validated.Value.Name;
            if (targetPoint is not null)
            {
                stop.Coordinate = targetPoint;
                await MarkRoutePathsStaleAsync([stop.RouteId], cancellationToken);
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
            var response = ToStopResponse(stop, destination.Name);
            if (_transportActivity is not null)
            {
                _transportActivity.Outcome = new TransportActivityOutcome(
                    coordinateChanged ? TransportActivityKind.StopCoordinateMove : TransportActivityKind.StopUpdate,
                    RouteId: stop.RouteId,
                    RouteName: destination.Name,
                    StopId: stop.Id,
                    StopName: stop.Name,
                    CoordinateChanged: coordinateChanged);
            }
            return ServiceResult<TransportStopResponse>.Success(response);
        }

        var sourceRouteName = await _dbContext.TransportRoutes
            .IgnoreQueryFilters()
            .Where(route => route.Id == oldRouteId)
            .Select(route => route.Name)
            .FirstOrDefaultAsync(cancellationToken);

        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var destinationMax = await _dbContext.TransportStops
            .Where(item => item.RouteId == destination.Id)
            .Select(item => (int?)item.SequenceOrder)
            .MaxAsync(cancellationToken) ?? 0;

        await CompactRouteAsync(oldRouteId, id, cancellationToken);

        stop.Name = validated.Value.Name;
        stop.RouteId = destination.Id;
        stop.SequenceOrder = destinationMax + 1;
        if (targetPoint is not null)
        {
            stop.Coordinate = targetPoint;
        }

        await MarkRoutePathsStaleAsync([oldRouteId, destination.Id], cancellationToken);

        await _dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        var transferred = ToStopResponse(stop, destination.Name);
        if (_transportActivity is not null)
        {
            _transportActivity.Outcome = new TransportActivityOutcome(
                TransportActivityKind.StopTransfer,
                RouteId: destination.Id,
                RouteName: destination.Name,
                StopId: stop.Id,
                StopName: stop.Name,
                SourceRouteId: oldRouteId,
                SourceRouteName: sourceRouteName,
                DestinationRouteId: destination.Id,
                DestinationRouteName: destination.Name,
                CoordinateChanged: coordinateChanged);
        }
        return ServiceResult<TransportStopResponse>.Success(transferred);
    }

    public async Task<ServiceResult<int>> DeleteStopAsync(int id, CancellationToken cancellationToken = default)
    {
        var stop = await _dbContext.TransportStops.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (stop is null)
        {
            return ServiceResult<int>.NotFound(StopNotFoundMessage);
        }

        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        stop.IsDeleted = true;
        await CompactRouteAsync(stop.RouteId, stop.Id, cancellationToken);
        await MarkRoutePathsStaleAsync([stop.RouteId], cancellationToken);
        await _dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return ServiceResult<int>.Success(id);
    }

    public async Task<ServiceResult<TransportStopResponse>> RestoreStopAsync(
        int id,
        CancellationToken cancellationToken = default)
    {
        var stop = await _dbContext.TransportStops
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(item => item.Id == id && item.IsDeleted, cancellationToken);

        if (stop is null)
        {
            return ServiceResult<TransportStopResponse>.NotFound("Silinmiş ulaşım durağı bulunamadı.");
        }

        var route = await _dbContext.TransportRoutes
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == stop.RouteId, cancellationToken);

        if (route is null)
        {
            return ServiceResult<TransportStopResponse>.Conflict("Durağın bağlı olduğu rota silinmiş veya kullanım dışıdır.");
        }

        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        var maxOrder = await _dbContext.TransportStops
            .Where(item => item.RouteId == route.Id)
            .Select(item => (int?)item.SequenceOrder)
            .MaxAsync(cancellationToken) ?? 0;

        stop.IsDeleted = false;
        stop.SequenceOrder = maxOrder + 1;
        await MarkRoutePathsStaleAsync([stop.RouteId], cancellationToken);
        await _dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return ServiceResult<TransportStopResponse>.Success(ToStopResponse(stop, route.Name));
    }

    public async Task<ServiceResult<IReadOnlyList<TransportStopResponse>>> ReorderStopsAsync(
        int routeId,
        ReorderTransportStopsRequest request,
        CancellationToken cancellationToken = default)
    {
        if (_transportActivity is not null) _transportActivity.Outcome = null;
        if (request?.StopIds is null)
        {
            return ServiceResult<IReadOnlyList<TransportStopResponse>>.Failure("stopIds alanı zorunludur.");
        }

        if (request.StopIds.Count != request.StopIds.Distinct().Count())
        {
            return ServiceResult<IReadOnlyList<TransportStopResponse>>.Failure("stopIds tekrarlanan kimlik içeremez.");
        }

        var route = await _dbContext.TransportRoutes
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == routeId, cancellationToken);

        if (route is null)
        {
            return ServiceResult<IReadOnlyList<TransportStopResponse>>.NotFound(RouteNotFoundMessage);
        }

        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        var stops = await _dbContext.TransportStops
            .Where(stop => stop.RouteId == routeId)
            .ToListAsync(cancellationToken);

        var activeIds = stops.Select(stop => stop.Id).ToHashSet();
        if (request.StopIds.Count != activeIds.Count || request.StopIds.Any(id => !activeIds.Contains(id)))
        {
            return ServiceResult<IReadOnlyList<TransportStopResponse>>.Failure(
                "stopIds, rotanın tüm aktif duraklarını eksiksiz ve fazlasız içermelidir.");
        }

        var byId = stops.ToDictionary(stop => stop.Id);
        for (var index = 0; index < request.StopIds.Count; index++)
        {
            byId[request.StopIds[index]].SequenceOrder = index + 1;
        }

        var pathExists = await MarkRoutePathsStaleAsync([routeId], cancellationToken);
        await _dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        ServiceResult<TransportRoutePathResponse>? regeneration = null;
        if (pathExists)
        {
            // Sıralama iş verisidir ve yukarıda kalıcılaştırılmıştır. OSRM
            // başarısızlığı bu değişikliği geri almaz; path stale kalır.
            regeneration = await GenerateRoutePathCoreAsync(routeId, requireExistingPath: true, cancellationToken: cancellationToken);
        }

        var response = request.StopIds
            .Select(id => ToStopResponse(byId[id], route.Name))
            .ToList();

        if (_transportActivity is not null)
        {
            _transportActivity.Outcome = new TransportActivityOutcome(
                TransportActivityKind.StopReorder,
                RouteId: routeId,
                RouteName: route.Name,
                OrderedStopIds: request.StopIds,
                RouteGenerated: regeneration?.IsSuccess);
        }

        return ServiceResult<IReadOnlyList<TransportStopResponse>>.Success(response);
    }

    private async Task<ServiceResult<TransportRoutePathResponse>> GenerateRoutePathCoreAsync(
        int routeId,
        bool requireExistingPath,
        CancellationToken cancellationToken)
    {
        if (!await _dbContext.TransportRoutes.AnyAsync(route => route.Id == routeId, cancellationToken))
        {
            return ServiceResult<TransportRoutePathResponse>.NotFound(RouteNotFoundMessage);
        }

        var snapshot = await LoadTopologySnapshotAsync(routeId, cancellationToken);
        var existingPath = await _dbContext.TransportRoutePaths
            .FirstOrDefaultAsync(path => path.RouteId == routeId, cancellationToken);

        if (requireExistingPath && existingPath is null)
        {
            return ServiceResult<TransportRoutePathResponse>.NotFound(PathNotFoundMessage);
        }

        if (snapshot.Count < 2)
        {
            if (existingPath is not null)
            {
                await PersistRoutePathFailureAsync(existingPath, MinimumStopsMessage, cancellationToken);
            }

            return ServiceResult<TransportRoutePathResponse>.Failure(MinimumStopsMessage);
        }

        if (existingPath is not null)
        {
            existingPath.IsStale = true;
            existingPath.LastFailureReason = null;
            existingPath.ModifiedDate = DateTime.UtcNow;
            await _dbContext.SaveChangesAsync(cancellationToken);

            /* Yeniden üretim, çalışan bir simülasyonun altındaki geometriyi
               DEĞİŞTİRİR. Bayatlatma anında iptal edilir; üretimin sonucunu
               beklemek, aracı eski güzergahta saniyelerce yürütmek demekti. */
            await CancelSimulationsAsync([existingPath.RouteId], cancellationToken);
        }

        var routing = await _osrmRouting.RouteAsync(
            new OsrmRouteRequest(snapshot
                .Select(stop => new OsrmWaypoint(stop.Longitude, stop.Latitude))
                .ToList()),
            cancellationToken);

        if (!routing.IsSuccess)
        {
            var safeReason = SafeRoutingFailureReason(routing.ErrorKind, routing.Error);
            if (existingPath is not null)
            {
                await PersistRoutePathFailureAsync(existingPath, safeReason, cancellationToken);
            }

            return RoutePathFailure(routing.ErrorKind, safeReason);
        }

        var routeResult = routing.Value!;
        if (!IsValidRoutingResult(routeResult))
        {
            if (existingPath is not null)
            {
                await PersistRoutePathFailureAsync(existingPath, RouteCalculationFailedMessage, cancellationToken);
            }

            return ServiceResult<TransportRoutePathResponse>.Upstream(RouteCalculationFailedMessage);
        }

        var currentSnapshot = await LoadTopologySnapshotAsync(routeId, cancellationToken);
        if (!snapshot.SequenceEqual(currentSnapshot))
        {
            if (existingPath is not null)
            {
                await PersistRoutePathFailureAsync(existingPath, TopologyChangedMessage, cancellationToken);
            }

            return ServiceResult<TransportRoutePathResponse>.Conflict(TopologyChangedMessage);
        }

        // İlk çağrı sürerken başka bir üretim path oluşturmuş olabilir. Tekil
        // RouteId kısıtına çarpmak yerine mevcut satırı güncelleyip Id'yi korur.
        var path = existingPath ?? await _dbContext.TransportRoutePaths
            .FirstOrDefaultAsync(item => item.RouteId == routeId, cancellationToken);
        var now = DateTime.UtcNow;

        if (path is null)
        {
            path = new TransportRoutePath
            {
                RouteId = routeId
            };
            _dbContext.TransportRoutePaths.Add(path);
        }

        path.Geometry = routeResult.Geometry;
        path.DistanceMeters = routeResult.DistanceMeters;
        path.DurationSeconds = routeResult.DurationSeconds;
        path.Profile = routeResult.Profile;
        path.GeneratedAt = now;
        path.IsStale = false;
        path.LastFailureReason = null;
        path.ModifiedDate = now;

        await ReplaceRoutePathStepsAsync(path, routeResult.Steps, cancellationToken);

        /* GEOMETRİ VE ADIMLAR TEK KAYIT İŞLEMİNDE yazılır. İki ayrı
           SaveChanges, aradaki pencerede "yeni geometri + eski adımlar" (ya da
           tersi) bırakırdı: o an başlatılan bir simülasyon, işlettiği yola ait
           OLMAYAN talimatlar gösterirdi. */
        await _dbContext.SaveChangesAsync(cancellationToken);
        return ServiceResult<TransportRoutePathResponse>.Success(ToPathResponse(path));
    }

    /// <summary>
    /// Yolun manevra adımlarını TAMAMEN değiştirir: eskiler silinir, yenileri
    /// eklenir.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Birleştirme (upsert) YAPILMAZ ve bu kasıtlıdır.</b> Yeni güzergah
    /// eskisinden farklı sayıda ve farklı sınırlı adımlar taşır; sıra
    /// numarasına göre eşleyip güncellemek, kalan eski adımların sessizce
    /// hayatta kalmasına ve yeni geometriyle uyuşmayan sınırlar taşımasına
    /// açık kapı bırakırdı. Tam değiştirme, "adımlar daima bu geometriye
    /// aittir" değişmezini tek adımda korur.
    /// </para>
    /// <para>
    /// Yazma yapılmaz: değişiklikler çağıranın TEK <c>SaveChangesAsync</c>'ine
    /// bırakılır, böylece geometri ile adımlar aynı işlemde kalır.
    /// </para>
    /// </remarks>
    private async Task ReplaceRoutePathStepsAsync(
        TransportRoutePath path,
        IReadOnlyList<OsrmRouteStep> steps,
        CancellationToken cancellationToken)
    {
        /* Yeni bir yol satırında (Id henüz 0) silinecek bir şey yoktur ve
           sorgu da çalıştırılmaz. */
        if (path.Id != 0)
        {
            var existing = await _dbContext.TransportRoutePathSteps
                .IgnoreQueryFilters()
                .Where(step => step.PathId == path.Id)
                .ToListAsync(cancellationToken);

            if (existing.Count > 0)
            {
                _dbContext.TransportRoutePathSteps.RemoveRange(existing);
            }
        }

        path.Steps.Clear();

        foreach (var step in steps)
        {
            path.Steps.Add(new TransportRoutePathStep
            {
                Sequence = step.Sequence,
                ManeuverType = Truncate(step.ManeuverType, TransportRoutePathStep.MaxManeuverTypeLength)!,
                ManeuverModifier = Truncate(step.ManeuverModifier, TransportRoutePathStep.MaxManeuverModifierLength),
                /* Motor çok uzun bir yol adı verebilir; kısaltmak talimatı
                   bozmaz ama sütun sınırını aşmak tüm güzergah üretimini
                   düşürürdü. */
                Name = Truncate(step.Name, TransportRoutePathStep.MaxNameLength),
                DistanceMeters = step.DistanceMeters,
                DurationSeconds = step.DurationSeconds,
                StartDistanceMeters = step.StartDistanceMeters,
                EndDistanceMeters = step.EndDistanceMeters
            });
        }
    }

    private static string? Truncate(string? value, int maxLength) =>
        value is { Length: > 0 } text
            ? (text.Length <= maxLength ? text : text[..maxLength])
            : null;

    private Task<List<StopTopologySnapshot>> LoadTopologySnapshotAsync(
        int routeId,
        CancellationToken cancellationToken) =>
        _dbContext.TransportStops
            .AsNoTracking()
            .Where(stop => stop.RouteId == routeId)
            .OrderBy(stop => stop.SequenceOrder)
            .ThenBy(stop => stop.Id)
            .Select(stop => new StopTopologySnapshot(
                stop.Id,
                stop.SequenceOrder,
                stop.Coordinate.X,
                stop.Coordinate.Y))
            .ToListAsync(cancellationToken);

    private async Task<bool> MarkRoutePathsStaleAsync(
        IReadOnlyCollection<int> routeIds,
        CancellationToken cancellationToken)
    {
        var distinctRouteIds = routeIds.Distinct().ToArray();
        var paths = await _dbContext.TransportRoutePaths
            .IgnoreQueryFilters()
            .Where(path => distinctRouteIds.Contains(path.RouteId))
            .ToListAsync(cancellationToken);

        var now = DateTime.UtcNow;
        foreach (var path in paths)
        {
            path.IsStale = true;
            path.LastFailureReason = null;
            path.ModifiedDate = now;
        }

        await CancelSimulationsAsync(paths.Select(path => path.RouteId), cancellationToken);

        return paths.Count > 0;
    }

    private async Task PersistRoutePathFailureAsync(
        TransportRoutePath path,
        string safeReason,
        CancellationToken cancellationToken)
    {
        path.IsStale = true;
        path.LastFailureReason = safeReason.Length <= TransportRoutePath.MaxFailureReasonLength
            ? safeReason
            : safeReason[..TransportRoutePath.MaxFailureReasonLength];
        path.ModifiedDate = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync(cancellationToken);
        await CancelSimulationsAsync([path.RouteId], cancellationToken);
    }

    /// <summary>
    /// Otoriter güzergahın artık geçerli olmadığını simülasyon tarafına bildirir.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Tek bildirim noktası.</b> Çağrılar yalnızca yolun BAYATLADIĞI ya da
    /// DEĞİŞTİĞİ üç yerden gelir: topoloji değişiminde toplu bayatlatma
    /// (<see cref="MarkRoutePathsStaleAsync"/>), üretim hatasının kalıcılaştığı
    /// yer (<see cref="PersistRoutePathFailureAsync"/>) ve yeniden üretimin
    /// mevcut yolu geçersiz kıldığı an. Controller'lara ya da tek tek CRUD
    /// metotlarına iptal kodu YAYILMAZ; bu üç yer, yolun bugün mutasyona
    /// uğradığı yerlerin tamamıdır.
    /// </para>
    /// <para>
    /// <b>Yön fail-safe'tir.</b> Bildirim, kaydın kalıcılaşmasından hemen önce
    /// ya da sonra yapılabilir; yarıştaki tek olası hata FAZLADAN bir iptaldir
    /// (yeniden başlatmayla düzelir). Geçersiz geometride devam eden bir araç
    /// ise haritada yanlış bir gerçeklik üretirdi.
    /// </para>
    /// </remarks>
    private Task CancelSimulationsAsync(IEnumerable<int> routeIds, CancellationToken cancellationToken)
    {
        if (_simulationCanceller is null)
        {
            return Task.CompletedTask;
        }

        var affected = routeIds.Distinct().ToArray();

        return affected.Length == 0
            ? Task.CompletedTask
            : _simulationCanceller.CancelForRoutesAsync(affected, cancellationToken);
    }

    private static bool IsValidRoutingResult(OsrmRouteResult result) =>
        result.Geometry is { SRID: Srid, NumPoints: >= 2 }
        && result.Geometry.Coordinates.All(coordinate =>
            double.IsFinite(coordinate.X)
            && coordinate.X is >= -180 and <= 180
            && double.IsFinite(coordinate.Y)
            && coordinate.Y is >= -90 and <= 90)
        && double.IsFinite(result.DistanceMeters)
        && result.DistanceMeters >= 0
        && double.IsFinite(result.DurationSeconds)
        && result.DurationSeconds >= 0
        && !string.IsNullOrWhiteSpace(result.Profile)
        && result.Profile.Length <= TransportRoutePath.MaxProfileLength;

    private static string SafeRoutingFailureReason(ServiceErrorKind errorKind, string? error) => error switch
    {
        RouteGenerationMessages.NoRoute => RouteGenerationMessages.NoRoute,
        RouteGenerationMessages.Timeout => RouteGenerationMessages.Timeout,
        RouteGenerationMessages.Unavailable => RouteGenerationMessages.Unavailable,
        RouteGenerationMessages.Unknown => RouteGenerationMessages.Unknown,
        _ when errorKind == ServiceErrorKind.Timeout => RouteGenerationMessages.Timeout,
        _ => RouteGenerationMessages.Unknown
    };

    private static ServiceResult<TransportRoutePathResponse> RoutePathFailure(
        ServiceErrorKind errorKind,
        string safeReason) => errorKind switch
    {
        ServiceErrorKind.Timeout => ServiceResult<TransportRoutePathResponse>.Timeout(safeReason),
        ServiceErrorKind.Upstream => ServiceResult<TransportRoutePathResponse>.Upstream(safeReason),
        ServiceErrorKind.NotFound => ServiceResult<TransportRoutePathResponse>.NotFound(safeReason),
        ServiceErrorKind.Conflict => ServiceResult<TransportRoutePathResponse>.Conflict(safeReason),
        ServiceErrorKind.Forbidden => ServiceResult<TransportRoutePathResponse>.Forbidden(safeReason),
        _ => ServiceResult<TransportRoutePathResponse>.Failure(safeReason)
    };

    private IQueryable<TransportRouteResponse> VisibleRouteProjection() =>
        _dbContext.TransportRoutes
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(route => !route.IsDeleted)
            .Select(route => new TransportRouteResponse
            {
                Id = route.Id,
                Name = route.Name,
                ColorHex = route.ColorHex,
                StopCount = route.Stops.Count(stop => stop.IsActive && !stop.IsDeleted),
                IsActive = route.IsActive,
                CreatedDate = route.CreatedDate,
                ModifiedDate = route.ModifiedDate
            });

    private IQueryable<TransportStopResponse> VisibleStopProjection() =>
        _dbContext.TransportStops
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(stop => stop.IsActive && !stop.IsDeleted)
            .Select(stop => new TransportStopResponse
            {
                Id = stop.Id,
                RouteId = stop.RouteId,
                RouteName = stop.Route != null ? stop.Route.Name : string.Empty,
                RouteColor = stop.Route != null ? stop.Route.ColorHex : string.Empty,
                Name = stop.Name,
                Longitude = stop.Coordinate.X,
                Latitude = stop.Coordinate.Y,
                SequenceOrder = stop.SequenceOrder,
                IsActive = stop.IsActive,
                IsDeleted = false,
                CreatedDate = stop.CreatedDate,
                ModifiedDate = stop.ModifiedDate
            });

    private async Task CompactRouteAsync(int routeId, int excludedStopId, CancellationToken cancellationToken)
    {
        var remaining = await _dbContext.TransportStops
            .Where(stop => stop.RouteId == routeId && stop.Id != excludedStopId)
            .OrderBy(stop => stop.SequenceOrder)
            .ThenBy(stop => stop.Id)
            .ToListAsync(cancellationToken);

        for (var index = 0; index < remaining.Count; index++)
        {
            remaining[index].SequenceOrder = index + 1;
        }
    }

    private async Task<ServiceResult<bool>> AuthorizeCoordinateAsync(Point point, CancellationToken cancellationToken)
    {
        var userId = _currentUser.UserId;
        if (userId is null)
        {
            return ServiceResult<bool>.Forbidden("Kimlik doğrulanamadı; ulaşım durağı yazılamaz.");
        }

        var area = await _geographicAuthorization.GetEffectiveAuthorizationAsync(userId.Value, cancellationToken);
        return area.Allows(point)
            ? ServiceResult<bool>.Success(true)
            : ServiceResult<bool>.Forbidden(OutsideAreaMessage);
    }

    private ServiceResult<int> RequireOwnerId()
    {
        var userId = _currentUser.UserId;
        return userId is null
            ? ServiceResult<int>.Forbidden("Kimlik doğrulanamadı; ulaşım durağı oluşturulamaz.")
            : ServiceResult<int>.Success(userId.Value);
    }

    private static ServiceResult<(string Name, string ColorHex)> ValidateRoute(string? name, string? colorHex)
    {
        var normalizedName = name?.Trim();
        if (string.IsNullOrWhiteSpace(normalizedName))
        {
            return ServiceResult<(string, string)>.Failure("Rota adı zorunludur.");
        }

        if (normalizedName.Length > TransportRoute.MaxNameLength)
        {
            return ServiceResult<(string, string)>.Failure($"Rota adı en fazla {TransportRoute.MaxNameLength} karakter olabilir.");
        }

        var normalizedColor = colorHex?.Trim();
        if (normalizedColor is null || !ColorHexPattern.IsMatch(normalizedColor))
        {
            return ServiceResult<(string, string)>.Failure("Rota rengi #RRGGBB biçiminde olmalıdır.");
        }

        return ServiceResult<(string, string)>.Success((normalizedName, normalizedColor.ToUpperInvariant()));
    }

    private static ServiceResult<(string Name, int RouteId, double Longitude, double Latitude)> ValidateStop(
        string? name,
        int routeId,
        double longitude,
        double latitude)
    {
        var normalizedName = name?.Trim();
        if (string.IsNullOrWhiteSpace(normalizedName))
        {
            return ServiceResult<(string, int, double, double)>.Failure("Durak adı zorunludur.");
        }

        if (normalizedName.Length > TransportStop.MaxNameLength)
        {
            return ServiceResult<(string, int, double, double)>.Failure($"Durak adı en fazla {TransportStop.MaxNameLength} karakter olabilir.");
        }

        if (routeId <= 0)
        {
            return ServiceResult<(string, int, double, double)>.Failure("Geçerli bir routeId zorunludur.");
        }

        if (!double.IsFinite(longitude) || longitude is < -180 or > 180)
        {
            return ServiceResult<(string, int, double, double)>.Failure("Boylam -180 ile 180 arasında olmalıdır.");
        }

        if (!double.IsFinite(latitude) || latitude is < -90 or > 90)
        {
            return ServiceResult<(string, int, double, double)>.Failure("Enlem -90 ile 90 arasında olmalıdır.");
        }

        return ServiceResult<(string, int, double, double)>.Success((normalizedName, routeId, longitude, latitude));
    }

    private static Point CreatePoint(double longitude, double latitude) => new(longitude, latitude) { SRID = Srid };

    private static bool HasMoved(Point current, double longitude, double latitude) =>
        Math.Abs(current.X - longitude) > CoordinateEpsilon || Math.Abs(current.Y - latitude) > CoordinateEpsilon;

    private static TransportRouteResponse ToRouteResponse(TransportRoute route, int stopCount) => new()
    {
        Id = route.Id,
        Name = route.Name,
        ColorHex = route.ColorHex,
        StopCount = stopCount,
        IsActive = route.IsActive,
        CreatedDate = route.CreatedDate,
        ModifiedDate = route.ModifiedDate
    };

    private static TransportRoutePathResponse ToPathResponse(TransportRoutePath path) => new()
    {
        Id = path.Id,
        RouteId = path.RouteId,
        GeometryWkt = WktWriter.Write(path.Geometry),
        DistanceMeters = path.DistanceMeters,
        DurationSeconds = path.DurationSeconds,
        Profile = path.Profile,
        GeneratedAt = path.GeneratedAt,
        IsStale = path.IsStale,
        LastFailureReason = path.LastFailureReason
    };

    private static TransportStopResponse ToStopResponse(TransportStop stop, string routeName) => new()
    {
        Id = stop.Id,
        RouteId = stop.RouteId,
        RouteName = routeName,
        RouteColor = stop.Route?.ColorHex ?? string.Empty,
        Name = stop.Name,
        Longitude = stop.Coordinate.X,
        Latitude = stop.Coordinate.Y,
        SequenceOrder = stop.SequenceOrder,
        IsActive = stop.IsActive,
        IsDeleted = stop.IsDeleted,
        CreatedDate = stop.CreatedDate,
        ModifiedDate = stop.ModifiedDate
    };

    private sealed record StopTopologySnapshot(
        int Id,
        int SequenceOrder,
        double Longitude,
        double Latitude);
}
