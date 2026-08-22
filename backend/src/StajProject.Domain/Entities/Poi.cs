using NetTopologySuite.Geometries;
using StajProject.Domain.Common;

namespace StajProject.Domain.Entities;

/// <summary>
/// İlgi noktası (POI). PostGIS tarafında <c>geometry(Point,4326)</c> olarak
/// saklanır ve harita üzerinde oluşturulup görüntülenir.
/// </summary>
/// <remarks>
/// <para>
/// <b>POI bir ÇİZİM DEĞİLDİR.</b> <see cref="PointFeature"/> ile aynı geometri
/// tipini paylaşır ama <see cref="IDrawingFeature{TGeometry}"/> arayüzünü
/// bilinçli olarak uygulamaz: stil kolonları (renk, kalınlık, yarıçap), çöp
/// kutusu alanları ve legacy <c>CreatedBy</c> metni POI için anlamsızdır.
/// Arayüzü uygulasaydı POI, çizim listelerine, toplu işlemlere, stil
/// düzenleyicisine ve kesişim analizine kendiliğinden karışırdı — hiçbiri
/// istenmez.
/// </para>
/// <para>
/// <b>Sahiplik <see cref="UserId"/>'dir</b> ve daima doğrulanmış JWT
/// kimliğinden yazılır; istek gövdesinden asla okunmaz. Kullanıcı kaydı
/// silinmeye çalışıldığında POI korunur (FK <c>Restrict</c>).
/// </para>
/// <para>
/// <b>Görünürlük çizimlerden AYRIŞIR.</b> Çizimler yalnızca sahibine
/// gösterilir; POI ise <c>poi.view</c> taşıyan herkese açık ortak envanterdir.
/// Bu ayrım okuma sorgusunun sahibi olan servis katmanında uygulanacaktır.
/// </para>
/// </remarks>
public class Poi : IAuditableEntity
{
    /// <summary>EF <c>HasMaxLength</c> ile aynı sınır.</summary>
    public const int MaxNameLength = 200;

    public int Id { get; set; }

    /// <summary>Fiziksel kolon adı ödev şartnamesindeki <c>isim</c>'dir.</summary>
    public string Name { get; set; } = string.Empty;

    public int CategoryId { get; set; }

    public PoiCategory? Category { get; set; }

    /// <summary>
    /// Haftalık mesai saatleri; <c>jsonb</c> kolonunda saklanan ham JSON metni.
    /// Mesai bildirilmemişse <c>null</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Neden <see cref="string"/>.</b> Npgsql metin ile <c>jsonb</c> arasında
    /// yerel bir eşleme sunar ve ek bir yapılandırma gerektirmez; bir POCO'yu
    /// doğrudan <c>jsonb</c>'ye eşlemek ise veri kaynağında dinamik JSON
    /// desteğinin açılmasını isterdi. Domain katmanı bu yüzden ham metni taşır.
    /// </para>
    /// <para>
    /// <b>Şekil burada tanımlanmaz.</b> Haftalık program sözleşmesi (gün
    /// anahtarları, açılış/kapanış, kapalı günler) ve doğrulaması Application
    /// katmanına aittir; entity yalnızca saklama biçimini bilir.
    /// </para>
    /// </remarks>
    public string? WorkHoursJson { get; set; }

    /// <summary>Haritadaki konum. SRID 4326.</summary>
    public Point Coordinate { get; set; } = null!;

    /// <summary>Oluşturan kullanıcı; ownership'in tek otoritesi.</summary>
    public int UserId { get; set; }

    public User? User { get; set; }

    /// <summary>UTC olarak tutulur; servis katmanı damgalar.</summary>
    public DateTime CreatedDate { get; set; }

    /// <summary>UTC olarak tutulur; <c>AppDbContext.SaveChanges</c> damgalar.</summary>
    public DateTime ModifiedDate { get; set; }

    /// <summary>Kayıt kullanımdayken true; silindiğinde false olur.</summary>
    public bool IsActive { get; set; } = true;

    /// <summary>Soft delete işareti; silinen satır korunur, gizlenir.</summary>
    public bool IsDeleted { get; set; }
}
