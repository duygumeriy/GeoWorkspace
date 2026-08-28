using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using NetTopologySuite.Geometries;
using StajProject.Application.Common;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Application.Routing;

namespace StajProject.Infrastructure.Routing;

/// <summary>OSRM Route API'sini sunucu-yönetimli ayarlarla çağırır.</summary>
public sealed class OsrmRoutingService : IOsrmRoutingService
{
    private const int Srid = 4326;
    private const string InvalidWaypointsMessage = "Rota hesaplamak için en az iki geçerli durak gereklidir.";

    private static readonly GeometryFactory GeometryFactory = new(new PrecisionModel(), Srid);

    private readonly HttpClient _httpClient;
    private readonly OsrmOptions _options;
    private readonly ILogger<OsrmRoutingService> _logger;

    public OsrmRoutingService(
        HttpClient httpClient,
        OsrmOptions options,
        ILogger<OsrmRoutingService> logger)
    {
        _httpClient = httpClient;
        _options = options;
        _logger = logger;
    }

    public async Task<ServiceResult<OsrmRouteResult>> RouteAsync(
        OsrmRouteRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!TryValidateWaypoints(request?.Waypoints, out var waypoints))
        {
            return ServiceResult<OsrmRouteResult>.Failure(InvalidWaypointsMessage);
        }

        var requestUri = BuildRequestUri(waypoints);

        try
        {
            using var response = await _httpClient.GetAsync(
                requestUri,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "OSRM route isteği başarısız. StatusCode: {StatusCode}, WaypointCount: {WaypointCount}",
                    (int)response.StatusCode,
                    waypoints.Count);
                return ServiceResult<OsrmRouteResult>.Upstream(
                    (int)response.StatusCode >= 500
                        ? RouteGenerationMessages.Unavailable
                        : RouteGenerationMessages.Unknown);
            }

            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
            return ParseResponse(document.RootElement);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning("OSRM route isteği zaman aşımına uğradı. WaypointCount: {WaypointCount}", waypoints.Count);
            return ServiceResult<OsrmRouteResult>.Timeout(RouteGenerationMessages.Timeout);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (HttpRequestException exception)
        {
            _logger.LogWarning(exception, "OSRM route servisine bağlanılamadı. WaypointCount: {WaypointCount}", waypoints.Count);
            return ServiceResult<OsrmRouteResult>.Upstream(RouteGenerationMessages.Unavailable);
        }
        catch (JsonException exception)
        {
            _logger.LogWarning(exception, "OSRM route servisi bozuk JSON döndürdü. WaypointCount: {WaypointCount}", waypoints.Count);
            return ServiceResult<OsrmRouteResult>.Upstream(RouteGenerationMessages.Unknown);
        }
        catch (InvalidDataException exception)
        {
            _logger.LogWarning(exception, "OSRM route servisi geçersiz rota verisi döndürdü. WaypointCount: {WaypointCount}", waypoints.Count);
            return ServiceResult<OsrmRouteResult>.Upstream(RouteGenerationMessages.Unknown);
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "OSRM route sınırında beklenmeyen hata. WaypointCount: {WaypointCount}", waypoints.Count);
            return ServiceResult<OsrmRouteResult>.Upstream(RouteGenerationMessages.Unknown);
        }
    }

    internal Uri BuildRequestUri(IReadOnlyList<OsrmWaypoint> waypoints)
    {
        var coordinates = string.Join(
            ';',
            waypoints.Select(waypoint => string.Create(
                CultureInfo.InvariantCulture,
                $"{waypoint.Longitude:R},{waypoint.Latitude:R}")));

        return new Uri(
            $"{_options.BaseUrl.TrimEnd('/')}/route/v1/{_options.Profile}/{coordinates}" +
            "?overview=full&geometries=geojson&steps=false",
            UriKind.Absolute);
    }

    private ServiceResult<OsrmRouteResult> ParseResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty("code", out var codeElement)
            || codeElement.ValueKind != JsonValueKind.String)
        {
            throw new InvalidDataException("OSRM code alanı eksik veya geçersiz.");
        }

        var code = codeElement.GetString();
        if (!string.Equals(code, "Ok", StringComparison.Ordinal))
        {
            _logger.LogInformation("OSRM rota üretmedi. Code: {Code}", code);
            return ServiceResult<OsrmRouteResult>.Upstream(RouteGenerationMessages.NoRoute);
        }

        if (!root.TryGetProperty("routes", out var routes)
            || routes.ValueKind != JsonValueKind.Array
            || routes.GetArrayLength() == 0)
        {
            return ServiceResult<OsrmRouteResult>.Upstream(RouteGenerationMessages.NoRoute);
        }

        var route = routes[0];
        if (route.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException("OSRM routes öğesi geçersiz.");
        }

        var distance = ReadNonNegativeFiniteNumber(route, "distance");
        var duration = ReadNonNegativeFiniteNumber(route, "duration");

        if (!route.TryGetProperty("geometry", out var geometry)
            || geometry.ValueKind != JsonValueKind.Object
            || !geometry.TryGetProperty("type", out var geometryType)
            || geometryType.ValueKind != JsonValueKind.String
            || !string.Equals(geometryType.GetString(), "LineString", StringComparison.Ordinal)
            || !geometry.TryGetProperty("coordinates", out var coordinatesElement)
            || coordinatesElement.ValueKind != JsonValueKind.Array
            || coordinatesElement.GetArrayLength() < 2)
        {
            throw new InvalidDataException("OSRM LineString geometrisi eksik veya geçersiz.");
        }

        var coordinates = coordinatesElement.EnumerateArray().Select(ReadCoordinate).ToArray();
        var lineString = GeometryFactory.CreateLineString(coordinates);
        lineString.SRID = Srid;

        return ServiceResult<OsrmRouteResult>.Success(
            new OsrmRouteResult(lineString, distance, duration, _options.Profile));
    }

    private static Coordinate ReadCoordinate(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array || element.GetArrayLength() < 2
            || !element[0].TryGetDouble(out var longitude)
            || !element[1].TryGetDouble(out var latitude)
            || !IsValidCoordinate(longitude, latitude))
        {
            throw new InvalidDataException("OSRM koordinatı geçersiz.");
        }

        return new Coordinate(longitude, latitude);
    }

    private static double ReadNonNegativeFiniteNumber(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var value)
            || !value.TryGetDouble(out var number)
            || !double.IsFinite(number)
            || number < 0)
        {
            throw new InvalidDataException($"OSRM {propertyName} alanı geçersiz.");
        }

        return number;
    }

    private static bool TryValidateWaypoints(
        IReadOnlyList<OsrmWaypoint>? input,
        out IReadOnlyList<OsrmWaypoint> waypoints)
    {
        waypoints = input ?? [];
        return waypoints.Count >= 2
            && waypoints.All(waypoint => waypoint is not null
                && IsValidCoordinate(waypoint.Longitude, waypoint.Latitude));
    }

    private static bool IsValidCoordinate(double longitude, double latitude) =>
        double.IsFinite(longitude)
        && longitude is >= -180 and <= 180
        && double.IsFinite(latitude)
        && latitude is >= -90 and <= 90;
}
