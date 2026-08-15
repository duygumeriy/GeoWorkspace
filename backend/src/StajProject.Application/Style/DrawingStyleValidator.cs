using System.Text.RegularExpressions;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Domain.Common;

namespace StajProject.Application.Style;

/// <summary>
/// Client'tan gelen stil bilgisini doğrular ve normalize eder.
/// <para>
/// Çıktı daima güvenli bir <see cref="DrawingStyle"/>'dir: renk yalnızca
/// <c>#RRGGBB</c> hex olabilir (keyfi CSS/string kabul edilmez), sayısal
/// alanlar izinli aralıkta olmak zorundadır ve ilgili geometry türü için
/// anlamsız alanlar null'a zorlanır.
/// </para>
/// </summary>
public static partial class DrawingStyleValidator
{
    [GeneratedRegex("^#[0-9A-Fa-f]{6}$", RegexOptions.CultureInvariant)]
    private static partial Regex HexColorRegex();

    /// <summary>
    /// POST için: eksik alanlar türün varsayılanına düşer.
    /// </summary>
    /// <param name="requireStrokeColor">
    /// true ise <c>strokeColor</c> gönderilmek zorundadır ve varsayılana
    /// düşmez. Öznitelik popup'ından gelen yeni kayıtlarda renk zorunlu
    /// olduğu için tekli create bu modu kullanır; toplu geri yükleme
    /// (bulk-create) kullanmaz — orada renk zaten kayıtlı stilden gelir.
    /// </param>
    public static ServiceResult<DrawingStyle> ValidateForCreate(
        DrawingStyleDto? requested,
        DrawingKind kind,
        bool requireStrokeColor = false)
    {
        if (requireStrokeColor && string.IsNullOrWhiteSpace(requested?.StrokeColor))
        {
            return ServiceResult<DrawingStyle>.Failure(
                "strokeColor alanı zorunludur ve #RRGGBB formatında gönderilmelidir.");
        }

        return Merge(requested, DrawingStyleDefaults.For(kind), kind);
    }

    /// <summary>
    /// PATCH için: gönderilmeyen (null) alanlar <paramref name="current"/>
    /// değerini korur. Böylece kısmi güncelleme mümkün olur.
    /// </summary>
    public static ServiceResult<DrawingStyle> ValidateForUpdate(DrawingStyleDto? requested, DrawingStyle current, DrawingKind kind) =>
        Merge(requested, current, kind);

    private static ServiceResult<DrawingStyle> Merge(DrawingStyleDto? requested, DrawingStyle fallback, DrawingKind kind)
    {
        // --- StrokeColor: her türde zorunlu ---
        var strokeColor = fallback.StrokeColor;
        if (requested?.StrokeColor is { } requestedStrokeColor)
        {
            if (!IsHexColor(requestedStrokeColor))
            {
                return ColorFailure(nameof(DrawingStyleDto.StrokeColor));
            }

            strokeColor = Normalize(requestedStrokeColor);
        }

        // --- StrokeWidth ---
        var strokeWidth = fallback.StrokeWidth;
        if (requested?.StrokeWidth is { } requestedStrokeWidth)
        {
            if (requestedStrokeWidth < DrawingStyleDefaults.MinStrokeWidth ||
                requestedStrokeWidth > DrawingStyleDefaults.MaxStrokeWidth)
            {
                return ServiceResult<DrawingStyle>.Failure(
                    $"strokeWidth {DrawingStyleDefaults.MinStrokeWidth} ile {DrawingStyleDefaults.MaxStrokeWidth} arasında olmalıdır.");
            }

            strokeWidth = requestedStrokeWidth;
        }

        // --- FillColor: Point ve Polygon ---
        string? fillColor = null;
        if (DrawingStyleDefaults.SupportsFillColor(kind))
        {
            fillColor = fallback.FillColor;
            if (requested?.FillColor is { } requestedFillColor)
            {
                if (!IsHexColor(requestedFillColor))
                {
                    return ColorFailure(nameof(DrawingStyleDto.FillColor));
                }

                fillColor = Normalize(requestedFillColor);
            }
        }

        // --- FillOpacity: yalnızca Polygon ---
        double? fillOpacity = null;
        if (DrawingStyleDefaults.SupportsFillOpacity(kind))
        {
            fillOpacity = fallback.FillOpacity;
            if (requested?.FillOpacity is { } requestedFillOpacity)
            {
                if (double.IsNaN(requestedFillOpacity) ||
                    requestedFillOpacity < DrawingStyleDefaults.MinFillOpacity ||
                    requestedFillOpacity > DrawingStyleDefaults.MaxFillOpacity)
                {
                    return ServiceResult<DrawingStyle>.Failure(
                        $"fillOpacity {DrawingStyleDefaults.MinFillOpacity:0.0} ile {DrawingStyleDefaults.MaxFillOpacity:0.0} arasında olmalıdır.");
                }

                fillOpacity = requestedFillOpacity;
            }
        }

        // --- PointRadius: yalnızca Point ---
        int? pointRadius = null;
        if (DrawingStyleDefaults.SupportsPointRadius(kind))
        {
            pointRadius = fallback.PointRadius;
            if (requested?.PointRadius is { } requestedPointRadius)
            {
                if (requestedPointRadius < DrawingStyleDefaults.MinPointRadius ||
                    requestedPointRadius > DrawingStyleDefaults.MaxPointRadius)
                {
                    return ServiceResult<DrawingStyle>.Failure(
                        $"pointRadius {DrawingStyleDefaults.MinPointRadius} ile {DrawingStyleDefaults.MaxPointRadius} arasında olmalıdır.");
                }

                pointRadius = requestedPointRadius;
            }
        }

        // --- LineStyle: Line ve Polygon ---
        string? lineStyle = null;
        if (DrawingStyleDefaults.SupportsLineStyle(kind))
        {
            lineStyle = fallback.LineStyle;
            if (requested?.LineStyle is { } requestedLineStyle)
            {
                var candidate = requestedLineStyle.Trim().ToLowerInvariant();
                if (!DrawingStyleDefaults.IsKnownLineStyle(candidate))
                {
                    return ServiceResult<DrawingStyle>.Failure(
                        $"lineStyle yalnızca şu değerlerden biri olabilir: {string.Join(", ", DrawingStyleDefaults.LineStyles)}.");
                }

                lineStyle = candidate;
            }
        }

        return ServiceResult<DrawingStyle>.Success(
            new DrawingStyle(strokeColor, strokeWidth, fillColor, fillOpacity, pointRadius, lineStyle));
    }

    private static bool IsHexColor(string value) => HexColorRegex().IsMatch(value);

    /// <summary>Depolamada tek biçim: büyük harf hex.</summary>
    private static string Normalize(string value) => value.ToUpperInvariant();

    private static ServiceResult<DrawingStyle> ColorFailure(string field) =>
        ServiceResult<DrawingStyle>.Failure($"{char.ToLowerInvariant(field[0])}{field[1..]} yalnızca #RRGGBB formatında olabilir.");
}
