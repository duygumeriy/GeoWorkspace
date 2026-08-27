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
    /// Isı haritası kataloğu genişlemesi (Phase 10).
    /// </summary>
    /// <remarks>
    /// <para>
    /// Isı haritası daha önce <c>inventory.analysis</c> ile korunuyordu; o kodu
    /// taşıyan seed rolleri (Administrator, GIS Manager, GIS Analyst) bugün ısı
    /// haritasına erişebiliyor. Yetki ayrıştırıldığında yeni kod yalnızca
    /// matrise yazılsaydı, matris <b>yalnızca hiç yetkisi olmayan</b> rollere
    /// uygulandığı için mevcut kurulumlardaki bu üç rol erişimi sessizce
    /// KAYBEDERDİ. Genişleme, ayrıştırmayı davranış açısından nötr tutar.
    /// </para>
    /// <para>
    /// Liste bilinçli olarak yalnızca <b>seed</b> rollerini sayar. Yöneticinin
    /// kendi tanımladığı, <c>inventory.analysis</c> verilmiş özel roller
    /// DIŞARIDADIR: o grant'ların niyeti kaynakta yazılı değildir ve "analiz
    /// yetkisi ısı haritası da demektir" varsayımı, ayrıştırmanın kendisini
    /// geçersiz kılardı. Gerekiyorsa Rol Yetki Düzenleyicisi'nden verilir.
    /// </para>
    /// </remarks>
    private static readonly string[] HeatmapPermissions =
    [
        PermissionCodes.HeatmapView
    ];

    /// <summary>
    /// Konum analizi kataloğu genişlemesi.
    /// </summary>
    /// <remarks>
    /// <para>
    /// POI genişlemesiyle aynı gerekçe: konum analizi, coğrafi yetki yönetimi
    /// ya da denetim kaydı gibi YÖNETİMSEL bir yetenek değil, kullanıcının
    /// haritada çalıştırdığı temel bir analizdir — ödev normal kullanıcının
    /// yapabilmesini açıkça ister. Yalnızca ayrıcalıklı rollere verilseydi,
    /// mevcut kurulumlardaki Viewer/Editor/Analyst kullanıcıları için özellik
    /// hiç açılmazdı.
    /// </para>
    /// <para>
    /// Dağılım <see cref="RolePermissionDefaults"/> matrisiyle birebir aynıdır;
    /// genişlemenin işi yeni kodu zaten provision edilmiş rollere ULAŞTIRMAKTIR,
    /// farklı bir profil tanımlamak değil. Özel roller DIŞARIDADIR ve yetkiyi
    /// Rol Yetki Düzenleyicisi'nden AÇIKÇA alır.
    /// </para>
    /// <para>
    /// <c>inventory.analysis</c> ya da <c>heatmap.view</c> taşıyan roller bu
    /// koda kendiliğinden SAHİP OLMAZ: üçü ayrı yeteneklerdir ve "analiz
    /// yetkisi konum analizi de demektir" varsayımı ayrımın kendisini
    /// geçersiz kılardı.
    /// </para>
    /// </remarks>
    private static readonly string[] LocationAnalysisPermissions =
    [
        PermissionCodes.LocationAnalysis
    ];

    /// <summary>
    /// POI kataloğu genişlemesi (Phase 2A).
    /// </summary>
    /// <remarks>
    /// <para>
    /// Diğer genişlemelerden farklı olarak bu liste OPERASYONEL rolleri de
    /// kapsar ve bu bilinçlidir: POI görüntüleme, coğrafi yetki yönetimi ya da
    /// denetim kaydı gibi yönetimsel bir yetenek değil, temel bir harita
    /// yeteneğidir. Yalnızca ayrıcalıklı rollere verilseydi, mevcut
    /// kurulumlardaki Viewer/Editor/Analyst kullanıcıları haritada hiçbir POI
    /// göremezdi — yani özellik, üzerinde çalıştığı kurulumlarda görünmez
    /// hâlde kalırdı.
    /// </para>
    /// <para>
    /// Dağılım <see cref="RolePermissionDefaults"/> matrisiyle birebir aynıdır;
    /// genişlemenin işi yeni kodları zaten provision edilmiş rollere
    /// ULAŞTIRMAKTIR, farklı bir profil tanımlamak değil.
    /// </para>
    /// <para>
    /// <b>Özel roller DIŞARIDADIR.</b> Ödevin "Operatör" rolü, rol yönetimi
    /// ekranından tanımlanacak özel bir roldür ve yetkilerini oradan AÇIKÇA
    /// alır; buradan sessizce yetkilendirilmez.
    /// </para>
    /// </remarks>
    private static readonly string[] PoiViewOnly =
    [
        PermissionCodes.PoiView
    ];

    private static readonly string[] PoiCreatePermissions =
    [
        PermissionCodes.PoiView,
        PermissionCodes.PoiCreate,
        /* Phase 3 genişlemesi. Kodlar kataloğa SONRADAN eklendiği için matris
           tek başına yetmez: bu roller çoktan provision edilmiştir ve
           `RolePermissionDefaults` onlara bir daha hiç uygulanmaz. Sahiplik
           sınırı değişmez — kodlar yalnızca kendi kayıtlarında yetki verir. */
        PermissionCodes.PoiUpdate,
        PermissionCodes.PoiDelete
    ];

    private static readonly string[] PoiManagePermissions =
    [
        PermissionCodes.PoiView,
        PermissionCodes.PoiCreate,
        PermissionCodes.PoiUpdate,
        PermissionCodes.PoiDelete,
        PermissionCodes.PoiManage,
        PermissionCodes.PoiCategoriesManage
    ];

    private static readonly string[] TransportPermissions =
    [
        PermissionCodes.TransportView,
        PermissionCodes.TransportStopCreate,
        PermissionCodes.TransportStopUpdate,
        PermissionCodes.TransportStopDelete,
        PermissionCodes.TransportStopRestore,
        PermissionCodes.TransportRouteCreate,
        PermissionCodes.TransportRouteUpdate,
        PermissionCodes.TransportRouteDelete,
        PermissionCodes.TransportRouteRestore,
        PermissionCodes.TransportRouteReorder
    ];

    /// <summary>
    /// Uygulanacak genişlemeler. Rol adları yalnızca <b>başlangıç verisi</b>
    /// üretmek için kullanılır; çalışma zamanı yetkilendirmesi hâlâ tamamen
    /// etkin yetki KODLARI üzerinden yürür.
    /// </summary>
    public static readonly IReadOnlyList<Expansion> All =
    [
        new(GisRoles.Administrator,
            [.. GeographyPermissions, .. AuditPermissions, .. HeatmapPermissions, .. PoiManagePermissions,
             .. LocationAnalysisPermissions, .. TransportPermissions]),
        new(GisRoles.GisManager,
            [.. HeatmapPermissions, .. PoiManagePermissions, .. LocationAnalysisPermissions]),
        new(GisRoles.GisAnalyst,
            [.. HeatmapPermissions, .. PoiViewOnly, .. LocationAnalysisPermissions]),
        new(GisRoles.GisEditor, [.. PoiCreatePermissions, .. LocationAnalysisPermissions]),
        new(GisRoles.Viewer, [.. PoiViewOnly, .. LocationAnalysisPermissions])
    ];

    /// <summary>Genişlemelerde geçen tüm kodlar (tekrarsız).</summary>
    public static IReadOnlyList<string> AllCodes { get; } =
        [.. All.SelectMany(e => e.PermissionCodes).Distinct(StringComparer.Ordinal)];
}
