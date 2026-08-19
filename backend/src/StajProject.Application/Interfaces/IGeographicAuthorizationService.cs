using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Geographic;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Coğrafi yetki alanlarının yönetimi ve çözümü.
/// </summary>
/// <remarks>
/// <para>
/// <b>İki ayrı sorumluluk, tek sahip.</b> Yönetim (bir hedefin alanlarını oku /
/// ekle / değiştir / kaldır) ve çözüm ("bu kullanıcıya fiilen hangi alan
/// uygulanıyor") aynı serviste durur, çünkü ikisi de aynı öncelik kuralını
/// bilmek zorundadır. Ayrılsalardı kural iki yerde tanımlanır ve zamanla
/// ayrışırdı.
/// </para>
/// <para>
/// <b>Yetkilendirme kararı burada verilmez.</b> Uçtaki
/// <c>geography.view</c> / <c>geography.manage</c> denetimi API katmanının
/// işidir; bu servis "çağıran bunu yapabilir mi" sorusunu değil, "hedefin
/// alanları nedir" sorusunu yanıtlar.
/// </para>
/// </remarks>
public interface IGeographicAuthorizationService
{
    /* --- Kullanıcı hedefi: çoklu alan (Phase 9) --------------------------------- */

    /// <summary>
    /// Kullanıcının doğrudan alanları + yürürlükteki alanı. Kullanıcı yoksa
    /// NotFound. Alanı olmayan kullanıcı için boş liste döner — bu bir hata
    /// değildir.
    /// </summary>
    Task<ServiceResult<GeographicAreasResponse>> GetUserAreasAsync(
        int userId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Kullanıcıya YENİ bir alan ekler. Var olan alanlara DOKUNMAZ.
    /// </summary>
    Task<ServiceResult<GeographicAreasResponse>> CreateUserAreaAsync(
        int userId,
        SaveGeographicAreaRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Kullanıcının BELİRTİLEN alanını değiştirir. Diğer alanları etkilemez.
    /// Alan bu kullanıcıya ait değilse NotFound.
    /// </summary>
    Task<ServiceResult<GeographicAreasResponse>> UpdateUserAreaAsync(
        int userId,
        int areaId,
        SaveGeographicAreaRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Kullanıcının BELİRTİLEN alanını kaldırır. Son alan da kaldırılırsa
    /// kullanıcı rollerinden gelen alanlara düşer.
    /// </summary>
    Task<ServiceResult<GeographicAreasResponse>> DeleteUserAreaAsync(
        int userId,
        int areaId,
        CancellationToken cancellationToken = default);

    /* --- Rol hedefi: çoklu alan (Phase 9) --------------------------------------- */

    Task<ServiceResult<GeographicAreasResponse>> GetRoleAreasAsync(
        int roleId,
        CancellationToken cancellationToken = default);

    Task<ServiceResult<GeographicAreasResponse>> CreateRoleAreaAsync(
        int roleId,
        SaveGeographicAreaRequest request,
        CancellationToken cancellationToken = default);

    Task<ServiceResult<GeographicAreasResponse>> UpdateRoleAreaAsync(
        int roleId,
        int areaId,
        SaveGeographicAreaRequest request,
        CancellationToken cancellationToken = default);

    Task<ServiceResult<GeographicAreasResponse>> DeleteRoleAreaAsync(
        int roleId,
        int areaId,
        CancellationToken cancellationToken = default);

    /* --- Çözüm ----------------------------------------------------------------- */

    /// <summary>
    /// Kullanıcıya fiilen uygulanan coğrafi yetki. Çizim uçlarının sorduğu tek
    /// soru budur.
    /// </summary>
    /// <remarks>
    /// Öncelik: kullanıcının kendi alanlarından EN AZ BİRİ varsa onların
    /// BİRLEŞİMİ geçerlidir ve rol alanları tamamen yok sayılır. Hiç doğrudan
    /// alanı yoksa kullanıcının TÜM Identity rollerinin TÜM alanları
    /// birleştirilir. Hiçbiri yoksa kısıtsızdır.
    /// </remarks>
    Task<EffectiveGeographicAuthorization> GetEffectiveAuthorizationAsync(
        int userId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Çağıranın kendi sınırının HARİTA için özeti: kısıtlı mı, sınır nedir,
    /// kaç parçadan oluşuyor.
    /// </summary>
    /// <remarks>
    /// Yönetim cevabının dar bir türevi DEĞİL, ayrı bir sözleşmedir: alan
    /// kimlikleri, adları ve kaynakları bilinçli olarak dışarıda bırakılır
    /// (bkz. <see cref="SelfGeographicScopeResponse"/>).
    /// </remarks>
    Task<SelfGeographicScopeResponse> GetSelfScopeAsync(
        int userId,
        CancellationToken cancellationToken = default);

    /* --- Uyumluluk: tekil alan sözleşmesi (Phase 8A) ----------------------------
       Yeni ekranlar KULLANMAZ. Tanımlar için bkz. GeographicAuthorizationDtos
       ve tekil uçların dokümantasyonu. */

    /// <summary>[Uyumluluk] Doğrudan alanların birleşimi + yürürlükteki alan.</summary>
    Task<ServiceResult<GeographicAuthorizationResponse>> GetUserAuthorizationAsync(
        int userId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// [Uyumluluk] Kullanıcının TÜM doğrudan alanlarını gönderilen tek alanla
    /// DEĞİŞTİRİR.
    /// </summary>
    Task<ServiceResult<GeographicAuthorizationResponse>> UpsertUserAuthorizationAsync(
        int userId,
        UpdateGeographicAuthorizationRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>[Uyumluluk] Kullanıcının TÜM doğrudan alanlarını kaldırır.</summary>
    Task<ServiceResult<GeographicAuthorizationResponse>> DeleteUserAuthorizationAsync(
        int userId,
        CancellationToken cancellationToken = default);

    /// <summary>[Uyumluluk] Rolün alanlarının birleşimi.</summary>
    Task<ServiceResult<GeographicAuthorizationResponse>> GetRoleAuthorizationAsync(
        int roleId,
        CancellationToken cancellationToken = default);

    /// <summary>[Uyumluluk] Rolün TÜM alanlarını gönderilen tek alanla değiştirir.</summary>
    Task<ServiceResult<GeographicAuthorizationResponse>> UpsertRoleAuthorizationAsync(
        int roleId,
        UpdateGeographicAuthorizationRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>[Uyumluluk] Rolün TÜM alanlarını kaldırır.</summary>
    Task<ServiceResult<GeographicAuthorizationResponse>> DeleteRoleAuthorizationAsync(
        int roleId,
        CancellationToken cancellationToken = default);
}
