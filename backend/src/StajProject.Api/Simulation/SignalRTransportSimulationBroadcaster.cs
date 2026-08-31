using Microsoft.AspNetCore.SignalR;
using StajProject.Api.Hubs;
using StajProject.Application.Simulation;

namespace StajProject.Api.Simulation;

/// <summary>
/// <see cref="ITransportSimulationBroadcaster"/>'ın SignalR uygulaması.
/// </summary>
/// <remarks>
/// <para>
/// <b>Katman yönü korunur.</b> Runner Infrastructure'dadır ve SignalR'ı
/// TANIMAZ; yalnızca Application'daki portu çağırır. Bu adaptör Api'de yaşar,
/// çünkü hub da oradadır — Infrastructure'ın Api'ye bağımlı olması katman
/// sırasını tersine çevirirdi.
/// </para>
/// <para>
/// Yayın YALNIZCA ilgili rotanın grubuna gider. Grup adı tek bir yerden
/// (<see cref="TransportSimulationHubContract.GroupFor"/>) türetilir; hub ile
/// yayıncının farklı adlar üretmesi, yayının sessizce kimseye ulaşmaması
/// demekti.
/// </para>
/// </remarks>
public sealed class SignalRTransportSimulationBroadcaster : ITransportSimulationBroadcaster
{
    private readonly IHubContext<TransportSimulationHub> _hub;

    public SignalRTransportSimulationBroadcaster(IHubContext<TransportSimulationHub> hub)
    {
        _hub = hub;
    }

    public Task PublishAsync(
        TransportSimulationLiveUpdate update,
        CancellationToken cancellationToken = default) =>
        _hub.Clients
            .Group(TransportSimulationHubContract.GroupFor(update.RouteId))
            .SendAsync(TransportSimulationHubContract.UpdateMethod, update, cancellationToken);
}
