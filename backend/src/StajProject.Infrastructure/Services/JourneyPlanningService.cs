using System.Globalization;
using Microsoft.EntityFrameworkCore;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Journeys;
using StajProject.Application.Options;
using StajProject.Application.Simulation;
using StajProject.Domain.Common;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// Genel yolculuk planlamasının doğrulama ve normalleştirme kuralları.
/// </summary>
/// <remarks>
/// <para>
/// <b>Salt okunur.</b> Hiçbir tabloya yazmaz, hiçbir simülasyon başlatmaz,
/// <c>TransportRoutePath</c>'e dokunmaz. Mevcut rota simülasyonu bu servisin
/// varlığından etkilenmez.
/// </para>
/// <para>
/// <b>Görünürlük EF sorgu filtrelerinden gelir.</b> Rota, durak ve POI
/// kümelerinin hepsinde <c>!IsDeleted &amp;&amp; IsActive</c> global filtresi
/// tanımlıdır ve burada <c>IgnoreQueryFilters</c> BİLİNÇLİ olarak
/// kullanılmaz: silinmiş ya da pasif bir kayıt sorgudan hiç dönmez, dolayısıyla
/// "çözülemedi" ile "silinmiş" aynı ve güvenli cevabı üretir. Durakların
/// hattına da açık bir <c>Join</c> ile bakılır — hattı silinmiş bir durak tek
/// başına geçerli görünmemelidir.
/// </para>
/// <para>
/// <b>Yönlendirme motoru çağrılmaz.</b> Bu faz iskeleti üretir; mesafeler
/// mevcut <see cref="TransportGeodesy"/> ile kuş uçuşu hesaplanır ve özet
/// bunu <c>IsRouted = false</c> ile bildirir.
/// </para>
/// </remarks>
public sealed class JourneyPlanningService : IJourneyPlanningService
{
    /// <summary>OSRM'nin tek istekte makul biçimde işleyebileceği üst sınır.</summary>
    internal const int MaxWaypoints = 25;

    private const int MinWaypoints = 2;

    private const string UnknownUserMessage = "Yolculuk planlamak için kimlik doğrulaması gerekiyor.";
    private const string EmptyRequestMessage = "Planlama isteği boş olamaz.";
    private const string InvalidModeMessage =
        "Geçersiz yolculuk kipi. Beklenen değerler: routeFull, routeSegment, waypoints.";
    private const string InvalidProfileMessage =
        "Geçersiz seyahat profili. Beklenen değerler: driving, walking, cycling.";
    private const string RouteRequiredMessage = "Bu kip için rota seçilmelidir.";
    private const string RouteNotAllowedMessage = "Serbest nokta kipinde rota bilgisi gönderilemez.";
    private const string RouteNotFoundMessage = "Ulaşım rotası bulunamadı veya kullanımda değil.";
    private const string RouteStopsInsufficientMessage =
        "Rotanın planlanabilmesi için en az iki kullanılabilir durağı olmalıdır.";
    private const string SegmentStopsRequiredMessage =
        "Bölüm kipi için başlangıç ve bitiş durağı seçilmelidir.";
    private const string SegmentStopsNotAllowedMessage =
        "Bu kipte başlangıç/bitiş durağı gönderilemez.";
    private const string SegmentStopsIdenticalMessage =
        "Başlangıç ve bitiş durağı aynı olamaz.";
    private const string SegmentStopNotOnRouteMessage =
        "Seçilen duraklar bu rotaya ait değil veya kullanımda değil.";
    private const string SegmentTooShortMessage =
        "Seçilen bölüm en az iki durak içermelidir.";
    private const string WaypointsRequiredMessage =
        "Serbest nokta kipi en az iki geçiş noktası gerektirir.";
    private const string WaypointsNotAllowedMessage =
        "Rota tabanlı kiplerde serbest geçiş noktası listesi gönderilemez.";
    private static readonly string WaypointsTooManyMessage =
        $"Bir yolculukta en fazla {MaxWaypoints} geçiş noktası bulunabilir.";
    private const string WaypointSourceMessage =
        "Geçersiz geçiş noktası kaynağı. Beklenen değerler: transportStop, poi.";
    private const string WaypointReferenceMessage =
        "Her geçiş noktası geçerli bir kayıt kimliği taşımalıdır.";
    private const string WaypointOrderMessage =
        "Sıra değeri ya tüm geçiş noktalarında verilmeli ya da hiçbirinde verilmemelidir.";
    private const string WaypointOrderDuplicateMessage =
        "Geçiş noktalarının sıra değerleri benzersiz olmalıdır.";
    private const string WaypointConsecutiveDuplicateMessage =
        "Aynı nokta arka arkaya iki kez seçilemez.";
    private const string StopNotFoundMessage =
        "Seçilen duraklardan biri bulunamadı veya kullanımda değil.";
    private const string PoiNotFoundMessage =
        "Seçilen ilgi noktalarından biri bulunamadı veya kullanımda değil.";
    private const string PoiPermissionMessage =
        "İlgi noktası seçebilmek için POI görüntüleme yetkisi gerekiyor.";

