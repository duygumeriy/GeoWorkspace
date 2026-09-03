namespace StajProject.Application.DTOs;

/// <summary>
/// Bir kişisel yolculuk TANIMINI kaydetme isteği.
/// </summary>
/// <remarks>
/// <para>
/// <b>Yolculuk dili YENİDEN YAZILMAZ.</b> Tanım, planlama ve simülasyon
/// başlatmanın kullandığı <see cref="JourneyPlanRequest"/>'in TA KENDİSİDİR.
/// Paralel bir "kaydedilmiş yolculuk sözleşmesi" kurmak, aynı kavramın zamanla
/// ayrışan iki dili demekti: kipi bir yerde ekleyip diğerinde unutmak
/// mümkün olurdu.
/// </para>
/// <para>
/// <b>Çalışma zamanı durumu için alan YOKTUR.</b> Simülasyon kimliği,
/// ilerleme, konum, geometri ya da ölçüm gönderilemez — sözleşmede böyle bir
/// alan bulunmaz. Kaydetmek bir simülasyon başlatmaz ve çalışan bir
/// simülasyon GEREKTİRMEZ: kullanıcı planladığı yolculuğu yola çıkmadan da
/// saklayabilir.
/// </para>
/// </remarks>
public sealed class CreateSavedJourneyRequest
{
    /// <summary>Kullanıcının verdiği ad. Kırpılır; boş olamaz.</summary>
    public string? Name { get; set; }

    /// <summary>Yıldız. Verilmezse <c>false</c>.</summary>
    public bool IsFavorite { get; set; }

    /// <summary>Kaydedilecek KANONİK yolculuk niyeti.</summary>
    public JourneyPlanRequest? Journey { get; set; }
}

/// <summary>
/// Kaydedilmiş yolculuğun ÜST VERİ güncellemesi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Tek uç, iki alan.</b> Ad değiştirme ile yıldız aynı kaydın sunum
/// bilgisidir; her biri için ayrı bir uç açmak, aynı sahiplik denetimini üç
/// kez yazmak olurdu. <c>null</c> bırakılan alan DEĞİŞMEZ, böylece listedeki
/// yıldız düğmesi adı göndermek zorunda kalmaz.
/// </para>
/// <para>
/// <b>Yolculuk TANIMI buradan değiştirilemez.</b> Kip, profil ya da noktalar
/// için alan yoktur: bir tanımı değiştirmek yeni bir tanım kaydetmektir.
/// </para>
/// </remarks>
public sealed class UpdateSavedJourneyRequest
{
    public string? Name { get; set; }

    public bool? IsFavorite { get; set; }
}

/// <summary>Kaydedilmiş yolculuğun tek bir sıralı noktası.</summary>
public sealed class SavedJourneyPointResponse
{
    /// <summary>Sıfır tabanlı, boşluksuz sıra.</summary>
    public int Sequence { get; set; }

    /// <summary><c>transportStop</c> veya <c>poi</c>.</summary>
    public string Source { get; set; } = string.Empty;

    public int ReferenceId { get; set; }

    /// <summary>
    /// Kaydetme anındaki ad; YALNIZCA gösterim içindir.
    /// </summary>
    /// <remarks>
    /// Yeniden kullanım bu adı da konumu da kalıcı kayıttan TAZE çözer; burada
    /// dönen değer bayat olabilir ve otorite değildir.
    /// </remarks>
    public string? DisplayName { get; set; }

    /// <summary><c>origin</c>, <c>via</c> veya <c>destination</c>.</summary>
    /// <remarks>
    /// Rol SAKLANMAZ, sıradan türetilir: ayrıca yazılsaydı sırayla
    /// çelişebilen ikinci bir otorite olurdu.
    /// </remarks>
    public string Role { get; set; } = string.Empty;
}

/// <summary>
/// Liste satırı: HAFİF.
/// </summary>
/// <remarks>
/// Güzergah geometrisi, manevralar ve çözülmüş koordinatlar burada YOKTUR —
/// bir liste satırı uğruna her kayıt için yönlendirme motoruna gitmek ya da
/// kilobaytlarca WKT taşımak istenmez.
/// </remarks>
public sealed class SavedJourneySummaryResponse
{
    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;

    /// <summary><c>routeFull</c>, <c>routeSegment</c> veya <c>waypoints</c>.</summary>
    public string Mode { get; set; } = string.Empty;

    /// <summary><c>driving</c>, <c>walking</c> veya <c>cycling</c>.</summary>
    public string Profile { get; set; } = string.Empty;

    public bool IsFavorite { get; set; }

    /// <summary>Rota tabanlı kiplerde dolu; kaydetme anındaki ad.</summary>
    public string? RouteDisplayName { get; set; }

    /// <summary>Serbest kipte nokta sayısı; rota kiplerinde 0 ya da 2.</summary>
    public int PointCount { get; set; }

    /// <summary>Kaydedilen ilk noktanın adı; yoksa <c>null</c>.</summary>
    public string? OriginName { get; set; }

    /// <summary>Kaydedilen son noktanın adı; yoksa <c>null</c>.</summary>
    public string? DestinationName { get; set; }

    public DateTime CreatedDate { get; set; }

    public DateTime ModifiedDate { get; set; }
}

/// <summary>
/// Kaydedilmiş yolculuğun TAM tanımı.
/// </summary>
/// <remarks>
/// <b>Çalışma zamanı durumu YOKTUR.</b> Simülasyon kimliği, ilerleme, anlık
/// konum, güzergah geometrisi ya da manevra listesi için alan bulunmaz; bunlar
/// yalnızca yeniden kullanım anında üretilen çalışma zamanı çıktılarıdır.
/// </remarks>
public sealed class SavedJourneyResponse
{
    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public string Mode { get; set; } = string.Empty;

    public string Profile { get; set; } = string.Empty;

    public bool IsFavorite { get; set; }

    /// <summary>Rota tabanlı kiplerde hattın kimliği.</summary>
    public int? RouteId { get; set; }

    public string? RouteDisplayName { get; set; }

    public DateTime CreatedDate { get; set; }

    public DateTime ModifiedDate { get; set; }

    /// <summary>Sıralı noktalar; rota tabanlı tam-hat kipinde boştur.</summary>
    public IReadOnlyList<SavedJourneyPointResponse> Points { get; set; } = [];
}
