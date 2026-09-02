namespace StajProject.Application.Simulation;

/// <summary>
/// Simülasyon durumunun DEĞİŞMEZ (immutable) veri modeli.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden EF varlıkları değil.</b> Aktif simülasyon durumu istek ömrünü aşar
/// ve singleton bir depoda yaşar; oraya konan bir <c>TransportRoutePath</c> ya
/// da <c>LineString</c>, kapanmış bir <c>AppDbContext</c>'in change tracker'ına
/// bağlı kalır ve zamanla ya bellek sızdırır ya da lazy-load denemesiyle
/// patlar. Bu yüzden veritabanından okunan yol, istek sınırında sıradan
/// sayılara KOPYALANIR ve depoya yalnızca bu kopya girer.
/// </para>
/// <para>
/// Tüm tipler <c>record</c> ve koleksiyonlar salt okunurdur: durum
/// güncellemesi bir alanı değiştirerek değil, YENİ bir anlık görüntü
/// üretilerek yapılır. Böylece bir okuyucu, yarı güncellenmiş bir durum
/// göremez.
/// </para>
/// </remarks>
public sealed record TransportSimulationPoint(double Longitude, double Latitude);

/// <summary>Simülasyonun üzerinde ilerlediği, ölçülmüş güzergah kopyası.</summary>
/// <param name="Points">SRID 4326 sırasında güzergah köşeleri; en az iki nokta.</param>
/// <param name="DistanceMeters">Kalıcı yolun toplam uzunluğu (OSRM ölçümü).</param>
/// <param name="DurationSeconds">Kalıcı yolun toplam süresi (OSRM ölçümü).</param>
/// <param name="Profile">Yolun üretildiği OSRM profili.</param>
/// <param name="GeneratedAt">Yolun üretildiği an; hangi sürümün işletildiğini gösterir.</param>
public sealed record TransportSimulationPath(
    IReadOnlyList<TransportSimulationPoint> Points,
    double DistanceMeters,
    double DurationSeconds,
    string Profile,
    DateTime GeneratedAt);

/// <summary>
/// Sunucunun otoritesi altındaki tek bir an: aracın nerede olduğu.
/// </summary>
/// <remarks>
/// İstemci bu değeri ÜRETMEZ, yalnızca okur. Sonraki fazın runner'ı ilerledikçe
/// yeni bir <see cref="TransportSimulationSnapshot"/> yazar; tek gerçek kaynağı
/// budur.
/// </remarks>
/// <param name="Position">Aracın anlık konumu.</param>
/// <param name="SegmentIndex">İçinde bulunulan segmentin başlangıç köşesi.</param>
/// <param name="ProgressRatio">0..1 aralığında ilerleme oranı.</param>
/// <param name="DistanceCoveredMeters">Kat edilen mesafe.</param>
/// <param name="CapturedAt">Anlık görüntünün üretildiği UTC an.</param>
/// <param name="CurrentStepSequence">
/// Aracın İÇİNDE BULUNDUĞU manevranın OTORİTER sırası; güzergahın manevrası
/// yoksa <c>null</c>.
///
/// <para>
/// <b>Anlık görüntünün parçasıdır ve bu kasıtlıdır.</b> Değeri her okuyanın
/// yeniden hesaplaması, "şu an hangi adımdayız" sorusunun birden çok sahibi
/// olması demekti — duraklatılmış bir çalıştırmada saat dururken adım da
/// kendiliğinden donar, çünkü donan şey anlık görüntünün kendisidir.
/// </para>
/// </param>
/// <param name="DistanceToNextManeuverMeters">
/// SONRAKİ manevraya kalan mesafe; sonraki manevra yoksa <c>null</c>. Sunucu
/// hesaplar; tarayıcı yalnızca biçimlendirir.
/// </param>
public sealed record TransportSimulationSnapshot(
    TransportSimulationPoint Position,
    int SegmentIndex,
    double ProgressRatio,
    double DistanceCoveredMeters,
    DateTime CapturedAt,
    int? CurrentStepSequence = null,
    double? DistanceToNextManeuverMeters = null);

