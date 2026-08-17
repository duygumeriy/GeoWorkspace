using Microsoft.AspNetCore.Mvc;

namespace StajProject.Api.Common;

/// <summary>
/// Tüm API controller'larının ortak hata sınırı.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden burada.</b> Her endpoint'in beklenmeyen bir hatada aynı şekilde
/// davranması istenir: sunucuda tam detayıyla loglanmalı, istemciye ise stack
/// trace sızdırmayan tek tip bir 500 gövdesi dönmelidir. Aynı try-catch bloğunu
/// onlarca action'a elle kopyalamak yerine sınır tek yerde tanımlanır; böylece
/// eklenen her yeni uç aynı davranışı otomatik alır ve bir yerde bloğu yazmayı
/// unutma riski kalmaz.
/// </para>
/// <para>
/// <b>Sınır yalnızca beklenmeyen hatalar içindir.</b> İş kuralı sonuçları
/// (doğrulama, bulunamadı, yetkisiz, çakışma) exception değildir — servis
/// katmanı onları sonuç tipiyle döndürür ve controller kendi eşlemesiyle
/// 400/401/403/404/409'a çevirir. Buradaki catch bu eşlemeye karışmaz.
/// </para>
/// </remarks>
public abstract class ApiControllerBase : ControllerBase
{
    private readonly ILogger _logger;

    protected ApiControllerBase(ILogger logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Değer döndüren uçların hata sınırı. <paramref name="action"/> içinde
    /// endpoint'in mevcut HTTP eşlemesi aynen korunur.
    /// </summary>
    protected async Task<ActionResult<TValue>> Guard<TValue>(
        string endpoint,
        Func<Task<ActionResult<TValue>>> action)
    {
        try
        {
            return await action();
        }
        catch (Exception exception)
        {
            return Unexpected(endpoint, exception);
        }
    }

    /// <summary>
    /// <see cref="IActionResult"/> döndüren uçlar için aynı sınır. Ayrı ad
    /// kullanılır ki lambda'lar iki aşırı yükleme arasında belirsiz kalmasın.
    /// </summary>
    protected async Task<IActionResult> GuardAction(string endpoint, Func<Task<IActionResult>> action)
    {
        try
        {
            return await action();
        }
        catch (Exception exception)
        {
            return Unexpected(endpoint, exception);
        }
    }

    /// <summary>
    /// Beklenmeyen hata: sunucuda tam detayıyla loglanır, istemciye yalnızca
    /// izlenebilir bir traceId ile genel mesaj döner. Stack trace, exception
    /// tipi ve iç mesaj dışarı ÇIKMAZ.
    /// </summary>
    protected ObjectResult Unexpected(string endpoint, Exception exception)
    {
        var traceId = HttpContext.TraceIdentifier;

        /* İstemcinin isteği iptal etmesi bir sunucu hatası değildir; bağlantı
           koptuğu için gövde zaten karşı tarafa ulaşmaz. Yanıt sözleşmesi
           değişmez, yalnızca log seviyesi ayrılır — böylece error logları
           gerçek arızaları gösterir. */
        if (exception is OperationCanceledException && HttpContext.RequestAborted.IsCancellationRequested)
        {
            _logger.LogInformation(
                "İstek istemci tarafından iptal edildi. Controller: {Controller}, Endpoint: {Endpoint}, TraceId: {TraceId}",
                GetType().Name,
                endpoint,
                traceId);
        }
        else
        {
            _logger.LogError(
                exception,
                "Beklenmeyen hata. Controller: {Controller}, Endpoint: {Endpoint}, TraceId: {TraceId}",
                GetType().Name,
                endpoint,
                traceId);
        }

        return StatusCode(
            StatusCodes.Status500InternalServerError,
            ApiError.Create(
                StatusCodes.Status500InternalServerError,
                "Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.",
                traceId));
    }
}
