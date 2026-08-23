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

    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;

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
