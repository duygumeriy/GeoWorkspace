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
public sealed record TransportSimulationSnapshot(
    TransportSimulationPoint Position,
    int SegmentIndex,
    double ProgressRatio,
    double DistanceCoveredMeters,
    DateTime CapturedAt);

/// <summary>Bir rota üzerinde çalışan tek aktif simülasyon.</summary>
/// <param name="SimulationId">
/// Çalıştırmanın kimliği. Rota kimliği yeniden kullanılabilir olduğundan
/// (durdur/başlat), güncellemeler bu değere göre eşlenir: geç kalmış bir
/// runner, kendisinden sonra başlatılmış bir simülasyonun durumunu ezemez.
/// </param>
public sealed record ActiveTransportSimulation(
    Guid SimulationId,
    int RouteId,
    string RouteName,
    string RouteColorHex,
    int StartedByUserId,
    DateTime StartedAt,
    TransportSimulationPath Path,
    TransportSimulationSnapshot Snapshot)
{
    /// <summary>Aynı çalıştırmanın yeni anlık görüntüsü.</summary>
    public ActiveTransportSimulation With(TransportSimulationSnapshot snapshot) =>
        this with { Snapshot = snapshot };
}
