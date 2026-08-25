using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Domain.Common;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Kalıcı çizimlerin haritadaki GENEL GÖSTERİMİNİ GeoServer WMS üzerinden
/// üreten uygulama portu.
/// </summary>
/// <remarks>
/// <para>
/// Bu port yalnızca <b>görüntü</b> üretir. Çizimlerin kimliği, seçimi ve
/// düzenlenmesi WFS/GeoJSON okuması üzerinden yürümeye devam eder
/// (<see cref="IGeoServerDrawingReadService"/>); ikisi bilinçli olarak ayrı
/// yollardır ve bu porta bir feature listesi sorulamaz.
/// </para>
/// <para>
/// Sahiplik ve durum yüklemi çağıranın verdiği bir değerden değil,
/// <see cref="ICurrentUserService"/>'ten çözülür.
/// </para>
/// </remarks>
public interface IGeoServerMapPresentationService
{
    Task<ServiceResult<MapPresentationImage>> GetPresentationAsync(
        DrawingKind kind,
        MapPresentationRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// POI envanterinin haritadaki genel gösterimi.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Çizim sunumundan iki noktada AYRILIR ve ikisi de bilinçlidir:
    /// <see cref="DrawingKind"/> almaz (POI bir çizim değildir ve tek bir
    /// katmanı vardır) ve sahiplik yüklemi uygulamaz — POI, <c>poi.view</c>
    /// taşıyan herkese açık ortak envanterdir.
    /// </para>
    /// <para>
    /// Bu port da yalnızca <b>görüntü</b> üretir. POI kimliği, seçimi ve
    /// düzenlenmesi <c>/api/poi</c> REST yolundan yürümeye devam eder.
    /// </para>
    /// </remarks>
    Task<ServiceResult<MapPresentationImage>> GetPoiPresentationAsync(
        MapPresentationRequest request,
        CancellationToken cancellationToken);
}
