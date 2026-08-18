namespace StajProject.Application.DTOs;

/// <summary>
/// Bir kullanıcının yetki tablosu: katalogdaki her yetkinin o kullanıcı için
/// KAYNAĞI ve ETKİSİ.
/// </summary>
/// <remarks>
/// <para>
/// Yanıt kataloğun tamamını içerir, yalnızca atanmışları değil. Yönetici
/// ekranının sorusu "bu kullanıcı neye sahip" değil, "neye sahip, neye sahip
/// değil ve neyi verebilirim"dir; eksik satırlar istemciyi ikinci bir katalog
/// isteği yapmaya ve iki listeyi elle eşlemeye zorlardı.
/// </para>
/// <para>
/// <b>Güvenlik kararları sunucudan gelir.</b> İstemci "bu kullanıcı Viewer, o
/// hâlde şunu veremem" gibi bir çıkarım YAPMAZ; ne verilebileceğini
/// <see cref="UserPermissionItem.CanAssignDirect"/> söyler. Rol adına bakan bir
/// istemci kuralı, sunucudaki veri değiştiğinde sessizce yanlışa düşerdi.
/// </para>
/// </remarks>
public class UserPermissionsResponse
{
    public int UserId { get; set; }

    public string UserName { get; set; } = string.Empty;

    /// <summary>Kullanıcının Identity rolleri; kalıtım kaynaklarının evreni.</summary>
    public IReadOnlyList<string> Roles { get; set; } = [];

    /// <summary>
    /// Çağıranın bu ekranda herhangi bir değişiklik yapıp yapamayacağı
    /// (<c>users.update</c> + <c>permissions.assign</c>). <c>false</c> ise
    /// arayüz salt-okunur olmalıdır.
    /// </summary>
    /// <remarks>
    /// Tek tek yetkilerin verilebilirliğinden AYRI bir sorudur: yönetim
    /// yetkisi olan bir çağıranın bile dağıtamayacağı yetkiler olabilir.
    /// </remarks>
    public bool CanManageDirectPermissions { get; set; }

    /// <summary>
    /// Hedef hesabın yetki alabilecek durumda olup olmadığı. <c>false</c> ise
    /// atama satırları durur ama hiçbiri etkin değildir.
    /// </summary>
    public bool TargetAccountEligible { get; set; }

    public IReadOnlyList<UserPermissionItem> Permissions { get; set; } = [];
}

/// <summary>
/// Katalogdaki tek bir yetkinin, belirli bir kullanıcı için kaynağı ve durumu.
/// </summary>
/// <remarks>
/// <b>Atama ile etkinlik ayrı tutulur.</b> Bir satırın var olması yetkinin
/// işlediği anlamına gelmez: yetki pasifleştirilmiş ya da hedef hesap uygunsuz
/// olabilir. İkisi tek bir alana indirgenirse arayüz ya olmayan bir yetkiyi
/// "var" gösterir ya da duran bir kaydı sessizce gizler.
/// </remarks>
public class UserPermissionItem
{
    public int Id { get; set; }

    public string Code { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    public string Category { get; set; } = string.Empty;

    public bool IsActive { get; set; }

    public int SortOrder { get; set; }

    /// <summary>
    /// Bu yetkiyi veren rollerin adları. Boş liste "hiçbir rolden gelmiyor"
    /// demektir.
    /// </summary>
    /// <remarks>
    /// Liste olmasının sebebi gerçek: bir kullanıcının birden çok Identity
    /// rolü olabilir ve aynı yetki birkaçından birden gelebilir. Tek bir role
    /// indirgemek, kaynağı kaldırmak isteyen yöneticiye eksik bilgi vermek
    /// olurdu.
    /// </remarks>
    public IReadOnlyList<string> InheritedFromRoles { get; set; } = [];

    /// <summary>Kullanıcıya doğrudan bağlanmış bir <c>user_permissions</c> satırı var mı.</summary>
    public bool DirectAssigned { get; set; }

    /// <summary>
    /// Yetkinin gerçekten işleyip işlemediği: kaynak var VE yetki aktif VE
    /// hesap uygun.
    /// </summary>
    public bool Effective { get; set; }

    /// <summary>
    /// Bu yetki şu anda doğrudan atanabilir mi. Rolden geliyorsa, zaten
    /// doğrudan atanmışsa, pasifse veya çağıranın kendisi taşımıyorsa
    /// <c>false</c>'tur.
    /// </summary>
    public bool CanAssignDirect { get; set; }

    /// <summary>
    /// Mevcut doğrudan atama kaldırılabilir mi. Kaldırma ayrıcalığı azalttığı
    /// için çağıranın o yetkiyi taşımasına bağlı DEĞİLDİR.
    /// </summary>
    public bool CanRemoveDirect { get; set; }
}

/// <summary>
/// Kullanıcıya DOĞRUDAN verilmesi istenen aktif yetki kodları.
/// </summary>
/// <remarks>
/// <para>
/// İstek hedef durumu tanımlar, farkı sunucu hesaplar — rol yetkisi güncelleme
/// ucuyla aynı sözleşme.
/// </para>
/// <para>
/// Küme yalnızca DOĞRUDAN ve AKTİF atamaları kapsar. Rolden gelen yetkiler
/// buraya YAZILMAZ (yazılırsa istek reddedilir) ve pasif yetkilere ait tarihsel
/// satırlar bu kümenin dışında kalarak korunur.
/// </para>
/// </remarks>
public class UpdateUserPermissionsRequest
{
    public List<string> PermissionCodes { get; set; } = [];
}
