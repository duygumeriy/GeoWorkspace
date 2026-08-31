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
/// İki ardışık geçiş noktası arasındaki adım.
/// </summary>
/// <remarks>
/// <b>Bu adım henüz bir MANEVRA değildir.</b> Bu fazda yönlendirme motoru hiç
/// çağrılmaz; adım, plan iskeletinin noktadan noktaya kırılımıdır. Mesafe alanı
/// bu yüzden <see cref="StraightLineDistanceMeters"/> olarak adlandırılmıştır —
/// "dönüş talimatı" ya da "yol mesafesi" gibi okunabilecek bir ad, sonraki
/// fazda gelecek gerçek OSRM adımlarıyla karıştırılırdı.
/// </remarks>
public sealed class JourneyNavigationStepResponse
{
    public int StepIndex { get; set; }

    public int FromWaypointPosition { get; set; }

    public int ToWaypointPosition { get; set; }

    public string FromName { get; set; } = string.Empty;

    public string ToName { get; set; } = string.Empty;

    /// <summary>Büyük çember (kuş uçuşu) mesafe; yol mesafesi DEĞİLDİR.</summary>
    public double StraightLineDistanceMeters { get; set; }

    /// <summary>İnsan tarafından okunabilir, iç ayrıntı içermeyen adım metni.</summary>
    public string Instruction { get; set; } = string.Empty;
}

/// <summary>Planın tek bakışta okunabilir özeti.</summary>
public sealed class JourneyPlanSummaryResponse
{
    public string Mode { get; set; } = string.Empty;

    /// <summary>İstemcinin talep ettiği profil.</summary>
    public string RequestedProfile { get; set; } = string.Empty;

    /// <summary>Planın gerçekte üzerine kurulduğu motor profili.</summary>
    public string EffectiveProfile { get; set; } = string.Empty;

    /// <summary><c>routed</c>, <c>approximated</c> veya <c>unsupported</c>.</summary>
    public string ProfileSupport { get; set; } = string.Empty;

    /// <summary>Yalnızca rota tabanlı kiplerde dolu.</summary>
    public int? RouteId { get; set; }

    public string? RouteName { get; set; }

    public int WaypointCount { get; set; }

    public int StepCount { get; set; }

    /// <summary>Adımların kuş uçuşu mesafeleri toplamı; yol mesafesi DEĞİLDİR.</summary>
    public double StraightLineDistanceMeters { get; set; }

    /// <summary>
    /// Plan gerçek bir yol geometrisi üzerinde hesaplandı mı? Bu fazda daima
    /// <c>false</c>'tur ve alan tam olarak bunu itiraf etmek için vardır.
    /// </summary>
    public bool IsRouted { get; set; }

    /// <summary>
    /// Sonucun hangi varsayımlarla üretildiği (profil politikası, yön
    /// normalleştirmesi). Boş liste "varsayım yok" demektir.
    /// </summary>
    public IReadOnlyList<string> Assumptions { get; set; } = [];
}

/// <summary>
/// Planlama önizlemesinin tam yanıtı.
/// </summary>
/// <remarks>
/// <see cref="PlanId"/> bir OTURUM kimliği değildir: bu fazda hiçbir yerde
/// saklanmaz, yalnızca istemcinin bir önizlemeyi kendi arayüzünde
/// tanımlayabilmesi ve sonraki fazda canlı bir oturumun bu plana
/// bağlanabilmesi için üretilir.
/// </remarks>
public sealed class JourneyPlanPreviewResponse
{
    public Guid PlanId { get; set; }

    public DateTime CreatedAt { get; set; }

    public JourneyPlanSummaryResponse Summary { get; set; } = new();

    public IReadOnlyList<JourneyWaypointResponse> Waypoints { get; set; } = [];

    public IReadOnlyList<JourneyNavigationStepResponse> Steps { get; set; } = [];
}
