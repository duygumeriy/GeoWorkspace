using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Infrastructure.Email;

namespace StajProject.Auth.Tests;

public class EmailDeliveryTests
{
    [Fact]
    public void Certificate_revocation_check_defaults_to_enabled()
    {
        Assert.True(new SmtpEmailOptions().CheckCertificateRevocation);
    }

    [Fact]
    public void Smtp_disabled_selects_only_the_development_sender()
    {
        using var provider = BuildServices(new Dictionary<string, string?>
        {
            ["Email:Smtp:Enabled"] = "false"
        });

        var senders = provider.GetServices<IEmailSender>().ToArray();

        Assert.Single(senders);
        Assert.IsType<DevelopmentEmailSender>(senders[0]);
    }

    [Fact]
    public void Smtp_enabled_selects_only_the_smtp_sender()
    {
        using var provider = BuildServices(CompleteSmtpConfiguration());

        var senders = provider.GetServices<IEmailSender>().ToArray();

        Assert.Single(senders);
        Assert.IsType<SmtpEmailSender>(senders[0]);
    }

    [Fact]
    public void Smtp_enabled_with_missing_required_configuration_fails_during_registration()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Email:Smtp:Enabled"] = "true",
                ["Email:Smtp:Host"] = "smtp.example.invalid"
            })
            .Build();

        var services = new ServiceCollection();

        var exception = Assert.Throws<InvalidOperationException>(() =>
            services.AddEmailDelivery(configuration, Path.GetTempPath()));

        Assert.Contains("Email:Smtp:Password", exception.Message);
        Assert.DoesNotContain("DevelopmentEmailSender", exception.Message);
    }

    [Fact]
    public void Smtp_message_maps_sender_recipient_subject_text_html_and_action_url()
    {
        var options = new SmtpEmailOptions
        {
            Enabled = true,
            Host = "smtp.example.invalid",
            Port = 587,
            Username = "smtp-user",
            Password = "placeholder-secret",
            FromAddress = "verified-sender@example.invalid",
            FromName = "StajProject"
        };
        var source = new EmailMessage
        {
            To = "recipient@example.invalid",
            Subject = "E-posta doğrulama",
            Body = "Merhaba, hesabınızı doğrulayın.",
            ActionUrl = "https://client.example.invalid/confirm-email?token=test-token"
        };

        var mapped = SmtpEmailSender.CreateMimeMessage(options, source);

        var from = Assert.IsType<MimeKit.MailboxAddress>(Assert.Single(mapped.From));
        var to = Assert.IsType<MimeKit.MailboxAddress>(Assert.Single(mapped.To));
        Assert.Equal(options.FromAddress, from.Address);
        Assert.Equal(options.FromName, from.Name);
        Assert.Equal(source.To, to.Address);
        Assert.Equal(source.Subject, mapped.Subject);
        Assert.Contains(source.Body, mapped.TextBody);
        Assert.Contains(source.ActionUrl, mapped.TextBody);
        Assert.Contains("Bağlantıyı aç", mapped.HtmlBody);
        Assert.Contains(source.ActionUrl, mapped.HtmlBody);
    }

    [Fact]
    public void Configured_false_disables_only_mailkit_revocation_check()
    {
        var configuration = CompleteSmtpConfiguration();
        configuration["Email:Smtp:CheckCertificateRevocation"] = "false";

        using var provider = BuildServices(configuration);
        var options = provider.GetRequiredService<SmtpEmailOptions>();
        using var client = new MailKit.Net.Smtp.SmtpClient();

        SmtpEmailSender.ConfigureClient(client, options);

        Assert.False(options.CheckCertificateRevocation);
        Assert.False(client.CheckCertificateRevocation);
        Assert.Null(client.ServerCertificateValidationCallback);
    }

    [Fact]
    public void Smtp_client_keeps_mailkit_certificate_validation_callback_untouched()
    {
        var options = new SmtpEmailOptions();
        using var client = new MailKit.Net.Smtp.SmtpClient();

        SmtpEmailSender.ConfigureClient(client, options);

        Assert.True(client.CheckCertificateRevocation);
        Assert.Null(client.ServerCertificateValidationCallback);
    }

    private static ServiceProvider BuildServices(IEnumerable<KeyValuePair<string, string?>> values)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(values)
            .Build();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddEmailDelivery(configuration, Path.GetTempPath());
        return services.BuildServiceProvider();
    }

    private static Dictionary<string, string?> CompleteSmtpConfiguration() => new()
    {
        ["Email:Smtp:Enabled"] = "true",
        ["Email:Smtp:Host"] = "smtp.example.invalid",
        ["Email:Smtp:Port"] = "587",
        ["Email:Smtp:UseSsl"] = "false",
        ["Email:Smtp:Username"] = "smtp-user",
        ["Email:Smtp:Password"] = "placeholder-secret",
        ["Email:Smtp:FromAddress"] = "verified-sender@example.invalid",
        ["Email:Smtp:FromName"] = "StajProject"
    };
}
