namespace StajProject.Domain.Common;

/// <summary>
/// tbl_point / tbl_line / tbl_polygon ayrımı. Style alanlarının hangi geometry
/// türü için anlamlı olduğunu tek noktadan belirlemek için kullanılır.
/// </summary>
public enum DrawingKind
{
    Point,
    Line,
    Polygon
}
