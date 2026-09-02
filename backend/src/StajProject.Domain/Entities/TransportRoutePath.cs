using NetTopologySuite.Geometries;

namespace StajProject.Domain.Entities;

/// <summary>
/// Bir ulaşım rotasının OSRM tarafından hesaplanan türetilmiş yol verisi.
/// İş rotasından ayrıdır ve rota başına en fazla bir satır bulunur.
/// </summary>
public class TransportRoutePath
{
    public const int MaxProfileLength = 32;
    public const int MaxFailureReasonLength = 500;

    public int Id { get; set; }

    public int RouteId { get; set; }

    public TransportRoute? Route { get; set; }

    /// <summary>Tam OSRM güzergahı; SRID 4326.</summary>
    public LineString Geometry { get; set; } = null!;

    public double DistanceMeters { get; set; }

    public double DurationSeconds { get; set; }

    public string Profile { get; set; } = string.Empty;

    public DateTime GeneratedAt { get; set; }

    /// <summary>Durak topolojisi değiştiğinde yolun artık güncel olmadığını belirtir.</summary>
    public bool IsStale { get; set; }

    /// <summary>İç ayrıntı içermeyen, kısa ve kullanıcıya güvenle gösterilebilir hata özeti.</summary>
    public string? LastFailureReason { get; set; }

    public DateTime ModifiedDate { get; set; }

    /// <summary>
    /// Bu güzergahın OTORİTER manevra adımları; sıra ile artar.
    /// </summary>
    /// <remarks>
    /// Boş liste GEÇERLİDİR ve bir hata değildir: motor adım üretmeyebilir.
    /// O durumda hat yine simüle edilir, yalnızca navigasyon sunulmaz —
    /// eksik veri geometriden TÜRETİLMEZ.
    /// </remarks>
    public ICollection<TransportRoutePathStep> Steps { get; set; } = new List<TransportRoutePathStep>();
}
