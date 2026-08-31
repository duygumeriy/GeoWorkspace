using Microsoft.AspNetCore.SignalR;
using StajProject.Api.Hubs;
using StajProject.Application.Simulation;

namespace StajProject.Api.Simulation;

/// <summary>
/// <see cref="IJourneySimulationBroadcaster"/>'ın SignalR uygulaması.
/// </summary>
/// <remarks>
/// Katman yönü mevcut hat yayıncısıyla aynıdır: runner Infrastructure'dadır ve
/// SignalR'ı tanımaz. Yayın YALNIZCA o simülasyonun kendi grubuna gider ve grup
/// adı tek bir yerden türetilir; hub ile yayıncının farklı adlar üretmesi,
/// yayının sessizce kimseye ulaşmaması demekti.
/// </remarks>
public sealed class SignalRJourneySimulationBroadcaster : IJourneySimulationBroadcaster
{
    private readonly IHubContext<JourneySimulationHub> _hub;

    public SignalRJourneySimulationBroadcaster(IHubContext<JourneySimulationHub> hub)
    {
        _hub = hub;
    }

    public Task PublishAsync(
        JourneySimulationLiveUpdate update,
        CancellationToken cancellationToken = default) =>
        _hub.Clients
            .Group(JourneySimulationHubContract.GroupFor(update.SimulationId))
            .SendAsync(JourneySimulationHubContract.UpdateMethod, update, cancellationToken);
}
