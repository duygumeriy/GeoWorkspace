using NetTopologySuite.Geometries;

namespace StajProject.Domain.Entities;

/// <summary>
/// Haritada gösterilen isimlendirilmiş nokta. PostGIS tarafında
/// geometry(Point,4326) olarak saklanır.
/// </summary>
public class Location
{
    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public Point Coordinate { get; set; } = null!;
}
