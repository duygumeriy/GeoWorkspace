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
        PermissionCodes.InventoryAnalysis,

        /* Isı haritası ayrı bir yetkidir; analiste envanter analiziyle BİRLİKTE
           verilir çünkü ikisi de aynı rol profilinin analiz yeteneğidir. Ayrı
           satır olması, birinin diğerinden bağımsız geri alınabilmesi
           demektir — kod düzeyinde hiçbir ima kalmaz. */
        PermissionCodes.HeatmapView
    ];

    private static readonly string[] GisManagerPermissions =
    [
        .. GisEditorPermissions,
        PermissionCodes.InventoryAnalysis,
        PermissionCodes.HeatmapView,
        PermissionCodes.LayersManage
    ];

    /// <summary>Yönetici katalogdaki tüm yetkilere sahiptir.</summary>
    private static readonly string[] AdministratorPermissions =
        [.. PermissionCatalog.AllCodes];

    /// <summary>
    /// Rol adı → o role verilecek başlangıç yetki kodları.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, IReadOnlyList<string>> Matrix =
        new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal)
        {
            [GisRoles.Viewer] = ViewerPermissions,
            [GisRoles.GisEditor] = GisEditorPermissions,
            [GisRoles.GisAnalyst] = GisAnalystPermissions,
            [GisRoles.GisManager] = GisManagerPermissions,
            [GisRoles.Administrator] = AdministratorPermissions
        };

    /// <summary>
    /// Bir rolün başlangıç yetkileri. Matriste yer almayan roller (yöneticinin
    /// sonradan tanımladığı özel roller) için boş liste döner — seed onlara
    /// dokunmaz.
    /// </summary>
    public static IReadOnlyList<string> For(string roleName) =>
        Matrix.TryGetValue(roleName, out var permissions) ? permissions : [];
}
