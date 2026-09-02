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
    /// PAYLAŞILAN bir hattın çalıştırmasını AÇIKÇA durdurur.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Komut iki kimlik birden taşır ve bu zorunludur.</b> Yalnızca
    /// <paramref name="routeId"/> ile durdurmak, "12 numaralı hatta ne
    /// çalışıyorsa durdur" demek olurdu: A çalıştırması bitip yerine B
    /// başladıysa, hâlâ A'yı gösteren eski bir tarayıcı B'yi — başka
    /// kullanıcıların canlı izlediği bir çalıştırmayı — durdururdu.
    /// <paramref name="simulationId"/> bu yüzden isteğe bağlı bir doğrulama
    /// değil, komutun kimliğidir.
    /// </para>
    /// <para>
    /// <b>Sunucu karar verir.</b> Kimlik tutmuyorsa hiçbir şey durmaz ve
    /// istek GÜVENLİ biçimde reddedilir; "her ihtimale karşı güncel olanı
    /// durdur" davranışı YOKTUR.
    /// </para>
    /// <para>
    /// <b>Sistemin KENDİ iptalinden ayrıdır.</b> Güzergah geçersizleşmesi gibi
    /// iç yollar bu komuttan geçmez ve kullanıcının
    /// <c>transport.simulation.stop</c> yetkisini İSTEMEZ.
    /// </para>
    /// </remarks>
    /// <returns>
    /// Başarılıysa gözlemcilere yayınlanan OTORİTER terminal güncellemenin
    /// aynısı; böylece komutu veren istemci de aynı gerçeği görür ve terminal
    /// durumu yerel olarak UYDURMAK zorunda kalmaz.
    /// </returns>
    Task<ServiceResult<TransportSimulationLiveUpdate>> StopAsync(
        int routeId,
        Guid simulationId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Çalışan bir hattı DURAKLATIR. Terminal DEĞİLDİR.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Duraklatılmış çalıştırma hattın aktif yuvasını İŞGAL ETMEYE devam eder:
    /// aynı hatta ikinci bir başlatma reddedilir, gözlemciler onu görmeye
    /// devam eder ve devam ettirildiğinde AYNI kimlikle kaldığı yerden sürer.
    /// </para>
    /// <para>
    /// <see cref="StopAsync"/> ile aynı yarış kuralı: komut rota VE çalıştırma
    /// kimliğini birlikte taşır; eski bir tarayıcı, yerine geçmiş yeni bir
    /// çalıştırmayı duraklatamaz.
    /// </para>
    /// </remarks>
    Task<ServiceResult<TransportSimulationLiveUpdate>> PauseAsync(
        int routeId,
        Guid simulationId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Duraklatılmış bir hattı KALDIĞI YERDEN sürdürür.
    /// </summary>
    /// <remarks>
    /// Yeni bir çalıştırma başlatmaz: kimlik, güzergah ve ilerleme aynı kalır.
    /// Duraklamada geçen süre simülasyon saatinden düşülür, bu yüzden araç
    /// ileri SIÇRAMAZ.
    /// </remarks>
    Task<ServiceResult<TransportSimulationLiveUpdate>> ResumeAsync(
        int routeId,
        Guid simulationId,
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
