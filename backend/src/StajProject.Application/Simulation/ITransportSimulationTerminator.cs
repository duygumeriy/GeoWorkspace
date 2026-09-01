namespace StajProject.Application.Simulation;

/// <summary>
/// TEK bir çalıştırmanın kimlik denetimli sonlandırılması: durumdan kaldır,
/// terminal yayını yap, çalışma zamanı artıklarını temizle.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden <see cref="ITransportSimulationCanceller"/>'dan ayrı.</b> O port
/// ROTA tabanlıdır ve sistemin KENDİ iptalini anlatır: güzergah
/// geçersizleştiğinde o rotada ne çalışıyorsa durur — çünkü orada bir kullanıcı
/// niyeti yoktur, bir veri gerçeği vardır. Buradaki port ise bir KULLANICI
/// KOMUTUNUN gerektirdiği şeyi anlatır: "tam olarak şu çalıştırmayı durdur".
/// İkisini tek metotta birleştirmek, iç iptalin de bir kimlik taşımasını ya da
/// kullanıcı komutunun rotadaki her çalıştırmayı vurabilmesini gerektirirdi.
/// </para>
/// <para>
/// <b>Yarış güvenliği kimliktedir.</b> Rota 12'de A çalıştırması bitip yerine B
/// başladıysa, hâlâ A'yı tutan eski bir tarayıcı B'yi durduramamalıdır.
/// Bağlayıcı denetim bu yüzden bir ön okuma değil, deponun atomik
/// <c>TryStop(routeId, simulationId)</c> işlemidir: kimlik tutmuyorsa hiçbir
/// şey durmaz ve hiçbir yayın yapılmaz.
/// </para>
/// <para>
/// <b>Yetki burada YOKTUR ve olmamalıdır.</b> Bu bir çalışma zamanı
/// ilkelidir; <c>transport.simulation.stop</c> denetimi kullanıcıya bakan
/// komutun (uç + servis) işidir. Yetkiyi buraya koymak, iç iptalin de
/// kullanıcı yetkisi istemesi demek olurdu.
/// </para>
/// </remarks>
public interface ITransportSimulationTerminator
{
    /// <summary>
    /// <paramref name="routeId"/> üzerinde YALNIZCA
    /// <paramref name="simulationId"/> kimlikli çalıştırmayı sonlandırır.
    /// </summary>
    /// <returns>
    /// Sonlandırma gerçekleştiyse yayınlanan OTORİTER terminal güncelleme;
    /// o kimlikli çalıştırma artık aktif değilse (bitmiş, iptal edilmiş ya da
    /// yerine yenisi başlatılmış) <c>null</c>. <c>null</c> daima "hiçbir şeye
    /// dokunulmadı" demektir.
    /// </returns>
    Task<TransportSimulationLiveUpdate?> TerminateAsync(
        int routeId,
        Guid simulationId,
        CancellationToken cancellationToken = default);
}
