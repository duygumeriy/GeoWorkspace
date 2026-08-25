namespace StajProject.Domain.Common;

/// <summary>
/// POI kategorilerinin denetimli renk paleti: sektör başına bir renk.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden palet, neden kategori başına serbest renk değil.</b> Kırk dört
/// kategoriye bağımsız renk seçilseydi harita, birbirinden ayırt edilemeyen
/// yakın tonlardan oluşan bir gürültüye dönerdi ve efsane (legend) okunamaz
/// olurdu. Sektör bazlı bir palet, "aynı aileden" kategorileri bakışta
/// gruplanabilir kılar.
/// </para>
/// <para>
/// <b>Palet bir kısıt DEĞİL, bir varsayılandır.</b> Doğrulama
/// <c>#RRGGBB</c> biçimine bakar, paletle eşitliğe değil: yönetici bilinçli
/// olarak palet dışı bir renk seçebilir. Burada sayılan değerler kanonik
/// taksonominin kaynağıdır ve arayüzün önerdiği seçeneklerdir.
/// </para>
/// </remarks>
public static class PoiCategoryPalette
{
    /// <summary>Sağlık.</summary>
    public const string Health = "#EF4444";

    /// <summary>Eğitim ve enerji.</summary>
    public const string EducationEnergy = "#F59E0B";

    /// <summary>Yeme-içme.</summary>
    public const string Food = "#F97316";

    /// <summary>Doğa ve tarım.</summary>
    public const string Nature = "#22C55E";

    /// <summary>Ulaşım, konut ve spor.</summary>
    public const string Transport = "#3B82F6";

    /// <summary>Kamu, askeri ve sanayi.</summary>
    public const string Government = "#334155";

    /// <summary>Ticaret, alışveriş ve önemli noktalar.</summary>
    public const string Commerce = "#8B5CF6";

    /// <summary>Finans, altyapı ve sivil toplum.</summary>
    public const string Finance = "#06B6D4";

    /// <summary>Kültür, turizm ve dini tesisler.</summary>
    public const string Culture = "#A855F7";

    /// <summary>Sosyal ve eğlence.</summary>
    public const string Social = "#EC4899";

    /// <summary>
    /// Rengi olmayan (göç öncesi) kayıtların render tarafındaki yedeği.
    /// </summary>
    /// <remarks>
    /// Nötr bir slate tonudur: hiçbir sektör ailesine ait değildir, dolayısıyla
    /// "rengi belirlenmemiş" durumu bir sektör rengiyle karıştırılamaz.
    /// <b>Veritabanına yazılmaz</b> — eksik metadata, sessizce doldurulmuş
    /// yanlış metadatadan daha dürüsttür.
    /// </remarks>
    public const string Fallback = "#64748B";

    /// <summary>Arayüzün önereceği palet; sıra sektör gruplamasını izler.</summary>
    public static readonly IReadOnlyList<string> All =
    [
        Health,
        EducationEnergy,
        Food,
        Nature,
        Transport,
        Government,
        Commerce,
        Finance,
        Culture,
        Social
    ];
}
