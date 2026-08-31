using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using StajProject.Application.Options;

namespace StajProject.Infrastructure.Simulation;

/// <summary>
/// Runner'ı düzenli aralıklarla çalıştıran barındırılan servis.
/// </summary>
/// <remarks>
/// <para>
/// Servis yalnızca "ne zaman" sorusunu yanıtlar; "nerede" sorusunun tek sahibi
/// <see cref="TransportSimulationRunner"/>'dır. Aralık kayarsa konum
/// BOZULMAZ: ilerleme geçen süreden türetilir, tick sayısından değil.
/// </para>
/// <para>
/// <see cref="PeriodicTimer"/> kullanılır; <c>Task.Delay</c> döngüsünden farkı,
/// tick süresinin işin süresine EKLENMEMESİDİR.
/// </para>
/// </remarks>
public sealed class TransportSimulationBackgroundService : BackgroundService
{
    private readonly TransportSimulationRunner _runner;
    private readonly TransportSimulationOptions _options;
    private readonly ILogger<TransportSimulationBackgroundService> _logger;

    public TransportSimulationBackgroundService(
        TransportSimulationRunner runner,
        TransportSimulationOptions options,
        ILogger<TransportSimulationBackgroundService> logger)
    {
        _runner = runner;
        _options = options;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(_options.TickIntervalMilliseconds));

        _logger.LogInformation(
            "Ulaşım simülasyon runner'ı başlatıldı. Aralık: {Interval} ms, Hız çarpanı: {Speed}",
            _options.TickIntervalMilliseconds,
            _options.SpeedMultiplier);

        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                await _runner.AdvanceAsync(DateTime.UtcNow, stoppingToken);
            }
        }
        catch (OperationCanceledException)
        {
            // Uygulama kapanıyor; bu bir hata değildir.
        }
    }
}
