namespace StajProject.Application.Options;

/// <summary>Normal çizim WFS okumaları için secret içermeyen GeoServer ayarları.</summary>
public sealed class GeoServerOptions
{
    public const string SectionName = "GeoServer";

    public string BaseUrl { get; set; } = string.Empty;

    public string Workspace { get; set; } = string.Empty;

    public string PointLayer { get; set; } = string.Empty;

    public string LineLayer { get; set; } = string.Empty;

    public string PolygonLayer { get; set; } = string.Empty;

    public string HeatmapLayer { get; set; } = string.Empty;

    public string HeatmapStyle { get; set; } = string.Empty;

    public int HeatmapTimeoutSeconds { get; set; } = 30;

    /* Normal çizim sunumunun (WMS) style adları. Katman adları WFS okumasıyla
       ORTAKTIR (*_read SQL View'ları) — aynı veri, iki farklı protokol. Style
       adları ayrıdır çünkü sunum, kayıtlı per-feature stilini yeniden üreten
       kendi SLD'lerini kullanır. */

    public string PointPresentationStyle { get; set; } = string.Empty;

    public string LinePresentationStyle { get; set; } = string.Empty;

    public string PolygonPresentationStyle { get; set; } = string.Empty;

    public int PresentationTimeoutSeconds { get; set; } = 30;

    public void Validate()
    {
        if (!Uri.TryCreate(BaseUrl, UriKind.Absolute, out var baseUri)
            || baseUri.Scheme is not ("http" or "https"))
        {
            throw new InvalidOperationException("GeoServer:BaseUrl geçerli bir mutlak HTTP(S) adresi olmalıdır.");
        }

        if (string.IsNullOrWhiteSpace(Workspace)
            || string.IsNullOrWhiteSpace(PointLayer)
            || string.IsNullOrWhiteSpace(LineLayer)
            || string.IsNullOrWhiteSpace(PolygonLayer)
            || string.IsNullOrWhiteSpace(HeatmapLayer)
            || string.IsNullOrWhiteSpace(HeatmapStyle)
            || string.IsNullOrWhiteSpace(PointPresentationStyle)
            || string.IsNullOrWhiteSpace(LinePresentationStyle)
            || string.IsNullOrWhiteSpace(PolygonPresentationStyle))
        {
            throw new InvalidOperationException(
                "GeoServer workspace, drawing layer, heatmap ve sunum style adları tanımlı olmalıdır.");
        }

        if (!IsSafeCatalogName(Workspace)
            || !IsSafeCatalogName(PointLayer)
            || !IsSafeCatalogName(LineLayer)
            || !IsSafeCatalogName(PolygonLayer)
            || !IsSafeCatalogName(HeatmapLayer)
            || !IsSafeCatalogName(HeatmapStyle)
            || !IsSafeCatalogName(PointPresentationStyle)
            || !IsSafeCatalogName(LinePresentationStyle)
            || !IsSafeCatalogName(PolygonPresentationStyle))
        {
            throw new InvalidOperationException(
                "GeoServer catalog adları yalnızca harf, sayı, nokta, tire ve alt çizgi içerebilir.");
        }

        if (HeatmapTimeoutSeconds is < 1 or > 120)
        {
            throw new InvalidOperationException("GeoServer:HeatmapTimeoutSeconds 1 ile 120 arasında olmalıdır.");
        }

        if (PresentationTimeoutSeconds is < 1 or > 120)
        {
            throw new InvalidOperationException("GeoServer:PresentationTimeoutSeconds 1 ile 120 arasında olmalıdır.");
        }
    }

    private static bool IsSafeCatalogName(string value) =>
        value.All(character => char.IsAsciiLetterOrDigit(character) || character is '_' or '-' or '.');
}
