namespace StajProject.Domain.Common;

/// <summary>
/// Kanonik yetki kodları. Yetkilendirme <b>yalnızca</b> bu kodlar üzerinden
/// çalışır; koda dağılmış <c>"drawings.delete"</c> string'leri kullanılmaz ve
/// Türkçe görünen adlar ASLA kimlik olarak kullanılmaz.
/// </summary>
/// <remarks>
/// <para>
/// <b>Kodlar değiştirilemez.</b> Veritabanındaki <c>permissions.code</c>
/// satırları ve onlara bağlı grant kayıtları bu değerlere göre eşleşir; bir
/// kodun yeniden adlandırılması, o yetkiye sahip herkesin yetkisini sessizce
/// kaybetmesi demektir.
/// </para>
/// <para>
/// <b>Kapsam koda gömülmez.</b> <c>drawings.view.own</c> / <c>drawings.view.all</c>
/// gibi türevler bilinçli olarak YOKTUR — kayıt kapsamı ayrı bir eksendir ve
/// sonraki bir fazda ele alınır.
/// </para>
/// </remarks>
public static class PermissionCodes
{
    /* --- Harita ---------------------------------------------------------------- */

    public const string MapView = "map.view";

    /* --- Çizim oluşturma ------------------------------------------------------- */

    public const string DrawingsPointCreate = "drawings.point.create";
    public const string DrawingsLineCreate = "drawings.line.create";
    public const string DrawingsPolygonCreate = "drawings.polygon.create";

    /* --- Çizim yönetimi -------------------------------------------------------- */

    public const string DrawingsView = "drawings.view";
    public const string DrawingsMetadataUpdate = "drawings.metadata.update";
    public const string DrawingsGeometryUpdate = "drawings.geometry.update";
    public const string DrawingsStyleUpdate = "drawings.style.update";
    public const string DrawingsDelete = "drawings.delete";
    public const string DrawingsRestore = "drawings.restore";

    /* --- Araçlar --------------------------------------------------------------- */

    public const string MeasurementUse = "measurement.use";
    public const string SelectionUse = "selection.use";

    /* --- Envanter -------------------------------------------------------------- */

    public const string InventoryView = "inventory.view";
    public const string InventoryAnalysis = "inventory.analysis";

    /* --- Isı haritası ----------------------------------------------------------- */

    /* Isı haritası kendi yetkisidir ve inventory.analysis altına GİZLENMEZ:
       envanter analizi kesişim/dağılım sorgularını çalıştırmaktır; ısı haritası
       ise kişinin kendi kayıtlarının yoğunluğunu, sunucuda üretilmiş bir WMS
       görüntüsü olarak görmektir. İki yetenek ayrı verilebilmelidir — birine
       sahip olmak diğerini ima etmez. */

    public const string HeatmapView = "heatmap.view";

    /* --- Konum analizi ---------------------------------------------------------- */

    /* Konum analizi ÜÇÜNCÜ bir yetenektir ve ne inventory.analysis ne de
       heatmap.view altına gizlenir: envanter analizi kişinin KENDİ çizim
       envanteriyle bir alanın kesişimini sayar; ısı haritası yine KENDİ
       noktalarının yoğunluğunu gösterir; konum analizi ise ORTAK POI
       envanterini, kullanıcının seçtiği kategori ağırlıklarıyla puanlar.
       Üçünün verisi de, kapsamı da farklıdır — birine sahip olmak diğerini
       ima etmemelidir.

       Kod alan-önce/yetenek-sonra yazılır (inventory.analysis ile aynı
       biçim): ilk parça alanı, son parça yeteneği söyler. */

    public const string LocationAnalysis = "location.analysis";

    /* --- Katmanlar ------------------------------------------------------------- */

    public const string LayersView = "layers.view";
    public const string LayersManage = "layers.manage";

    /* --- Kullanıcılar ---------------------------------------------------------- */

    public const string UsersView = "users.view";
    public const string UsersCreate = "users.create";
    public const string UsersUpdate = "users.update";
    public const string UsersDeactivate = "users.deactivate";
    public const string UsersDelete = "users.delete";

    /* --- Roller ---------------------------------------------------------------- */

    public const string RolesView = "roles.view";
    public const string RolesCreate = "roles.create";
    public const string RolesUpdate = "roles.update";
    public const string RolesDelete = "roles.delete";

    /* --- Yetkiler -------------------------------------------------------------- */

