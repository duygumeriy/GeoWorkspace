namespace StajProject.Application.DTOs;

/// <summary>
/// Rol yönetimi listesindeki bir satır. İstemcinin hangi işlemleri
/// sunabileceğini sunucu söyler; kural React tarafında tekrarlanmaz.
/// </summary>
/// <remarks>
/// Identity'nin iç alanları (<c>NormalizedName</c>, <c>ConcurrencyStamp</c>)
/// bilinçli olarak dışarı verilmez: istemcinin bunlara ihtiyacı yoktur ve
/// sözleşmeyi persistence detayına bağlarlardı.
/// </remarks>
public class RoleListItem
{
    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;

    /// <summary>Bu role sahip kullanıcı sayısı.</summary>
    public int UserCount { get; set; }

    /// <summary>Role verilmiş yetki sayısı (yalnızca aktif yetkiler).</summary>
    public int PermissionCount { get; set; }

    /// <summary>Sistem tarafından korunan rol (legacy veya kanonik).</summary>
    public bool IsSystem { get; set; }

    /// <summary>Geçiş dönemi rolü (<c>Admin</c> / <c>User</c>).</summary>
    public bool IsLegacy { get; set; }

    /// <summary>Yeni onay/rol değişikliklerinde seçilebilir mi.</summary>
    public bool IsAssignable { get; set; }

    public bool CanRename { get; set; }

    public bool CanDelete { get; set; }

    public bool CanEditPermissions { get; set; }
}

/// <summary>Rol detayı. Yetki listesi ayrı uçtan okunur.</summary>
public class RoleDetail : RoleListItem
{
}

public class CreateRoleRequest
{
    public string Name { get; set; } = string.Empty;
}

public class UpdateRoleRequest
{
    public string Name { get; set; } = string.Empty;
}

/// <summary>
/// Yetki kataloğundaki bir tanım. Yönetim ekranı bu listeyi gruplayarak
/// gösterir.
/// </summary>
public class PermissionCatalogItem
{
    public int Id { get; set; }

    public string Code { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    public string Category { get; set; } = string.Empty;

    /// <summary>
    /// Kullanımdan kaldırılmış yetkiler <c>false</c>'tur: listede görünür ama
    /// atanamaz ve hiçbir kullanıcıya etki etmez.
    /// </summary>
    public bool IsActive { get; set; }

    public int SortOrder { get; set; }
}

/// <summary>
/// Katalog + o roldeki işaretlilik durumu tek yanıtta. İstemcinin iki listeyi
/// elle eşleştirmesi gerekmesin diye <see cref="Assigned"/> sunucuda hesaplanır.
/// </summary>
public class RolePermissionItem : PermissionCatalogItem
{
    public bool Assigned { get; set; }
}

public class RolePermissionsResponse
{
    public RoleListItem Role { get; set; } = new();

    public IReadOnlyList<RolePermissionItem> Permissions { get; set; } = [];
}

/// <summary>
/// Rolün sahip olması İSTENEN yetki kodları. İstek mevcut durumu değil, hedef
/// durumu tanımlar; sunucu farkı hesaplar.
/// </summary>
/// <remarks>
/// Kimlik olarak kod kullanılır, Id değil: kodlar kanonik ve kalıcı güvenlik
/// tanımlayıcılarıdır, satır kimlikleri ise kurulumdan kuruluma değişebilir.
/// </remarks>
public class UpdateRolePermissionsRequest
{
    public List<string> PermissionCodes { get; set; } = [];
}
