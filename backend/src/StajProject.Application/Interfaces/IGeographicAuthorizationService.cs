using NetTopologySuite.Geometries;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Geographic;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Coğrafi yetki alanlarının yönetimi ve çözümü.
/// </summary>
/// <remarks>
/// <para>
/// <b>İki ayrı sorumluluk, tek sahip.</b> Yönetim (bir hedefin alanını oku /
/// yaz / kaldır) ve çözüm ("bu kullanıcıya fiilen hangi alan uygulanıyor") aynı
/// serviste durur, çünkü ikisi de aynı öncelik kuralını bilmek zorundadır.
/// Ayrılsalardı kural iki yerde tanımlanır ve zamanla ayrışırdı.
/// </para>
/// <para>
/// <b>Yetkilendirme kararı burada verilmez.</b> Uçtaki
/// <c>geography.view</c> / <c>geography.manage</c> denetimi API katmanının
/// işidir; bu servis "çağıran bunu yapabilir mi" sorusunu değil, "hedefin alanı
/// nedir" sorusunu yanıtlar.
/// </para>
/// </remarks>
public interface IGeographicAuthorizationService
{
    /* --- Kullanıcı hedefi ------------------------------------------------------ */

    /// <summary>
    /// Kullanıcının kendi alanı + yürürlükteki alanı. Kullanıcı yoksa NotFound.
    /// </summary>
    Task<ServiceResult<GeographicAuthorizationResponse>> GetUserAuthorizationAsync(
        int userId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Kullanıcının alanını istenen poligona eşitler (upsert). Satır yoksa
    /// oluşturulur, varsa poligonu değiştirilir — ikinci satır ASLA açılmaz.
    /// </summary>
    Task<ServiceResult<GeographicAuthorizationResponse>> UpsertUserAuthorizationAsync(
        int userId,
        UpdateGeographicAuthorizationRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Kullanıcıya özel alanı kaldırır. Kullanıcı bundan sonra rollerinden gelen
    /// alanlara düşer; hiçbiri yoksa kısıtsız olur.
    /// </summary>
    Task<ServiceResult<GeographicAuthorizationResponse>> DeleteUserAuthorizationAsync(
        int userId,
        CancellationToken cancellationToken = default);

    /* --- Rol hedefi ------------------------------------------------------------ */

    Task<ServiceResult<GeographicAuthorizationResponse>> GetRoleAuthorizationAsync(
        int roleId,
        CancellationToken cancellationToken = default);

    Task<ServiceResult<GeographicAuthorizationResponse>> UpsertRoleAuthorizationAsync(
        int roleId,
        UpdateGeographicAuthorizationRequest request,
        CancellationToken cancellationToken = default);

    Task<ServiceResult<GeographicAuthorizationResponse>> DeleteRoleAuthorizationAsync(
        int roleId,
        CancellationToken cancellationToken = default);

    /* --- Çözüm ----------------------------------------------------------------- */

    /// <summary>
    /// Kullanıcıya fiilen uygulanan coğrafi yetki. Çizim uçlarının sorduğu tek
    /// soru budur.
    /// </summary>
    /// <remarks>
    /// Öncelik: kullanıcının kendi alanı varsa O geçerlidir ve rol alanları
    /// tamamen yok sayılır (bkz. uygulama). Yoksa kullanıcının TÜM Identity
    /// rollerinin alanları birleştirilir. Hiçbiri yoksa kısıtsızdır.
    /// </remarks>
    Task<EffectiveGeographicAuthorization> GetEffectiveAuthorizationAsync(
        int userId,
        CancellationToken cancellationToken = default);
}
