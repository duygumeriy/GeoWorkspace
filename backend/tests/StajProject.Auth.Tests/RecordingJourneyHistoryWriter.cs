using StajProject.Application.Interfaces;
using StajProject.Application.Simulation;

namespace StajProject.Auth.Tests;

/// <summary>
/// Yazılan yolculuk geçmişi çağrılarını toplayan test yazıcısı.
/// </summary>
/// <remarks>
/// <para>
/// Paylaşılan bir dosyadır çünkü <see cref="Application.Interfaces.IJourneyHistoryWriter"/>
/// artık kişisel simülasyon servisinin bağımlılığıdır: geçmişle hiç
/// ilgilenmeyen testlerin de bir uygulama vermesi gerekir. Bu tip onlara
/// GÖRÜNMEZ bir varsayılan değil, davranışı açıkça okunabilen bir kayıt
/// tutucu verir.
/// </para>
/// <para>
/// Gerçek kalıcılığı sınayan testler bunu KULLANMAZ; onlar gerçek
/// <c>JourneyHistoryWriter</c>'ı süreç içi bir veritabanının üzerine kurar —
/// mükerrerlik ve atomiklik ancak orada kanıtlanabilir.
/// </para>
/// </remarks>
public sealed class RecordingJourneyHistoryWriter : IJourneyHistoryWriter
{
    public List<(ActiveJourneySimulation Simulation, JourneySimulationStatus Status, DateTime EndedAt)> Written { get; } = [];

    public Task RecordAsync(
        ActiveJourneySimulation simulation,
        JourneySimulationStatus terminalStatus,
        DateTime endedAtUtc,
        CancellationToken cancellationToken = default)
    {
        Written.Add((simulation, terminalStatus, endedAtUtc));
        return Task.CompletedTask;
    }
}
