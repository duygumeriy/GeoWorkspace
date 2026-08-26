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
/// Mekânsal analiz uçları. Çizim uçlarıyla aynı güvenlik modelini kullanır
/// (<c>[Authorize]</c> + JWT) ve hiçbiri veritabanına kayıt yazmaz.
/// </summary>
/// <remarks>
/// Uç <see cref="ApiControllerBase.Guard{TValue}"/> ile sarılıdır: kesişim
/// sorgusu beklenmedik şekilde patlarsa istemci stack trace değil tek tip 500
/// alır. Sorgunun kendisi (PostGIS/EF) <see cref="ISpatialAnalysisService"/>
/// içindedir; controller yalnızca HTTP sınırıdır.
/// </remarks>
[ApiController]
[Authorize]
[Route("api/analysis")]
public class AnalysisController : ApiControllerBase
{
    private readonly ISpatialAnalysisService _spatialAnalysisService;
    private readonly ILocationAnalysisService _locationAnalysisService;
    private readonly ILocationAnalysisImageService _locationAnalysisImageService;

    public AnalysisController(
        ISpatialAnalysisService spatialAnalysisService,
        ILocationAnalysisService locationAnalysisService,
        ILocationAnalysisImageService locationAnalysisImageService,
        ILogger<AnalysisController> logger)
        : base(logger)
    {
        _spatialAnalysisService = spatialAnalysisService;
        _locationAnalysisService = locationAnalysisService;
        _locationAnalysisImageService = locationAnalysisImageService;
    }

    /// <summary>
    /// Gönderilen poligonla kesişen envanter kayıtlarını sayar. Poligon
    /// yalnızca sorgu parametresidir; hiçbir tabloya yazılmaz.
    /// </summary>
    /// <remarks>
    /// YETKİ: <c>inventory.analysis</c>. Uç envanteri yalnızca okumakla
    /// kalmaz, kesişim analizi çalıştırır; bu yüzden salt görüntüleme yetkisi
    /// (<c>inventory.view</c>) yeterli sayılmaz. Viewer analiz çalıştıramaz,
    /// GIS Analyst çalıştırabilir.
    /// </remarks>
    [RequirePermission(PermissionCodes.InventoryAnalysis)]
    [HttpPost("intersections")]
    public Task<ActionResult<IntersectionAnalysisResponse>> CountIntersections(
        [FromBody] IntersectionAnalysisRequest request,
        CancellationToken cancellationToken) =>
        Guard<IntersectionAnalysisResponse>(nameof(CountIntersections), async () =>
        {
            var result = await _spatialAnalysisService.CountIntersectionsAsync(request, cancellationToken);

            if (result.IsSuccess)
            {
                return Ok(result.Value);
            }

            return result.ErrorKind == ServiceErrorKind.NotFound
                ? NotFound(new { message = result.Error })
                : BadRequest(new { message = result.Error });
        });

    /// <summary>
    /// Seçilen alan içindeki açık veri POI'lerini, seçilen kategori
    /// ağırlıklarıyla puanlar. Alan da ölçütler de yalnızca sorgu
    /// parametresidir; hiçbir tabloya yazılmaz.
    /// </summary>
    /// <remarks>
    /// <para>
    /// YETKİ: <c>location.analysis</c> <b>VE</b> <c>poi.view</c>. İki
    /// <c>RequirePermission</c> birlikte VE anlamına gelir (bkz.
    /// <c>RequirePermissionAttribute</c>) ve ikisi de gereklidir:
    /// <c>location.analysis</c> analizi ÇALIŞTIRMA yeteneğidir,
    /// <c>poi.view</c> ise POI envanterini GÖRME yeteneğidir. Sayı da bir
    /// bilgidir — POI göremeyen birine "burada 382 POI var" demek, göremediği
    /// verinin varlığını sızdırmak olurdu. Aynı ayrım envanter analizinin POI
    /// kırılımında da uygulanır (<c>SpatialAnalysisService</c>).
    /// </para>
    /// <para>
    /// Uç <c>heatmap.view</c> ARAMAZ: mevcut ısı haritası kullanıcının kendi
    /// çizim noktalarının yoğunluğudur ve bu analizle veri kümesini de
    /// paylaşmaz.
    /// </para>
    /// <para>
    /// Sahiplik YOKTUR: açık veri kümesi ortaktır, dolayısıyla gövde bir
    /// kullanıcı kimliği taşımaz ve controller kimlik çözümlemez.
    /// </para>
    /// </remarks>
    [RequirePermission(PermissionCodes.LocationAnalysis)]
    [RequirePermission(PermissionCodes.PoiView)]
    [HttpPost("location")]
    public Task<ActionResult<LocationAnalysisResponse>> AnalyzeLocation(
        [FromBody] LocationAnalysisRequest request,
        CancellationToken cancellationToken) =>
        Guard<LocationAnalysisResponse>(nameof(AnalyzeLocation), async () =>
        {
            var result = await _locationAnalysisService.AnalyzeAsync(request, cancellationToken);

            if (result.IsSuccess)
            {
                return Ok(result.Value);
            }

            /* Doğrulama hataları 400'dür; parser ve kategori çözümlemesi
               kullanıcıya dönük mesajlar üretir ve SQL/geometri iç detayı
               taşımaz. Beklenmeyen hatalar Guard sınırında tek tip 500 olur.

               <b>Coğrafi yetki reddi 403'tür, 400 DEĞİL</b> ve bu, konum
               analizinin DÖRT ucuyla aynı olmak zorundadır: raster, nokta
               listesi, isabet testi ve örtü zaten 403 döndürüyor. Burada 400
               dönmek, "gönderdiğin geometri bozuk" ile "bu alana yetkin yok"u
               aynı koda indirir; istemci ikisini ayırt edemez ve yetki
               uyarısını gösteremezdi (ölçüldü: yetki alanı dışındaki bir il
               için özet 400, diğer dört uç 403 dönüyordu). */
            return result.ErrorKind switch
            {
                ServiceErrorKind.NotFound => NotFound(new { message = result.Error }),
                ServiceErrorKind.Forbidden => StatusCode(
                    StatusCodes.Status403Forbidden,
                    new { message = result.Error }),
                _ => BadRequest(new { message = result.Error })
            };
        });

