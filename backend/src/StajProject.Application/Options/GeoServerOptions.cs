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
            || string.IsNullOrWhiteSpace(PolygonLayer))
        {
            throw new InvalidOperationException(
                "GeoServer workspace ve point/line/polygon layer adları tanımlı olmalıdır.");
        }
    }
}
