using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StajProject.Api.Authorization;
using StajProject.Api.Common;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;

namespace StajProject.Api.Controllers;

/// <summary>
/// Admin kullanıcı yönetimi. Tüm uçlar <see cref="AuthorizationPolicies.AdminMfaRequired"/>
/// ile korunur: anonim istek 401, yetkisi olmayan authenticated kullanıcı 403 alır.
/// </summary>
/// <remarks>
/// <para>
/// AUTH-5'ten itibaren policy yalnızca Admin rolünü değil, tamamlanmış ikinci
/// faktörü de (<c>amr=mfa</c>) arar. Bunlar sistemdeki en güçlü uçlar: rol
/// değiştirme ve hesap pasifleştirme. Yalnız şifreyle elde edilmiş bir token
/// — böyle bir token'ın hiç üretilmemesi gerekse de — buraya giremez.
/// </para>
/// <para>
/// Controller kasıtlı olarak incedir; rol mantığı, son aktif Admin koruması ve
/// durum kuralları <see cref="IUserManagementService"/> içindedir.
/// AUTH-6'daki admin UI bu uçları tüketecek.
/// </para>
/// <para>
/// <b>Hata yönetimi.</b> Tüm uçlar <see cref="ApiControllerBase"/> üzerinden
/// aynı try-catch sınırındadır. Yetkilendirme kararı sınırın <i>dışındadır</i>:
/// policy MVC filtresi olarak çalışır, dolayısıyla 401/403 buradaki catch'e
/// hiç uğramaz ve beklenmeyen bir hata yetki kontrolünü maskeleyemez.
/// </para>
/// </remarks>
[ApiController]
/* Yönetim uçlarının güvenliği iki BAĞIMSIZ boyuttan oluşur:

     1) MfaRequired  — "kimliğini ne kadar güçlü kanıtladı"
     2) RequirePermission — "bunu yapmaya yetkisi var mı"

   Daha önce burada AdminMfaRequired vardı; o politika MFA'nın yanında legacy
   `Admin` ROL ADINI da şart koşuyordu. Dinamik yetkilendirmede erişimin
   kaynağı yetki satırlarıdır: 27 yetkinin tamamına sahip bir `Administrator`
   kullanıcısı, sırf rol adı `Admin` olmadığı için engellenmemelidir.

   MFA şartı GEVŞETİLMEDİ — MfaRequired birebir aynı `amr=mfa` kanıtına bakar.
   Kaldırılan tek şey rol adı bağıdır; onun yerini uç bazında gereken yetki
   alır. Legacy Admin de geçmeye devam eder, çünkü Phase 1 ona 27 yetkinin
   tamamını vermiştir — rol adı sayesinde değil.

   AdminMfaRequired politikası SİLİNMEDİ; tanımı yerinde durur ve ileride
   bilinçli bir temizlikle kaldırılana kadar geriye dönük uyumluluk sağlar. */
[Authorize(Policy = AuthorizationPolicies.MfaRequired)]
[Route("api/admin/users")]
public class AdminUsersController : ApiControllerBase
{
    private readonly IUserManagementService _userManagement;
    private readonly ICurrentUserService _currentUser;
    private readonly IUserPermissionManagementService _userPermissions;
    private readonly IGeographicAuthorizationService _geographicAuthorization;

    public AdminUsersController(
        IUserManagementService userManagement,
        ICurrentUserService currentUser,
        IUserPermissionManagementService userPermissions,
        IGeographicAuthorizationService geographicAuthorization,
        ILogger<AdminUsersController> logger)
        : base(logger)
    {
        _userManagement = userManagement;
        _currentUser = currentUser;
        _userPermissions = userPermissions;
        _geographicAuthorization = geographicAuthorization;
    }

    [RequirePermission(PermissionCodes.UsersView)]
    [HttpGet]
    public Task<ActionResult<IReadOnlyList<AdminUserListItem>>> GetUsers(CancellationToken cancellationToken) =>
        Guard<IReadOnlyList<AdminUserListItem>>(
            nameof(GetUsers),
            async () => Ok(await _userManagement.GetUsersAsync(cancellationToken)));

    [RequirePermission(PermissionCodes.UsersView)]
    [HttpGet("{id:int}")]
    public Task<ActionResult<AdminUserDetail>> GetUser(int id, CancellationToken cancellationToken) =>
        GuardUser(nameof(GetUser), () => _userManagement.GetUserAsync(id, cancellationToken));

