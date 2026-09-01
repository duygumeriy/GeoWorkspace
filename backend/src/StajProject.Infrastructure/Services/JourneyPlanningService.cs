using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Journeys;
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
/// <b>Geometri GERÇEKTİR.</b> Kuş uçuşu ölçü artık hiçbir yerde
/// gösterilmez: sonuç ya rotanın kalıcı güzergahından ya da
/// <see cref="IJourneyRoutingService"/> üzerinden canlı hesaplanmış bir
/// güzergahtan gelir; ikisi de yol ağı üzerinde ölçülmüştür ve hangisi
/// olduğu <c>GeometrySource</c> ile bildirilir.
/// </para>
/// <para>
/// <b>Salt okunurluk canlı hesapta da korunur.</b> Canlı güzergah yalnızca
/// yanıtta yaşar; <c>TransportRoutePath</c>'e yazılmaz, bayat bir kayıt
/// tazelenmez.
/// </para>
/// </remarks>
public sealed class JourneyPlanningService : IJourneyPlanningService
{
    /// <summary>OSRM'nin tek istekte makul biçimde işleyebileceği üst sınır.</summary>
    internal const int MaxWaypoints = 25;

    private const int MinWaypoints = 2;

    /// <summary>Bir çizgi için anlamlı en az köşe sayısı.</summary>
    private const int MinimumGeometryPoints = 2;

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
    private const string TransportPermissionMessage =
        "Ulaşım rotası ve durağı seçebilmek için ulaşım ağını görüntüleme yetkisi gerekiyor.";

    private const string ReverseDirectionAssumption =
        "Bölüm, hattın kalıcı durak sırasına göre TERS yönde planlandı; duraklar seçime uygun biçimde sıralandı.";

    private const string PersistedPathAssumption =
        "Güzergah, rotanın kayıtlı ve güncel yolundan olduğu gibi alındı; yeniden hesaplanmadı. "
        + "Kayıtlı yol manevra bilgisi taşımadığı için adım adım yönlendirme bulunmuyor.";

    private const string LiveRoutingPreferredAssumption =
        "Hat, seçilen profil için baştan hesaplandı; böylece güzergah ve adım adım yönlendirme "
        + "AYNI plandan gelir. Rotanın kayıtlı yolu değiştirilmedi.";

    private const string MissingPathAssumption =
        "Rotanın kayıtlı bir güzergahı bulunmadığı için bu önizleme geçici olarak hesaplandı ve hiçbir yere kaydedilmedi.";

    private const string StalePathAssumption =
        "Rotanın kayıtlı güzergahı güncel olmadığı için bu önizleme geçici olarak hesaplandı ve hiçbir yere kaydedilmedi.";

    private const string ProfileMismatchAssumption =
        "Rotanın kayıtlı güzergahı farklı bir seyahat profiliyle üretildiği için bu önizleme "
        + "talep edilen profille geçici olarak hesaplandı ve hiçbir yere kaydedilmedi.";

    private const string SegmentLiveRoutingAssumption =
        "Bölüm, kayıtlı güzergahtan kesilerek değil, seçilen duraklar için baştan hesaplandı; "
        + "kayıtlı geometri hangi köşesinin hangi durağa karşılık geldiğini saklamadığından "
        + "kesme işlemi güvenle kanıtlanamaz.";

    private const string NoStepsAssumption =
        "Bu güzergah için adım adım yol tarifi bulunmuyor.";

    private static readonly WKTWriter WktWriter = new();

    private readonly AppDbContext _dbContext;
    private readonly ICurrentUserService _currentUser;
    private readonly IEffectivePermissionService _permissions;
    private readonly IJourneyRoutingService _routing;

    public JourneyPlanningService(
        AppDbContext dbContext,
        ICurrentUserService currentUser,
        IEffectivePermissionService permissions,
        IJourneyRoutingService routing)
    {
        _dbContext = dbContext;
        _currentUser = currentUser;
        _permissions = permissions;
        _routing = routing;
    }

    /// <summary>
    /// Sunum sözleşmesi: <see cref="PlanAsync"/>'in sonucunu API biçimine
    /// indirger. Planlama kuralı burada TEKRARLANMAZ.
    /// </summary>
    public async Task<ServiceResult<JourneyPlanPreviewResponse>> PreviewAsync(
        JourneyPlanRequest request,
        CancellationToken cancellationToken = default)
    {
        var plan = await PlanAsync(request, cancellationToken);

        return plan.IsSuccess
            ? ServiceResult<JourneyPlanPreviewResponse>.Success(ToPreviewResponse(plan.Value!))
            : Propagate<JourneyPlanPreviewResponse, JourneyPlanResult>(plan);
    }

