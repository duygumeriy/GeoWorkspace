using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StajProject.Api.Common;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;

namespace StajProject.Api.Controllers;

/// <summary>
/// Çizim uçları. Her endpoint aynı üç adımı izler: servisi çağır, sonucu HTTP
/// karşılığına çevir, beklenmeyen exception'ı yakala.
/// </summary>
/// <remarks>
/// <para>
/// <b>Hata yönetimi.</b> Tüm uçlar try-catch ile sarılıdır. İş kuralı hataları
/// (doğrulama, bulunamadı, yetkisiz) exception değildir — servis katmanı onları
/// <see cref="ServiceResult{T}"/> ile döndürür ve <c>Problem</c> uygun HTTP
/// koduna çevirir. Catch blokları yalnızca <i>beklenmeyen</i> hatalar içindir:
/// loglanır ve istemciye stack trace sızdırmayan tek tip 500 gövdesi döner.
/// </para>
/// <para>
/// <b>İş mantığı controller'a taşınmaz.</b> Buradaki hiçbir metot veritabanına
/// dokunmaz, geometry doğrulamaz veya sahiplik kararı vermez; hepsi
/// <see cref="IDrawingService"/> içindedir. Controller yalnızca HTTP sınırıdır.
/// </para>
/// </remarks>
[ApiController]
[Authorize]
[Route("api/drawings")]
public class DrawingsController : ControllerBase
{
    private readonly IDrawingService _drawingService;
    private readonly ILogger<DrawingsController> _logger;

    public DrawingsController(IDrawingService drawingService, ILogger<DrawingsController> logger)
    {
        _drawingService = drawingService;
        _logger = logger;
    }

    /* --- Create ------------------------------------------------------------- */

    [HttpPost("point")]
    public Task<ActionResult<DrawingResponse>> CreatePoint([FromBody] CreateDrawingRequest request, CancellationToken cancellationToken) =>
        GuardCreate(nameof(CreatePoint), () => _drawingService.CreatePointAsync(request, cancellationToken));

    [HttpPost("line")]
    public Task<ActionResult<DrawingResponse>> CreateLine([FromBody] CreateDrawingRequest request, CancellationToken cancellationToken) =>
        GuardCreate(nameof(CreateLine), () => _drawingService.CreateLineAsync(request, cancellationToken));

    [HttpPost("polygon")]
    public Task<ActionResult<DrawingResponse>> CreatePolygon([FromBody] CreateDrawingRequest request, CancellationToken cancellationToken) =>
        GuardCreate(nameof(CreatePolygon), () => _drawingService.CreatePolygonAsync(request, cancellationToken));

    /* --- Read ---------------------------------------------------------------
       Servis yalnızca ÇAĞIRAN kullanıcının silinmemiş ve aktif kayıtlarını
       döndürür; filtre veritabanı sorgusundadır, burada değil. */

    [HttpGet("points")]
    public Task<ActionResult<IReadOnlyList<DrawingResponse>>> GetPoints(CancellationToken cancellationToken) =>
        GuardList(nameof(GetPoints), () => _drawingService.GetPointsAsync(cancellationToken));

    [HttpGet("lines")]
    public Task<ActionResult<IReadOnlyList<DrawingResponse>>> GetLines(CancellationToken cancellationToken) =>
        GuardList(nameof(GetLines), () => _drawingService.GetLinesAsync(cancellationToken));

    [HttpGet("polygons")]
    public Task<ActionResult<IReadOnlyList<DrawingResponse>>> GetPolygons(CancellationToken cancellationToken) =>
        GuardList(nameof(GetPolygons), () => _drawingService.GetPolygonsAsync(cancellationToken));

    /* --- Detay düzenleme: ad + renk + geometry ------------------------------
       Detay popup'ının "Kaydet" aksiyonu buraya gelir. Gönderilmeyen alanlar
       korunur, sahiplik istek gövdesinden DEĞİL veritabanından okunur. */

    [HttpPut("point/{id:int}")]
    public Task<ActionResult<DrawingResponse>> UpdatePoint(int id, [FromBody] UpdateDrawingRequest request, CancellationToken cancellationToken) =>
        GuardUpdate(nameof(UpdatePoint), () => _drawingService.UpdateAsync(DrawingKind.Point, id, request, cancellationToken));

    [HttpPut("line/{id:int}")]
    public Task<ActionResult<DrawingResponse>> UpdateLine(int id, [FromBody] UpdateDrawingRequest request, CancellationToken cancellationToken) =>
        GuardUpdate(nameof(UpdateLine), () => _drawingService.UpdateAsync(DrawingKind.Line, id, request, cancellationToken));