    /// <summary>
    /// Aynı analizin <b>ağırlıklı ısı haritası</b> görüntüsü.
    /// </summary>
    /// <remarks>
    /// <para>
    /// YETKİ: özet ucuyla BİREBİR AYNI — <c>location.analysis</c> <b>VE</b>
    /// <c>poi.view</c>. Görüntü de bir bilgidir: aynı veriden üretilen bir
    /// yoğunluk resmine, sayıya erişemeyen birinin erişebilmesi yetkiyi
    /// anlamsız kılardı.
    /// </para>
    /// <para>
    /// Uç <c>heatmap.view</c> ARAMAZ: mevcut ısı haritası kullanıcının kendi
    /// çizim noktalarının yoğunluğudur ve bu analizle ne veri kümesini ne
    /// anlamını paylaşır.
    /// </para>
    /// <para>
    /// İstemci görüntü penceresini ve tanımlı dört LOD bandından birini
    /// söyler; yoğunluk çekirdeği ve veri sorgusu sunucuda çözülür.
    /// </para>
    /// </remarks>
    [RequirePermission(PermissionCodes.LocationAnalysis)]
    [RequirePermission(PermissionCodes.PoiView)]
    [HttpPost("location/image")]
    public Task<IActionResult> RenderLocationAnalysis(
        [FromBody] LocationAnalysisImageRequest request,
        CancellationToken cancellationToken) =>
        GuardAction(nameof(RenderLocationAnalysis), async () =>
        {
            var result = await _locationAnalysisImageService.RenderAsync(request, cancellationToken);

            if (!result.IsSuccess)
            {
                return Problem(result);
            }

            /* Görüntü kullanıcının seçtiği ölçütlere özeldir ve ara
               önbelleklerde tutulmamalıdır — mevcut heatmap ucuyla aynı
               başlıklar. */
            Response.Headers.CacheControl = "private, no-store";
            Response.Headers.Pragma = "no-cache";

            return File(result.Value!.Content, "image/png");
        });

    /// <summary>
    /// Aktif analize giren POI'ler — haritada <b>vektör</b> olarak çizilir.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Aynı erişim sözleşmesi:</b> <c>location.analysis</c> +
    /// <c>poi.view</c>. Analiz POI'lerini nokta yerine rozetle görmek için
    /// ayrı bir izin icat edilmez.
    /// </para>
    /// <para>
    /// <b>Sunucu süzgecin sahibidir.</b> İstemci yalnızca aktif analizi
    /// (<c>areaWkts</c> + <c>criteria</c>) söyler; alan yüklemi, kategori
    /// kapanışı ve üst sınır sunucuda uygulanır. Tüm tabloyu isteyen bir yol
    /// YOKTUR.
    /// </para>
    /// </remarks>
    [RequirePermission(PermissionCodes.LocationAnalysis)]
    [RequirePermission(PermissionCodes.PoiView)]
    [HttpPost("location/points")]
    public Task<IActionResult> ListLocationAnalysisPoints(
        [FromBody] LocationAnalysisRequest request,
        CancellationToken cancellationToken) =>
        GuardAction(nameof(ListLocationAnalysisPoints), async () =>
        {
            var result = await _locationAnalysisService.ListPointsAsync(request, cancellationToken);

            if (!result.IsSuccess)
            {
                var statusCode = result.ErrorKind switch
                {
                    ServiceErrorKind.Forbidden => StatusCodes.Status403Forbidden,
                    _ => StatusCodes.Status400BadRequest
                };

                return StatusCode(
                    statusCode,
                    ApiError.Create(statusCode, result.Error!, HttpContext.TraceIdentifier));
            }

            Response.Headers.CacheControl = "private, no-store";

            return Ok(result.Value);
        });

