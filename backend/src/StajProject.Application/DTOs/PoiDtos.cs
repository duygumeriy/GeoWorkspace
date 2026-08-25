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
/// Var olan bir POI'nin düzenlenmesi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Sunucuya ait alanlar burada da TANIMLI DEĞİLDİR.</b> <c>userId</c>,
/// <c>createdDate</c>, <c>modifiedDate</c>, <c>isActive</c>, <c>isDeleted</c>
/// ve <c>creatorUsername</c> gövdede gönderilse bile bağlanacak bir property
/// yoktur — düzenleme, sahipliği ve denetim alanlarını hiçbir yoldan
/// değiştiremez. Oluşturan, düzenlemeden SONRA da aynı kişidir.
/// </para>
/// <para>
/// <b>Koordinat OPSİYONEL bir ÇİFTTİR.</b> Üçü de mümkündür ve üçü de
/// açıkça tanımlıdır:
/// </para>
/// <list type="bullet">
/// <item>ikisi de gönderilmez → kayıt YERİNDE kalır (eski istemciler ve konum
/// alanı sunmayan ekranlar bu ucu değiştirmeden kullanmaya devam eder);</item>
/// <item>ikisi de gönderilir → doğrulanır, coğrafi yetkiden geçirilir ve
/// geometri güncellenir;</item>
/// <item>yalnızca biri gönderilir → REDDEDİLİR. Yarım bir koordinat diye bir
/// şey yoktur; eksik yarısını eski değerle tamamlamak, kullanıcının hiç
/// istemediği bir noktaya taşımak olurdu.</item>
/// </list>
/// <para>
/// SRID yine istemciden alınmaz: değerler sözleşme gereği EPSG:4326'dır ve
/// geometriyi sunucu 4326 olarak kurar.
/// </para>
/// </remarks>
public class UpdatePoiRequest
{
    /// <summary>ZORUNLU. Kırpılır; en fazla 200 karakter.</summary>
    public string? Name { get; set; }

    /// <summary>ZORUNLU. Var olan, aktif ve silinmemiş bir kategori olmalıdır.</summary>
    public int CategoryId { get; set; }

    /// <summary>Gönderilmezse mesai bilgisi TEMİZLENİR (null yazılır).</summary>
    public PoiWorkHoursDto? WorkHours { get; set; }

    /// <summary>
    /// EPSG:4326 boylam. <see cref="Latitude"/> ile BİRLİKTE gönderilir ya da
    /// hiç gönderilmez.
    /// </summary>
    public double? Longitude { get; set; }

    /// <summary>
    /// EPSG:4326 enlem. <see cref="Longitude"/> ile BİRLİKTE gönderilir ya da
    /// hiç gönderilmez.
    /// </summary>
    public double? Latitude { get; set; }
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

    /* --- Yetenek bayrakları ---------------------------------------------------

       İkisi de SUNUCUDA hesaplanır ve "bu çağıran bu kayıtta ne yapabilir"
       sorusunu yanıtlar: poi.manage VEYA (sahiplik VE poi.update/poi.delete).

       Neden kullanıcı kimliği yerine bayrak. Arayüzün "Düzenle" düğmesini
       gösterebilmesi için kaydın sahibini BİLMESİ gerekmez — yalnızca kendi
       yetkisini bilmesi gerekir. Oluşturan kimliğini haritaya taşımak, harita
       sözleşmesinin bilinçli olarak dışarıda bıraktığı bilgiyi (kim neyi
       ekledi) her kullanıcıya açardı; bayrak ise aynı arayüzü sızıntısız
       kurar.

       Bunlar bir GÜVENLİK SINIRI DEĞİLDİR: her mutasyon ucu aynı kararı
       sunucuda yeniden verir ve yetkisiz isteğe 403 döner. Bayraklar yalnızca
       garanti reddedilecek bir eylemin sunulmasını engeller. */

    /// <summary>Çağıran bu POI'yi düzenleyebilir mi.</summary>
    public bool CanUpdate { get; set; }

