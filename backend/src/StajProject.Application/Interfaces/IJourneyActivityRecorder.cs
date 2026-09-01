using StajProject.Application.Activity;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Kişisel yolculuğun yaşam döngüsü olaylarını MEVCUT aktivite defterine yazar.
/// </summary>
/// <remarks>
/// <para>
/// <b>İkinci bir günlük sistemi değildir.</b> Kayıt yine
/// <see cref="IActivityLogWriter"/> üzerinden aynı <c>activity_logs</c>
/// tablosuna, aynı kanonik kod kataloğuyla yazılır. Buradaki tek fark, olayın
/// nereden geldiğidir.
/// </para>
/// <para>
/// <b>Neden merkezî HTTP filtresi kullanılmıyor.</b> Filtre bir action'ın
/// çalıştığını görür, ama "atomik durum geçişini KİM kazandı" sorusunu göremez;
/// ayrıca tasarımı gereği başarısız denemeleri de kaydeder. Yolculuk yaşam
/// döngüsünde ise kayıt tam olarak geçişi kazanan kod yolunda, yalnızca
/// başarıda oluşmalıdır — mükerrer durdurma istekleri, bayat runner tick'leri
/// ve geç gelen olaylar ikinci bir satır üretmemelidir.
/// </para>
/// <para>
/// <b>Yazma isteği düşürmez.</b> Alttaki yazıcı hataları yutar; denetim kaydı,
/// kaydettiği işlemin yanında ikincil bir sorumluluktur.
/// </para>
/// </remarks>
public interface IJourneyActivityRecorder
{
    /// <param name="outcome">Sunucunun doğruladığı güvenli iş bağlamı.</param>
    /// <param name="ownerUserId">
    /// Çalıştırmanın sahibi. Arka plan geçişlerinde oturum yoktur; kimlik
    /// simülasyonun kendi değişmez durumundan okunur.
    /// </param>
    Task RecordAsync(
        JourneyActivityOutcome outcome,
        int ownerUserId,
        CancellationToken cancellationToken = default);
}
