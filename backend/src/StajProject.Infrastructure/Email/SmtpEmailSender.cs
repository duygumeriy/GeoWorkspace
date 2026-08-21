using System.Net;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Logging;
using MimeKit;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;

namespace StajProject.Infrastructure.Email;

/// <summary>
/// Standart SMTP üzerinden gerçek e-posta gönderir. Brevo Free SMTP dahil
/// kullanıcı adı/şifre ve TLS destekleyen sağlayıcılara özel SDK olmadan bağlanır.
/// </summary>
public sealed class SmtpEmailSender : IEmailSender
{
    private readonly SmtpEmailOptions _options;
    private readonly ILogger<SmtpEmailSender> _logger;

    public SmtpEmailSender(SmtpEmailOptions options, ILogger<SmtpEmailSender> logger)
    {
        _options = options;
        _logger = logger;
    }

    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(message);

        using var client = new SmtpClient();
        ConfigureClient(client, _options);

        try
        {
            var socketOptions = _options.UseSsl
                ? SecureSocketOptions.SslOnConnect
                : SecureSocketOptions.StartTls;

            await client.ConnectAsync(_options.Host, _options.Port, socketOptions, cancellationToken);
            await client.AuthenticateAsync(_options.Username, _options.Password, cancellationToken);
            await client.SendAsync(CreateMimeMessage(_options, message), cancellationToken);
            await client.DisconnectAsync(true, cancellationToken);

            // Recipient, credential ve ActionUrl bilinçli olarak loglanmaz.
            _logger.LogInformation("SMTP e-postası başarıyla teslim edildi.");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            // Exception gövdesi SMTP cevabı içerebilir; log'a yalnız türü yazılır.
            _logger.LogError(
                "SMTP e-posta gönderimi başarısız. HataTürü={ErrorType}",
                exception.GetType().Name);

            throw new EmailDeliveryException("E-posta SMTP sunucusuna teslim edilemedi.", exception);
        }
    }

    internal static void ConfigureClient(SmtpClient client, SmtpEmailOptions options)
    {
        client.Timeout = checked(options.TimeoutSeconds * 1000);
        client.CheckCertificateRevocation = options.CheckCertificateRevocation;

        /* ServerCertificateValidationCallback BİLEREK ayarlanmaz. MailKit'in
           varsayılan hostname, chain ve signature doğrulaması aynen korunur;
           seçenek yalnız sertifika iptal sorgusunu kontrol eder. */
    }

    internal static MimeMessage CreateMimeMessage(SmtpEmailOptions options, EmailMessage message)
    {
        var mimeMessage = new MimeMessage();
        mimeMessage.From.Add(new MailboxAddress(options.FromName, options.FromAddress));
        mimeMessage.To.Add(MailboxAddress.Parse(message.To));
        mimeMessage.Subject = message.Subject;

        var text = message.Body;
        if (!string.IsNullOrWhiteSpace(message.ActionUrl))
        {
            text += $"{Environment.NewLine}{Environment.NewLine}{message.ActionUrl}";
        }

        var encodedBody = WebUtility.HtmlEncode(message.Body)
            .Replace("\r\n", "\n", StringComparison.Ordinal)
            .Replace("\n", "<br>\n", StringComparison.Ordinal);

        var html = $"<p>{encodedBody}</p>";
        if (!string.IsNullOrWhiteSpace(message.ActionUrl))
        {
            var encodedUrl = WebUtility.HtmlEncode(message.ActionUrl);
            html += $"<p><a href=\"{encodedUrl}\">Bağlantıyı aç</a></p>";
        }

        mimeMessage.Body = new BodyBuilder
        {
            TextBody = text,
            HtmlBody = html
        }.ToMessageBody();

        return mimeMessage;
    }
}

/// <summary>SMTP taşımasının kontrollü, credential içermeyen dış hata sınırı.</summary>
public sealed class EmailDeliveryException : Exception
{
    public EmailDeliveryException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
