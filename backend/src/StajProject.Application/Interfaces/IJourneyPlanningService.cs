using StajProject.Application.Common;
using StajProject.Application.DTOs;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Genel yolculuk planlamasının uygulama sözleşmesi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden üçüncü bir servis.</b> <see cref="ITransportService"/> kalıcı
/// rota/durak verisinin sahibidir; <see cref="ITransportSimulationService"/>
/// bir hattın KALICI güzergahı üzerindeki çalışma zamanı durumunu yönetir.
/// Yolculuk planlaması ikisine de ait değildir: hiçbir şey yazmaz, hiçbir
/// çalıştırma başlatmaz ve girdisi bir hat olmak ZORUNDA değildir (farklı
/// hatlardaki duraklar ve POI'ler aynı planda buluşabilir). Bu sorumluluğu
/// mevcut iki arayüzden birine eklemek, ya CRUD tüketicilerini planlamaya ya
/// da simülasyonu POI kataloğuna bağımlı kılardı.
/// </para>
/// <para>
/// <b>Mevcut simülasyon DEĞİŞMEZ.</b> Bu servis
/// <c>TransportRoutePath</c>'e yazmaz, var olan çalıştırmalara dokunmaz ve
/// simülasyon durumu deposunu hiç görmez.
/// </para>
/// <para>
/// Sonuçlar mevcut <see cref="ServiceResult{T}"/> sözleşmesiyle döner; ikinci
/// bir hata sistemi kurulmaz.
/// </para>
/// </remarks>
public interface IJourneyPlanningService
{
    /// <summary>
    /// İsteği doğrular, referansları çözer, sırayı normalleştirir ve planın
    /// yapısal ÖNİZLEMESİNİ üretir.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Yönlendirme motoru çağrılmaz.</b> Bu faz "bu istek sonradan
    /// planlanabilir mi ve hangi noktalardan, hangi sırayla oluşur?" sorusunu
    /// yanıtlar. Dönen mesafeler kuş uçuşudur ve özet bunu
    /// <c>IsRouted = false</c> ile açıkça bildirir. Gerçek güzergah üretimi
    /// sonraki fazın işidir.
    /// </para>
    /// <para>
    /// <b>Fail-closed.</b> Çözülemeyen, silinmiş ya da pasif bir referans
    /// sessizce atlanmaz; istek tümüyle reddedilir. Eksik bir durakla
    /// "kısaltılmış" bir plan üretmek, kullanıcının istemediği bir yolculuğu
    /// onun istediği sanmasına yol açardı.
    /// </para>
    /// </remarks>
    Task<ServiceResult<JourneyPlanPreviewResponse>> PreviewAsync(
        JourneyPlanRequest request,
        CancellationToken cancellationToken = default);
}
