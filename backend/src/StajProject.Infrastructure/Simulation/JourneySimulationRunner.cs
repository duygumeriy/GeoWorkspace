using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;
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

    /* Kümülatif mesafeler çalıştırma başına BİR KEZ ölçülür; binlerce köşeyi
       her tick'te yeniden ölçmek boşuna iştir. Anahtar simulationId olduğu
       için yeni bir çalıştırma eski ölçümü devralmaz. */
    private readonly ConcurrentDictionary<Guid, TransportSimulationTrack> _tracks = new();

    public JourneySimulationRunner(
        IJourneySimulationStateStore state,
        IJourneySimulationBroadcaster broadcaster,
        JourneySimulationOptions options,
        ILogger<JourneySimulationRunner> logger)
    {
        _state = state;
        _broadcaster = broadcaster;
        _options = options;
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

            await CancelAsync(simulation, cancellationToken);
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

    private async Task CancelAsync(ActiveJourneySimulation simulation, CancellationToken cancellationToken)
    {
        if (!_state.TryStop(simulation.SimulationId))
        {
            _tracks.TryRemove(simulation.SimulationId, out _);
            return;
        }

        _tracks.TryRemove(simulation.SimulationId, out _);
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
