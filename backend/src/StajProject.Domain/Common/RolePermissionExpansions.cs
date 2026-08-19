namespace StajProject.Domain.Common;

/// <summary>
/// Katalog GENİŞLEMELERİNİN varsayılan rol grant'ları: kataloğa sonradan
/// eklenen bir yetkinin, zaten provision edilmiş rollere <b>ek olarak</b>
/// verilmesi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden ayrı bir liste.</b> <see cref="RolePermissionDefaults"/> yalnızca
/// bir rol <i>ilk kez</i> yetkilendirilirken uygulanır (bkz. seeder): rolün bir
/// tek grant satırı varsa matris hiç okunmaz. Bu kural bilinçlidir — yöneticinin
/// geri aldığı bir yetkinin her açılışta geri gelmesini engeller. Ama aynı kural,
/// kataloğa YENİ eklenen bir yetkinin mevcut kurulumlardaki yöneticiye hiç
/// ulaşmaması demektir: matris "Administrator her şeye sahiptir" dese de, o rol
/// çoktan provision edilmiştir.
/// </para>
/// <para>
/// Bu liste o boşluğu <b>dar</b> biçimde kapatır: yalnızca burada AÇIKÇA yazılan
/// kodlar, yalnızca burada AÇIKÇA yazılan rollere eklenir. Seeder tüm matrisi
/// gözden geçirip eksikleri tamamlamaz; aksi hâlde geri alınmış eski yetkiler de
/// sessizce geri gelirdi.
/// </para>
/// <para>
/// <b>Yeniden diriltme sınırı.</b> Liste "hangi genişlemenin uygulandığını"
/// saklamaz — bunun için bir şema değişikliği gerekirdi. Dolayısıyla buradaki bir
/// kod ilgili rolden bilinçli olarak geri alınırsa, sonraki açılışta yeniden
/// eklenir. Bu yüzden bir genişleme kaydı <b>kalıcı bir kural değil, bir kerelik
/// dağıtım niyetidir</b>: kurulumlara ulaştıktan sonra buradan çıkarılır ve
/// yetkinin sahibi, normal Rol Yetki Düzenleyicisi olur.
/// </para>
/// </remarks>
public static class RolePermissionExpansions
{
    /// <param name="RoleName">Grant'ı alacak rolün adı.</param>
    /// <param name="PermissionCodes">Yalnızca yeni eklenen kanonik kodlar.</param>
    public sealed record Expansion(string RoleName, IReadOnlyList<string> PermissionCodes);

    /// <summary>
    /// Coğrafi yetkilendirme kataloğu genişlemesi (Phase 8-P).
    /// </summary>
    /// <remarks>
    /// Yalnızca ayrıcalıklı yönetim rolleri alır. GIS Manager / Analyst / Editor
    /// / Viewer ve özel roller bilinçli olarak DIŞARIDADIR: coğrafi yetki alanı
    /// tanımlamak, başka kullanıcıların nerede veri üretebileceğine karar
    /// vermektir — operasyonel bir yetenek değil, yönetimsel bir yetkidir.
    /// İstenirse Rol Yetki Düzenleyicisi'nden verilebilir.
    /// </remarks>
    private static readonly string[] GeographyPermissions =
    [
        PermissionCodes.GeographyView,
        PermissionCodes.GeographyManage
    ];

    /// <summary>
    /// Aktivite geçmişi kataloğu genişlemesi (Phase 9).
    /// </summary>
    /// <remarks>
    /// Coğrafya genişlemesiyle aynı gerekçe: kayıt, kimin neyi ne zaman
    /// değiştirdiğini — diğer yöneticilerin hareketleri dâhil — gösterir.
    /// Operasyonel roller (GIS Manager / Analyst / Editor / Viewer) ve özel
    /// roller bilinçli olarak DIŞARIDADIR; istenirse Rol Yetki
    /// Düzenleyicisi'nden verilebilir.
    /// </remarks>
    private static readonly string[] AuditPermissions =
    [
        PermissionCodes.ActivityView
    ];

    /// <summary>
    /// Uygulanacak genişlemeler. Rol adları yalnızca <b>başlangıç verisi</b>
    /// üretmek için kullanılır; çalışma zamanı yetkilendirmesi hâlâ tamamen
    /// etkin yetki KODLARI üzerinden yürür.
    /// </summary>
    public static readonly IReadOnlyList<Expansion> All =
    [
        new(GisRoles.Administrator, [.. GeographyPermissions, .. AuditPermissions]),

        // Geçiş dönemi: legacy Admin, Administrator profiliyle birebir kalır.
        new(ApplicationRoles.Admin, [.. GeographyPermissions, .. AuditPermissions])
    ];

    /// <summary>Genişlemelerde geçen tüm kodlar (tekrarsız).</summary>
    public static IReadOnlyList<string> AllCodes { get; } =
        [.. All.SelectMany(e => e.PermissionCodes).Distinct(StringComparer.Ordinal)];
}
