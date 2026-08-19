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
}
