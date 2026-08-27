namespace StajProject.Application.DTOs;

public sealed class TransportRouteResponse
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string ColorHex { get; set; } = string.Empty;
    public int StopCount { get; set; }
    public bool IsActive { get; set; }
    public DateTime CreatedDate { get; set; }
    public DateTime ModifiedDate { get; set; }
}

public sealed class TransportStopResponse
{
    public int Id { get; set; }
    public int RouteId { get; set; }
    public string RouteName { get; set; } = string.Empty;
    public string RouteColor { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public double Longitude { get; set; }
    public double Latitude { get; set; }
    public int SequenceOrder { get; set; }
    public bool IsActive { get; set; }
    public DateTime CreatedDate { get; set; }
    public DateTime ModifiedDate { get; set; }
}

public sealed class CreateTransportRouteRequest
{
    public string? Name { get; set; }
    public string? ColorHex { get; set; }
}

public sealed class UpdateTransportRouteRequest
{
    public string? Name { get; set; }
    public string? ColorHex { get; set; }
}

public sealed class CreateTransportStopRequest
{
    public string? Name { get; set; }
    public int? RouteId { get; set; }
    public double? Longitude { get; set; }
    public double? Latitude { get; set; }
}

public sealed class UpdateTransportStopRequest
{
    public string? Name { get; set; }
    public int? RouteId { get; set; }
    public double? Longitude { get; set; }
    public double? Latitude { get; set; }
}

public sealed class ReorderTransportStopsRequest
{
    public IReadOnlyList<int>? StopIds { get; set; }
}
