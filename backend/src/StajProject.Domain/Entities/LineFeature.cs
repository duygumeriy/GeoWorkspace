using NetTopologySuite.Geometries;
using StajProject.Domain.Common;

namespace StajProject.Domain.Entities;

/// <summary>tbl_line — geometry(LineString,4326).</summary>
public class LineFeature : IDrawingFeature<LineString>
{
    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public LineString Geometry { get; set; } = null!;

    public string StrokeColor { get; set; } = DrawingStyleDefaults.StrokeColor;

    public int StrokeWidth { get; set; } = DrawingStyleDefaults.StrokeWidth;

    /// <summary>Çizgi için dolgu yok; kolon nullable.</summary>
    public string? FillColor { get; set; }

    /// <summary>Çizgi için dolgu yok; kolon nullable.</summary>
    public double? FillOpacity { get; set; }

    public string? LineStyle { get; set; } = DrawingStyleDefaults.LineStyle;

    public DateTime CreatedDate { get; set; }

    public DateTime ModifiedDate { get; set; }

    /// <summary>Ownership'in tek otoritesi; doğrulanmış JWT'den gelir.</summary>
    public int CreatedByUserId { get; set; }

    public User? CreatedByUser { get; set; }

    /// <summary>Legacy görüntüleme alanı; yetkilendirmede kullanılmaz.</summary>
    public string CreatedBy { get; set; } = string.Empty;

    /// <summary>Soft delete işareti; silinen satır korunur, gizlenir.</summary>
    public bool IsDeleted { get; set; }

    public DateTime? DeletedAt { get; set; }

    /// <summary>Silme işlemini yapan kullanıcı; sahiplikten bağımsızdır.</summary>
    public int? DeletedByUserId { get; set; }
}
