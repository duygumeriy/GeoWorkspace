namespace StajProject.Domain.Common;

/// <summary>
/// Yetki kataloğunun gruplama etiketleri. Yalnızca gösterim amaçlıdır —
/// hiçbir yetkilendirme kararı kategoriye bakarak verilmez.
/// </summary>
/// <remarks>
/// Kategori adları, kodlardan farklı olarak İngilizce ve teknik tutulur:
/// veritabanında gruplama anahtarı olarak durur, kullanıcıya doğrudan
/// gösterilecek metin değildir.
/// </remarks>
public static class PermissionCategories
{
    public const string Map = "Map";
    public const string DrawingCreate = "DrawingCreate";
    public const string DrawingManagement = "DrawingManagement";
    public const string Tools = "Tools";
    public const string Inventory = "Inventory";
    public const string Heatmap = "Heatmap";
    public const string Layers = "Layers";
    public const string Users = "Users";
    public const string Roles = "Roles";
    public const string Permissions = "Permissions";
    public const string Geography = "Geography";
    public const string Audit = "Audit";
    public const string Poi = "Poi";

    /// <summary>EF <c>HasMaxLength</c> ile aynı sınır.</summary>
    public const int MaxLength = 64;
}
