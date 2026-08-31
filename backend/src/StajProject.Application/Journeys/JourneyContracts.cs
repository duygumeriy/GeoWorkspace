namespace StajProject.Application.Journeys;

/// <summary>
/// Bir yolculuk planının hangi KAYNAKTAN türetildiği.
/// </summary>
/// <remarks>
/// <para>
/// Üç kip bilinçli olarak AYRIDIR ve tek bir "serbest nokta listesi"ne
/// indirgenmez: rota tabanlı iki kip, kalıcı <c>TransportRoute</c> topolojisine
/// bağlıdır (durak sırası, hattın kimliği, hattın rengi anlamlıdır), serbest
/// kip ise hiçbir hatta ait değildir. İkisini tek kip yapmak, "hangi hattın
/// üzerindeyiz" sorusunun cevabını sessizce kaybettirirdi.
/// </para>
/// </remarks>
public enum JourneyMode
{
    /// <summary>Var olan bir hattın TÜM duraklarının, kalıcı sırasıyla planlanması.</summary>
    RouteFull,

    /// <summary>Aynı hat üzerinde seçilmiş iki durak ARASINDAKİ bölüm.</summary>
    RouteSegment,

    /// <summary>
    /// Hattan bağımsız, sıralı serbest nokta listesi: farklı hatlardaki
    /// duraklar ve POI'ler aynı listede karışabilir.
    /// </summary>
    Waypoints
}

/// <summary>
/// Bir geçiş noktasının hangi KALICI kayda işaret ettiği.
/// </summary>
/// <remarks>
/// İstemci ASLA ham koordinat göndermez; yalnızca var olan bir kaydın kimliğini
/// gönderir ve koordinat sunucuda çözülür. Serbest koordinat kabul edilseydi,
/// coğrafi yazma sınırı ve kayıt görünürlüğü (silinmiş/pasif POI) tamamen
/// baypas edilebilirdi.
/// </remarks>
public enum JourneyWaypointSource
{
    /// <summary>Bir <c>TransportStop</c> kaydı.</summary>
    TransportStop,

    /// <summary>Bir <c>Poi</c> kaydı.</summary>
    Poi
}

/// <summary>İstemcinin TALEP ettiği seyahat profili.</summary>
/// <remarks>
/// Bu, sunucunun gerçekten yönlendirebileceği profil DEĞİLDİR: talep ile
/// gerçekleşme arasındaki fark <see cref="JourneyProfilePolicy"/> tarafından
/// açıkça bildirilir. İkisini tek alanda birleştirmek, yürüyüş isteyen bir
/// kullanıcıya araç ağı üzerinde hesaplanmış bir süreyi "yürüyüş süresi" diye
/// göstermek olurdu.
/// </remarks>
public enum JourneyTravelProfile
{
    Driving,
    Walking,
    Cycling
}

/// <summary>Talep edilen profilin bu kurulumda gerçekten karşılanıp karşılanamadığı.</summary>
/// <remarks>
/// Bilinçli olarak İKİ durum vardır. Faz 5A'daki "yaklaşık" durumu KALDIRILDI:
/// bir profil ya kendi motoruyla gerçekten yönlendirilir ya da kullanılamaz.
/// Üçüncü bir durum bırakmak, sürüş sonucunu yürüyüş/bisiklet diye etiketlemenin
/// kapısını açık tutardı.
/// </remarks>
public enum JourneyProfileSupport
{
    /// <summary>Bu profil için yapılandırılmış gerçek bir motor güzergahı üretti.</summary>
    Routed,

    /// <summary>Bu profil için yapılandırılmış bir motor yok; istek reddedilir.</summary>
    Unavailable
}

/// <summary>Normalleştirilmiş bir geçiş noktasının plandaki rolü.</summary>
public enum JourneyWaypointRole
{
    Origin,
    Via,
    Destination
}

/// <summary>
/// Metin sözleşme değerlerinin (JSON gövdesi) enum'lara güvenli çevrimi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden metin.</b> İstek DTO'ları enum bağlamaz: bilinmeyen bir enum
/// değeri model binder'da patlar ve servis katmanı ona kendi
/// <c>ServiceResult</c> mesajını üretme şansı bulamaz. Metin taşıyıp burada
/// çözmek, tüm hata yollarını tek ve mevcut hata sözleşmesinde tutar.
/// </para>
/// <para>
/// Karşılaştırma büyük/küçük harf duyarsızdır; bunun dışında serbest eşleme
/// YOKTUR — kısaltma, çoğul veya eşanlamlı kabul edilmez.
/// </para>
/// </remarks>
public static class JourneyContractNames
{
    public const string RouteFull = "routeFull";
    public const string RouteSegment = "routeSegment";
    public const string Waypoints = "waypoints";

    public const string TransportStop = "transportStop";
    public const string Poi = "poi";

    public const string Driving = "driving";
    public const string Walking = "walking";
    public const string Cycling = "cycling";

    public static bool TryParseMode(string? value, out JourneyMode mode)
    {
        mode = default;
        if (Matches(value, RouteFull)) { mode = JourneyMode.RouteFull; return true; }
        if (Matches(value, RouteSegment)) { mode = JourneyMode.RouteSegment; return true; }
        if (Matches(value, Waypoints)) { mode = JourneyMode.Waypoints; return true; }
        return false;
    }

    public static bool TryParseSource(string? value, out JourneyWaypointSource source)
    {
        source = default;
        if (Matches(value, TransportStop)) { source = JourneyWaypointSource.TransportStop; return true; }
        if (Matches(value, Poi)) { source = JourneyWaypointSource.Poi; return true; }
        return false;
    }

    public static bool TryParseProfile(string? value, out JourneyTravelProfile profile)
    {
        profile = default;
        if (Matches(value, Driving)) { profile = JourneyTravelProfile.Driving; return true; }
        if (Matches(value, Walking)) { profile = JourneyTravelProfile.Walking; return true; }
        if (Matches(value, Cycling)) { profile = JourneyTravelProfile.Cycling; return true; }
        return false;
    }

    public static string Of(JourneyMode mode) => mode switch
    {
        JourneyMode.RouteFull => RouteFull,
        JourneyMode.RouteSegment => RouteSegment,
        _ => Waypoints
    };

    public static string Of(JourneyWaypointSource source) =>
        source == JourneyWaypointSource.TransportStop ? TransportStop : Poi;

    public static string Of(JourneyTravelProfile profile) => profile switch
    {
        JourneyTravelProfile.Driving => Driving,
        JourneyTravelProfile.Walking => Walking,
        _ => Cycling
    };

    public static string Of(JourneyGeometrySource source) =>
        source == JourneyGeometrySource.PersistedRoutePath ? "persistedRoutePath" : "liveRouting";

    public static string Of(JourneyProfileSupport support) =>
        support == JourneyProfileSupport.Routed ? "routed" : "unavailable";

    public static string Of(JourneyWaypointRole role) => role switch
    {
        JourneyWaypointRole.Origin => "origin",
        JourneyWaypointRole.Via => "via",
        _ => "destination"
    };

    private static bool Matches(string? value, string canonical) =>
        string.Equals(value?.Trim(), canonical, StringComparison.OrdinalIgnoreCase);
}
