using StajProject.Application.Common;
using StajProject.Application.DTOs;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Kayıtlı envanter (tbl_point / tbl_line / tbl_polygon) üzerinde çalışan
/// mekânsal analiz sözleşmesi. Gerçekleştirim sorguyu PostGIS tarafında
/// çalıştırır; hiçbir geometry sayım için belleğe çekilmez.
/// </summary>
public interface ISpatialAnalysisService
{
    /// <summary>
    /// Verilen poligonla <c>ST_Intersects</c> anlamında kesişen envanter
    /// kayıtlarını sayar. Tam kapsanma aranmaz: sınıra değen ya da kısmen
    /// giren kayıtlar da sayılır.
    /// </summary>
    Task<ServiceResult<IntersectionAnalysisResponse>> CountIntersectionsAsync(
        IntersectionAnalysisRequest request,
        CancellationToken cancellationToken);
}
