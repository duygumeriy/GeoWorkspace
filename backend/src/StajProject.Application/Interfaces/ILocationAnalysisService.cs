using StajProject.Application.Common;
using StajProject.Application.DTOs;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Konum analizi: seçilen alan içindeki <b>açık veri</b> POI'lerini, seçilen
/// kategori ağırlıklarıyla puanlayan okuma sözleşmesi.
/// </summary>
/// <remarks>
/// <para>
/// <b><see cref="ISpatialAnalysisService"/>'ten AYRIDIR.</b> O, çağıranın KENDİ
/// çizim envanterini sayar ve sahiplik yüklemiyle çalışır; bu, ortak
/// <c>analysis_poi</c> veri kümesini kategori ve ağırlık ekseninde okur. İki
/// sözleşmeyi tek arayüzde toplamak, "kapsam nedir" sorusunun iki farklı
/// cevabını aynı yere koymak olurdu.
/// </para>
/// <para>
/// <b>Hiçbir şey YAZMAZ.</b> Hedef alan da ölçütler de yalnızca sorgu
/// parametresidir; ne alan ne de sonuç saklanır.
/// </para>
/// <para>
/// <b>Yetkilendirme kararı burada verilmez.</b> Uçtaki
/// <c>location.analysis</c> + <c>poi.view</c> denetimi API katmanının işidir;
/// bu servis "çağıran bunu yapabilir mi" sorusunu değil, "bu alanda ve bu
/// ölçütlerle sonuç nedir" sorusunu yanıtlar — <c>IGeographicAuthorizationService</c>
/// ile aynı ayrım.
/// </para>
/// </remarks>
public interface ILocationAnalysisService
{
    Task<ServiceResult<LocationAnalysisResponse>> AnalyzeAsync(
        LocationAnalysisRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Haritada tıklanan noktaya en yakın <b>eşleşen</b> analiz POI'sini çözer.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Neden özet ucundan ayrı bir çağrı.</b> Özet, ölçüt başına birer
    /// sayaç döndürür ve tek bir POI'nin kimliğini taşımaz; nokta örtüsü ise
    /// sunucuda çizilmiş bir PNG'dir ve pikselin arkasında bir kayıt kimliği
    /// yoktur. Kullanıcının gördüğü noktayı inceleyebilmesi için kimliği
    /// veritabanından ÇÖZEN dar bir yol gerekir.
    /// </para>
    /// <para>
    /// <b>Aynı analiz, aynı taksonomi.</b> Arama <see cref="AnalyzeAsync"/> ile
    /// aynı alan ve kategori kapanışını kullanır; ekranda olmayan bir nokta
    /// buradan da dönemez.
    /// </para>
    /// </remarks>
    /// <summary>
    /// Aktif analize giren POI'lerin listesi — <b>vektör çizim</b> için.
    /// </summary>
    /// <remarks>
    /// <b>Özetten farkı ÇÖZÜNÜRLÜKTÜR.</b> Özet ölçüt başına birer sayaç
    /// döndürür ve tek bir kaydın kimliğini taşımaz; burası kayıtların
    /// kendilerini döndürür, çünkü harita artık her POI'yi kendi kategori
    /// rozetiyle çizer. Alan ve kategori süzgeci İKİSİNDE DE aynı koddan
    /// gelir, dolayısıyla haritadaki nokta sayısı özetin söylediği sayıdır.
    /// </remarks>
    Task<ServiceResult<LocationAnalysisPointsResponse>> ListPointsAsync(
        LocationAnalysisRequest request,
        CancellationToken cancellationToken = default);

    Task<ServiceResult<LocationAnalysisHitTestResponse>> HitTestAsync(
        LocationAnalysisHitTestRequest request,
        CancellationToken cancellationToken = default);
}
