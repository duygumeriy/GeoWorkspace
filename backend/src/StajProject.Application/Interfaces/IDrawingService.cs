using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Domain.Common;

namespace StajProject.Application.Interfaces;

public interface IDrawingService
{
    Task<ServiceResult<DrawingResponse>> CreatePointAsync(CreateDrawingRequest request, CancellationToken cancellationToken);

    Task<ServiceResult<DrawingResponse>> CreateLineAsync(CreateDrawingRequest request, CancellationToken cancellationToken);

    Task<ServiceResult<DrawingResponse>> CreatePolygonAsync(CreateDrawingRequest request, CancellationToken cancellationToken);

    Task<IReadOnlyList<DrawingResponse>> GetPointsAsync(CancellationToken cancellationToken);

    Task<IReadOnlyList<DrawingResponse>> GetLinesAsync(CancellationToken cancellationToken);

    Task<IReadOnlyList<DrawingResponse>> GetPolygonsAsync(CancellationToken cancellationToken);

    /// <summary>Yalnızca stil kolonlarını günceller; geometry'e dokunmaz.</summary>
    Task<ServiceResult<DrawingResponse>> UpdateStyleAsync(DrawingKind kind, int id, DrawingStyleDto? style, CancellationToken cancellationToken);

    /// <summary>
    /// Detay popup'ının düzenleme akışı: ad, stil (renk) ve geometry'yi tek
    /// çağrıda günceller. Gönderilmeyen alanlar korunur.
    /// </summary>
    /// <remarks>
    /// Kayıt bulunamazsa NotFound, çağıran sahip değilse Forbidden döner;
    /// silinmiş/pasif kayıtlar global query filter nedeniyle zaten bulunamaz.
    /// Geometry doğrulaması create ile aynı kurallara tabidir.
    /// </remarks>
    Task<ServiceResult<DrawingResponse>> UpdateAsync(DrawingKind kind, int id, UpdateDrawingRequest request, CancellationToken cancellationToken);

    /// <summary>Kaydı tablodan siler. Bulunamazsa NotFound döner.</summary>
    Task<ServiceResult<int>> DeleteAsync(DrawingKind kind, int id, CancellationToken cancellationToken);

    /// <summary>
    /// Birden çok kaydı TEK transaction içinde siler: ya hepsi silinir ya da
    /// hiçbiri. Bir item bulunamazsa transaction geri alınır ve NotFound döner.
    /// </summary>
    Task<ServiceResult<BulkDeleteResponse>> BulkDeleteAsync(BulkDeleteRequest request, CancellationToken cancellationToken);

    /// <summary>
    /// Birden çok kaydın yalnızca stil kolonlarını TEK transaction içinde
    /// günceller. Geometry'e dokunmaz. Bir alan ilgili tür için anlamsızsa o
    /// kayıtta atlanır; eksik kayıt varsa hiçbiri güncellenmez.
    /// </summary>
    Task<ServiceResult<BulkDrawingsResponse>> BulkUpdateStyleAsync(BulkStyleRequest request, CancellationToken cancellationToken);

    /// <summary>
    /// Birden çok kaydı TEK transaction içinde oluşturur. Bunlar <b>yeni</b>
    /// kayıtlardır ve sahipleri daima çağıran kullanıcıdır.
    /// </summary>
    Task<ServiceResult<BulkDrawingsResponse>> BulkCreateAsync(BulkCreateRequest request, CancellationToken cancellationToken);

    /// <summary>
    /// Soft-delete edilmiş kayıtları TEK transaction içinde geri açar (undo).
    /// </summary>
    /// <remarks>
    /// <b>Create ile aynı işlem değildir.</b> Kayıt zaten sunucuda mevcuttur;
    /// bu yüzden sahiplik, geometry, ad ve stil olduğu gibi korunur — client
    /// hiçbirini belirleyemez. Yetki, kaydın <i>orijinal sahibi</i> üzerinden
    /// değerlendirilir: sahibi veya bir Admin geri açabilir, başkası açamaz.
    /// </remarks>
    Task<ServiceResult<BulkDrawingsResponse>> RestoreAsync(BulkRestoreRequest request, CancellationToken cancellationToken);
}
