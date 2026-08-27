using NetTopologySuite.Geometries;
using StajProject.Domain.Common;

namespace StajProject.Domain.Entities;

/// <summary>Bir ulaşım rotası üzerindeki sıralı durak.</summary>
public class TransportStop : IAuditableEntity
{
    public const int MaxNameLength = 200;

    public int Id { get; set; }

    public int RouteId { get; set; }

    public TransportRoute? Route { get; set; }

    /// <summary>
    /// Durağı oluşturan kullanıcı. Legacy duraklar için nullable kalır;
    /// yeni kayıtlarda servis doğrulanmış kullanıcıyı zorunlu kılar.
    /// </summary>
    public int? UserId { get; set; }

    public User? User { get; set; }

    public string Name { get; set; } = string.Empty;

    /// <summary>Durak konumu; SRID 4326.</summary>
    public Point Coordinate { get; set; } = null!;

    /// <summary>Rota içindeki pozitif, bir tabanlı sıralama değeri.</summary>
    public int SequenceOrder { get; set; }

    public bool IsActive { get; set; } = true;

    public bool IsDeleted { get; set; }

    public DateTime CreatedDate { get; set; }

    public DateTime ModifiedDate { get; set; }
}
