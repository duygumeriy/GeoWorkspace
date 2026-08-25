namespace StajProject.Application.DTOs;

/// <summary>
/// Normal çizim sunum görüntüsü için istemcinin belirleyebildiği dar render
/// sözleşmesi.
/// </summary>
/// <remarks>
/// CRS, kullanıcı kimliği, sahip, CQL, workspace, layer ve style bilinçli
/// olarak bu tipte YER ALMAZ — hepsi backend'e aittir. Hangi geometry türünün
/// isteneceği de bu tipte taşınmaz: onu controller'ın ayrı action'ları sabit
/// olarak belirler, böylece istemci bir katman adı ima edebilecek tek bir
/// serbest değer bile gönderemez.
/// </remarks>
public sealed class MapPresentationRequest
{
    /// <summary>EPSG:3857 sırasında minX,minY,maxX,maxY.</summary>
    public string Bbox { get; set; } = string.Empty;

    public int Width { get; set; }

    public int Height { get; set; }

    /// <summary>
    /// <see cref="Width"/>/<see cref="Height"/>'ın CSS pikseline göre yoğunluğu.
    /// </summary>
    /// <remarks>
    /// Varsayılan 1'dir ve bu, yoğunluk bildirmeyen mevcut istemcilerin
    /// davranışını birebir korur. Doğrulama <c>WmsRenderContract</c>'tadır;
    /// istemci bu SAYIDAN başka hiçbir çizim parametresi belirleyemez.
    /// </remarks>
    public double PixelRatio { get; set; } = 1.0;
}

/// <summary>GeoServer tarafından üretilmiş, doğrulanmış sunum PNG'si.</summary>
public sealed class MapPresentationImage
{
    public required byte[] Content { get; init; }
}
