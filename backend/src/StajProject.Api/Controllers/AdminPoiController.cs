using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StajProject.Api.Authorization;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Api.Common;
using StajProject.Domain.Common;

namespace StajProject.Api.Controllers;

/// <summary>
/// Yönetim panelinin POI uçları.
/// </summary>
/// <remarks>
/// <para>
/// <b>İki ayrı yetki kapısı vardır ve bilinçli olarak ayrıdır.</b> POI
/// envanterini görüntülemek <c>poi.manage</c>, kategori taksonomisini
/// düzenlemek <c>poi.categories.manage</c> ister: kayıtları gözden geçirmek
/// ile herkesin sınıflandırma yapmak zorunda olduğu ağacı tanımlamak farklı
/// otoritelerdir.
/// </para>
/// <para>
/// <b>Rol adı denetimi YOKTUR.</b> Bu uçlara "Administrator olduğu için" değil,
/// yetki satırları taşıdığı için erişilir; bir grant geri alındığında erişim
/// gerçekten kapanır.
/// </para>
/// </remarks>
[ApiController]
[Authorize]
[Route("api/admin/poi")]
public class AdminPoiController : ApiControllerBase
{
    private readonly IPoiService _poiService;
    private readonly IPoiCategoryService _categoryService;

    public AdminPoiController(
        IPoiService poiService,
        IPoiCategoryService categoryService,
        ILogger<AdminPoiController> logger)
        : base(logger)
    {
        _poiService = poiService;
        _categoryService = categoryService;
    }

    /// <summary>
    /// Tüm POI kayıtları: pasif ve silinmiş olanlar dâhil, oluşturan
    /// bilgisiyle.
    /// </summary>
    [RequirePermission(PermissionCodes.PoiManage)]
    [HttpGet]
    public Task<ActionResult<IReadOnlyList<AdminPoiResponse>>> GetPois(CancellationToken cancellationToken) =>
        Guard<IReadOnlyList<AdminPoiResponse>>(
            nameof(GetPois),
            async () => Ok(await _poiService.GetAdminPoisAsync(cancellationToken)));

    /// <summary>Kategori ağacı: pasif ve silinmiş satırlar dâhil.</summary>
    [RequirePermission(PermissionCodes.PoiCategoriesManage)]
    [HttpGet("categories")]
    public Task<ActionResult<IReadOnlyList<AdminPoiCategoryResponse>>> GetCategories(CancellationToken cancellationToken) =>
        Guard<IReadOnlyList<AdminPoiCategoryResponse>>(
            nameof(GetCategories),
            async () => Ok(await _categoryService.GetAdminCategoriesAsync(cancellationToken)));

    [RequirePermission(PermissionCodes.PoiCategoriesManage)]
    [HttpPost("categories")]
    public Task<ActionResult<AdminPoiCategoryResponse>> CreateCategory(
        [FromBody] CreatePoiCategoryRequest request,
        CancellationToken cancellationToken) =>
        Guard<AdminPoiCategoryResponse>(nameof(CreateCategory), async () =>
        {
            var result = await _categoryService.CreateCategoryAsync(request, cancellationToken);

            return result.IsSuccess
                ? StatusCode(StatusCodes.Status201Created, result.Value)
                : Problem(result);
        });

    /// <summary>
    /// Kategori düzenleme. Silme ucu BİLİNÇLİ olarak yoktur — ödev silmeyi
    /// gerektirmez ve bir kategoriyi kaldırmak, ona bağlı POI'lerin
    /// sınıflandırmasını sessizce kopanmak olurdu; kullanımdan kaldırma
    /// <c>isActive</c> ile yapılır.
    /// </summary>
    [RequirePermission(PermissionCodes.PoiCategoriesManage)]
    [HttpPut("categories/{id:int}")]
    public Task<ActionResult<AdminPoiCategoryResponse>> UpdateCategory(
        int id,
        [FromBody] UpdatePoiCategoryRequest request,
        CancellationToken cancellationToken) =>
        Guard<AdminPoiCategoryResponse>(nameof(UpdateCategory), async () =>
        {
            var result = await _categoryService.UpdateCategoryAsync(id, request, cancellationToken);

            return result.IsSuccess ? Ok(result.Value) : Problem(result);
        });

    /// <summary>NotFound -> 404, yetkisiz -> 403, doğrulama hatası -> 400.</summary>
    private ObjectResult Problem<T>(ServiceResult<T> result)
    {
        var statusCode = result.ErrorKind switch
        {
            ServiceErrorKind.NotFound => StatusCodes.Status404NotFound,
            ServiceErrorKind.Forbidden => StatusCodes.Status403Forbidden,
            ServiceErrorKind.Conflict => StatusCodes.Status409Conflict,
            _ => StatusCodes.Status400BadRequest
        };

        return StatusCode(statusCode, ApiError.Create(statusCode, result.Error!, HttpContext.TraceIdentifier));
    }
}
