namespace StajProject.Application.DTOs;

/// <summary>
/// Heatmap görüntüsü için istemcinin belirleyebildiği dar render sözleşmesi.
/// CRS, kullanıcı, CQL, layer ve style bilinçli olarak bu tipte yer almaz.
/// </summary>
public sealed class HeatmapRequest
{
    /// <summary>EPSG:3857 sırasında minX,minY,maxX,maxY.</summary>
    public string Bbox { get; set; } = string.Empty;

    public int Width { get; set; }

    public int Height { get; set; }
}

/// <summary>GeoServer tarafından üretilmiş, doğrulanmış PNG.</summary>
public sealed class HeatmapImage
{
    public required byte[] Content { get; init; }
}