    private const string ReverseDirectionAssumption =
        "Bölüm, hattın kalıcı durak sırasına göre TERS yönde planlandı; duraklar seçime uygun biçimde sıralandı.";
    private const string PreviewAssumption =
        "Bu bir ÖNİZLEMEDİR: yol ağı üzerinde hesaplanmış bir güzergah henüz üretilmedi. "
        + "Bildirilen mesafeler noktalar arası kuş uçuşu değerlerdir.";

    private readonly AppDbContext _dbContext;
    private readonly ICurrentUserService _currentUser;
    private readonly IEffectivePermissionService _permissions;
    private readonly OsrmOptions _osrmOptions;

    public JourneyPlanningService(
        AppDbContext dbContext,
        ICurrentUserService currentUser,
        IEffectivePermissionService permissions,
        OsrmOptions osrmOptions)
    {
        _dbContext = dbContext;
        _currentUser = currentUser;
        _permissions = permissions;
        _osrmOptions = osrmOptions;
    }

    public async Task<ServiceResult<JourneyPlanPreviewResponse>> PreviewAsync(
        JourneyPlanRequest request,
        CancellationToken cancellationToken = default)
    {
        /* Uçtaki yetki "planlayabilir mi" sorusunu yanıtlar. Burada kimliğe
           bakılmasının sebebi, POI referanslarının AYRI bir yetki (poi.view)
           gerektirmesidir; kimliksiz bir istek o soruyu hiç soramaz. */
        if (_currentUser.UserId is not { } userId)
        {
            return ServiceResult<JourneyPlanPreviewResponse>.Forbidden(UnknownUserMessage);
        }

        if (request is null)
        {
            return ServiceResult<JourneyPlanPreviewResponse>.Failure(EmptyRequestMessage);
        }

        if (!JourneyContractNames.TryParseMode(request.Mode, out var mode))
        {
            return ServiceResult<JourneyPlanPreviewResponse>.Failure(InvalidModeMessage);
        }

        // Profil isteğe bağlıdır; verilmezse karayolu varsayılır (motorun profili).
        var requestedProfile = JourneyTravelProfile.Driving;
        if (!string.IsNullOrWhiteSpace(request.Profile)
            && !JourneyContractNames.TryParseProfile(request.Profile, out requestedProfile))
        {
            return ServiceResult<JourneyPlanPreviewResponse>.Failure(InvalidProfileMessage);
        }

        var profile = JourneyProfilePolicy.Decide(requestedProfile, _osrmOptions.Profile);
        if (profile.Support == JourneyProfileSupport.Unsupported)
        {
            return ServiceResult<JourneyPlanPreviewResponse>.Failure(profile.Note!);
        }

        var assumptions = new List<string> { PreviewAssumption };
        if (profile.Note is not null)
        {
            assumptions.Add(profile.Note);
        }

        var resolved = mode switch
        {
            JourneyMode.RouteFull => await ResolveRouteFullAsync(request, cancellationToken),
            JourneyMode.RouteSegment => await ResolveRouteSegmentAsync(request, assumptions, cancellationToken),
            _ => await ResolveWaypointsAsync(request, userId, cancellationToken)
        };

        if (!resolved.IsSuccess)
        {
            return Propagate<JourneyPlanPreviewResponse, ResolvedJourney>(resolved);
        }

        return ServiceResult<JourneyPlanPreviewResponse>.Success(
            BuildPreview(mode, profile, resolved.Value!, assumptions));
    }

