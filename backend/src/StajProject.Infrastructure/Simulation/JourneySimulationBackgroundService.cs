using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using StajProject.Application.Options;

namespace StajProject.Infrastructure.Simulation;

/// <summary>
/// Kişisel yolculuk runner'ını düzenli aralıklarla çalıştıran servis.
/// </summary>
/// <remarks>
/// Mevcut ulaşım servisiyle aynı kalıp ve aynı gerekçe: yalnızca "ne zaman"
/// sorusunu yanıtlar, "nerede" sorusunun tek sahibi runner'dır. Aralık kayarsa
/// konum BOZULMAZ — ilerleme geçen süreden türetilir.
///
/// Ayrı bir servis olması bilinçlidir: iki ürünün tick aralığı ayrı
/// yapılandırılabilir ve birinin durması diğerini durdurmaz.
/// </remarks>
public sealed class JourneySimulationBackgroundService : BackgroundService
{
    private readonly JourneySimulationRunner _runner;
    private readonly JourneySimulationOptions _options;
    private readonly ILogger<JourneySimulationBackgroundService> _logger;

    public JourneySimulationBackgroundService(
        JourneySimulationRunner runner,
        JourneySimulationOptions options,
        ILogger<JourneySimulationBackgroundService> logger)
    {
        _runner = runner;
        _options = options;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(_options.TickIntervalMilliseconds));

        _logger.LogInformation(
            "Yolculuk simülasyon runner'ı başlatıldı. Aralık: {Interval} ms, Oynatma çarpanı: {Speed}",
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