    public async Task<ServiceResult<JourneyPlanResult>> PlanAsync(
        JourneyPlanRequest request,
        CancellationToken cancellationToken = default)
    {
        /* Uçtaki yetki "planlayabilir mi" sorusunu yanıtlar. Burada kimliğe
           bakılmasının sebebi, POI referanslarının AYRI bir yetki (poi.view)
           gerektirmesidir; kimliksiz bir istek o soruyu hiç soramaz. */
        if (_currentUser.UserId is not { } userId)
        {
            return ServiceResult<JourneyPlanResult>.Forbidden(UnknownUserMessage);
        }

        if (request is null)
        {
            return ServiceResult<JourneyPlanResult>.Failure(EmptyRequestMessage);
        }

        if (!JourneyContractNames.TryParseMode(request.Mode, out var mode))
        {
            return ServiceResult<JourneyPlanResult>.Failure(InvalidModeMessage);
        }

        // Profil isteğe bağlıdır; verilmezse karayolu varsayılır (motorun profili).
        var requestedProfile = JourneyTravelProfile.Driving;
        if (!string.IsNullOrWhiteSpace(request.Profile)
            && !JourneyContractNames.TryParseProfile(request.Profile, out requestedProfile))
        {
            return ServiceResult<JourneyPlanResult>.Failure(InvalidProfileMessage);
        }

        /* Profil kararı YAPILANDIRMAYA değil, gerçek yönlendirilebilirliğe
           bakar. Yürüyüş/bisiklet için ayrı bir motor yoksa istek burada
           durur; sürüşe düşülüp sonuç o profil adıyla etiketlenmez. */
        var profile = JourneyProfilePolicy.Decide(requestedProfile, _routing.IsProfileRoutable(requestedProfile));
        if (profile.Support == JourneyProfileSupport.Unavailable)
        {
            return ServiceResult<JourneyPlanResult>.Failure(profile.Note!);
        }

        var assumptions = new List<string>();

        var resolved = mode switch
        {
            JourneyMode.RouteFull => await ResolveRouteFullAsync(request, userId, cancellationToken),
            JourneyMode.RouteSegment => await ResolveRouteSegmentAsync(request, userId, assumptions, cancellationToken),
            _ => await ResolveWaypointsAsync(request, userId, cancellationToken)
        };

        if (!resolved.IsSuccess)
        {
            return Propagate<JourneyPlanResult, ResolvedJourney>(resolved);
        }

        var journey = resolved.Value!;

        var geometry = mode == JourneyMode.RouteFull
            ? await ResolveRouteFullGeometryAsync(journey, requestedProfile, assumptions, cancellationToken)
            : await RouteLiveAsync(journey, requestedProfile, assumptions, cancellationToken);

        if (!geometry.IsSuccess)
        {
            return Propagate<JourneyPlanResult, ResolvedGeometry>(geometry);
        }

        return ServiceResult<JourneyPlanResult>.Success(
            BuildPlan(mode, profile, journey, geometry.Value!, assumptions));
    }

    /* --- Geometri üretimi --------------------------------------------------------- */

