namespace StajProject.Domain.Common;

/// <summary>
/// Aktivite kaydına yazılabilecek KANONİK işlem kodları ve Türkçe karşılıkları.
/// </summary>
/// <remarks>
/// <para>
/// <b>Kodlar kimliktir ve değiştirilemez.</b> Geçmiş satırlar bu değerlerle
/// yazılmıştır; bir kodun yeniden adlandırılması, o işlemin tüm geçmişinin
/// filtrelerden ve etiketlerden düşmesi demektir. Türkçe ad ise yalnızca
/// gösterimdir ve serbestçe düzeltilebilir.
/// </para>
/// <para>
/// <b>Katalog bir izin listesidir.</b> Bir uç ancak burada karşılığı olan bir
/// kod ile eşlendiğinde kaydedilir (bkz. API katmanındaki kayıt tablosu).
/// Bu, kaydın kapsamını bir "neyi hariç tutayım" listesine değil, açık bir
/// "neyi kaydediyorum" listesine bağlar: oturum açma, parola sıfırlama ve 2FA
/// uçları burada olmadıkları için hiç kaydedilemezler.
/// </para>
/// </remarks>
public static class ActivityActionCatalog
{
    /// <param name="Code">Kanonik kod — kimlik budur.</param>
    /// <param name="Name">Arayüzde gösterilen Türkçe ad.</param>
    public sealed record Definition(string Code, string Name);

    /* --- Coğrafi yetki --------------------------------------------------------- */

    public const string GeographicAreaCreate = "geographic_area.create";
    public const string GeographicAreaUpdate = "geographic_area.update";
    public const string GeographicAreaDelete = "geographic_area.delete";
    public const string GeographicScopeReplace = "geographic_scope.replace";
    public const string GeographicScopeClear = "geographic_scope.clear";

    /* --- Kullanıcı yönetimi ---------------------------------------------------- */

    public const string UserRoleChange = "user.role_change";
    public const string UserStatusChange = "user.status_change";
    public const string UserApprove = "user.approve";
    public const string UserReject = "user.reject";
    public const string UserPermissionsReplace = "user.permissions_replace";

    /* --- Rol yönetimi ---------------------------------------------------------- */

    public const string RoleCreate = "role.create";
    public const string RoleRename = "role.rename";
    public const string RoleDelete = "role.delete";
    public const string RolePermissionsReplace = "role.permissions_replace";

    /* --- Çizimler -------------------------------------------------------------- */

    public const string DrawingCreate = "drawing.create";
    public const string DrawingUpdate = "drawing.update";
    public const string DrawingStyleUpdate = "drawing.style_update";
    public const string DrawingDelete = "drawing.delete";
    public const string DrawingRestore = "drawing.restore";
    public const string DrawingBulkCreate = "drawing.bulk_create";
    public const string DrawingBulkDelete = "drawing.bulk_delete";
    public const string DrawingBulkStyle = "drawing.bulk_style";

    /* --- POI ------------------------------------------------------------------
       POI mutasyonları da denetime girer: ortak bir envanterde kimin ne
       eklediği ve taksonomiyi kimin değiştirdiği, çizimlerde olduğu gibi
       geriye dönük açıklanabilir olmalıdır. */

    public const string PoiCreate = "poi.create";
    public const string PoiUpdate = "poi.update";
    public const string PoiDelete = "poi.delete";
    public const string PoiRestore = "poi.restore";
    public const string PoiCategoryCreate = "poi_category.create";
    public const string PoiCategoryUpdate = "poi_category.update";

    /* --- Akıllı ulaşım ------------------------------------------------------- */

