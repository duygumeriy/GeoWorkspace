namespace StajProject.Application.DTOs;

/// <summary>
/// Çizim stilinin API kontratı. İki yönde de kullanılır:
/// <list type="bullet">
/// <item>İstek (POST içindeki <c>style</c> / PATCH gövdesi): tüm alanlar
/// opsiyoneldir. Gönderilmeyen (null) alan POST'ta varsayılana düşer,
/// PATCH'te mevcut değerini korur.</item>
/// <item>Yanıt: ilgili geometry türü için anlamlı alanlar dolu, anlamsız
/// olanlar (ör. Line için <c>fillColor</c>) null döner.</item>
/// </list>
/// </summary>
public class DrawingStyleDto
{
    /// <summary>#RRGGBB formatında hex renk.</summary>
    public string? StrokeColor { get; set; }

    /// <summary>1 – 12 px.</summary>
    public int? StrokeWidth { get; set; }

    /// <summary>#RRGGBB. Yalnızca Point ve Polygon için anlamlı.</summary>
    public string? FillColor { get; set; }

    /// <summary>0.0 – 1.0. Yalnızca Polygon için anlamlı.</summary>
    public double? FillOpacity { get; set; }

    /// <summary>3 – 20 px. Yalnızca Point için anlamlı.</summary>
    public int? PointRadius { get; set; }

    /// <summary>solid | dashed | dotted | dashdot. Yalnızca Line ve Polygon için anlamlı.</summary>
    public string? LineStyle { get; set; }
}
