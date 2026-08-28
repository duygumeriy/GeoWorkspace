namespace StajProject.Application.Options;

/// <summary>Tarayıcıdan alınmayan, secret içermeyen OSRM sunucu ayarları.</summary>
public sealed class OsrmOptions
{
    public const string SectionName = "Osrm";

    public string BaseUrl { get; set; } = "http://localhost:5000";

    public string Profile { get; set; } = "driving";

    public int TimeoutSeconds { get; set; } = 30;

    public void Validate()
    {
        if (!Uri.TryCreate(BaseUrl, UriKind.Absolute, out var baseUri)
            || baseUri.Scheme is not ("http" or "https")
            || !string.IsNullOrEmpty(baseUri.Query)
            || !string.IsNullOrEmpty(baseUri.Fragment))
        {
            throw new InvalidOperationException("Osrm:BaseUrl geçerli bir mutlak HTTP(S) adresi olmalıdır.");
        }

        // Bu faz tek sunucu-yönetimli profili kullanır; serbest kullanıcı girdisi kabul edilmez.
        if (!string.Equals(Profile, "driving", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Osrm:Profile bu kurulumda 'driving' olmalıdır.");
        }

        if (TimeoutSeconds is < 1 or > 120)
        {
            throw new InvalidOperationException("Osrm:TimeoutSeconds 1 ile 120 arasında olmalıdır.");
        }
    }
}
