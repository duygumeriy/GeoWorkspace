using StajProject.Application.Activity;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Aktivite kaydını kalıcı hâle getirir.
/// </summary>
/// <remarks>
/// <b>Yazma ASLA isteği düşürmez.</b> Denetim kaydı, kaydettiği işlemin
/// yanında ikincil bir sorumluluktur: tabloya yazamamak, kullanıcının az önce
/// başarıyla tamamladığı işlemi hata olarak göstermek için bir sebep değildir.
/// Uygulama bu yüzden hataları yutar ve loglar (bkz. uygulama).
/// </remarks>
public interface IActivityLogWriter
{
    /// <summary>
    /// Kaydı yazar. Aktör kimliği ve adı çağrılan taraftan DEĞİL, doğrulanmış
    /// oturumdan okunur.
    /// </summary>
    Task WriteAsync(ActivityLogEntry entry, CancellationToken cancellationToken = default);

    /// <summary>
    /// Kaydı, aktörü AÇIKÇA verilen bir olay için yazar.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Bu bir kaçış kapısı DEĞİLDİR.</b> İstek gövdesinden gelen bir kimlik
    /// buraya giremez: tek meşru kaynak, sunucunun kendi çalışma zamanı
    /// durumunda saklanan sahip kimliğidir (örneğin bir simülasyonun
    /// <c>OwnerUserId</c>'si, kullanıcı isteği sırasında doğrulanmış token'dan
    /// yazılmıştır).
    /// </para>
    /// <para>
    /// <b>Neden gerekli.</b> Bazı yaşam döngüsü geçişleri ilk istekten SONRA,
    /// arka plan çalışma zamanında gerçekleşir; orada bir oturum yoktur. Olayı
    /// hiç kaydetmemek geçmişi eksik bırakırdı, uydurma bir "sistem kullanıcısı"
    /// ise olayın gerçek sahibini gizlerdi.
    /// </para>
    /// </remarks>
    Task WriteAsync(
        ActivityLogEntry entry,
        ActivityActor actor,
        CancellationToken cancellationToken = default);
}
