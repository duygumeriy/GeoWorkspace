using NetTopologySuite.Geometries;
using StajProject.Application.Common;
using StajProject.Application.Interfaces;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// <see cref="ILocationAnalysisAreaGuard"/>'ın yürürlükteki coğrafi yetkiye
/// dayanan uygulaması.
/// </summary>
/// <remarks>
/// <para>
/// <b>Predicate <c>Covers</c>'tır</b> ve karar
/// <see cref="Application.Geographic.EffectiveGeographicAuthorization.Allows"/>
/// içindedir — çizim/POI yazma yolunun kullandığı yüklemin AYNISI. İkinci bir
/// "içinde mi" tanımı yazmak, aynı kullanıcının bir ekranda geçip diğerinde
/// takıldığı bir sınır üretirdi.
/// </para>
/// <para>
/// <b>Kısıtsız kullanıcı etkilenmez.</b> Hiç alanı olmayan bir kullanıcı için
/// <c>IsRestricted</c> false'tur ve denetim her hedefi geçirir; mevcut
/// kurulumlarda analiz aynen çalışmaya devam eder.
/// </para>
/// </remarks>
public sealed class LocationAnalysisAreaGuard : ILocationAnalysisAreaGuard
{
    private readonly ICurrentUserService _currentUser;
    private readonly IGeographicAuthorizationService _authorization;

    public LocationAnalysisAreaGuard(
        ICurrentUserService currentUser,
        IGeographicAuthorizationService authorization)
    {
        _currentUser = currentUser;
        _authorization = authorization;
    }

    public async Task<ServiceResult<bool>> AuthorizeAsync(
        Geometry target,
        CancellationToken cancellationToken = default)
    {
        var userId = _currentUser.UserId;

        if (userId is null)
        {
            /* Kimliksiz bir çağrı buraya ULAŞMAMALIDIR (uçlar zaten yetki
               ister); ulaşırsa açık bir hata döner — sessizce kısıtsız
               saymak, denetimin kendisini anlamsız kılardı. */
            return ServiceResult<bool>.Failure("Oturum bulunamadı.");
        }

        var scope = await _authorization.GetEffectiveAuthorizationAsync(userId.Value, cancellationToken);

        if (scope.Allows(target))
        {
            return ServiceResult<bool>.Success(true);
        }

        /* Mesaj alanın NEREDE olduğunu söylemez: kullanıcıya yetkisi
           olmadığı bir bölgenin sınırlarını anlatmak, yetkilendirmenin
           kendisini sızdırmak olurdu. Ön yüz zaten kendi sınırını çizer. */
        return ServiceResult<bool>.Forbidden(
            "Seçilen alan coğrafi yetki alanınızın dışında. Analizi yalnızca yetkili olduğunuz bölgede çalıştırabilirsiniz.");
    }
}
