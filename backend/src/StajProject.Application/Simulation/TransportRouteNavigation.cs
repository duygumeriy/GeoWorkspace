namespace StajProject.Application.Simulation;

/// <summary>
/// Çalışma zamanındaki tek bir OTORİTER manevra.
/// </summary>
/// <remarks>
/// <see cref="TransportSimulationPath"/> ile aynı gerekçe: depoya giren
/// hiçbir şey EF'e bağlı değildir. Kalıcı adım kaydı istek sınırında sıradan
/// sayılara ve dizgilere KOPYALANIR; singleton bir sözlükte tutulan takip
/// edilen bir varlık, kapanmış bir istek kapsamını süresiz canlı tutardı.
/// </remarks>
public sealed record TransportNavigationStep(
    int Sequence,
    string ManeuverType,
    string? ManeuverModifier,
    string? Name,
    double DistanceMeters,
    double DurationSeconds,
    double StartDistanceMeters,
    double EndDistanceMeters);

/// <summary>
/// Bir güzergahın manevra dizisi ve "şu an hangi manevradayız" çözümü.
/// </summary>
/// <remarks>
/// <para>
/// <b>KARAR SUNUCUNUNDUR.</b> Hangi adımda olunduğu burada, kat edilen
/// mesafeden çözülür; tarayıcı bunu ne hesaplar ne de ilerletir. İstemcinin
/// geometriden ("çizgi burada sağa kıvrılıyor") talimat çıkarması, motorun
/// bilmediği bir gerçeği uydurmak olurdu.
/// </para>
/// <para>
/// <b>Saf ve bağımsız test edilebilir.</b> Burada ne zaman, ne SignalR, ne EF,
/// ne de yapılandırma vardır: girdi adım listesi ve mesafe, çıktı sıra
/// numarasıdır.
/// </para>
/// <para>
/// <b>Ölçü OSRM metresidir.</b> Sınırlar güzergahı üreten motorun mesafe
/// ekseninde saklanır ve çözümleme de o eksende yapılır; simülasyonun
/// interpolasyon ölçüsü (haversine kümülatifi) BURAYA KARIŞMAZ. İki ölçüyü
/// karıştırmak aracı yanlış manevrada gösterirdi.
/// </para>
/// </remarks>
public sealed class TransportRouteNavigation
{
    /// <summary>Manevrası olmayan güzergah. Bu bir HATA DEĞİLDİR.</summary>
    public static readonly TransportRouteNavigation Empty = new([]);

    private readonly double[] _startBounds;

    private TransportRouteNavigation(IReadOnlyList<TransportNavigationStep> steps)
    {
        Steps = steps;
        _startBounds = [.. steps.Select(step => step.StartDistanceMeters)];
    }

    /// <summary>Sıraya göre ARTAN, doğrulanmış adımlar.</summary>
    public IReadOnlyList<TransportNavigationStep> Steps { get; }

    public bool HasSteps => Steps.Count > 0;

    /// <summary>
    /// Adımları normalleştirir: okunamayanları eler, SIRAYA göre dizer.
    /// </summary>
    /// <remarks>
    /// <b>Sıralama savunmacıdır.</b> Kalıcı okuma zaten sıralı gelir, ama
    /// çözümleme ikili aramaya dayanır ve sırasız bir dizi sessizce yanlış
    /// adımı seçerdi. Bozuk sınır taşıyan adım DÜŞÜRÜLÜR: eksik bir manevra,
    /// yanlış bir manevradan iyidir.
    /// </remarks>
    public static TransportRouteNavigation Create(IEnumerable<TransportNavigationStep>? steps)
    {
        if (steps is null)
        {
            return Empty;
        }

        var ordered = steps
            .Where(step => step is not null
                && double.IsFinite(step.StartDistanceMeters)
                && double.IsFinite(step.EndDistanceMeters)
                && step.EndDistanceMeters >= step.StartDistanceMeters)
            .OrderBy(step => step.Sequence)
            .ToArray();

        return ordered.Length == 0 ? Empty : new TransportRouteNavigation(ordered);
    }

    /// <summary>Sıra numarasına göre adım; yoksa <c>null</c>.</summary>
    /// <remarks>
    /// <b>Dizi konumu bir kimlik DEĞİLDİR.</b> Arama daima
    /// <see cref="TransportNavigationStep.Sequence"/> üzerindendir.
    /// </remarks>
    public TransportNavigationStep? FindBySequence(int sequence) =>
        Steps.FirstOrDefault(step => step.Sequence == sequence);

    /// <summary>
    /// Güzergahın başından <paramref name="distanceMeters"/> kadar ilerlemiş
    /// bir aracın İÇİNDE BULUNDUĞU manevranın sırası; adım yoksa <c>null</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Kural: başlangıç sınırı mesafeyi geçmeyen SON adım. Varış sınırının
    /// ötesindeki bir mesafe son adımda kalır — araç varmıştır, geriye
    /// düşmez.
    /// </para>
    /// <para>
    /// Negatif ya da okunamayan mesafe BAŞLANGIÇ olarak okunur; çalıştırma
    /// %0'da doğduğunda ilk manevra zaten geçerli cevaptır.
    /// </para>
    /// </remarks>
    public int? SequenceAt(double distanceMeters) =>
        IndexAt(distanceMeters) is { } index ? Steps[index].Sequence : null;

    /// <summary>
    /// Mesafeyi içeren adımın DİZİ konumu. Yalnızca içeride kullanılır: dışarı
    /// açılan kimlik daima <see cref="TransportNavigationStep.Sequence"/>'tir.
    /// </summary>
    /// <remarks>
    /// Kümülatif başlangıç sınırları artan olduğu için ikili arama kullanılır;
    /// yüzlerce manevralı bir güzergahta her tick'te doğrusal tarama yapmak
    /// gereksiz iştir.
    /// </remarks>
    private int? IndexAt(double distanceMeters)
    {
        if (!HasSteps)
        {
            return null;
        }

        if (!double.IsFinite(distanceMeters) || distanceMeters <= _startBounds[0])
        {
            return 0;
        }

        var index = Array.BinarySearch(_startBounds, distanceMeters);

        if (index < 0)
        {
            index = ~index - 1;
        }

        return Math.Clamp(index, 0, Steps.Count - 1);
    }

    /// <summary>
    /// SONRAKİ manevraya kalan mesafe; sonraki manevra yoksa <c>null</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Sunucu hesaplar, tarayıcı yalnızca biçimlendirir.</b> "280 m sonra
    /// sağa dön" cümlesindeki sayının istemcide üretilmesi, mesafeyi harita
    /// koordinatlarından tahmin etmeye ya da ikinci bir ilerleme motoruna
    /// kapı aralardı.
    /// </para>
    /// <para>
    /// Son adımda (varış) sonraki manevra YOKTUR ve değer <c>null</c> kalır;
    /// sıfır yazmak "hemen şimdi dön" demek olurdu.
    /// </para>
    /// </remarks>
    public double? DistanceToNextManeuverMeters(double distanceMeters)
    {
        if (IndexAt(distanceMeters) is not { } index || index >= Steps.Count - 1)
        {
            return null;
        }

        var remaining = Steps[index].EndDistanceMeters - distanceMeters;
        return remaining > 0 ? remaining : 0;
    }
}
