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
/// Kişisel yolculuk simülasyonunun ince HTTP yüzü.
/// </summary>
/// <remarks>
/// <para>
/// <b>İş kuralı burada YOKTUR.</b> Yeniden planlama, sahiplik, tekillik ve
/// yaşam döngüsü servistedir; controller yalnızca yetkiyi bildirir ve
/// <see cref="ServiceResult{T}"/>'i mevcut eşlemeyle HTTP'ye çevirir.
/// </para>
/// <para>
/// <b>Yetki <c>journey.use</c>'dur.</b> Bu KİŞİSEL bir üründür: kullanıcı
/// kendi yolculuğunu oynatır, hiçbir kalıcı veriyi değiştirmez ve başkasının
/// göreceği bir şey üretmez. Eskiden kapı <c>transport.view</c> idi; ürün artık
/// kendi kimliğini taşır, böylece kişisel yolculuk verilmesi ulaşım ağının
/// tamamını açmaz ve ulaşım ağını izleyebilmek kişisel yolculuk vermez.
/// Yönetim yetkisi olan <c>transport.simulation.start</c> ise PAYLAŞILAN hat
/// simülasyonuna aittir ve DEĞİŞMEDEN kalır — bir kullanıcının kendi rotasını
/// canlandırabilmesi, bir hattı herkes için işletebilmesiyle aynı şey
/// değildir.
/// </para>
/// <para>
/// Servis planlama akışının aynısını çalıştırdığı için referans yetkileri
/// (<c>transport.view</c> rota/durak için, <c>poi.view</c> POI için)
/// kendiliğinden korunur.
/// </para>
/// </remarks>
[ApiController]
[Authorize]
[Route("api/transport/journeys/simulations")]
public sealed class JourneySimulationController : ApiControllerBase
{
    private readonly IJourneySimulationService _simulations;

    public JourneySimulationController(
        IJourneySimulationService simulations,
        ILogger<JourneySimulationController> logger)
        : base(logger)
    {
        _simulations = simulations;
    }

    /// <summary>
    /// Yolculuk NİYETİNDEN yeni bir kişisel simülasyon başlatır.
    /// </summary>
    /// <remarks>
    /// Gövde, önizleme ucuyla AYNI sözleşmedir: kip, profil ve kimlikler.
    /// Geometri, mesafe, süre, manevra ya da plan kimliği için bir alan
    /// YOKTUR — sunucu yolculuğu kendi verisinden yeniden kurar.
    /// </remarks>
    [HttpPost]
    [RequirePermission(PermissionCodes.JourneyUse)]
    public Task<ActionResult<JourneySimulationResponse>> Start(
        [FromBody] JourneyPlanRequest intent,
        CancellationToken cancellationToken) =>
        Guard<JourneySimulationResponse>(nameof(Start), async () =>
        {
            var result = await _simulations.StartAsync(intent, cancellationToken);
            return result.IsSuccess
                ? StatusCode(StatusCodes.Status201Created, result.Value)
                : Error<JourneySimulationResponse>(result);
        });

    /// <summary>Çağıranın KENDİ aktif yolculuğu; yenileme sonrası kurtarma yolu.</summary>
    [HttpGet("current")]
    [RequirePermission(PermissionCodes.JourneyUse)]
    public Task<ActionResult<JourneySimulationResponse>> Current(CancellationToken cancellationToken) =>
        Guard(nameof(Current), async () => Respond(await _simulations.GetCurrentAsync(cancellationToken)));

    /// <summary>
    /// Çağıranın kendi çalıştırmasını durdurur.
    /// </summary>
    /// <remarks>
    /// Başkasının kimliği verilirse yanıt "bulunamadı"dır: ayrı bir 403, kimlik
    /// tahmin eden birine o kimliğin var olduğunu doğrulardı.
    /// </remarks>
    [HttpPost("{simulationId:guid}/stop")]
    [RequirePermission(PermissionCodes.JourneyUse)]
    public Task<ActionResult<JourneySimulationSnapshotResponse>> Stop(
        Guid simulationId,
        CancellationToken cancellationToken) =>
        Guard(nameof(Stop), async () => Respond(await _simulations.StopAsync(simulationId, cancellationToken)));

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
