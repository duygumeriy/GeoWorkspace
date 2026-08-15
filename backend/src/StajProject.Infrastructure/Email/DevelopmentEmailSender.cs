using System.Text;
using Microsoft.Extensions.Logging;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;

namespace StajProject.Infrastructure.Email;

/// <summary>
/// Development sink. <b>Gerçek e-posta göndermez</b> — gönderilecek iletiyi
/// yerel bir dosyaya yazar, böylece doğrulama/sıfırlama bağlantısı
/// geliştirici tarafından kullanılabilir olur.
/// </summary>
/// <remarks>
/// Bağlantı ve token kasıtlı olarak <b>uygulama log'una yazılmaz</b>; log'lar
/// paylaşılabilir/toplanabilir olduğu için token sızdırmaya en açık yerdir.
/// Log'a yalnızca "şu dosyaya yazıldı" bilgisi düşer, token dosyada kalır.
/// Production'da bu sınıfın yerini gerçek bir sağlayıcı implementasyonu alır;
/// credential'ları AUTH-1.1'deki gibi user-secrets/ortam değişkeninden okur.
/// </remarks>
public class DevelopmentEmailSender : IEmailSender
{
    private readonly DevEmailOptions _options;
    private readonly ILogger<DevelopmentEmailSender> _logger;

    public DevelopmentEmailSender(DevEmailOptions options, ILogger<DevelopmentEmailSender> logger)
    {
        _options = options;
        _logger = logger;
    }

    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(_options.SinkPath);

        var fileName = $"{DateTime.UtcNow:yyyyMMdd-HHmmss-fff}-{Sanitize(message.To)}.txt";
        var fullPath = Path.Combine(_options.SinkPath, fileName);

        var content = new StringBuilder()
            .AppendLine("*** DEVELOPMENT SINK — BU E-POSTA GERÇEKTE GÖNDERİLMEDİ ***")
            .AppendLine($"Tarih (UTC): {DateTime.UtcNow:O}")
            .AppendLine($"Kime       : {message.To}")
            .AppendLine($"Konu       : {message.Subject}")
            .AppendLine()
            .AppendLine(message.Body)
            .ToString();

        if (message.ActionUrl is not null)
        {
            content += Environment.NewLine + "Bağlantı:" + Environment.NewLine + message.ActionUrl + Environment.NewLine;
        }

        await File.WriteAllTextAsync(fullPath, content, cancellationToken);

        // Dikkat: token/bağlantı BURAYA yazılmaz.
        _logger.LogInformation(
            "Development e-posta sink'e yazıldı (gerçek gönderim yapılmadı). Konu={Subject} Dosya={File}",
            message.Subject,
            fullPath);
    }

    private static string Sanitize(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        return new string(value.Select(c => invalid.Contains(c) || c == '@' ? '_' : c).ToArray());
    }
}
