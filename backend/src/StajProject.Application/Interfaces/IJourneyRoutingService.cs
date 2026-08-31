using StajProject.Application.Common;
using StajProject.Application.Journeys;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Profil farkındalıklı yönlendirme portu.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden <see cref="IOsrmRoutingService"/> genişletilmedi.</b> O port Akıllı
/// Ulaşım'ın kalıcı güzergah üretimine hizmet eder ve yalnızca
/// geometri/mesafe/süre döndürür. Manevra modelini oraya eklemek, hattın
/// güzergahını hesaplayan akışı yolculuğa özgü adım sözleşmesine bağımlı
/// kılardı. Bu yüzden AYRI bir port açılır; mevcut tüketiciler hiç
/// değişmeden çalışmaya devam eder.
/// </para>
/// <para>
/// <b>Motor adresi iş kuralında YOKTUR.</b> Port yalnızca ürün profilini alır;
/// hangi adrese, hangi motor profiliyle gidileceği Infrastructure'daki
/// gerçekleştirimin ve yapılandırmanın işidir.
/// </para>
/// </remarks>
public interface IJourneyRoutingService
{
    /// <summary>
    /// Bu profil GERÇEKTEN yönlendirilebiliyor mu?
    /// </summary>
    /// <remarks>
    /// <para>
    /// Yalnızca o profil için AYRI bir yönlendirme servisi yapılandırılmışsa
    /// <c>true</c> döner. Sürüş için mevcut <c>Osrm</c> yapılandırması yeterlidir;
    /// yürüyüş ve bisiklet kendi uçlarını gerektirir.
    /// </para>
    /// <para>
    /// <b>Neden bir URL yolu yetmez.</b> Yerel OSRM örneği <c>car.lua</c> ile
    /// derlenmiştir ve <c>osrm-routed</c> adresteki profil segmentini YOK SAYAR:
    /// aynı örneğe <c>/route/v1/walking/...</c> demek, sürüş sonucunu "yürüyüş"
    /// diye etiketlemek olurdu. Bu yüzden yönlendirilebilirlik, ayrı bir uç
    /// yapılandırmasına bağlanır.
    /// </para>
    /// </remarks>
    bool IsProfileRoutable(JourneyTravelProfile profile);

    /// <summary>
    /// Sıralı koordinatları talep edilen profille yönlendirir.
    /// </summary>
    /// <remarks>
    /// Profil yönlendirilemiyorsa istek HİÇ yapılmaz ve güvenli bir hata döner;
    /// sürüşe sessizce düşülmez. Hata mesajları
    /// <see cref="RouteGenerationMessages"/> sözleşmesindedir — ham istisna,
    /// adres ya da motor yanıtı dışarı çıkmaz.
    /// </remarks>
    Task<ServiceResult<JourneyRouteResult>> RouteAsync(
        JourneyRouteRequest request,
        CancellationToken cancellationToken = default);
}
