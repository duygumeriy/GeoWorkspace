using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;

namespace StajProject.Infrastructure.Email;

/// <summary>E-posta taşımasını yapılandırmaya göre tek bir <see cref="IEmailSender"/> olarak kaydeder.</summary>
public static class EmailServiceCollectionExtensions
{
    public static IServiceCollection AddEmailDelivery(
        this IServiceCollection services,
        IConfiguration configuration,
        string contentRootPath)
    {
        var smtp = configuration.GetSection("Email:Smtp").Get<SmtpEmailOptions>()
            ?? new SmtpEmailOptions();

        smtp.Validate();
        services.AddSingleton(smtp);

        if (smtp.Enabled)
        {
            services.AddScoped<IEmailSender, SmtpEmailSender>();
            return services;
        }

        var development = configuration.GetSection("DevEmail").Get<DevEmailOptions>()
            ?? new DevEmailOptions();

        development.SinkPath = Path.IsPathRooted(development.SinkPath)
            ? development.SinkPath
            : Path.Combine(contentRootPath, development.SinkPath);

        services.AddSingleton(development);
        services.AddScoped<IEmailSender, DevelopmentEmailSender>();

        return services;
    }
}
