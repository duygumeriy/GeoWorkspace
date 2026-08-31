namespace StajProject.Application.DTOs;

/// <summary>
/// Tek bir geçiş noktası referansı.
/// </summary>
/// <remarks>
/// <b>Koordinat YOKTUR ve olmamalıdır.</b> İstemci yalnızca var olan bir
/// kaydın kaynağını ve kimliğini bildirir; konum sunucuda çözülür. Serbest
/// koordinat kabul edilseydi silinmiş/pasif bir kaydın konumu ya da hiç
/// kaydedilmemiş bir nokta plana sızabilirdi.
/// </remarks>
public sealed class JourneyWaypointRequest
{
    /// <summary><c>transportStop</c> veya <c>poi</c>.</summary>
    public string? Source { get; set; }

    /// <summary>Kaynak tablodaki kayıt kimliği.</summary>
    public int? ReferenceId { get; set; }

    /// <summary>
    /// İsteğe bağlı açık sıra değeri. Verilirse TÜM noktalarda verilmelidir ve
    /// değerler benzersiz olmalıdır; verilmezse dizinin kendi sırası kullanılır.
    /// </summary>
    public int? Order { get; set; }
}

/// <summary>
/// Genel yolculuk planlama isteği.
/// </summary>
/// <remarks>
/// <para>
/// <b>Enum yerine metin.</b> Bilinmeyen bir enum değeri model binder'da
/// patlar ve servis kendi <see cref="Common.ServiceResult{T}"/> mesajını
/// üretemez. Metin taşınıp serviste çözülür; böylece geçersiz kip/profil de
/// diğer doğrulama hatalarıyla aynı sözleşmeden döner.
/// </para>
/// <para>
/// <b>Alanlar kipe göre ayrışır.</b> Tek bir düz gövde, kipe ait OLMAYAN
/// alanların sessizce yok sayılmasına izin verirdi; servis bunun yerine
/// yabancı alanları AÇIKÇA reddeder.
/// </para>
/// </remarks>
public sealed class JourneyPlanRequest
{
    /// <summary><c>routeFull</c>, <c>routeSegment</c> veya <c>waypoints</c>.</summary>
    public string? Mode { get; set; }

    /// <summary>
    /// <c>driving</c>, <c>walking</c> veya <c>cycling</c>.
    /// Boş bırakılırsa <c>driving</c> varsayılır.
    /// </summary>
    public string? Profile { get; set; }

    /// <summary>Rota tabanlı kiplerde zorunlu; serbest kipte bulunmamalıdır.</summary>
    public int? RouteId { get; set; }

    /// <summary><c>routeSegment</c> kipinde zorunlu başlangıç durağı.</summary>
    public int? FromStopId { get; set; }

    /// <summary><c>routeSegment</c> kipinde zorunlu bitiş durağı.</summary>
    public int? ToStopId { get; set; }

    /// <summary><c>waypoints</c> kipinde zorunlu, en az iki elemanlı liste.</summary>
    public IReadOnlyList<JourneyWaypointRequest>? Waypoints { get; set; }
}

/// <summary>Sunucuda çözülmüş ve sıraya sokulmuş tek bir geçiş noktası.</summary>
public sealed class JourneyWaypointResponse
{
    /// <summary>Normalleştirilmiş, sıfır tabanlı plan içi pozisyon.</summary>
    public int Position { get; set; }

    /// <summary><c>transportStop</c> veya <c>poi</c>.</summary>
    public string Source { get; set; } = string.Empty;

    public int ReferenceId { get; set; }

    public string Name { get; set; } = string.Empty;

    public double Longitude { get; set; }

    public double Latitude { get; set; }

    /// <summary>Yalnızca durak referanslarında dolu.</summary>
    public int? RouteId { get; set; }

    /// <summary>Yalnızca durak referanslarında dolu; hattaki kalıcı sıra.</summary>
    public int? SequenceOrder { get; set; }

    /// <summary><c>origin</c>, <c>via</c> veya <c>destination</c>.</summary>
    public string Role { get; set; } = string.Empty;
}

/// <summary>
/// Tek bir seyir manevrası.
/// </summary>
/// <remarks>
/// <para>
/// Faz 5A'da bu tip iki geçiş noktası arasındaki KUŞ UÇUŞU bacağı taşıyordu.
/// Artık gerçek bir manevradır: değerler yönlendirme motorundan gelir ve
/// düz çizgi ölçüsü sonuçta HİÇ yer almaz.
/// </para>
/// <para>
/// Alanlar sağlayıcıdan bağımsızdır; ham motor yanıtı, alan adları veya iç
/// yapısı bu sözleşmenin parçası değildir.
/// </para>
/// </remarks>
public sealed class JourneyNavigationStepResponse
{
    /// <summary>Sıfır tabanlı, plan boyunca artan sıra.</summary>
    public int Sequence { get; set; }