    /// <summary>
    /// Haritada tıklanan noktaya en yakın analiz POI'sini çözer.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Neden gerekli.</b> Nokta örtüsü sunucuda çizilmiş bir PNG'dir;
    /// pikselin arkasında bir kayıt kimliği yoktur ve raster yalnızca bir
    /// SUNUMDUR. Kullanıcının gördüğü noktayı inceleyebilmesi için kimliği
    /// veritabanından çözen ayrı ve dar bir yol gerekir — rasteri 7853
    /// vektör feature'a çevirmek yerine.
    /// </para>
    /// <para>
    /// <b>Aynı erişim sözleşmesi.</b> Isı haritası ve nokta örtüsüyle aynı:
    /// <c>location.analysis</c> + <c>poi.view</c>. Yalnızca bir noktaya
    /// tıklamak için ayrı bir izin icat etmek, aynı veriye üçüncü bir kapı
    /// açmak olurdu.
    /// </para>
    /// <para>
    /// <b>Sunucu sorgunun sahibidir.</b> İstemci yalnızca aktif analizi, bir
    /// koordinat ve bir yarıçap söyler; kategori kapanışı, alan yüklemi ve
    /// mesafe sorgusu sunucuda kurulur. Yarıçap ayrıca KIRPILIR
    /// (<see cref="LocationAnalysisHitTest"/>).
    /// </para>
    /// </remarks>
    [RequirePermission(PermissionCodes.LocationAnalysis)]
    [RequirePermission(PermissionCodes.PoiView)]
    [HttpPost("location/points/hit-test")]
    public Task<IActionResult> HitTestLocationAnalysisPoints(
        [FromBody] LocationAnalysisHitTestRequest request,
        CancellationToken cancellationToken) =>
        GuardAction(nameof(HitTestLocationAnalysisPoints), async () =>
        {
            var result = await _locationAnalysisService.HitTestAsync(request, cancellationToken);

            if (!result.IsSuccess)
            {
                var statusCode = result.ErrorKind switch
                {
                    ServiceErrorKind.Forbidden => StatusCodes.Status403Forbidden,
                    _ => StatusCodes.Status400BadRequest
                };

                return StatusCode(
                    statusCode,
                    ApiError.Create(statusCode, result.Error!, HttpContext.TraceIdentifier));
            }

            /* Sonuç kullanıcının seçtiği analize özeldir; ara önbelleklerde
               tutulmamalıdır — diğer analiz uçlarıyla aynı başlıklar. */
            Response.Headers.CacheControl = "private, no-store";

            return Ok(result.Value);
        });

    /// <summary>
    /// Analiz POI'lerinin nokta örtüsü (PNG).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Yeni bir yetki TANIMLANMAZ.</b> Örtü, konum analizinin bir
    /// görünümüdür; erişim sözleşmesi ısı haritasıyla AYNIdır:
    /// <c>location.analysis</c> + <c>poi.view</c>. Yalnızca noktaları görmek
    /// için ayrı bir izin icat etmek, aynı veriye iki farklı kapı açmak
    /// olurdu.
    /// </para>
    /// <para>
    /// <b>Süzgeç ISI HARİTASIYLA aynı üretimden geçer.</b> Alan, ölçütler ve
    /// kategori kapanışı tek bir servis yolunda çözülür; iki uç yalnızca
    /// GeoServer stilinde ayrışır. Böylece örtüdeki noktalar, rasteri besleyen
    /// kümenin birebir aynısı olur.
    /// </para>
    /// </remarks>
    [RequirePermission(PermissionCodes.LocationAnalysis)]
    [RequirePermission(PermissionCodes.PoiView)]
    [HttpPost("location/points/image")]
    public Task<IActionResult> RenderLocationAnalysisPoints(
        [FromBody] LocationAnalysisImageRequest request,
        CancellationToken cancellationToken) =>
        GuardAction(nameof(RenderLocationAnalysisPoints), async () =>
        {
            var result = await _locationAnalysisImageService.RenderAsync(
                request,
                cancellationToken,
                LocationAnalysisImageKind.Points);

            if (!result.IsSuccess)
            {
                return Problem(result);
            }

            Response.Headers.CacheControl = "private, no-store";
            Response.Headers.Pragma = "no-cache";

            return File(result.Value!.Content, "image/png");
        });

    private ObjectResult Problem(ServiceResult<LocationAnalysisImage> result)
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
