using System.Text.Json.Serialization;
using StajProject.Application.Simulation;

namespace StajProject.Application.DTOs;

/// <summary>
/// Toplu yaşam döngüsü komutunun TEK bir hedefi.
/// </summary>
/// <remarks>
/// <para>
/// <b>İKİ kimlik birden taşınır ve bu bir doğrulama süsü DEĞİLDİR.</b> Yalnızca
/// rota taşıyan bir hedef ("7 numaralı hatta ne çalışıyorsa ona uygula"), A
/// çalıştırması bitip yerine B geçtiğinde eski bir sekmenin B'yi — başka
/// kullanıcıların canlı izlediği çalıştırmayı — vurması demekti. Tekil
/// uçlardaki kural (<c>routes/{routeId}/{simulationId}/...</c>) toplu yolda da
/// AYNEN geçerlidir; toplu olmak kimlik zorunluluğunu gevşetmez.
/// </para>
/// </remarks>
public sealed class TransportSimulationTargetRequest
{
    public int RouteId { get; set; }

    public Guid SimulationId { get; set; }
}

/// <summary>
/// Dört toplu yaşam döngüsü ucunun ORTAK istek gövdesi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Tek sözleşme, dört uç.</b> İşlem yolun kendisinde bildirilir; gövdede
/// ayrıca bir "operation" alanı taşımak, yetkilendirmenin gövdeye bağlı hâle
/// gelmesi demekti — <c>restart</c> gövdesi <c>pause</c> ucuna gönderilebilir
/// ve uçtaki yetki bildirimi anlamını yitirirdi.
/// </para>
/// </remarks>
public sealed class TransportSimulationBatchRequest
{
    /// <summary>Komutun uygulanacağı ÇALIŞTIRMALAR; boş olamaz.</summary>
    public IReadOnlyList<TransportSimulationTargetRequest>? Targets { get; set; }
}

/// <summary>Toplu yaşam döngüsü işlemleri.</summary>
/// <remarks>
/// Bu bir SİMÜLASYON DURUMU değildir ve <see cref="TransportSimulationStatus"/>
/// ile karıştırılmamalıdır: burada anlatılan şey KOMUTUN kendisidir.
/// </remarks>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum TransportSimulationBatchOperation
{
    Pause,
    Resume,
    Reset,
    Restart
}

/// <summary>
/// TEK bir hedefe uygulanan komutun SONUCU.
/// </summary>
/// <remarks>
/// <para>
/// <b>İkinci bir yaşam döngüsü sözlüğü DEĞİLDİR.</b> Çalıştırmanın durumu
/// eskisi gibi <see cref="TransportSimulationStatus"/> ile taşınır; buradaki
/// kodlar komutun NASIL sonuçlandığını söyler. İkisini tek enumda toplamak,
/// "Stale" gibi bir komut sonucunun bir simülasyon durumu sanılmasına açık
/// kapı bırakırdı.
/// </para>
/// </remarks>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum TransportSimulationOperationResultCode
{
    /// <summary>Komut uygulandı.</summary>
    Succeeded,

    /// <summary>Rota yok ya da kullanımda değil.</summary>
    RouteNotFound,

    /// <summary>Hatta hiçbir çalıştırma yok.</summary>
    NoActiveSimulation,

    /// <summary>
    /// Hatta bir çalıştırma var ama istenen O DEĞİL: yerine yenisi geçmiş.
    /// Hiçbir şeye DOKUNULMAMIŞTIR.
    /// </summary>
    Stale,

    /// <summary>Duraklatma önkoşulu tutmadı: çalıştırma çalışmıyor.</summary>
    NotRunning,

    /// <summary>Sürdürme önkoşulu tutmadı: çalıştırma duraklatılmış değil.</summary>
    NotPaused,

    /// <summary>Yeniden başlatma için kalıcı güzergah yok.</summary>
    PathNotFound,

    /// <summary>Kalıcı güzergah bayat; önce yeniden hesaplanmalı.</summary>
    StalePath,

    /// <summary>Kalıcı güzergah simülasyon için yeterli köşe içermiyor.</summary>
    InsufficientGeometry
}

/// <summary>
/// Toplu komutun TEK hedefe ait sonucu; istek SIRASINDA döner.
/// </summary>
/// <remarks>
/// <para>
/// <b>İstenen kimlikler olduğu gibi geri verilir.</b> İstemci sonucu kendi
/// bekleyen niyetiyle eşleştirebilmelidir; "şu an hatta ne varsa" ile
/// eşleştirmek, bayat bir hedefin yerine geçen çalıştırmaya yanlışlıkla
/// bağlanması demekti.
/// </para>
/// </remarks>
public sealed class TransportSimulationOperationResult
{
    public int RequestedRouteId { get; set; }

    public Guid RequestedSimulationId { get; set; }

    public bool Succeeded { get; set; }

    public TransportSimulationOperationResultCode ResultCode { get; set; }

    /// <summary>Kullanıcıya gösterilebilir tek satır açıklama.</summary>
    public string Message { get; set; } = string.Empty;

    /// <summary>
    /// Komutun ürettiği OTORİTER canlı güncelleme; gözlemcilere yayınlananın
    /// aynısıdır. Başarısız hedeflerde <c>null</c>'dır.
    /// </summary>
    /// <remarks>
    /// Yeniden başlatmada bu alan ESKİ çalıştırmanın terminal güncellemesidir:
    /// "A bitti" olgusu, "B başladı" olgusundan ayrı taşınır.
    /// </remarks>
    public TransportSimulationLiveUpdate? Update { get; set; }

    /// <summary>
    /// İşlemden SONRA hattın kanonik simülasyonu; yeniden başlatmada YENİ
    /// çalıştırmadır (yeni <c>SimulationId</c>, %0 ilerleme). Sıfırlamada
    /// <c>null</c>'dır — yerine yeni bir çalıştırma KONMAZ.
    /// </summary>
    public TransportSimulationResponse? Simulation { get; set; }
}

/// <summary>
/// Toplu komutun tamamı: hedef başına BİR sonuç, istek sırasında.
/// </summary>
/// <remarks>
/// <para>
/// <b>Kısmi başarı gerçektir ve gizlenmez.</b> Farklı rotalar birbirinden
/// bağımsızdır; birini geri almak için diğerlerini geri sarmak, kullanıcının
/// gerçekten uyguladığı komutları sahte bir işlem bütünlüğü uğruna iptal
/// etmek olurdu. Başarısız hedefler kendi kodlarıyla görünür kalır.
/// </para>
/// </remarks>
public sealed class TransportSimulationBatchResponse
{
    public TransportSimulationBatchOperation Operation { get; set; }

    public IReadOnlyList<TransportSimulationOperationResult> Results { get; set; } = [];

    public int RequestedCount { get; set; }

    public int SucceededCount { get; set; }

    public int FailedCount { get; set; }
}

/// <summary>Toplu isteğin sözleşme sınırları.</summary>
public static class TransportSimulationBatch
{
    /// <summary>
    /// Tek istekte kabul edilen EN FAZLA hedef sayısı.
    /// </summary>
    /// <remarks>
    /// Sınırsız bir yaşam döngüsü yığını, tek bir istekle tüm ağı
    /// sonlandırabilen bir yüzey demekti. Değer aktif kümenin doğal
    /// büyüklüğünün çok üzerindedir; gerçek bir kullanımı kesmez ama kötüye
    /// kullanımı deterministik biçimde reddeder.
    /// </remarks>
    public const int MaxTargets = 100;
}
