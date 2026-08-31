namespace StajProject.Application.Simulation;

/// <summary>
/// Canlı güncellemenin ilgili rota grubuna iletilmesi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden bir port.</b> Runner Infrastructure'dadır, SignalR ise Api'nin
/// sorumluluğudur. Infrastructure'ın Api'ye başvurması katman bağımlılığını
/// TERSİNE çevirirdi; bu arayüz Application'da durur, uygulaması Api'de
/// (<c>IHubContext</c> üzerinden) yaşar.
/// </para>
/// <para>
/// Yayın <b>yalnızca</b> ilgili rotanın grubuna gider; tüm istemcilere
/// yayın yapılmaz.
/// </para>
/// </remarks>
public interface ITransportSimulationBroadcaster
{
    Task PublishAsync(TransportSimulationLiveUpdate update, CancellationToken cancellationToken = default);
}
