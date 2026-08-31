using StajProject.Application.Journeys;

namespace StajProject.Application.Simulation;

/// <summary>
/// Bir kullanıcının KİŞİSEL yolculuk simülasyonunun değişmez çalışma zamanı
/// durumu.
/// </summary>
/// <remarks>
/// <para>
/// <b>Paylaşılan hat simülasyonundan AYRIDIR.</b>
/// <see cref="ActiveTransportSimulation"/> bir <c>TransportRoute</c>'a aittir,
/// birden çok izleyicisi olabilir ve yönetim yetkisiyle başlatılır. Bu ise tek
/// bir kullanıcıya aittir, hatta bağlı olmak zorunda değildir (POI'ler ve
/// farklı hatlar karışabilir) ve yalnızca sahibi görebilir. İkisini tek tipte
/// birleştirmek, "rota başına tek" ile "kullanıcı başına tek" kurallarını aynı
/// yerde çelişkiye sokardı.
/// </para>
/// <para>
/// <b>EF ya da HTTP kalıntısı TAŞIMAZ.</b> Durum singleton bir depoda istek
/// ömrünü aşarak yaşar; buraya giren her şey sıradan, değişmez veridir —
/// <c>DbContext</c>, <c>ClaimsPrincipal</c>, <c>HttpContext</c> ya da takip
/// edilen bir varlık asla girmez.
/// </para>
/// </remarks>
public sealed record ActiveJourneySimulation(
    Guid SimulationId,

    /// <summary>Sahibin doğrulanmış kullanıcı kimliği; sahiplik kararının TEK kaynağı.</summary>
    int OwnerUserId,
    JourneyMode Mode,
    JourneyTravelProfile RequestedProfile,

    /// <summary>Güzergahı gerçekten üreten motor profili.</summary>
    string EffectiveProfile,
    DateTime StartedAt,
    JourneySimulationPath Path,

    /// <summary>Yenilemeden sonra sunumu geri kurmaya yeten DEĞİŞMEZ veri.</summary>
    JourneySimulationDetails Details,
    JourneySimulationSnapshot Snapshot)
{
    public ActiveJourneySimulation With(JourneySimulationSnapshot snapshot) =>
        this with { Snapshot = snapshot };
}

/// <summary>
/// Simülasyonun üzerinde ilerlediği OTORİTER güzergah kopyası.
/// </summary>
/// <param name="Points">Sunucunun yeniden planladığı geometrinin köşeleri.</param>
/// <param name="DistanceMeters">Yönlendirme motorunun ölçtüğü toplam mesafe.</param>
/// <param name="DurationSeconds">
/// Yönlendirme motorunun ölçtüğü GERÇEK seyahat süresi. Demo oynatma çarpanı
/// bu değeri DEĞİŞTİRMEZ; yalnızca ne hızda oynatıldığını belirler.
/// </param>
/// <param name="StepDistances">
/// Manevra başına kümülatif BİTİŞ mesafesi. Anlık manevrayı ilerlemeden
/// türetmek için gerekir; adım yoksa boştur ve bu GEÇERLİDİR.
/// </param>
public sealed record JourneySimulationPath(
    IReadOnlyList<TransportSimulationPoint> Points,
    double DistanceMeters,
    double DurationSeconds,
    IReadOnlyList<double> StepDistances);

/// <summary>
/// Çalıştırmanın SUNUM metadatası: başlangıçta bir kez kopyalanır, sonra
/// değişmez.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden depoda durur.</b> Sayfa yenilendiğinde tarayıcının elinde hiçbir
/// şey kalmaz; "mevcut çalıştırma" ucu yalnızca konumu döndürebilseydi panel
/// hattın adını, durak etiketlerini ve manevraları KAYBEDERDİ. Bunları o anda
/// yeniden üretmek ya rota/POI tablolarını yeniden sorgulamayı ya da
/// yönlendirme motoruna yeniden gitmeyi gerektirirdi; ikisi de yolculuğun
/// başlatıldığı andaki gerçeği değiştirebilirdi.
/// </para>
/// <para>
/// <b>Kaynak DAİMA sunucunun kendi plan sonucudur</b> (<c>PlanAsync</c>),
/// istemcinin gönderdiği hiçbir şey değil. Tutulan her alan sıradan, değişmez
/// bir değerdir: EF varlığı, <c>DbContext</c>, <c>ClaimsPrincipal</c> ya da
/// bir NetTopologySuite nesnesi buraya GİRMEZ.
/// </para>
/// <para>
/// Geometri metni de burada saklanır: aynı WKT'yi iki farklı yerde üretmek
/// (başlatmada yazıcıdan, kurtarmada köşelerden), iki ucun sessizce ayrışan
/// iki metin döndürmesi demekti.
/// </para>
/// </remarks>
/// <param name="GeometryWkt">Kanonik API biçimi; başlangıçta bir kez üretilir.</param>
/// <param name="Steps">Manevralar; kalıcı güzergah yeniden kullanıldığında BOŞ olur.</param>
public sealed record JourneySimulationDetails(
    string GeometryWkt,
    int? RouteId,
    string? RouteName,
    IReadOnlyList<JourneyPlannedWaypoint> Waypoints,
    IReadOnlyList<JourneyRouteStep> Steps);

/// <summary>Sunucunun otoritesi altındaki tek bir an.</summary>
public sealed record JourneySimulationSnapshot(
    TransportSimulationPoint Position,
    int SegmentIndex,
    double ProgressRatio,
    double DistanceCoveredMeters,

    /// <summary>Anlık manevranın sırası; manevra yoksa <c>null</c>.</summary>
    int? CurrentStepSequence,
    DateTime CapturedAt);