    /* --- Kip çözümleyicileri ----------------------------------------------------- */

    private async Task<ServiceResult<ResolvedJourney>> ResolveRouteFullAsync(
        JourneyPlanRequest request,
        CancellationToken cancellationToken)
    {
        if (request.Waypoints is { Count: > 0 })
        {
            return ServiceResult<ResolvedJourney>.Failure(WaypointsNotAllowedMessage);
        }

        if (request.FromStopId is not null || request.ToStopId is not null)
        {
            return ServiceResult<ResolvedJourney>.Failure(SegmentStopsNotAllowedMessage);
        }

        var route = await FindRouteAsync(request.RouteId, cancellationToken);
        if (!route.IsSuccess)
        {
            return Propagate<ResolvedJourney, ResolvedRoute>(route);
        }

        var stops = await LoadRouteStopsAsync(route.Value!.Id, cancellationToken);
        if (stops.Count < MinWaypoints)
        {
            return ServiceResult<ResolvedJourney>.Failure(RouteStopsInsufficientMessage);
        }

        return ServiceResult<ResolvedJourney>.Success(
            new ResolvedJourney(route.Value, [.. stops.Select(ToWaypoint)]));
    }

    private async Task<ServiceResult<ResolvedJourney>> ResolveRouteSegmentAsync(
        JourneyPlanRequest request,
        List<string> assumptions,
        CancellationToken cancellationToken)
    {
        if (request.Waypoints is { Count: > 0 })
        {
            return ServiceResult<ResolvedJourney>.Failure(WaypointsNotAllowedMessage);
        }

        if (request.FromStopId is not { } fromStopId || request.ToStopId is not { } toStopId)
        {
            return ServiceResult<ResolvedJourney>.Failure(SegmentStopsRequiredMessage);
        }

        if (fromStopId == toStopId)
        {
            return ServiceResult<ResolvedJourney>.Failure(SegmentStopsIdenticalMessage);
        }

        var route = await FindRouteAsync(request.RouteId, cancellationToken);
        if (!route.IsSuccess)
        {
            return Propagate<ResolvedJourney, ResolvedRoute>(route);
        }

        var stops = await LoadRouteStopsAsync(route.Value!.Id, cancellationToken);

        var fromIndex = stops.FindIndex(stop => stop.Id == fromStopId);
        var toIndex = stops.FindIndex(stop => stop.Id == toStopId);

        /* Durak var olabilir ama BAŞKA bir hatta ait olabilir; "bulunamadı" ile
           "bu rotada değil" aynı ve güvenli cevabı verir. */
        if (fromIndex < 0 || toIndex < 0)
        {
            return ServiceResult<ResolvedJourney>.Failure(SegmentStopNotOnRouteMessage);
        }

        /* Seçim hattın kalıcı sırasına göre ters olabilir; bu geçersiz DEĞİLDİR
           (hat ters yönde işletilebilir). Sıra kullanıcının seçimine göre
           normalleştirilir ve bu varsayım sonuçta bildirilir. */
        var reversed = fromIndex > toIndex;
        var slice = reversed
            ? stops.GetRange(toIndex, fromIndex - toIndex + 1).AsEnumerable().Reverse().ToList()
            : stops.GetRange(fromIndex, toIndex - fromIndex + 1);

        if (slice.Count < MinWaypoints)
        {
            return ServiceResult<ResolvedJourney>.Failure(SegmentTooShortMessage);
        }

        if (reversed)
        {
            assumptions.Add(ReverseDirectionAssumption);
        }

        return ServiceResult<ResolvedJourney>.Success(
            new ResolvedJourney(route.Value, [.. slice.Select(ToWaypoint)]));
    }