    /// <summary>
    /// <b>Bu çağıranın</b> şu anda atayabileceği roller. Rota <c>{id:int}</c>
    /// kısıtı sayesinde kullanıcı detayı ucuyla çakışmaz.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Uç sorumluluk ayrımı.</b> <c>GET /api/admin/roles</c> "sistemde
    /// hangi roller VAR" sorusunu yanıtlar ve bilinçli olarak çağırana göre
    /// filtrelenmez — yönetim ekranının envantere ihtiyacı vardır. Buradaki
    /// uç ise "bu çağıran şu an hangi rolleri VEREBİLİR" sorusunu yanıtlar,
    /// dolayısıyla çağırana özeldir. İkisi farklı sorulardır ve
    /// birleştirilmemelidir.
    /// </para>
    /// <para>
    /// Liste, mutasyon uçlarıyla <b>aynı</b> kuralı kullanır (hedef rolün
    /// aktif yetkileri ⊆ çağıranın etkin yetkileri); böylece dropdown'da
    /// görünüp atandığında 403 dönen bir rol oluşamaz.
    /// </para>
    /// <para>
    /// <b>Yetki sözleşmesi DEĞİŞMEDİ:</b> uç hâlâ MFA + <c>roles.view</c>
    /// ister. Dönen verinin çağırana özel olması, uca <c>users.update</c>
    /// şartı eklemek için sebep değildir: "hangi rolleri verebilirdim"
    /// sorusunu sormak, rol atamakla aynı şey değildir. Asıl mutasyon uçları
    /// <c>users.update</c> istemeye devam eder — yetenek keşfi ile mutasyon
    /// yetkilendirmesi ayrı tutulur.
    /// </para>
    /// </remarks>
    [RequirePermission(PermissionCodes.RolesView)]
    [HttpGet("roles")]
    public Task<ActionResult<IReadOnlyList<AssignableRole>>> GetAssignableRoles(CancellationToken cancellationToken) =>
        Guard<IReadOnlyList<AssignableRole>>(
            nameof(GetAssignableRoles),
            async () => Ok(await _userManagement.GetAssignableRolesAsync(ActingUserId, cancellationToken)));

    [RequirePermission(PermissionCodes.UsersUpdate)]
    [HttpPatch("{id:int}/role")]
    public Task<ActionResult<AdminUserDetail>> ChangeRole(
        int id,
        [FromBody] UpdateUserRoleRequest request,
        CancellationToken cancellationToken) =>
        GuardUser(
            nameof(ChangeRole),
            () => _userManagement.ChangeRoleAsync(id, request, ActingUserId, cancellationToken));

    /// <remarks>
    /// YETKİ: <c>users.update</c> — bilinçli olarak <c>users.deactivate</c>
    /// DEĞİL.
    /// <para>
    /// Uç tek bir <c>IsActive</c> bayrağı alır ve aynı çağrı hem pasifleştirme
    /// hem yeniden aktifleştirme yapabilir. Statik bir attribute gövdedeki
    /// <c>true</c>/<c>false</c> ayrımını göremez; bu uca
    /// <c>users.deactivate</c> bağlamak, "yalnızca devre dışı bırakabilir"
    /// diye okunan bir yetkiyi sessizce "aktifleştirebilir de" hâline
    /// getirirdi — yani yanıltıcı bir yetkilendirme olurdu.
    /// </para>
    /// <para>
    /// Bu yüzden daha genel ve dürüst olan <c>users.update</c> kullanılır.
    /// Seed edilen matriste her iki yetki de yalnızca Administrator/legacy
    /// Admin'dedir, dolayısıyla mevcut güvenlik seviyesi DÜŞMEZ. Eylem bazında
    /// ayrım istenirse doğru çözüm ucu ikiye bölmektir; bu ayrı ve odaklı bir
    /// değişikliğin konusudur.
    /// </para>
    /// </remarks>
    [RequirePermission(PermissionCodes.UsersUpdate)]
    [HttpPatch("{id:int}/status")]
    public Task<ActionResult<AdminUserDetail>> ChangeStatus(
        int id,
        [FromBody] UpdateUserStatusRequest request,
        CancellationToken cancellationToken) =>
        GuardUser(
            nameof(ChangeStatus),
            () => _userManagement.ChangeStatusAsync(id, request, ActingUserId, cancellationToken));

