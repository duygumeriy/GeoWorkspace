namespace StajProject.Application.Activity;

public enum TransportActivityKind
{
    RouteGeneration,
    StopReorder,
    StopUpdate,
    StopTransfer,
    StopCoordinateMove
}

/// <summary>
/// Tek HTTP isteğinde tamamlanan transport mutasyonunun güvenli, iş-seviyesi
/// sonucunu merkezî Activity History filtresine taşır. Koordinat, OSRM yanıtı
/// veya altyapı istisnası taşımaz.
/// </summary>
public sealed record TransportActivityOutcome(
    TransportActivityKind Kind,
    int? RouteId = null,
    string? RouteName = null,
    int? StopId = null,
    string? StopName = null,
    int? SourceRouteId = null,
    string? SourceRouteName = null,
    int? DestinationRouteId = null,
    string? DestinationRouteName = null,
    IReadOnlyList<int>? OrderedStopIds = null,
    bool? RouteGenerated = null,
    double? DistanceMeters = null,
    double? DurationSeconds = null,
    bool CoordinateChanged = false);

public sealed class TransportActivityContext
{
    public TransportActivityOutcome? Outcome { get; set; }
}