    private async Task<ServiceResult<ResolvedJourney>> ResolveWaypointsAsync(
        JourneyPlanRequest request,
        int userId,
        CancellationToken cancellationToken)
    {
        if (request.RouteId is not null)
        {
            return ServiceResult<ResolvedJourney>.Failure(RouteNotAllowedMessage);
        }

        if (request.FromStopId is not null || request.ToStopId is not null)
        {
            return ServiceResult<ResolvedJourney>.Failure(SegmentStopsNotAllowedMessage);
        }

        var requested = request.Waypoints ?? [];
        if (requested.Count < MinWaypoints)
        {
            return ServiceResult<ResolvedJourney>.Failure(WaypointsRequiredMessage);
        }

        if (requested.Count > MaxWaypoints)
        {
            return ServiceResult<ResolvedJourney>.Failure(WaypointsTooManyMessage);
        }

        var parsed = new List<RequestedWaypoint>(requested.Count);
        foreach (var item in requested)
        {
            if (item is null || !JourneyContractNames.TryParseSource(item.Source, out var source))
            {
                return ServiceResult<ResolvedJourney>.Failure(WaypointSourceMessage);
            }

            if (item.ReferenceId is not { } referenceId || referenceId <= 0)
            {
                return ServiceResult<ResolvedJourney>.Failure(WaypointReferenceMessage);
            }

            parsed.Add(new RequestedWaypoint(source, referenceId, item.Order));
        }

        /* Açık sıra ya HEP ya HİÇ verilir: bir kısmı sıralı, bir kısmı sırasız
           bir listede "kullanıcının kastettiği sıra" tanımsızdır ve sessizce
           bir yorum seçmek yanlış yolculuk üretirdi. */
        var orderedCount = parsed.Count(item => item.Order is not null);
        if (orderedCount is not 0 && orderedCount != parsed.Count)
        {
            return ServiceResult<ResolvedJourney>.Failure(WaypointOrderMessage);
        }

        if (orderedCount == parsed.Count)
        {
            if (parsed.Select(item => item.Order!.Value).Distinct().Count() != parsed.Count)
            {
                return ServiceResult<ResolvedJourney>.Failure(WaypointOrderDuplicateMessage);
            }

            parsed = [.. parsed.OrderBy(item => item.Order!.Value)];
        }

        /* Arka arkaya aynı nokta SIFIR uzunlukta bir adım üretir; reddedilir.
           Arada başka noktalar varsa aynı noktaya dönmek geçerlidir (gidiş-dönüş
           gerçek bir kullanımdır) ve bilinçli olarak engellenmez. */
        for (var index = 1; index < parsed.Count; index++)
        {
            if (parsed[index].SameAs(parsed[index - 1]))
            {
                return ServiceResult<ResolvedJourney>.Failure(WaypointConsecutiveDuplicateMessage);
            }
        }

        var stopIds = parsed
            .Where(item => item.Source == JourneyWaypointSource.TransportStop)
            .Select(item => item.ReferenceId)
            .Distinct()
            .ToArray();

        var poiIds = parsed
            .Where(item => item.Source == JourneyWaypointSource.Poi)
            .Select(item => item.ReferenceId)
            .Distinct()
            .ToArray();

        /* POI seçmek AYRI bir yetkidir: ulaşım ağını görebilmek, ortak POI
           envanterini okuyabilmek anlamına gelmez. Yetki yalnızca istek
           gerçekten POI referansı taşıyorsa sorgulanır. */
        if (poiIds.Length > 0
            && !await _permissions.HasPermissionAsync(userId, PermissionCodes.PoiView, cancellationToken))
        {
            return ServiceResult<ResolvedJourney>.Forbidden(PoiPermissionMessage);
        }

        var stops = stopIds.Length == 0
            ? new Dictionary<int, ResolvedPoint>()
            : (await LoadStopsAsync(stopIds, cancellationToken)).ToDictionary(stop => stop.Id);

        if (stops.Count != stopIds.Length)
        {
            return ServiceResult<ResolvedJourney>.Failure(StopNotFoundMessage);
        }

        var pois = poiIds.Length == 0
            ? new Dictionary<int, ResolvedPoint>()
            : await _dbContext.Pois
                .AsNoTracking()
                .Where(poi => poiIds.Contains(poi.Id))
                .Select(poi => new ResolvedPoint(
                    poi.Id, poi.Name, poi.Coordinate.X, poi.Coordinate.Y, null, null))
                .ToDictionaryAsync(poi => poi.Id, cancellationToken);

        if (pois.Count != poiIds.Length)
        {
            return ServiceResult<ResolvedJourney>.Failure(PoiNotFoundMessage);
        }

        var waypoints = parsed
            .Select(item => item.Source == JourneyWaypointSource.TransportStop
                ? ToWaypoint(stops[item.ReferenceId])
                : ToWaypoint(pois[item.ReferenceId], JourneyWaypointSource.Poi))
            .ToArray();

        return ServiceResult<ResolvedJourney>.Success(new ResolvedJourney(Route: null, waypoints));
    }

