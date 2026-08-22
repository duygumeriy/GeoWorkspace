namespace StajProject.Application.DTOs;

/// <summary>
/// Sıradan istemcinin gördüğü kategori. Yalnızca aktif ve silinmemiş satırlar.
/// </summary>
/// <remarks>
/// <see cref="Path"/> ve <see cref="Depth"/> sunucuda hesaplanır: hiyerarşiyi
/// istemcide yeniden kurmak, her istemcinin aynı döngü korumasını yeniden
/// yazması demek olurdu.
/// </remarks>
public class PoiCategoryResponse
{
    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;

    /// <summary>Kök kategorilerde <c>null</c>.</summary>
    public int? ParentId { get; set; }

    /// <summary>Kökten itibaren <c>" / "</c> ile birleştirilmiş yol.</summary>
    public string Path { get; set; } = string.Empty;

    /// <summary>Kök = 0.</summary>
    public int Depth { get; set; }
}

/// <summary>
/// Yönetim panelinin gördüğü kategori: pasif ve soft-delete edilmiş satırlar
/// dâhil.
/// </summary>
/// <remarks>
/// Pasif satırların gizlenmesi, yöneticinin bir kategoriyi neden
/// seçemediğini göremediği bir ekran üretirdi — yönetim ekranı envanterin
/// TAMAMINI göstermek zorundadır.
/// </remarks>
public class AdminPoiCategoryResponse
{
    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public int? ParentId { get; set; }

    /// <summary>Üst kategorinin adı; kök kategorilerde <c>null</c>.</summary>
    public string? ParentName { get; set; }

    public string Path { get; set; } = string.Empty;

    public int Depth { get; set; }

    public DateTime CreatedDate { get; set; }

    public DateTime ModifiedDate { get; set; }

    public bool IsActive { get; set; }

    public bool IsDeleted { get; set; }
}

/// <summary>
/// Kategori oluşturma isteği. Audit ve durum alanları sunucuya aittir ve
/// bilinçli olarak sözleşmede yoktur.
/// </summary>
public class CreatePoiCategoryRequest
{
    /// <summary>ZORUNLU. Kırpılır; en fazla 150 karakter.</summary>
    public string? Name { get; set; }

    /// <summary>Kök kategori için <c>null</c>; aksi hâlde aktif bir kategori.</summary>
    public int? ParentId { get; set; }
}

/// <summary>
/// Kategori düzenleme isteği.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="IsActive"/> düzenlenebilir çünkü bir kategoriyi kullanımdan
/// kaldırmak yönetimsel bir karardır. <c>IsDeleted</c>, <c>CreatedDate</c> ve
/// <c>ModifiedDate</c> ise sözleşmede YOKTUR: silme bu fazın kapsamında
/// değildir ve audit damgaları istemciden alınamaz.
/// </para>
/// </remarks>
public class UpdatePoiCategoryRequest
{
    /// <summary>ZORUNLU. Kırpılır; en fazla 150 karakter.</summary>
    public string? Name { get; set; }

    /// <summary>Yeni üst kategori; kök yapmak için <c>null</c>.</summary>
    public int? ParentId { get; set; }

    public bool IsActive { get; set; }
}
