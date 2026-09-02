using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StajProject.Api.Authorization;
using StajProject.Api.Common;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Simulation;
using StajProject.Domain.Common;

namespace StajProject.Api.Controllers;

/// <summary>
/// Ulaşım simülasyonunun ince HTTP yüzü.
/// </summary>
/// <remarks>
/// <para>
/// <b>İş kuralı burada YOKTUR.</b> Rota/yol denetimleri, bayatlık ve tekillik
/// kararı servistedir; controller yalnızca yetkiyi bildirir ve
/// <see cref="ServiceResult{T}"/>'i mevcut eşlemeyle HTTP'ye çevirir.
/// </para>
/// <para>
/// <b>Yetkiler ayrıktır:</b> başlatmak <c>transport.simulation.start</c>,
/// DURDURMAK <c>transport.simulation.stop</c>, izlemek ise mevcut
/// <c>transport.view</c> ister. Simülasyonun konumunu görmek, ulaşım ağını
/// görüntülemenin bir parçasıdır; ayrı bir okuma yetkisi UYDURULMAZ.
/// </para>
/// <para>
/// <b>Başlatma durdurmayı İMA ETMEZ</b> (ve tersi de doğrudur): bir kurulum
/// hattı işletebilen birine durdurma vermeyebilir. İki kod ayrı ayrı verilir
/// ve burada biri diğerinin yerine geçmez.
/// </para>
/// </remarks>
[ApiController]
[Authorize]
[Route("api/transport/simulations")]
public sealed class TransportSimulationController : ApiControllerBase
{
    private readonly ITransportSimulationService _simulations;

    public TransportSimulationController(
        ITransportSimulationService simulations,
        ILogger<TransportSimulationController> logger)
        : base(logger)
    {
        _simulations = simulations;
    }

    [HttpPost("routes/{routeId:int}/start")]
    [RequirePermission(PermissionCodes.TransportSimulationStart)]
    public Task<ActionResult<TransportSimulationResponse>> Start(int routeId, CancellationToken cancellationToken) =>
        Guard<TransportSimulationResponse>(nameof(Start), async () =>
        {
            var result = await _simulations.StartAsync(routeId, cancellationToken);
            return result.IsSuccess
                ? StatusCode(StatusCodes.Status201Created, result.Value)
                : Error<TransportSimulationResponse>(result);
        });

    [HttpGet("routes/{routeId:int}")]
    [RequirePermission(PermissionCodes.TransportView)]
    public Task<ActionResult<TransportSimulationResponse>> GetActive(int routeId, CancellationToken cancellationToken) =>
        Guard(nameof(GetActive), async () => Respond(await _simulations.GetActiveAsync(routeId, cancellationToken)));

    /// <summary>
    /// O anda AKTİF olan TÜM paylaşılan çalıştırmalar (Çalışıyor + Duraklatıldı).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Yetki OKUMA yetkisidir: <c>transport.view</c>.</b> Çalışan hatları
    /// GÖRMEK, onları başlatabilmek ya da durdurabilmekle aynı yetenek
    /// değildir. Buraya <c>transport.simulation.start</c> ya da
    /// <c>transport.simulation.stop</c> koymak, sıradan bir izleyicinin
    /// haritada canlı hatları hiç görememesi demek olurdu — üstelik komşu okuma
    /// ucu (<see cref="GetActive"/>) zaten <c>transport.view</c> istiyor.
    /// </para>
    /// <para>
    /// <b>Yol rota öneki TAŞIMAZ</b> çünkü bu okuma tek bir rotaya ait
    /// değildir. Süzgeç, sayfalama ve arama parametresi de YOKTUR: aktif küme
    /// süreç içi ve doğası gereği küçüktür; arama bir SUNUM kararıdır ve
    /// istemcide yapılır — ikinci bir arama ucu, aynı listenin iki farklı
    /// tanımına açık kapı bırakırdı.
    /// </para>
    /// <para>
    /// <b>İş kuralı burada YOKTUR:</b> aktiflik tanımı ve sıralama servistedir.
    /// </para>
    /// </remarks>
    [HttpGet("active")]
    [RequirePermission(PermissionCodes.TransportView)]
    public Task<ActionResult<IReadOnlyList<TransportSimulationResponse>>> GetActiveSimulations() =>
        Guard<IReadOnlyList<TransportSimulationResponse>>(
            nameof(GetActiveSimulations),
            () => Task.FromResult<ActionResult<IReadOnlyList<TransportSimulationResponse>>>(
                Ok(_simulations.GetActiveSimulations())));

