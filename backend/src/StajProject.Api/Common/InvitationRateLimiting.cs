using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace StajProject.Api.Common;

/// <summary>Phase 13D davet/tekrar-gönderim uçlarının dar rate-limit politikaları.</summary>
public static class InvitationRateLimiting
{
    public const string AdminResendPolicy = "AdminInvitationResend";
    public const string PublicConfirmationResendPolicy = "PublicConfirmationResend";

    public static IServiceCollection AddInvitationRateLimiting(this IServiceCollection services) =>
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

            options.AddPolicy(AdminResendPolicy, context =>
            {
                var actor = context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "anonymous";
                var target = context.Request.RouteValues["id"]?.ToString() ?? "unknown";
                return FixedWindow($"{actor}:{target}");
            });

            /* Public uçta e-posta adresi partition key/log verisine alınmaz.
               Coarse IP partition enumeration-resistant yanıtı değiştirmez. */
            options.AddPolicy(PublicConfirmationResendPolicy, context =>
                FixedWindow(context.Connection.RemoteIpAddress?.ToString() ?? "unknown"));
        });

    private static RateLimitPartition<string> FixedWindow(string key) =>
        RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 1,
            Window = TimeSpan.FromSeconds(60),
            QueueLimit = 0,
            AutoReplenishment = true
        });
}