    /// <summary>Çağıran bu POI'yi silebilir (ve geri yükleyebilir) mi.</summary>
    public bool CanDelete { get; set; }
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

/// <summary>
/// Çöp Kutusu'ndaki tek bir silinmiş POI.
/// </summary>
/// <remarks>
/// <para>
/// Çizim tarafındaki <see cref="DeletedDrawingResponse"/> ile AYNI sözleşmeyi
/// izler: kaydın kendisi normal harita gövdesiyle (<see cref="PoiResponse"/>)
/// taşınır, sarmalayıcı yalnızca listenin ihtiyaç duyduğu iki şeyi ekler —
/// kaydın türü ve ne zaman silindiği. Böylece geri yüklenen POI, çöp
/// kutusunda göründüğü gibi haritada da görünür.
/// </para>
/// <para>
/// <b><see cref="DeletedAt"/> ayrı bir kolon DEĞİLDİR.</b> POI tablosunda
/// çizimlerdeki gibi bir <c>deleted_at</c> alanı yoktur ve bu faz için bir
/// migration açmak, tek bir okuma alanı uğruna şema değiştirmek olurdu: soft
/// delete <c>modified_date</c>'i damgalar, dolayısıyla silinmiş bir kaydın son
/// değişiklik zamanı onun silinme zamanıdır.
/// </para>
/// <para>
/// <b>Oluşturan bilgisi YALNIZCA yetkiliye doldurulur.</b> Harita sözleşmesi
/// kullanıcı adı taşımaz; çöp kutusunda da taşımaz — tek istisna
/// <c>poi.manage</c> ile listeyi açan yönetim yetkisidir, çünkü o zaten
/// başkalarının kayıtlarını görmektedir ve kimin sildiğini bilmeden geri
/// yükleme kararı veremez. Yetkisiz çağıran için alan boş kalır.
/// </para>
/// </remarks>
public class DeletedPoiResponse
{
    /// <summary>Daima <c>poi</c>. Çöp Kutusu'nun tür ayrımını yapan alan.</summary>
    public string Type { get; set; } = "poi";

    /// <summary>UTC silinme zamanı (<c>modified_date</c>).</summary>
    public DateTime? DeletedAt { get; set; }

    /// <summary>Yalnızca <c>poi.manage</c> ile dolu; aksi hâlde boş.</summary>
    public string CreatorUsername { get; set; } = string.Empty;

    /// <summary>Kaydın normal harita gövdesiyle aynı gövde.</summary>
    public PoiResponse Poi { get; set; } = new();
}

/// <summary>
/// Arama kutusunun gördüğü POI. Kasıtlı olarak DAR bir sözleşmedir.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden <see cref="PoiResponse"/> yeniden kullanılmadı.</b> Arama sonucu
/// bir liste satırıdır: bir simge, bir ad ve bir kategori gösterir. Harita
/// sözleşmesi ise mesai programını ve yetenek bayraklarını (<c>canUpdate</c>,
/// <c>canDelete</c>) taşır; bunlar her tuş vuruşunda hesaplanıp gönderilseydi
/// hem gereksiz iş hem de arama ucunun cevaplamadığı bir soruya verilmiş bir
/// yanıt olurdu. Yetenek kararı kaydın kendisi açıldığında verilir.
/// </para>
/// <para>
/// <b>Kategori metadatası ARAMA yanıtından gelir</b>, istemcideki bir kopyadan
/// değil: renk ve simge anahtarının tek kaynağı veritabanıdır. İstemci yalnızca
/// <c>icon_key → bileşen</c> eşlemesini bilir.
/// </para>
/// <para>
/// <b>Kategori YOLU (<c>CategoryPath</c>) bilinçli olarak yoktur.</b> Yol,
/// kategori ağacının tamamının okunmasını gerektirir; arama tek bir sorguyla
/// yetinmelidir ve arama satırı zaten yaprak kategori adını gösterir.
/// </para>
/// </remarks>
public class PoiSearchResult
{
    public int Id { get; set; }

    /// <summary>Fiziksel kolon <c>isim</c>.</summary>
    public string Name { get; set; } = string.Empty;

    public int CategoryId { get; set; }

    public string CategoryName { get; set; } = string.Empty;

    /// <summary>Değişmez teknik kimlik; GeoServer stilleriyle ortak dil.</summary>
    public string CategorySlug { get; set; } = string.Empty;

    /// <summary>Denetimli simge anahtarı; istemci bunu bir bileşene eşler.</summary>
    public string? IconKey { get; set; }

    /// <summary>Kanonik <c>#RRGGBB</c>; yoksa istemci nötr yedeğe düşer.</summary>
    public string? ColorHex { get; set; }

    /// <summary>Coordinate.X — SRID 4326 boylam.</summary>
    public double Longitude { get; set; }

    /// <summary>Coordinate.Y — SRID 4326 enlem.</summary>
    public double Latitude { get; set; }
}
