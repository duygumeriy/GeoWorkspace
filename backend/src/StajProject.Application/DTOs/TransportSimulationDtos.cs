using StajProject.Application.Simulation;

namespace StajProject.Application.DTOs;

/// <summary>
/// Aktif bir simülasyonun istemciye açılan görünümü.
/// </summary>
/// <remarks>
/// Güzergah geometrisi bilinçli olarak BURADA DEĞİLDİR: istemci onu zaten
/// mevcut <c>GET api/transport/routes/{routeId}/path</c> ucundan alır ve aynı
/// veriyi iki uçtan farklı biçimlerde yayınlamak, ikisinin ayrışmasına
/// açık kapı bırakırdı. Bu yanıt yalnızca ÇALIŞTIRMAYA ait olguları taşır.
/// </remarks>
public sealed class TransportSimulationResponse
{
    public Guid SimulationId { get; set; }
    public int RouteId { get; set; }
    public string RouteName { get; set; } = string.Empty;
    public string RouteColorHex { get; set; } = string.Empty;
    public int StartedByUserId { get; set; }
    public DateTime StartedAt { get; set; }

    /// <summary>
    /// Çalıştırmanın KANONİK yaşam döngüsü durumu.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Canlı yayınla AYNI vokabüler.</b> Tip
    /// <see cref="TransportSimulationStatus"/>'tür ve enum'un kendisi
    /// <c>JsonStringEnumConverter</c> taşıdığı için tel üzerinde AD olarak
    /// gider ("Running" / "Paused"); istemci REST ile SignalR arasında iki
    /// farklı temsil çözmek zorunda kalmaz.
    /// </para>
    /// <para>
    /// <b>Neden sonradan eklendi.</b> Bu yanıt, tek canlı durumun
    /// <c>Running</c> olduğu bir dünyada tasarlanmıştı: "aktif çalıştırma
    /// döndüyse çalışıyordur" varsayımı o gün doğruydu. <c>Paused</c>
    /// eklendiğinde varsayım yanlışa döndü ve sayfa yenilendiğinde
    /// duraklatılmış bir hat, canlı kanal bağlanana kadar "çalışıyor" gibi
    /// görünüyordu. Durum artık okuma yolunda da AÇIKÇA taşınır.
    /// </para>
    /// <para>
    /// <b>Türetilmez.</b> Değer çalışma zamanı durumundan olduğu gibi
    /// kopyalanır; ilerlemeye, <c>PausedAt</c>'in dolu olup olmadığına ya da
    /// bir izin var olup olmadığına BAKILMAZ — o tür bir çıkarım, otoriteyi
    /// sessizce ikinci bir yere taşırdı.
    /// </para>
    /// </remarks>
    public TransportSimulationStatus Status { get; set; }

    /// <summary>İşletilen yolun ölçülen toplam uzunluğu.</summary>
    public double DistanceMeters { get; set; }

    /// <summary>İşletilen yolun ölçülen toplam süresi.</summary>
    public double DurationSeconds { get; set; }

    /// <summary>Yolun üretildiği OSRM profili.</summary>
    public string Profile { get; set; } = string.Empty;

    /// <summary>İşletilen yol sürümünün üretim anı.</summary>
    public DateTime PathGeneratedAt { get; set; }

    /// <summary>Güzergahtaki köşe sayısı.</summary>
    public int PointCount { get; set; }

    public double Longitude { get; set; }
    public double Latitude { get; set; }
    public int SegmentIndex { get; set; }

    /// <summary>0..1 aralığında ilerleme.</summary>
    public double ProgressRatio { get; set; }

    public double DistanceCoveredMeters { get; set; }

    /// <summary>Anlık görüntünün sunucuda üretildiği UTC an.</summary>
    public DateTime CapturedAt { get; set; }

    /* --- NAVİGASYON (Faz 5) --------------------------------------------------
       Manevralar güzergahın ömrü boyunca SABİTTİR; bu yüzden OKUMA yolunda bir
       kez verilir, canlı akışta ise yalnızca değişen sıra taşınır. */

    /// <summary>
    /// Güzergahın OTORİTER manevraları; sıraya göre artar.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Boş liste ile "taşınmadı" AYNI ŞEY DEĞİLDİR</b> ve ayrımı
    /// <see cref="HasNavigationSteps"/> yapar: aktif KEŞİF listesi çok sayıda
    /// hattı tek yanıtta taşır ve her biri için tüm adım listesini göndermek
    /// yükü hat sayısıyla çarpardı. O listede alan bilinçli olarak boştur;
    /// seçili hattın okuması ise dolu gelir.
    /// </para>
    /// <para>
    /// Veri geometriden TÜRETİLMEZ: değerler yolun üretildiği anda motordan
    /// alınıp saklanmıştır.
    /// </para>
    /// </remarks>
    public IReadOnlyList<TransportSimulationNavigationStepResponse> NavigationSteps { get; set; } = [];

    /// <summary>
    /// Güzergahın manevrası VAR MI? Liste boş gelse bile bu alan doğruyu
    /// söyler.
    /// </summary>
    public bool HasNavigationSteps { get; set; }

    /// <summary>
    /// Aracın İÇİNDE BULUNDUĞU manevranın OTORİTER sırası; manevra yoksa
    /// <c>null</c>. Dizi konumu DEĞİLDİR.
    /// </summary>
    public int? CurrentStepSequence { get; set; }

    /// <summary>SONRAKİ manevraya kalan mesafe; sonraki manevra yoksa <c>null</c>.</summary>
    public double? DistanceToNextManeuverMeters { get; set; }
}

/// <summary>
/// Paylaşılan hattın tek bir OTORİTER manevrası (istemci görünümü).
/// </summary>
/// <remarks>
/// <para>
/// <b>Ham motor yanıtı değildir.</b> Alan adları sağlayıcıdan bağımsızdır;
/// OSRM'nin JSON şekli bu sözleşmenin parçası DEĞİLDİR.
/// </para>
/// <para>
/// <b>Kullanıcıya gösterilecek metin BURADA ÜRETİLMEZ.</b> Motor çekirdeği
/// insan okunabilir talimat vermez; uydurulmuş bir metin, sunucunun bilmediği
/// bir gerçeği bildiriyormuş gibi olurdu. Türkçeleştirme saf bir SUNUM
/// kararıdır ve arayüzdeki mevcut manevra sözlüğünde yapılır.
/// </para>
/// <para>
/// <b>Koordinat TAŞINMAZ.</b> İstemcinin manevra konumundan mesafe ya da yön
/// hesaplamasına gerek yoktur ve olmamalıdır: hangi adımda olunduğunu ve
/// sonrakine ne kadar kaldığını sunucu söyler.
/// </para>
/// </remarks>
public sealed class TransportSimulationNavigationStepResponse
{
    /// <summary>Sıfır tabanlı, güzergah boyunca artan OTORİTER sıra.</summary>
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
}
