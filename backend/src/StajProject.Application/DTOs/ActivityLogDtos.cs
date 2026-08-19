namespace StajProject.Application.DTOs;

/// <summary>Aktivite geçmişindeki tek bir satır.</summary>
/// <remarks>
/// <b>Sır taşımaz.</b> Kaynak tabloya zaten hiçbir sır yazılmaz (bkz.
/// ActivityLog ve ActivityDetails); bu tip de saklanan alanların ötesinde bir
/// şey açmaz.
/// </remarks>
public class ActivityLogListItem
{
    public int Id { get; set; }

    public DateTime OccurredAt { get; set; }

    /// <summary>İşlemi yapan kullanıcının kimliği; belirlenemiyorsa <c>null</c>.</summary>
    public int? ActorUserId { get; set; }

    /// <summary>İşlem ANINDAKİ kullanıcı adı — sonradan değişse bile korunur.</summary>
    public string? ActorUsername { get; set; }

    /// <summary>Kanonik işlem kodu — filtrelemenin ve kimliğin dayandığı değer.</summary>
    public string Action { get; set; } = string.Empty;

    /// <summary>
    /// İşlemin Türkçe adı.
    /// </summary>
    /// <remarks>
    /// Kodla BİRLİKTE taşınır: arayüzün kendi çeviri tablosunu tutması,
    /// kataloğa eklenen bir işlemin ekranda ham kod olarak görünmesi demekti.
    /// Tanınmayan kod için kodun kendisi döner.
    /// </remarks>
    public string ActionName { get; set; } = string.Empty;

    public string? ResourceType { get; set; }

    public string? ResourceId { get; set; }

    public string HttpMethod { get; set; } = string.Empty;

    public string Path { get; set; } = string.Empty;

    public int StatusCode { get; set; }

    /// <summary>
    /// İşlem başarıyla sonuçlandı mı — 2xx. Arayüzün "Başarılı / Başarısız"
    /// sütunu bunu okur, durum kodunu yeniden yorumlamaz.
    /// </summary>
    public bool IsSuccess { get; set; }

    /// <summary>Ek bağlam (JSON metni); yoksa <c>null</c>.</summary>
    public string? Details { get; set; }

    public string? ClientIp { get; set; }
}

/// <summary>Aktivite geçmişinin tek sayfası.</summary>
/// <remarks>
/// Sayfalama SUNUCU tarafındadır ve isteğe bağlı değildir: kayıt tablosu
/// zamanla sınırsız büyür ve tamamını istemciye göndermek, ekranı bir gün
/// açılmaz hâle getirirdi.
/// </remarks>
public class ActivityLogPage
{
    public IReadOnlyList<ActivityLogListItem> Items { get; set; } = [];

    /// <summary>1'den başlar.</summary>
    public int Page { get; set; }

    public int PageSize { get; set; }

    /// <summary>Filtreye uyan TOPLAM kayıt sayısı — bu sayfadaki değil.</summary>
    public int TotalCount { get; set; }

    public int TotalPages { get; set; }
}

/// <summary>
/// Aktivite geçmişi sorgusu. Tüm alanlar isteğe bağlıdır.
/// </summary>
/// <remarks>
/// Serbest metin araması bilinçli olarak YOKTUR: yolun ve ayrıntıların içinde
/// arama yapmak, indekslenmemiş bir tabloda tam tarama demekti. Daraltmalar
/// indeksli kolonlar üzerindedir.
/// </remarks>
public class ActivityLogQuery
{
    public int? Page { get; set; }

    public int? PageSize { get; set; }

    /// <summary>Yalnızca bu kullanıcının işlemleri.</summary>
    public int? ActorUserId { get; set; }

    /// <summary>Yalnızca bu kanonik işlem kodu.</summary>
    public string? Action { get; set; }

    /// <summary>Bu andan İTİBAREN (dâhil), UTC.</summary>
    public DateTime? From { get; set; }

    /// <summary>Bu ana KADAR (dâhil), UTC.</summary>
    public DateTime? To { get; set; }

    /// <summary>
    /// <c>true</c> yalnızca başarılı, <c>false</c> yalnızca başarısız
    /// işlemleri getirir.
    /// </summary>
    public bool? Succeeded { get; set; }
}
