using StajProject.Domain.Common;

namespace StajProject.Api.Activity;

/// <summary>
/// Hangi MVC action'ının aktivite kaydına yazılacağını söyleyen <b>izin
/// listesi</b>.
/// </summary>
/// <remarks>
/// <para>
/// <b>İzin listesi, yasak listesi DEĞİL.</b> Kaydedilecek uçlar tek tek burada
/// yazılıdır; listede olmayan hiçbir uç kaydedilmez. Ters yaklaşım — "şunlar
/// hariç her mutasyonu kaydet" — yeni eklenen bir oturum/parola ucunun
/// kaydedilenler kümesine SESSİZCE girmesi demekti. Bu tasarımda oturum açma,
/// parola sıfırlama, 2FA ve e-posta doğrulama uçları listede olmadıkları için
/// yapısal olarak kaydedilemezler.
/// </para>
/// <para>
/// <b>Anahtar controller + action ADIDIR, rota değil.</b> Rotadan türetmek,
/// bir yolun yeniden yazılmasını geçmişle eşleşmeyen yeni bir kelime
/// dağarcığına çevirirdi. Buradaki eşleme derleyicinin gördüğü isimlere
/// bağlıdır; bir action yeniden adlandırılırsa eşleme sessizce kaybolur ve
/// ilgili test bunu yakalar.
/// </para>
/// <para>
/// <b>Okuma uçları burada YOKTUR.</b> Listeleme ve detay çağrıları kayda
/// girmez; tablo bir istek izi değil, "kim neyi değiştirdi" defteridir.
/// </para>
/// </remarks>
public static class ActivityActionRegistry
{
    /// <param name="Action">Kanonik işlem kodu.</param>
    /// <param name="ResourceType">Etkilenen kaynağın türü.</param>
    /// <param name="ResourceRouteKey">
    /// Kaynak kimliğinin okunacağı ROTA değeri. Gövdeden değil rotadan
    /// okunması bilinçlidir: rota değerleri şema tarafından kısıtlanmış
    /// skalerlerdir, gövde ise keyfi metin taşır.
    /// </param>
    public sealed record Descriptor(string Action, string ResourceType, string? ResourceRouteKey);

    private const string User = "user";
    private const string Role = "role";
    private const string Drawing = "drawing";
    private const string Poi = "poi";
    private const string PoiCategory = "poi_category";

