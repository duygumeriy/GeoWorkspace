namespace StajProject.Application.Options;

/// <summary>
/// Simülasyon runner'ının sunucu tarafı ayarları. Secret içermez ve
/// tarayıcıdan ALINMAZ.
/// </summary>
/// <remarks>
/// <para>
/// <b>Hız bir sunucu ayarıdır, kullanıcı girdisi değil.</b> İstemcinin
/// gönderdiği bir çarpan, aynı rotayı izleyen iki kullanıcının aracı farklı
/// yerlerde görmesi demekti; sunucu otoritesi tam da bunu engeller. Arayüzde
/// hız seçici YOKTUR.
/// </para>
/// <para>
/// Süre kaynağı OSRM'in kalıcı <c>DurationSeconds</c> ölçümüdür; çarpan onu
/// yalnızca demo için hızlandırır. Böylece simülasyon gerçek rota süresine
/// bağlı kalır, uydurma bir sabite değil.
/// </para>
/// </remarks>
public sealed class TransportSimulationOptions
{
    public const string SectionName = "TransportSimulation";

    /// <summary>Runner'ın yayın aralığı (ms).</summary>
    /// <remarks>
    /// İlerleme bu değerden TÜRETİLMEZ — yalnızca ne sıklıkta yayın yapılacağını
    /// belirler. Aralık kaysa bile konum doğru kalır (bkz. runner).
    /// </remarks>
    public int TickIntervalMilliseconds { get; set; } = 1000;

    /// <summary>Rota süresine uygulanan hızlandırma çarpanı.</summary>
    public double SpeedMultiplier { get; set; } = 10;

    /// <summary>
    /// Kalıcı yolun süresi kullanılamaz olduğunda (0, negatif veya sonsuz)
    /// kullanılacak süre.
    /// </summary>
    /// <remarks>
    /// Savunmacı bir taban değeridir: süresi bozuk bir yol, sıfıra bölme ya da
    /// anında %100 yerine makul bir sürede tamamlanır.
    /// </remarks>
    public double FallbackDurationSeconds { get; set; } = 300;

    public void Validate()
    {
        if (TickIntervalMilliseconds is < 100 or > 60_000)
        {
            throw new InvalidOperationException(
                "TransportSimulation:TickIntervalMilliseconds 100 ile 60000 arasında olmalıdır.");
        }

        if (!double.IsFinite(SpeedMultiplier) || SpeedMultiplier is <= 0 or > 1_000)
        {
            throw new InvalidOperationException(
                "TransportSimulation:SpeedMultiplier 0 (hariç) ile 1000 arasında olmalıdır.");
        }

        if (!double.IsFinite(FallbackDurationSeconds) || FallbackDurationSeconds is <= 0 or > 86_400)
        {
            throw new InvalidOperationException(
                "TransportSimulation:FallbackDurationSeconds 0 (hariç) ile 86400 arasında olmalıdır.");
        }
    }

    /// <summary>Yolun süresi kullanılamazsa taban değere düşen etkin süre.</summary>
    public double EffectiveDurationSeconds(double pathDurationSeconds) =>
        double.IsFinite(pathDurationSeconds) && pathDurationSeconds > 0
            ? pathDurationSeconds
            : FallbackDurationSeconds;
}
