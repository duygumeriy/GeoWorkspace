using Microsoft.AspNetCore.SignalR;
using StajProject.Api.Hubs;
using StajProject.Application.Simulation;

namespace StajProject.Api.Simulation;

/// <summary>
/// <see cref="ITransportSimulationDiscoveryBroadcaster"/>'ın SignalR uygulaması.
/// </summary>
/// <remarks>
/// <para>
/// <b>AYNI hub, AYNI bağlantı.</b> Keşif sinyali için ikinci bir hub
/// açılmadı: bu, ikinci bir yol, ikinci bir kimlik doğrulama hattı, ikinci bir
/// yeniden bağlanma davranışı ve istemcide ikinci bir bağlantı demekti — oysa
/// taşınan şey aynı ürünün aynı canlı gerçeğidir. Ayrılan tek şey GRUPTUR.
/// </para>
/// <para>
/// <b>Yayın AYRIM GÖZETMEZ DEĞİLDİR.</b> Sinyal hangi hatların çalıştığını
/// açığa vurur; bu yüzden <c>Clients.All</c> kullanılmaz. Hedef, hub'ın
/// etkin <c>transport.view</c> denetiminden geçmiş bağlantıları içeren keşif
/// grubudur.
/// </para>
/// <para>
/// <b>Taşıma arızası DIŞARI SIZMAZ.</b> Sinyal bir kolaylıktır: çoktan
/// başlamış ya da bitmiş bir çalıştırma, duyurusu yapılamadı diye geri
/// alınamaz. Hata burada loglanır ve çağıranın komutu başarılı kalır;
/// gözlemciler değişikliği bir sonraki okumada ya da yeniden bağlanmada
/// görür.
/// </para>
/// </remarks>
public sealed class SignalRTransportSimulationDiscoveryBroadcaster : ITransportSimulationDiscoveryBroadcaster
{
    private readonly IHubContext<TransportSimulationHub> _hub;
    private readonly ILogger<SignalRTransportSimulationDiscoveryBroadcaster> _logger;

    public SignalRTransportSimulationDiscoveryBroadcaster(
        IHubContext<TransportSimulationHub> hub,
        ILogger<SignalRTransportSimulationDiscoveryBroadcaster> logger)
    {
        _hub = hub;
        _logger = logger;
    }

    public async Task PublishActiveSetChangedAsync(
        TransportActiveSimulationSetChanged change,
        CancellationToken cancellationToken = default)
    {
        try
        {
            await _hub.Clients
                .Group(TransportSimulationHubContract.DiscoveryGroup)
                .SendAsync(
                    TransportSimulationHubContract.ActiveSetChangedMethod,
                    change,
                    cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _logger.LogError(
                exception,
                "Aktif simülasyon keşif sinyali yayınlanamadı. RouteId: {RouteId}, SimulationId: {SimulationId}, Change: {Change}",
                change.RouteId,
                change.SimulationId,
                change.Change);
        }
    }
}
