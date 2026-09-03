using System.Collections.Concurrent;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using StajProject.Application.Activity;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Application.Simulation;

namespace StajProject.Infrastructure.Simulation;

/// <summary>
/// Kişisel yolculuk hareketinin SUNUCU tarafındaki tek üreticisi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Zamanı tarayıcı ölçmez.</b> İlerleme, biriktirilen tick sayısından değil,
/// <see cref="ActiveJourneySimulation.StartedAt"/> ile sunucu saati arasındaki
/// GEÇEN SÜREDEN türetilir. Tick toplamak her gecikmede kalıcı bir sapma
/// biriktirirdi; geçen süreden türetmek bir tick kaçsa bile bir sonraki yayında
/// doğru konumu verir.
/// </para>
/// <para>
/// <b>Oynatma çarpanı GÖSTERİLEN süreyi değiştirmez.</b> Çarpan yalnızca
/// demonun ne hızda oynatıldığını belirler; panelde yazan süre yönlendirme
/// motorunun gerçek ölçümüdür.
/// </para>
/// <para>
/// <b>Otoriter geometri üzerinde interpolasyon.</b> Konum, geçiş noktaları
/// arasında düz çizgiyle DEĞİL, mevcut ve kanıtlanmış
/// <see cref="TransportSimulationTrack"/> ile yol geometrisinin kümülatif
/// METRE mesafeleri üzerinden bulunur. Bu ilkel zaten sağlayıcıdan bağımsız ve
/// saf olduğu için ikinci bir kopya yazılmaz — iki ince farklı algoritma,
/// zamanla iki farklı harekete dönüşürdü.
/// </para>
/// <para>
/// <b>Kimlik denetimi korunur.</b> Her yazma simülasyon kimliğiyle yapılır; geç
/// kalmış bir tick, aynı kullanıcının sonradan başlattığı YENİ bir yolculuğu ne
/// günceller ne de durdurur.
/// </para>
/// </remarks>
public sealed class JourneySimulationRunner
{
    private readonly IJourneySimulationStateStore _state;
    private readonly IJourneySimulationBroadcaster _broadcaster;
    private readonly JourneySimulationOptions _options;
    private readonly ILogger<JourneySimulationRunner> _logger;

    /* Runner SINGLETON, aktivite yazıcısı ise SCOPED (DbContext taşır). Kapsam
       yalnızca gerçekten yazılacak bir olay olduğunda — yani çalıştırma başına
       en fazla bir kez — açılır ve hemen kapanır; hiçbir DbContext tick'ler
       arasında tutulmaz. */
    private readonly IServiceScopeFactory _scopeFactory;

    /* Kümülatif mesafeler çalıştırma başına BİR KEZ ölçülür; binlerce köşeyi
       her tick'te yeniden ölçmek boşuna iştir. Anahtar simulationId olduğu
       için yeni bir çalıştırma eski ölçümü devralmaz. */
    private readonly ConcurrentDictionary<Guid, TransportSimulationTrack> _tracks = new();

