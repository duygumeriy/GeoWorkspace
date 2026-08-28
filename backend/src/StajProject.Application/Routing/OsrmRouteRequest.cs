namespace StajProject.Application.Routing;

/// <summary>OSRM'ye aynı sırayla gönderilecek bir WGS84 geçiş noktası.</summary>
public sealed record OsrmWaypoint(double Longitude, double Latitude);

/// <summary>
/// Sırası değiştirilmeden yönlendirilecek geçiş noktaları. Sunucu adresi ve
/// profil bu sözleşmenin parçası değildir; yalnızca backend yapılandırmasından gelir.
/// </summary>
public sealed record OsrmRouteRequest(IReadOnlyList<OsrmWaypoint> Waypoints);
