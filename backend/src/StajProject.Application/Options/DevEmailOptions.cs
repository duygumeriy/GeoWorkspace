namespace StajProject.Application.Options;

/// <summary>
/// Development e-posta sink ayarı. Secret içermez.
/// </summary>
public class DevEmailOptions
{
    /// <summary>
    /// Gönderilecek iletilerin yazılacağı klasör. Göreli verilirse content
    /// root'a göre çözülür.
    /// </summary>
    public string SinkPath { get; set; } = "dev-emails";
}

/// <summary>
/// Doğrulama/sıfırlama bağlantılarının işaret edeceği frontend adresi.
/// Secret değildir; ortama göre appsettings veya ortam değişkeninden gelir.
/// </summary>
public class ClientAppOptions
{
    public string BaseUrl { get; set; } = "http://localhost:5173";
}
