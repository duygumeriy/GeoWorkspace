namespace StajProject.Application.Simulation;

/// <summary>
/// AKTİF KÜMENİN değiştiğini duyuran hafif KEŞİF sinyali.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden rota yayınından AYRI bir port.</b>
/// <see cref="ITransportSimulationBroadcaster"/> tek bir ROTANIN grubuna
/// konuşur ve o rotayı zaten izleyenlere gider. Ama yepyeni bir hat
/// başladığında hiç kimse o rotanın grubunda DEĞİLDİR: sinyalin ulaşması
/// gereken kitle "hangi hatların çalıştığını bilmek isteyenler"dir. İki
/// hedefi tek portta toplamak, yayıncının her çağrıda hangi kitleye
/// konuştuğunu bir bayrakla ayırt etmesi demekti.
/// </para>
/// <para>
/// <b>İkinci bir otorite DEĞİLDİR.</b> Sinyal "aktif küme değişmiş olabilir"
/// der; konum, ilerleme ve yaşam döngüsü otoritesi eskisi gibi rota bazlı
/// <c>SimulationUpdated</c> akışında ve okuma ucundadır. Bu yüzden yük
/// bilinçle küçüktür: istemci sinyali alınca TEK bir aktif liste okuması
/// yapar — yoklama yapmaz.
/// </para>
/// <para>
/// <b>Yetki burada YOKTUR.</b> Kimin sinyali alabileceğine hub'daki keşif
/// üyeliği karar verir ve o karar etkin <c>transport.view</c> yetkisine
/// sorulur; bu port yalnızca "duyur" der.
/// </para>
/// </remarks>
public interface ITransportSimulationDiscoveryBroadcaster
{
    /// <summary>
    /// Aktif küme değişikliğini keşif üyelerine duyurur.
    /// </summary>
    /// <remarks>
    /// <b>Uygulama taşıma arızasını DIŞARI SIZDIRMAZ</b> ve kendi loglar:
    /// yayın hattındaki bir sorun, çoktan başlamış/bitmiş bir çalıştırmayı geri
    /// alamaz. Aksi hâlde her çağıran aynı try/catch'i kopyalamak zorunda
    /// kalırdı ve biri unutulduğunda bir SignalR arızası başarılı bir komutu
    /// 500'e çevirirdi.
    /// </remarks>
    Task PublishActiveSetChangedAsync(
        TransportActiveSimulationSetChanged change,
        CancellationToken cancellationToken = default);
}
