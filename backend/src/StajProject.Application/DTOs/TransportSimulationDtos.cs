namespace StajProject.Application.DTOs;

/// <summary>
/// Aktif bir simülasyonun istemciye açılan görünümü.
/// </summary>
/// <remarks>
/// Güzergah geometrisi bilinçli olarak BURADA DEĞİLDİR: istemci onu zaten
/// mevcut <c>GET api/transport/routes/{routeId}/path</c> ucundan alır ve aynı
/// veriyi iki uçtan farklı biçimlerde yayınlamak, ikisinin ayrışmasına
/// açık kapı bırakırdı. Bu yanıt yalnızca ÇALIŞTIRMAYA ait olguları taşır.
/// </remarks>
public sealed class TransportSimulationResponse
{
    public Guid SimulationId { get; set; }
    public int RouteId { get; set; }
    public string RouteName { get; set; } = string.Empty;
    public string RouteColorHex { get; set; } = string.Empty;
    public int StartedByUserId { get; set; }
    public DateTime StartedAt { get; set; }

    /// <summary>İşletilen yolun ölçülen toplam uzunluğu.</summary>
    public double DistanceMeters { get; set; }

    /// <summary>İşletilen yolun ölçülen toplam süresi.</summary>
    public double DurationSeconds { get; set; }

    /// <summary>Yolun üretildiği OSRM profili.</summary>
    public string Profile { get; set; } = string.Empty;

    /// <summary>İşletilen yol sürümünün üretim anı.</summary>
    public DateTime PathGeneratedAt { get; set; }

    /// <summary>Güzergahtaki köşe sayısı.</summary>
    public int PointCount { get; set; }

    public double Longitude { get; set; }
    public double Latitude { get; set; }
    public int SegmentIndex { get; set; }

    /// <summary>0..1 aralığında ilerleme.</summary>
    public double ProgressRatio { get; set; }

    public double DistanceCoveredMeters { get; set; }

    /// <summary>Anlık görüntünün sunucuda üretildiği UTC an.</summary>
    public DateTime CapturedAt { get; set; }
}