    [HttpPut("polygon/{id:int}")]
    public Task<ActionResult<DrawingResponse>> UpdatePolygon(int id, [FromBody] UpdateDrawingRequest request, CancellationToken cancellationToken) =>
        GuardUpdate(nameof(UpdatePolygon), () => _drawingService.UpdateAsync(DrawingKind.Polygon, id, request, cancellationToken));

    /* --- Style update: yalnızca görünüm kolonları, geometry değişmez --------- */

    [HttpPatch("point/{id:int}/style")]
    public Task<ActionResult<DrawingResponse>> UpdatePointStyle(int id, [FromBody] DrawingStyleDto style, CancellationToken cancellationToken) =>
        GuardUpdate(nameof(UpdatePointStyle), () => _drawingService.UpdateStyleAsync(DrawingKind.Point, id, style, cancellationToken));

    [HttpPatch("line/{id:int}/style")]
    public Task<ActionResult<DrawingResponse>> UpdateLineStyle(int id, [FromBody] DrawingStyleDto style, CancellationToken cancellationToken) =>
        GuardUpdate(nameof(UpdateLineStyle), () => _drawingService.UpdateStyleAsync(DrawingKind.Line, id, style, cancellationToken));

    [HttpPatch("polygon/{id:int}/style")]
    public Task<ActionResult<DrawingResponse>> UpdatePolygonStyle(int id, [FromBody] DrawingStyleDto style, CancellationToken cancellationToken) =>
        GuardUpdate(nameof(UpdatePolygonStyle), () => _drawingService.UpdateStyleAsync(DrawingKind.Polygon, id, style, cancellationToken));

    /* --- Delete (soft) ------------------------------------------------------
       Satır tablodan kaldırılmaz: is_deleted = true, is_active = false. */

    [HttpDelete("point/{id:int}")]
    public Task<IActionResult> DeletePoint(int id, CancellationToken cancellationToken) =>
        GuardDelete(nameof(DeletePoint), () => _drawingService.DeleteAsync(DrawingKind.Point, id, cancellationToken));

    [HttpDelete("line/{id:int}")]
    public Task<IActionResult> DeleteLine(int id, CancellationToken cancellationToken) =>
        GuardDelete(nameof(DeleteLine), () => _drawingService.DeleteAsync(DrawingKind.Line, id, cancellationToken));

    [HttpDelete("polygon/{id:int}")]
    public Task<IActionResult> DeletePolygon(int id, CancellationToken cancellationToken) =>
        GuardDelete(nameof(DeletePolygon), () => _drawingService.DeleteAsync(DrawingKind.Polygon, id, cancellationToken));

    /* --- Toplu işlemler: hepsi ya da hiçbiri (tek transaction) -------------- */

    /// <summary>
    /// Seçili kayıtları tek transaction içinde siler. Bir id bulunamazsa
    /// hiçbir kayıt silinmez ve 404 döner — frontend yarım state'e düşmez.
    /// </summary>
    [HttpPost("bulk-delete")]
    public Task<ActionResult<BulkDeleteResponse>> BulkDelete([FromBody] BulkDeleteRequest request, CancellationToken cancellationToken) =>
        GuardOk(nameof(BulkDelete), () => _drawingService.BulkDeleteAsync(request, cancellationToken));

    /// <summary>Seçili kayıtların yalnızca stil kolonlarını tek transaction içinde günceller.</summary>
    [HttpPatch("bulk-style")]
    public Task<ActionResult<BulkDrawingsResponse>> BulkStyle([FromBody] BulkStyleRequest request, CancellationToken cancellationToken) =>
        GuardOk(nameof(BulkStyle), () => _drawingService.BulkUpdateStyleAsync(request, cancellationToken));

    /// <summary>
    /// Silmenin geri alınması (undo): soft-delete edilmiş kayıtları geri açar.
    /// </summary>
    /// <remarks>
    /// Yeni kayıt OLUŞTURMAZ. Kayıt sunucuda zaten mevcut olduğu için sahiplik,
    /// geometry, ad ve stil korunur; istek yalnızca hangi kayıtların geri
    /// açılacağını (tür + id) taşır. Yetki kaydın orijinal sahibine göre
    /// değerlendirilir: sahibi veya Admin geri açabilir, başkası 403 alır.
    /// </remarks>
    [HttpPost("restore")]
    public Task<ActionResult<BulkDrawingsResponse>> Restore([FromBody] BulkRestoreRequest request, CancellationToken cancellationToken) =>
        GuardOk(nameof(Restore), () => _drawingService.RestoreAsync(request, cancellationToken));

