namespace StajProject.Domain.Common;

/// <summary>
/// Sistemin tanıdığı yetkilerin <b>tek tanımı</b>: kod, görünen ad, açıklama,
/// kategori ve gösterim sırası. Seed bu listeden çalışır; testler de aynı
/// listeye bakar, dolayısıyla katalog ile veritabanı ayrışamaz.
/// </summary>
/// <remarks>
/// <para>
/// Liste kasıtlı olarak <b>anlamlı yeteneklerden</b> oluşur. Arayüz hareketleri
/// (yakınlaştırma, panel açma, tema değiştirme) yetki DEĞİLDİR; onları katalog
/// içine almak, güvenlik modelini bir arayüz envanterine dönüştürürdü.
/// </para>
/// <para>
/// Bazı yetkiler (örneğin katman yönetimi) henüz karşılığı olan bir uca sahip
/// olmayabilir. Katalog ileriye dönük olarak eksiksiz tutulur: yetki tanımının
/// var olması bir erişim açmaz — erişim, ancak sonraki fazda uygulanacak
/// denetimle anlam kazanır.
/// </para>
/// </remarks>
public static class PermissionCatalog
{
    /// <summary>
    /// Katalogdaki tek bir yetki tanımı. Veritabanı satırının kaynağıdır.
    /// </summary>
    /// <param name="Code">Kanonik kod — kimlik budur.</param>
    /// <param name="Name">Arayüzde gösterilen Türkçe ad.</param>
    /// <param name="Description">Yetkinin neye izin verdiği.</param>
    /// <param name="Category">Gruplama etiketi.</param>
    /// <param name="SortOrder">Kategori içindeki gösterim sırası.</param>
    public sealed record Definition(
        string Code,
        string Name,
        string Description,
        string Category,
        int SortOrder);

