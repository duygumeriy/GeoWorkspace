namespace StajProject.Domain.Common;

/// <summary>
/// POI kategori taksonomisinin <b>tek tanımı</b>: slug, görünen ad, üst
/// kategori, simge ve renk. Seeder bu listeden çalışır; testler de aynı listeye
/// bakar, dolayısıyla katalog ile veritabanı ayrışamaz.
/// </summary>
/// <remarks>
/// <para>
/// <b>Kimlik SLUG'dır, veritabanı kimliği DEĞİLDİR.</b> Katalogda hiçbir
/// <c>id</c> geçmez ve geçmemelidir: kimlikler identity kolonundan üretilir,
/// ortamdan ortama farklıdır ve kataloğa yazılsalardı seeder'ı tek bir
/// veritabanının kopyasına bağlarlardı. Eşleşme her zaman slug üzerindendir.
/// </para>
/// <para>
/// <b>Üst kategori de slug ile gösterilir.</b> Bu yüzden seeder iki geçişlidir:
/// kökler eklenip kimlikleri üretilmeden çocukların <c>parent_id</c>'si
/// bilinemez (bkz. <c>PoiCategoryTaxonomySeeder</c>).
/// </para>
/// <para>
/// <b>Katalog, yöneticinin kararlarını EZMEZ.</b> Buradaki <see cref="Name"/>
/// ve <see cref="ParentSlug"/> yalnızca <i>ilk oluşturmada</i> uygulanır; var
/// olan bir satırın adı ya da üstü sonradan yönetici tarafından
/// değiştirilmişse seeder ona dokunmaz. Yalnızca sunum metadatası
/// (simge/renk) tazelenir — onların tek kaynağı burasıdır ve haritanın
/// tutarlılığı buna bağlıdır.
/// </para>
/// </remarks>
public static class PoiCategoryTaxonomy
{
    /// <summary>
    /// Katalogdaki tek bir kategori tanımı.
    /// </summary>
    /// <param name="Slug">Kanonik teknik kimlik — eşleşme budur.</param>
    /// <param name="Name">Arayüzde gösterilen Türkçe ad (yalnızca ilk oluşturmada).</param>
    /// <param name="ParentSlug">Üst kategorinin slug'ı; kök kategorilerde <c>null</c>.</param>
    /// <param name="IconKey"><see cref="PoiCategoryIcons"/> içindeki anahtar.</param>
    /// <param name="ColorHex">Kanonik <c>#RRGGBB</c>.</param>
    public sealed record Definition(
        string Slug,
        string Name,
        string? ParentSlug,
        string IconKey,
        string ColorHex);

