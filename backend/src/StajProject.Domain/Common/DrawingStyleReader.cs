namespace StajProject.Domain.Common;

/// <summary>
/// Entity kolonlarından bir çizimin geçerli stilini okur, eksik alanları türün
/// varsayılanıyla tamamlar.
/// <para>
/// Kayıt yolu (PATCH merge tabanı ve response mapping) ile envanter analizi
/// sonucundaki renk aynı okumayı paylaşsın diye ortak yerdedir: aynı kayıt iki
/// ekranda farklı renkte görünemez.
/// </para>
/// </summary>
public static class DrawingStyleReader
{
    /// <summary>
    /// Boş/0 gelen kolonlar "değer yazılmamış" sayılır ve türün varsayılanına
    /// düşer — migration öncesi satırlar da böylece geçerli bir stil üretir.
    /// </summary>
    public static DrawingStyle Read(IStyledDrawingFeature entity, DrawingKind kind)
    {
        var defaults = DrawingStyleDefaults.For(kind);

        return new DrawingStyle(
            string.IsNullOrWhiteSpace(entity.StrokeColor) ? defaults.StrokeColor : entity.StrokeColor,
            entity.StrokeWidth == 0 ? defaults.StrokeWidth : entity.StrokeWidth,
            entity.FillColor ?? defaults.FillColor,
            entity.FillOpacity ?? defaults.FillOpacity,
            (entity as IPointStyledFeature)?.PointRadius ?? defaults.PointRadius,
            entity.LineStyle ?? defaults.LineStyle);
    }
}
