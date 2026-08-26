namespace StajProject.OsmPoiImporter;

/// <summary>
/// Tek bir eşleme kuralı: OSM etiketi → kanonik kategori slug'ı.
/// </summary>
/// <param name="Key">OSM etiket anahtarı (<c>amenity</c>).</param>
/// <param name="Value">
/// Etiket değeri (<c>pharmacy</c>). <c>null</c> ise anahtarın HERHANGİ bir
/// değeri eşleşir (<c>healthcare=*</c>) ve kural daha az özeldir.
/// </param>
/// <param name="Slug">
/// Kanonik kategori slug'ı. <b>Sayısal kimlik ya da görünen ad ASLA
/// kullanılmaz:</b> kimlikler ortama özeldir, adlar yönetim ekranından
/// değiştirilebilir; slug bir kez üretilir ve değişmez.
/// </param>
/// <param name="AreaEligible">
/// Kural, alan olarak (kapalı yol / çok parçalı ilişki) çizilebilen bir TESİSİ
/// temsil ediyor mu. <c>false</c> ise yalnızca düğümler kabul edilir.
/// </param>
/// <param name="Priority">
/// Kuralın önceliği; verilmezse <see cref="OsmCategoryRule.ExactTag"/> (tam
/// değer) ya da <see cref="OsmCategoryRule.Wildcard"/> (joker) varsayılır.
/// <b>Yalnızca gerçek veriyle desteklenen tekil kurallarda</b> açıkça
/// düşürülür — bkz. <see cref="OsmCategoryRule.Contextual"/>.
/// </param>
public sealed record OsmCategoryRule(
    string Key,
    string? Value,
    string Slug,
    bool AreaEligible,
    int? Priority = null)
{
    /// <summary>Tam değer eşleşmesi (<c>amenity=pharmacy</c>).</summary>
    public const int ExactTag = 100;

    /// <summary>
    /// Nesnenin KİMLİĞİNİ değil BAĞLAMINI anlatan tam değer eşleşmesi.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Bazı etiketler tam değerdir ama nesnenin ne OLDUĞUNU söylemez; ne
    /// gibi bir çevresi ya da arazi kullanımı olduğunu söyler. Adı "Çankaya
    /// Köşkü" olan bir <c>office=government</c> nesnesine eklenen
    /// <c>leisure=garden</c>, o nesneyi bir bahçeye çevirmez — bahçe, kurumun
    /// arazisidir.
    /// </para>
    /// <para>
    /// <b>Etiket ANAHTARINA göre otomatik bir kural DEĞİLDİR.</b> "leisure her
    /// zaman kaybeder" gibi bir varsayım <c>leisure=park</c> ve
    /// <c>leisure=stadium</c> için yanlış olurdu; onlar kendi başlarına birer
    /// tesistir ve önceliklerine DOKUNULMAZ. Düşürme, kural kural ve gerçek
    /// veriyle gerekçelendirilerek yapılır.
    /// </para>
    /// </remarks>
    public const int Contextual = 75;

    /// <summary>Joker eşleşme (<c>healthcare=*</c>).</summary>
    public const int Wildcard = 50;

    /// <summary>
    /// Sıralama değeri: açıkça verilmişse o, yoksa tam değer/joker varsayılanı.
    /// </summary>
    /// <remarks>
    /// Sayı yalnızca SIRALAMA içindir; aritmetiği anlamlı değildir. Eşleyici
    /// bu değeri karşılaştırmaktan başka bir şey yapmaz — etiket adına bakan
    /// gizli bir kural yoktur.
    /// </remarks>
    public int Specificity => Priority ?? (Value is null ? Wildcard : ExactTag);

    public bool Matches(IReadOnlyDictionary<string, string> tags) =>
        tags.TryGetValue(Key, out var value)
        && (Value is null || string.Equals(Value, value, StringComparison.Ordinal));
}