    /* --- Veri erişimi ------------------------------------------------------------ */

    private async Task<ServiceResult<ResolvedRoute>> FindRouteAsync(
        int? routeId,
        CancellationToken cancellationToken)
    {
        if (routeId is not { } id || id <= 0)
        {
            return ServiceResult<ResolvedRoute>.Failure(RouteRequiredMessage);
        }

        // Global sorgu filtresi silinmiş/pasif rotayı zaten dışarıda bırakır.
        var route = await _dbContext.TransportRoutes
            .AsNoTracking()
            .Where(item => item.Id == id)
            .Select(item => new ResolvedRoute(item.Id, item.Name))
            .FirstOrDefaultAsync(cancellationToken);

        return route is null
            ? ServiceResult<ResolvedRoute>.NotFound(RouteNotFoundMessage)
            : ServiceResult<ResolvedRoute>.Success(route);
    }

    /// <summary>
    /// Hattın kullanılabilir duraklarını KALICI sırasıyla okur.
    /// </summary>
    /// <remarks>
    /// Sıralama <c>SequenceOrder</c>, eşitlikte <c>Id</c>'dir — güzergah
    /// üretimindeki (<c>TransportService</c>) sıralamayla birebir aynıdır ki
    /// plan ile hesaplanmış güzergah aynı durak dizisini görsün.
    /// </remarks>
    private Task<List<ResolvedPoint>> LoadRouteStopsAsync(int routeId, CancellationToken cancellationToken) =>
        _dbContext.TransportStops
            .AsNoTracking()
            .Where(stop => stop.RouteId == routeId)
            .OrderBy(stop => stop.SequenceOrder)
            .ThenBy(stop => stop.Id)
            .Select(stop => new ResolvedPoint(
                stop.Id, stop.Name, stop.Coordinate.X, stop.Coordinate.Y, stop.RouteId, stop.SequenceOrder))
            .ToListAsync(cancellationToken);

    /// <summary>
    /// Serbest kipte tek tek seçilmiş durakları okur.
    /// </summary>
    /// <remarks>
    /// Hatta AÇIK bir <c>Join</c> yapılır: durağın kendi filtresi geçse bile
    /// hattı silinmiş/pasif ise durak plana giremez. Navigation property üzerinden
    /// dolaylı bir erişim, filtrenin uygulanıp uygulanmadığını okuyana bırakırdı.
    /// </remarks>
    private Task<List<ResolvedPoint>> LoadStopsAsync(int[] stopIds, CancellationToken cancellationToken) =>
        _dbContext.TransportStops
            .AsNoTracking()
            .Where(stop => stopIds.Contains(stop.Id))
            .Join(
                _dbContext.TransportRoutes.AsNoTracking(),
                stop => stop.RouteId,
                route => route.Id,
                (stop, route) => new ResolvedPoint(
                    stop.Id, stop.Name, stop.Coordinate.X, stop.Coordinate.Y, route.Id, stop.SequenceOrder))
            .ToListAsync(cancellationToken);

    /* --- Yanıt kurulumu ---------------------------------------------------------- */

