using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using StajProject.Application.Interfaces;
using StajProject.Application.Journeys;
using StajProject.Application.Simulation;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// Terminal hâle gelmiş kişisel yolculuğu geçmişe yazar.
/// </summary>
/// <remarks>
/// <para>
/// <b>Kayda giren her şey SUNUCUNUN kendi çalışma zamanı durumundan gelir.</b>
/// Kip, profil, ölçümler ve adların hepsi <see cref="ActiveJourneySimulation"/>
/// içindedir ve o durum başlatma anında sunucunun kendi plan sonucundan
/// kopyalanmıştır. İstemciden gelen hiçbir değer bu tabloya ulaşamaz.
/// </para>
/// <para>
/// <b>MÜKERRERLİK ÜÇ KATMANDA engellenir.</b> (1) Yalnızca terminal geçişi
/// kazanan kod yolu buraya çağrı yapar; (2) yazmadan önce aynı çalıştırma
/// kimliği için satır var mı diye bakılır; (3) veritabanında
/// <c>simulation_id</c> tekildir. Üçü de gereklidir: birincisi doğruluğun
/// kaynağıdır, ikincisi yeniden denemeyi sessiz ve ucuz kılar, üçüncüsü ise
/// ilk ikisi bir gün gevşerse son savunma hattıdır.
/// </para>
/// <para>
/// <b>ATOMİK.</b> Kayıt ve noktaları TEK bir <c>SaveChanges</c> ile yazılır;
/// yarım bir tutanak (başlığı olan ama noktaları olmayan) oluşamaz.
/// </para>
/// <para>
/// <b>Arıza simülasyonu BOZMAZ.</b> Terminal geçiş zaten kazanılmıştır ve geri
/// alınamaz; bir veritabanı hatası yüzünden istisna fırlatmak, çalıştırmayı
/// durduran isteği ya da runner tick'ini başarısız gösterirdi. Hata yutulmaz —
/// iz bırakılır (mevcut <see cref="JourneyActivityRecorder"/> ile aynı
/// politika).
/// </para>
/// </remarks>
public sealed class JourneyHistoryWriter : IJourneyHistoryWriter
{
    private readonly AppDbContext _dbContext;
    private readonly ILogger<JourneyHistoryWriter> _logger;

    public JourneyHistoryWriter(AppDbContext dbContext, ILogger<JourneyHistoryWriter> logger)
    {
        _dbContext = dbContext;
        _logger = logger;
    }

    public async Task RecordAsync(
        ActiveJourneySimulation simulation,
        JourneySimulationStatus terminalStatus,
        DateTime endedAtUtc,
        CancellationToken cancellationToken = default)
    {
        /* Savunmacı: `Running` bir GEÇMİŞ değildir. Çağıranların hepsi terminal
           yoldadır, ama bu tabloya çalışan bir yolculuğun sızabileceği tek bir
           yol bile bırakılmaz. */
        if (terminalStatus is not (JourneySimulationStatus.Completed or JourneySimulationStatus.Cancelled))
        {
            return;
        }

        try
        {
            var alreadyRecorded = await _dbContext.JourneyHistories
                .AsNoTracking()
                .AnyAsync(item => item.SimulationId == simulation.SimulationId, cancellationToken);

            if (alreadyRecorded)
            {
                /* Yeniden deneme ya da mükerrer bir terminal geri çağırımı:
                   sessizce ve BAŞARIYLA biter. İkinci bir satır yazmak,
                   kullanıcının geçmişinde aynı yolculuğu iki kez göstermek
                   olurdu. */
                return;
            }

            var history = Build(simulation, terminalStatus, endedAtUtc);

            _dbContext.JourneyHistories.Add(history);

            // TEK SaveChanges: kayıt ve noktaları ya birlikte yazılır ya hiç.
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            /* Tekil indeks ihlali de buraya düşer ve DOĞRU davranış budur:
               yarışı kaybeden yazma sessizce vazgeçer, kazananın satırı
               yerinde kalır. Diğer arızalar da çalıştırmayı etkilemez ama
               izsiz bırakılmaz. */
            _logger.LogError(
                exception,
                "Yolculuk geçmişi yazılamadı. SimulationId: {SimulationId}, Status: {Status}",
                simulation.SimulationId,
                terminalStatus);
        }
    }

