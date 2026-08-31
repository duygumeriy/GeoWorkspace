namespace StajProject.Application.Simulation;

/// <summary>Güzergah üzerinde tek bir konum çözümü.</summary>
/// <param name="Point">İnterpolasyonla bulunan konum.</param>
/// <param name="SegmentIndex">İçinde bulunulan segmentin başlangıç köşesi.</param>
/// <param name="DistanceMeters">Başlangıçtan itibaren kat edilen mesafe.</param>
/// <param name="ProgressRatio">0..1 aralığına KIRPILMIŞ ilerleme.</param>
public sealed record TransportSimulationPosition(
    TransportSimulationPoint Point,
    int SegmentIndex,
    double DistanceMeters,
    double ProgressRatio);

/// <summary>
/// Ölçülmüş güzergah: köşeler ve kümülatif METRE mesafeleri.
/// </summary>
/// <remarks>
/// <para>
/// <b>Saf ve bağımsız test edilebilir.</b> Burada ne zaman, ne SignalR, ne EF,
/// ne de yapılandırma vardır: girdi köşe listesi, çıktı konumdur. Hareketin
/// doğruluğu bu yüzden bir arka plan servisini çalıştırmadan sınanabilir.
/// </para>
/// <para>
/// <b>Mesafe metredir.</b> Kümülatif toplam <see cref="TransportGeodesy"/> ile
/// hesaplanır; EPSG:4326 derece uzunlukları KULLANILMAZ.
/// </para>
/// <para>
/// <b>OSRM'in toplam mesafesi burada yeniden kullanılmaz.</b> Kalıcı
/// <c>DistanceMeters</c> yol boyunca nerede olunduğunu söylemez; interpolasyon
/// köşe köşe kümülatif mesafeye ihtiyaç duyar ve iki ölçümün karışması
/// (biri OSRM, diğeri haversine) konumu güzergahın dışına düşürürdü.
/// </para>
/// </remarks>
public sealed class TransportSimulationTrack
{
    private readonly double[] _cumulativeMeters;

    private TransportSimulationTrack(IReadOnlyList<TransportSimulationPoint> points, double[] cumulativeMeters)
    {
        Points = points;
        _cumulativeMeters = cumulativeMeters;
    }

    public IReadOnlyList<TransportSimulationPoint> Points { get; }

    /// <summary>Köşe başına, başlangıçtan itibaren kümülatif mesafe (metre).</summary>
    public IReadOnlyList<double> CumulativeMeters => _cumulativeMeters;

    public double TotalMeters => _cumulativeMeters.Length == 0 ? 0 : _cumulativeMeters[^1];

    /// <summary>
    /// Üzerinde hareket edilebilir mi? En az iki köşe ve pozitif bir toplam
    /// uzunluk gerekir.
    /// </summary>
    /// <remarks>
    /// Sıfır uzunluklu (tüm köşeleri aynı) ya da tek köşeli bir güzergah
    /// savunmacı biçimde KULLANILAMAZ sayılır; runner böyle bir çalıştırmayı
    /// sonsuza dek %0'da tutmak yerine iptal eder.
    /// </remarks>
    public bool IsUsable => Points.Count >= 2 && TotalMeters > 0;

    public static TransportSimulationTrack Create(IReadOnlyList<TransportSimulationPoint> points)
    {
        var source = points ?? [];
        var cumulative = new double[source.Count];

        for (var index = 1; index < source.Count; index++)
        {
            var segment = TransportGeodesy.DistanceMeters(source[index - 1], source[index]);

            // Sonlu olmayan bir segment tüm toplamı zehirlemesin.
            cumulative[index] = cumulative[index - 1] + (double.IsFinite(segment) ? segment : 0);
        }

        return new TransportSimulationTrack(source, cumulative);
    }

    /// <summary>
    /// Verilen ilerleme oranındaki konum. Oran 0..1 aralığına KIRPILIR; NaN
    /// başlangıç olarak okunur.
    /// </summary>
    public TransportSimulationPosition At(double progressRatio)
    {
        var ratio = double.IsNaN(progressRatio) ? 0 : Math.Clamp(progressRatio, 0, 1);

        if (Points.Count == 0)
        {
            // Çağıran IsUsable'ı denetlemelidir; yine de burada patlanmaz.
            return new TransportSimulationPosition(new TransportSimulationPoint(0, 0), 0, 0, ratio);
        }

        if (Points.Count == 1 || TotalMeters <= 0)
        {
            return new TransportSimulationPosition(Points[0], 0, 0, ratio);
        }

        if (ratio <= 0)
        {
            return new TransportSimulationPosition(Points[0], 0, 0, 0);
        }

        if (ratio >= 1)
        {
            // Son köşe, son segmentin İÇİNDEDİR: segment indeksi köşe sayısı - 2.
            return new TransportSimulationPosition(Points[^1], Points.Count - 2, TotalMeters, 1);
        }

        var target = TotalMeters * ratio;
        var segmentIndex = FindSegment(target);

        var start = Points[segmentIndex];
        var end = Points[segmentIndex + 1];
        var segmentStart = _cumulativeMeters[segmentIndex];
        var segmentLength = _cumulativeMeters[segmentIndex + 1] - segmentStart;

        /* Sıfır uzunluklu segment (tekrarlanan köşe) bölme hatası üretmesin;
           böyle bir segmentte konum segmentin başlangıcıdır. */
        var fraction = segmentLength > 0 ? (target - segmentStart) / segmentLength : 0;

        var point = new TransportSimulationPoint(
            start.Longitude + ((end.Longitude - start.Longitude) * fraction),
            start.Latitude + ((end.Latitude - start.Latitude) * fraction));

        return new TransportSimulationPosition(point, segmentIndex, target, ratio);
    }

    /// <summary>
    /// Hedef mesafeyi içeren segmentin başlangıç köşesi. Kümülatif dizi artan
    /// olduğu için ikili arama kullanılır; binlerce köşeli bir güzergahta her
    /// tick'te doğrusal tarama yapmak gereksiz iştir.
    /// </summary>
    private int FindSegment(double targetMeters)
    {
        var index = Array.BinarySearch(_cumulativeMeters, targetMeters);

        if (index < 0)
        {
            index = ~index - 1;
        }

        return Math.Clamp(index, 0, Points.Count - 2);
    }
}
