using StajProject.Application.Common;
using StajProject.Application.DTOs;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Kaydedilmiş KİŞİSEL yolculuk tanımlarının uygulama sözleşmesi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Bir tanım deposudur, bir simülasyon deposu DEĞİLDİR.</b>
/// <see cref="IJourneySimulationService"/> çalışma zamanı durumunun sahibidir
/// ve süreç içi bir depoya yazar; buradaki kayıtlar kalıcı, sahibe özel
/// NİYETLERDİR. İkisini tek arayüzde toplamak, "kaydedilmiş yolculuk"
/// kavramını ölü bir çalıştırmanın anlık görüntüsüne indirgerdi.
/// </para>
/// <para>
/// <b>Paylaşılan ulaşım simülasyonu bu servisin varlığından ETKİLENMEZ.</b>
/// <c>TransportRoute</c> kayıtlarına yazılmaz, paylaşılan çalıştırmalar
/// okunmaz, paylaşılan yaşam döngüsüne dokunulmaz.
/// </para>
/// <para>
/// <b>Her metot SAHİP KAPSAMLIDIR.</b> Kimlik daima
/// <see cref="ICurrentUserService"/>'ten okunur; istek gövdesinden ya da
/// yoldan gelen bir kullanıcı kimliği KABUL EDİLMEZ. Başkasının kaydı için
/// yapılan her istek "bulunamadı" ile biter — ayrı bir 403, kimlik tahmin eden
/// birine o kaydın var olduğunu doğrulardı.
/// </para>
/// </remarks>
public interface ISavedJourneyService
{
    /// <summary>
    /// Bir yolculuk niyetini doğrular ve sahibine ait bir TANIM olarak saklar.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Doğrulama mevcut planlama hattından geçer</b>
    /// (<see cref="IJourneyPlanningService.PlanAsync"/>): kip/profil çözümü,
    /// referans varlığı, silinmiş/pasif kayıt reddi ve POI yetkisi ikinci kez
    /// yazılmaz. Böylece kaydedilebilen her tanım, kaydedildiği anda gerçekten
    /// planlanabilir bir tanımdır.
    /// </para>
    /// <para>
    /// <b>Simülasyon BAŞLATILMAZ.</b> Kaydetmek bir çalıştırma üretmez, çalışan
    /// bir çalıştırmayı değiştirmez ve çalışan bir çalıştırma GEREKTİRMEZ.
    /// </para>
    /// </remarks>
    Task<ServiceResult<SavedJourneyResponse>> CreateAsync(
        CreateSavedJourneyRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Çağıranın KENDİ kayıtları; önce favoriler, sonra en son değiştirilen.
    /// </summary>
    /// <remarks>Sıralama kararlıdır: eşitlikte kimlik azalan yönde ayırır.</remarks>
    Task<ServiceResult<IReadOnlyList<SavedJourneySummaryResponse>>> ListAsync(
        CancellationToken cancellationToken = default);

    /// <summary>Çağıranın kendi kaydının tam tanımı; başkasınınki için 404.</summary>
    Task<ServiceResult<SavedJourneyResponse>> GetAsync(
        int savedJourneyId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Ad ve/veya yıldızı günceller; yolculuk TANIMINA dokunmaz.
    /// </summary>
    Task<ServiceResult<SavedJourneyResponse>> UpdateAsync(
        int savedJourneyId,
        UpdateSavedJourneyRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>Çağıranın kendi kaydını KALICI olarak siler.</summary>
    Task<ServiceResult<int>> DeleteAsync(
        int savedJourneyId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Kayıttan YENİ bir kişisel simülasyon başlatır.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Eski çalıştırma DİRİLTİLMEZ.</b> Kayıt bir çalıştırma kimliği
    /// taşımaz; her yeniden kullanım mevcut başlatma yolundan
    /// (<see cref="IJourneySimulationService.StartAsync"/>) geçer ve YENİ bir
    /// <c>simulationId</c> üretir. Aynı kaydı iki kez kullanmak iki farklı
    /// çalıştırma demektir.
    /// </para>
    /// <para>
    /// <b>Güzergah YENİDEN hesaplanır.</b> Kaydedilmiş bir geometri yoktur:
    /// POI taşınmış, durak taşınmış ya da yol ağı değişmiş olabilir. Kanonik
    /// referanslar yeniden çözülür ve motor yeniden çağrılır.
    /// </para>
    /// <para>
    /// <b>Çözülemeyen referans simülasyondan ÖNCE durdurur.</b> Eksik nokta
    /// sessizce atlanmaz ve yarım bir yolculuk başlatılmaz; hata hangi kayıtlı
    /// noktanın çözülemediğini söyler ve kaydın kendisi silinmez —
    /// incelenebilir, yeniden adlandırılabilir ve silinebilir kalır.
    /// </para>
    /// </remarks>
    Task<ServiceResult<JourneySimulationResponse>> ReuseAsync(
        int savedJourneyId,
        CancellationToken cancellationToken = default);
}
