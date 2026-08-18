using StajProject.Application.Common;
using StajProject.Application.DTOs;

namespace StajProject.Application.Interfaces;

/// <summary>
/// Rollerin ve rol-yetki matrisinin yönetimi.
/// </summary>
/// <remarks>
/// <para>
/// Yetki kontrolü burada DEĞİL, uçlardaki <c>MfaRequired</c> +
/// <c>[RequirePermission]</c> katmanındadır. Bu servis "çağıranın yetkisi
/// var" varsayımıyla iş kurallarını uygular: korunan rollerin dokunulmazlığı,
/// ad benzersizliği, kullanıcısı olan rolün silinememesi ve yetki
/// atamalarının atomikliği.
/// </para>
/// <para>
/// Kullanıcı yönetimi bilinçli olarak kapsam dışıdır; o
/// <see cref="IUserManagementService"/>'in sorumluluğudur. İkisi tek bir
/// "AdminService" altında birleştirilmez.
/// </para>
/// </remarks>
public interface IRoleManagementService
{
    Task<IReadOnlyList<RoleListItem>> GetRolesAsync(CancellationToken cancellationToken = default);

    Task<ServiceResult<RoleDetail>> GetRoleAsync(int roleId, CancellationToken cancellationToken = default);

    Task<ServiceResult<RoleDetail>> CreateRoleAsync(
        CreateRoleRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>Yalnızca özel roller yeniden adlandırılabilir.</summary>
    Task<ServiceResult<RoleDetail>> RenameRoleAsync(
        int roleId,
        UpdateRoleRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Yalnızca kullanıcısı olmayan özel roller silinebilir. Kullanıcılar
    /// başka bir role TAŞINMAZ; bu bilinçli bir yönetici kararı olmalıdır.
    /// </summary>
    Task<ServiceResult<bool>> DeleteRoleAsync(int roleId, CancellationToken cancellationToken = default);

    /// <summary>Yetki kataloğunun tamamı (pasifler dahil, işaretlenmiş olarak).</summary>
    Task<IReadOnlyList<PermissionCatalogItem>> GetPermissionCatalogAsync(
        CancellationToken cancellationToken = default);

    Task<ServiceResult<RolePermissionsResponse>> GetRolePermissionsAsync(
        int roleId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Rolün yetkilerini istenen kümeye eşitler (ekleme + kaldırma farkı).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Bu uç yetki yükseltmeye kapalıdır.</b> Uçtaki <c>roles.update</c> +
    /// <c>permissions.assign</c> "rol yetkisi düzenleyebilirsin" der; "hangi
    /// yetkiyi dağıtabilirsin" sorusunu cevaplamaz. Cevaplamasaydı, bu iki
    /// yetkiye sahip biri kendi rolüne <c>users.delete</c> ekleyip anında tüm
    /// sisteme erişebilirdi. Bu yüzden servis çağıranın kimliğini bilmek
    /// ZORUNDADIR ve kural şudur:
    /// </para>
    /// <para>
    /// <c>yeni eklenenler ⊆ çağıranın etkin yetkileri</c>
    /// </para>
    /// <para>
    /// Kural yalnızca EKLEMELERE uygulanır. Rolde zaten bulunan bir yetki yeni
    /// bir bağış değildir; kaldırma ise ayrıcalığı azaltır. Aksi hâlde
    /// (<c>istenen küme ⊆ çağıran</c>) bir yönetici, kendisinden güçlü bir rolü
    /// hiç kaydedemez — hatta o rolden yetki çıkaramaz — hâle gelirdi.
    /// </para>
    /// </remarks>
    /// <param name="actingUserId">
    /// Doğrulanmış çağıranın kimliği. İstek gövdesinden/query'den ASLA
    /// okunmaz; çözülemezse (<c>0</c> veya negatif) hiçbir ekleme yapılamaz.
    /// </param>
    Task<ServiceResult<RolePermissionsResponse>> ReplaceRolePermissionsAsync(
        int actingUserId,
        int roleId,
        UpdateRolePermissionsRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// <b>Çağıranın</b> şu anda atayabileceği roller. Onay ekranı ve rol
    /// değiştirme ucunun <b>tek</b> doğrulama kaynağıdır.
    /// </summary>
    /// <param name="actingUserId">
    /// İşlemi yapan yöneticinin kimliği. <b>İstek gövdesinden değil</b>,
    /// doğrulanmış token'dan gelmelidir.
    /// </param>
    /// <remarks>
    /// <para>
    /// Liste iki filtreden geçer: rol <b>genel olarak</b> atanabilir mi
    /// (legacy geçiş rolleri herkese kapalıdır) <b>ve</b> çağıranın onu verme
    /// yetkisi var mı. İkinci filtre
    /// <see cref="ResolveAssignableRoleAsync"/> ile <b>aynı</b> kuralı
    /// kullanır: hedef rolün aktif yetkileri ⊆ çağıranın etkin yetkileri.
    /// Böylece ekranda görünüp mutasyonda 403 alan bir rol oluşamaz.
    /// </para>
    /// <para>
    /// <b>Bu, sistemdeki rollerin envanteri DEĞİLDİR</b> — o soru
    /// <see cref="GetRolesAsync"/>'in konusudur ve bilinçli olarak çağırana
    /// göre filtrelenmez. Buradaki soru "hangi roller VAR" değil, "bu çağıran
    /// şu an hangi rolleri VEREBİLİR"dir.
    /// </para>
    /// <para>
    /// Kimliği çözülemeyen bir çağıran için sonuç <b>boştur</b>; belirsizlik
    /// hâlinde güvenli cevap "hiçbiri"dir.
    /// </para>
    /// </remarks>
    Task<IReadOnlyList<AssignableRole>> GetAssignableRolesAsync(
        int actingUserId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Serbest metinden atanabilir bir rol adı çözer ve <b>çağıranın o rolü
    /// verme yetkisi olduğunu</b> doğrular. Onay ve rol değiştirme akışlarının
    /// ikisi de bunu kullanır; doğrulama iki yerde ayrı ayrı yazılmaz.
    /// </summary>
    /// <param name="actingUserId">
    /// İşlemi yapan yöneticinin kimliği. <b>İstek gövdesinden değil</b>,
    /// doğrulanmış token'dan gelmelidir.
    /// </param>
    /// <remarks>
    /// <para>
    /// <b>Yetki yükseltme koruması.</b> Bir kullanıcı sahip olmadığı yetkileri
    /// dağıtamaz: hedef rolün AKTİF yetkileri, çağıranın etkin yetkilerinin
    /// alt kümesi olmak zorundadır. Aksi hâlde yalnızca <c>users.update</c>
    /// yetkisi olan biri, bir başkasını 27 yetkili <c>Administrator</c> yapıp
    /// o hesap üzerinden tüm sisteme erişebilirdi.
    /// </para>
    /// <para>
    /// Çağıran kimliği parametre olarak ZORUNLUDUR: kontrolsüz bir aşırı
    /// yükleme bırakılmaz, böylece rol atayan hiçbir yol bu kuralı yanlışlıkla
    /// atlayamaz.
    /// </para>
    /// </remarks>
    Task<ServiceResult<string>> ResolveAssignableRoleAsync(
        string? roleName,
        int actingUserId,
        CancellationToken cancellationToken = default);
}