    /* --- Onay akışı -----------------------------------------------------------
       Gövde yalnızca rol/gerekçe taşır. Aktiflik, onay zamanı ve onaylayan
       kimliği istemciden OKUNMAZ; sunucunun kendi kararlarıdır ve
       ActingUserId doğrulanmış yönetici token'ından gelir. */

    [RequirePermission(PermissionCodes.UsersUpdate)]
    [HttpPost("{id:int}/approve")]
    public Task<ActionResult<AdminUserDetail>> Approve(
        int id,
        [FromBody] ApproveUserRequest request,
        CancellationToken cancellationToken) =>
        GuardUser(
            nameof(Approve),
            () => _userManagement.ApproveAsync(id, request, ActingUserId, cancellationToken));

    [RequirePermission(PermissionCodes.UsersUpdate)]
    [HttpPost("{id:int}/reject")]
    public Task<ActionResult<AdminUserDetail>> Reject(
        int id,
        [FromBody] RejectUserRequest request,
        CancellationToken cancellationToken) =>
        GuardUser(
            nameof(Reject),
            () => _userManagement.RejectAsync(id, request, ActingUserId, cancellationToken));

    /// <summary>
    /// Kullanıcı döndüren uçların ortak sarmalayıcısı: hata sınırı + mevcut
    /// <see cref="Respond"/> eşlemesi. İş kuralı sonuçları (404/409/400) burada
    /// değişmez; catch yalnızca beklenmeyen hatalar içindir.
    /// </summary>
    private Task<ActionResult<AdminUserDetail>> GuardUser(
        string endpoint,
        Func<Task<ServiceResult<AdminUserDetail>>> operation) =>
        Guard<AdminUserDetail>(endpoint, async () => Respond(await operation()));

    /* --- Kullanıcıya özel yetkiler ---------------------------------------------
       İki yetki birden istenir: kullanıcıyı görmek (users.view) ve yetki
       kataloğunu görmek (permissions.view). Yanıt ikisini birleştirdiği için
       tek bir yetkiyle açmak, diğer kaynağı dolaylı olarak sızdırmak olurdu —
       rol yetkisi ucundaki kuralın aynısı. */

    /// <summary>
    /// Kullanıcının yetki tablosu: her yetkinin kaynağı (rol / doğrudan),
    /// etkisi ve çağıran için mutasyon kabiliyeti.
    /// </summary>
    /// <remarks>
    /// Liste çağırana göre FİLTRELENMEZ: yönetici, veremeyeceği yetkileri de
    /// görebilmelidir. "Ne verebilirim" sorusunun cevabı satırlardaki
    /// <c>canAssignDirect</c> alanındadır.
    /// </remarks>
    [RequirePermission(PermissionCodes.UsersView)]
    [RequirePermission(PermissionCodes.PermissionsView)]
    [HttpGet("{id:int}/permissions")]
    public Task<ActionResult<UserPermissionsResponse>> GetUserPermissions(
        int id,
        CancellationToken cancellationToken) =>
        Guard<UserPermissionsResponse>(
            nameof(GetUserPermissions),
            async () => RespondPermissions(
                await _userPermissions.GetUserPermissionsAsync(ActingUserId, id, cancellationToken)));

    /// <summary>
    /// Kullanıcının DOĞRUDAN yetkilerini gönderilen aktif kümeye eşitler.
    /// </summary>
    /// <remarks>
    /// Değişiklik anında geçerlidir: yetki denetimi her istekte canlı
    /// veritabanını okur, dolayısıyla yeniden giriş veya token yenilemesi
    /// GEREKMEZ. Aynı canlılık yüzünden servise çağıranın kimliği geçilir —
    /// aksi hâlde <c>permissions.assign</c> sahibi bir kuklaya istediği yetkiyi
    /// verip o hesap üzerinden sisteme erişebilirdi.
    /// </remarks>
    [RequirePermission(PermissionCodes.UsersUpdate)]
    [RequirePermission(PermissionCodes.PermissionsAssign)]
    [HttpPut("{id:int}/permissions")]
    public Task<ActionResult<UserPermissionsResponse>> ReplaceUserPermissions(
        int id,
        [FromBody] UpdateUserPermissionsRequest request,
        CancellationToken cancellationToken) =>
        Guard<UserPermissionsResponse>(
            nameof(ReplaceUserPermissions),
            async () => RespondPermissions(
                await _userPermissions.ReplaceUserPermissionsAsync(
                    ActingUserId, id, request, cancellationToken)));