    /// <summary>
    /// Hattaki BELİRLİ bir çalıştırmayı herkes için durdurur.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Yol iki kimliği de taşır ve bu zorunludur.</b> Yalnızca rota taşıyan
    /// bir yol ("şu hatta ne çalışıyorsa durdur"), eski bir sekmenin yerine
    /// geçmiş YENİ bir çalıştırmayı durdurmasına açık kapı bırakırdı. Biçim
    /// komşularıyla aynıdır: rota öneki <c>routes/{routeId}</c>, çalıştırma
    /// eki <c>{simulationId}/stop</c> — kişisel yolculuk ucundaki ekin
    /// aynısı.
    /// </para>
    /// <para>
    /// <b>İş kuralı burada YOKTUR.</b> Kimlik eşleşmesi, atomik sonlandırma,
    /// terminal yayın ve temizlik servis/çalışma zamanı tarafındadır; burada
    /// yalnızca yetki bildirilir ve sonuç mevcut eşlemeyle HTTP'ye çevrilir.
    /// </para>
    /// </remarks>
    [HttpPost("routes/{routeId:int}/{simulationId:guid}/stop")]
    [RequirePermission(PermissionCodes.TransportSimulationStop)]
    public Task<ActionResult<TransportSimulationLiveUpdate>> Stop(
        int routeId,
        Guid simulationId,
        CancellationToken cancellationToken) =>
        Guard(nameof(Stop), async () =>
            Respond(await _simulations.StopAsync(routeId, simulationId, cancellationToken)));

    /// <summary>
    /// Çalışan hattı DURAKLATIR. Terminal DEĞİLDİR.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Yetki bilinçle <c>transport.simulation.stop</c>'tur.</b> Duraklatma,
    /// çok kullanıcılı MEVCUT bir çalıştırmanın mutasyonudur — başlatmakla
    /// aynı yetenek değildir ve <c>transport.simulation.start</c> onu İMA
    /// ETMEZ. Bu faz üç yeni yetki kodu UYDURMAZ: aynı yaşam döngüsü
    /// otoritesi duraklat/sürdür/sıfırla için ortaktır.
    /// </para>
    /// <para>
    /// Yol, sıfırlama ucuyla AYNI biçimi taşır: rota öneki + çalıştırma eki.
    /// Yalnızca rota taşıyan bir yol, eski bir sekmenin yerine geçmiş YENİ bir
    /// çalıştırmayı duraklatmasına açık kapı bırakırdı.
    /// </para>
    /// </remarks>
    [HttpPost("routes/{routeId:int}/{simulationId:guid}/pause")]
    [RequirePermission(PermissionCodes.TransportSimulationStop)]
    public Task<ActionResult<TransportSimulationLiveUpdate>> Pause(
        int routeId,
        Guid simulationId,
        CancellationToken cancellationToken) =>
        Guard(nameof(Pause), async () =>
            Respond(await _simulations.PauseAsync(routeId, simulationId, cancellationToken)));

    /// <summary>
    /// Duraklatılmış hattı KALDIĞI YERDEN sürdürür.
    /// </summary>
    /// <remarks>
    /// Yeni bir çalıştırma başlatmaz; bu yüzden <c>transport.simulation.start</c>
    /// İSTEMEZ. Kimlik, güzergah ve ilerleme aynı kalır.
    /// </remarks>
    [HttpPost("routes/{routeId:int}/{simulationId:guid}/resume")]
    [RequirePermission(PermissionCodes.TransportSimulationStop)]
    public Task<ActionResult<TransportSimulationLiveUpdate>> Resume(
        int routeId,
        Guid simulationId,
        CancellationToken cancellationToken) =>
        Guard(nameof(Resume), async () =>
            Respond(await _simulations.ResumeAsync(routeId, simulationId, cancellationToken)));

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