    /// <summary>
    /// Çalışma zamanı durumundan DEĞİŞMEZ tutanağı kurar.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Süre duvar saatinden TÜRETİLMEZ.</b> Kişisel simülasyon bir demo
    /// oynatma çarpanıyla çalışır: <c>EndedAt − StartedAt</c>, gösterimin ne
    /// kadar sürdüğünü söyler, yolculuğun ne kadar sürdüğünü değil. Kullanıcıya
    /// "yolculuk süresi" olarak gösterilecek değer motorun ölçtüğü gerçek
    /// süredir; zaman damgaları ise yolculuğun NE ZAMAN yapıldığını anlatır ve
    /// ikisi ayrı sorulardır.
    /// </para>
    /// <para>
    /// <b>Kat edilen mesafe terminal anda DONAR.</b> Anlık ilerleme değildir:
    /// çalıştırma bittikten sonra da doğru kalan bir olgudur ve "tamamlandı"
    /// ile "yarıda durduruldu" arasındaki farkı tek başına anlatır.
    /// </para>
    /// </remarks>
    private static JourneyHistory Build(
        ActiveJourneySimulation simulation,
        JourneySimulationStatus terminalStatus,
        DateTime endedAtUtc)
    {
        /* Saat geriye kayarsa (NTP düzeltmesi) `ended_at >= started_at` kısıtı
           tutanağı tamamen kaybettirirdi; başlangıca sabitlemek, kaydı
           korurken sıfır uzunlukta ve dürüst bir aralık bırakır. */
        var endedAt = endedAtUtc < simulation.StartedAt ? simulation.StartedAt : endedAtUtc;

        var history = new JourneyHistory
        {
            UserId = simulation.OwnerUserId,

            /* Çalıştırma kimliği TARİHSEL kimliktir: "hangi koşu" sorusunun
               cevabıdır ve tekil indeksin dayanağıdır. Yeniden kullanımda ASLA
               okunmaz. */
            SimulationId = simulation.SimulationId,
            Mode = JourneyContractNames.Of(simulation.Mode),

            /* TALEP EDİLEN profil saklanır: kullanıcının niyeti budur ve
               kişisel yolculukta desteklenmeyen bir profile sessizce
               düşülmediği için gerçekleşen de aynısıdır. */
            Profile = JourneyContractNames.Of(simulation.RequestedProfile),
            TerminalStatus = terminalStatus.ToString(),
            StartedAt = simulation.StartedAt,
            EndedAt = endedAt,
            DistanceMeters = NonNegative(simulation.Path.DistanceMeters),
            DurationSeconds = NonNegative(simulation.Path.DurationSeconds),

            /* Tamamlanan çalıştırmada kat edilen mesafe toplamı GEÇEMEZ:
               son tick kırpma sonrası tam uzunluğu verir, ama ölçüm gürültüsü
               tutanağı kısıt ihlaline düşürmemelidir. */
            CoveredDistanceMeters = Math.Min(
                NonNegative(simulation.Snapshot.DistanceCoveredMeters),
                NonNegative(simulation.Path.DistanceMeters)),
            RouteId = simulation.Details.RouteId,
            RouteDisplayName = simulation.Details.RouteName,
            CreatedDate = endedAt,
        };

        foreach (var point in SnapshotPoints(simulation))
        {
            history.Points.Add(point);
        }

        return history;
    }

    /// <summary>
    /// Kipe göre TARİHSEL noktalar.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Serbest kipte noktaların KENDİSİ yolculuktur</b> ve tamamı saklanır:
    /// hem tarihsel gösterim hem yeniden kullanım onlardan okunur.
    /// </para>
    /// <para>
    /// <b>Hat tabanlı kiplerde yalnızca UÇLAR saklanır.</b> Tam hat
    /// yolculuğunun otuz durağını her koşu için kopyalamak, hiç okunmayacak
    /// satırlarla tabloyu şişirirdi; kaydın anlattığı şey zaten hattın
    /// kendisidir (kimliği ve o günkü adı başlıkta durur) ve kullanıcının
    /// listede görmek istediği "nereden nereye"dir. Yeniden kullanım da bu
    /// noktalara ihtiyaç duymaz: tam hat kipi hattın kimliğinden, bölüm kipi
    /// ise tam olarak bu iki uçtan yeniden kurulur.
    /// </para>
    /// </remarks>
    private static IEnumerable<JourneyHistoryPoint> SnapshotPoints(ActiveJourneySimulation simulation)
    {
        var waypoints = simulation.Details.Waypoints;

        if (waypoints.Count == 0) yield break;

        if (simulation.Mode == JourneyMode.Waypoints)
        {
            for (var index = 0; index < waypoints.Count; index++)
            {
                yield return ToPoint(index, waypoints[index]);
            }

            yield break;
        }

        yield return ToPoint(0, waypoints[0]);

        // Tek duraklı bir hat uçları AYNI noktaya düşürürdü; ikinci satır yazılmaz.
        if (waypoints.Count > 1)
        {
            yield return ToPoint(1, waypoints[^1]);
        }
    }

    private static JourneyHistoryPoint ToPoint(int sequence, JourneyPlannedWaypoint waypoint) =>
        new()
        {
            Sequence = sequence,
            Source = JourneyContractNames.Of(waypoint.Source),
            ReferenceId = waypoint.ReferenceId,

            /* Ad ÇALIŞTIRMA ANINDAKİ addır. Kayıt sonradan yeniden
               adlandırılsa bile geçmiş, kullanıcının o gün gördüğünü
               göstermeye devam eder. Boş ad kolon kısıtını ihlal ederdi;
               sunucu her zaman bir ad çözer, yine de savunmacı bir taban
               bırakılır. */
            DisplayName = string.IsNullOrWhiteSpace(waypoint.Name) ? "—" : waypoint.Name,
        };

    private static double NonNegative(double value) =>
        double.IsFinite(value) && value > 0 ? value : 0;
}