    /* --- Coğrafi yetki alanı: TEKİL (UYUMLULUK — Phase 8A) ----------------------
       İki BAĞIMSIZ yetki birlikte aranır: hedefin türü için gereken yetki
       (users.view / users.update) ve coğrafi yönetim yeteneği (geography.view /
       geography.manage). Yalnızca users.update taşıyan bir aktör, coğrafi sınırı
       kaldıramaz — aksi hâlde kullanıcı düzenleme yetkisi sessizce coğrafi
       yetki yönetimi anlamına gelirdi.

       <b>Bu üç uç UYUMLULUK İÇİNDİR ve yeni ekranlar kullanmaz.</b> Hedef
       başına tek alanın olduğu dönemden kalmışlardır; Phase 9 arayüzü aşağıdaki
       ÇOĞUL uçları kullanır. Anlamları belirsiz değil, yalnızca dardır:

         GET    → hedefin tüm doğrudan alanlarının BİRLEŞİMİ, tek WKT olarak
         PUT    → hedefin TÜM doğrudan alanlarını gönderilen tek alanla DEĞİŞTİRİR
         DELETE → hedefin TÜM doğrudan alanlarını kaldırır

       Çok alanlı yönetim yapan hiçbir ekran tekil PUT'u çağırmamalıdır: o çağrı
       ikinci ve sonraki alanları sessizce silerdi. */

    /// <summary>
    /// Kullanıcının coğrafi yetki alanı: kendi alanı ve fiilen uygulanan alan.
    /// </summary>
    /// <remarks>
    /// Alanı olmayan bir kullanıcı için 404 DÖNMEZ: kullanıcı vardır, yalnızca
    /// kısıtı yoktur. "Kayıt yok" ile "hedef yok" farklı cevaplardır ve ikisini
    /// aynı koda indirmek, yönetici ekranını var olmayan bir hata durumuna
    /// sokardı.
    /// </remarks>
    [RequirePermission(PermissionCodes.UsersView)]
    [RequirePermission(PermissionCodes.GeographyView)]
    [HttpGet("{id:int}/geographic-authorization")]
    public Task<ActionResult<GeographicAuthorizationResponse>> GetUserGeographicAuthorization(
        int id,
        CancellationToken cancellationToken) =>
        Guard<GeographicAuthorizationResponse>(
            nameof(GetUserGeographicAuthorization),
            async () => RespondGeographic(
                await _geographicAuthorization.GetUserAuthorizationAsync(id, cancellationToken)));

    /// <summary>
    /// Kullanıcının alanını gönderilen poligona eşitler (upsert).
    /// </summary>
    /// <remarks>
    /// Değişiklik ANINDA geçerlidir: çizim uçları alanı her istekte canlı
    /// okur, dolayısıyla yeniden giriş veya token yenilemesi gerekmez. Coğrafi
    /// yetki bilinçli olarak JWT'ye yazılmaz — yazılsaydı, daraltılan bir alan
    /// eski token'ın ömrü boyunca uygulanmazdı.
    /// </remarks>
    [RequirePermission(PermissionCodes.UsersUpdate)]
    [RequirePermission(PermissionCodes.GeographyManage)]
    [HttpPut("{id:int}/geographic-authorization")]
    public Task<ActionResult<GeographicAuthorizationResponse>> ReplaceUserGeographicAuthorization(
        int id,
        [FromBody] UpdateGeographicAuthorizationRequest request,
        CancellationToken cancellationToken) =>
        Guard<GeographicAuthorizationResponse>(
            nameof(ReplaceUserGeographicAuthorization),
            async () => RespondGeographic(
                await _geographicAuthorization.UpsertUserAuthorizationAsync(id, request, cancellationToken)));

