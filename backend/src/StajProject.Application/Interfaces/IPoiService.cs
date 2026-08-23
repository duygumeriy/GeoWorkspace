using StajProject.Application.Common;
using StajProject.Application.DTOs;

namespace StajProject.Application.Interfaces;

/// <summary>
/// POI kayıtlarının okunması ve oluşturulması.
/// </summary>
/// <remarks>
/// <para>
/// <b>Yetki kararı burada verilmez.</b> <c>poi.view</c> / <c>poi.create</c> /
/// <c>poi.manage</c> denetimi API katmanının işidir; bu servis "çağıran bunu
/// yapabilir mi" sorusunu değil, "veri nedir" sorusunu yanıtlar. Tek istisna
/// coğrafi sınırdır: o, kaydın NEREYE yazılabileceğine dair bir iş kuralıdır
/// ve kayıt açılmadan önce burada uygulanır.
/// </para>
/// <para>
/// <b>Okuma sahibe göre KISITLANMAZ.</b> Çizimlerin aksine POI ortak bir
/// envanterdir: <c>poi.view</c> taşıyan herkes tüm aktif POI'leri görür.
/// </para>
/// </remarks>
public interface IPoiService
{
    /// <summary>
    /// Haritanın gördüğü POI listesi: aktif, silinmemiş, oluşturan bilgisi
    /// olmadan. Coğrafi filtre UYGULANMAZ — sınır yalnızca oluşturmayı
    /// kısıtlar.
    /// </summary>
    Task<IReadOnlyList<PoiResponse>> GetMapPoisAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Yeni POI oluşturur. Sahiplik doğrulanmış kimlikten gelir; istek
    /// gövdesindeki hiçbir alan sahipliği, tarihleri veya durum bayraklarını
    /// etkileyemez.
    /// </summary>
    Task<ServiceResult<PoiResponse>> CreatePoiAsync(
        CreatePoiRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Yönetim listesi: pasif ve soft-delete edilmiş kayıtlar DÂHİL, oluşturan
    /// bilgisiyle birlikte.
    /// </summary>
    Task<IReadOnlyList<AdminPoiResponse>> GetAdminPoisAsync(CancellationToken cancellationToken = default);
}
