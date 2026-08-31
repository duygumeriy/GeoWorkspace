using System.Text.Json.Serialization;

namespace StajProject.Application.Simulation;

/// <summary>Kişisel yolculuk çalıştırmasının yaşam döngüsü durumu.</summary>
/// <remarks>
/// Tel üzerinde AD olarak taşınır; sayısal bir enum, istemcinin sıralamaya
/// bağımlı kalması demekti. Mevcut ulaşım durumlarıyla aynı üç değerdir ama
/// AYRI bir tiptir: iki ürünün yaşam döngüsü ileride ayrışabilir ve tek enum
/// o günü zorlaştırırdı.
/// </remarks>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum JourneySimulationStatus
{
    Running,
    Completed,
    Cancelled
}

/// <summary>
/// Canlı yayın sözleşmesi: istemcinin işaretçiyi çizmek ve navigasyon panelini
/// güncellemek için ihtiyaç duyduğu her şey — ve fazlası DEĞİL.
/// </summary>
/// <remarks>
/// <para>
/// <b>Bilinçli olarak dışarıda:</b> geometri (istemci onu başlatma yanıtından
/// alır), sahip kimliği, iç oturum nesnesi, motor adresleri ve altyapı
/// ayrıntıları. Kanal saniyede bir yayın yapar; oraya konan her fazlalık hem
/// bant genişliği hem sızıntı yüzeyidir.
/// </para>
/// <para>
/// <see cref="CurrentStepSequence"/> <c>null</c> olabilir ve bu bir hata
/// DEĞİLDİR: kalıcı güzergahı yeniden kullanan bir tam-hat yolculuğunda
/// manevra verisi yoktur ve uydurulmaz.
/// </para>
/// </remarks>
public sealed record JourneySimulationLiveUpdate(
    Guid SimulationId,
    JourneySimulationStatus Status,
    double Longitude,
    double Latitude,
    double ProgressPercent,
    double DistanceCoveredMeters,
    int? CurrentStepSequence,
    DateTime UpdatedAtUtc)
{
    public static JourneySimulationLiveUpdate From(
        ActiveJourneySimulation simulation,
        JourneySimulationStatus status) =>
        new(
            simulation.SimulationId,
            status,
            simulation.Snapshot.Position.Longitude,
            simulation.Snapshot.Position.Latitude,
            Math.Clamp(simulation.Snapshot.ProgressRatio, 0, 1) * 100,
            simulation.Snapshot.DistanceCoveredMeters,
            simulation.Snapshot.CurrentStepSequence,
            simulation.Snapshot.CapturedAt);
}

/// <summary>
/// Kişisel yolculuk kanalının adlandırma sözleşmesi.
/// </summary>
/// <remarks>
/// <para>
/// Mevcut <see cref="TransportSimulationHubContract"/>'tan AYRI bir yol, ayrı
/// bir olay ve ayrı bir grup ön eki kullanır. Paylaşılan hat kanalını yeniden
/// yüklemek, iki farklı yetkilendirme kuralına sahip iki ürünü aynı gruplara
/// sokardı; kişisel bir yolculuk yanlışlıkla bir hat grubuna katılamamalıdır.
/// </para>
/// <para>
/// <b>Grup adı bir YETKİ DEĞİLDİR.</b> Ad simülasyon kimliğinden türetilir ama
/// kimin katılabileceğine SAHİPLİK karar verir; hub üyeliği açmadan önce sahibi
/// doğrular. Aksi hâlde bir kimlik tahmin eden biri başkasının yolculuğunu
/// izleyebilirdi.
/// </para>
/// </remarks>
public static class JourneySimulationHubContract
{
    public const string Path = "/hubs/journey-simulation";

    public const string UpdateMethod = "JourneySimulationUpdated";

    private const string GroupPrefix = "journey-simulation-";

    public static string GroupFor(Guid simulationId) => GroupPrefix + simulationId.ToString("N");
}
