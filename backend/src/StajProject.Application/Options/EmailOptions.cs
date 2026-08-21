using System.Net.Mail;

namespace StajProject.Application.Options;

/// <summary>
/// Standart SMTP taşıma ayarları. Credential alanları yalnızca User Secrets
/// veya ortam değişkenlerinden gelmelidir; tracked appsettings dosyalarında
/// gerçek değer tutulmaz.
/// </summary>
public sealed class SmtpEmailOptions
{
    public bool Enabled { get; set; }

    public string Host { get; set; } = string.Empty;

    public int Port { get; set; } = 587;

    /// <summary>
    /// <c>true</c>: bağlantı baştan TLS (SMTPS); <c>false</c>: zorunlu STARTTLS.
    /// Her iki mod da şifrelenmiştir; düz metin SMTP kullanılmaz.
    /// </summary>
    public bool UseSsl { get; set; }

    /// <summary>
    /// TLS sertifika iptal durumunu denetler. Güvenli varsayılan <c>true</c>'dur;
    /// yalnızca iptal servisine erişemeyen kontrollü yerel ortamlarda User Secret
    /// ile kapatılmalıdır. Diğer sertifika doğrulamaları bundan etkilenmez.
    /// </summary>
    public bool CheckCertificateRevocation { get; set; } = true;

    public string Username { get; set; } = string.Empty;

    public string Password { get; set; } = string.Empty;

    public string FromAddress { get; set; } = string.Empty;

    public string FromName { get; set; } = "StajProject";

    public int TimeoutSeconds { get; set; } = 30;

    /// <summary>SMTP açıkken eksik ayarla sessizce development sink'ine düşülmesini engeller.</summary>
    public void Validate()
    {
        if (!Enabled)
        {
            return;
        }

        var missing = new List<string>();

        if (string.IsNullOrWhiteSpace(Host)) missing.Add("Email:Smtp:Host");
        if (string.IsNullOrWhiteSpace(Username)) missing.Add("Email:Smtp:Username");
        if (string.IsNullOrWhiteSpace(Password)) missing.Add("Email:Smtp:Password");
        if (string.IsNullOrWhiteSpace(FromAddress)) missing.Add("Email:Smtp:FromAddress");
        if (string.IsNullOrWhiteSpace(FromName)) missing.Add("Email:Smtp:FromName");

        if (missing.Count > 0)
        {
            throw new InvalidOperationException(
                $"SMTP etkin ancak zorunlu ayarlar eksik: {string.Join(", ", missing)}.");
        }

        if (Port is <= 0 or > 65535)
        {
            throw new InvalidOperationException("Email:Smtp:Port 1-65535 arasında olmalıdır.");
        }

        if (TimeoutSeconds is <= 0 or > 300)
        {
            throw new InvalidOperationException("Email:Smtp:TimeoutSeconds 1-300 arasında olmalıdır.");
        }

        if (!MailAddress.TryCreate(FromAddress, out _))
        {
            throw new InvalidOperationException("Email:Smtp:FromAddress geçerli bir e-posta adresi olmalıdır.");
        }
    }
}
