using StajProject.Application.Common;
using StajProject.Application.DTOs;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Analiz POI'lerinin <b>nokta örtüsü</b> rasterini üreten servis.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden ısı haritasından AYRI bir sözleşme.</b> İki görüntü artık iki
/// farklı şey yapıyor ve iki farklı yerde üretiliyor: yoğunluk yüzeyi bir
/// HESAPTIR ve sunucuda, ölçüt başına normalleştirilerek üretilir
/// (<c>LocationAnalysisImageService</c>); nokta örtüsü ise bir SUNUMdur —
/// kategori işaretleri, ölçek bantları, etiket çakışma çözümü — ve GeoServer
/// onu zaten yapıyor. Tek bir arayüzün arkasında iki mimariyi bir
/// <c>kind</c> bayrağıyla ayırmak, çağıranın hangi yolun hangi kurallara tabi
/// olduğunu bilememesi demekti.
/// </para>
/// <para>
/// İmza <see cref="ILocationAnalysisImageService"/> ile aynıdır: uç noktanın
/// gövdesi, doğrulaması ve hata eşlemesi değişmez.
/// </para>
/// </remarks>
public interface ILocationAnalysisPointsImageService
{
    Task<ServiceResult<LocationAnalysisImage>> RenderAsync(
        LocationAnalysisImageRequest request,
        CancellationToken cancellationToken,
        LocationAnalysisImageKind kind = LocationAnalysisImageKind.Points);
}
