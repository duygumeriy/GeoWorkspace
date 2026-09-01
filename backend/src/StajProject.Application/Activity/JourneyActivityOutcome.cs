using System.Text.Json;
using StajProject.Application.Journeys;

namespace StajProject.Application.Activity;

/// <summary>
/// Kişisel yolculuğun kaydedilen YAŞAM DÖNGÜSÜ olayları.
/// </summary>
/// <remarks>
/// Üç olay vardır ve üçü de sunucudaki bir DURUM GEÇİŞİDİR. Önizleme, rota
/// hesaplama, takip/takibi bırakma, panel ve balon açma/kapama, kurtarma,
/// SignalR katılımı ve hareket tick'leri bilinçli olarak DIŞARIDADIR: hiçbiri
/// sistemin kalıcı durumunu değiştirmez ve kaydedilselerdi denetim defteri
/// saniyede bir satırla dolup "kim neyi değiştirdi" sorusunu okunmaz hâle
/// getirirdi.
/// </remarks>
public enum JourneyActivityKind
{
    /// <summary>Sunucu çalıştırmayı gerçekten oluşturdu.</summary>
    Started,

    /// <summary>Sahibi AÇIKÇA durdurdu ve terminal geçişi o istek kazandı.</summary>
    Cancelled,

    /// <summary>Sunucu çalışma zamanı doğal olarak sona erdirdi.</summary>
    Completed
}

/// <summary>
/// Bir yolculuk yaşam döngüsü olayının GÜVENLİ iş bağlamı.
/// </summary>
/// <remarks>
/// <para>
/// <b>Geometri buraya giremez.</b> Tip düzeyinde ne WKT, ne koordinat dizisi,
/// ne de köşe listesi taşıyan bir alan vardır; kayda sızabileceği bir yol da
/// bu yüzden yoktur. Taşınan şey kimlik, kip, profil ve sunucunun kendi
/// ölçümlerinden ibarettir.
/// </para>
/// <para>
/// <b>Serbest metin de yoktur.</b> Geçiş noktalarının adları değil yalnızca
/// SAYISI taşınır: bir durak ya da POI adı, kullanıcının yazdığı içeriktir ve
/// denetim kaydının işi onu saklamak değildir.
/// </para>
/// </remarks>
/// <param name="Kind">Yaşam döngüsü olayı.</param>
/// <param name="SimulationId">Çalıştırmanın kimliği.</param>
/// <param name="Mode">Yolculuk kipi (tam hat / hat bölümü / serbest).</param>
/// <param name="RequestedProfile">Kullanıcının seçtiği seyahat profili.</param>
/// <param name="RouteId">Hat tabanlı kiplerde ilgili hat; yoksa <c>null</c>.</param>
/// <param name="WaypointCount">Serbest kipte geçiş noktası SAYISI; yoksa <c>null</c>.</param>
/// <param name="ProgressPercent">Sunucunun bildirdiği son ilerleme; yoksa <c>null</c>.</param>
/// <param name="DistanceMeters">Yönlendirme motorunun ölçtüğü kanonik mesafe.</param>
/// <param name="DurationSeconds">Yönlendirme motorunun ölçtüğü kanonik süre.</param>
public sealed record JourneyActivityOutcome(
    JourneyActivityKind Kind,
    Guid SimulationId,
    JourneyMode Mode,
    JourneyTravelProfile RequestedProfile,
    int? RouteId = null,
    int? WaypointCount = null,
    double? ProgressPercent = null,
    double? DistanceMeters = null,
    double? DurationSeconds = null);

/// <summary>
/// Yolculuk olayının ayrıntı JSON'u.
/// </summary>
/// <remarks>
/// Ulaşım özetiyle AYNI sözleşme: ayrıntılar istek gövdesinden değil, sunucunun
/// doğruladığı iş sonucundan üretilir ve <c>kind</c> ayırt edicisiyle taşınır —
/// arayüz tarafındaki mevcut sunum yardımcısı da bu ayırt ediciyi okur.
/// </remarks>
public static class JourneyActivityDetails
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static string Build(JourneyActivityOutcome outcome)
    {
        var details = new SortedDictionary<string, object?>(StringComparer.Ordinal)
        {
            ["kind"] = outcome.Kind.ToString(),
            ["simulationId"] = outcome.SimulationId.ToString(),
            ["mode"] = outcome.Mode.ToString(),
            ["profile"] = outcome.RequestedProfile.ToString()
        };

        if (outcome.RouteId is { } routeId) details["routeId"] = routeId;
        if (outcome.WaypointCount is { } waypoints) details["waypointCount"] = waypoints;

        // Yüzde SUNUCUNUN değeridir; burada bir tahmin ya da yuvarlama üretilmez.
        if (outcome.ProgressPercent is { } progress) details["progressPercent"] = progress;
        if (outcome.DistanceMeters is { } distance) details["distanceMeters"] = distance;
        if (outcome.DurationSeconds is { } duration) details["durationSeconds"] = duration;

        return JsonSerializer.Serialize(details, Json);
    }
}
