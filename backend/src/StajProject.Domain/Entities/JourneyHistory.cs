namespace StajProject.Domain.Entities;

/// <summary>
/// SONA ERMİŞ bir kişisel yolculuk çalıştırmasının değişmez kaydı.
/// </summary>
/// <remarks>
/// <para>
/// <b><see cref="SavedJourney"/> ile KARIŞTIRILMAMALIDIR.</b> Kaydedilmiş
/// yolculuk yeniden kullanılabilir bir NİYETTİR: kullanıcı onu adlandırır,
/// yeniden adlandırır, siler ve istediği kadar yeniden kullanır. Buradaki
/// kayıt ise OLMUŞ BİR ŞEYİN tutanağıdır: kullanıcı onu adlandıramaz,
/// düzenleyemez ve içeriğini değiştiremez. İki kavramı tek tabloda birleştirmek,
/// "yeniden adlandırdım" ile "geçmişi değiştirdim" arasındaki farkı yok ederdi.
/// </para>
/// <para>
/// <b>Yalnızca TERMİNAL çalıştırmalar için yazılır.</b> Planlama, önizleme,
/// başlatma ve çalışırken geçen hiçbir an bir satır üretmez; satır tam olarak
/// <c>Running → Completed</c> ya da <c>Running → Cancelled</c> geçişini KAZANAN
/// kod yolunda oluşur.
/// </para>
/// <para>
/// <b>Çalışma zamanı durumu SAKLANMAZ.</b> Anlık koordinat, güncel manevra,
/// varış tahmini, takip durumu ya da kanal üyeliği için kolon YOKTUR: bunlar
/// çalıştırma bittiğinde anlamını yitiren geçici olgulardır. Saklanan her alan,
/// çalıştırma bittikten sonra da doğru kalan bir OLGUDUR.
/// </para>
/// <para>
/// <b>Kayıt canlı veriye BAĞIMLI DEĞİLDİR.</b> Hat, durak ve POI adlarının o
/// günkü hâli burada ve nokta satırlarında kopyalanır; kayıt daha sonra o
/// kayıtlar silinse bile okunabilir kalmalıdır. Bu yüzden hiçbir canlı tabloya
/// yabancı anahtar kurulmaz.
/// </para>
/// </remarks>
public class JourneyHistory
{
    /// <summary>Kip/profil/durum gibi sözleşme metinlerinin ortak sınırı.</summary>
    public const int MaxContractLength = 32;

    /// <summary>Yalnızca gösterim amaçlı ad kopyalarının sınırı.</summary>
    public const int MaxDisplayNameLength = 200;

    public int Id { get; set; }

    /// <summary>Sahibi; okumanın TEK yetkisi.</summary>
    public int UserId { get; set; }

    public User? User { get; set; }

    /// <summary>
    /// Kaydın anlattığı ÇALIŞTIRMANIN kimliği.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Kaydedilmiş yolculuktan farkı burasıdır.</b> Bir tanımın çalıştırma
    /// kimliği olmaz; bir tutanağın olur — "hangi koşu" sorusunun cevabı budur.
    /// </para>
    /// <para>
    /// <b>Ama ASLA yeniden kullanılmaz.</b> Bu kimlik tarihsel bir etikettir;
    /// geçmişten yeniden yolculuk başlatmak DAİMA yeni bir kimlik üretir.
    /// Tekil indeks de buradadır: aynı çalıştırma iki kez kayda geçemez.
    /// </para>
    /// </remarks>
    public Guid SimulationId { get; set; }

    /// <summary><c>routeFull</c>, <c>routeSegment</c> veya <c>waypoints</c>.</summary>
    public string Mode { get; set; } = string.Empty;

    /// <summary>Kullanıcının TALEP ettiği profil: <c>driving</c>/<c>walking</c>/<c>cycling</c>.</summary>
    public string Profile { get; set; } = string.Empty;

    /// <summary><c>Completed</c> veya <c>Cancelled</c> — çalışma zamanının kendi adları.</summary>
    public string TerminalStatus { get; set; } = string.Empty;

    /// <summary>Çalıştırmanın sunucuda oluşturulduğu an (UTC).</summary>
    public DateTime StartedAt { get; set; }

    /// <summary>Terminal geçişin kazanıldığı an (UTC).</summary>
    public DateTime EndedAt { get; set; }

    /// <summary>
    /// Yönlendirme motorunun ölçtüğü TOPLAM güzergah mesafesi.
    /// </summary>
    /// <remarks>
    /// Tarayıcıda geometriden türetilmez; çalıştırmanın otoriter yolundan
    /// kopyalanır.
    /// </remarks>
    public double DistanceMeters { get; set; }

    /// <summary>
    /// Yönlendirme motorunun ölçtüğü GERÇEK seyahat süresi.
    /// </summary>
    /// <remarks>
    /// <b><see cref="EndedAt"/> − <see cref="StartedAt"/> DEĞİLDİR.</b> Kişisel
    /// simülasyon bir DEMO oynatma çarpanıyla çalışır; duvar saati farkı
    /// gösterimin ne kadar sürdüğünü söyler, yolculuğun ne kadar sürdüğünü
    /// değil. Kullanıcıya "yolculuk süresi" olarak gösterilecek değer budur.
    /// </remarks>
    public double DurationSeconds { get; set; }

    /// <summary>
    /// Çalıştırma sona erdiğinde güzergah üzerinde KAT EDİLMİŞ mesafe.
    /// </summary>
    /// <remarks>
    /// Anlık ilerleme DEĞİLDİR: terminal anda donmuş bir olgudur ve
    /// "tamamlandı" ile "yarıda durduruldu" arasındaki farkı tek başına
    /// anlatan alandır. Tamamlanan bir çalıştırmada
    /// <see cref="DistanceMeters"/> ile eşitlenir.
    /// </remarks>
    public double CoveredDistanceMeters { get; set; }

    /// <summary>Hat tabanlı kiplerde hattın kimliği; serbest kipte <c>null</c>.</summary>
    /// <remarks>
    /// <b>Yabancı anahtar YOKTUR.</b> Geçmiş, anlattığı hattın silinmesini
    /// engellememeli ve o hat silindiğinde de okunabilir kalmalıdır.
    /// </remarks>
    public int? RouteId { get; set; }

    /// <summary>Hattın ÇALIŞTIRMA ANINDAKİ adı; tarihsel gösterim içindir.</summary>
    public string? RouteDisplayName { get; set; }

    /// <summary>Satırın yazıldığı an (UTC).</summary>
    public DateTime CreatedDate { get; set; }

    /// <summary>Yolculuğun uçları ve ara noktaları, o günkü hâlleriyle.</summary>
    public ICollection<JourneyHistoryPoint> Points { get; set; } = new List<JourneyHistoryPoint>();
}