    /// <summary>
    /// Kullanıcıya özel alanı kaldırır; kullanıcı rollerinden gelen alanlara düşer.
    /// </summary>
    [RequirePermission(PermissionCodes.UsersUpdate)]
    [RequirePermission(PermissionCodes.GeographyManage)]
    [HttpDelete("{id:int}/geographic-authorization")]
    public Task<ActionResult<GeographicAuthorizationResponse>> DeleteUserGeographicAuthorization(
        int id,
        CancellationToken cancellationToken) =>
        Guard<GeographicAuthorizationResponse>(
            nameof(DeleteUserGeographicAuthorization),
            async () => RespondGeographic(
                await _geographicAuthorization.DeleteUserAuthorizationAsync(id, cancellationToken)));

    /* --- Coğrafi yetki alanları: ÇOKLU (Phase 9) -------------------------------
       Yeni sözleşme çoğuldur ve her alan KENDİ kimliğiyle adreslenir. Tekil
       uçlar (yukarıda) yalnızca uyumluluk için durur ve çok alanlı yönetimde
       KULLANILMAZ: tekil PUT hedefin tüm alanlarını tek alana indirir.

       Yetki matrisi tekil uçlarla BİREBİR aynıdır — çoğullaşma bir yetki
       gevşetmesi değildir. */

    /// <summary>
    /// Kullanıcının doğrudan coğrafi alanları + fiilen uygulanan sınır.
    /// </summary>
    /// <remarks>
    /// Alanı olmayan bir kullanıcı için 404 DÖNMEZ: kullanıcı vardır, yalnızca
    /// kısıtı yoktur. "Kayıt yok" ile "hedef yok" farklı cevaplardır ve ikisini
    /// aynı koda indirmek, yönetici ekranını var olmayan bir hata durumuna
    /// sokardı.
    /// </remarks>
    [RequirePermission(PermissionCodes.UsersView)]
    [RequirePermission(PermissionCodes.GeographyView)]
    [HttpGet("{id:int}/geographic-authorizations")]
    public Task<ActionResult<GeographicAreasResponse>> GetUserGeographicAreas(
        int id,
        CancellationToken cancellationToken) =>
        Guard<GeographicAreasResponse>(
            nameof(GetUserGeographicAreas),
            async () => RespondAreas(
                await _geographicAuthorization.GetUserAreasAsync(id, cancellationToken)));

    /// <summary>
    /// Kullanıcıya YENİ bir alan ekler; var olan alanlarına dokunmaz.
    /// </summary>
    /// <remarks>
    /// Değişiklik ANINDA geçerlidir: çizim uçları alanı her istekte canlı
    /// okur, dolayısıyla yeniden giriş veya token yenilemesi gerekmez. Coğrafi
    /// yetki bilinçli olarak JWT'ye yazılmaz — yazılsaydı, daraltılan bir alan
    /// eski token'ın ömrü boyunca uygulanmazdı.
    /// </remarks>
    [RequirePermission(PermissionCodes.UsersUpdate)]
    [RequirePermission(PermissionCodes.GeographyManage)]
    [HttpPost("{id:int}/geographic-authorizations")]
    public Task<ActionResult<GeographicAreasResponse>> CreateUserGeographicArea(
        int id,
        [FromBody] SaveGeographicAreaRequest request,
        CancellationToken cancellationToken) =>
        Guard<GeographicAreasResponse>(
            nameof(CreateUserGeographicArea),
            async () => RespondAreas(
                await _geographicAuthorization.CreateUserAreaAsync(id, request, cancellationToken)));

    /// <summary>Kullanıcının TEK bir alanını değiştirir; diğerleri kalır.</summary>
    [RequirePermission(PermissionCodes.UsersUpdate)]
    [RequirePermission(PermissionCodes.GeographyManage)]
    [HttpPut("{id:int}/geographic-authorizations/{areaId:int}")]
    public Task<ActionResult<GeographicAreasResponse>> UpdateUserGeographicArea(
        int id,
        int areaId,
        [FromBody] SaveGeographicAreaRequest request,
        CancellationToken cancellationToken) =>
        Guard<GeographicAreasResponse>(
            nameof(UpdateUserGeographicArea),
            async () => RespondAreas(
                await _geographicAuthorization.UpdateUserAreaAsync(id, areaId, request, cancellationToken)));

