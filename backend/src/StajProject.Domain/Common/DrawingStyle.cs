namespace StajProject.Domain.Common;

/// <summary>
/// Bir çizimin görünüm bilgisinin taşıyıcısı. Entity'ler bu değerleri ayrı
/// kolonlarda tutar; bu tip yalnızca doğrulama/normalizasyon sırasında bir
/// bütün olarak taşımak içindir.
/// </summary>
public sealed record DrawingStyle(
    string StrokeColor,
    int StrokeWidth,
    string? FillColor,
    double? FillOpacity,
    int? PointRadius,
    string? LineStyle);
