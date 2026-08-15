namespace StajProject.Infrastructure.Authentication;

/// <summary>
/// JWT ayarları. <see cref="Key"/> bir secret'tır; appsettings dosyalarında
/// tutulmaz ve host tarafından User Secrets veya ortam değişkeninden yüklenir.
/// Issuer, audience ve token ömrü secret değildir ve normal yapılandırmada
/// tutulabilir.
/// </summary>
public class JwtOptions
{
    public string Key { get; set; } = string.Empty;

    public string Issuer { get; set; } = string.Empty;

    public string Audience { get; set; } = string.Empty;

    public int ExpireMinutes { get; set; }
}