/// <summary>
/// OSM etiketleri ile kanonik taksonomi arasındaki <b>tek</b> eşleme tanımı.
/// </summary>
/// <remarks>
/// <para>
/// <b>Bildirimsel bir tablodur, if/else zinciri DEĞİLDİR.</b> Kurallar veri
/// olduğu için test edilebilir, sayılabilir ve gözden geçirilebilir; bir
/// zincirde ise sıra sessizce anlam taşır ve gözden kaçan bir dal bir
/// kategoriyi ölü bırakırdı.
/// </para>
/// <para>
/// <b>EN ÖZEL kategori hedeflenir.</b> <c>amenity=cafe</c> → <c>kafe</c>'dir,
/// üst kategorisi <c>yeme-icme</c> DEĞİL: konum analizi bir üst kategori
/// seçildiğinde alt ağacı zaten genişletir (Phase 2B). Umbrella kategorilere
/// yazmak, hem alt kategorileri boş bırakır hem de üst seçimini iki kez
/// saydırırdı.
/// </para>
/// <para>
/// <b>Emin olunmayan kategori BOŞ bırakılır.</b> Satır sayısını artırmak için
/// veri zorlanmaz ve <c>onemli-noktalar</c> gibi bir "çöp" yedeği YOKTUR:
/// eşlenemeyen bir nesne atlanır ve istatistikte sayılır. Kapsam dışı bırakılan
/// kategorilerin gerekçesi <see cref="DeliberatelyUnmapped"/> içindedir.
/// </para>
/// </remarks>
public static class OsmCategoryMap
{
    /// <summary>Kaynak adı; <c>analysis_poi.source</c> değeri.</summary>
    public const string SourceName = "osm";