    /// <summary>
    /// Rotanın TAMAMI için geometri: mümkünse kalıcı güzergahı aynen kullanır.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Aynı yolu yeniden üretmek için motora GİDİLMEZ.</b> Kalıcı güzergah
    /// güncel ve talep edilen profille üretilmişse otoriter kayıt odur;
    /// yeniden hesaplamak hem gereksiz bir çağrı olur hem de simülasyonun
    /// işleteceği geometriyle önizlemenin ayrışmasına kapı aralardı.
    /// </para>
    /// <para>
    /// <b>Profil uyuşmazlığı yeniden kullanımı ENGELLER.</b> Kalıcı yol sürüş
    /// profiliyle üretilmiştir; yürüyüş talebine onu döndürmek, sürüş
    /// geometrisini yürüyüş diye etiketlemek olurdu.
    /// </para>
    /// <para>
    /// <b>Bayat/eksik yol istekleri öldürmez.</b> Bu uç SALT OKUNURDUR:
    /// güzergah yeniden hesaplanıp KAYDEDİLMEZ, ama önizleme için canlı bir
    /// geçici güzergah hesaplanabilir. Sonuç bunu <c>liveRouting</c> olarak
    /// bildirir ki kullanıcı otoriter yolu gördüğünü sanmasın.
    /// </para>
    /// </remarks>
    private async Task<ServiceResult<ResolvedGeometry>> ResolveRouteFullGeometryAsync(
        ResolvedJourney journey,
        JourneyTravelProfile profile,
        List<string> assumptions,
        CancellationToken cancellationToken)
    {
        var path = await _dbContext.TransportRoutePaths
            .AsNoTracking()
            .Where(item => item.RouteId == journey.Route!.Id)
            .Select(item => new
            {
                item.Geometry,
                item.DistanceMeters,
                item.DurationSeconds,
                item.Profile,
                item.IsStale
            })
            .FirstOrDefaultAsync(cancellationToken);

        var requestedProfileName = JourneyContractNames.Of(profile);

        /* ÖNCE CANLI YÖNLENDİRME — bilinçli bir öncelik değişikliği.

           Kalıcı `TransportRoutePath` PAYLAŞILAN hat ürününün otoritesidir ve
           orada öyle kalır; ama manevra saklamaz. Kişisel yolculuk onu olduğu
           gibi kullandığında geometri geliyor, adım adım yönlendirme
           gelmiyordu — kullanıcı gerçek bir rota görüyor ama "bu güzergâh için
           adım adım yönlendirme bulunmuyor" yazısıyla karşılaşıyordu.

           Kişisel yolculuk KENDİ planına sahiptir: geometri, mesafe, süre ve
           adımlar TEK bir yönlendirme sonucundan gelir. Kalıcı yol
           DEĞİŞTİRİLMEZ, yalnızca burada tercih edilmez.

           Yedek yol korunur: motor o profil için kullanılamıyorsa kayıtlı yol
           yine devreye girer — yolculuk manevrasız da olsa çalışır. */
        var live = await RouteLiveAsync(journey, profile, assumptions, cancellationToken);

        if (live.IsSuccess)
        {
            assumptions.Add(LiveRoutingPreferredAssumption);
            return live;
        }

        if (path is not null
            && !path.IsStale
            && path.Geometry.NumPoints >= MinimumGeometryPoints
            && string.Equals(path.Profile, requestedProfileName, StringComparison.OrdinalIgnoreCase))
        {
            assumptions.Add(PersistedPathAssumption);
            return ServiceResult<ResolvedGeometry>.Success(new ResolvedGeometry(
                path.Geometry,
                path.DistanceMeters,
                path.DurationSeconds,
                path.Profile,
                JourneyGeometrySource.PersistedRoutePath,
                Steps: []));
        }

        /* Ne canlı yönlendirme ne de kullanılabilir bir kayıtlı yol var:
           motorun kendi hatası olduğu gibi döner. */
        assumptions.Add(path is null
            ? MissingPathAssumption
            : path.IsStale
                ? StalePathAssumption
                : ProfileMismatchAssumption);

        return live;
    }

    /// <summary>
    /// Normalleştirilmiş noktaları talep edilen profille CANLI yönlendirir.
    /// </summary>
    /// <remarks>
    /// Koordinatlar yalnızca sunucuda çözülmüş kayıtlardan gelir; istemciden
    /// gelen hiçbir geometri bu çağrıya giremez.
    /// </remarks>
    private async Task<ServiceResult<ResolvedGeometry>> RouteLiveAsync(
        ResolvedJourney journey,
        JourneyTravelProfile profile,
        List<string> assumptions,
        CancellationToken cancellationToken)
    {
        var coordinates = journey.Waypoints
            .Select(waypoint => new JourneyCoordinate(waypoint.Point.Longitude, waypoint.Point.Latitude))
            .ToArray();

        var routed = await _routing.RouteAsync(new JourneyRouteRequest(profile, coordinates), cancellationToken);

        if (!routed.IsSuccess)
        {
            return Propagate<ResolvedGeometry, JourneyRouteResult>(routed);
        }

        var result = routed.Value!;

        if (result.Steps.Count == 0)
        {
            assumptions.Add(NoStepsAssumption);
        }

        return ServiceResult<ResolvedGeometry>.Success(new ResolvedGeometry(
            result.Geometry,
            result.DistanceMeters,
            result.DurationSeconds,
            result.EngineProfile,
            JourneyGeometrySource.LiveRouting,
            result.Steps));
    }

    /* --- Kip çözümleyicileri ----------------------------------------------------- */