    private static JourneyPlanPreviewResponse BuildPreview(
        JourneyMode mode,
        JourneyProfileDecision profile,
        ResolvedJourney journey,
        IReadOnlyList<string> assumptions)
    {
        var waypoints = new List<JourneyWaypointResponse>(journey.Waypoints.Count);
        for (var index = 0; index < journey.Waypoints.Count; index++)
        {
            var waypoint = journey.Waypoints[index];
            var role = index == 0
                ? JourneyWaypointRole.Origin
                : index == journey.Waypoints.Count - 1
                    ? JourneyWaypointRole.Destination
                    : JourneyWaypointRole.Via;

            waypoints.Add(new JourneyWaypointResponse
            {
                Position = index,
                Source = JourneyContractNames.Of(waypoint.Source),
                ReferenceId = waypoint.Point.Id,
                Name = waypoint.Point.Name,
                Longitude = waypoint.Point.Longitude,
                Latitude = waypoint.Point.Latitude,
                RouteId = waypoint.Point.RouteId,
                SequenceOrder = waypoint.Point.SequenceOrder,
                Role = JourneyContractNames.Of(role)
            });
        }

        var steps = new List<JourneyNavigationStepResponse>(Math.Max(0, waypoints.Count - 1));
        var total = 0d;
        for (var index = 1; index < waypoints.Count; index++)
        {
            var from = waypoints[index - 1];
            var to = waypoints[index];
            var distance = TransportGeodesy.DistanceMeters(
                from.Longitude, from.Latitude, to.Longitude, to.Latitude);
            total += distance;

            steps.Add(new JourneyNavigationStepResponse
            {
                StepIndex = index - 1,
                FromWaypointPosition = from.Position,
                ToWaypointPosition = to.Position,
                FromName = from.Name,
                ToName = to.Name,
                StraightLineDistanceMeters = distance,
                Instruction = string.Format(
                    CultureInfo.InvariantCulture,
                    "{0} → {1}",
                    from.Name,
                    to.Name)
            });
        }

        return new JourneyPlanPreviewResponse
        {
            PlanId = Guid.NewGuid(),
            CreatedAt = DateTime.UtcNow,
            Summary = new JourneyPlanSummaryResponse
            {
                Mode = JourneyContractNames.Of(mode),
                RequestedProfile = JourneyContractNames.Of(profile.Requested),
                EffectiveProfile = profile.EffectiveEngineProfile,
                ProfileSupport = JourneyContractNames.Of(profile.Support),
                RouteId = journey.Route?.Id,
                RouteName = journey.Route?.Name,
                WaypointCount = waypoints.Count,
                StepCount = steps.Count,
                StraightLineDistanceMeters = total,

                /* Bu fazda hiçbir yol geometrisi üretilmez; alan bunu itiraf
                   etmek için vardır ve sabit false yazılır. */
                IsRouted = false,
                Assumptions = [.. assumptions]
            },
            Waypoints = waypoints,
            Steps = steps
        };
    }

    /// <summary>
    /// Farklı jenerik gövdeler arasında hata sözleşmesini KORUYARAK aktarır.
    /// </summary>
    /// <remarks>
    /// Kip çözümleyicileri kendi iç tipleriyle çalışır; hatayı dış gövdeye
    /// taşırken <c>Failure</c> kullanmak, bir 404'ü sessizce 400'e çevirirdi.
    /// </remarks>
    private static ServiceResult<TTarget> Propagate<TTarget, TSource>(ServiceResult<TSource> failure) =>
        failure.ErrorKind switch
        {
            ServiceErrorKind.NotFound => ServiceResult<TTarget>.NotFound(failure.Error!),
            ServiceErrorKind.Forbidden => ServiceResult<TTarget>.Forbidden(failure.Error!),
            ServiceErrorKind.Conflict => ServiceResult<TTarget>.Conflict(failure.Error!),
            ServiceErrorKind.Upstream => ServiceResult<TTarget>.Upstream(failure.Error!),
            ServiceErrorKind.Timeout => ServiceResult<TTarget>.Timeout(failure.Error!),
            _ => ServiceResult<TTarget>.Failure(failure.Error!)
        };

    private static ResolvedWaypoint ToWaypoint(ResolvedPoint point) =>
        new(JourneyWaypointSource.TransportStop, point);

    private static ResolvedWaypoint ToWaypoint(ResolvedPoint point, JourneyWaypointSource source) =>
        new(source, point);

    /* --- İç modeller ------------------------------------------------------------- */

    private sealed record RequestedWaypoint(JourneyWaypointSource Source, int ReferenceId, int? Order)
    {
        public bool SameAs(RequestedWaypoint other) =>
            Source == other.Source && ReferenceId == other.ReferenceId;
    }

    private sealed record ResolvedRoute(int Id, string Name);

    private sealed record ResolvedPoint(
        int Id,
        string Name,
        double Longitude,
        double Latitude,
        int? RouteId,
        int? SequenceOrder);

    private sealed record ResolvedWaypoint(JourneyWaypointSource Source, ResolvedPoint Point);

    private sealed record ResolvedJourney(ResolvedRoute? Route, IReadOnlyList<ResolvedWaypoint> Waypoints);
}