    /// <summary>
    /// Kullanıcının TEK bir alanını kaldırır; diğerleri kalır. Son alan da
    /// kaldırılırsa kullanıcı rollerinden gelen alanlara düşer.
    /// </summary>
    [RequirePermission(PermissionCodes.UsersUpdate)]
    [RequirePermission(PermissionCodes.GeographyManage)]
    [HttpDelete("{id:int}/geographic-authorizations/{areaId:int}")]
    public Task<ActionResult<GeographicAreasResponse>> DeleteUserGeographicArea(
        int id,
        int areaId,
        CancellationToken cancellationToken) =>
        Guard<GeographicAreasResponse>(
            nameof(DeleteUserGeographicArea),
            async () => RespondAreas(
                await _geographicAuthorization.DeleteUserAreaAsync(id, areaId, cancellationToken)));

    private ActionResult<GeographicAreasResponse> RespondAreas(
        ServiceResult<GeographicAreasResponse> result)
    {
        if (result.IsSuccess)
        {
            return Ok(result.Value);
        }

        return result.ErrorKind switch
        {
            ServiceErrorKind.NotFound => NotFound(new { message = result.Error }),
            ServiceErrorKind.Conflict => Conflict(new { message = result.Error }),
            ServiceErrorKind.Forbidden => StatusCode(StatusCodes.Status403Forbidden, new { message = result.Error }),
            // Geçersiz geometri bir YETKİ sorunu değildir: 400 kalır.
            _ => BadRequest(new { message = result.Error })
        };
    }

    private ActionResult<GeographicAuthorizationResponse> RespondGeographic(
        ServiceResult<GeographicAuthorizationResponse> result)
    {
        if (result.IsSuccess)
        {
            return Ok(result.Value);
        }

        return result.ErrorKind switch
        {
            ServiceErrorKind.NotFound => NotFound(new { message = result.Error }),
            ServiceErrorKind.Conflict => Conflict(new { message = result.Error }),
            ServiceErrorKind.Forbidden => StatusCode(StatusCodes.Status403Forbidden, new { message = result.Error }),
            // Geçersiz geometri bir YETKİ sorunu değildir: 400 kalır.
            _ => BadRequest(new { message = result.Error })
        };
    }

    private ActionResult<UserPermissionsResponse> RespondPermissions(
        ServiceResult<UserPermissionsResponse> result)
    {
        if (result.IsSuccess)
        {
            return Ok(result.Value);
        }

        return result.ErrorKind switch
        {
            ServiceErrorKind.NotFound => NotFound(new { message = result.Error }),
            ServiceErrorKind.Conflict => Conflict(new { message = result.Error }),
            /* Yetki yükseltme reddi: istek geçerli, kullanıcı ve yetki kodları
               da var — eksik olan çağıranın o yetkiyi DAĞITMA otoritesidir. */
            ServiceErrorKind.Forbidden => StatusCode(StatusCodes.Status403Forbidden, new { message = result.Error }),
            _ => BadRequest(new { message = result.Error })
        };
    }

    /// <summary>
    /// İşlemi yapan yöneticinin kimliği; daima doğrulanmış token'dan gelir,
    /// istek gövdesinden veya query'den ASLA okunmaz.
    /// </summary>
    /// <remarks>
    /// Policy sayesinde buraya yalnızca doğrulanmış bir kullanıcı gelebilir,
    /// dolayısıyla değer pratikte daima mevcuttur. Yine de <c>0</c>'a düşüş
    /// sessizce "yetkisiz çağıran" anlamına gelir: servis katmanı bu kimlikle
    /// hiçbir rol veremez ve atanabilir rol listesi boş döner (fail-closed).
    /// </remarks>
    private int ActingUserId => _currentUser.UserId ?? 0;

    private ActionResult<AdminUserDetail> Respond(ServiceResult<AdminUserDetail> result)
    {
        if (result.IsSuccess)
        {
            return Ok(result.Value);
        }

        return result.ErrorKind switch
        {
            ServiceErrorKind.NotFound => NotFound(new { message = result.Error }),
            ServiceErrorKind.Conflict => Conflict(new { message = result.Error }),
            /* Yetki yükseltme reddi: istek geçerli, rol var — eksik olan
               çağıranın o rolü verme yetkisidir. Doğru karşılık 403'tür;
               400 "istek bozuk" der ve nedeni yanlış anlatırdı. */
            ServiceErrorKind.Forbidden => StatusCode(StatusCodes.Status403Forbidden, new { message = result.Error }),
            _ => BadRequest(new { message = result.Error })
        };
    }
}
