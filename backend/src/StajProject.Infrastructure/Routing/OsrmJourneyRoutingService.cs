using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using NetTopologySuite.Geometries;
using StajProject.Application.Common;
using StajProject.Application.Interfaces;
using StajProject.Application.Journeys;
using StajProject.Application.Options;
using StajProject.Application.Routing;

namespace StajProject.Infrastructure.Routing;

/// <summary>
/// <see cref="IJourneyRoutingService"/>'in OSRM gerçekleştirimi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Mevcut <see cref="OsrmRoutingService"/> HİÇ DEĞİŞMEDİ.</b> Akıllı
/// Ulaşım'ın kalıcı güzergah üretimi eskisi gibi o servisten geçer. Bu adaptör
/// ayrı durur çünkü yolculuk planlaması manevra adımlarına (<c>steps=true</c>)
/// ve profil başına AYRI bir uca ihtiyaç duyar; ikisini tek sınıfta birleştirmek
/// güzergah üretimini yolculuğa özgü modele bağımlı kılardı.
/// </para>
/// <para>
/// <b>Profil → uç eşlemesi yapılandırmadadır.</b> Sürüş mevcut
/// <see cref="OsrmOptions"/>'ı kullanır; yürüyüş ve bisiklet yalnızca
/// <see cref="JourneyRoutingOptions"/> altında AYRI bir uç tanımlıysa
/// yönlendirilebilir sayılır. İş kuralında hiçbir adres ya da port gömülü
/// değildir.
/// </para>
/// <para>
/// <b>Sessiz düşüş yoktur.</b> Yapılandırılmamış bir profil için istek hiç
/// yapılmaz; sürüş ucuna gidip sonucu "yürüyüş" diye etiketlemek mümkün
/// değildir. Yerel OSRM <c>car.lua</c> ile derlendiği ve <c>osrm-routed</c>
/// adresteki profil segmentini yok saydığı için bu ayrım kritiktir.
/// </para>
/// <para>
/// <b>Sızıntı yok.</b> Ham JSON, istek adresi, HttpClient istisnası ve motor
/// hata metni dışarı ÇIKMAZ; yalnızca mevcut
/// <see cref="RouteGenerationMessages"/> sözleşmesi döner.
/// </para>
/// </remarks>
public sealed class OsrmJourneyRoutingService : IJourneyRoutingService
{
    /// <summary>Profil başına adlandırılmış <see cref="HttpClient"/> öneki.</summary>
    public const string HttpClientPrefix = "journey-routing-";

    private const int Srid = 4326;
    private const int MinimumCoordinates = 2;

    private static readonly GeometryFactory GeometryFactory = new(new PrecisionModel(), Srid);

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly OsrmOptions _drivingOptions;
    private readonly JourneyRoutingOptions _journeyOptions;
    private readonly ILogger<OsrmJourneyRoutingService> _logger;

    public OsrmJourneyRoutingService(
        IHttpClientFactory httpClientFactory,
        OsrmOptions drivingOptions,
        JourneyRoutingOptions journeyOptions,
        ILogger<OsrmJourneyRoutingService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _drivingOptions = drivingOptions;
        _journeyOptions = journeyOptions;
        _logger = logger;
    }

    /// <summary>Bir ürün profilinin adlandırılmış istemci adı.</summary>
    public static string HttpClientNameOf(JourneyTravelProfile profile) =>
        HttpClientPrefix + JourneyContractNames.Of(profile);

    public bool IsProfileRoutable(JourneyTravelProfile profile) => FindEndpoint(profile) is not null;

    public async Task<ServiceResult<JourneyRouteResult>> RouteAsync(
        JourneyRouteRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request is null || !TryValidateCoordinates(request.Coordinates, out var coordinates))
        {
            return ServiceResult<JourneyRouteResult>.Failure(
                "Rota hesaplamak için en az iki geçerli nokta gereklidir.");
        }

        /* Yapılandırılmamış profil için motora HİÇ gidilmez. Bu, sessiz sürüş
           düşüşünü kodun kendisinde imkânsız kılar. */
        if (FindEndpoint(request.Profile) is not { } endpoint)
        {
            return ServiceResult<JourneyRouteResult>.Failure(
                "Talep edilen seyahat profili için yapılandırılmış bir yönlendirme servisi bulunmuyor.");
        }

        var requestUri = BuildRequestUri(endpoint, coordinates);

