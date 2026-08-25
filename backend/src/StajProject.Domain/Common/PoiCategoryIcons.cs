namespace StajProject.Domain.Common;

/// <summary>
/// POI kategorilerinin kullanabileceği simgelerin <b>tek tanımı</b>: denetimli,
/// kapalı bir anahtar kümesi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden izin listesi, neden serbest metin değil.</b> Bu değer ileride iki
/// ayrı yerde <i>yol</i> hâline gelecek: tarayıcıda bir bileşen araması,
/// GeoServer tarafında bir <c>ExternalGraphic</c> dosya yolu. Serbest metin
/// olsaydı <c>../../etc/passwd</c>, <c>http://…</c> ya da bir <c>&lt;svg&gt;</c>
/// gövdesi veritabanına girebilir ve oradan üretilen XML'e/dosya yoluna
/// taşınabilirdi. Kapalı bir küme bu sınıfın tamamını yapısal olarak ortadan
/// kaldırır — doğrulama bir desen eşleştirmesi değil, <b>üyelik</b> sorusudur.
/// </para>
/// <para>
/// <b>Anahtarlar ALAN kimlikleridir, bileşen adı değildir.</b> Kasıtlı olarak
/// bir simge kütüphanesinin dışa aktarım adına eşit olmak zorunda değillerdir;
/// veritabanı kimliği ile simge tedarikçisi böylece ayrışır. İleride
/// <c>icon_key → React bileşeni</c> ve <c>icon_key → yerel SVG</c> eşlemeleri
/// ayrı ayrı kurulur; tedarikçi değişirse veri değişmez.
/// </para>
/// <para>
/// <b>Enum DEĞİL, doğrulanmış metin.</b> Enum, her yeni simgeyi bir şema/derleme
/// olayına çevirir ve veritabanında tanınmayan bir değerle karşılaşıldığında
/// okuma yolunu kırar. Metin + izin listesi, kümeyi tek ve düzenlenebilir bir
/// yerde tutar.
/// </para>
/// </remarks>
public static class PoiCategoryIcons
{
    /// <summary>
    /// Tanınan simge anahtarları. Kanonik taksonominin ihtiyaç duyduğu kümenin
    /// tamamı burada sayılır.
    /// </summary>
    public static readonly IReadOnlyList<string> All =
    [
        /* --- Kök / çekirdek ---------------------------------------------------- */

        "store",
        "shopping-bag",
        "zap",
        "party-popper",
        "house",
        "landmark",
        "recycle",
        "hospital",
        "graduation-cap",
        "radio-tower",
        "wheat",
        "factory",
        "trees",
        "route",
        "building-2",
        "shield",
        "train",
        "badge-dollar-sign",
        "castle",
        "map-pin",
        "dumbbell",
        "users",
        "heart-handshake",
        "utensils",
        "church",
        "plane",
        "ship",

        /* --- Özel alt kategoriler ---------------------------------------------- */

        "banknote",
        "gauge",
        "pill",
        "battery-charging",
        "school",
        "car",
        "armchair",
        "shopping-cart",
        "shirt",
        "monitor",
        "key-round",
        "hammer",
        "car-front",
        "shopping-basket",

        /* --- Mevcut alt kategoriler -------------------------------------------- */

        "coffee",
        "utensils-crossed",
        "music"
    ];

    /// <summary>
    /// Render tarafının tanınmayan/boş anahtarda düşeceği yedek.
    /// </summary>
    /// <remarks>
    /// Bir kategori simgesiz kalabilir (göç öncesi satırlar), ama harita
    /// üzerinde <i>hiç çizilmemek</i> kabul edilebilir bir sonuç değildir —
    /// çizim SLD'lerindeki <c>ElseFilter</c> kuralıyla aynı gerekçe.
    /// </remarks>
    public const string Fallback = "map-pin";

    /// <summary>Anahtar izin listesinde mi. Karşılaştırma tam ve harfe duyarlıdır.</summary>
    /// <remarks>
    /// Harfe duyarlılık bilinçlidir: anahtarlar kanonik olarak kebab-case
    /// küçük harftir ve <c>"Pill"</c> gibi bir varyantı sessizce kabul etmek,
    /// veritabanında aynı simgenin iki yazımını üretirdi.
    /// </remarks>
    public static bool IsApproved(string? iconKey) =>
        iconKey is not null && All.Contains(iconKey, StringComparer.Ordinal);
}
