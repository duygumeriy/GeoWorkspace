namespace StajProject.Application.DTOs;

/// <summary>
/// Kişisel yolculuk simülasyonunun anlık görüntüsü.
/// </summary>
/// <remarks>
/// Sahip kimliği bilinçle DIŞARIDADIR: yanıt zaten yalnızca sahibine döner ve
/// kimliği tekrar etmek hiçbir şey eklemez.
/// </remarks>
public sealed class JourneySimulationSnapshotResponse
{
    public Guid SimulationId { get; set; }

    /// <summary><c>Running</c>, <c>Completed</c> veya <c>Cancelled</c>.</summary>
    public string Status { get; set; } = string.Empty;

    public double Longitude { get; set; }

    public double Latitude { get; set; }

    /// <summary>0..100 aralığında ilerleme.</summary>
    public double ProgressPercent { get; set; }

    public double DistanceCoveredMeters { get; set; }

    /// <summary>Anlık manevranın sırası; manevra yoksa <c>null</c> — bu GEÇERLİDİR.</summary>
    public int? CurrentStepSequence { get; set; }

    public DateTime UpdatedAtUtc { get; set; }
}

/// <summary>
/// Simülasyon başlatma/durum yanıtı: istemcinin yolculuğu çizmek için ihtiyaç
/// duyduğu OTORİTER her şey.
/// </summary>
/// <remarks>
/// <para>
/// <b>Bu yanıt istemcinin YENİ gerçeğidir.</b> Sunucu başlatma anında yeniden
/// planladığı için buradaki geometri, mesafe ve süre önizlemedekinden FARKLI
/// olabilir; farklı olması bir hata değil, güvenilmeyen bir önizlemeyi yeniden
/// doğrulamanın beklenen sonucudur. İstemci eski önizlemesini bırakıp bunu
/// kullanmalıdır.
/// </para>
/// </remarks>
public sealed class JourneySimulationResponse
{
    public Guid SimulationId { get; set; }

    public string Mode { get; set; } = string.Empty;

    public string RequestedProfile { get; set; } = string.Empty;

    /// <summary>Güzergahı gerçekten üreten motor profili.</summary>
    public string EffectiveProfile { get; set; } = string.Empty;

    public DateTime StartedAt { get; set; }

    /// <summary>Kanonik API biçimi: WKT <c>LINESTRING</c> (SRID 4326).</summary>
    public string GeometryWkt { get; set; } = string.Empty;

    public double TotalDistanceMeters { get; set; }

    /// <summary>
    /// GERÇEK seyahat süresi. Demo oynatma çarpanı bu değeri DEĞİŞTİRMEZ;
    /// yalnızca gösterimin ne hızda oynatıldığını belirler.
    /// </summary>
    public double TotalDurationSeconds { get; set; }

    public int? RouteId { get; set; }

    public string? RouteName { get; set; }

    public IReadOnlyList<JourneyWaypointResponse> Waypoints { get; set; } = [];

    /// <summary>Manevralar; kalıcı güzergah yeniden kullanıldığında BOŞ olur.</summary>
    public IReadOnlyList<JourneyNavigationStepResponse> Steps { get; set; } = [];

    public JourneySimulationSnapshotResponse Snapshot { get; set; } = new();
}
