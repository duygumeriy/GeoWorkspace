namespace StajProject.Domain.Entities;

/// <summary>
/// Kullanıcının KENDİSİNE ait, yeniden kullanılabilir kişisel yolculuk TANIMI.
/// </summary>
/// <remarks>
/// <para>
/// <b>Bu bir simülasyon anlık görüntüsü DEĞİLDİR.</b> Kayıtta çalıştırma
/// kimliği, ilerleme, anlık koordinat, güncel manevra, duraklama/çalışma
/// durumu, canlı varış tahmini ya da takip bilgisi YOKTUR ve olmamalıdır.
/// Saklanan tek şey NİYETTİR: hangi kip, hangi profil, hangi kalıcı kayıtlar
/// ve hangi sırayla. Çalışma zamanı durumu saklansaydı, "yeniden kullan"
/// eylemi ölü bir çalıştırmayı diriltmeye çalışırdı; oysa her yeniden kullanım
/// YENİ bir çalıştırmadır.
/// </para>
/// <para>
/// <b>Güzergah geometrisi de saklanmaz.</b> POI taşınabilir, durak
/// taşınabilir, yol ağı değişebilir. Kaydedilen niyet otoriterdir; geometri
/// her yeniden kullanımda motordan TAZE üretilir.
/// </para>
/// <para>
/// <b>Sahiplik <see cref="UserId"/>'dir</b> ve daima doğrulanmış JWT
/// kimliğinden yazılır; istek gövdesinden asla okunmaz. POI sahipliğiyle aynı
/// silme davranışı geçerlidir (FK <c>Restrict</c>): kullanıcı kaydı silinmeye
/// çalışıldığında yolculuk korunur.
/// </para>
/// <para>
/// <b><see cref="IAuditableEntity"/> uygulanmaz.</b> Kayıt için bir çöp
/// kutusu, geri yükleme ucu ya da "pasif kaydedilmiş yolculuk" kavramı
/// yoktur; <c>is_deleted</c>/<c>is_active</c> kolonları hiçbir zaman
/// okunmayacak ölü veri olurdu. Silme bu yüzden GERÇEK silmedir ve noktalar
/// FK <c>Cascade</c> ile birlikte gider.
/// </para>
/// </remarks>
public class SavedJourney
{
    /// <summary>EF <c>HasMaxLength</c> ve doğrulama ile aynı sınır.</summary>
    public const int MaxNameLength = 120;

    /// <summary>Kip/profil gibi sözleşme metinlerinin ortak sınırı.</summary>
    public const int MaxContractLength = 32;

    /// <summary>Yalnızca gösterim amaçlı ad kopyalarının sınırı.</summary>
    public const int MaxDisplayNameLength = 200;

    public int Id { get; set; }

    /// <summary>Sahibi; okumanın ve yazmanın TEK yetkisi.</summary>
    public int UserId { get; set; }

    public User? User { get; set; }

    /// <summary>Kullanıcının verdiği ad. Sahip içinde benzersiz DEĞİLDİR.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// <c>routeFull</c>, <c>routeSegment</c> veya <c>waypoints</c>.
    /// </summary>
    /// <remarks>
    /// Kip METİN olarak saklanır çünkü tel sözleşmesi de metindir
    /// (<c>JourneyContractNames</c>); ikinci bir sayısal eşleme, aynı kavram
    /// için zamanla ayrışabilecek iki dil demekti.
    /// </remarks>
    public string Mode { get; set; } = string.Empty;

    /// <summary><c>driving</c>, <c>walking</c> veya <c>cycling</c>.</summary>
    public string Profile { get; set; } = string.Empty;

    /// <summary>
    /// Rota tabanlı kiplerde hattın kimliği; serbest kipte <c>null</c>.
    /// </summary>
    /// <remarks>
    /// <b>Veritabanı yabancı anahtarı BİLİNÇLİ olarak yoktur.</b> Kişisel bir
    /// kaydın, paylaşılan ulaşım verisinin yaşam döngüsünü kısıtlaması
    /// istenmez; referans her yeniden kullanımda uygulama katmanında çözülür ve
    /// çözülemezse istek reddedilir.
    /// </remarks>
    public int? RouteId { get; set; }

    /// <summary>
    /// Hattın kaydetme anındaki adı — YALNIZCA listede okunabilirlik içindir.
    /// </summary>
    /// <remarks>
    /// Otorite DEĞİLDİR: yeniden kullanımda hattın GÜNCEL adı ve güncel
    /// durakları kullanılır. Liste satırı uğruna her okumada ulaşım tablolarına
    /// katılmamak için tutulur.
    /// </remarks>
    public string? RouteDisplayName { get; set; }

    /// <summary>Kullanıcının kendi listesindeki yıldızı.</summary>
    public bool IsFavorite { get; set; }

    public DateTime CreatedDate { get; set; }

    public DateTime ModifiedDate { get; set; }

    /// <summary>Sıralı geçiş noktaları; kipe göre boş olabilir.</summary>
    public ICollection<SavedJourneyPoint> Points { get; set; } = new List<SavedJourneyPoint>();
}
