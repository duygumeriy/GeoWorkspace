namespace StajProject.Domain.Common;

/// <summary>
/// Rollerin başlangıç yetki matrisi. Seed bu tablodan çalışır.
/// </summary>
/// <remarks>
/// <para>
/// <b>Başlangıç değeridir, kural değil.</b> Matris yalnızca rol ilk kez
/// yetkilendirilirken uygulanır; bir yöneticinin sonradan yaptığı yetki
/// değişiklikleri yeniden başlatmada geri alınmaz (bkz. seeder). Kataloğa
/// sonradan eklenen bir yetkinin mevcut kurulumlardaki ayrıcalıklı rollere
/// ulaşması ayrı ve dar kapsamlı bir yoldan olur:
/// <see cref="RolePermissionExpansions"/>.
/// </para>
/// <para>
/// <b>Legacy roller.</b> <c>Admin</c> ve <c>User</c> hâlâ çalışan kimlik
/// doğrulama/yetkilendirme kodunun bağlı olduğu gerçek rollerdir. Yetki
/// denetimi sonraki fazda devreye girdiğinde bu hesapların erişimi bir anda
/// kesilmesin diye, legacy roller hedef karşılıklarıyla <b>birebir aynı</b>
/// yetki profilini alır:
/// <list type="bullet">
/// <item><c>Admin</c> → <see cref="GisRoles.Administrator"/> profili</item>
/// <item><c>User</c> → <see cref="GisRoles.GisEditor"/> profili</item>
/// </list>
/// Bu, legacy rollerin kalıcı olduğu anlamına gelmez; rol geçişi
/// tamamlandığında kaldırılmaları ayrı ve bilinçli bir adımdır.
/// </para>
/// </remarks>
public static class RolePermissionDefaults
{
    /* --- Profiller ------------------------------------------------------------
       Profiller birbirinin üzerine kurulur; bu sayede "GIS Editor, Viewer'ın
       yapabildiği her şeyi yapabilir" ilişkisi listeyi elle çoğaltmak yerine
       yapının kendisinde durur ve iki liste ayrışamaz. */

    private static readonly string[] ViewerPermissions =
    [
        PermissionCodes.MapView,
        PermissionCodes.DrawingsView,
        PermissionCodes.MeasurementUse,
        PermissionCodes.SelectionUse,
        PermissionCodes.InventoryView,
        PermissionCodes.LayersView
    ];

    private static readonly string[] GisEditorPermissions =
    [
        .. ViewerPermissions,

        PermissionCodes.DrawingsPointCreate,
        PermissionCodes.DrawingsLineCreate,
        PermissionCodes.DrawingsPolygonCreate,

        PermissionCodes.DrawingsMetadataUpdate,
        PermissionCodes.DrawingsGeometryUpdate,
        PermissionCodes.DrawingsStyleUpdate,

        PermissionCodes.DrawingsDelete,
        PermissionCodes.DrawingsRestore
    ];

    /* Analist, Editor'ün türevi DEĞİLDİR: çizim düzenleme yetkileri bilinçli
       olarak yoktur. Viewer'a yalnızca analiz eklenir. */
    private static readonly string[] GisAnalystPermissions =
    [
        .. ViewerPermissions,
        PermissionCodes.InventoryAnalysis
    ];

    private static readonly string[] GisManagerPermissions =
    [
        .. GisEditorPermissions,
        PermissionCodes.InventoryAnalysis,
        PermissionCodes.LayersManage
    ];

    /// <summary>Yönetici katalogdaki tüm yetkilere sahiptir.</summary>
    private static readonly string[] AdministratorPermissions =
        [.. PermissionCatalog.AllCodes];

    /// <summary>
    /// Rol adı → o role verilecek yetki kodları. Hem hedef hem legacy rolleri
    /// içerir; seed tek bir yerden çalışsın diye ayrı tutulmazlar.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, IReadOnlyList<string>> Matrix =
        new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal)
        {
            [GisRoles.Viewer] = ViewerPermissions,
            [GisRoles.GisEditor] = GisEditorPermissions,
            [GisRoles.GisAnalyst] = GisAnalystPermissions,
            [GisRoles.GisManager] = GisManagerPermissions,
            [GisRoles.Administrator] = AdministratorPermissions,

            // Geçiş dönemi: legacy roller hedef karşılıklarının profilini alır.
            [ApplicationRoles.Admin] = AdministratorPermissions,
            [ApplicationRoles.User] = GisEditorPermissions
        };

    /// <summary>
    /// Bir rolün başlangıç yetkileri. Matriste yer almayan roller (yöneticinin
    /// sonradan tanımladığı özel roller) için boş liste döner — seed onlara
    /// dokunmaz.
    /// </summary>
    public static IReadOnlyList<string> For(string roleName) =>
        Matrix.TryGetValue(roleName, out var permissions) ? permissions : [];
}
