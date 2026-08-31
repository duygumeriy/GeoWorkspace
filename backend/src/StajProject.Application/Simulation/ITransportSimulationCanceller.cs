namespace StajProject.Application.Simulation;

/// <summary>
/// Otoriter güzergah geçersizleştiğinde çalışan simülasyonun sonlandırılması.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden ayrı bir port.</b> Kuralı tetikleyen yer ulaşım servisidir (yolu
/// bayatlatan/değiştiren tek sahip orasıdır), uygulayan yer ise simülasyon
/// tarafıdır. Ulaşım servisinin depo ve yayın ayrıntılarını tanıması, iki
/// özelliği birbirine düğümlerdi.
/// </para>
/// <para>
/// <b>Fail-safe yön.</b> İptal her zaman güvenli taraftır: geçersizleşmemiş
/// bir yolda simülasyonu durdurmak yalnızca yeniden başlatma gerektirir;
/// geçersiz geometride devam etmek ise haritada yanlış bir gerçeklik üretir.
/// </para>
/// </remarks>
public interface ITransportSimulationCanceller
{
    /// <summary>
    /// Verilen rotalarda çalışan simülasyonları durdurur ve
    /// <see cref="TransportSimulationStatus.Cancelled"/> yayını yapar.
    /// Çalışan yoksa hiçbir şey olmaz.
    /// </summary>
    Task CancelForRoutesAsync(
        IReadOnlyCollection<int> routeIds,
        CancellationToken cancellationToken = default);
}