    /// <summary>
    /// Uygulanan kurallar. Sıra ANLAM TAŞIMAZ — çözüm özgüllük ve taksonomi
    /// hiyerarşisiyle yapılır (bkz. <see cref="OsmCategoryMapper"/>).
    /// </summary>
    public static readonly IReadOnlyList<OsmCategoryRule> Rules =
    [
        /* --- Yüksek güven: birebir karşılığı olan tekil etiketler ------------- */

        new("amenity", "pharmacy", "eczane", AreaEligible: true),
        new("amenity", "school", "okullar", AreaEligible: true),
        new("amenity", "cafe", "kafe", AreaEligible: true),
        new("amenity", "restaurant", "restoran", AreaEligible: true),
        new("amenity", "charging_station", "arac-sarj-istasyonlari", AreaEligible: false),
        new("amenity", "place_of_worship", "dini-tesisler", AreaEligible: true),
        new("amenity", "car_rental", "arac-kiralama", AreaEligible: true),
        new("shop", "clothes", "giyim-magazalari", AreaEligible: true),
        new("shop", "furniture", "mobilyacilar", AreaEligible: true),
        new("office", "estate_agent", "emlakcilar", AreaEligible: true),

        /* --- Banka ve ATM: tek kategori, iki etiket --------------------------- */

        new("amenity", "bank", "banka-ve-atm", AreaEligible: true),
        new("amenity", "atm", "banka-ve-atm", AreaEligible: false),

        /* --- Eğitim: `okullar` alt kategorisinin DIŞINDA kalanlar -------------
           Üniversite ve anaokulu "okullar" değildir; kök kategoriye yazılırlar
           ve konum analizi kökü seçtiğinde `okullar` ile birlikte sayılırlar. */

        new("amenity", "university", "egitim-kurumlari", AreaEligible: true),
        new("amenity", "college", "egitim-kurumlari", AreaEligible: true),
        new("amenity", "kindergarten", "egitim-kurumlari", AreaEligible: true),

        /* --- Sağlık: `eczane` DIŞINDAKİ tesisler ------------------------------
           `healthcare=*` joker kuraldır ve `amenity=pharmacy` ile aynı nesnede
           eşleşebilir; özgüllük kuralı eczaneyi kazandırır. */

        new("amenity", "hospital", "saglik-kurumlari", AreaEligible: true),
        new("amenity", "clinic", "saglik-kurumlari", AreaEligible: true),
        new("amenity", "doctors", "saglik-kurumlari", AreaEligible: true),
        new("amenity", "dentist", "saglik-kurumlari", AreaEligible: true),
        new("healthcare", null, "saglik-kurumlari", AreaEligible: true),

        /* --- Spor tesisleri --------------------------------------------------- */

        new("leisure", "sports_centre", "spor-tesisleri", AreaEligible: true),
        new("leisure", "fitness_centre", "spor-tesisleri", AreaEligible: true),
        new("leisure", "stadium", "spor-tesisleri", AreaEligible: true),
        new("leisure", "pitch", "spor-tesisleri", AreaEligible: true),

        /* --- Yeşil alanlar ----------------------------------------------------
           `landuse=grass` ve `landuse=forest` bilinçli olarak YOKTUR: ikisi de
           bir tesis değil, arazi örtüsüdür ve yoğunluk analizinde bir "ilgi
           noktası" gibi sayılmamalıdır. */

        new("leisure", "park", "yesil-alanlar", AreaEligible: true),

        /* `leisure=garden` BAĞLAMSAL önceliktedir. Ankara çıkarımındaki beş
           gerçek örnekte de bir kurumun ARAZİSİNİ anlatıyordu — çevresi duvar
           ya da çitle çevrili bir devlet kurumu, bir cami, bir sosyal tesis.
           Bir bahçesi olması, o nesneyi bir yeşil alan yapmaz.

           `leisure=park` ve aşağıdaki spor tesisi kuralları DEĞİŞMEDİ: onlar
           kendi başlarına birer tesistir. Düşürülen tek kural budur. */
        new("leisure", "garden", "yesil-alanlar", AreaEligible: true,
            Priority: OsmCategoryRule.Contextual),

        /* --- Tarihi ve turistik ------------------------------------------------ */

        new("tourism", "museum", "tarihi-turistik", AreaEligible: true),

        /* `tourism=attraction` BAĞLAMSAL önceliktedir: kendi başına bir tesis
           türü söylemez, "burası ziyaretçi çeker" der ve OSM'de çoğunlukla
           BAŞKA bir birincil etiketin üzerine eklenir. Kocatepe Camii
           (relation/6276462) hem `amenity=place_of_worship` hem
           `tourism=attraction` taşır; nesnenin kimliği camidir.

           `tourism=museum` DEĞİŞMEDİ — bir müze kendi başına bir tesistir. */
        new("tourism", "attraction", "tarihi-turistik", AreaEligible: true,
            Priority: OsmCategoryRule.Contextual),
        new("historic", null, "tarihi-turistik", AreaEligible: true),

        /* --- Kültürel tesisler -------------------------------------------------
           `konser-alani` KULLANILMAZ: `amenity=theatre` bir konser alanı
           değildir ve OSM'de konser mekânı için yerleşmiş, güvenilir bir
           etiket yoktur (bkz. DeliberatelyUnmapped). */

        new("amenity", "theatre", "kulturel-tesisler", AreaEligible: true),
        new("amenity", "cinema", "kulturel-tesisler", AreaEligible: true),
        new("amenity", "library", "kulturel-tesisler", AreaEligible: true),
        new("amenity", "arts_centre", "kulturel-tesisler", AreaEligible: true),

        /* --- Alışveriş alt kategorileri ---------------------------------------- */

        new("shop", "shoes", "ayakkabi-terlik-canta", AreaEligible: true),
        new("shop", "bag", "ayakkabi-terlik-canta", AreaEligible: true),
        new("shop", "electronics", "elektronik-marketler", AreaEligible: true),
        new("shop", "computer", "elektronik-marketler", AreaEligible: true),
        new("shop", "doityourself", "yapi-marketleri", AreaEligible: true),
        new("shop", "hardware", "yapi-marketleri", AreaEligible: true),

        /* --- Otomotiv ---------------------------------------------------------- */

        new("shop", "car", "otomotiv-sektoru", AreaEligible: true),
        new("shop", "car_repair", "otomotiv-sektoru", AreaEligible: true),
        new("shop", "car_parts", "otomotiv-sektoru", AreaEligible: true),
        new("amenity", "fuel", "otomotiv-sektoru", AreaEligible: true),

        /* --- Finans (banka/ATM DIŞI) ------------------------------------------- */

        new("office", "insurance", "finansal-kurumlar", AreaEligible: true),
        new("amenity", "bureau_de_change", "finansal-kurumlar", AreaEligible: false),

        /* --- Resmî kurum ------------------------------------------------------- */

        new("office", "government", "resmi-kurum", AreaEligible: true),
        new("amenity", "townhall", "resmi-kurum", AreaEligible: true),
        new("amenity", "courthouse", "resmi-kurum", AreaEligible: true),

        /* --- Ulaşım düğümleri (AĞLAR değil, tesisler) --------------------------
           Yalnızca TESİS karşılığı olan etiketler alınır: bir gar bir noktadır,
           bir demiryolu hattı değildir. Ağ etiketleri (`highway=*`,
           `railway=rail`) hiç eşlenmez. */

        new("railway", "station", "demiryolu", AreaEligible: true),
        new("railway", "halt", "demiryolu", AreaEligible: false),
        new("aeroway", "aerodrome", "havayolu", AreaEligible: true),
        new("aeroway", "terminal", "havayolu", AreaEligible: true),
        new("amenity", "ferry_terminal", "denizyolu", AreaEligible: true),

        /* --- Sosyal / sivil toplum --------------------------------------------- */

        new("amenity", "social_facility", "sosyal-kurumlar", AreaEligible: true),
        new("office", "ngo", "sivil-toplum", AreaEligible: true),
        new("office", "association", "sivil-toplum", AreaEligible: true),

        /* --- Eğlence ----------------------------------------------------------- */

        new("amenity", "nightclub", "eglence-yerleri", AreaEligible: true),
        new("amenity", "bar", "eglence-yerleri", AreaEligible: true),
        new("amenity", "pub", "eglence-yerleri", AreaEligible: true),

        /* --- Altyapı ------------------------------------------------------------ */

        new("amenity", "recycling", "altyapi-hizmetleri", AreaEligible: false),
        new("man_made", "water_works", "altyapi-hizmetleri", AreaEligible: true),
        new("man_made", "wastewater_plant", "altyapi-hizmetleri", AreaEligible: true),

        /* --- Enerji -------------------------------------------------------------
           `power=plant` ve `power=substation` tesistir; `power=line`/`tower`
           bir AĞDIR ve alınmaz. */

        new("power", "plant", "enerji-uretim-dagitim", AreaEligible: true),
        new("power", "substation", "enerji-uretim-dagitim", AreaEligible: true),

        /* --- Telekomünikasyon ---------------------------------------------------- */

        new("man_made", "mast", "telekomunikasyon", AreaEligible: false),
        new("man_made", "communications_tower", "telekomunikasyon", AreaEligible: true),

        /* --- Sanayi -------------------------------------------------------------- */

        new("man_made", "works", "sanayi-uretim", AreaEligible: true),

        /* `landuse=industrial` BAĞLAMSAL önceliktedir: bir arazi kullanımı
           sınıfıdır, tesisin kimliği değil. Mamak biyogaz tesisi
           (way/180961578) hem `power=plant` hem `landuse=industrial` taşır;
           tesisin ne OLDUĞUNU söyleyen `power=plant`'tir.

           `man_made=works` DEĞİŞMEDİ — o doğrudan bir fabrikayı adlandırır. */
        new("landuse", "industrial", "sanayi-uretim", AreaEligible: true,
            Priority: OsmCategoryRule.Contextual),

        /* --- Askerî -------------------------------------------------------------- */

        new("landuse", "military", "askeri-kurumlar", AreaEligible: true),

        /* --- Yeme-içme: alt kategorisi OLMAYAN türler ----------------------------
           `kafe` ve `restoran` kendi kurallarını taşır; kalanlar köke yazılır ve
           konum analizi kökü seçtiğinde hepsi birlikte sayılır. */

        new("amenity", "fast_food", "yeme-icme", AreaEligible: true),
        new("amenity", "food_court", "yeme-icme", AreaEligible: true)
    ];