    private async Task<ServiceResult<ResolvedJourney>> ResolveRouteFullAsync(
        JourneyPlanRequest request,
        int userId,
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

        var transport = await EnsureTransportAccessAsync(userId, cancellationToken);
        if (!transport.IsSuccess)
        {
            return Propagate<ResolvedJourney, bool>(transport);
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
        int userId,
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

        var transport = await EnsureTransportAccessAsync(userId, cancellationToken);
        if (!transport.IsSuccess)
        {
            return Propagate<ResolvedJourney, bool>(transport);
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

        /* Bölüm, kalıcı güzergahtan KESİLMEZ. TransportRoutePath yalnızca tek
           bir LineString saklar; hangi köşesinin hangi durağa karşılık geldiği
           (OSRM'nin leg sınırları) hiçbir yerde tutulmaz. En yakın köşeyi
           bulup oradan kesmek, kavşak ve geri dönüşlerde sessizce YANLIŞ bir
           bölüm üretebilirdi — yanlış bir bölümü sessizce döndürmektense,
           seçilen duraklar için baştan hesaplanır. Böylece sonuç tam olarak
           seçilen duraklarda başlar ve biter, ilgisiz kısımlar hiç girmez ve
           ters seçim istenen yönde hesaplanır. */
        assumptions.Add(SegmentLiveRoutingAssumption);

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

        /* Durak seçmek AYRI bir yetkidir: kişisel yolculuk kullanabilmek
           (`journey.use`), ulaşım ağını okuyabilmek anlamına GELMEZ. Denetim
           kayıtlar OKUNMADAN ÖNCE yapılır — sonrasında yapılsaydı "bulunamadı"
           ile "yetkin yok" arasındaki fark, yetkisiz birine durağın gerçekten
           var olduğunu söylerdi. Yetki yalnızca istek gerçekten durak
           referansı taşıyorsa sorgulanır. */
        if (stopIds.Length > 0)
        {
            var transport = await EnsureTransportAccessAsync(userId, cancellationToken);
            if (!transport.IsSuccess)
            {
                return Propagate<ResolvedJourney, bool>(transport);
            }
        }

        /* POI seçmek de AYRI bir yetkidir: ulaşım ağını görebilmek, ortak POI
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

    /* --- Kaynak yetkileri -------------------------------------------------------- */

    /// <summary>
    /// Ulaşım rotası/durağı REFERANSI için <c>transport.view</c> şartı.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Ürün kapısı (<c>journey.use</c>) uçtadır ve "kişisel yolculuk
    /// kullanabilir mi" sorusunu yanıtlar. Bu denetim ise ikinci ve AYRI bir
    /// soruyu yanıtlar: "bu kullanıcı ulaşım ağını okuyabilir mi". Ürün kapısı
    /// eskiden <c>transport.view</c> olduğu için bu şart örtük biçimde
    /// sağlanıyordu; kapı kendi kimliğine taşınınca örtük koruma da ortadan
    /// kalkar ve şart burada AÇIKÇA yazılır.
    /// </para>
    /// <para>
    /// Denetim kayıtlar okunmadan ÖNCE çağrılır: fail-closed davranış, yetkisiz
    /// bir isteğe hiçbir rota/durak verisi (varlık bilgisi dâhil) sızdırmamayı
    /// gerektirir.
    /// </para>
    /// </remarks>
    private async Task<ServiceResult<bool>> EnsureTransportAccessAsync(
        int userId,
        CancellationToken cancellationToken) =>
        await _permissions.HasPermissionAsync(userId, PermissionCodes.TransportView, cancellationToken)
            ? ServiceResult<bool>.Success(true)
            : ServiceResult<bool>.Forbidden(TransportPermissionMessage);

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

    /// <summary>
    /// Çözülmüş yolculuğu ve geometriyi sunucu içi plan sonucuna toplar.
    /// </summary>
    private static JourneyPlanResult BuildPlan(
        JourneyMode mode,
        JourneyProfileDecision profile,
        ResolvedJourney journey,
        ResolvedGeometry geometry,
        IReadOnlyList<string> assumptions)
    {
        var waypoints = new List<JourneyPlannedWaypoint>(journey.Waypoints.Count);

        for (var index = 0; index < journey.Waypoints.Count; index++)
        {
            var waypoint = journey.Waypoints[index];
            var role = index == 0
                ? JourneyWaypointRole.Origin
                : index == journey.Waypoints.Count - 1
                    ? JourneyWaypointRole.Destination
                    : JourneyWaypointRole.Via;

            waypoints.Add(new JourneyPlannedWaypoint(
                index,
                waypoint.Source,
                waypoint.Point.Id,
                waypoint.Point.Name,
                waypoint.Point.Longitude,
                waypoint.Point.Latitude,
                waypoint.Point.RouteId,
                waypoint.Point.SequenceOrder,
                role));
        }

        return new JourneyPlanResult(
            mode,
            profile.Requested,

            /* Gerçekten ÜRETEN motorun profili. Talep edilenden sessizce
               sapılmaz; yeniden kullanılan kalıcı yolda o kaydın profilidir. */
            geometry.EngineProfile,
            profile.Support,
            geometry.Source,
            geometry.Geometry,
            geometry.DistanceMeters,
            geometry.DurationSeconds,
            journey.Route?.Id,
            journey.Route?.Name,
            waypoints,
            geometry.Steps,
            [.. assumptions]);
    }

    /// <summary>
    /// Plan sonucunun API sunumu. Burada YALNIZCA biçim değişir; hiçbir karar
    /// yeniden verilmez.
    /// </summary>
    private static JourneyPlanPreviewResponse ToPreviewResponse(JourneyPlanResult plan) =>
        new()
        {
            /* Yalnızca İLİŞKİLENDİRME kimliği: saklanmaz, imzalanmaz ve bir
               yetki belirteci değildir. Simülasyon başlatma bu kimliği KABUL
               ETMEZ; sunucu yolculuğu kendi verisinden yeniden kurar. */
            PlanId = Guid.NewGuid(),
            CreatedAt = DateTime.UtcNow,

            // Projenin kanonik API geometri biçimi: WKT.
            GeometryWkt = WktWriter.Write(plan.Geometry),
            Summary = new JourneyPlanSummaryResponse
            {
                Mode = JourneyContractNames.Of(plan.Mode),
                RequestedProfile = JourneyContractNames.Of(plan.RequestedProfile),
                EffectiveProfile = plan.EffectiveProfile,
                ProfileSupport = JourneyContractNames.Of(plan.ProfileSupport),
                GeometrySource = JourneyContractNames.Of(plan.GeometrySource),
                RouteId = plan.RouteId,
                RouteName = plan.RouteName,
                WaypointCount = plan.Waypoints.Count,
                StepCount = plan.Steps.Count,

                // Yol ağı üzerinde ÖLÇÜLMÜŞ değerler; kuş uçuşu ölçü artık yok.
                DistanceMeters = plan.DistanceMeters,
                DurationSeconds = plan.DurationSeconds,
                Assumptions = plan.Assumptions
            },
            Waypoints = [.. plan.Waypoints.Select(ToWaypointResponse)],
            Steps = [.. plan.Steps.Select(ToStepResponse)]
        };

    internal static JourneyWaypointResponse ToWaypointResponse(JourneyPlannedWaypoint waypoint) =>
        new()
        {
            Position = waypoint.Position,
            Source = JourneyContractNames.Of(waypoint.Source),
            ReferenceId = waypoint.ReferenceId,
            Name = waypoint.Name,
            Longitude = waypoint.Longitude,
            Latitude = waypoint.Latitude,
            RouteId = waypoint.RouteId,
            SequenceOrder = waypoint.SequenceOrder,
            Role = JourneyContractNames.Of(waypoint.Role)
        };

    internal static JourneyNavigationStepResponse ToStepResponse(JourneyRouteStep step) =>
        new()
        {
            Sequence = step.Sequence,
            ManeuverType = step.ManeuverType,
            ManeuverModifier = step.ManeuverModifier,
            Name = step.Name,
            DistanceMeters = step.DistanceMeters,
            DurationSeconds = step.DurationSeconds,
            ManeuverLongitude = step.ManeuverLocation.Longitude,
            ManeuverLatitude = step.ManeuverLocation.Latitude,
            DisplayText = step.DisplayText
        };

    /// <summary>
    /// Farklı jenerik gövdeler arasında hata sözleşmesini KORUYARAK aktarır.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Kip çözümleyicileri ve geometri aşaması kendi iç tipleriyle çalışır;
    /// hatayı dış gövdeye taşırken <c>Failure</c> kullanmak, bir 404'ü ya da
    /// yönlendirme motorundan gelen bir 502/504'ü sessizce 400'e çevirirdi.
    /// </para>
    /// <para>
    /// Mesaj OLDUĞU GİBİ taşınır: kaynak sonuç zaten yalnızca güvenli
    /// sözleşme metinleri taşır, burada yeniden yazılmaz ya da zenginleştirilmez.
    /// </para>
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

    /// <summary>Planın nihai geometrisi ve ölçümleri, kaynağıyla birlikte.</summary>
    private sealed record ResolvedGeometry(
        LineString Geometry,
        double DistanceMeters,
        double DurationSeconds,
        string EngineProfile,
        JourneyGeometrySource Source,
        IReadOnlyList<JourneyRouteStep> Steps);
}
