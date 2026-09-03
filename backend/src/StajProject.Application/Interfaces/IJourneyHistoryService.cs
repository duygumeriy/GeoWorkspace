using StajProject.Application.Common;
using StajProject.Application.DTOs;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Kişisel yolculuk geçmişinin OKUMA ve yeniden kullanma sözleşmesi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Yazma yolu bilinçli olarak burada DEĞİLDİR.</b> Geçmişi
/// <see cref="IJourneyHistoryWriter"/> yazar ve onu yalnızca sunucunun terminal
/// geçişi çağırır. İki sorumluluğu tek arayüzde toplamak, bir gün bir
/// controller'ın "geçmiş oluştur" ucunu açmasını kolaylaştırırdı — oysa
/// tutanağın istemciden gelen bir kaynağı olmamalıdır.
/// </para>
/// <para>
/// <b>Bu bir <see cref="ISavedJourneyService"/> DEĞİLDİR.</b> Orada kullanıcı
/// kendi tanımlarını adlandırır, yeniden adlandırır ve siler; burada
/// değiştirebileceği hiçbir şey yoktur. Geçmişte ad değiştirme, favori,
/// güncelleme ya da silme metodu YOKTUR: olmuş bir şeyin tutanağı düzenlenmez.
/// </para>
/// <para>
/// <b>Her metot SAHİP KAPSAMLIDIR.</b> Kimlik daima
/// <see cref="ICurrentUserService"/>'ten okunur; başkasının kaydı için yapılan
/// istek "bulunamadı" ile biter — ayrı bir 403, kimlik tahmin eden birine o
/// kaydın var olduğunu doğrulardı.
/// </para>
/// </remarks>
public interface IJourneyHistoryService
{
    /// <summary>
    /// Çağıranın KENDİ geçmişinin bir sayfası; en son biten en üstte.
    /// </summary>
    /// <remarks>Sıralama kararlıdır: eşitlikte kimlik azalan yönde ayırır.</remarks>
    Task<ServiceResult<JourneyHistoryPage>> ListAsync(
        JourneyHistoryQuery query,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Tek bir kaydın değişmez ayrıntısı; başkasınınki için 404.
    /// </summary>
    /// <remarks>
    /// <b>Canlı kayıtlara HİÇ gidilmez.</b> Gösterilecek her ad kaydın kendi
    /// kopyasındadır; silinmiş bir POI'yi içeren yolculuk da açılabilir.
    /// </remarks>
    Task<ServiceResult<JourneyHistoryDetailResponse>> GetAsync(
        int journeyHistoryId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Geçmişteki yolculuğu YENİDEN yapar: yeni bir kişisel simülasyon başlatır.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Eski çalıştırma DİRİLTİLMEZ.</b> Kayıttaki <c>SimulationId</c> tarihsel
    /// bir etikettir ve isteğe hiç girmez; yeniden kullanım mevcut başlatma
    /// yolundan geçer ve YENİ bir kimlik üretir. Kaydın kendisi değişmez —
    /// geçmiş, yeniden yapıldığı için farklılaşmaz.
    /// </para>
    /// <para>
    /// <b>Tarihsel adlar ve ölçümler KULLANILMAZ.</b> Kanonik referanslar
    /// yeniden çözülür ve güzergah motordan taze üretilir: POI taşınmış, durak
    /// taşınmış ya da yol ağı değişmiş olabilir.
    /// </para>
    /// <para>
    /// <b>Kaydedilmiş yolculuk OLUŞTURMAZ.</b> Geçmişi yeniden yapmak, onu
    /// saklamak değildir; saklamak isteyen kullanıcının kendi "Kaydet" eylemi
    /// zaten vardır.
    /// </para>
    /// <para>
    /// <b>Çözülemeyen referans simülasyondan ÖNCE durdurur</b> ve kayıt
    /// okunabilir kalır: geçmiş, işaret ettiği POI silindi diye görünmez
    /// olmamalıdır.
    /// </para>
    /// </remarks>
    Task<ServiceResult<JourneySimulationResponse>> ReuseAsync(
        int journeyHistoryId,
        CancellationToken cancellationToken = default);
}
