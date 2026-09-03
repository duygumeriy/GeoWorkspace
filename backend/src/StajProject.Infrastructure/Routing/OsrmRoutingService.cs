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
            /* steps=true: manevralar YOLUN ÜRETİLDİĞİ ANDA alınır ve onunla
               birlikte saklanır. Simülasyon sırasında ya da her gözlemci için
               yeniden yönlendirme yapmak, aynı hattın navigasyonunu tick
               başına bir dış çağrıya bağlardı. */
            "?overview=full&geometries=geojson&steps=true",
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
            new OsrmRouteResult(lineString, distance, duration, _options.Profile, ReadSteps(route, distance)));
    }

    /// <summary>
    /// <c>legs[*].steps[*]</c>'i kararlı manevra modeline ve KÜMÜLATİF
    /// sınırlara çevirir.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Okunamayan adım sessizce ATLANIR, tüm güzergah düşürülmez.</b>
    /// Manevra bilgisi bir KOLAYLIKTIR; motorun tek bir bozuk adımı yüzünden
    /// hattın hiç güzergahı olmaması, ürünü çalışan bir özellikten mahrum
    /// bırakırdı. Sıra numarası bu yüzden dizinin konumundan değil, KABUL
    /// EDİLEN adım sayacından üretilir — atlanan bir adım numaralarda boşluk
    /// bırakmaz.
    /// </para>
    /// <para>
    /// <b>Sınırlar kabul edilen adımların uzunluklarından birikir.</b> Motorun
    /// toplam mesafesi ile adımların toplamı küçük yuvarlama farkları
    /// taşıyabilir; son adımın bitişi bu yüzden ayrıca güzergah toplamına
    /// GENİŞLETİLİR, aksi hâlde varışa birkaç metre kala hiçbir manevra
    /// eşleşmezdi.
    /// </para>
    /// </remarks>
    private static IReadOnlyList<OsrmRouteStep> ReadSteps(JsonElement route, double routeDistanceMeters)
    {
        if (!route.TryGetProperty("legs", out var legs) || legs.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var steps = new List<OsrmRouteStep>();
        var cumulative = 0d;

        foreach (var leg in legs.EnumerateArray())
        {
            if (leg.ValueKind != JsonValueKind.Object
                || !leg.TryGetProperty("steps", out var legSteps)
                || legSteps.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            foreach (var step in legSteps.EnumerateArray())
            {
                if (!TryReadStep(step, steps.Count, cumulative, out var mapped))
                {
                    continue;
                }

                steps.Add(mapped);
                cumulative = mapped.EndDistanceMeters;
            }
        }

        if (steps.Count == 0)
        {
            return [];
        }

        /* Son adımın bitişi güzergahın SONUDUR. Yuvarlama farkı yüzünden birkaç
           metre eksik kalırsa, varışa yaklaşan araç hiçbir adıma düşmezdi. */
        if (double.IsFinite(routeDistanceMeters) && routeDistanceMeters > steps[^1].EndDistanceMeters)
        {
            steps[^1] = steps[^1] with { EndDistanceMeters = routeDistanceMeters };
        }

        return steps;
    }

    private static bool TryReadStep(
        JsonElement step,
        int sequence,
        double startDistanceMeters,
        out OsrmRouteStep mapped)
    {
        mapped = null!;

        if (step.ValueKind != JsonValueKind.Object
            || !step.TryGetProperty("maneuver", out var maneuver)
            || maneuver.ValueKind != JsonValueKind.Object
            || !maneuver.TryGetProperty("type", out var typeElement)
            || typeElement.ValueKind != JsonValueKind.String
            || typeElement.GetString() is not { Length: > 0 } maneuverType)
        {
            return false;
        }

        var distance = ReadOptionalNonNegativeNumber(step, "distance");
        var duration = ReadOptionalNonNegativeNumber(step, "duration");

        if (distance is null || duration is null)
        {
            return false;
        }

        mapped = new OsrmRouteStep(
            Sequence: sequence,
            ManeuverType: maneuverType,
            ManeuverModifier: ReadOptionalText(maneuver, "modifier"),
            Name: ReadOptionalText(step, "name"),
            DistanceMeters: distance.Value,
            DurationSeconds: duration.Value,
            StartDistanceMeters: startDistanceMeters,
            EndDistanceMeters: startDistanceMeters + distance.Value);

        return true;
    }

    private static string? ReadOptionalText(JsonElement element, string propertyName) =>
        element.TryGetProperty(propertyName, out var value)
        && value.ValueKind == JsonValueKind.String
        && value.GetString() is { Length: > 0 } text
            ? text
            : null;

    private static double? ReadOptionalNonNegativeNumber(JsonElement element, string propertyName) =>
        element.TryGetProperty(propertyName, out var value)
        && value.TryGetDouble(out var number)
        && double.IsFinite(number)
        && number >= 0
            ? number
            : null;

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
