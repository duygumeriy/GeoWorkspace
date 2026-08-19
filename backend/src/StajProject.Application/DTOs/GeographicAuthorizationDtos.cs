using System.Text.Json.Serialization;
using StajProject.Domain.Common;

namespace StajProject.Application.DTOs;

/// <summary>
/// Bir hedefin coğrafi yetki alanlarından BİRİ.
/// </summary>
/// <remarks>
/// <para>
/// <b>Kimlik satırın kendisindedir.</b> Alanlar bir dizi içinde sırayla değil,
/// <see cref="Id"/> ile adreslenir: yönetici üçüncü alanı silerken "üçüncü
/// sıradakini sil" demek, listeyi bu arada değiştiren ikinci bir sekmede
/// yanlış alanı silmek olurdu.
/// </para>
/// <para>
/// Geometri WKT olarak taşınır — projenin çizim uçlarındaki sözleşmenin
/// aynısı. EF/NetTopologySuite nesneleri JSON'a doğrudan açılmaz.
/// </para>
/// </remarks>
public class GeographicAreaResponse
{
    public int Id { get; set; }

    /// <summary>Yöneticinin verdiği ad. Yetkilendirmeyi etkilemez.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Alanın kendisi: EPSG:4326 Polygon WKT.</summary>
    public string Wkt { get; set; } = string.Empty;

    /// <summary>
    /// Alanın nasıl üretildiği. Yalnızca arayüz rozeti/düzenleme kipi içindir;
    /// hiçbir yetkilendirme kararı buna bakmaz.
    /// </summary>
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public GeographicAreaSource SourceType { get; set; }

    /// <summary>İl/bölge seçiminin anahtarı; serbest çizimde <c>null</c>.</summary>
    public string? SourceKey { get; set; }

    public DateTime CreatedDate { get; set; }

    public DateTime ModifiedDate { get; set; }
}

/// <summary>
/// Bir hedefin (kullanıcı ya da rol) coğrafi yetki DURUMUNUN tamamı.
/// </summary>
/// <remarks>
/// <para>
/// <b>Hedefin KENDİ alanları ile YÜRÜRLÜKTEKİ alan ayrı tutulur.</b> Yönetici
/// ekranının iki ayrı sorusu vardır: "bu kullanıcıya özel olarak hangi alanları
/// tanımladım" (düzenlenecek olanlar) ve "bu kullanıcıya şu an fiilen ne
/// uygulanıyor" (rollerinden mirasla gelmiş olabilir). Tek alana indirgenirse,
/// rolünden alan devralan bir kullanıcının ekranı ya boş görünür ya da
/// yöneticinin silemeyeceği bir poligonu kendi alanıymış gibi gösterirdi.
/// </para>
/// <para>
/// Rol hedefleri için <see cref="EffectiveWkt"/>, <see cref="Areas"/>'in
/// birleşimidir: bir rol başka bir yerden alan devralmaz.
/// </para>
/// </remarks>
public class GeographicAreasResponse
{
    /// <summary>
    /// Hedefin DOĞRUDAN alanları. Miras alınan alanlar buraya GİRMEZ —
    /// girselerdi arayüz onları silinebilirmiş gibi gösterirdi.
    /// </summary>
    public IReadOnlyList<GeographicAreaResponse> Areas { get; set; } = [];

    /// <summary>
    /// Hedefe fiilen uygulanan bir coğrafi sınır var mı. Kullanıcı için
    /// rollerinden gelen alanları da kapsar.
    /// </summary>
    public bool IsRestricted { get; set; }

    /// <summary>
    /// Yürürlükteki alanın WKT'si; sınır yoksa <c>null</c>. Kopuk alanların
    /// birleşimi MultiPolygon olabilir.
    /// </summary>
    public string? EffectiveWkt { get; set; }
}

/// <summary>
/// Bir hedefe yeni coğrafi alan ekleme / var olan bir alanı değiştirme isteği.
/// </summary>
/// <remarks>
/// Gövde tek bir alan taşır: hedef ve (güncellemede) alan kimliği zaten
/// rotadadır. Aktör kimliği ASLA gövdeden okunmaz.
/// </remarks>
public class SaveGeographicAreaRequest
{
    /// <summary>EPSG:4326 Polygon WKT.</summary>
    public string? Wkt { get; set; }

    /// <summary>
    /// Alanın adı. Boş bırakılırsa servis kaynak tipinden okunabilir bir
    /// varsayılan üretir — istemciyi ad uydurmaya zorlamak yerine.
    /// </summary>
    public string? Name { get; set; }

    /// <summary>
    /// Alanın nasıl üretildiği. Gönderilmezse <see cref="GeographicAreaSource.ManualPolygon"/>.
    /// </summary>
    /// <remarks>
    /// <b>Bu değere GÜVENİLMEZ.</b> İstemcinin "Province" demesi kapsamı
    /// genişletmez; kaydedilen ve sınanan şey daima <see cref="Wkt"/>'dir.
    /// </remarks>
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public GeographicAreaSource? SourceType { get; set; }

    /// <summary>İl/bölge anahtarı; serbest çizimde gönderilmez.</summary>
    public string? SourceKey { get; set; }
}

/* ============================================================================
   UYUMLULUK SÖZLEŞMESİ (Phase 8A) — YENİ İSTEMCİLER KULLANMAZ
   ============================================================================
   Aşağıdaki iki tip, hedef başına TEK alanın olduğu döneme aittir ve yalnızca
   tekil uçların (`.../geographic-authorization`) sözleşmesini bozmamak için
   durur. Phase 9 arayüzü çoğul uçları (`.../geographic-authorizations`)
   kullanır.

   Anlamları belirsiz DEĞİLDİR, yalnızca dardır — tam tanım tekil uçların
   üzerindeki dokümantasyondadır:
     GET    → tüm doğrudan alanların BİRLEŞİMİ tek bir WKT olarak
     PUT    → hedefin tüm doğrudan alanlarını gönderilen TEK alanla DEĞİŞTİRİR
     DELETE → hedefin TÜM doğrudan alanlarını kaldırır

   Tekil PUT çok alanlı bir hedefi tek alana indirdiği için, çok alanlı yönetim
   yapan hiçbir ekran bu ucu çağırmamalıdır.
   ========================================================================== */

/// <summary>Tekil (uyumluluk) coğrafi yetki cevabı. Bkz. yukarıdaki not.</summary>
public class GeographicAuthorizationResponse
{
    /// <summary>Bu hedefe ait en az bir alan satırı var mı.</summary>
    public bool HasDirectAuthorization { get; set; }

    /// <summary>
    /// Hedefin kendi alanlarının BİRLEŞİMİ (EPSG:4326); yoksa <c>null</c>.
    /// Birden çok alan tanımlıysa MultiPolygon olabilir.
    /// </summary>
    public string? Wkt { get; set; }

    /// <summary>Hedefe fiilen uygulanan bir coğrafi sınır var mı.</summary>
    public bool IsRestricted { get; set; }

    /// <summary>Yürürlükteki alanın WKT'si; sınır yoksa <c>null</c>.</summary>
    public string? EffectiveWkt { get; set; }
}

/// <summary>Tekil (uyumluluk) atama isteği. Bkz. yukarıdaki not.</summary>
public class UpdateGeographicAuthorizationRequest
{
    /// <summary>EPSG:4326 Polygon WKT.</summary>
    public string? Wkt { get; set; }
}
