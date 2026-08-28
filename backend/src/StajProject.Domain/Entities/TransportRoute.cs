using StajProject.Domain.Common;

namespace StajProject.Domain.Entities;

/// <summary>Duraklardan oluşan adlandırılmış ulaşım rotası.</summary>
public class TransportRoute : IAuditableEntity
{
    public const int MaxNameLength = 200;
    public const int ColorHexLength = 7;

    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;

    /// <summary>Kanonik <c>#RRGGBB</c> biçimindeki rota rengi.</summary>
    public string ColorHex { get; set; } = string.Empty;

    public ICollection<TransportStop> Stops { get; set; } = [];

    /// <summary>OSRM tarafından hesaplanan ve rotadan ayrı saklanan güncel yol geometrisi.</summary>
    public TransportRoutePath? Path { get; set; }

    public bool IsActive { get; set; } = true;

    public bool IsDeleted { get; set; }

    public DateTime CreatedDate { get; set; }

    public DateTime ModifiedDate { get; set; }
}