    /// <summary>Kararlı manevra türü (ör. <c>turn</c>, <c>depart</c>, <c>arrive</c>).</summary>
    public string ManeuverType { get; set; } = string.Empty;

    /// <summary>Manevra yönü (ör. <c>left</c>, <c>slight right</c>); yoksa <c>null</c>.</summary>
    public string? ManeuverModifier { get; set; }

    /// <summary>Yol/sokak adı; motor vermiyorsa <c>null</c>.</summary>
    public string? Name { get; set; }

    public double DistanceMeters { get; set; }

    public double DurationSeconds { get; set; }

    public double ManeuverLongitude { get; set; }

    public double ManeuverLatitude { get; set; }

    /// <summary>
    /// Motorun verdiği hazır talimat metni; YOKSA <c>null</c> kalır.
    /// </summary>
    /// <remarks>
    /// OSRM çekirdeği insan okunabilir talimat üretmez. Metin UYDURULMAZ ve bu
    /// fazda gömülü bir çeviri katmanı da eklenmez; arayüz gerektiğinde
    /// <see cref="ManeuverType"/> ve <see cref="ManeuverModifier"/> üzerinden
    /// kendi metnini üretir.
    /// </remarks>
    public string? DisplayText { get; set; }
}

/// <summary>Planın tek bakışta okunabilir özeti.</summary>
public sealed class JourneyPlanSummaryResponse
{
    public string Mode { get; set; } = string.Empty;

    /// <summary>İstemcinin talep ettiği profil.</summary>
    public string RequestedProfile { get; set; } = string.Empty;

    /// <summary>
    /// Güzergahı gerçekte ÜRETEN motor profili. Talep edilenden farklı bir
    /// değere sessizce düşülmez; kalıcı güzergah yeniden kullanıldığında o
    /// kaydın kendi profilidir.
    /// </summary>
    public string EffectiveProfile { get; set; } = string.Empty;

    /// <summary><c>routed</c> veya <c>unavailable</c>.</summary>
    public string ProfileSupport { get; set; } = string.Empty;

    /// <summary><c>persistedRoutePath</c> veya <c>liveRouting</c>.</summary>
    public string GeometrySource { get; set; } = string.Empty;

    /// <summary>Yalnızca rota tabanlı kiplerde dolu.</summary>
    public int? RouteId { get; set; }

    public string? RouteName { get; set; }

    public int WaypointCount { get; set; }

    public int StepCount { get; set; }

    /// <summary>Yol ağı üzerinde ölçülmüş toplam mesafe.</summary>
    public double DistanceMeters { get; set; }

    /// <summary>Yol ağı üzerinde ölçülmüş toplam süre.</summary>
    public double DurationSeconds { get; set; }

    /// <summary>
    /// Sonucun hangi varsayımlarla üretildiği (geometri kaynağı, adım
    /// erişilebilirliği, yön normalleştirmesi). Boş liste "varsayım yok" demektir.
    /// </summary>
    public IReadOnlyList<string> Assumptions { get; set; } = [];
}

/// <summary>
/// Planlama önizlemesinin tam yanıtı.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="PlanId"/> yalnızca İLİŞKİLENDİRME içindir: hiçbir yerde
/// saklanmaz, imzalanmaz ve bir YETKİ BELİRTECİ DEĞİLDİR. Sonraki fazlar bir
/// simülasyonu, istemciden gelen bir plan kimliğine ya da geometriye
/// GÜVENEREK başlatmamalıdır; sunucu her zaman kendi verisinden yeniden
/// çözmelidir.
/// </para>
/// </remarks>
public sealed class JourneyPlanPreviewResponse
{
    public Guid PlanId { get; set; }

    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Güzergah geometrisi; projenin kanonik API biçimi olan WKT
    /// <c>LINESTRING</c> (SRID 4326, <c>boylam enlem</c>).
    /// </summary>
    public string GeometryWkt { get; set; } = string.Empty;

    public JourneyPlanSummaryResponse Summary { get; set; } = new();

    public IReadOnlyList<JourneyWaypointResponse> Waypoints { get; set; } = [];

    /// <summary>
    /// Seyir manevraları. Kalıcı güzergah yeniden kullanıldığında BOŞ olur:
    /// o kayıt adım verisi taşımaz ve yalnızca adım üretmek için motora
    /// yeniden gidilmez.
    /// </summary>
    public IReadOnlyList<JourneyNavigationStepResponse> Steps { get; set; } = [];
}
