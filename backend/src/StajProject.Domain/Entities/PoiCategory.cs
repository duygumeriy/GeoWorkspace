using StajProject.Domain.Common;

namespace StajProject.Domain.Entities;

/// <summary>
/// POI kategorisi. Kendine referans veren bir hiyerarşi kurar
/// (<c>Yeme-İçme → Restoran / Kafe</c>).
/// </summary>
/// <remarks>
/// <para>
/// <b>Hiyerarşi tek tabloda durur.</b> Ayrı bir "üst kategori" tablosu, aynı
/// varlığı iki şemaya bölmek ve derinlik arttığında üçüncü bir tablo gerektirmek
/// olurdu; <see cref="ParentId"/> ile kurulan self-reference derinlikten
/// bağımsızdır.
/// </para>
/// <para>
/// <b>Döngü doğrulaması burada YOKTUR.</b> Bir kategorinin kendi üstü olması ya
/// da A → B → C → A zinciri kurulması, geçişli bir kuraldır ve tek satıra bakan
/// bir veritabanı kısıtıyla ifade edilemez. Kural, kategori servisine aittir ve
/// oraya yazılır — buradaki model yalnızca ilişkiyi taşır.
/// </para>
/// <para>
/// Soft delete sözleşmesi projenin geri kalanıyla aynıdır: satır silinmez,
/// <see cref="IsDeleted"/> / <see cref="IsActive"/> ile gizlenir. Silinen bir
/// kategoriye bağlı POI kayıtları korunur (bkz. <see cref="Poi"/> FK'sı).
/// </para>
/// </remarks>
public class PoiCategory : IAuditableEntity
{
    /// <summary>EF <c>HasMaxLength</c> ile aynı sınır.</summary>
    public const int MaxNameLength = 150;

    /// <summary>EF <c>HasMaxLength</c> ile aynı sınır.</summary>
    public const int MaxSlugLength = 80;

    /// <summary>EF <c>HasMaxLength</c> ile aynı sınır.</summary>
    public const int MaxIconKeyLength = 50;

    /// <summary><c>#RRGGBB</c> — diyez dâhil sabit uzunluk.</summary>
    public const int ColorHexLength = 7;

    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Kategorinin <b>teknik kimliği</b>. Görünen addan türetilir ama ona bağlı
    /// DEĞİLDİR.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Oluşturmada üretilir, sonra DEĞİŞMEZ.</b> GeoServer SLD kuralları bu
    /// değere göre eşleşir; görünen ad her düzenlendiğinde slug da yeniden
    /// üretilseydi, bir yeniden adlandırma stil kuralını sessizce sahipsiz
    /// bırakır ve o kategorinin POI'leri haritada yedek simgeye düşerdi.
    /// Yeniden adlandırma bir sunum kararıdır; teknik kimliği taşımaz.
    /// </para>
    /// <para>
    /// <b>Küresel olarak tekildir</b> — pasif ve silinmiş satırlar dâhil. SLD
    /// kuralı slug'a bakarken üst kategoriyi bilmez, dolayısıyla iki farklı
    /// kategorinin aynı slug'ı taşıması iki farklı şeyin aynı çizilmesi
    /// demektir. Emekliye ayrılmış bir kategorinin kimliği de yeniden
    /// kullanılmaz.
    /// </para>
    /// </remarks>
    public string Slug { get; set; } = string.Empty;

    /// <summary>
    /// Denetimli simge kayıt defterindeki anahtar
    /// (<see cref="StajProject.Domain.Common.PoiCategoryIcons"/>).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Yalnızca ANAHTAR saklanır.</b> Dosya yolu, URL ya da SVG içeriği
    /// asla saklanmaz: bu değer ileride hem bir React bileşen aramasına hem de
    /// bir SLD <c>ExternalGraphic</c> yoluna girecektir, dolayısıyla serbest
    /// metin olsaydı dizin geçişi (<c>../</c>) ve XML enjeksiyonu için doğrudan
    /// bir kanal açardı. İzin listesi bu ikisini de yapısal olarak imkânsız
    /// kılar.
    /// </para>
    /// <para>
    /// <c>null</c> olabilir: göç öncesinden kalan satırlar metadatasız
    /// kalabilir ve render tarafı yedek simgeye düşer. Yeni kayıtlarda servis
    /// katmanı zorunlu kılar.
    /// </para>
    /// </remarks>
    public string? IconKey { get; set; }

    /// <summary>Kanonik <c>#RRGGBB</c>; harfler büyük harfe normalize edilir.</summary>
    /// <remarks>
    /// <c>null</c> olabilir (bkz. <see cref="IconKey"/>); render tarafı
    /// <see cref="StajProject.Domain.Common.PoiCategoryPalette.Fallback"/>
    /// kullanır.
    /// </remarks>
    public string? ColorHex { get; set; }

    /// <summary>Üst kategori. Kök kategorilerde <c>null</c>.</summary>
    public int? ParentId { get; set; }

    public PoiCategory? Parent { get; set; }

    public ICollection<PoiCategory> Children { get; set; } = [];

    /// <summary>UTC olarak tutulur; servis katmanı damgalar.</summary>
    public DateTime CreatedDate { get; set; }

    /// <summary>UTC olarak tutulur; <c>AppDbContext.SaveChanges</c> damgalar.</summary>
    public DateTime ModifiedDate { get; set; }

    /// <summary>Kayıt kullanımdayken true; silindiğinde false olur.</summary>
    public bool IsActive { get; set; } = true;

    /// <summary>Soft delete işareti; silinen satır korunur, gizlenir.</summary>
    public bool IsDeleted { get; set; }
}
