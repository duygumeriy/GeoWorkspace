using StajProject.Application.Common;
using StajProject.Application.DTOs;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Kullanıcıya DOĞRUDAN verilen yetkilerin yönetimi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Rol yetkilerinden ayrı tutulur.</b> <see cref="IRoleManagementService"/>
/// "bu ROL neye izin verir" sorusunun sahibidir; burada cevaplanan soru "bu
/// KULLANICI, rolünün ötesinde neye izinlidir"dir. İkisi tek serviste
/// birleştirilseydi, bir rolün yetkisini değiştirmek ile bir kişiye istisna
/// tanımak aynı kod yolundan geçer ve yanlışlıkla birbirini etkileyebilirdi.
/// </para>
/// <para>
/// <b>Kalıtım ile doğrudan atama karıştırılmaz.</b> Rolünden gelen bir yetki
/// kullanıcıya AYRICA doğrudan atanamaz: ortaya çıkacak ikinci satır hiçbir şey
/// eklemez, ama rol değiştiğinde sessizce arkada kalarak yöneticinin
/// beklemediği bir erişimi sürdürürdü.
/// </para>
/// <para>
/// <b>Yetki yükseltmeye kapalıdır.</b> Çağıran, kendi etkin yetkilerinin
/// dışında bir yetkiyi kimseye veremez — rol yetkisi ucundaki kuralın aynısı.
/// Aksi hâlde <c>permissions.assign</c> sahibi, bir kuklaya istediği yetkiyi
/// verip o hesap üzerinden sisteme erişebilirdi.
/// </para>
/// </remarks>
public interface IUserPermissionManagementService
{
    /// <summary>
    /// Kullanıcının yetki tablosu: her yetkinin kaynağı (rol / doğrudan),
    /// etkisi ve çağıran için mutasyon kabiliyeti.
    /// </summary>
    /// <param name="actingUserId">
    /// Doğrulanmış çağıranın kimliği. Yanıttaki <c>CanAssignDirect</c> alanları
    /// buna göre hesaplanır; okuma yine de çağırana göre FİLTRELENMEZ — yönetici
    /// veremeyeceği yetkileri de görebilmelidir.
    /// </param>
    Task<ServiceResult<UserPermissionsResponse>> GetUserPermissionsAsync(
        int actingUserId,
        int targetUserId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Kullanıcının DOĞRUDAN yetkilerini istenen aktif kümeye eşitler.
    /// </summary>
    /// <remarks>
    /// <para>Kurallar:</para>
    /// <list type="bullet">
    /// <item>tanınmayan kod → 400</item>
    /// <item>pasif yetkinin yeni ataması → 400</item>
    /// <item>rolden zaten gelen yetkinin yeni doğrudan ataması → 400</item>
    /// <item><c>yeni eklenenler ⊆ çağıranın etkin yetkileri</c> değilse → 403</item>
    /// </list>
    /// <para>
    /// Doğrulamanın tamamı yazmadan ÖNCE biter: yarısı uygulanmış bir yetki
    /// kümesi, yöneticinin ekranda gördüğüyle veritabanının sessizce ayrışması
    /// demek olurdu.
    /// </para>
    /// <para>
    /// Kaldırma, çağıranın o yetkiyi taşımasını gerektirmez — ayrıcalığı
    /// azaltır. Pasif yetkilere ait tarihsel satırlar istek kapsamı dışındadır
    /// ve korunur.
    /// </para>
    /// </remarks>
    Task<ServiceResult<UserPermissionsResponse>> ReplaceUserPermissionsAsync(
        int actingUserId,
        int targetUserId,
        UpdateUserPermissionsRequest request,
        CancellationToken cancellationToken = default);
}
