namespace StajProject.Domain.Entities;

/// <summary>
/// Sistemin tanıdığı tekil yetki tanımı. Bir yetki, anlamlı bir iş/güvenlik
/// yeteneğini temsil eder ("poligon ekleyebilir", "kullanıcı silebilir") —
/// arayüzdeki bir butonu veya bir menü hareketini DEĞİL.
/// </summary>
/// <remarks>
/// <para>
/// <b>Kimlik <see cref="Code"/>'dur.</b> Yetkilendirme her zaman kod üzerinden
/// çalışır; <see cref="Name"/> ve <see cref="Description"/> yalnızca arayüzde
/// gösterilen Türkçe metinlerdir ve değişebilir. Görünen ada bağlı bir
/// yetkilendirme kararı, bir çeviri düzeltmesiyle erişim kaybına dönüşürdü.
/// </para>
/// <para>
/// Bu tablo bir <i>tanım kataloğudur</i>: satırlar seed ile gelir, kullanıcı
/// verisi değildir ve normal işleyişte silinmez. <see cref="RolePermission"/>
/// ve <see cref="UserPermission"/> kayıtları bu satırlara bağlıdır.
/// </para>
/// </remarks>
public class Permission
{
    public int Id { get; set; }

    /// <summary>
    /// Kanonik yetki kodu (<c>drawings.polygon.create</c>). Benzersizdir ve
    /// yetkilendirmenin tek gerçek kaynağıdır. Türkçe metin ASLA kod olarak
    /// kullanılmaz.
    /// </summary>
    public string Code { get; set; } = string.Empty;

    /// <summary>Arayüzde gösterilen ad (Türkçe).</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Yetkinin ne yapmaya izin verdiğini açıklayan Türkçe metin.</summary>
    public string? Description { get; set; }

    /// <summary>
    /// Yetki yönetimi ekranında gruplama için kullanılan kategori
    /// (<c>DrawingCreate</c>, <c>Users</c> …). Gruplama etiketidir; yetkilendirme
    /// kararı vermez.
    /// </summary>
    public string Category { get; set; } = string.Empty;

    /// <summary>
    /// Yetkinin kullanımda olup olmadığı. Kullanımdan kaldırılan bir yetki
    /// SİLİNMEK yerine pasifleştirilir; böylece ona bağlı grant satırları ve
    /// geçmiş bozulmaz.
    /// </summary>
    public bool IsActive { get; set; } = true;

    /// <summary>Aynı kategori içindeki gösterim sırası.</summary>
    public int SortOrder { get; set; }
}
