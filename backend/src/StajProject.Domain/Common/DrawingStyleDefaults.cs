namespace StajProject.Domain.Common;

/// <summary>
/// Çizim stilinin TEK kaynağı: varsayılan değerler, izinli aralıklar ve hangi
/// alanın hangi geometry türü için anlamlı olduğu burada tanımlıdır.
/// Backend'in başka hiçbir yerinde bu sabitler tekrar yazılmaz; frontend de
/// aynı değerleri kendi tek config dosyasından okur.
/// </summary>
public static class DrawingStyleDefaults
{
    public const string StrokeColor = "#6D4AFF";
    public const int StrokeWidth = 3;
    public const string FillColor = "#7C5CFF";
    public const double FillOpacity = 0.25;
    public const int PointRadius = 7;
    public const string LineStyle = "solid";

    public const int MinStrokeWidth = 1;
    public const int MaxStrokeWidth = 12;

    public const double MinFillOpacity = 0.0;
    public const double MaxFillOpacity = 1.0;

    public const int MinPointRadius = 3;
    public const int MaxPointRadius = 20;

    /// <summary>Client'tan kabul edilen tek geçerli LineStyle kümesi.</summary>
    public static readonly IReadOnlyList<string> LineStyles = new[] { "solid", "dashed", "dotted", "dashdot" };

    public static bool IsKnownLineStyle(string value) =>
        LineStyles.Contains(value, StringComparer.Ordinal);

    /// <summary>FillColor / FillOpacity yalnızca bu türlerde anlamlıdır.</summary>
    public static bool SupportsFillColor(DrawingKind kind) => kind is DrawingKind.Point or DrawingKind.Polygon;

    public static bool SupportsFillOpacity(DrawingKind kind) => kind is DrawingKind.Polygon;

    /// <summary>PointRadius yalnızca tbl_point'te kolon olarak vardır.</summary>
    public static bool SupportsPointRadius(DrawingKind kind) => kind is DrawingKind.Point;

    /// <summary>LineStyle nokta için anlamsızdır (dash pattern uygulanamaz).</summary>
    public static bool SupportsLineStyle(DrawingKind kind) => kind is DrawingKind.Line or DrawingKind.Polygon;

    /// <summary>
    /// İlgili geometry türü için varsayılan stil. Uygulanabilir olmayan alanlar
    /// null döner; böylece "Line için FillColor null" kuralı tek yerde durur.
    /// </summary>
    public static DrawingStyle For(DrawingKind kind) => new(
        StrokeColor,
        StrokeWidth,
        SupportsFillColor(kind) ? FillColor : null,
        SupportsFillOpacity(kind) ? FillOpacity : null,
        SupportsPointRadius(kind) ? PointRadius : null,
        SupportsLineStyle(kind) ? LineStyle : null);
}
