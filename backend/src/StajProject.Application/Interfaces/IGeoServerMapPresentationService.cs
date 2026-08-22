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
}
