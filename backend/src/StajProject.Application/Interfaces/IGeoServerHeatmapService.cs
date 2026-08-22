using StajProject.Application.Common;
using StajProject.Application.DTOs;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Kimliği ve coğrafi kapsamı backend'den çözerek kullanıcıya özel GeoServer
/// heatmap görüntüsü üreten uygulama portu.
/// </summary>
public interface IGeoServerHeatmapService
{
    Task<ServiceResult<HeatmapImage>> GetHeatmapAsync(
        HeatmapRequest request,
        CancellationToken cancellationToken);
}