    public const string PermissionsView = "permissions.view";
    public const string PermissionsAssign = "permissions.assign";

    /* --- Coğrafi yetkilendirme ------------------------------------------------- */

    /* Coğrafi yetki alanı yönetimi ayrı bir güvenlik yeteneğidir ve bilinçli
       olarak users.update / roles.update altına GİZLENMEZ: coğrafi alan
       yalnızca bir kullanıcı alanı değil, o kullanıcının nerede veri
       üretebileceğini belirleyen bir sınırdır. Kullanıcı düzenleme yetkisinin
       sessizce bu sınırı da kaldırabilmesi, yetki yükseltmeye açık kapı
       bırakırdı. */

    public const string GeographyView = "geography.view";
    public const string GeographyManage = "geography.manage";

    /* --- Denetim --------------------------------------------------------------- */

    /* Aktivite geçmişi kendi yetkisidir ve users.view / permissions.view altına
       GİZLENMEZ: kayıt, kimin neyi ne zaman değiştirdiğini gösterir — yani
       diğer yöneticilerin hareketlerini de. Kullanıcı listesini görebilmek,
       yönetim geçmişini okuyabilmekle aynı şey değildir. */

    public const string ActivityView = "activity.view";

    /* --- POI --------------------------------------------------------------------

       POI yetkileri çizim yetkilerinden AYRIDIR ve onların altına gizlenmez:
       POI, stil taşımayan, sahibine göre gizlenmeyen ve kategori hiyerarşisine
       bağlı ORTAK bir envanterdir. Bir kişinin kendi çizimlerini yönetebilmesi,
       herkesin gördüğü POI envanterine kayıt ekleyebilmesiyle aynı şey
       değildir.

       Görüntüleme ve yönetim de ayrılır: haritada pin görmek ile kimin neyi
       eklediğini listeleyebilmek farklı yeteneklerdir (activity.view ile aynı
       gerekçe). Kategori yönetimi ise üçüncü bir eksendir — herkesin
       sınıflandırma yapmak zorunda olduğu taksonomiyi tanımlamak, kayıtları
       gözden geçirmekten başka bir otoritedir. */

    public const string PoiView = "poi.view";
    public const string PoiCreate = "poi.create";

    /* Güncelleme ve silme, oluşturmadan AYRI kodlardır ve `poi.create` üzerine
       yüklenmez: bir noktayı eklemek ile başkasının da göreceği ortak
       envanterdeki bir kaydı değiştirmek/kaldırmak farklı yeteneklerdir.

       İkisi de SAHİPLİK ile birlikte okunur — kod "kendi kaydında" yetki
       verir; herkesin kaydına yetki veren tek şey `poi.manage`'dir. Bu ayrım
       kodun kendisinde değil, servis katmanındaki sahiplik denetimindedir:
       yetki "ne yapabilir", sahiplik "hangi kayıtta" sorusunu yanıtlar. */

    public const string PoiUpdate = "poi.update";
    public const string PoiDelete = "poi.delete";

    public const string PoiManage = "poi.manage";
    public const string PoiCategoriesManage = "poi.categories.manage";

    /* --- Akıllı ulaşım -------------------------------------------------------- */

    public const string TransportView = "transport.view";

    public const string TransportStopCreate = "transport.stop.create";
    public const string TransportStopUpdate = "transport.stop.update";
    public const string TransportStopDelete = "transport.stop.delete";
    public const string TransportStopRestore = "transport.stop.restore";

    public const string TransportRouteCreate = "transport.route.create";
    public const string TransportRouteUpdate = "transport.route.update";
    public const string TransportRouteDelete = "transport.route.delete";
    public const string TransportRouteRestore = "transport.route.restore";
    public const string TransportRouteReorder = "transport.route.reorder";

    /* Simülasyon başlatmak, rota verisini DEĞİŞTİRMEZ: bu yüzden
       `transport.route.update` üzerine yüklenmez, ayrı bir kod olur. Ayrım
       operasyoneldir — bir kullanıcı hattı canlı işletebilirken güzergahın
       kendisini yeniden hesaplayamayabilir; tersi de mümkündür.

       Görüntüleme yetkisi de İMA ETMEZ: haritada aracın nerede olduğunu
       görmek `transport.view` ile olur, hattı çalıştırmak bu kodla. */
    public const string TransportSimulationStart = "transport.simulation.start";

    /// <summary>EF <c>HasMaxLength</c> ile aynı sınır.</summary>
    public const int MaxLength = 128;
}
