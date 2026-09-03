namespace StajProject.Application.DTOs;

/// <summary>
/// Kişisel yolculuk geçmişinin sorgusu. Tüm alanlar isteğe bağlıdır.
/// </summary>
/// <remarks>
/// <para>
/// <b>Sahip kimliği BURADA YOKTUR ve olmamalıdır.</b> Kimin geçmişine
/// bakıldığı bir sorgu parametresi olsaydı, başkasının kimliğini yazan biri
/// onun yolculuklarını listeleyebilirdi. Sahip daima doğrulanmış JWT'den
/// okunur.
/// </para>
/// <para>
/// <b>Serbest metin araması ve tarih aralığı bilinçle YOKTUR.</b> Bu fazın
/// ürünü kompakt bir geçmiş listesidir; daraltma yalnızca indeksli ve ucuz
/// olan tek eksende — sonuç durumunda — yapılır.
/// </para>
/// </remarks>
public sealed class JourneyHistoryQuery
{
    /// <summary>1'den başlar; verilmezse ilk sayfa.</summary>
    public int? Page { get; set; }

    public int? PageSize { get; set; }

    /// <summary>
    /// <c>Completed</c> ya da <c>Cancelled</c>; verilmezse hepsi.
    /// </summary>
    /// <remarks>
    /// Metin taşınır ve serviste çözülür: bilinmeyen bir enum değeri model
    /// binder'da patlar ve servis kendi <see cref="Common.ServiceResult{T}"/>
    /// mesajını üretemezdi.
    /// </remarks>
    public string? Status { get; set; }
}

/// <summary>
/// Geçmişin tek sayfası.
/// </summary>
/// <remarks>
/// <b>Sayfalama isteğe bağlı DEĞİLDİR.</b> Kaydedilmiş yolculuklardan farkı
/// budur: kullanıcı sınırlı sayıda tanım saklar ama sınırsız sayıda yolculuk
/// yapar. Tamamını göndermek, ekranı bir gün açılmaz hâle getirirdi. Mevcut
/// aktivite geçmişiyle AYNI sayfa sözleşmesi kullanılır; ikinci bir sayfalama
/// dili kurulmaz.
/// </remarks>
public sealed class JourneyHistoryPage
{
    public IReadOnlyList<JourneyHistoryListItem> Items { get; set; } = [];

    /// <summary>1'den başlar.</summary>
    public int Page { get; set; }

    public int PageSize { get; set; }

    /// <summary>Filtreye uyan TOPLAM kayıt sayısı — bu sayfadaki değil.</summary>
    public int TotalCount { get; set; }

    public int TotalPages { get; set; }
}

/// <summary>
/// Liste satırı: HAFİF.
/// </summary>
/// <remarks>
/// Güzergah geometrisi, manevra listesi ve canlı durum burada YOKTUR; bir
/// liste satırı uğruna kilobaytlarca WKT taşımak ya da canlı kayıtlara
/// katılmak istenmez. Uç adları KAYIT ANINDAKİ kopyalardır: POI sonradan
/// yeniden adlandırılsa bile geçmiş, kullanıcının o gün gördüğü adı gösterir.
/// </remarks>
public sealed class JourneyHistoryListItem
{
    public int Id { get; set; }

    /// <summary>Kaydın anlattığı çalıştırmanın kimliği; TARİHSEL etikettir.</summary>
    /// <remarks>Yeniden kullanımda ASLA kullanılmaz; her yeniden kullanım yeni bir kimlik üretir.</remarks>
    public Guid SimulationId { get; set; }

    /// <summary><c>routeFull</c>, <c>routeSegment</c> veya <c>waypoints</c>.</summary>
    public string Mode { get; set; } = string.Empty;

    /// <summary><c>driving</c>, <c>walking</c> veya <c>cycling</c>.</summary>
    public string Profile { get; set; } = string.Empty;

    /// <summary><c>Completed</c> veya <c>Cancelled</c>.</summary>
    public string TerminalStatus { get; set; } = string.Empty;

    public DateTime StartedAt { get; set; }

    public DateTime EndedAt { get; set; }

    /// <summary>Motorun ölçtüğü GERÇEK seyahat süresi — duvar saati farkı değil.</summary>
    public double DurationSeconds { get; set; }

    /// <summary>Motorun ölçtüğü toplam güzergah mesafesi.</summary>
    public double DistanceMeters { get; set; }

    /// <summary>Çalıştırma sona erdiğinde kat edilmiş mesafe.</summary>
    public double CoveredDistanceMeters { get; set; }

    /// <summary>Hat tabanlı kiplerde, hattın o günkü adı.</summary>
    public string? RouteDisplayName { get; set; }

    /// <summary>İlk noktanın o günkü adı.</summary>
    public string? OriginName { get; set; }

    /// <summary>Son noktanın o günkü adı.</summary>
    public string? DestinationName { get; set; }

    public int PointCount { get; set; }
}

/// <summary>Geçmiş kaydındaki tek bir nokta, ÇALIŞTIRMA ANINDAKİ hâliyle.</summary>
public sealed class JourneyHistoryPointResponse
{
    /// <summary>Sıfır tabanlı, boşluksuz sıra.</summary>
    public int Sequence { get; set; }

    /// <summary><c>transportStop</c> veya <c>poi</c>.</summary>
    public string Source { get; set; } = string.Empty;

    /// <summary>Kanonik kimlik; YALNIZCA yeniden kullanımda çözülür.</summary>
    public int ReferenceId { get; set; }

    /// <summary>Noktanın o günkü adı; gösterimin kaynağıdır.</summary>
    public string DisplayName { get; set; } = string.Empty;

    /// <summary><c>origin</c>, <c>via</c> veya <c>destination</c>.</summary>
    /// <remarks>Rol saklanmaz, sıradan türetilir.</remarks>
    public string Role { get; set; } = string.Empty;
}

/// <summary>
/// Geçmiş kaydının TAM, değişmez ayrıntısı.
/// </summary>
/// <remarks>
/// <b>Canlı veriye bağımlılığı YOKTUR.</b> Bu yanıtı üretmek için hiçbir POI,
/// durak ya da hat kaydına gidilmez: gösterilecek her ad kaydın kendi
/// kopyasından gelir. Böylece silinmiş bir POI'yi içeren yolculuk bile
/// açılabilir.
/// </remarks>
public sealed class JourneyHistoryDetailResponse
{
    public int Id { get; set; }

    public Guid SimulationId { get; set; }

    public string Mode { get; set; } = string.Empty;

    public string Profile { get; set; } = string.Empty;

    public string TerminalStatus { get; set; } = string.Empty;

    public DateTime StartedAt { get; set; }

    public DateTime EndedAt { get; set; }

    public double DurationSeconds { get; set; }

    public double DistanceMeters { get; set; }

    public double CoveredDistanceMeters { get; set; }

    /// <summary>Hat tabanlı kiplerde hattın kimliği; yeniden kullanımda çözülür.</summary>
    public int? RouteId { get; set; }

    public string? RouteDisplayName { get; set; }

    /// <summary>Sıralı noktalar, o günkü adlarıyla.</summary>
    public IReadOnlyList<JourneyHistoryPointResponse> Points { get; set; } = [];
}
