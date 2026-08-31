using NetTopologySuite.Geometries;
using StajProject.Application.Common;
using StajProject.Application.Interfaces;
using StajProject.Application.Journeys;

namespace StajProject.Auth.Tests;

/// <summary>
/// Testler için deterministik yönlendirme adaptörü.
/// </summary>
/// <remarks>
/// <para>
/// Birim testleri Docker'a, çalışan bir OSRM'e ya da ağa BAĞLI DEĞİLDİR:
/// yönlendirme bir port arkasında olduğu için sahte bir gerçekleştirim
/// yeterlidir. Kaydettiği çağrılar, "otoriter yol varken motora gidilmiyor"
/// gibi iddiaları doğrudan kanıtlanabilir kılar.
/// </para>
/// <para>
/// Yönlendirilebilir profil kümesi AÇIKÇA verilir; böylece "yürüyüş yalnızca
/// gerçek bir yürüyüş motoru varsa routed sayılır" kuralı yapılandırma
/// kurmadan sınanabilir.
/// </para>
/// </remarks>
public sealed class FakeJourneyRouter : IJourneyRoutingService
{
    private readonly HashSet<JourneyTravelProfile> _routable;
    private readonly Func<JourneyRouteRequest, ServiceResult<JourneyRouteResult>> _responder;

    public FakeJourneyRouter(
        IEnumerable<JourneyTravelProfile>? routable = null,
        Func<JourneyRouteRequest, ServiceResult<JourneyRouteResult>>? responder = null)
    {
        _routable = [.. routable ?? [JourneyTravelProfile.Driving]];
        _responder = responder ?? DefaultResponder;
    }

    /// <summary>Motora yapılan her çağrının isteği, çağrı sırasıyla.</summary>
    public List<JourneyRouteRequest> Calls { get; } = [];

    public int CallCount => Calls.Count;

    /// <summary>Son çağrıda gönderilen koordinatlar.</summary>
    public IReadOnlyList<JourneyCoordinate> LastCoordinates =>
        Calls.Count == 0 ? [] : Calls[^1].Coordinates;

    public bool IsProfileRoutable(JourneyTravelProfile profile) => _routable.Contains(profile);

    public Task<ServiceResult<JourneyRouteResult>> RouteAsync(
        JourneyRouteRequest request,
        CancellationToken cancellationToken = default)
    {
        Calls.Add(request);

        /* Gerçek adaptörle aynı fail-closed kural: yapılandırılmamış profil
           için motora hiç gidilmez. */
        if (!IsProfileRoutable(request.Profile))
        {
            return Task.FromResult(ServiceResult<JourneyRouteResult>.Failure(
                "Talep edilen seyahat profili için yapılandırılmış bir yönlendirme servisi bulunmuyor."));
        }

        return Task.FromResult(_responder(request));
    }

    /// <summary>Motorun her zaman başarısız olduğu adaptör.</summary>
    public static FakeJourneyRouter Failing(
        ServiceErrorKind kind = ServiceErrorKind.Upstream,
        string error = "Rota hesaplama servisine şu anda ulaşılamıyor.") =>
        new(responder: _ => kind switch
        {
            ServiceErrorKind.Timeout => ServiceResult<JourneyRouteResult>.Timeout(error),
            ServiceErrorKind.NotFound => ServiceResult<JourneyRouteResult>.NotFound(error),
            _ => ServiceResult<JourneyRouteResult>.Upstream(error)
        });

    /// <summary>
    /// Varsayılan yanıt: gönderilen noktaları bir ara köşe ile birleştiren,
    /// kuş uçuşundan AÇIKÇA farklı bir geometri.
    /// </summary>
    /// <remarks>
    /// Ara köşe bilinçlidir: "kuş uçuşu ölçü artık gösterilmiyor" iddiası,
    /// yalnızca yönlendirilmiş sonuç düz çizgiden ayırt edilebilirse
    /// kanıtlanabilir.
    /// </remarks>
    private static ServiceResult<JourneyRouteResult> DefaultResponder(JourneyRouteRequest request)
    {
        var coordinates = new List<Coordinate>();
        for (var index = 0; index < request.Coordinates.Count; index++)
        {
            var point = request.Coordinates[index];
            if (index > 0)
            {
                var previous = request.Coordinates[index - 1];

                // Yolun düz çizgi OLMADIĞINI gösteren ara köşe.
                coordinates.Add(new Coordinate(
                    (previous.Longitude + point.Longitude) / 2,
                    ((previous.Latitude + point.Latitude) / 2) + 0.01));
            }

            coordinates.Add(new Coordinate(point.Longitude, point.Latitude));
        }

        var geometry = new LineString([.. coordinates]) { SRID = 4326 };

        var steps = new List<JourneyRouteStep>
        {
            new(0, "depart", null, "Başlangıç Caddesi", 120, 30,
                request.Coordinates[0], DisplayText: null),
            new(1, "turn", "left", "Orta Sokak", 340, 70,
                request.Coordinates[^1], DisplayText: null),
            new(2, "arrive", null, null, 0, 0,
                request.Coordinates[^1], DisplayText: null)
        };

        return ServiceResult<JourneyRouteResult>.Success(new JourneyRouteResult(
            geometry,
            DistanceMeters: 460,
            DurationSeconds: 100,
            EngineProfile: JourneyContractNames.Of(request.Profile),
            Steps: steps));
    }
}
