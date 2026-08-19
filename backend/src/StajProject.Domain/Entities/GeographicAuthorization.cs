using Microsoft.AspNetCore.Identity;
using NetTopologySuite.Geometries;
using StajProject.Domain.Common;

namespace StajProject.Domain.Entities;

/// <summary>
/// Bir kullanıcının VEYA bir rolün coğrafi yetki alanlarından BİRİ: o hedefin
/// sistemde geometri üretebileceği sınırın tek bir parçası.
/// </summary>
/// <remarks>
/// <para>
/// <b>Hedef tektir.</b> Bir satır ya bir kullanıcıya ya bir role bağlıdır —
/// ikisine birden değil, hiçbirine de değil. Kural veritabanında bir CHECK
/// kısıtı olarak da durur: uygulama katmanındaki bir doğrulama yalnızca kendi
/// kod yolunu bağlar; kısıt, elle atılan bir INSERT'ü de bağlar.
/// </para>
/// <para>
/// <b>Hedef başına ÇOK satır.</b> (Phase 9) Önceki modelde hedef başına en
/// fazla bir satır vardı ve çok bölgeli yetki yalnızca kullanıcıyı birden çok
/// role üye yaparak kurulabiliyordu. Bu, "Ankara ve Kayseri'de çalışan tek
/// kişi" gibi sıradan bir ihtiyaç için rol enflasyonu üretiyordu. Artık her
/// bölge KENDİ satırıdır: ayrı ayrı adlandırılır, düzenlenir ve silinir.
/// </para>
/// <para>
/// <b>Bir satır = bir Polygon.</b> Alanların tamamını tek bir
/// GeometryCollection'a doldurmak da mümkündü ve bilinçli olarak
/// YAPILMAMIŞTIR: o modelde tek bir bölgeyi silmek ya da yeniden adlandırmak
/// için tüm koleksiyonu okuyup yeniden yazmak gerekirdi ve hiçbir bölgenin
/// kalıcı bir kimliği olmazdı. Kopuk bölgelerin birleşimi (MultiPolygon)
/// SAKLANAN değil, çözüm sırasında HESAPLANAN bir sonuçtur.
/// </para>
/// <para>
/// <b>Alan yalnızca izin verir, yasaklamaz.</b> Negatif/dışlama bölgesi,
/// öncelik sırası ve kapsam geçmişi bilinçli olarak YOKTUR: bunlar "buraya
/// çizebilir miyim" sorusunun cevabını kuralların sırasına bağımlı hale
/// getirirdi. Hedefin hiç satırı yoksa kısıt da yoktur.
/// </para>
/// </remarks>
public class GeographicAuthorization
{
    /// <summary>EF <c>HasMaxLength</c> ile aynı sınır.</summary>
    public const int MaxNameLength = 120;

    /// <summary>EF <c>HasMaxLength</c> ile aynı sınır.</summary>
    public const int MaxSourceKeyLength = 64;

    public int Id { get; set; }

    /// <summary>Hedef kullanıcı. <see cref="RoleId"/> doluysa <c>null</c>'dır.</summary>
    public int? UserId { get; set; }

    public User? User { get; set; }

    /// <summary>Hedef rol. <see cref="UserId"/> doluysa <c>null</c>'dır.</summary>
    public int? RoleId { get; set; }

    public IdentityRole<int>? Role { get; set; }

    /// <summary>
    /// Alanın yöneticiye görünen adı ("Ankara Merkez", "Saha 2").
    /// </summary>
    /// <remarks>
    /// <b>Yetkilendirmeyi ETKİLEMEZ.</b> Aynı ada sahip iki alan da tanımlıdır;
    /// teklik zorlanmaz. Ad, birden çok alan arasında hangisinin düzenlendiğini
    /// ayırt etmek içindir — bir "Alan #3" listesi, yöneticiyi haritada
    /// deneyerek aramaya zorlardı.
    /// </remarks>
    public string Name { get; set; } = string.Empty;

    /// <summary>Alanın nasıl üretildiği. Yetkilendirmede OKUNMAZ.</summary>
    public GeographicAreaSource SourceType { get; set; } = GeographicAreaSource.ManualPolygon;

    /// <summary>
    /// Kaynağın tanımlayıcısı — il için plaka kodu ("TR-06"), bölge için bölge
    /// anahtarı ("IC_ANADOLU"). Serbest çizim ve koordinat girişi için
    /// <c>null</c>'dır.
    /// </summary>
    /// <remarks>
    /// Bir yabancı anahtar DEĞİLDİR ve öyle olmamalıdır: il veri kümesi
    /// güncellendiğinde ya da bir bölge tanımı değiştiğinde, kaydedilmiş bir
    /// yetki alanının SESSİZCE genişlemesi/daralması olurdu. Kaydedilen şey
    /// geometrinin kendisidir; bu yalnızca "hangi seçimden üretildi" notudur.
    /// </remarks>
    public string? SourceKey { get; set; }

    /// <summary>
    /// İzin verilen alan. Veritabanında <c>geometry(Polygon,4326)</c> olarak
    /// saklanır — WKT metni veya koordinat dizisi olarak DEĞİL; aksi hâlde
    /// PostGIS ile mekânsal sorgu yapılamaz ve indekslenemezdi.
    /// </summary>
    /// <remarks>
    /// Tek satırın alanı daima <b>Polygon</b>'dur. Bir hedefin birden çok
    /// alanı ya da birden çok rolün alanları birleştirildiğinde bellekte
    /// MultiPolygon oluşabilir; bu, saklanan değil hesaplanan bir sonuçtur.
    /// Adaları/kopuk parçaları olan bir il, birden çok SATIR olarak yazılır —
    /// tek bir satırın içine sığdırılmaz.
    /// </remarks>
    public Polygon Area { get; set; } = default!;

    public DateTime CreatedDate { get; set; }

    public DateTime ModifiedDate { get; set; }
}