        try
        {
            var httpClient = _httpClientFactory.CreateClient(HttpClientNameOf(request.Profile));

            using var response = await httpClient.GetAsync(
                requestUri,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Yolculuk yönlendirme isteği başarısız. StatusCode: {StatusCode}, Profile: {Profile}, PointCount: {PointCount}",
                    (int)response.StatusCode,
                    JourneyContractNames.Of(request.Profile),
                    coordinates.Count);

                return ServiceResult<JourneyRouteResult>.Upstream(
                    (int)response.StatusCode >= 500
                        ? RouteGenerationMessages.Unavailable
                        : RouteGenerationMessages.Unknown);
            }

            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
            return ParseResponse(document.RootElement, endpoint.Profile);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning(
                "Yolculuk yönlendirme isteği zaman aşımına uğradı. Profile: {Profile}",
                JourneyContractNames.Of(request.Profile));
            return ServiceResult<JourneyRouteResult>.Timeout(RouteGenerationMessages.Timeout);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (HttpRequestException exception)
        {
            _logger.LogWarning(
                exception,
                "Yolculuk yönlendirme servisine bağlanılamadı. Profile: {Profile}",
                JourneyContractNames.Of(request.Profile));
            return ServiceResult<JourneyRouteResult>.Upstream(RouteGenerationMessages.Unavailable);
        }
        catch (JsonException exception)
        {
            _logger.LogWarning(exception, "Yolculuk yönlendirme servisi bozuk JSON döndürdü.");
            return ServiceResult<JourneyRouteResult>.Upstream(RouteGenerationMessages.Unknown);
        }
        catch (InvalidDataException exception)
        {
            _logger.LogWarning(exception, "Yolculuk yönlendirme servisi geçersiz rota verisi döndürdü.");
            return ServiceResult<JourneyRouteResult>.Upstream(RouteGenerationMessages.Unknown);
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Yolculuk yönlendirme sınırında beklenmeyen hata.");
            return ServiceResult<JourneyRouteResult>.Upstream(RouteGenerationMessages.Unknown);
        }
    }

    /// <summary>
    /// Profilin yapılandırılmış ucu; yoksa <c>null</c>.
    /// </summary>
    /// <remarks>
    /// Sürüş için ayrı bir bölüm İSTENMEZ — mevcut <c>Osrm</c> yapılandırması
    /// kullanılır; böylece çalışan kurulumlar hiçbir değişiklik yapmadan sürüş
    /// yolculuğu planlayabilir.
    /// </remarks>
    internal JourneyRouterOptions? FindEndpoint(JourneyTravelProfile profile) => profile switch
    {
        JourneyTravelProfile.Driving => new JourneyRouterOptions
        {
            BaseUrl = _drivingOptions.BaseUrl,
            Profile = _drivingOptions.Profile,
            TimeoutSeconds = _drivingOptions.TimeoutSeconds
        },
        JourneyTravelProfile.Walking => _journeyOptions.Walking,
        JourneyTravelProfile.Cycling => _journeyOptions.Cycling,
        _ => null
    };

    internal static Uri BuildRequestUri(JourneyRouterOptions endpoint, IReadOnlyList<JourneyCoordinate> coordinates)
    {
        var joined = string.Join(
            ';',
            coordinates.Select(coordinate => string.Create(
                CultureInfo.InvariantCulture,
                $"{coordinate.Longitude:R},{coordinate.Latitude:R}")));

        /* steps=true tek farktır: güzergah üretimi adım istemez, yolculuk
           planlaması ister. overview/geometries mevcut servisle aynıdır. */
        return new Uri(
            $"{endpoint.BaseUrl.TrimEnd('/')}/route/v1/{endpoint.Profile}/{joined}"
            + "?overview=full&geometries=geojson&steps=true",
            UriKind.Absolute);
    }

    private ServiceResult<JourneyRouteResult> ParseResponse(JsonElement root, string engineProfile)
    {
        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty("code", out var codeElement)
            || codeElement.ValueKind != JsonValueKind.String)
        {
            throw new InvalidDataException("OSRM code alanı eksik veya geçersiz.");
        }

        if (!string.Equals(codeElement.GetString(), "Ok", StringComparison.Ordinal))
        {
            _logger.LogInformation("Yolculuk yönlendirmesi rota üretmedi. Code: {Code}", codeElement.GetString());
            return ServiceResult<JourneyRouteResult>.Upstream(RouteGenerationMessages.NoRoute);
        }

        if (!root.TryGetProperty("routes", out var routes)
            || routes.ValueKind != JsonValueKind.Array
            || routes.GetArrayLength() == 0)
        {
            return ServiceResult<JourneyRouteResult>.Upstream(RouteGenerationMessages.NoRoute);
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
            || coordinatesElement.GetArrayLength() < MinimumCoordinates)
        {
            throw new InvalidDataException("OSRM LineString geometrisi eksik veya geçersiz.");
        }

        var lineString = GeometryFactory.CreateLineString(
            [.. coordinatesElement.EnumerateArray().Select(ReadCoordinate)]);
        lineString.SRID = Srid;

        return ServiceResult<JourneyRouteResult>.Success(
            new JourneyRouteResult(lineString, distance, duration, engineProfile, ReadSteps(route)));
    }

    /// <summary>
    /// <c>legs[*].steps[*]</c>'i kararlı manevra modeline çevirir.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Bacaklar DÜZLEŞTİRİLİR: istemci için anlamlı olan tek ve artan bir
    /// manevra dizisidir; bacak sınırı zaten geçiş noktası sırasından bellidir.
    /// </para>
    /// <para>
    /// Adım verisi eksik ya da bozuksa istek TÜMÜYLE başarısız sayılmaz —
    /// geometri ve ölçümler hâlâ geçerlidir ve boş bir adım listesi, uydurulmuş
    /// bir manevradan iyidir.
    /// </para>
    /// </remarks>
    private static IReadOnlyList<JourneyRouteStep> ReadSteps(JsonElement route)
    {
        if (!route.TryGetProperty("legs", out var legs) || legs.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var steps = new List<JourneyRouteStep>();

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
                if (TryReadStep(step, steps.Count, out var mapped))
                {
                    steps.Add(mapped);
                }
            }
        }

        return steps;
    }

    private static bool TryReadStep(JsonElement step, int sequence, out JourneyRouteStep mapped)
    {
        mapped = null!;

        if (step.ValueKind != JsonValueKind.Object
            || !step.TryGetProperty("maneuver", out var maneuver)
            || maneuver.ValueKind != JsonValueKind.Object
            || !maneuver.TryGetProperty("type", out var typeElement)
            || typeElement.ValueKind != JsonValueKind.String
            || typeElement.GetString() is not { Length: > 0 } maneuverType
            || !maneuver.TryGetProperty("location", out var location)
            || location.ValueKind != JsonValueKind.Array
            || location.GetArrayLength() < 2
            || !location[0].TryGetDouble(out var longitude)
            || !location[1].TryGetDouble(out var latitude)
            || !IsValidCoordinate(longitude, latitude))
        {
            return false;
        }

        mapped = new JourneyRouteStep(
            Sequence: sequence,
            ManeuverType: maneuverType,
            ManeuverModifier: ReadOptionalText(maneuver, "modifier"),
            Name: ReadOptionalText(step, "name"),
            DistanceMeters: ReadOptionalNumber(step, "distance"),
            DurationSeconds: ReadOptionalNumber(step, "duration"),
            ManeuverLocation: new JourneyCoordinate(longitude, latitude),

            /* OSRM çekirdeği hazır talimat metni ÜRETMEZ. Alan, motor bir gün
               verirse dolsun diye vardır; metin burada UYDURULMAZ. */
            DisplayText: null);

        return true;
    }

    private static string? ReadOptionalText(JsonElement element, string propertyName) =>
        element.TryGetProperty(propertyName, out var value)
        && value.ValueKind == JsonValueKind.String
        && value.GetString() is { Length: > 0 } text
            ? text
            : null;

    private static double ReadOptionalNumber(JsonElement element, string propertyName) =>
        element.TryGetProperty(propertyName, out var value)
        && value.TryGetDouble(out var number)
        && double.IsFinite(number)
        && number >= 0
            ? number
            : 0;

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

    private static bool TryValidateCoordinates(
        IReadOnlyList<JourneyCoordinate>? input,
        out IReadOnlyList<JourneyCoordinate> coordinates)
    {
        coordinates = input ?? [];
        return coordinates.Count >= MinimumCoordinates
            && coordinates.All(coordinate => coordinate is not null
                && IsValidCoordinate(coordinate.Longitude, coordinate.Latitude));
    }

    private static bool IsValidCoordinate(double longitude, double latitude) =>
        double.IsFinite(longitude)
        && longitude is >= -180 and <= 180
        && double.IsFinite(latitude)
        && latitude is >= -90 and <= 90;
}
