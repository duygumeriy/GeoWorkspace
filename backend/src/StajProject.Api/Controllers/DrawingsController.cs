using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;

namespace StajProject.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/drawings")]
public class DrawingsController : ControllerBase
{
    private readonly IDrawingService _drawingService;

    public DrawingsController(IDrawingService drawingService)
    {
        _drawingService = drawingService;
    }

    [HttpPost("point")]
    public async Task<ActionResult<DrawingResponse>> CreatePoint([FromBody] CreateDrawingRequest request, CancellationToken cancellationToken) =>
        Created(await _drawingService.CreatePointAsync(request, cancellationToken));

    [HttpPost("line")]
    public async Task<ActionResult<DrawingResponse>> CreateLine([FromBody] CreateDrawingRequest request, CancellationToken cancellationToken) =>
        Created(await _drawingService.CreateLineAsync(request, cancellationToken));

    [HttpPost("polygon")]
    public async Task<ActionResult<DrawingResponse>> CreatePolygon([FromBody] CreateDrawingRequest request, CancellationToken cancellationToken) =>
        Created(await _drawingService.CreatePolygonAsync(request, cancellationToken));

    [HttpGet("points")]
    public async Task<ActionResult<IReadOnlyList<DrawingResponse>>> GetPoints(CancellationToken cancellationToken) =>
        Ok(await _drawingService.GetPointsAsync(cancellationToken));

    [HttpGet("lines")]
    public async Task<ActionResult<IReadOnlyList<DrawingResponse>>> GetLines(CancellationToken cancellationToken) =>
        Ok(await _drawingService.GetLinesAsync(cancellationToken));

    [HttpGet("polygons")]
    public async Task<ActionResult<IReadOnlyList<DrawingResponse>>> GetPolygons(CancellationToken cancellationToken) =>
        Ok(await _drawingService.GetPolygonsAsync(cancellationToken));

    /* --- Style update: yalnızca görünüm kolonları, geometry değişmez --------- */

    [HttpPatch("point/{id:int}/style")]
    public async Task<ActionResult<DrawingResponse>> UpdatePointStyle(int id, [FromBody] DrawingStyleDto style, CancellationToken cancellationToken) =>
        Updated(await _drawingService.UpdateStyleAsync(DrawingKind.Point, id, style, cancellationToken));

    [HttpPatch("line/{id:int}/style")]
    public async Task<ActionResult<DrawingResponse>> UpdateLineStyle(int id, [FromBody] DrawingStyleDto style, CancellationToken cancellationToken) =>
        Updated(await _drawingService.UpdateStyleAsync(DrawingKind.Line, id, style, cancellationToken));

    [HttpPatch("polygon/{id:int}/style")]
    public async Task<ActionResult<DrawingResponse>> UpdatePolygonStyle(int id, [FromBody] DrawingStyleDto style, CancellationToken cancellationToken) =>
        Updated(await _drawingService.UpdateStyleAsync(DrawingKind.Polygon, id, style, cancellationToken));

    /* --- Delete ------------------------------------------------------------- */

    [HttpDelete("point/{id:int}")]
    public async Task<IActionResult> DeletePoint(int id, CancellationToken cancellationToken) =>
        Deleted(await _drawingService.DeleteAsync(DrawingKind.Point, id, cancellationToken));

    [HttpDelete("line/{id:int}")]
    public async Task<IActionResult> DeleteLine(int id, CancellationToken cancellationToken) =>
        Deleted(await _drawingService.DeleteAsync(DrawingKind.Line, id, cancellationToken));

    [HttpDelete("polygon/{id:int}")]
    public async Task<IActionResult> DeletePolygon(int id, CancellationToken cancellationToken) =>
        Deleted(await _drawingService.DeleteAsync(DrawingKind.Polygon, id, cancellationToken));

    /* --- Toplu işlemler: hepsi ya da hiçbiri (tek transaction) -------------- */

    /// <summary>
    /// Seçili kayıtları tek transaction içinde siler. Bir id bulunamazsa
    /// hiçbir kayıt silinmez ve 404 döner — frontend yarım state'e düşmez.
    /// </summary>
    [HttpPost("bulk-delete")]
    public async Task<ActionResult<BulkDeleteResponse>> BulkDelete([FromBody] BulkDeleteRequest request, CancellationToken cancellationToken)
    {
        var result = await _drawingService.BulkDeleteAsync(request, cancellationToken);
        return result.IsSuccess ? Ok(result.Value) : Problem(result);
    }

    /// <summary>Seçili kayıtların yalnızca stil kolonlarını tek transaction içinde günceller.</summary>
    [HttpPatch("bulk-style")]
    public async Task<ActionResult<BulkDrawingsResponse>> BulkStyle([FromBody] BulkStyleRequest request, CancellationToken cancellationToken)
    {
        var result = await _drawingService.BulkUpdateStyleAsync(request, cancellationToken);
        return result.IsSuccess ? Ok(result.Value) : Problem(result);
    }

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
    public async Task<ActionResult<BulkDrawingsResponse>> Restore([FromBody] BulkRestoreRequest request, CancellationToken cancellationToken)
    {
        var result = await _drawingService.RestoreAsync(request, cancellationToken);
        return result.IsSuccess ? Ok(result.Value) : Problem(result);
    }

    /// <summary>Birden çok YENİ kayıt oluşturur; sahipleri daima çağıran kullanıcıdır.</summary>
    [HttpPost("bulk-create")]
    public async Task<ActionResult<BulkDrawingsResponse>> BulkCreate([FromBody] BulkCreateRequest request, CancellationToken cancellationToken)
    {
        var result = await _drawingService.BulkCreateAsync(request, cancellationToken);
        return result.IsSuccess ? StatusCode(StatusCodes.Status201Created, result.Value) : Problem(result);
    }

    private ActionResult<DrawingResponse> Created(ServiceResult<DrawingResponse> result) =>
        result.IsSuccess
            ? StatusCode(StatusCodes.Status201Created, result.Value)
            : Problem(result);

    private ActionResult<DrawingResponse> Updated(ServiceResult<DrawingResponse> result) =>
        result.IsSuccess ? Ok(result.Value) : Problem(result);

    private IActionResult Deleted(ServiceResult<int> result) =>
        result.IsSuccess ? NoContent() : Problem(result);

    /// <summary>NotFound -> 404, yetkisiz -> 403, doğrulama hatası -> 400.</summary>
    private ObjectResult Problem<T>(ServiceResult<T> result) => result.ErrorKind switch
    {
        ServiceErrorKind.NotFound => NotFound(new { message = result.Error }),
        // 403: kimlik geçerli, kaynak üzerinde yetki yok. Frontend bunu
        // logout'a çevirmez (401'den ayrımı korunur).
        ServiceErrorKind.Forbidden => StatusCode(StatusCodes.Status403Forbidden, new { message = result.Error }),
        _ => BadRequest(new { message = result.Error })
    };
}
