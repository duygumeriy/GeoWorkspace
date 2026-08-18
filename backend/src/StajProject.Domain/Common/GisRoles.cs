namespace StajProject.Domain.Common;

/// <summary>
/// Dinamik yetkilendirme mimarisinin hedef rolleri. Her biri bir <b>görev
/// profilini</b> temsil eder ("çizim üreticisi", "analist"), tekil bir yeteneği
/// değil.
/// </summary>
/// <remarks>
/// <para>
/// <b>Bu liste <see cref="ApplicationRoles.All"/> DEĞİLDİR ve ona eklenmez.</b>
/// <c>ApplicationRoles.All</c> hâlâ "yönetici onay ekranında atanabilecek
/// roller" anlamına gelir; onay akışı, rol değiştirme ucu ve
/// <c>ApplicationRoles.TryParse</c> hep oradan okur. Hedef roller bu fazda
/// yalnızca <i>tanımlanır ve yetkilendirilir</i>; atanabilir hale gelmeleri,
/// rol geçişinin bilinçli olarak yapılacağı sonraki bir fazın işidir.
/// İki listeyi şimdiden birleştirmek, onay ekranındaki rol listesini bu fazda
/// sessizce değiştirirdi.
/// </para>
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

    /// <summary>Seed edilen hedef roller.</summary>
    public static readonly IReadOnlyList<string> All =
    [
        Viewer,
        GisEditor,
        GisAnalyst,
        GisManager,
        Administrator
    ];
}