    public const string TransportRouteCreate = "transport.route.create";
    public const string TransportRouteUpdate = "transport.route.update";
    public const string TransportRouteDelete = "transport.route.delete";
    public const string TransportRouteRestore = "transport.route.restore";
    public const string TransportRouteReorder = "transport.route.reorder";
    public const string TransportRouteGenerate = "transport.route.generate";
    public const string TransportStopCreate = "transport.stop.create";
    public const string TransportStopUpdate = "transport.stop.update";
    public const string TransportStopDelete = "transport.stop.delete";
    public const string TransportStopRestore = "transport.stop.restore";
    public const string TransportStopTransfer = "transport.stop.transfer";
    public const string TransportStopCoordinateMove = "transport.stop.coordinate_move";

    /// <summary>Kanonik katalog.</summary>
    public static readonly IReadOnlyList<Definition> All =
    [
        new(GeographicAreaCreate, "Coğrafi yetki alanı oluşturuldu"),
        new(GeographicAreaUpdate, "Coğrafi yetki alanı güncellendi"),
        new(GeographicAreaDelete, "Coğrafi yetki alanı kaldırıldı"),
        new(GeographicScopeReplace, "Coğrafi yetki alanı değiştirildi"),
        new(GeographicScopeClear, "Coğrafi yetki kaldırıldı"),

        new(UserRoleChange, "Kullanıcı rolü değiştirildi"),
        new(UserStatusChange, "Kullanıcı durumu değiştirildi"),
        new(UserApprove, "Kullanıcı başvurusu onaylandı"),
        new(UserReject, "Kullanıcı başvurusu reddedildi"),
        new(UserPermissionsReplace, "Kullanıcı yetkileri güncellendi"),

        new(RoleCreate, "Rol oluşturuldu"),
        new(RoleRename, "Rol yeniden adlandırıldı"),
        new(RoleDelete, "Rol silindi"),
        new(RolePermissionsReplace, "Rol yetkileri güncellendi"),

        new(DrawingCreate, "Çizim oluşturuldu"),
        new(DrawingUpdate, "Çizim güncellendi"),
        new(DrawingStyleUpdate, "Çizim stili değiştirildi"),
        new(DrawingDelete, "Çizim silindi"),
        new(DrawingRestore, "Çizim geri yüklendi"),
        new(DrawingBulkCreate, "Toplu çizim oluşturuldu"),
        new(DrawingBulkDelete, "Toplu çizim silindi"),
        new(DrawingBulkStyle, "Toplu çizim stili değiştirildi"),

        new(PoiCreate, "POI oluşturuldu"),
        new(PoiUpdate, "POI güncellendi"),
        new(PoiDelete, "POI silindi"),
        new(PoiRestore, "POI geri yüklendi"),
        new(PoiCategoryCreate, "POI kategorisi oluşturuldu"),
        new(PoiCategoryUpdate, "POI kategorisi güncellendi"),

        new(TransportRouteCreate, "Güzergah oluşturuldu"),
        new(TransportRouteUpdate, "Güzergah güncellendi"),
        new(TransportRouteDelete, "Güzergah silindi"),
        new(TransportRouteRestore, "Güzergah geri yüklendi"),
        new(TransportRouteReorder, "Durak sırası güncellendi"),
        new(TransportRouteGenerate, "Güzergah rota hesaplama işlemi"),
        new(TransportStopCreate, "Durak oluşturuldu"),
        new(TransportStopUpdate, "Durak güncellendi"),
        new(TransportStopDelete, "Durak silindi"),
        new(TransportStopRestore, "Durak geri yüklendi"),
        new(TransportStopTransfer, "Durak başka güzergaha taşındı"),
        new(TransportStopCoordinateMove, "Durak konumu güncellendi")
    ];

    private static readonly IReadOnlyDictionary<string, string> Names =
        All.ToDictionary(d => d.Code, d => d.Name, StringComparer.Ordinal);

    /// <summary>
    /// Kodun Türkçe karşılığı. Tanınmayan bir kod için KODUN KENDİSİ döner —
    /// boş bir etiket, satırı okunamaz kılardı.
    /// </summary>
    public static string NameOf(string code) =>
        Names.TryGetValue(code, out var name) ? name : code;

    public static IReadOnlyList<string> AllCodes { get; } = [.. All.Select(d => d.Code)];
}
