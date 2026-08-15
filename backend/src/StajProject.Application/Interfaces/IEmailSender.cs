namespace StajProject.Application.Interfaces;

/// <summary>
/// E-posta gönderim soyutlaması. Application katmanı hangi sağlayıcının
/// kullanıldığını bilmez; production'da SMTP/SendGrid gibi bir implementasyon,
/// development'ta yerel bir sink devreye girer.
/// </summary>
public interface IEmailSender
{
    Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default);
}

/// <summary>
/// Gönderilecek e-posta. <see cref="ActionUrl"/> ayrı bir alan olarak taşınır
/// ki development sink'i linki gövdeyi ayrıştırmadan yazabilsin.
/// </summary>
public sealed class EmailMessage
{
    public required string To { get; init; }

    public required string Subject { get; init; }

    public required string Body { get; init; }

    /// <summary>Doğrulama/sıfırlama bağlantısı. Hassastır — loglanmaz.</summary>
    public string? ActionUrl { get; init; }
}
