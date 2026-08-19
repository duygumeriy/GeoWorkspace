using Microsoft.AspNetCore.Identity;
using NetTopologySuite.Geometries;

namespace StajProject.Domain.Entities;

/// <summary>
/// Bir kullanıcının VEYA bir rolün coğrafi yetki alanı: o hedefin sistemde
/// geometri üretebileceği sınır.
/// </summary>
/// <remarks>
/// <para>
/// <b>Hedef tektir.</b> Bir satır ya bir kullanıcıya ya bir role bağlıdır —
/// ikisine birden değil, hiçbirine de değil. Kural veritabanında bir CHECK
/// kısıtı olarak da durur: uygulama katmanındaki bir doğrulama, elle atılan bir
/// INSERT'ü ya da ileride yazılacak ikinci bir kod yolunu bağlamaz.
/// </para>
/// <para>
/// <b>Hedef başına EN FAZLA BİR satır.</b> Kapsam bir geçmiş listesi değil,
/// yürürlükteki tek alandır; güncelleme aynı satırın poligonunu değiştirir.
/// Çok bölgeli yetki ihtiyacı, kullanıcının birden çok role üye olmasıyla
/// doğal olarak karşılanır (roller birleştirilir), ayrı bir "çoklu alan"
/// modeline gerek kalmaz.
/// </para>
/// <para>
/// <b>Alan yalnızca izin verir, yasaklamaz.</b> Negatif/dışlama bölgesi,
/// öncelik sırası ve kapsam geçmişi bilinçli olarak YOKTUR: bunlar "buraya
/// çizebilir miyim" sorusunun cevabını kuralların sırasına bağımlı hale
/// getirirdi. Satır yoksa kısıt da yoktur.
/// </para>
/// </remarks>
public class GeographicAuthorization
{
    public int Id { get; set; }

    /// <summary>Hedef kullanıcı. <see cref="RoleId"/> doluysa <c>null</c>'dır.</summary>
    public int? UserId { get; set; }

    public User? User { get; set; }

    /// <summary>Hedef rol. <see cref="UserId"/> doluysa <c>null</c>'dır.</summary>
    public int? RoleId { get; set; }

    public IdentityRole<int>? Role { get; set; }

    /// <summary>
    /// İzin verilen alan. Veritabanında <c>geometry(Polygon,4326)</c> olarak
    /// saklanır — WKT metni veya koordinat dizisi olarak DEĞİL; aksi hâlde
    /// PostGIS ile mekânsal sorgu yapılamaz ve indekslenemezdi.
    /// </summary>
    /// <remarks>
    /// Tek hedefin alanı daima <b>Polygon</b>'dur. Birden çok rolün alanı
    /// birleştirildiğinde bellekte MultiPolygon oluşabilir; bu, saklanan değil
    /// hesaplanan bir sonuçtur.
    /// </remarks>
    public Polygon Area { get; set; } = default!;

    public DateTime CreatedDate { get; set; }

    public DateTime ModifiedDate { get; set; }
}
