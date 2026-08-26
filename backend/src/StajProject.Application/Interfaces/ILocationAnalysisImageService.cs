using StajProject.Application.Common;
using StajProject.Application.DTOs;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Konum analizinin <b>ağırlıklı ısı haritası görüntüsü</b> sözleşmesi.
/// </summary>
/// <remarks>
/// <para>
/// <b><see cref="ILocationAnalysisService"/>'ten AYRIDIR.</b> O, JSON bir özet
/// döndürür ve görüntü penceresi bilmez; bu, bir PNG döndürür ve her
/// kaydırmada yeniden çağrılır. Tek arayüzde toplamak, JSON özeti isteyen
/// çağrıyı da bir render sözleşmesine bağlardı.
/// </para>
/// <para>
/// <b>Yetkilendirme kararı burada verilmez.</b> Uçtaki
/// <c>location.analysis</c> + <c>poi.view</c> denetimi API katmanının işidir —
/// <see cref="IGeoServerHeatmapService"/> ile aynı ayrım.
/// </para>
/// </remarks>
/// <summary>
/// Aynı analizin hangi GÖRÜNÜMÜ isteniyor.
/// </summary>
/// <remarks>
/// <b>İki uç, tek doğrulama yolu.</b> Ağırlıklı raster ile nokta örtüsü yalnızca
/// STİLDE ayrışır; alan, ölçütler, kategori kapanışı, CQL üretimi ve pencere
/// doğrulaması ortaktır. Ayrı bir servis yazmak, taksonominin ikinci bir
/// yorumunu üretme riskini davet ederdi — örtü ile ısı haritası aynı POI
/// kümesini göstermek ZORUNDADIR.
/// </remarks>
public enum LocationAnalysisImageKind
{
    /// <summary>Kategori ağırlıklarına göre ölçeklenen yoğunluk rasteri.</summary>
    WeightedHeatmap = 0,

    /// <summary>Eşleşen POI'lerin tekil noktaları.</summary>
    Points = 1
}

public interface ILocationAnalysisImageService
{
    /// <param name="kind">
    /// Hangi görünüm. Varsayılan ağırlıklı ısı haritasıdır; mevcut çağıranlar
    /// değişmez.
    /// </param>
    Task<ServiceResult<LocationAnalysisImage>> RenderAsync(
        LocationAnalysisImageRequest request,
        CancellationToken cancellationToken,
        LocationAnalysisImageKind kind = LocationAnalysisImageKind.WeightedHeatmap);
}
