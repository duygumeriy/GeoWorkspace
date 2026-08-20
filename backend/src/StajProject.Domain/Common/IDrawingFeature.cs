using NetTopologySuite.Geometries;

namespace StajProject.Domain.Common;

/// <summary>
/// tbl_point / tbl_line / tbl_polygon entity'lerinin ortak şekli.
/// Kayıt/okuma mantığının tek bir generic implementasyonla yazılabilmesi içindir;
/// EF mapping'i etkilemez (mapping'ler ayrı IEntityTypeConfiguration sınıflarında).
/// </summary>
public interface IDrawingFeature<TGeometry> : IStyledDrawingFeature
    where TGeometry : Geometry
{
    TGeometry Geometry { get; set; }
}

/// <summary>
/// Geometry tipinden bağımsız kısım: kimlik, stil ve audit alanları.
/// Generic olmayan servis kodunun (stil güncelleme, response mapping) tek bir
/// implementasyonla çalışabilmesi için ayrılmıştır.
/// </summary>
public interface IStyledDrawingFeature
{
    int Id { get; set; }

    string Name { get; set; }

    /* --- Kullanıcı metadata'sı -----------------------------------------------
       Üçü de OPSİYONELDİR ve stil kolonlarından ayrı durur: stil kaydın nasıl
       göründüğünü, bunlar kaydın ne olduğunu anlatır. Soft delete bu alanlara
       DOKUNMAZ, dolayısıyla geri alınan (restore) bir kayıt metadata'sıyla
       birlikte geri gelir. */

    /// <summary>Serbest metin açıklama. Boş bırakılabilir.</summary>
    string? Description { get; set; }

    /// <summary>
    /// <see cref="DrawingCategories"/> kümesinden bir değer, ya da "kategori yok"
    /// için <c>null</c>. Kanonik yazımla saklanır.
    /// </summary>
    string? Category { get; set; }

    /// <summary>
    /// Kullanıcı etiketleri. Kırpılmış, boşları atılmış ve büyük/küçük harf
    /// duyarsız tekilleştirilmiş hâlde saklanır (bkz. <c>DrawingMetadataValidator</c>).
    /// Etiketi olmayan kayıtta boş liste durur, <c>null</c> değil — okuyan kodun
    /// her seferinde null kontrolü yapması gerekmesin diye.
    /// </summary>
    List<string> Tags { get; set; }

    /// <summary>#RRGGBB. Her türde zorunlu.</summary>
    string StrokeColor { get; set; }

    int StrokeWidth { get; set; }

    /// <summary>Line için null (dolgu yok).</summary>
    string? FillColor { get; set; }

    /// <summary>Yalnızca Polygon için dolu.</summary>
    double? FillOpacity { get; set; }

    /// <summary>solid | dashed | dotted | dashdot. Point için null.</summary>
    string? LineStyle { get; set; }

    /// <summary>UTC. Yalnızca backend yazar.</summary>
    DateTime CreatedDate { get; set; }

    /// <summary>UTC. AppDbContext.SaveChanges içinde damgalanır.</summary>
    DateTime ModifiedDate { get; set; }

    /// <summary>
    /// Kaydı oluşturan kullanıcının Identity kimliği. <b>Ownership'in tek
    /// otoritesi budur</b> — yetkilendirme kararları yalnızca bu alana bakar.
    /// Değer daima doğrulanmış JWT'den gelir; client gönderemez.
    /// </summary>
    int CreatedByUserId { get; set; }

    /// <summary>
    /// Sahip kullanıcı. Response'ta gösterilecek kullanıcı adı bu ilişkiden
    /// türetilir, böylece kullanıcı adı tek bir yerde tutulmuş olur.
    /// </summary>
    Entities.User? CreatedByUser { get; set; }

    /// <summary>
    /// Kaydı oluşturan kullanıcının adı. <b>Legacy alan</b>: AUTH-4 öncesinde
    /// tek sahiplik bilgisiydi, artık yalnızca geriye dönük uyumluluk için
    /// yazılır ve yetkilendirmede <b>kullanılmaz</b>
    /// (bkz. <see cref="CreatedByUserId"/>).
    /// </summary>
    string CreatedBy { get; set; }

    /* --- Soft delete ---------------------------------------------------------
       Silme işlemi satırı kaldırmaz, yalnızca işaretler. Böylece geri alma
       (undo) aynı satırı — aynı Id, aynı CreatedByUserId ile — geri açar ve
       sahiplik doğal olarak korunur; sahiplik bilgisinin client'tan geri
       gönderilmesine hiç gerek kalmaz.

       Silinmiş kayıtlar EF global query filter'ı sayesinde okuma, listeleme,
       toplu işlem ve spatial analiz sorgularının hepsinden otomatik olarak
       düşer; her sorguya elle filtre eklenmez. */

    bool IsDeleted { get; set; }

    /// <summary>
    /// Kaydın kullanımda olup olmadığı. Soft delete ile birlikte
    /// <c>false</c> olur, geri alma (undo) ile yeniden <c>true</c> yapılır.
    /// <see cref="IsDeleted"/> "silindi mi", bu alan "kullanımda mı"
    /// sorusunu yanıtlar; normal sorgular ikisini birden şart koşar.
    /// </summary>
    bool IsActive { get; set; }

    /// <summary>UTC. Yalnızca silme anında yazılır.</summary>
    DateTime? DeletedAt { get; set; }

    /// <summary>
    /// Silme işlemini yapan kullanıcı (denetim izi). Sahiplikten bağımsızdır:
    /// bir Administrator başkasının çizimini silebilir, bu kaydın sahibini değiştirmez.
    /// </summary>
    int? DeletedByUserId { get; set; }
}

/// <summary>
/// Yalnızca tbl_point'te kolonu bulunan alan. Line/Polygon bu arayüzü
/// implemente etmez, dolayısıyla o tablolarda PointRadius kolonu oluşmaz.
/// </summary>
public interface IPointStyledFeature
{
    int? PointRadius { get; set; }
}
