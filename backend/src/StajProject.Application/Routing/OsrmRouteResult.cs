using NetTopologySuite.Geometries;

namespace StajProject.Application.Routing;

public sealed record OsrmRouteResult(
    LineString Geometry,
    double DistanceMeters,
    double DurationSeconds,
    string Profile);
