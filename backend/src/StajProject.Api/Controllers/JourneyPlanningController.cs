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
/// Genel yolculuk planlamasının ince HTTP yüzü.
/// </summary>
/// <remarks>
/// <para>
/// <b>İş kuralı burada YOKTUR.</b> Kip/profil çözümü, referans doğrulaması ve
/// sıralama servistedir; controller yalnızca yetkiyi bildirir ve
/// <see cref="ServiceResult{T}"/>'i mevcut eşlemeyle HTTP'ye çevirir.
/// </para>
/// <para>
/// <b>ÜRÜN KAPISI <c>journey.use</c>'dur.</b> Kişisel yolculuk ayrı bir
/// üründür; eskiden buradaki kapı <c>transport.view</c> idi ve bu iki ayrı
/// yeteneği tek koda bağlıyordu — hattı izleyebilen herkes kişisel yolculuk da
/// kullanabiliyor, kişisel yolculuk verilmek istenen birine ise ulaşım ağının
/// tamamı açılmak zorunda kalıyordu. Simülasyon başlatma yetkisi
/// (<c>transport.simulation.start</c>) BİLİNÇLİ olarak istenmez: bir planı
/// görmek, bir hattı herkes için canlı işletmek değildir.
/// </para>
/// <para>
/// <b>Ürün kapısı bir kaynak anahtarı DEĞİLDİR.</b> Referanslar kendi
/// yetkilerini serviste ayrıca ister: ulaşım rotası/durağı taşıyan istekler
/// <c>transport.view</c>, POI taşıyanlar <c>poi.view</c>. Denetim uca
/// sabitlenmez çünkü yalnızca istek gerçekten o referansı taşıdığında
/// anlamlıdır — aksi hâlde POI'siz bir plan da POI yetkisi isterdi.
/// </para>
/// </remarks>
[ApiController]
[Authorize]
[Route("api/transport/journeys")]
public sealed class JourneyPlanningController : ApiControllerBase
{
    private readonly IJourneyPlanningService _journeys;

    public JourneyPlanningController(
        IJourneyPlanningService journeys,
        ILogger<JourneyPlanningController> logger)
        : base(logger)
    {
        _journeys = journeys;
    }

    /// <summary>
    /// Bir yolculuk isteğini doğrular ve normalleştirilmiş plan önizlemesini
    /// döndürür.
    /// </summary>
    /// <remarks>
    /// <b>POST, ama yaratmaz.</b> İstek gövdesi (kip, profil, geçiş noktası
    /// listesi) bir sorgu dizesine sığmayacak kadar yapılıdır; buna karşın uç
    /// hiçbir kaynak oluşturmaz ve bu yüzden <c>201</c> değil <c>200</c>
    /// döner. Ad da bilinçle <c>preview</c>'dır: <c>start</c> adı, var olmayan
    /// bir canlı oturumu ima ederdi.
    /// </remarks>
    [HttpPost("preview")]
    [RequirePermission(PermissionCodes.JourneyUse)]
    public Task<ActionResult<JourneyPlanPreviewResponse>> Preview(
        [FromBody] JourneyPlanRequest request,
        CancellationToken cancellationToken) =>
        Guard(nameof(Preview), async () => Respond(await _journeys.PreviewAsync(request, cancellationToken)));

    private ActionResult<T> Respond<T>(ServiceResult<T> result) =>
        result.IsSuccess ? Ok(result.Value!) : Error<T>(result);

    private ObjectResult Error<T>(ServiceResult<T> result)
    {
        var statusCode = result.ErrorKind switch
        {
            ServiceErrorKind.NotFound => StatusCodes.Status404NotFound,
            ServiceErrorKind.Forbidden => StatusCodes.Status403Forbidden,
            ServiceErrorKind.Conflict => StatusCodes.Status409Conflict,
            ServiceErrorKind.Upstream => StatusCodes.Status502BadGateway,
            ServiceErrorKind.Timeout => StatusCodes.Status504GatewayTimeout,
            _ => StatusCodes.Status400BadRequest
        };

        return StatusCode(
            statusCode,
            ApiError.Create(statusCode, result.Error!, HttpContext.TraceIdentifier));
    }
}