    private static readonly IReadOnlyDictionary<string, Descriptor> Map =
        new Dictionary<string, Descriptor>(StringComparer.Ordinal)
        {
            /* --- Coğrafi yetki: çoklu alan ------------------------------------
               Kaynak, alanın SAHİBİ olan kullanıcı/roldür ("kimin sınırı
               değişti"); alanın kendi kimliği ayrıntılara girer. */
            ["AdminUsers.CreateUserGeographicArea"] = new(ActivityActionCatalog.GeographicAreaCreate, User, "id"),
            ["AdminUsers.UpdateUserGeographicArea"] = new(ActivityActionCatalog.GeographicAreaUpdate, User, "id"),
            ["AdminUsers.DeleteUserGeographicArea"] = new(ActivityActionCatalog.GeographicAreaDelete, User, "id"),
            ["AdminRoles.CreateRoleGeographicArea"] = new(ActivityActionCatalog.GeographicAreaCreate, Role, "id"),
            ["AdminRoles.UpdateRoleGeographicArea"] = new(ActivityActionCatalog.GeographicAreaUpdate, Role, "id"),
            ["AdminRoles.DeleteRoleGeographicArea"] = new(ActivityActionCatalog.GeographicAreaDelete, Role, "id"),

            /* --- Coğrafi yetki: tekil (uyumluluk) ----------------------------- */
            ["AdminUsers.ReplaceUserGeographicAuthorization"] = new(ActivityActionCatalog.GeographicScopeReplace, User, "id"),
            ["AdminUsers.DeleteUserGeographicAuthorization"] = new(ActivityActionCatalog.GeographicScopeClear, User, "id"),
            ["AdminRoles.ReplaceRoleGeographicAuthorization"] = new(ActivityActionCatalog.GeographicScopeReplace, Role, "id"),
            ["AdminRoles.DeleteRoleGeographicAuthorization"] = new(ActivityActionCatalog.GeographicScopeClear, Role, "id"),

            /* --- Kullanıcı yönetimi -------------------------------------------- */
            ["AdminUsers.ChangeRole"] = new(ActivityActionCatalog.UserRoleChange, User, "id"),
            ["AdminUsers.ChangeStatus"] = new(ActivityActionCatalog.UserStatusChange, User, "id"),
            ["AdminUsers.Approve"] = new(ActivityActionCatalog.UserApprove, User, "id"),
            ["AdminUsers.Reject"] = new(ActivityActionCatalog.UserReject, User, "id"),
            ["AdminUsers.ReplaceUserPermissions"] = new(ActivityActionCatalog.UserPermissionsReplace, User, "id"),

            /* --- Rol yönetimi --------------------------------------------------- */
            ["AdminRoles.CreateRole"] = new(ActivityActionCatalog.RoleCreate, Role, null),
            ["AdminRoles.RenameRole"] = new(ActivityActionCatalog.RoleRename, Role, "id"),
            ["AdminRoles.DeleteRole"] = new(ActivityActionCatalog.RoleDelete, Role, "id"),
            ["AdminRoles.ReplaceRolePermissions"] = new(ActivityActionCatalog.RolePermissionsReplace, Role, "id"),

            /* --- Çizimler --------------------------------------------------------
               Çizim kayıtları da denetime girer: coğrafi yetkinin ne işe
               yaradığı ancak "kim nereye çizdi" ile birlikte okunabilir. */
            ["Drawings.CreatePoint"] = new(ActivityActionCatalog.DrawingCreate, Drawing, null),
            ["Drawings.CreateLine"] = new(ActivityActionCatalog.DrawingCreate, Drawing, null),
            ["Drawings.CreatePolygon"] = new(ActivityActionCatalog.DrawingCreate, Drawing, null),
            ["Drawings.UpdatePoint"] = new(ActivityActionCatalog.DrawingUpdate, Drawing, "id"),
            ["Drawings.UpdateLine"] = new(ActivityActionCatalog.DrawingUpdate, Drawing, "id"),
            ["Drawings.UpdatePolygon"] = new(ActivityActionCatalog.DrawingUpdate, Drawing, "id"),
            ["Drawings.UpdatePointStyle"] = new(ActivityActionCatalog.DrawingStyleUpdate, Drawing, "id"),
            ["Drawings.UpdateLineStyle"] = new(ActivityActionCatalog.DrawingStyleUpdate, Drawing, "id"),
            ["Drawings.UpdatePolygonStyle"] = new(ActivityActionCatalog.DrawingStyleUpdate, Drawing, "id"),
            ["Drawings.DeletePoint"] = new(ActivityActionCatalog.DrawingDelete, Drawing, "id"),
            ["Drawings.DeleteLine"] = new(ActivityActionCatalog.DrawingDelete, Drawing, "id"),
            ["Drawings.DeletePolygon"] = new(ActivityActionCatalog.DrawingDelete, Drawing, "id"),
            ["Drawings.BulkCreate"] = new(ActivityActionCatalog.DrawingBulkCreate, Drawing, null),
            ["Drawings.BulkDelete"] = new(ActivityActionCatalog.DrawingBulkDelete, Drawing, null),
            ["Drawings.BulkStyle"] = new(ActivityActionCatalog.DrawingBulkStyle, Drawing, null),
            ["Drawings.Restore"] = new(ActivityActionCatalog.DrawingRestore, Drawing, null),

            /* --- POI ------------------------------------------------------------
               Okuma uçları (harita listesi, kategori listesi, yönetim listesi)
               burada YOKTUR; tablo bir istek izi değil, "kim neyi değiştirdi"
               defteridir. */
            ["Poi.CreatePoi"] = new(ActivityActionCatalog.PoiCreate, Poi, null),
            /* Mutasyon uçları kaydın kimliğini ROTADAN taşır; çizim
               uçlarındaki "id" sözleşmesinin aynısı. */
            ["Poi.UpdatePoi"] = new(ActivityActionCatalog.PoiUpdate, Poi, "id"),
            ["Poi.DeletePoi"] = new(ActivityActionCatalog.PoiDelete, Poi, "id"),
            ["Poi.RestorePoi"] = new(ActivityActionCatalog.PoiRestore, Poi, "id"),
            ["AdminPoi.CreateCategory"] = new(ActivityActionCatalog.PoiCategoryCreate, PoiCategory, null),
            ["AdminPoi.UpdateCategory"] = new(ActivityActionCatalog.PoiCategoryUpdate, PoiCategory, "id")
        };

    /// <summary>Kayıt tablosundaki tüm anahtarlar — testlerin okuduğu yüzey.</summary>
    public static IReadOnlyCollection<string> Keys => (IReadOnlyCollection<string>)Map.Keys;

    /// <summary>
    /// Bu action kaydedilecek mi; kaydedilecekse hangi kodla. Eşleşme yoksa
    /// <c>null</c> — ve kayıt hiç oluşmaz.
    /// </summary>
    public static Descriptor? Find(string? controllerName, string? actionName) =>
        controllerName is null || actionName is null
            ? null
            : Map.GetValueOrDefault($"{controllerName}.{actionName}");
}
