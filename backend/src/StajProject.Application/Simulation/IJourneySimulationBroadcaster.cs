namespace StajProject.Application.Simulation;

/// <summary>
/// Kişisel yolculuk güncellemesinin kendi grubuna iletilmesi.
/// </summary>
/// <remarks>
/// Mevcut <see cref="ITransportSimulationBroadcaster"/> ile aynı katman
/// gerekçesi: runner Infrastructure'dadır ve SignalR'ı tanımaz; port
/// Application'da durur, uygulaması Api'dedir. Ayrı bir port olması,
/// paylaşılan hat yayınının kişisel yolculuk gruplarına sızmasını yapısal
/// olarak imkânsız kılar.
/// </remarks>
public interface IJourneySimulationBroadcaster
{
    Task PublishAsync(JourneySimulationLiveUpdate update, CancellationToken cancellationToken = default);
}
