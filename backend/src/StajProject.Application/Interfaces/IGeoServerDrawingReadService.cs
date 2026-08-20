using StajProject.Application.DTOs;
using StajProject.Domain.Common;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Normal harita çizimlerini GeoServer WFS üzerinden okuyan uygulama portu.
/// Kimlik istemciden değil, çağıran <see cref="IDrawingService"/> tarafından
/// doğrulanmış backend kullanıcı bağlamından gelir.
/// </summary>
public interface IGeoServerDrawingReadService
{
    Task<IReadOnlyList<DrawingResponse>> GetDrawingsAsync(
        DrawingKind kind,
        int currentUserId,
        CancellationToken cancellationToken);
}
