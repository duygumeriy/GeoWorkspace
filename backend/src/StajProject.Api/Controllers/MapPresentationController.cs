using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StajProject.Api.Authorization;
using StajProject.Api.Common;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;

namespace StajProject.Api.Controllers;

/// <summary>
/// Kalıcı çizimlerin haritadaki genel gösterimi: kullanıcıya özel, GeoServer
/// WMS'ten üretilmiş PNG sınırı.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden ısı haritasından ayrı.</b> İkisi farklı sorular sorar ve farklı
/// yetkilere bağlıdır: sunum, kişinin KENDİ çizimlerinin normal görünümüdür ve
/// <c>drawings.view</c> ister; ısı haritası bir ANALİZ ürünüdür,
/// <c>inventory.analysis</c> ister ve coğrafi kapsamla sınırlanır. Aynı
/// controller'a toplanmaları, iki farklı yetki sınırını tek dosyada
/// karıştırmak olurdu.
/// </para>
/// <para>
/// <b>Tür başına ayrı action.</b> Geometry türü rota parametresi olarak
/// istemciden BAĞLANMAZ; her uç kendi <see cref="DrawingKind"/> sabitini
/// taşır. Böylece istemcinin gönderdiği hiçbir metin bir katman/style
/// seçimine dönüşemez. Aynı desen <c>DrawingsController</c>'ın
/// points/lines/polygons uçlarında da kullanılır.
/// </para>
/// </remarks>
[ApiController]
[Authorize]
[Route("api/map")]
public sealed class MapPresentationController : ApiControllerBase
{
    private readonly IGeoServerMapPresentationService _presentation;

    public MapPresentationController(
        IGeoServerMapPresentationService presentation,
        ILogger<MapPresentationController> logger)
        : base(logger)
    {
        _presentation = presentation;
    }

    /* --- Genel gösterim uçları ------------------------------------------------
       Üç render değeri TEK TEK bağlanır; bir model nesnesi bağlanmaz.

       Sebep bir stil tercihi değil, güvenlik davranışıdır: karmaşık bir action
       parametresi bağlanırken PARAMETRE ADI bir sorgu ön eki gibi
       değerlendirilebilir. Bu uçlar bilinçli olarak WMS'e benzeyen bir
       sözleşme sunduğu için istemci `?request=GetFeature` gibi bir anahtar
       gönderebilir — ve parametre adı `request` olduğunda bu anahtar,
       bağlayıcının üst düzey `bbox`/`width`/`height` değerlerini bulmasını
       engelleyebilir. Sonuç, GÜVENLİ ama YANLIŞ bir 400'dür: istemcinin
       gönderdiği çöp bir değer hiçbir zaman GeoServer'a geçmez, ama meşru
       görüntü isteği de üretilemez.

       Parametreyi başka bir adla yeniden adlandırmak yalnızca çakışmayı
       taşırdı; istemci yeni adı da gönderebilir. Bu yüzden uçlar üç skaler
       değeri açıkça sayar ve <see cref="MapPresentationRequest"/> BURADA,
       sunucu tarafında kurulur. Böylece hangi sorgu anahtarının okunduğu
       imzanın kendisinde görünür ve tanınmayan her anahtar — userId, ownerId,
       cql_filter, layers, styles, workspace, service, request, format —
       sessizce yok sayılır. */

    [RequirePermission(PermissionCodes.DrawingsView)]
    [HttpGet("presentation/point")]
    public Task<IActionResult> GetPointImage(
        [FromQuery] string? bbox,
        [FromQuery] int width,
        [FromQuery] int height,
        CancellationToken cancellationToken) =>
        Image(nameof(GetPointImage), DrawingKind.Point, bbox, width, height, cancellationToken);

    [RequirePermission(PermissionCodes.DrawingsView)]
    [HttpGet("presentation/line")]
    public Task<IActionResult> GetLineImage(
        [FromQuery] string? bbox,
        [FromQuery] int width,
        [FromQuery] int height,
        CancellationToken cancellationToken) =>
        Image(nameof(GetLineImage), DrawingKind.Line, bbox, width, height, cancellationToken);

    [RequirePermission(PermissionCodes.DrawingsView)]
    [HttpGet("presentation/polygon")]
    public Task<IActionResult> GetPolygonImage(
        [FromQuery] string? bbox,
        [FromQuery] int width,
        [FromQuery] int height,
        CancellationToken cancellationToken) =>
        Image(nameof(GetPolygonImage), DrawingKind.Polygon, bbox, width, height, cancellationToken);

    private Task<IActionResult> Image(
        string endpoint,
        DrawingKind kind,
        string? bbox,
        int width,
        int height,
        CancellationToken cancellationToken) =>
        GuardAction(endpoint, async () =>
        {
            /* Doğrulama BURADA yapılmaz. Sözleşme tek yerde, servis katmanında
               durur (WmsRenderContract); controller yalnızca hangi üç değerin
               okunduğunu belirler. Eksik bir bbox boş metin olarak geçer ve
               aynı doğrulamadan 400 alır. */
            var request = new MapPresentationRequest
            {
                Bbox = bbox ?? string.Empty,
                Width = width,
                Height = height
            };

            var result = await _presentation.GetPresentationAsync(kind, request, cancellationToken);

            if (!result.IsSuccess)
            {
                return Problem(result);
            }

            /* Yanıt kullanıcıya özeldir: paylaşılan bir ara bellekte durması,
               bir kişinin çizimlerinin başkasına servis edilmesi demek olurdu. */
            Response.Headers.CacheControl = "private, no-store";
            Response.Headers.Pragma = "no-cache";
            return File(result.Value!.Content, "image/png");
        });

    private ObjectResult Problem(ServiceResult<MapPresentationImage> result)
    {
        var statusCode = result.ErrorKind switch
        {
            ServiceErrorKind.Forbidden => StatusCodes.Status403Forbidden,
            ServiceErrorKind.Upstream => StatusCodes.Status502BadGateway,
            ServiceErrorKind.Timeout => StatusCodes.Status504GatewayTimeout,
            _ => StatusCodes.Status400BadRequest
        };

        return StatusCode(
            statusCode,
            ApiError.Create(statusCode, result.Error!, HttpContext.TraceIdentifier));
    }
}
