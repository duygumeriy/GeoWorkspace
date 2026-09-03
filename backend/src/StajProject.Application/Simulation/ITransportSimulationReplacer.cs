namespace StajProject.Application.Simulation;

/// <summary>
/// Bir yeniden başlatmanın İKİ olgusu: biten çalıştırma ve onun yerine geçen
/// YENİ çalıştırma.
/// </summary>
/// <remarks>
/// İkisi tek bir "yeniden başlatıldı" olayında birleştirilmez: istemciler
/// zaten iki ayrı gerçeği görmek zorundadır — A'nın işaretçisi kalkar, B'nin
/// işaretçisi (kullanıcı onu izlemeyi seçerse) sıfırdan çizilir. Tek olayda
/// birleştirmek, mevcut <c>SimulationUpdated</c> akışına üçüncü bir anlam
/// eklemek olurdu.
/// </remarks>
/// <param name="Terminated">Eski çalıştırmanın OTORİTER terminal güncellemesi.</param>
/// <param name="Started">Yeni çalıştırmanın ilk (%0) OTORİTER güncellemesi.</param>
public sealed record TransportSimulationReplacement(
    TransportSimulationLiveUpdate Terminated,
    TransportSimulationLiveUpdate Started);

/// <summary>
/// Bir çalıştırmanın YERİNE yenisinin atomik olarak konması.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden <see cref="ITransportSimulationTerminator"/>'dan ayrı bir port.</b>
/// Sonlandırma bir çalıştırmayı BİTİRİR ve hattı boş bırakır; buradaki işlem
/// hattı hiç boş bırakmaz. İkisini tek metotta toplamak, "bitir" çağrısının
/// bazen yeni bir çalıştırma da kurduğu bir sözleşme demekti — ve o
/// sözleşmeyle iç iptalin (güzergah geçersizleşmesi) yanlışlıkla yeni bir
/// çalıştırma doğurması yalnızca bir parametre hatası kadar uzakta olurdu.
/// </para>
/// <para>
/// <b>Neden <see cref="ITransportSimulationLifecycle"/>'dan ayrı.</b> O port
/// TERMİNAL OLMAYAN geçişleri anlatır ve kimliği hiç değiştirmez; yeniden
/// başlatma ise tam olarak KİMLİĞİ değiştiren işlemdir.
/// </para>
/// <para>
/// <b>Yarış güvenliği kimliktedir.</b> Karar deponun atomik
/// <c>TryReplace(routeId, expectedSimulationId, replacement)</c> işlemidir:
/// beklenen çalıştırma artık hattın güncel çalıştırması değilse hiçbir şeye
/// dokunulmaz. "Her ihtimale karşı hattaki güncel olanı yeniden başlat" yolu
/// YOKTUR.
/// </para>
/// <para>
/// <b>Yetki burada YOKTUR.</b> Bu bir çalışma zamanı ilkelidir; yeniden
/// başlatmanın <c>transport.simulation.stop</c> VE
/// <c>transport.simulation.start</c> istemesi kullanıcıya bakan komutun (uç +
/// servis) işidir.
/// </para>
/// </remarks>
public interface ITransportSimulationReplacer
{
    /// <summary>
    /// <paramref name="routeId"/> üzerinde YALNIZCA
    /// <paramref name="expectedSimulationId"/> kimlikli çalıştırmayı
    /// <paramref name="replacement"/> ile değiştirir; eskisi için terminal,
    /// yenisi için başlangıç yayınını yapar.
    /// </summary>
    /// <returns>
    /// Değiştirme yapıldıysa iki güncelleme; beklenen çalıştırma artık güncel
    /// değilse <c>null</c>. <c>null</c> daima "hiçbir şeye dokunulmadı"
    /// demektir.
    /// </returns>
    Task<TransportSimulationReplacement?> ReplaceAsync(
        int routeId,
        Guid expectedSimulationId,
        ActiveTransportSimulation replacement,
        CancellationToken cancellationToken = default);
}