/// <summary>Bir rota üzerinde çalışan tek aktif simülasyon.</summary>
/// <param name="SimulationId">
/// Çalıştırmanın kimliği. Rota kimliği yeniden kullanılabilir olduğundan
/// (durdur/başlat), güncellemeler bu değere göre eşlenir: geç kalmış bir
/// runner, kendisinden sonra başlatılmış bir simülasyonun durumunu ezemez.
/// </param>
/// <param name="Status">
/// Çalıştırmanın YAŞAM DÖNGÜSÜ durumu. Duraklatma bir SUNUM tercihi değil
/// otoriter bir durumdur: runner duraklatılmış çalıştırmayı ilerletmez, aynı
/// hatta ikinci bir başlatma reddedilir ve geç kalmış bir tick durumu geri
/// alamaz. Terminal durumlar depoda TUTULMAZ — sonlandırma kaydı kaldırır —
/// bu yüzden burada pratikte yalnızca <c>Running</c> ve <c>Paused</c> görülür.
/// </param>
/// <param name="PausedAt">
/// Duraklatma anı; çalışırken <c>null</c>'dır. Simülasyon saatinin
/// DONDURULMASINI sağlayan değer budur: duraklatılmışken geçen süre
/// <c>utcNow</c> yerine bu ana göre ölçülür.
/// </param>
/// <param name="AccumulatedPausedDuration">
/// Bu çalıştırmanın şimdiye kadar duraklatılmış olarak geçirdiği TOPLAM süre.
/// Devam ettirmede eklenir ve geçen süreden düşülür.
/// </param>
public sealed record ActiveTransportSimulation(
    Guid SimulationId,
    int RouteId,
    string RouteName,
    string RouteColorHex,
    int StartedByUserId,
    DateTime StartedAt,
    TransportSimulationPath Path,
    TransportSimulationSnapshot Snapshot,
    TransportSimulationStatus Status = TransportSimulationStatus.Running,
    DateTime? PausedAt = null,
    TimeSpan AccumulatedPausedDuration = default,
    /* NAVİGASYON ÇALIŞTIRMAYA AİTTİR, rotaya değil. Aynı hatta yerine geçen
       yeni bir çalıştırma kendi kopyasını taşır; böylece bir çalıştırmanın
       adım listesi başka bir çalıştırmanınkiyle karışamaz ve yol yeniden
       üretildiğinde çalışan simülasyon eski adımlarla devam etmez —
       geçersizleşme onu zaten iptal eder. */
    TransportRouteNavigation? Navigation = null)
{
    /// <summary>Bu çalıştırmanın OTORİTER manevraları; yoksa boş.</summary>
    public TransportRouteNavigation Steps => Navigation ?? TransportRouteNavigation.Empty;

    /// <summary>Aynı çalıştırmanın yeni anlık görüntüsü.</summary>
    public ActiveTransportSimulation With(TransportSimulationSnapshot snapshot) =>
        this with { Snapshot = snapshot };

    /// <summary>Duraklatılmış mı? Duraklatma TERMİNAL DEĞİLDİR.</summary>
    public bool IsPaused => Status == TransportSimulationStatus.Paused;

    /// <summary>
    /// Çalıştırmanın GEÇEN SİMÜLASYON SÜRESİ (saniye), duraklamalar düşülmüş.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b><c>StartedAt</c> ASLA değiştirilmez.</b> Duraklama süresini gizlemek
    /// için başlangıcı ileri kaydırmak en kısa yol olurdu ama <c>StartedAt</c>
    /// o anda anlamını yitirirdi: "bu çalıştırma ne zaman başladı" sorusunun
    /// cevabı, duraklatıldıkça sessizce değişen bir değere dönerdi — kayıtlar,
    /// yanıtlar ve gelecekteki denetim izleri bundan etkilenirdi. Duraklama
    /// AYRI ve AÇIK bir muhasebeyle tutulur.
    /// </para>
    /// <para>
    /// <b>Duraklatılmışken saat DURUR:</b> ölçüm <c>utcNow</c> yerine
    /// <c>PausedAt</c>'e göre yapılır. Bu olmasaydı devam ettirmede araç,
    /// duraklamada geçen sürenin tamamı kadar ileri sıçrardı.
    /// </para>
    /// </remarks>
    public double ElapsedSeconds(DateTime utcNow)
    {
        var reference = PausedAt ?? utcNow;
        var elapsed = reference - StartedAt - AccumulatedPausedDuration;
        return elapsed < TimeSpan.Zero ? 0 : elapsed.TotalSeconds;
    }

    /// <summary>
    /// Çalışan çalıştırmayı duraklatır. KONUM ve İLERLEME değişmez; yalnızca
    /// anlık görüntünün ZAMAN DAMGASI geçiş anına taşınır.
    /// </summary>
    /// <remarks>
    /// Damganın tazelenmesi zorunludur: geçiş, kendisinden önceki son
    /// <c>Running</c> tick'iyle aynı damgayı taşısaydı istemcideki sıralama
    /// kuralı ikisini ayırt edemez ve yolda kalmış bir tick duraklatmayı geri
    /// alabilirdi. Damga ilerler, ölçüm ilerlemez.
    /// </remarks>
    public ActiveTransportSimulation Pause(DateTime now) =>
        this with
        {
            Status = TransportSimulationStatus.Paused,
            PausedAt = now,
            Snapshot = Snapshot with { CapturedAt = now }
        };

    /// <summary>
    /// Duraklatılmış çalıştırmayı sürdürür ve duraklama süresini muhasebeye
    /// ekler; böylece devam ettirme İLERİ SIÇRAMAZ.
    /// </summary>
    public ActiveTransportSimulation Resume(DateTime now)
    {
        var paused = PausedAt is { } pausedAt && now > pausedAt ? now - pausedAt : TimeSpan.Zero;

        return this with
        {
            Status = TransportSimulationStatus.Running,
            PausedAt = null,
            AccumulatedPausedDuration = AccumulatedPausedDuration + paused,
            // Aynı gerekçe: konum aynı kalır, damga geçiş anına taşınır.
            Snapshot = Snapshot with { CapturedAt = now }
        };
    }
}