    /// <summary>
    /// Kanonik taksonomi: 27 kök + 17 alt kategori = 44.
    /// </summary>
    /// <remarks>
    /// <c>yeme-icme</c>, <c>kafe</c>, <c>restoran</c>, <c>eglence-yerleri</c> ve
    /// <c>konser-alani</c> katalogda yer alır ama <b>zaten mevcut</b> satırlara
    /// karşılık gelir: göç (migration) onları yerinde adlandırır ve metadatasını
    /// doldurur. Seeder onları slug ile bulur ve YENİDEN OLUŞTURMAZ.
    /// </remarks>
    public static readonly IReadOnlyList<Definition> All =
    [
        /* --- Kök kategoriler ---------------------------------------------------- */

        new("ticaret-alanlari", "Ticaret Alanları", null, "store", PoiCategoryPalette.Commerce),
        new("alisveris", "Alışveriş", null, "shopping-bag", PoiCategoryPalette.Commerce),
        new("enerji-uretim-dagitim", "Enerji Üretim ve Dağıtım", null, "zap", PoiCategoryPalette.EducationEnergy),
        new("eglence-yerleri", "Eğlence Yerleri", null, "party-popper", PoiCategoryPalette.Social),
        new("konut-alanlari", "Konut Alanları", null, "house", PoiCategoryPalette.Transport),
        new("kulturel-tesisler", "Kültürel Tesisler", null, "landmark", PoiCategoryPalette.Culture),
        new("altyapi-hizmetleri", "Su, Kanalizasyon ve Çöp", null, "recycle", PoiCategoryPalette.Finance),
        new("saglik-kurumlari", "Sağlık Kurumları", null, "hospital", PoiCategoryPalette.Health),
        new("egitim-kurumlari", "Eğitim Kurumları", null, "graduation-cap", PoiCategoryPalette.EducationEnergy),
        new("telekomunikasyon", "Telekomünikasyon", null, "radio-tower", PoiCategoryPalette.Transport),
        new("tarimsal-uretim", "Tarımsal Üretim Alanları", null, "wheat", PoiCategoryPalette.Nature),
        new("sanayi-uretim", "Sanayi ve Üretim Alanları", null, "factory", PoiCategoryPalette.Government),
        new("yesil-alanlar", "Yeşil Alanlar", null, "trees", PoiCategoryPalette.Nature),
        new("karayolu", "Karayolu", null, "route", PoiCategoryPalette.Transport),
        new("resmi-kurum", "Resmi Kurum", null, "building-2", PoiCategoryPalette.Government),
        new("askeri-kurumlar", "Askeri Kurumlar", null, "shield", PoiCategoryPalette.Government),
        new("demiryolu", "Demiryolu", null, "train", PoiCategoryPalette.Government),
        new("finansal-kurumlar", "Finansal Kurumlar", null, "badge-dollar-sign", PoiCategoryPalette.Finance),
        new("tarihi-turistik", "Tarihi ve Turistik Tesisler", null, "castle", PoiCategoryPalette.Culture),
        new("onemli-noktalar", "Önemli Noktalar", null, "map-pin", PoiCategoryPalette.Commerce),
        new("spor-tesisleri", "Spor Tesisleri", null, "dumbbell", PoiCategoryPalette.Transport),
        new("sivil-toplum", "Sivil Toplum Örgütleri", null, "users", PoiCategoryPalette.Finance),
        new("sosyal-kurumlar", "Sosyal Amaçlı Kurumlar", null, "heart-handshake", PoiCategoryPalette.Social),
        new("yeme-icme", "Yeme-İçme Yerleri", null, "utensils", PoiCategoryPalette.Food),
        new("dini-tesisler", "Dini Tesisler", null, "church", PoiCategoryPalette.Culture),
        new("havayolu", "Havayolu", null, "plane", PoiCategoryPalette.Transport),
        new("denizyolu", "Denizyolu", null, "ship", PoiCategoryPalette.Transport),

        /* --- Mevcut alt kategoriler (göç tarafından adlandırılır) ---------------- */

        new("kafe", "Kafe", "yeme-icme", "coffee", PoiCategoryPalette.Food),
        new("restoran", "Restoran", "yeme-icme", "utensils-crossed", PoiCategoryPalette.Food),
        new("konser-alani", "Konser Alanı", "eglence-yerleri", "music", PoiCategoryPalette.Social),

        /* --- Yeni alt kategoriler ----------------------------------------------- */

        new("banka-ve-atm", "Banka ve ATM", "finansal-kurumlar", "banknote", PoiCategoryPalette.Finance),
        new("epdk", "EPDK", "resmi-kurum", "gauge", PoiCategoryPalette.Government),
        new("eczane", "Eczane", "saglik-kurumlari", "pill", PoiCategoryPalette.Health),
        new("arac-sarj-istasyonlari", "Araç Şarj İstasyonları", "enerji-uretim-dagitim", "battery-charging", PoiCategoryPalette.EducationEnergy),
        new("okullar", "Okullar", "egitim-kurumlari", "school", PoiCategoryPalette.EducationEnergy),
        new("otomotiv-sektoru", "Otomotiv Sektörü", "ticaret-alanlari", "car", PoiCategoryPalette.Commerce),
        new("mobilyacilar", "Mobilyacılar", "alisveris", "armchair", PoiCategoryPalette.Commerce),
        new("zincir-marketler", "Zincir Marketler", "alisveris", "shopping-cart", PoiCategoryPalette.Commerce),
        new("giyim-magazalari", "Giyim Mağazaları", "alisveris", "shirt", PoiCategoryPalette.Commerce),
        new("elektronik-marketler", "Elektronik Marketler", "alisveris", "monitor", PoiCategoryPalette.Commerce),
        new("emlakcilar", "Emlakçılar", "ticaret-alanlari", "key-round", PoiCategoryPalette.Commerce),
        new("yapi-marketleri", "Yapı Marketleri", "alisveris", "hammer", PoiCategoryPalette.Commerce),
        new("arac-kiralama", "Araç Kiralama", "ticaret-alanlari", "car-front", PoiCategoryPalette.Commerce),
        new("ayakkabi-terlik-canta", "Ayakkabı / Terlik / Çanta", "alisveris", "shopping-basket", PoiCategoryPalette.Commerce)
    ];

    /// <summary>Kök tanımlar; seeder'ın birinci geçişi.</summary>
    public static IEnumerable<Definition> Roots => All.Where(item => item.ParentSlug is null);

    /// <summary>Alt kategori tanımları; seeder'ın ikinci geçişi.</summary>
    public static IEnumerable<Definition> Children => All.Where(item => item.ParentSlug is not null);
}
