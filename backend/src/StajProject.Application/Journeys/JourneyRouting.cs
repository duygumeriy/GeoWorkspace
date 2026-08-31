using NetTopologySuite.Geometries;

namespace StajProject.Application.Journeys;

/// <summary>Yönlendirme motoruna gönderilecek tek bir WGS84 noktası.</summary>
/// <remarks>
/// Sağlayıcıdan BAĞIMSIZ bir tiptir ve bilinçli olarak <c>OsrmWaypoint</c>
/// yerine geçmez: yolculuk planlaması OSRM'i tanımaz, yalnızca "sıralı
/// koordinatlar" gönderir. Eşleme Infrastructure'daki adaptörün işidir.
/// </remarks>
public sealed record JourneyCoordinate(double Longitude, double Latitude);

/// <summary>
/// Profil farkındalıklı yönlendirme isteği.
/// </summary>
/// <param name="Profile">Ürün profili; motor adresi BUNDAN türetilir.</param>
/// <param name="Coordinates">
/// Sırası DEĞİŞTİRİLMEDEN yönlendirilecek noktalar. Sıra normalleştirmesi
/// planlama servisinde bitmiştir; yönlendirme katmanı yeniden sıralama yapmaz.
/// </param>
public sealed record JourneyRouteRequest(
    JourneyTravelProfile Profile,
    IReadOnlyList<JourneyCoordinate> Coordinates);

/// <summary>
/// Tek bir seyir manevrası.
/// </summary>
/// <remarks>
/// <para>
/// <b>Kararlı meta veri, ham yanıt değil.</b> Alanlar sağlayıcıdan bağımsız
/// adlarla taşınır; OSRM'nin JSON şekli, alan adları ve iç yapısı bu
/// sözleşmenin parçası DEĞİLDİR.
/// </para>
/// <para>
/// <b><see cref="DisplayText"/> uydurulmaz.</b> OSRM çekirdeği insan
/// okunabilir talimat üretmez (bu ayrı bir kütüphanenin işidir); motor bir
/// metin vermiyorsa alan <c>null</c> kalır. Bu fazda büyük bir Türkçe çeviri
/// katmanı gömülmez — arayüz <see cref="ManeuverType"/> ve
/// <see cref="ManeuverModifier"/> üzerinden kendi metnini üretebilir.
/// </para>
/// </remarks>
public sealed record JourneyRouteStep(
    int Sequence,
    string ManeuverType,
    string? ManeuverModifier,
    string? Name,
    double DistanceMeters,
    double DurationSeconds,
    JourneyCoordinate ManeuverLocation,
    string? DisplayText);

/// <summary>
/// Gerçekten hesaplanmış bir güzergah.
/// </summary>
/// <param name="EngineProfile">
/// Güzergahı ÜRETEN motorun profili. Talep edilenle aynı olmak zorundadır —
/// sessiz bir düşüş asla etiketlenmez; uyuşmazlık durumunda istek hiç
/// yapılmaz.
/// </param>
public sealed record JourneyRouteResult(
    LineString Geometry,
    double DistanceMeters,
    double DurationSeconds,
    string EngineProfile,
    IReadOnlyList<JourneyRouteStep> Steps);

/// <summary>Bir plan geometrisinin NEREDEN geldiği.</summary>
/// <remarks>
/// Provenans gizlenmez: kalıcı güzergahın yeniden kullanılması ile önizleme
/// için canlı hesaplanmış geçici bir güzergah, kullanıcı ve sonraki fazlar
/// için AYNI ŞEY DEĞİLDİR.
/// </remarks>
public enum JourneyGeometrySource
{
    /// <summary>Rotanın kalıcı <c>TransportRoutePath</c> geometrisi aynen kullanıldı.</summary>
    PersistedRoutePath,

    /// <summary>
    /// Önizleme için canlı hesaplandı; hiçbir yere YAZILMADI ve simülasyonun
    /// işleteceği otoriter güzergah değildir.
    /// </summary>
    LiveRouting
}
