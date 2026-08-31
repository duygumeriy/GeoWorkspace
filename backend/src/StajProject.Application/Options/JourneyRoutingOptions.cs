namespace StajProject.Application.Options;

/// <summary>Tek bir profil için yönlendirme ucu ayarları.</summary>
public sealed class JourneyRouterOptions
{
    public string BaseUrl { get; set; } = string.Empty;

    /// <summary>Motorun URL'sinde kullanılacak profil segmenti.</summary>
    public string Profile { get; set; } = string.Empty;

    public int TimeoutSeconds { get; set; } = 30;
}

/// <summary>
/// Yolculuk planlamasının profil başına yönlendirme yapılandırması.
/// </summary>
/// <remarks>
/// <para>
/// <b>Sürüş bilinçli olarak BURADA DEĞİLDİR.</b> Sürüş, mevcut <c>Osrm</c>
/// bölümünü kullanır; böylece çalışan kurulumlar hiçbir yapılandırma değişikliği
/// yapmadan sürüş yolculuğu planlayabilir ve Akıllı Ulaşım'ın güzergah üretimi
/// aynı ayarla çalışmaya devam eder.
/// </para>
/// <para>
/// <b>Yürüyüş ve bisiklet İSTEĞE BAĞLIDIR.</b> Bölüm yoksa uygulama sorunsuz
/// başlar ve o profiller yalnızca "kullanılamıyor" olarak bildirilir. Zorunlu
/// kılmak, tek OSRM örneğiyle çalışan mevcut kurulumları kırardı.
/// </para>
/// <para>
/// <b>Neden ayrı uç zorunlu.</b> Yerel OSRM <c>car.lua</c> ile derlenir ve
/// <c>osrm-routed</c> adresteki profil segmentini YOK SAYAR. Aynı sunucuya
/// farklı bir profil adıyla gitmek sürüş sonucu üretir; bu yüzden
/// <see cref="Validate"/> yürüyüş/bisiklet adresinin sürüş adresiyle AYNI
/// olmasını reddeder — sessiz bir sürüş düşüşünü yapılandırmayla üretmek
/// mümkün olmamalıdır.
/// </para>
/// </remarks>
public sealed class JourneyRoutingOptions
{
    public const string SectionName = "JourneyRouting";

    public JourneyRouterOptions? Walking { get; set; }

    public JourneyRouterOptions? Cycling { get; set; }

    /// <summary>
    /// Yapılandırılmış uçları doğrular (fail-fast). Yapılandırılmamış profiller
    /// hata DEĞİLDİR; yalnızca kullanılamaz sayılırlar.
    /// </summary>
    /// <param name="drivingBaseUrl">Mevcut <c>Osrm:BaseUrl</c>.</param>
    public void Validate(string? drivingBaseUrl)
    {
        Validate(Walking, nameof(Walking), drivingBaseUrl);
        Validate(Cycling, nameof(Cycling), drivingBaseUrl);

        if (Walking is not null && Cycling is not null
            && SameEndpoint(Walking.BaseUrl, Cycling.BaseUrl))
        {
            throw new InvalidOperationException(
                "JourneyRouting:Walking ve JourneyRouting:Cycling aynı adrese işaret edemez; "
                + "tek bir OSRM örneği yalnızca derlendiği profili yönlendirir.");
        }
    }

    private static void Validate(JourneyRouterOptions? options, string name, string? drivingBaseUrl)
    {
        if (options is null)
        {
            return;
        }

        var section = $"{SectionName}:{name}";

        if (!Uri.TryCreate(options.BaseUrl, UriKind.Absolute, out var baseUri)
            || baseUri.Scheme is not ("http" or "https")
            || !string.IsNullOrEmpty(baseUri.Query)
            || !string.IsNullOrEmpty(baseUri.Fragment))
        {
            throw new InvalidOperationException($"{section}:BaseUrl geçerli bir mutlak HTTP(S) adresi olmalıdır.");
        }

        if (string.IsNullOrWhiteSpace(options.Profile)
            || options.Profile.Any(character => !char.IsAsciiLetter(character)))
        {
            throw new InvalidOperationException($"{section}:Profile yalnızca harflerden oluşan bir profil adı olmalıdır.");
        }

        if (options.TimeoutSeconds is < 1 or > 120)
        {
            throw new InvalidOperationException($"{section}:TimeoutSeconds 1 ile 120 arasında olmalıdır.");
        }

        /* Sessiz sürüş düşüşünün yapılandırma yoluyla üretilmesini engeller:
           sürüş sunucusunu yürüyüş ucu olarak göstermek, sürüş sonucunu
           yürüyüş diye etiketlemek olurdu. */
        if (SameEndpoint(options.BaseUrl, drivingBaseUrl))
        {
            throw new InvalidOperationException(
                $"{section}:BaseUrl, sürüş için yapılandırılmış Osrm:BaseUrl ile aynı olamaz. "
                + "Yürüyüş/bisiklet, ilgili profille derlenmiş AYRI bir yönlendirme sunucusu gerektirir.");
        }
    }

    private static bool SameEndpoint(string? left, string? right) =>
        !string.IsNullOrWhiteSpace(left)
        && !string.IsNullOrWhiteSpace(right)
        && Uri.TryCreate(left, UriKind.Absolute, out var leftUri)
        && Uri.TryCreate(right, UriKind.Absolute, out var rightUri)
        && Uri.Compare(
            leftUri,
            rightUri,
            UriComponents.SchemeAndServer | UriComponents.Path,
            UriFormat.SafeUnescaped,
            StringComparison.OrdinalIgnoreCase) == 0;
}
