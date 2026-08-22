namespace StajProject.Application.DTOs;

/// <summary>
/// Harita üzerinden POI oluşturma isteği.
/// </summary>
/// <remarks>
/// <para>
/// <b>Sunucuya ait alanlar burada TANIMLI DEĞİLDİR.</b> <c>userId</c>,
/// <c>createdDate</c>, <c>modifiedDate</c>, <c>isActive</c>, <c>isDeleted</c>
/// ve <c>creatorUsername</c> gövdede gönderilse bile model binder onları
/// bağlayacak bir property bulamaz — sahiplik ve audit değerleri
/// uydurulamaz. Aynı savunma <c>CreateDrawingRequest</c> içinde de kullanılır.
/// </para>
/// <para>
/// <b>Koordinat WKT değil, iki sayıdır.</b> POI daima tek bir noktadır;
/// serbest bir geometri metni kabul etmek, ayrıştırma hatalarına ve yanlış
/// geometri tipi gönderme ihtimaline kapı açardı. SRID de istemciden
/// alınmaz — sözleşme gereği değerler EPSG:4326'dır ve sunucu geometriyi
/// 4326 olarak kurar.
/// </para>
/// </remarks>
public class CreatePoiRequest
{
    /// <summary>ZORUNLU. Kırpılır; en fazla 200 karakter.</summary>
    public string? Name { get; set; }

    /// <summary>ZORUNLU. Var olan, aktif ve silinmemiş bir kategori olmalıdır.</summary>
    public int CategoryId { get; set; }

    /// <summary>Opsiyonel. Gönderilmezse POI mesai bilgisi olmadan kaydedilir.</summary>
    public PoiWorkHoursDto? WorkHours { get; set; }

    /// <summary>EPSG:4326 boylam. -180 ile 180 arasında, sonlu bir sayı.</summary>
    public double Longitude { get; set; }

    /// <summary>EPSG:4326 enlem. -90 ile 90 arasında, sonlu bir sayı.</summary>
    public double Latitude { get; set; }
}

/// <summary>
/// Haritanın gördüğü POI. <c>poi.view</c> taşıyan HERKESE döner.
/// </summary>
/// <remarks>
/// <b>Oluşturan bilgisi bilinçli olarak YOKTUR.</b> Sıradan bir harita
/// kullanıcısının bir noktayı görebilmesi, o noktayı kimin eklediğini
/// öğrenebilmesi anlamına gelmez; kullanıcı adı ya da kimliği burada dönseydi,
/// harita sessizce bir personel dizinine dönüşürdü. Bu bilgiyi gerektiren tek
/// ekran yönetim panelidir ve onun ayrı bir sözleşmesi vardır
/// (<see cref="AdminPoiResponse"/>).
/// </remarks>
public class PoiResponse
{
    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public int CategoryId { get; set; }

    public string CategoryName { get; set; } = string.Empty;

    /// <summary>Kök kategoriden bu kategoriye kadar olan yol.</summary>
    public string CategoryPath { get; set; } = string.Empty;

    /// <summary>Mesai bildirilmemişse <c>null</c>.</summary>
    public PoiWorkHoursDto? WorkHours { get; set; }

    public double Longitude { get; set; }

    public double Latitude { get; set; }
}

/// <summary>
/// Yönetim panelinin gördüğü POI. Yalnızca <c>poi.manage</c> ile döner.
/// </summary>
/// <remarks>
/// Ödevin "POI Yönetimi" ekranı kimin hangi kaydı eklediğini göstermek
/// zorundadır; bu yüzden harita sözleşmesinden farklı olarak oluşturan bilgisi
/// ve audit alanları buradadır. Kimlik doğrulama/güvenlik verisi (e-posta,
/// parola hash'i, stamp, rol) hiçbir koşulda yer almaz.
/// </remarks>
public class AdminPoiResponse
{
    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public int CategoryId { get; set; }

    public string CategoryName { get; set; } = string.Empty;

    public string CategoryPath { get; set; } = string.Empty;

    public PoiWorkHoursDto? WorkHours { get; set; }

    public double Longitude { get; set; }

    public double Latitude { get; set; }

    public int CreatorUserId { get; set; }

    /// <summary>Kullanıcı adı. Hesap silinmişse boş kalabilir.</summary>
    public string CreatorUsername { get; set; } = string.Empty;

    public DateTime CreatedDate { get; set; }

    public DateTime ModifiedDate { get; set; }

    public bool IsActive { get; set; }

    public bool IsDeleted { get; set; }
}
