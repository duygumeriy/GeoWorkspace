using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using StajProject.Application.Activity;
using StajProject.Application.Interfaces;

namespace StajProject.Api.Activity;

/// <summary>
/// Aktivite geçmişinin TEK yazma noktası.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden merkezî bir filtre.</b> Kaydı her controller action'ının içine elle
/// yazmak, yeni bir ucun kaydı unutmasına ve iki kod yolunun (kayıt eden /
/// etmeyen) zamanla ayrışmasına açık kapı bırakırdı. Burada tek bir yer vardır
/// ve neyin kaydedileceği <see cref="ActivityActionRegistry"/> izin
/// listesinden okunur.
/// </para>
/// <para>
/// <b>Filtre okuma isteklerine dokunmaz.</b> Listeleme, detay ve harita
/// çağrıları izin listesinde yoktur; tablo bir istek izi değil, "kim neyi
/// değiştirdi" defteridir.
/// </para>
/// <para>
/// <b>Başarısız denemeler de kaydedilir.</b> Action çalıştıktan sonra ne
/// döndüyse onun durum kodu yazılır: geçersiz geometri (400), bulunamayan
/// hedef (404) ya da servis düzeyindeki bir yetki reddi (403) da denetim
/// olayıdır. <see cref="ActivityAuthorizationResultHandler"/> ise action'a hiç
/// ulaşamayan yetki reddini (policy 401/403) aynı izin listesiyle kaydeder;
/// ikisi birlikte "denendi ama olmadı" durumlarını da kapsar.
/// </para>
/// <para>
/// <b>Kimlik doğrulanmamışsa kayıt yoktur.</b> Anonim bir istek zaten hiçbir
/// mutasyona ulaşamaz; kayıt yazmak, aktörü boş satırlarla tabloyu şişirmek
/// olurdu.
/// </para>
/// </remarks>
public sealed class ActivityLogFilter : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var descriptor = Describe(context);

        if (descriptor is null)
        {
            // İzin listesinde yok: action olduğu gibi çalışır, kayıt oluşmaz.
            await next();
            return;
        }

        /* Ayrıntılar action ÇALIŞMADAN ÖNCE okunur: bir action model-bind
           edilmiş argümanı değiştirebilir ve kayıt, gelen isteği anlatmalıdır. */
        var details = ActivityDetails.Build(context.RouteData.Values!, context.ActionArguments!);

        var executed = await next();

        if (context.HttpContext.User.Identity?.IsAuthenticated != true)
        {
            return;
        }

        var writer = context.HttpContext.RequestServices.GetService(typeof(IActivityLogWriter)) as IActivityLogWriter;

        if (writer is null)
        {
            /* Yazıcı kayıtlı değilse (ör. yalnızca bir ucu ölçen dar bir test
               konağı) kayıt sessizce atlanır. Filtrenin varlığı, uygulamanın
               çalışması için bir ön koşul hâline getirilmez. */
            return;
        }

        await writer.WriteAsync(
            new ActivityLogEntry(
                descriptor.Action,
                descriptor.ResourceType,
                ResourceId(context, descriptor),
                context.HttpContext.Request.Method,
                // Query string BİLİNÇLİ olarak dışarıda: sır taşıyabilir.
                context.HttpContext.Request.Path.Value ?? string.Empty,
                StatusOf(executed),
                details,
                context.HttpContext.Connection.RemoteIpAddress?.ToString()),
            context.HttpContext.RequestAborted);
    }

    /// <summary>Bu action izin listesinde mi.</summary>
    internal static ActivityActionRegistry.Descriptor? Describe(ActionContext context) =>
        context.ActionDescriptor is ControllerActionDescriptor controller
            ? ActivityActionRegistry.Find(controller.ControllerName, controller.ActionName)
            : null;

    private static string? ResourceId(ActionContext context, ActivityActionRegistry.Descriptor descriptor) =>
        descriptor.ResourceRouteKey is null
            ? null
            : context.RouteData.Values.TryGetValue(descriptor.ResourceRouteKey, out var value)
                ? value?.ToString()
                : null;

    /// <summary>
    /// İşlemin sonucu. Yakalanmamış bir istisna 500'dür — controller'ların
    /// ortak hata sınırı bunu zaten bir sonuca çevirir, ama filtre o sınırın
    /// dışında da doğru cevabı vermelidir.
    /// </summary>
    private static int StatusOf(ActionExecutedContext executed)
    {
        if (executed.Exception is not null && !executed.ExceptionHandled)
        {
            return StatusCodes.Status500InternalServerError;
        }

        return executed.Result switch
        {
            IStatusCodeActionResult { StatusCode: { } code } => code,
            // Durum kodu taşımayan sonuçlar (ör. düz ObjectResult) için
            // yanıtın kendi kodu okunur.
            _ => executed.HttpContext.Response.StatusCode
        };
    }
}
