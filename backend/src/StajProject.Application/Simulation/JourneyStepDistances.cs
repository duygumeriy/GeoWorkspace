using StajProject.Application.Journeys;

namespace StajProject.Application.Simulation;

/// <summary>
/// Manevraların OTORİTER ilerlemeden türetilmesi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Saf ve bağımsız sınanabilir.</b> Zaman, SignalR ve EF yoktur: girdi adım
/// listesi ve kat edilen mesafe, çıktı anlık manevranın sırasıdır.
/// </para>
/// <para>
/// <b>Talimat UYDURULMAZ.</b> Adım listesi boşsa — kalıcı güzergahı yeniden
/// kullanan bir tam-hat yolculuğunda olduğu gibi — anlık manevra
/// <c>null</c>'dır ve bu GEÇERLİDİR. Manevra yokluğu bir simülasyonu
/// başarısız kılmaz.
/// </para>
/// </remarks>
public static class JourneyStepDistances
{
    /// <summary>
    /// Adım başına, yolculuğun başından itibaren kümülatif BİTİŞ mesafesi.
    /// </summary>
    /// <remarks>
    /// Bitiş mesafesi kullanılır çünkü soru "hangi manevranın İÇİNDEYİM"dir:
    /// kat edilen mesafe bir adımın bitişini geçmediyse hâlâ o adımdadır.
    /// </remarks>
    public static IReadOnlyList<double> CumulativeEnds(IReadOnlyList<JourneyRouteStep>? steps)
    {
        if (steps is null || steps.Count == 0) return [];

        var ends = new double[steps.Count];
        var total = 0d;

        for (var index = 0; index < steps.Count; index++)
        {
            var distance = steps[index].DistanceMeters;

            // Sonlu olmayan ya da negatif bir adım toplamı zehirlemesin.
            total += double.IsFinite(distance) && distance > 0 ? distance : 0;
            ends[index] = total;
        }

        return ends;
    }

    /// <summary>
    /// Kat edilen mesafedeki manevranın sırası; adım yoksa <c>null</c>.
    /// </summary>
    /// <remarks>
    /// Sonuç daima geçerli bir dizine KIRPILIR: bozuk ya da eksik adım
    /// mesafeleri yüzünden aralık dışına düşmek, canlı paneli çökertirdi.
    /// </remarks>
    public static int? StepAt(IReadOnlyList<double> cumulativeEnds, double distanceCoveredMeters)
    {
        if (cumulativeEnds.Count == 0) return null;

        var covered = double.IsFinite(distanceCoveredMeters) ? Math.Max(0, distanceCoveredMeters) : 0;

        for (var index = 0; index < cumulativeEnds.Count; index++)
        {
            if (covered < cumulativeEnds[index]) return index;
        }

        // Son adımın ötesindeyiz: varış manevrasında kalınır.
        return cumulativeEnds.Count - 1;
    }
}
