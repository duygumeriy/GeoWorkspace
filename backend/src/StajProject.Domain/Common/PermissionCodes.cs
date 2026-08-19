namespace StajProject.Domain.Common;

/// <summary>
/// Kanonik yetki kodları. Yetkilendirme <b>yalnızca</b> bu kodlar üzerinden
/// çalışır; koda dağılmış <c>"drawings.delete"</c> string'leri kullanılmaz ve
/// Türkçe görünen adlar ASLA kimlik olarak kullanılmaz.
/// </summary>
/// <remarks>
/// <para>
/// <b>Kodlar değiştirilemez.</b> Veritabanındaki <c>permissions.code</c>
/// satırları ve onlara bağlı grant kayıtları bu değerlere göre eşleşir; bir
/// kodun yeniden adlandırılması, o yetkiye sahip herkesin yetkisini sessizce
/// kaybetmesi demektir.
/// </para>
/// <para>
/// <b>Kapsam koda gömülmez.</b> <c>drawings.view.own</c> / <c>drawings.view.all</c>
/// gibi türevler bilinçli olarak YOKTUR — kayıt kapsamı ayrı bir eksendir ve
/// sonraki bir fazda ele alınır.
/// </para>
/// </remarks>
public static class PermissionCodes
{
    /* --- Harita ---------------------------------------------------------------- */

    public const string MapView = "map.view";

    /* --- Çizim oluşturma ------------------------------------------------------- */

    public const string DrawingsPointCreate = "drawings.point.create";
    public const string DrawingsLineCreate = "drawings.line.create";
    public const string DrawingsPolygonCreate = "drawings.polygon.create";

    /* --- Çizim yönetimi -------------------------------------------------------- */

    public const string DrawingsView = "drawings.view";
    public const string DrawingsMetadataUpdate = "drawings.metadata.update";
    public const string DrawingsGeometryUpdate = "drawings.geometry.update";
    public const string DrawingsStyleUpdate = "drawings.style.update";
    public const string DrawingsDelete = "drawings.delete";
    public const string DrawingsRestore = "drawings.restore";

    /* --- Araçlar --------------------------------------------------------------- */

    public const string MeasurementUse = "measurement.use";
    public const string SelectionUse = "selection.use";

    /* --- Envanter -------------------------------------------------------------- */

    public const string InventoryView = "inventory.view";
    public const string InventoryAnalysis = "inventory.analysis";

    /* --- Katmanlar ------------------------------------------------------------- */

    public const string LayersView = "layers.view";
    public const string LayersManage = "layers.manage";

    /* --- Kullanıcılar ---------------------------------------------------------- */

    public const string UsersView = "users.view";
    public const string UsersCreate = "users.create";
    public const string UsersUpdate = "users.update";
    public const string UsersDeactivate = "users.deactivate";
    public const string UsersDelete = "users.delete";

    /* --- Roller ---------------------------------------------------------------- */

    public const string RolesView = "roles.view";
    public const string RolesCreate = "roles.create";
    public const string RolesUpdate = "roles.update";
    public const string RolesDelete = "roles.delete";

    /* --- Yetkiler -------------------------------------------------------------- */

    public const string PermissionsView = "permissions.view";
    public const string PermissionsAssign = "permissions.assign";

    /* --- Coğrafi yetkilendirme ------------------------------------------------- */

    /* Coğrafi yetki alanı yönetimi ayrı bir güvenlik yeteneğidir ve bilinçli
       olarak users.update / roles.update altına GİZLENMEZ: coğrafi alan
       yalnızca bir kullanıcı alanı değil, o kullanıcının nerede veri
       üretebileceğini belirleyen bir sınırdır. Kullanıcı düzenleme yetkisinin
       sessizce bu sınırı da kaldırabilmesi, yetki yükseltmeye açık kapı
       bırakırdı. */

    public const string GeographyView = "geography.view";
    public const string GeographyManage = "geography.manage";

    /// <summary>EF <c>HasMaxLength</c> ile aynı sınır.</summary>
    public const int MaxLength = 128;
}