    public JourneySimulationRunner(
        IJourneySimulationStateStore state,
        IJourneySimulationBroadcaster broadcaster,
        JourneySimulationOptions options,
        IServiceScopeFactory scopeFactory,
        ILogger<JourneySimulationRunner> logger)
    {
        _state = state;
        _broadcaster = broadcaster;
        _options = options;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    /// <summary>
    /// Tek bir ilerleme adımı. Zaman DIŞARIDAN verilir; davranış gerçek
    /// beklemeler olmadan deterministik biçimde sınanabilir.
    /// </summary>
    public async Task AdvanceAsync(DateTime utcNow, CancellationToken cancellationToken = default)
    {
        foreach (var simulation in _state.Active())
        {
            if (cancellationToken.IsCancellationRequested) return;

            try
            {
                await AdvanceOneAsync(simulation, utcNow, cancellationToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                /* Bir çalıştırmadaki hata diğerlerini durdurmaz: runner sürecin
                   ömrü boyunca ayakta kalmak zorundadır. */
                _logger.LogError(
                    exception,
                    "Yolculuk simülasyonu ilerletilemedi. SimulationId: {SimulationId}",
                    simulation.SimulationId);
            }
        }
    }

    private async Task AdvanceOneAsync(
        ActiveJourneySimulation simulation,
        DateTime utcNow,
        CancellationToken cancellationToken)
    {
        var track = _tracks.GetOrAdd(
            simulation.SimulationId,
            _ => TransportSimulationTrack.Create(simulation.Path.Points));

        if (!track.IsUsable)
        {
            /* Savunmacı: tek köşeli ya da sıfır uzunluklu bir güzergahta hiç
               ilerlenemez. Sonsuza dek %0'da bırakmak yerine iptal edilir ve
               istemci bunu ÖĞRENİR. */
            _logger.LogWarning(
                "Yolculuk simülasyonu kullanılamayan bir güzergah üzerinde; iptal ediliyor. SimulationId: {SimulationId}",
                simulation.SimulationId);

            await CancelAsync(simulation, utcNow, cancellationToken);
            return;
        }

        var durationSeconds = _options.EffectiveDurationSeconds(simulation.Path.DurationSeconds);
        var elapsedSeconds = (utcNow - simulation.StartedAt).TotalSeconds * _options.SpeedMultiplier;
        var ratio = Math.Clamp(elapsedSeconds / durationSeconds, 0, 1);

        var position = track.At(ratio);

        var snapshot = new JourneySimulationSnapshot(
            position.Point,
            position.SegmentIndex,
            position.ProgressRatio,
            position.DistanceMeters,
            JourneyStepDistances.StepAt(simulation.Path.StepDistances, position.DistanceMeters),
            utcNow);

        var advanced = simulation.With(snapshot);

        if (position.ProgressRatio >= 1)
        {
            /* Tamamlanma: önce durumdan KALDIRILIR, sonra son konum ve
               tamamlanma tek olayda yayınlanır. Sıra bilinçlidir — kaldırma
               başarısız olursa (araya yenisi girmişse) hiçbir şey yayınlanmaz
               ve bu tick sessizce düşer. Böylece Completed bir kez gider. */
            if (_state.TryStop(simulation.SimulationId))
            {
                _tracks.TryRemove(simulation.SimulationId, out _);

                /* Denetim kaydı ve GEÇMİŞ TAM OLARAK bu dalda yazılır: terminal
                   geçişi kazanan tick burasıdır. Bayat bir tick ya da araya
                   giren bir durdurma isteği `TryStop`u kaybeder ve ikinci bir
                   satır yazamaz — mükerrerlik yapısal olarak imkânsızdır ve
                   aynı çalıştırma için hem "tamamlandı" hem "iptal edildi"
                   tutanağı oluşamaz. */
                await RecordTerminalAsync(advanced, JourneySimulationStatus.Completed, utcNow, cancellationToken);
                await PublishAsync(advanced, JourneySimulationStatus.Completed, cancellationToken);
            }
            else
            {
                _tracks.TryRemove(simulation.SimulationId, out _);
            }

            return;
        }

        if (!_state.TryUpdateSnapshot(simulation.SimulationId, snapshot))
        {
            // İptal edilmiş ya da yerine yenisi geçmiş: yayın YOK.
            _tracks.TryRemove(simulation.SimulationId, out _);
            return;
        }

        await PublishAsync(advanced, JourneySimulationStatus.Running, cancellationToken);
    }

    /// <summary>
    /// Terminal geçişin KALICI izleri: kullanıcının geçmişi ve denetim defteri.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Yalnızca geçişi KAZANAN çağırır.</b> Her iki çağrı yolu da
    /// <c>TryStop</c>'u kazandıktan sonra buraya gelir; bayat bir tick ya da
    /// araya giren bir durdurma isteği kaybeder ve buraya hiç ulaşamaz.
    /// Mükerrer ya da çelişkili bir tutanak bu yüzden yapısal olarak
    /// imkânsızdır.
    /// </para>
    /// <para>
    /// <b>İKİ defter, İKİ farklı soru.</b> Denetim defteri "kim neyi yaptı"
    /// sorusunu yanıtlar ve MEVCUT davranışı olduğu gibi korunur: yalnızca
    /// doğal tamamlanma bir satır yazar. Geçmiş ise kullanıcının kendi
    /// yolculuk tutanağıdır ve her iki terminal sonuç için de yazılır —
    /// kullanıcının başlattığı bir yolculuk, kullanılamayan bir güzergah
    /// yüzünden sona erse bile "Geçmiş"te iz bırakmadan yok olmamalıdır.
    /// </para>
    /// <para>
    /// <b>Sahip kimliği çalıştırmanın kendi değişmez durumundan gelir.</b> Arka
    /// planda oturum yoktur; uydurma bir "sistem kullanıcısı" ise olayın gerçek
    /// sahibini gizlerdi. Yazma hatası simülasyonu ETKİLEMEZ: her iki kayıt da,
    /// kaydettikleri geçişin yanında ikincil bir sorumluluktur ve geçiş zaten
    /// kazanılmıştır.
    /// </para>
    /// <para>
    /// <b>TEK kapsam açılır.</b> İki yazıcı da <c>DbContext</c> taşır ve
    /// çalıştırma başına en fazla bir kez çözülür; hiçbir kapsam tick'ler
    /// arasında tutulmaz.
    /// </para>
    /// </remarks>
    private async Task RecordTerminalAsync(
        ActiveJourneySimulation simulation,
        JourneySimulationStatus status,
        DateTime utcNow,
        CancellationToken cancellationToken)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();

            var history = scope.ServiceProvider.GetService<IJourneyHistoryWriter>();

            if (history is not null)
            {
                await history.RecordAsync(simulation, status, utcNow, cancellationToken);
            }

            /* Denetim defteri DEĞİŞMEDİ: doğal tamamlanma dışındaki bu terminal
               yol daha önce de satır yazmıyordu ve yazmamaya devam eder. */
            if (status != JourneySimulationStatus.Completed) return;

            var recorder = scope.ServiceProvider.GetService<IJourneyActivityRecorder>();

            if (recorder is null) return;

            await recorder.RecordAsync(
                new JourneyActivityOutcome(
                    JourneyActivityKind.Completed,
                    simulation.SimulationId,
                    simulation.Mode,
                    simulation.RequestedProfile,
                    RouteId: simulation.Details.RouteId,
                    // Terminal ilerleme SUNUCUNUN son değeridir; yuvarlanmaz.
                    ProgressPercent: simulation.Snapshot.ProgressRatio * 100,
                    DistanceMeters: simulation.Path.DistanceMeters,
                    DurationSeconds: simulation.Path.DurationSeconds),
                simulation.OwnerUserId,
                cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _logger.LogWarning(
                exception,
                "Yolculuk terminal kayıtları yazılamadı. Status: {Status}, SimulationId: {SimulationId}",
                status,
                simulation.SimulationId);
        }
    }

    private async Task CancelAsync(
        ActiveJourneySimulation simulation,
        DateTime utcNow,
        CancellationToken cancellationToken)
    {
        if (!_state.TryStop(simulation.SimulationId))
        {
            _tracks.TryRemove(simulation.SimulationId, out _);
            return;
        }

        _tracks.TryRemove(simulation.SimulationId, out _);

        /* GEÇMİŞ bu yolda da yazılır. Denetim defterinde bu geçişin karşılığı
           yoktur ve bu bilinçlidir: defter kullanıcının yaptığı işlemleri
           kaydeder, burada ise kullanıcı hiçbir şey yapmamıştır. Ama
           çalıştırma SONA ERMİŞTİR ve kullanıcının geçmişinde bir iz
           bırakmadan yok olmamalıdır — aksi hâlde başlattığı yolculuk
           "Geçmiş"te hiç görünmezdi. */
        await RecordTerminalAsync(simulation, JourneySimulationStatus.Cancelled, utcNow, cancellationToken);
        await PublishAsync(simulation, JourneySimulationStatus.Cancelled, cancellationToken);
    }

    private async Task PublishAsync(
        ActiveJourneySimulation simulation,
        JourneySimulationStatus status,
        CancellationToken cancellationToken)
    {
        try
        {
            await _broadcaster.PublishAsync(
                JourneySimulationLiveUpdate.From(simulation, status),
                cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            /* Yayın hattındaki bir arıza simülasyonu DURDURMAZ: sunucu durumu
               otoriterdir ve istemci yeniden bağlandığında güncel anlık
               görüntüyü zaten alır. */
            _logger.LogError(
                exception,
                "Yolculuk simülasyonu güncellemesi yayınlanamadı. SimulationId: {SimulationId}",
                simulation.SimulationId);
        }
    }
}