    /// <summary>Birden çok YENİ kayıt oluşturur; sahipleri daima çağıran kullanıcıdır.</summary>
    [HttpPost("bulk-create")]
    public Task<ActionResult<BulkDrawingsResponse>> BulkCreate([FromBody] BulkCreateRequest request, CancellationToken cancellationToken) =>
        GuardCreated(nameof(BulkCreate), () => _drawingService.BulkCreateAsync(request, cancellationToken));

    /* --- Ortak hata sınırı ---------------------------------------------------
       Aşağıdaki Guard* yardımcıları hocanın istediği try-catch standardını tek
       yerde uygular. Her endpoint'e aynı bloğu elle kopyalamak yerine tek bir
       tanım kullanılır: eklenen her yeni uç aynı davranışı otomatik alır ve
       hiçbirinde blok yazmayı unutma riski kalmaz. */

    private async Task<ActionResult<DrawingResponse>> GuardCreate(
        string endpoint,
        Func<Task<ServiceResult<DrawingResponse>>> action)
    {
        try
        {
            var result = await action();

            return result.IsSuccess
                ? StatusCode(StatusCodes.Status201Created, result.Value)
                : Problem(result);
        }
        catch (Exception exception)
        {
            return Unexpected<DrawingResponse>(endpoint, exception);
        }
    }

    private async Task<ActionResult<DrawingResponse>> GuardUpdate(
        string endpoint,
        Func<Task<ServiceResult<DrawingResponse>>> action)
    {
        try
        {
            var result = await action();
            return result.IsSuccess ? Ok(result.Value) : Problem(result);
        }
        catch (Exception exception)
        {
            return Unexpected<DrawingResponse>(endpoint, exception);
        }
    }

    private async Task<IActionResult> GuardDelete(string endpoint, Func<Task<ServiceResult<int>>> action)
    {
        try
        {
            var result = await action();
            return result.IsSuccess ? NoContent() : Problem(result);
        }
        catch (Exception exception)
        {
            return Unexpected<int>(endpoint, exception).Result!;
        }
    }

    private async Task<ActionResult<IReadOnlyList<DrawingResponse>>> GuardList(
        string endpoint,
        Func<Task<IReadOnlyList<DrawingResponse>>> action)
    {
        try
        {
            return Ok(await action());
        }
        catch (Exception exception)
        {
            return Unexpected<IReadOnlyList<DrawingResponse>>(endpoint, exception);
        }
    }

    private async Task<ActionResult<TValue>> GuardOk<TValue>(
        string endpoint,
        Func<Task<ServiceResult<TValue>>> action)
    {
        try
        {
            var result = await action();
            return result.IsSuccess ? Ok(result.Value) : Problem(result);
        }
        catch (Exception exception)
        {
            return Unexpected<TValue>(endpoint, exception);
        }
    }

    private async Task<ActionResult<TValue>> GuardCreated<TValue>(
        string endpoint,
        Func<Task<ServiceResult<TValue>>> action)
    {
        try
        {
            var result = await action();

            return result.IsSuccess
                ? StatusCode(StatusCodes.Status201Created, result.Value)
                : Problem(result);
        }
        catch (Exception exception)
        {
            return Unexpected<TValue>(endpoint, exception);
        }
    }

    /// <summary>
    /// Beklenmeyen hata: sunucuda tam detayıyla loglanır, istemciye yalnızca
    /// izlenebilir bir traceId ile genel mesaj döner. Stack trace, exception
    /// tipi ve iç mesaj dışarı ÇIKMAZ.
    /// </summary>
    private ActionResult<TValue> Unexpected<TValue>(string endpoint, Exception exception)
    {
        var traceId = HttpContext.TraceIdentifier;

        _logger.LogError(
            exception,
            "Çizim ucunda beklenmeyen hata. Endpoint: {Endpoint}, TraceId: {TraceId}",
            endpoint,
            traceId);

        return StatusCode(
            StatusCodes.Status500InternalServerError,
            ApiError.Create(StatusCodes.Status500InternalServerError, "Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.", traceId));
    }

    /// <summary>NotFound -> 404, yetkisiz -> 403, doğrulama hatası -> 400.</summary>
    private ObjectResult Problem<T>(ServiceResult<T> result)
    {
        var statusCode = result.ErrorKind switch
        {
            ServiceErrorKind.NotFound => StatusCodes.Status404NotFound,
            // 403: kimlik geçerli, kaynak üzerinde yetki yok. Frontend bunu
            // logout'a çevirmez (401'den ayrımı korunur).
            ServiceErrorKind.Forbidden => StatusCodes.Status403Forbidden,
            ServiceErrorKind.Conflict => StatusCodes.Status409Conflict,
            _ => StatusCodes.Status400BadRequest
        };

        return StatusCode(statusCode, ApiError.Create(statusCode, result.Error!, HttpContext.TraceIdentifier));
    }
}
