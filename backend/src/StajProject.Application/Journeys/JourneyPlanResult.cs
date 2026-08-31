using NetTopologySuite.Geometries;

namespace StajProject.Application.Journeys;

/// <summary>Sunucuda çözülmüş tek bir geçiş noktası (sunum tipi DEĞİL).</summary>
public sealed record JourneyPlannedWaypoint(
    int Position,
    JourneyWaypointSource Source,
    int ReferenceId,
    string Name,
    double Longitude,
    double Latitude,
    int? RouteId,
    int? SequenceOrder,
    JourneyWaypointRole Role);

/// <summary>
/// Bir yolculuk planının SUNUCU İÇİ, sağlayıcıdan bağımsız sonucu.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden API DTO'sundan ayrı.</b> Faz 5C'nin
/// <c>JourneyPlanPreviewResponse</c>'u bir SUNUM sözleşmesidir: geometriyi WKT
/// METNİ olarak taşır, adları biçimlendirir ve tarayıcıya gider. Simülasyon
/// başlatma ise gerçek <see cref="LineString"/>'e ve manevraların kendisine
/// ihtiyaç duyar; WKT'yi yazıp hemen geri okumak, güven sınırının içinde
/// gereksiz ve kayıplı bir gidiş-dönüş olurdu.
/// </para>
/// <para>
/// <b>Planlama algoritması TEK yerdedir.</b> Önizleme de simülasyon başlatma
/// da aynı <c>PlanAsync</c>'i çağırır; iki kopya, zamanla birbirinden sessizce
/// ayrışan iki farklı yolculuk üretirdi.
/// </para>
/// </remarks>
public sealed record JourneyPlanResult(
    JourneyMode Mode,
    JourneyTravelProfile RequestedProfile,
    string EffectiveProfile,
    JourneyProfileSupport ProfileSupport,
    JourneyGeometrySource GeometrySource,
    LineString Geometry,
    double DistanceMeters,
    double DurationSeconds,
    int? RouteId,
    string? RouteName,
    IReadOnlyList<JourneyPlannedWaypoint> Waypoints,
    IReadOnlyList<JourneyRouteStep> Steps,
    IReadOnlyList<string> Assumptions);
