namespace StajProject.Domain.Common;

/// <summary>
/// Dinamik yetkilendirme mimarisinin hedef rolleri. Her biri bir <b>görev
/// profilini</b> temsil eder ("çizim üreticisi", "analist"), tekil bir yeteneği
/// değil.
/// </summary>
/// <remarks>
/// <para>
/// Rol adları veritabanındaki <c>roles.Name</c> değerleridir ve
/// değiştirilemez: mevcut atamalar bu adlara bağlıdır.
/// </para>
/// </remarks>
public static class GisRoles
{
    /// <summary>Salt okuma ağırlıklı GIS kullanıcısı.</summary>
    public const string Viewer = "Viewer";

    /// <summary>Normal GIS veri üreticisi.</summary>
    public const string GisEditor = "GIS Editor";

    /// <summary>Analiz odaklı kullanıcı; operasyonel veriyi düzenlemez.</summary>
    public const string GisAnalyst = "GIS Analyst";

    /// <summary>GIS verisi ve katman yöneticisi.</summary>
    public const string GisManager = "GIS Manager";

    /// <summary>Sistem yöneticisi; kullanıcı, rol ve yetki yönetimi dahil.</summary>
    public const string Administrator = "Administrator";

    /// <summary>Durak verisini yöneten ulaşım operasyon kullanıcısı.</summary>
    public const string TransportOperator = "Ulaşım Operatörü";

    /// <summary>Ulaşım ağı ve POI verisini salt okuyan kullanıcı.</summary>
    public const string TransportUser = "Ulaşım Kullanıcısı";

    /// <summary>Seed edilen hedef roller.</summary>
    public static readonly IReadOnlyList<string> All =
    [
        Viewer,
        GisEditor,
        GisAnalyst,
        GisManager,
        TransportOperator,
        TransportUser,
        Administrator
    ];
}
