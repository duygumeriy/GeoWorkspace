using Microsoft.EntityFrameworkCore;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// Etkin yetkileri doğrudan veritabanından çözer.
/// </summary>
/// <remarks>
/// <para>
/// <b>Tek kural kaynağı.</b> Hem liste hem de tekil kontrol aynı
/// <see cref="BuildEffectivePermissionCodeQuery"/> sorgusundan türer. İki ayrı
/// implementasyon yazmak, birinin zamanla diğerinden sapması ve "listede yok
/// ama HasPermission true" gibi sessiz bir güvenlik farkı doğurması demek
/// olurdu.
/// </para>
/// <para>
/// <b>Rol adına göre kestirme YOKTUR.</b> Kodda hiçbir yerde
/// <c>IsInRole("Admin")</c> benzeri bir süper kullanıcı geçişi bulunmaz.
/// Yönetici hesabı yetkilerini yalnızca <c>role_permissions</c> satırlarından
/// alır; bu tablodan bir satır silinirse yetkisi gerçekten kaybolur. Dinamik
/// yetkilendirmenin tüm anlamı budur.
/// </para>
/// <para>
/// <b>Hesap durumu sorgunun içindedir.</b> Uygunluk kontrolü ayrı bir çağrı
/// olarak değil, <c>users</c> tablosuna yapılan join'in yüklemi olarak
/// yazılır: uygun olmayan hesapta join hiçbir satır üretmez ve sonuç doğal
/// olarak boş kalır. Böylece "önce kullanıcıyı çek, sonra yetkileri çek"
/// biçiminde iki gidiş-dönüş oluşmaz ve kontrolü atlamak mümkün olmaz.
/// </para>
/// </remarks>
public class EffectivePermissionService : IEffectivePermissionService
{
    private readonly AppDbContext _dbContext;

