using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Simulation;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Kişisel yolculuk simülasyonunun uygulama sözleşmesi.
/// </summary>
/// <remarks>
/// <para>
/// <b><see cref="ITransportSimulationService"/>'in YERİNE GEÇMEZ.</b> O servis
/// bir <c>TransportRoute</c>'un paylaşılan çalıştırmasını yönetir; başlatmak
/// ayrı bir yönetim yetkisi (<c>transport.simulation.start</c>) ister ve
/// <c>transport.view</c> taşıyan herkes onu izleyebilir. Buradaki ürün ise
/// KİŞİSELDİR: kullanıcının kendi planladığı yolculuğu yalnızca kendisi
/// görür. İki farklı yetkilendirme anlamını tek arayüzde toplamak, birini
/// gevşetmeden diğerini değiştirmeyi imkânsız kılardı.
/// </para>
/// <para>
/// <b>İstemci ASLA güzergah göndermez.</b> Başlatma girdisi yalnızca yolculuk
/// NİYETİDİR (kip, profil, kimlikler); sunucu planlamayı kendi güven sınırının
/// içinde yeniden çalıştırır. Faz 5C önizlemesi tavsiye niteliğinde bir arayüz
/// verisidir ve hiçbir yetki taşımaz.
/// </para>
/// </remarks>
public interface IJourneySimulationService
{
    /// <summary>
    /// Yolculuk niyetini YENİDEN doğrular, YENİDEN planlar ve sunucuya ait bir
    /// çalıştırma başlatır.
    /// </summary>
    /// <remarks>
    /// İstek gövdesinden gelen hiçbir geometri, mesafe, süre, manevra ya da
    /// plan kimliği KABUL EDİLMEZ — böyle bir alan sözleşmede yoktur.
    /// </remarks>
    Task<ServiceResult<JourneySimulationResponse>> StartAsync(
        JourneyPlanRequest intent,
        CancellationToken cancellationToken = default);

    /// <summary>Çağıranın KENDİ aktif yolculuğu; yoksa 404.</summary>
    /// <remarks>Yenileme/yeniden bağlanma sonrası kurtarmanın otoriter yoludur.</remarks>
    Task<ServiceResult<JourneySimulationResponse>> GetCurrentAsync(
        CancellationToken cancellationToken = default);

    /// <summary>Çağıranın kendi çalıştırmasını durdurur ve tek bir iptal olayı yayınlar.</summary>
    Task<ServiceResult<JourneySimulationSnapshotResponse>> StopAsync(
        Guid simulationId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Hub katılımı için SAHİPLİK denetimli canlı anlık görüntü.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Senkron ve veritabanına dokunmaz: yanıt tamamen süreç içi durumdan
    /// gelir. Kimlik tahmin eden biri başkasının yolculuğuna katılamamalıdır,
    /// bu yüzden sahip kimliği PARAMETREDİR ve eşleşmezse <c>null</c> döner —
    /// "yok" ile "senin değil" aynı ve güvenli cevabı üretir.
    /// </para>
    /// </remarks>
    JourneySimulationLiveUpdate? FindOwnedLiveUpdate(Guid simulationId, int ownerUserId);
}
