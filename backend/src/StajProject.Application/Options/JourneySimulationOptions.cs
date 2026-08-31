namespace StajProject.Application.Options;

/// <summary>
/// Kişisel yolculuk simülasyonunun sunucu tarafı ayarları.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden mevcut <see cref="TransportSimulationOptions"/> yeniden
/// kullanılmadı.</b> İki ürünün oynatma hızı aynı olmak ZORUNDA değildir:
/// paylaşılan bir hat demosu ile kişisel bir yolculuk farklı temposu olan
/// gösterimlerdir ve tek bir ayar, birini değiştirmenin diğerini sessizce
/// değiştirmesi demekti. Sınıf bilinçle dar tutulur.
/// </para>
/// <para>
/// <b><see cref="SpeedMultiplier"/> bir DEMO OYNATMA hızlandırmasıdır</b> ve
/// seyahat profiliyle hiçbir ilgisi yoktur. Yürüyüş/bisiklet süresi ondan
/// TÜREMEZ — gerçek süre yönlendirme motorundan gelir ve arayüzde de o
/// gösterilir; çarpan yalnızca gösterimin ne kadar hızlı oynatıldığını
/// belirler.
/// </para>
/// <para>
/// Hız bir SUNUCU ayarıdır, kullanıcı girdisi değil: istemciden gelen bir
/// çarpan, sunucu otoritesini anlamsızlaştırırdı.
/// </para>
/// </remarks>
public sealed class JourneySimulationOptions
{
    public const string SectionName = "JourneySimulation";

    /// <summary>Runner'ın yayın aralığı (ms). İlerleme bundan TÜREMEZ.</summary>
    public int TickIntervalMilliseconds { get; set; } = 1000;

    /// <summary>DEMO oynatma hızlandırması. Gösterilen süreyi değiştirmez.</summary>
    public double SpeedMultiplier { get; set; } = 10;

    /// <summary>Motorun süresi kullanılamaz olduğunda kullanılacak savunmacı taban.</summary>
    public double FallbackDurationSeconds { get; set; } = 300;

    public void Validate()
    {
        if (TickIntervalMilliseconds is < 100 or > 60_000)
        {
            throw new InvalidOperationException(
                "JourneySimulation:TickIntervalMilliseconds 100 ile 60000 arasında olmalıdır.");
        }

        if (!double.IsFinite(SpeedMultiplier) || SpeedMultiplier is <= 0 or > 1_000)
        {
            throw new InvalidOperationException(
                "JourneySimulation:SpeedMultiplier 0 (hariç) ile 1000 arasında olmalıdır.");
        }

        if (!double.IsFinite(FallbackDurationSeconds) || FallbackDurationSeconds is <= 0 or > 86_400)
        {
            throw new InvalidOperationException(
                "JourneySimulation:FallbackDurationSeconds 0 (hariç) ile 86400 arasında olmalıdır.");
        }
    }

    public double EffectiveDurationSeconds(double routedDurationSeconds) =>
        double.IsFinite(routedDurationSeconds) && routedDurationSeconds > 0
            ? routedDurationSeconds
            : FallbackDurationSeconds;
}
