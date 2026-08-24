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

    /// <summary>
    /// "POI'lerim": çağıranın KENDİ aktif POI'leri.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Yetki <c>poi.view</c>'dur — POI'leri görebilen herkes kendi
    /// kayıtlarını da görebilir; ayrı bir yetenek değildir. <c>poi.manage</c>
    /// İSTENMEZ: bu uç başkalarının kayıtlarını hiç döndürmez.
    /// </para>
    /// <para>
    /// <b>Kapsam sunucuda daraltılır</b> (<c>UserId == currentUserId</c>);
    /// istemci filtresi değildir. Harita sözleşmesi sahibi taşımadığı için
    /// "benimkiler" ancak böyle sorulabilir — alternatif, kim-ne-ekledi
    /// bilgisini herkesin gördüğü listeye koymak olurdu.
    /// </para>
    /// </remarks>
    [RequirePermission(PermissionCodes.PoiView)]
    [HttpGet("mine")]
    public Task<ActionResult<IReadOnlyList<PoiResponse>>> GetOwnPois(CancellationToken cancellationToken) =>
        Guard<IReadOnlyList<PoiResponse>>(
            nameof(GetOwnPois),
            async () => Ok(await _poiService.GetOwnPoisAsync(cancellationToken)));

    /// <summary>
    /// Çöp Kutusu: çağıranın geri yükleyebileceği silinmiş POI'ler.
    /// </summary>
    /// <remarks>
    /// Uç yetkisi <c>poi.view</c>'dur; listenin KAPSAMINI ise servis daraltır
    /// (<c>poi.manage</c> herkesin, <c>poi.delete</c> yalnızca kendi
    /// kayıtlarını görür, ikisi de yoksa liste boştur). Kapsam kuralı statik
    /// bir attribute ile ifade edilemez çünkü kayda bağlıdır.
    /// </remarks>
    [RequirePermission(PermissionCodes.PoiView)]
    [HttpGet("deleted")]
    public Task<ActionResult<IReadOnlyList<DeletedPoiResponse>>> GetDeletedPois(CancellationToken cancellationToken) =>
        Guard<IReadOnlyList<DeletedPoiResponse>>(
            nameof(GetDeletedPois),
            async () => Ok(await _poiService.GetDeletedPoisAsync(cancellationToken)));

    /* --- Mutasyonlar: yetki + SAHİPLİK ------------------------------------------

       Bu üç uçta endpoint seviyesinde bir POI mutasyon attribute'u BİLİNÇLİ
       olarak yoktur ve bu bir gevşetme değildir.

       İzin ölçütü "poi.manage VEYA (sahiplik VE poi.update/poi.delete)"tir —
       yani bir VEYA içerir ve kaydın veritabanındaki sahibine bakar. Statik
       attribute'lar ise aynı endpoint'te VE ile birleşir ve isteği kaydı
       görmeden değerlendirir: [RequirePermission(PoiUpdate)] yazmak, yalnızca
       poi.manage taşıyan bir yöneticiyi kendi yönettiği kayıttan dışlardı;
       ikisini birden yazmak ise ikisine de sahip olmayı şart koşardı.

       Karar bu yüzden kaydı okuyabilen tek katmandadır: PoiService, tek bir
       yerde (IPoiAuthorizationService) tanımlı kuralı uygular ve yetkisiz
       isteğe Forbidden döner — burada 403'e çevrilir. Frontend'in gösterdiği
       düğmeler bu kararı YALNIZCA yansıtır, belirlemez. */

    /// <summary>
    /// POI düzenleme: ad, kategori, mesai. Sahiplik ve tarihler sunucuya
    /// aittir; gövdeden okunmaz ve düzenleme sırasında değişmez.
    /// </summary>
    [HttpPut("{id:int}")]
    public Task<ActionResult<PoiResponse>> UpdatePoi(
        int id,
        [FromBody] UpdatePoiRequest request,
        CancellationToken cancellationToken) =>
        Guard<PoiResponse>(nameof(UpdatePoi), async () =>
        {
            var result = await _poiService.UpdatePoiAsync(id, request, cancellationToken);

            return result.IsSuccess ? Ok(result.Value) : Problem(result);
        });

    /// <summary>
    /// POI silme. Soft delete: satır korunur, <c>is_deleted</c> /
    /// <c>is_active</c> işaretlenir ve kayıt Çöp Kutusu'ndan geri yüklenebilir.
    /// </summary>
    [HttpDelete("{id:int}")]
    public Task<IActionResult> DeletePoi(int id, CancellationToken cancellationToken) =>
        GuardAction(nameof(DeletePoi), async () =>
        {
            var result = await _poiService.DeletePoiAsync(id, cancellationToken);

            // Cast: NoContentResult ile ObjectResult'ın ortak bir dönüşümü
            // yok; ortak arayüz açıkça belirtilir.
            return result.IsSuccess ? NoContent() : (IActionResult)Problem(result);
        });

    /// <summary>Silinmiş POI'yi geri açar. Silmeyle AYNI yetkiyi ister.</summary>
    [HttpPost("{id:int}/restore")]
    public Task<ActionResult<PoiResponse>> RestorePoi(int id, CancellationToken cancellationToken) =>
        Guard<PoiResponse>(nameof(RestorePoi), async () =>
        {
            var result = await _poiService.RestorePoiAsync(id, cancellationToken);

            return result.IsSuccess ? Ok(result.Value) : Problem(result);
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
