using NetTopologySuite.Geometries;
using StajProject.Application.Common;
using StajProject.Application.DTOs;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Konum analizinin backend-yetkili il/bölge kataloğu ve idari hedef
/// doğrulaması.
/// </summary>
public interface ILocationAnalysisTargetCatalogService
{
    Task<ServiceResult<LocationAnalysisTargetCatalogResponse>> GetAuthorizedCatalogAsync(
        CancellationToken cancellationToken = default);

    Task<ServiceResult<bool>> AuthorizeTargetAsync(
        string targetType,
        string targetKey,
        Geometry submittedTarget,
        CancellationToken cancellationToken = default);
}
