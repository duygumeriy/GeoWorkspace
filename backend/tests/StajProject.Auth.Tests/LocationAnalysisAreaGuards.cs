using NetTopologySuite.Geometries;
using StajProject.Application.Common;
using StajProject.Application.Interfaces;

namespace StajProject.Auth.Tests;

/// <summary>
/// Testler için coğrafi kapı ikizleri.
/// </summary>
/// <remarks>
/// <b>Kapı ZORUNLU bir bağımlılıktır ve bu bilinçlidir.</b> İsteğe bağlı
/// olsaydı, yeni bir analiz ucu onu geçmeyi unutabilir ve denetim sessizce
/// atlanabilirdi; derleyici hatası, o unutmayı imkânsız kılar. Bedeli, mevcut
/// testlerin niyetlerini AÇIKÇA söylemesidir: "bu test coğrafi kısıtı
/// ölçmüyor" demek için <see cref="Unrestricted"/> kullanılır.
/// </remarks>
internal static class AreaGuards
{
    /// <summary>Kısıtsız kullanıcı: bugünkü kurulumların çoğu böyledir.</summary>
    internal static ILocationAnalysisAreaGuard Unrestricted { get; } = new AllowAll();

    /// <summary>Yalnızca verilen alanın İÇİNDEKİ hedefleri geçiren kapı.</summary>
    internal static ILocationAnalysisAreaGuard Only(Geometry allowed) => new CoversOnly(allowed);

    private sealed class AllowAll : ILocationAnalysisAreaGuard
    {
        public Task<ServiceResult<bool>> AuthorizeAsync(Geometry target, CancellationToken cancellationToken = default) =>
            Task.FromResult(ServiceResult<bool>.Success(true));
    }

    private sealed class CoversOnly : ILocationAnalysisAreaGuard
    {
        private readonly Geometry _allowed;

        public CoversOnly(Geometry allowed) => _allowed = allowed;

        /* Gerçek kapının yüklemiyle AYNI: `Covers`. */
        public Task<ServiceResult<bool>> AuthorizeAsync(Geometry target, CancellationToken cancellationToken = default) =>
            Task.FromResult(_allowed.Covers(target)
                ? ServiceResult<bool>.Success(true)
                : ServiceResult<bool>.Forbidden("Seçilen alan coğrafi yetki alanınızın dışında."));
    }
}
