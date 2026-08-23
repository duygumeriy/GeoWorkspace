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
/// Harita tarafındaki POI uçları.
/// </summary>
/// <remarks>
/// <para>
/// <b>İş mantığı controller'a taşınmaz.</b> Buradaki hiçbir metot veritabanına
/// dokunmaz, geometri kurmaz, JSON serileştirmez, kategori doğrulamaz veya
/// coğrafi karar vermez; hepsi <see cref="IPoiService"/> içindedir. Controller
/// yalnızca HTTP sınırıdır — çizim ve yönetim uçlarıyla aynı sözleşme.
/// </para>
/// <para>
/// <b>Yetkilendirme rol adına DEĞİL koda bakar.</b> Uçlar
/// <c>poi.view</c> / <c>poi.create</c> arar; bu yetkileri hangi rolün ya da
/// hangi doğrudan grant'ın taşıdığı buradan görünmez ve görünmemelidir.
/// </para>
/// </remarks>
[ApiController]
[Authorize]
[Route("api/poi")]
public class PoiController : ApiControllerBase
{
    private readonly IPoiService _poiService;
    private readonly IPoiCategoryService _categoryService;

    public PoiController(
        IPoiService poiService,
        IPoiCategoryService categoryService,
        ILogger<PoiController> logger)
        : base(logger)
    {
        _poiService = poiService;
        _categoryService = categoryService;
    }

    /// <summary>
    /// Haritadaki aktif POI'ler. Oluşturan bilgisi DÖNMEZ — o sözleşme
    /// yönetim ucuna aittir.
    /// </summary>
    [RequirePermission(PermissionCodes.PoiView)]
    [HttpGet]
    public Task<ActionResult<IReadOnlyList<PoiResponse>>> GetPois(CancellationToken cancellationToken) =>
        Guard<IReadOnlyList<PoiResponse>>(
            nameof(GetPois),
            async () => Ok(await _poiService.GetMapPoisAsync(cancellationToken)));

    /// <summary>
    /// POI oluşturma açılır listesi için aktif kategoriler.
    /// </summary>
    /// <remarks>
    /// Yetki bilinçli olarak <c>poi.view</c>'dur, <c>poi.categories.manage</c>
    /// DEĞİL: kategori listesini okuyabilmek, taksonomiyi düzenleyebilmekle
    /// aynı şey değildir. Yönetim yetkisi istenseydi, POI ekleyebilen ama
    /// kategori yönetemeyen biri formu hiç dolduramazdı.
    /// </remarks>
    [RequirePermission(PermissionCodes.PoiView)]
    [HttpGet("categories")]
    public Task<ActionResult<IReadOnlyList<PoiCategoryResponse>>> GetCategories(CancellationToken cancellationToken) =>
        Guard<IReadOnlyList<PoiCategoryResponse>>(
            nameof(GetCategories),
            async () => Ok(await _categoryService.GetActiveCategoriesAsync(cancellationToken)));

    /// <summary>
    /// Yeni POI. Sahiplik ve audit alanları sunucuya aittir; gövdeden
    /// okunmaz.
    /// </summary>
    [RequirePermission(PermissionCodes.PoiCreate)]
    [HttpPost]
    public Task<ActionResult<PoiResponse>> CreatePoi(
        [FromBody] CreatePoiRequest request,
        CancellationToken cancellationToken) =>
        Guard<PoiResponse>(nameof(CreatePoi), async () =>
        {
            var result = await _poiService.CreatePoiAsync(request, cancellationToken);

            return result.IsSuccess
                ? StatusCode(StatusCodes.Status201Created, result.Value)
                : Problem(result);
        });

    /// <summary>NotFound -> 404, yetkisiz -> 403, doğrulama hatası -> 400.</summary>
    private ObjectResult Problem<T>(ServiceResult<T> result)
    {
        var statusCode = result.ErrorKind switch
        {
            ServiceErrorKind.NotFound => StatusCodes.Status404NotFound,
            // 403: kimlik geçerli, bu konumda/kaynakta yetki yok. Frontend bunu
            // logout'a çevirmez (401'den ayrımı korunur).
            ServiceErrorKind.Forbidden => StatusCodes.Status403Forbidden,
            ServiceErrorKind.Conflict => StatusCodes.Status409Conflict,
            _ => StatusCodes.Status400BadRequest
        };

        return StatusCode(statusCode, ApiError.Create(statusCode, result.Error!, HttpContext.TraceIdentifier));
    }
}
