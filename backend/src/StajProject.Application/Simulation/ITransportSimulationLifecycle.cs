namespace StajProject.Application.Simulation;

/// <summary>
/// Çalışan bir hattın TERMİNAL OLMAYAN yaşam döngüsü geçişleri: duraklat ve
/// devam ettir.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden sonlandırma portundan ayrı.</b>
/// <see cref="ITransportSimulationTerminator"/> bir çalıştırmayı BİTİRİR;
/// buradaki geçişler onu bitirmez, yalnızca saatini dondurur ve yeniden
/// başlatır. İkisini tek portta toplamak, "sonlandır" ile "duraklat"ın aynı
/// yetenek olduğunu ima ederdi — oysa duraklatılmış bir çalıştırma hattın
/// aktif yuvasını İŞGAL ETMEYE devam eder ve aynı kimlikle sürdürülebilir.
/// </para>
/// <para>
/// <b>Yarış güvenliği kimliktedir.</b> Her iki geçiş de
/// <c>(routeId, simulationId)</c> çiftini alır ve bağlayıcı karar deponun
/// atomik CAS işlemidir: A bitip yerine B geçtiyse, hâlâ A'yı tutan eski bir
/// tarayıcı B'yi ne duraklatabilir ne sürdürebilir.
/// </para>
/// <para>
/// <b>Yetki burada YOKTUR.</b> Bu bir çalışma zamanı ilkelidir;
/// <c>transport.simulation.stop</c> denetimi kullanıcıya bakan komutun (uç +
/// servis) işidir.
/// </para>
/// </remarks>
public interface ITransportSimulationLifecycle
{
    /// <summary>
    /// Yalnızca <paramref name="simulationId"/> kimlikli ÇALIŞAN çalıştırmayı
    /// duraklatır ve terminal olmayan <c>Paused</c> yayınını yapar.
    /// </summary>
    /// <returns>
    /// Yayınlanan OTORİTER güncelleme; kimlik tutmuyorsa ya da çalıştırma
    /// çalışmıyorsa <c>null</c> — hiçbir şeye dokunulmamıştır.
    /// </returns>
    Task<TransportSimulationLiveUpdate?> PauseAsync(
        int routeId,
        Guid simulationId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Yalnızca <paramref name="simulationId"/> kimlikli DURAKLATILMIŞ
    /// çalıştırmayı sürdürür ve <c>Running</c> yayınını yapar.
    /// </summary>
    /// <remarks>
    /// Yayın ANINDA yapılır: gözlemcilerin çalıştırmanın sürdüğünü bir sonraki
    /// tick'e kadar öğrenememesi, ekranda hâlâ "Duraklatıldı" yazarken aracın
    /// hareket etmeye başlaması demekti.
    /// </remarks>
    Task<TransportSimulationLiveUpdate?> ResumeAsync(
        int routeId,
        Guid simulationId,
        CancellationToken cancellationToken = default);
}