    /// <summary>
    /// Kanonik katalog. Sıra, yetki yönetimi ekranındaki gösterim sırasıdır.
    /// </summary>
    public static readonly IReadOnlyList<Definition> All =
    [
        /* --- Harita ------------------------------------------------------------ */

        new(PermissionCodes.MapView,
            "Haritayı Görüntüleme",
            "Harita uygulamasını açabilir ve harita üzerindeki verileri görüntüleyebilir.",
            PermissionCategories.Map, 100),

        /* --- Çizim oluşturma --------------------------------------------------- */

        new(PermissionCodes.DrawingsPointCreate,
            "Nokta Ekleme",
            "Harita üzerinde yeni nokta geometrisi oluşturabilir.",
            PermissionCategories.DrawingCreate, 200),

        new(PermissionCodes.DrawingsLineCreate,
            "Çizgi Ekleme",
            "Harita üzerinde yeni çizgi geometrisi oluşturabilir.",
            PermissionCategories.DrawingCreate, 210),

        new(PermissionCodes.DrawingsPolygonCreate,
            "Poligon Ekleme",
            "Harita üzerinde yeni poligon geometrisi oluşturabilir.",
            PermissionCategories.DrawingCreate, 220),

        /* --- Çizim yönetimi ---------------------------------------------------- */

        new(PermissionCodes.DrawingsView,
            "Çizimleri Görüntüleme",
            "Kayıtlı çizimleri listeleyebilir ve detaylarını görebilir.",
            PermissionCategories.DrawingManagement, 300),

        new(PermissionCodes.DrawingsMetadataUpdate,
            "Çizim Bilgilerini Düzenleme",
            "Çizimin adını, açıklamasını, kategorisini ve etiketlerini değiştirebilir.",
            PermissionCategories.DrawingManagement, 310),

        new(PermissionCodes.DrawingsGeometryUpdate,
            "Çizim Geometrisini Düzenleme",
            "Mevcut bir çizimin geometrisini harita üzerinde değiştirebilir.",
            PermissionCategories.DrawingManagement, 320),

        new(PermissionCodes.DrawingsStyleUpdate,
            "Çizim Stilini Düzenleme",
            "Çizimin rengini, kalınlığını, dolgusunu ve çizgi stilini değiştirebilir.",
            PermissionCategories.DrawingManagement, 330),

        new(PermissionCodes.DrawingsDelete,
            "Çizim Silme",
            "Çizimi çöp kutusuna taşıyabilir.",
            PermissionCategories.DrawingManagement, 340),

        new(PermissionCodes.DrawingsRestore,
            "Çizim Geri Yükleme",
            "Çöp kutusundaki bir çizimi geri getirebilir.",
            PermissionCategories.DrawingManagement, 350),

        /* --- Araçlar ----------------------------------------------------------- */

        new(PermissionCodes.MeasurementUse,
            "Ölçüm Araçlarını Kullanma",
            "Harita üzerinde uzunluk ve alan ölçümü yapabilir.",
            PermissionCategories.Tools, 400),

        new(PermissionCodes.SelectionUse,
            "Seçim Araçlarını Kullanma",
            "Harita üzerindeki kayıtları seçim araçlarıyla seçebilir.",
            PermissionCategories.Tools, 410),

        /* --- Envanter ---------------------------------------------------------- */

        new(PermissionCodes.InventoryView,
            "Envanteri Görüntüleme",
            "Envanter kayıtlarını ve özetlerini görüntüleyebilir.",
            PermissionCategories.Inventory, 500),

        new(PermissionCodes.InventoryAnalysis,
            "Envanter Analizi",
            "Envanter üzerinde kesişim ve dağılım analizlerini çalıştırabilir.",
            PermissionCategories.Inventory, 510),

        /* --- Isı haritası ------------------------------------------------------ */

        new(PermissionCodes.HeatmapView,
            "Isı Haritası Görüntüleme",
            "Isı haritası analizini açabilir ve kendi kayıtlarının yoğunluk görüntüsünü görebilir.",
            PermissionCategories.Heatmap, 550),

        /* --- Konum analizi -----------------------------------------------------

           Kategori YENİ DEĞİLDİR: konum analizinin çıktısı da bir yoğunluk
           haritasıdır, dolayısıyla yetki ekranında ısı haritasının yanında
           okunur. Kategori yalnızca GÖSTERİM grubudur — hiçbir yetkilendirme
           kararı ona bakarak verilmez ve iki kod tamamen ayrıdır.

           Sıra numarası 550 ile 600 arasındaki boşluğa girer; mevcut hiçbir
           satır yeniden numaralanmaz. */

        new(PermissionCodes.LocationAnalysis,
            "Konum Analizi",
            "Bir analiz alanı seçip POI kategorilerini ağırlıklandırarak konum analizi çalıştırabilir.",
            PermissionCategories.Heatmap, 560),

        /* --- Katmanlar --------------------------------------------------------- */

        new(PermissionCodes.LayersView,
            "Katmanları Görüntüleme",
            "Harita katmanlarını görebilir ve görünürlüklerini değiştirebilir.",
            PermissionCategories.Layers, 600),

        new(PermissionCodes.LayersManage,
            "Katman Yönetimi",
            "Katman tanımlarını ekleyebilir, düzenleyebilir ve kaldırabilir.",
            PermissionCategories.Layers, 610),

        /* --- Kullanıcılar ------------------------------------------------------ */

        new(PermissionCodes.UsersView,
            "Kullanıcıları Görüntüleme",
            "Kullanıcı listesini ve hesap detaylarını görüntüleyebilir.",
            PermissionCategories.Users, 700),

        new(PermissionCodes.UsersCreate,
            "Kullanıcı Ekleme",
            "Yeni kullanıcı hesabı oluşturabilir.",
            PermissionCategories.Users, 710),

        new(PermissionCodes.UsersUpdate,
            "Kullanıcı Güncelleme",
            "Kullanıcı hesap bilgilerini güncelleyebilir.",
            PermissionCategories.Users, 720),

        new(PermissionCodes.UsersDeactivate,
            "Kullanıcı Devre Dışı Bırakma",
            "Bir hesabın uygulamaya girişini kapatabilir veya yeniden açabilir.",
            PermissionCategories.Users, 730),

        new(PermissionCodes.UsersDelete,
            "Kullanıcı Silme",
            "Bir kullanıcı hesabını silinmiş olarak işaretleyebilir.",
            PermissionCategories.Users, 740),

        /* --- Roller ------------------------------------------------------------ */

        new(PermissionCodes.RolesView,
            "Rolleri Görüntüleme",
            "Tanımlı rolleri ve rol detaylarını görüntüleyebilir.",
            PermissionCategories.Roles, 800),

        new(PermissionCodes.RolesCreate,
            "Rol Ekleme",
            "Yeni rol tanımlayabilir.",
            PermissionCategories.Roles, 810),

        new(PermissionCodes.RolesUpdate,
            "Rol Güncelleme",
            "Mevcut bir rolün tanımını güncelleyebilir.",
            PermissionCategories.Roles, 820),

        new(PermissionCodes.RolesDelete,
            "Rol Silme",
            "Bir rol tanımını kaldırabilir.",
            PermissionCategories.Roles, 830),

        /* --- Yetkiler ---------------------------------------------------------- */

        new(PermissionCodes.PermissionsView,
            "Yetkileri Görüntüleme",
            "Yetki kataloğunu ve rol/kullanıcı yetki dağılımını görüntüleyebilir.",
            PermissionCategories.Permissions, 900),

        new(PermissionCodes.PermissionsAssign,
            "Yetki Atama",
            "Rollere ve kullanıcılara yetki verebilir veya geri alabilir.",
            PermissionCategories.Permissions, 910),

        /* --- Coğrafi yetkilendirme --------------------------------------------- */

        new(PermissionCodes.GeographyView,
            "Coğrafi Yetkileri Görüntüleme",
            "Kullanıcı ve rol bazlı coğrafi yetki alanlarını görüntüleme yetkisi.",
            PermissionCategories.Geography, 1000),

        new(PermissionCodes.GeographyManage,
            "Coğrafi Yetkileri Yönetme",
            "Kullanıcı ve rol bazlı coğrafi yetki alanlarını oluşturma, düzenleme ve kaldırma yetkisi.",
            PermissionCategories.Geography, 1010),

        /* --- Denetim ------------------------------------------------------------ */

        new(PermissionCodes.ActivityView,
            "Aktivite Geçmişini Görüntüleme",
            "Sistemde yapılan yönetim ve çizim işlemlerinin kaydını görüntüleyebilir.",
            PermissionCategories.Audit, 1100),

        /* --- POI ---------------------------------------------------------------

           Sıra numaraları katalogdaki mevcut en büyük değerin (1100) ÜSTÜNDEN
           devam eder; hiçbir mevcut yetki yeniden numaralanmaz. Yeniden
           numaralamak, yalnızca gösterim sırası için tüm katalog satırlarını
           güncellemek demek olurdu. */

        new(PermissionCodes.PoiView,
            "POI Görüntüleme",
            "Haritadaki aktif POI'leri görüntüleyebilir ve bilgi panelinde açabilir.",
            PermissionCategories.Poi, 1200),

        new(PermissionCodes.PoiCreate,
            "POI Ekleme",
            "Harita üzerinde yeni POI oluşturabilir.",
            PermissionCategories.Poi, 1210),

        /* Sahiplik burada YAZILI DEĞİLDİR ve bilinçlidir: katalog "ne
           yapabilir"i tanımlar, "hangi kayıtta"yı değil. Kendi kaydı / herkesin
           kaydı ayrımı servis katmanındaki sahiplik denetimindedir. */

        new(PermissionCodes.PoiUpdate,
            "POI Düzenleme",
            "Kendi eklediği POI kayıtlarının adını, kategorisini ve mesai saatlerini güncelleyebilir.",
            PermissionCategories.Poi, 1212),

        new(PermissionCodes.PoiDelete,
            "POI Silme",
            "Kendi eklediği POI kayıtlarını çöp kutusuna gönderebilir ve oradan geri yükleyebilir.",
            PermissionCategories.Poi, 1214),

        new(PermissionCodes.PoiManage,
            "POI Yönetimi",
            "Yönetim panelinde tüm POI kayıtlarını listeleyebilir; kim eklemiş olursa olsun düzenleyebilir, silebilir ve geri yükleyebilir.",
            PermissionCategories.Poi, 1220),

        new(PermissionCodes.PoiCategoriesManage,
            "POI Kategori Yönetimi",
            "POI kategori hiyerarşisini oluşturabilir ve düzenleyebilir.",
            PermissionCategories.Poi, 1230),

        /* --- Akıllı ulaşım ---------------------------------------------------- */

        new(PermissionCodes.TransportView,
            "Ulaşım Ağını Görüntüleme",
            "Ulaşım rotalarını ve aktif duraklarını görüntüleyebilir.",
            PermissionCategories.Transport, 1300),

        new(PermissionCodes.TransportStopCreate,
            "Ulaşım Durağı Ekleme",
            "Bir ulaşım rotasına yeni durak ekleyebilir.",
            PermissionCategories.Transport, 1310),

        new(PermissionCodes.TransportStopUpdate,
            "Ulaşım Durağı Düzenleme",
            "Ulaşım durağının bilgilerini ve konumunu düzenleyebilir.",
            PermissionCategories.Transport, 1320),

        new(PermissionCodes.TransportStopDelete,
            "Ulaşım Durağı Silme",
            "Ulaşım durağını çöp kutusuna taşıyabilir.",
            PermissionCategories.Transport, 1330),

        new(PermissionCodes.TransportStopRestore,
            "Ulaşım Durağı Geri Yükleme",
            "Çöp kutusundaki ulaşım durağını geri yükleyebilir.",
            PermissionCategories.Transport, 1340),

        new(PermissionCodes.TransportRouteCreate,
            "Ulaşım Rotası Ekleme",
            "Yeni ulaşım rotası oluşturabilir.",
            PermissionCategories.Transport, 1350),

        new(PermissionCodes.TransportRouteUpdate,
            "Ulaşım Rotası Düzenleme",
            "Ulaşım rotasının bilgilerini düzenleyebilir.",
            PermissionCategories.Transport, 1360),

        new(PermissionCodes.TransportRouteDelete,
            "Ulaşım Rotası Silme",
            "Ulaşım rotasını çöp kutusuna taşıyabilir.",
            PermissionCategories.Transport, 1370),

        new(PermissionCodes.TransportRouteRestore,
            "Ulaşım Rotası Geri Yükleme",
            "Çöp kutusundaki ulaşım rotasını geri yükleyebilir.",
            PermissionCategories.Transport, 1380),

        new(PermissionCodes.TransportRouteReorder,
            "Ulaşım Rotası Duraklarını Sıralama",
            "Bir rotadaki durakların sırasını değiştirebilir.",
            PermissionCategories.Transport, 1390)
    ];

    /// <summary>Katalogdaki tüm kodlar.</summary>
    public static IReadOnlyList<string> AllCodes { get; } =
        All.Select(p => p.Code).ToArray();
}