    /// <summary>
    /// <b>Bilinçli olarak eşlenmeyen</b> kanonik kategoriler ve gerekçeleri.
    /// </summary>
    /// <remarks>
    /// Bu liste bir eksiklik değil, bir KARARDIR. Denetim (Phase 0) bu
    /// kategorileri "belirsiz" ya da "karşılığı yok" diye işaretlemişti;
    /// zorlama bir eşleme, yanlış veriyi doğru sayı gibi gösterirdi.
    /// </remarks>
    public static readonly IReadOnlyDictionary<string, string> DeliberatelyUnmapped =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["karayolu"] = "OSM'de karayolu bir AĞDIR (way), tesis değil. `highway=*` bir POI üretmez; "
                + "dinlenme tesisi/otogar gibi alt kavramlar için yerleşmiş tek bir etiket yoktur.",
            ["zincir-marketler"] = "\"Zincir\" bir MARKA yargısıdır, etiket değil. `shop=supermarket` "
                + "zincir olan ve olmayan marketleri ayırt etmez; marka listesi olmadan eşleme uydurma olurdu.",
            ["alisveris"] = "Umbrella kategori. Alt kategorileri (giyim, elektronik, ayakkabı…) kendi "
                + "kurallarını taşır; köke yazmak alt ağacı iki kez saydırırdı.",
            ["ticaret-alanlari"] = "Umbrella kategori; alt kategorileri (otomotiv, emlak, araç kiralama) "
                + "kendi kurallarını taşır.",
            ["konser-alani"] = "OSM'de konser mekânı için yerleşmiş güvenilir bir etiket yoktur. "
                + "`amenity=theatre` bir konser alanı DEĞİLDİR ve kulturel-tesisler'e yazılır.",
            ["konut-alanlari"] = "`landuse=residential` bir ALANDIR ve tek tek konutlar POI değildir; "
                + "içe aktarım veri kümesini anlamsız biçimde şişirirdi.",
            ["tarimsal-uretim"] = "`landuse=farmland` arazi örtüsüdür, tesis değil. Silo gibi tesisler "
                + "için güvenilir ve yaygın bir etiket bulunamadı.",
            ["onemli-noktalar"] = "Küratörlü bir uygulama kategorisidir; OSM karşılığı yoktur. "
                + "BİLİNMEYEN nesnelerin çöp kutusu olarak KULLANILMAZ.",
            ["epdk"] = "Türkiye'ye özgü tek bir kurumdur; OSM etiketi yoktur."
        };
}