    public EffectivePermissionService(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<IReadOnlyCollection<string>> GetEffectivePermissionCodesAsync(
        int userId,
        CancellationToken cancellationToken = default)
    {
        var codes = await BuildEffectivePermissionCodeQuery(userId)
            .ToListAsync(cancellationToken);

        /* Dizi olarak döndürülür: çağıran, servisin iç durumunu değiştirebilecek
           bir koleksiyona sahip olmamalıdır. IReadOnlyCollection zaten mutasyon
           API'si sunmaz; List olarak döndürmek cast ile bunu delmeye açık
           bırakırdı. */
        return codes.ToArray();
    }

    public async Task<bool> HasPermissionAsync(
        int userId,
        string? permissionCode,
        CancellationToken cancellationToken = default)
    {
        /* Boş/whitespace kod istisna değil, false üretir. Yetkilendirme
           sorusunun güvenli cevabı her zaman "hayır"dır; çağıran tarafta
           beklenmeyen bir null yüzünden istek 500'e düşmesi, erişim kararını
           hata yönetimine bağlamak olurdu. Katalogda olmayan bir kod da aynı
           şekilde sessizce false döner (bkz. arayüz dokümantasyonu). */
        if (string.IsNullOrWhiteSpace(permissionCode))
        {
            return false;
        }

        /* Var mı yok mu sorusu EXISTS'e çevrilir; Name/Description/Category
           kolonları hiç okunmaz. Karşılaştırma veritabanının varsayılan
           semantiğiyle yapılır — PostgreSQL'de bu tam eşleşmedir (büyük/küçük
           harfe duyarlı). Kodlar teknik tanımlayıcıdır ve permissions.code
           üzerindeki UNIQUE index de aynı semantiği kullanır; kültüre duyarlı
           bir normalizasyon (ToLower/ToUpper) bilinçli olarak YAPILMAZ, aksi
           halde Türkçe kültürde 'I' harfi beklenmedik biçimde eşleşirdi. */
        return await BuildEffectivePermissionCodeQuery(userId)
            .AnyAsync(code => code == permissionCode, cancellationToken);
    }

    /* --- Ortak sorgu ---------------------------------------------------------- */

    /// <summary>
    /// Etkin yetki kodlarını üreten tek sorgu: rolden gelenler UNION doğrudan
    /// verilenler.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>UNION seçilmiştir, UNION ALL değil.</b> SQL'de <c>UNION</c> zaten
    /// tekilleştirir; aynı yetki hem rolden hem doğrudan gelse bile sonuçta bir
    /// kez görünür. Tekilleştirmeyi belleğe alıp <c>Distinct()</c> ile yapmak,
    /// aynı işi veritabanından sonra tekrar etmek olurdu.
    /// </para>
    /// <para>
    /// <b>Rol üyeliği gerçek Identity verisinden okunur.</b> Kaynak
    /// <c>user_roles</c> tablosudur; "kullanıcının tek bir primary role'ü olur"
    /// iş kuralına yaslanılmaz. Kural bu fazda değişmiyor, ama yetkilendirme
    /// çekirdeği ona bağımlı da olmuyor: bir kullanıcı bir gün birden fazla
    /// role sahip olursa hepsinin yetkileri doğal olarak birleşir.
    /// </para>
    /// <para>
    /// <b>Pasif yetkiler iki kolda da elenir.</b> <c>is_active = false</c> olan
    /// bir tanım, ilişkili <c>role_permissions</c> / <c>user_permissions</c>
    /// satırı hâlâ dursa bile sonuca giremez. Yetkiyi kullanımdan kaldırmanın
    /// yolu satırları silmek değil, tanımı pasifleştirmektir; geçmiş ilişki
    /// korunur.
    /// </para>
    /// <para>
    /// Sonuç <c>IQueryable</c> olarak döner; hiçbir şey henüz çalıştırılmaz.
    /// Çağıran ya listeler (tek SELECT) ya da <c>Any</c> ile daraltır (tek
    /// EXISTS) — her iki durumda da veritabanına tek gidiş olur ve filtreleme
    /// SQL tarafında kalır.
    /// </para>
    /// </remarks>
    private IQueryable<string> BuildEffectivePermissionCodeQuery(int userId)
    {
        /* Uygunluk kapısı. Yalnızca uygulamayı kullanmaya hakkı olan hesap
           yetki alabilir: kayıt yoksa, soft delete edilmişse, pasifleştirilmişse
           veya durumu Active değilse (onay bekleyen, askıya alınmış, reddedilmiş)
           bu sorgu boş kalır ve aşağıdaki iki kol da boş üretir.

           Bu, "aktif JWT ile gezerken yönetici hesabı askıya alır → sonraki
           yetki kontrolü reddeder" senaryosunun çalışmasını sağlar; token'ın
           süresinin dolması beklenmez. Login kodu bu davranış için
           DEĞİŞTİRİLMEZ — kural burada, yetkilendirme tarafında da geçerlidir. */
        var eligibleUser = _dbContext.Users
            .AsNoTracking()
            .Where(u => u.Id == userId
                && !u.IsDeleted
                && u.IsActive
                && u.AccountStatus == AccountStatus.Active);

        // Rolden gelen yetkiler: user → user_roles → role_permissions → permissions
        var roleGrants =
            from user in eligibleUser
            join userRole in _dbContext.UserRoles on user.Id equals userRole.UserId
            join rolePermission in _dbContext.RolePermissions on userRole.RoleId equals rolePermission.RoleId
            join permission in _dbContext.Permissions on rolePermission.PermissionId equals permission.Id
            where permission.IsActive
            select permission.Code;

        // Doğrudan verilen yetkiler: user → user_permissions → permissions
        var directGrants =
            from user in eligibleUser
            join userPermission in _dbContext.UserPermissions on user.Id equals userPermission.UserId
            join permission in _dbContext.Permissions on userPermission.PermissionId equals permission.Id
            where permission.IsActive
            select permission.Code;

        return roleGrants.Union(directGrants);
    }
}
