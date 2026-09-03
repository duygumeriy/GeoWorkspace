namespace StajProject.Domain.Entities;

/// <summary>
/// Kalıcı güzergahın tek bir OTORİTER seyir manevrası.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden saklanıyor.</b> Navigasyon, hattın ömrü boyunca KARARLI olmalıdır:
/// aynı çalıştırmayı izleyen iki kullanıcı aynı talimatı görmelidir ve talimat
/// sayfa yenilendiğinde değişmemelidir. Manevraları her simülasyon tick'inde,
/// her canlı güncellemede ya da her gözlemci için yeniden hesaplamak, aynı
/// hattın navigasyonunu dış bir servise ve o servisin o anki sürümüne
/// bağlardı. Adımlar bu yüzden YOLUN ÜRETİLDİĞİ ANDA, yolla birlikte ve aynı
/// kayıt işleminde yazılır.
/// </para>
/// <para>
/// <b>Geometriyle birlikte yaşar ve birlikte ölür.</b> Yol yeniden
/// üretildiğinde eski adımlar silinip yenileri yazılır; "yeni geometri + eski
/// adımlar" ya da tersi bir an bile var olmaz. Silme davranışı bu yüzden
/// yola CASCADE'dir: yolun kendisi olmadan bir adım hiçbir şey ifade etmez.
/// </para>
/// <para>
/// <b>Kişisel yolculuktan AYRIDIR.</b> Kişisel planlamanın manevra modeli
/// (<c>JourneyRouteStep</c>) süreç içi ve geçicidir; buradaki kayıt paylaşılan
/// hattın kalıcı gerçeğidir. İkisini tek tabloda birleştirmek, iki ürünün
/// yaşam döngüsünü birbirine düğümlerdi.
/// </para>
/// </remarks>
public class TransportRoutePathStep
{
    public const int MaxManeuverTypeLength = 64;
    public const int MaxManeuverModifierLength = 32;
    public const int MaxNameLength = 200;

    public int Id { get; set; }

    public int PathId { get; set; }

    public TransportRoutePath? Path { get; set; }

    /// <summary>
    /// Güzergah boyunca artan, sıfır tabanlı OTORİTER sıra.
    /// </summary>
    /// <remarks>
    /// <b>Dizi konumu bir kimlik DEĞİLDİR.</b> Adımlar tel üzerinde sıralı
    /// gitse bile istemci onları filtreleyebilir, sıralayabilir ya da kısmen
    /// alabilir; "üçüncü eleman" ile "3 numaralı adım" aynı şey olmak zorunda
    /// değildir. Çözümleme daima bu değere göre yapılır.
    /// </remarks>
    public int Sequence { get; set; }

    /// <summary>Kararlı manevra türü (ör. <c>turn</c>, <c>depart</c>, <c>arrive</c>).</summary>
    public string ManeuverType { get; set; } = string.Empty;

    /// <summary>Manevra yönü (ör. <c>left</c>, <c>slight right</c>); yoksa <c>null</c>.</summary>
    public string? ManeuverModifier { get; set; }

    /// <summary>Yol/sokak adı; motor vermiyorsa <c>null</c>.</summary>
    public string? Name { get; set; }

    /// <summary>Adımın KENDİ uzunluğu.</summary>
    public double DistanceMeters { get; set; }

    /// <summary>Adımın KENDİ süresi.</summary>
    public double DurationSeconds { get; set; }

    /// <summary>
    /// Güzergahın BAŞINDAN adımın başlangıcına olan kümülatif mesafe.
    /// </summary>
    /// <remarks>
    /// "Araç şu anda hangi manevrada?" sorusunun cevabı buradan gelir. Sınırı
    /// saklamak yerine her tick'te adım uzunluklarını toplamak, aynı sabit
    /// veriyi saniyede bir yeniden hesaplamak olurdu.
    /// </remarks>
    public double StartDistanceMeters { get; set; }

    /// <summary>Güzergahın başından adımın bitişine olan kümülatif mesafe.</summary>
    public double EndDistanceMeters { get; set; }
}
