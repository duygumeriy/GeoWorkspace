using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
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

    private static readonly Regex ColorHexPattern = new(
        "^#[0-9A-Fa-f]{6}$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private readonly AppDbContext _dbContext;
    private readonly ICurrentUserService _currentUser;
    private readonly IGeographicAuthorizationService _geographicAuthorization;

    public TransportService(
        AppDbContext dbContext,
        ICurrentUserService currentUser,
        IGeographicAuthorizationService geographicAuthorization)
    {
        _dbContext = dbContext;
        _currentUser = currentUser;
        _geographicAuthorization = geographicAuthorization;
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
        await _dbContext.SaveChangesAsync(cancellationToken);

        return ServiceResult<TransportStopResponse>.Success(ToStopResponse(stop, route.Name));
    }

    public async Task<ServiceResult<TransportStopResponse>> UpdateStopAsync(
        int id,
        UpdateTransportStopRequest request,
        CancellationToken cancellationToken = default)
    {
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
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
            return ServiceResult<TransportStopResponse>.Success(ToStopResponse(stop, destination.Name));
        }

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

        await _dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return ServiceResult<TransportStopResponse>.Success(ToStopResponse(stop, destination.Name));
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
        await _dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return ServiceResult<TransportStopResponse>.Success(ToStopResponse(stop, route.Name));
    }

    public async Task<ServiceResult<IReadOnlyList<TransportStopResponse>>> ReorderStopsAsync(
        int routeId,
        ReorderTransportStopsRequest request,
        CancellationToken cancellationToken = default)
    {
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

        await _dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        var response = request.StopIds
            .Select(id => ToStopResponse(byId[id], route.Name))
            .ToList();

        return ServiceResult<IReadOnlyList<TransportStopResponse>>.Success(response);
    }

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
        CreatedDate = stop.CreatedDate,
        ModifiedDate = stop.ModifiedDate
    };
}
