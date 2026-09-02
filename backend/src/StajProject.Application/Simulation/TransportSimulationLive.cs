using System.Text.Json.Serialization;

namespace StajProject.Application.Simulation;

/// <summary>Bir çalıştırmanın yaşam döngüsü durumu.</summary>
/// <remarks>
/// Tel üzerinde AD olarak taşınır: sayısal bir enum, istemcinin sıralamaya
/// bağımlı kalması ve araya yeni bir durum eklendiğinde sessizce yanlış
/// yorumlaması demekti.
/// </remarks>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum TransportSimulationStatus
{
    /// <summary>Araç yolda.</summary>
    Running,

    /// <summary>
    /// Çalıştırma DURAKLATILDI ve TERMİNAL DEĞİLDİR.
    /// </summary>
    /// <remarks>
    /// Duraklatılmış bir çalıştırma hattın aktif yuvasını İŞGAL ETMEYE devam
    /// eder: aynı hatta ikinci bir simülasyon başlatılamaz, gözlemciler onu
    /// görmeye devam eder ve devam ettirildiğinde AYNI kimlikle kaldığı
    /// yerden sürer. "Çalışmıyor" ile karıştırılmamalıdır.
    /// </remarks>
    Paused,

    /// <summary>Güzergahın sonuna ulaşıldı.</summary>
    Completed,

    /// <summary>
    /// Çalıştırma sonlandırıldı (kullanıcı sıfırladı ya da güzergah
    /// geçersizleşti). TERMİNALDİR: hat yeniden başlatılabilir hâle gelir ve
    /// sonraki başlatma YENİ bir kimlikle %0'dan başlar.
    /// </summary>
    Cancelled
}

/// <summary>
/// Canlı yayın sözleşmesi: istemcinin aracı çizmek için ihtiyaç duyduğu HER
/// ŞEY ve fazlası DEĞİL.
/// </summary>
/// <remarks>
/// <para>
/// <b>Bilinçli olarak dışarıda bırakılanlar:</b> ham geometri (istemci
/// güzergahı zaten mevcut path ucundan alır), OSRM adresleri, altyapı
/// istisnaları, EF varlıkları ve kalıcı kimliklerin ötesinde iç ayrıntılar.
/// Canlı kanal saniyede bir yayın yapar; oraya konan her fazlalık hem bant
/// genişliği hem de sızıntı yüzeyidir.
/// </para>
/// <para>
/// İlerleme YÜZDE olarak taşınır (0..100); istemcinin oranı yeniden
/// ölçeklemesi gerekmez.
/// </para>
/// </remarks>
public sealed record TransportSimulationLiveUpdate(
    Guid SimulationId,
    int RouteId,
    TransportSimulationStatus Status,
    double Longitude,
    double Latitude,
    double ProgressPercent,
    DateTime UpdatedAtUtc)
{
    /// <summary>Depodaki durumdan yayın sözleşmesine dönüşüm.</summary>
    public static TransportSimulationLiveUpdate From(
        ActiveTransportSimulation simulation,
        TransportSimulationStatus status) =>
        new(
            simulation.SimulationId,
            simulation.RouteId,
            status,
            simulation.Snapshot.Position.Longitude,
            simulation.Snapshot.Position.Latitude,
            Math.Clamp(simulation.Snapshot.ProgressRatio, 0, 1) * 100,
            simulation.Snapshot.CapturedAt);
}

/// <summary>
/// Canlı kanalın adlandırma SÖZLEŞMESİ: hub yolu, istemci metodu ve grup adı.
/// </summary>
/// <remarks>
/// <para>
/// Application katmanında durur çünkü hem yayıncı (Api) hem de sözleşmeyi
/// sınayan testler aynı değerleri kullanmalıdır. İki yerde elle yazılmış bir
/// grup adı, yayının sessizce hiç kimseye ulaşmaması demekti.
/// </para>
/// <para>
/// <b>Grup adı ROTA kimliğinden deterministik olarak türetilir.</b> Grup
/// üyeliği bir YETKİ DEĞİLDİR — kimin katılabileceğine etkin
/// <c>transport.view</c> yetkisi karar verir; grup yalnızca yayının kime
/// gideceğini belirler.
/// </para>
/// </remarks>
public static class TransportSimulationHubContract
{
    /// <summary>Hub'ın maplendiği yol.</summary>
    public const string Path = "/hubs/transport-simulation";

    /// <summary>İstemcide çağrılan metot adı.</summary>
    public const string UpdateMethod = "SimulationUpdated";

    private const string GroupPrefix = "transport-simulation-route-";

    /// <summary>Bir rotanın yayın grubu.</summary>
    public static string GroupFor(int routeId) =>
        string.Create(
            System.Globalization.CultureInfo.InvariantCulture,
            $"{GroupPrefix}{routeId}");
}
