using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Simulation;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Ulaşım simülasyonunun uygulama sözleşmesi.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="ITransportService"/>'ten AYRI bir servistir ve bu bilinçlidir:
/// ulaşım servisi kalıcı rota/durak verisinin sahibidir, buradaki servis ise
/// süreç içi ÇALIŞMA ZAMANI durumunu yönetir. İkisi tek arayüzde birleşirse,
/// CRUD'un her tüketicisi geçici simülasyon durumuna da bağımlı olurdu.
/// </para>
/// <para>
/// Sonuçlar mevcut <see cref="ServiceResult{T}"/> sözleşmesiyle döner; ikinci
/// bir hata sistemi kurulmaz.
/// </para>
/// </remarks>
public interface ITransportSimulationService
{
    /// <summary>
    /// Rotanın KALICI güzergahı üzerinde %0'dan yeni bir simülasyon başlatır.
    /// </summary>
    /// <remarks>
    /// OSRM ÇAĞRILMAZ: simülasyon yalnızca daha önce hesaplanıp saklanmış yolu
    /// işletir. Yol yoksa ya da bayat ise doğru cevap, güzergahı sessizce
    /// yeniden hesaplamak değil, isteği reddetmektir — hangi geometrinin
    /// işletildiği belirsiz kalmamalıdır.
    /// </remarks>
    Task<ServiceResult<TransportSimulationResponse>> StartAsync(
        int routeId,
        CancellationToken cancellationToken = default);

    /// <summary>Rotanın aktif simülasyonunun sunucu otoriteli anlık görüntüsü.</summary>
    Task<ServiceResult<TransportSimulationResponse>> GetActiveAsync(
        int routeId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Rotada çalışan simülasyonun CANLI yayın biçimindeki anlık görüntüsü;
    /// çalışan yoksa <c>null</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Geç katılan ya da yeniden bağlanan bir istemcinin, bir sonraki tick'i
    /// beklemeden aracı çizebilmesi için vardır: hub bunu katılım anında
    /// çağırana döndürür.
    /// </para>
    /// <para>
    /// Bilinçli olarak <b>senkron ve veritabanına dokunmaz</b> — yanıt tamamen
    /// süreç içi durumdan gelir. Her katılımda bir sorgu çalıştırmak, canlı
    /// kanalı gereksizce veritabanına bağlardı.
    /// </para>
    /// </remarks>
    TransportSimulationLiveUpdate? FindActiveLiveUpdate(int routeId);
}
