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
/// Kişisel yolculuk geçmişinin ince HTTP yüzü.
/// </summary>
/// <remarks>
/// <para>
/// <b>OLUŞTURMA UCU YOKTUR ve olmamalıdır.</b> Geçmiş, istemcinin
/// üretebileceği bir kaynak değildir: "bu yolculuğu yaptım" iddiasını
/// tarayıcıdan kabul etmek, tutanağı uydurulabilir hâle getirirdi. Satırın tek
/// kaynağı sunucunun kendi terminal geçişidir
/// (<see cref="IJourneyHistoryWriter"/>).
/// </para>
/// <para>
/// <b>DEĞİŞTİRME ve SİLME ucu da yoktur.</b> Kayıt adlandırılamaz,
/// düzenlenemez, favorilenemez: olmuş bir şeyin tutanağı değiştirilmez.
/// Kullanıcının kendi tanımlarını adlandırdığı, sildiği ve yeniden kullandığı
/// ürün ayrıdır (<c>/api/transport/journeys/saved</c>) ve bu iki kavram
/// bilinçle karıştırılmaz.
/// </para>
/// <para>
/// <b>Yetki <c>journey.use</c>'dur — ve YALNIZCA o.</b> Kullanıcının kendi
/// yolculuklarını görmesi, kişisel yolculuk ürününün doğal bir parçasıdır;
/// ayrı bir <c>journey.history.*</c> kodu yalnızca yönetilecek yeni bir kapı
/// üretirdi. Yeniden kullanım yolunda referans yetkileri (ulaşım için
/// <c>transport.view</c>, POI için <c>poi.view</c>) mevcut planlama hattında
/// sorulmaya devam eder.
/// </para>
/// <para>
/// <b>Sahip kimliği YOLDAN alınmaz.</b> Uçlarda kullanıcı kimliği taşıyan bir
/// parametre yoktur; kimlik daima doğrulanmış JWT'den okunur. Başkasının kaydı
/// için yapılan istek "bulunamadı" ile döner ve varlık bilgisi sızmaz.
/// </para>
/// </remarks>
[ApiController]
[Authorize]
[Route("api/transport/journeys/history")]
public sealed class JourneyHistoryController : ApiControllerBase
{
    private readonly IJourneyHistoryService _history;

    public JourneyHistoryController(
        IJourneyHistoryService history,
        ILogger<JourneyHistoryController> logger)
        : base(logger)
    {
        _history = history;
    }

    /// <summary>
    /// Çağıranın KENDİ geçmişinin bir sayfası; en son biten en üstte.
    /// </summary>
    /// <remarks>
    /// <b>Sayfalama isteğe bağlı değildir.</b> Kullanıcı sınırlı sayıda tanım
    /// saklar ama sınırsız sayıda yolculuk yapar; tamamını göndermek ekranı bir
    /// gün açılmaz hâle getirirdi.
    /// </remarks>
    [HttpGet]
    [RequirePermission(PermissionCodes.JourneyUse)]
    public Task<ActionResult<JourneyHistoryPage>> List(
        [FromQuery] JourneyHistoryQuery query,
        CancellationToken cancellationToken) =>
        Guard(nameof(List), async () => Respond(await _history.ListAsync(query, cancellationToken)));

    /// <summary>
    /// Tek bir kaydın değişmez ayrıntısı; başkasınınki için 404.
    /// </summary>
    /// <remarks>
    /// Yanıtı üretmek için hiçbir canlı POI/durak/hat kaydına gidilmez: geçmiş,
    /// işaret ettiği kayıtlar silinse bile okunabilir kalmalıdır.
    /// </remarks>
    [HttpGet("{journeyHistoryId:int}")]
    [RequirePermission(PermissionCodes.JourneyUse)]
    public Task<ActionResult<JourneyHistoryDetailResponse>> Get(
        int journeyHistoryId,
        CancellationToken cancellationToken) =>
        Guard(nameof(Get), async () => Respond(await _history.GetAsync(journeyHistoryId, cancellationToken)));

    /// <summary>
    /// Geçmişteki yolculuğu YENİDEN yapar.
    /// </summary>
    /// <remarks>
    /// <b>Eski çalıştırma diriltilmez.</b> Yanıt, mevcut başlatma ucunun
    /// yanıtının AYNISIDIR ve her çağrıda YENİ bir <c>simulationId</c> taşır;
    /// kayıttaki tarihsel kimlik isteğe hiç girmez ve kaydın kendisi
    /// değişmez. Kaynak oluşturulduğu için <c>201</c> döner.
    /// </remarks>
    [HttpPost("{journeyHistoryId:int}/reuse")]
    [RequirePermission(PermissionCodes.JourneyUse)]
    public Task<ActionResult<JourneySimulationResponse>> Reuse(
        int journeyHistoryId,
        CancellationToken cancellationToken) =>
        Guard<JourneySimulationResponse>(nameof(Reuse), async () =>
        {
            var result = await _history.ReuseAsync(journeyHistoryId, cancellationToken);
            return result.IsSuccess
                ? StatusCode(StatusCodes.Status201Created, result.Value)
                : Error<JourneySimulationResponse>(result);
        });

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
