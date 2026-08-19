using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.AspNetCore.Mvc.Controllers;
using StajProject.Application.Activity;
using StajProject.Application.Interfaces;

namespace StajProject.Api.Activity;

/// <summary>
/// Yetki reddiyle biten mutasyon denemelerini de aktivite geçmişine yazar.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden ayrı bir yol gerekti.</b> Yetkilendirme, MVC action filtrelerinden
/// ÖNCE çalışır: policy bir isteği reddettiğinde action hiç çağrılmaz ve
/// <see cref="ActivityLogFilter"/> o isteği hiç görmez. Oysa "yetkisi olmayan
/// biri coğrafi sınırı kaldırmayı denedi" tam olarak bir denetim kaydının
/// var olma sebebidir.
/// </para>
/// <para>
/// <b>Aynı izin listesi kullanılır.</b> Kaydedilecek uçlar yine
/// <see cref="ActivityActionRegistry"/>'den okunur — ayrı bir liste tutulsaydı
/// ikisi zamanla ayrışır ve buradan sızan bir uç, filtrenin hiç kaydetmediği
/// bir yolu kayda açardı. Oturum açma ve parola uçları listede olmadıkları
/// için burada da kaydedilemezler.
/// </para>
/// <para>
/// <b>Anonim istek kaydedilmez.</b> Kimliği olmayan bir 401, aktörü boş bir
/// satır üretirdi; tabloyu şişirir, hiçbir soruyu yanıtlamazdı. Kayıt yalnızca
/// DOĞRULANMIŞ ama yetkisiz bir aktör için yazılır — asıl anlamlı olan da odur.
/// </para>
/// </remarks>
public sealed class ActivityAuthorizationResultHandler : IAuthorizationMiddlewareResultHandler
{
    private readonly AuthorizationMiddlewareResultHandler _inner = new();

    public async Task HandleAsync(
        RequestDelegate next,
        HttpContext context,
        AuthorizationPolicy policy,
        PolicyAuthorizationResult authorizeResult)
    {
        if (!authorizeResult.Succeeded)
        {
            await RecordDenialAsync(context, authorizeResult);
        }

        // Kararın KENDİSİ değişmez: bu tip yalnızca kaydeder, yetkilendirmeye
        // hiçbir şekilde karışmaz.
        await _inner.HandleAsync(next, context, policy, authorizeResult);
    }

    private static async Task RecordDenialAsync(HttpContext context, PolicyAuthorizationResult authorizeResult)
    {
        if (context.User.Identity?.IsAuthenticated != true)
        {
            return;
        }

        if (context.GetEndpoint()?.Metadata.GetMetadata<ControllerActionDescriptor>() is not { } action)
        {
            return;
        }

        var descriptor = ActivityActionRegistry.Find(action.ControllerName, action.ActionName);

        if (descriptor is null)
        {
            return;
        }

        if (context.RequestServices.GetService(typeof(IActivityLogWriter)) is not IActivityLogWriter writer)
        {
            return;
        }

        await writer.WriteAsync(
            new ActivityLogEntry(
                descriptor.Action,
                descriptor.ResourceType,
                ResourceId(context, descriptor),
                context.Request.Method,
                context.Request.Path.Value ?? string.Empty,
                authorizeResult.Challenged
                    ? StatusCodes.Status401Unauthorized
                    : StatusCodes.Status403Forbidden,
                // Model binding henüz olmadı: ayrıntılar yalnızca rotadan.
                ActivityDetails.Build(context.Request.RouteValues, EmptyArguments),
                context.Connection.RemoteIpAddress?.ToString()),
            context.RequestAborted);
    }

    private static readonly IEnumerable<KeyValuePair<string, object?>> EmptyArguments = [];

    private static string? ResourceId(HttpContext context, ActivityActionRegistry.Descriptor descriptor) =>
        descriptor.ResourceRouteKey is not null
            && context.Request.RouteValues.TryGetValue(descriptor.ResourceRouteKey, out var value)
            ? value?.ToString()
            : null;
}
