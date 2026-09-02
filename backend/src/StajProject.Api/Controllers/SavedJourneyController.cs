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
/// Kaydedilmiş KİŞİSEL yolculukların ince HTTP yüzü.
/// </summary>
/// <remarks>
/// <para>
/// <b>İş kuralı burada YOKTUR.</b> Sahiplik, doğrulama, referans çözümü ve
/// yeniden kullanım servistedir; controller yalnızca yetkiyi bildirir ve
/// <see cref="ServiceResult{T}"/>'i mevcut eşlemeyle HTTP'ye çevirir.
/// </para>
/// <para>
/// <b>Yetki <c>journey.use</c>'dur — ve YALNIZCA o.</b> Bu, kullanıcının kendi
/// yolculuğunu saklaması ve yeniden kullanmasıdır; ne bir yönetim kaynağıdır
/// ne de paylaşılan bir varlık. Bu yüzden ayrı bir
/// <c>savedjourney.*</c> kodu AÇILMAZ: kişisel yolculuğu kullanabilen biri onu
/// zaten kaydedebilmelidir, ikinci bir kod yalnızca yönetilecek yeni bir kapı
/// üretirdi. Referans yetkileri (ulaşım için <c>transport.view</c>, POI için
/// <c>poi.view</c>) serviste, mevcut planlama hattında sorulmaya devam eder.
/// </para>
/// <para>
/// <b>Sahip kimliği YOLDAN alınmaz.</b> Uçlarda kullanıcı kimliği taşıyan bir
/// parametre yoktur; kimlik daima doğrulanmış JWT'den okunur. Başkasının
/// kaydına yapılan istek "bulunamadı" ile döner ve varlık bilgisi sızmaz.
/// </para>
/// <para>
/// <b>Paylaşılan hat simülasyonu bu uçlardan ETKİLENMEZ:</b> burada hiçbir
/// <c>TransportRoute</c> kaydı değişmez ve hiçbir paylaşılan çalıştırma
/// başlatılmaz/durdurulmaz.
/// </para>
/// </remarks>
[ApiController]
[Authorize]
[Route("api/transport/journeys/saved")]
public sealed class SavedJourneyController : ApiControllerBase
{
    private readonly ISavedJourneyService _savedJourneys;

    public SavedJourneyController(
        ISavedJourneyService savedJourneys,
        ILogger<SavedJourneyController> logger)
        : base(logger)
    {
        _savedJourneys = savedJourneys;
    }

    /// <summary>
    /// Bir yolculuk TANIMINI kaydeder.
    /// </summary>
    /// <remarks>
    /// Simülasyon BAŞLATMAZ ve çalışan bir simülasyon GEREKTİRMEZ: kullanıcı
    /// planladığı yolculuğu yola çıkmadan da saklayabilir.
    /// </remarks>
    [HttpPost]
    [RequirePermission(PermissionCodes.JourneyUse)]
    public Task<ActionResult<SavedJourneyResponse>> Create(
        [FromBody] CreateSavedJourneyRequest request,
        CancellationToken cancellationToken) =>
        Guard<SavedJourneyResponse>(nameof(Create), async () =>
        {
            var result = await _savedJourneys.CreateAsync(request, cancellationToken);
            return result.IsSuccess
                ? StatusCode(StatusCodes.Status201Created, result.Value)
                : Error<SavedJourneyResponse>(result);
        });

    /// <summary>Çağıranın KENDİ kayıtları; hafif liste.</summary>
    [HttpGet]
    [RequirePermission(PermissionCodes.JourneyUse)]
    public Task<ActionResult<IReadOnlyList<SavedJourneySummaryResponse>>> List(
        CancellationToken cancellationToken) =>
        Guard(nameof(List), async () => Respond(await _savedJourneys.ListAsync(cancellationToken)));

    /// <summary>Tek bir kaydın tam tanımı; başkasınınki için 404.</summary>
    [HttpGet("{savedJourneyId:int}")]
    [RequirePermission(PermissionCodes.JourneyUse)]
    public Task<ActionResult<SavedJourneyResponse>> Get(
        int savedJourneyId,
        CancellationToken cancellationToken) =>
        Guard(nameof(Get), async () => Respond(await _savedJourneys.GetAsync(savedJourneyId, cancellationToken)));

    /// <summary>
    /// Ad ve/veya yıldızı günceller.
    /// </summary>
    /// <remarks>
    /// <b>Tek uç, iki alan.</b> Yeniden adlandırma ile favori aynı kaydın sunum
    /// bilgisidir; ayrı uçlar aynı sahiplik denetimini üç kez yazmak olurdu.
    /// Gönderilmeyen alan DEĞİŞMEZ.
    /// </remarks>
    [HttpPut("{savedJourneyId:int}")]
    [RequirePermission(PermissionCodes.JourneyUse)]
    public Task<ActionResult<SavedJourneyResponse>> Update(
        int savedJourneyId,
        [FromBody] UpdateSavedJourneyRequest request,
        CancellationToken cancellationToken) =>
        Guard(nameof(Update), async () =>
            Respond(await _savedJourneys.UpdateAsync(savedJourneyId, request, cancellationToken)));

    /// <summary>Kaydı kalıcı olarak siler; çalışan bir yolculuğa dokunmaz.</summary>
    [HttpDelete("{savedJourneyId:int}")]
    [RequirePermission(PermissionCodes.JourneyUse)]
    public Task<ActionResult<int>> Delete(
        int savedJourneyId,
        CancellationToken cancellationToken) =>
        Guard(nameof(Delete), async () => Respond(await _savedJourneys.DeleteAsync(savedJourneyId, cancellationToken)));

    /// <summary>
    /// Kayıttan YENİ bir kişisel simülasyon başlatır.
    /// </summary>
    /// <remarks>
    /// <b>Eski çalıştırma diriltilmez.</b> Yanıt, mevcut başlatma ucunun
    /// yanıtının AYNISIDIR ve her çağrıda YENİ bir <c>simulationId</c> taşır;
    /// güzergah kayıtlı bir geometriden okunmaz, yeniden hesaplanır. Kaynak
    /// oluşturulduğu için <c>201</c> döner — kaydın kendisi değişmez.
    /// </remarks>
    [HttpPost("{savedJourneyId:int}/reuse")]
    [RequirePermission(PermissionCodes.JourneyUse)]
    public Task<ActionResult<JourneySimulationResponse>> Reuse(
        int savedJourneyId,
        CancellationToken cancellationToken) =>
        Guard<JourneySimulationResponse>(nameof(Reuse), async () =>
        {
            var result = await _savedJourneys.ReuseAsync(savedJourneyId, cancellationToken);
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
