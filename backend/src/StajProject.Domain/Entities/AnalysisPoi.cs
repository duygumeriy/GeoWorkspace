using NetTopologySuite.Geometries;

namespace StajProject.Domain.Entities;

/// <summary>
/// Konum analizi için tutulan <b>dış kaynaklı (açık veri)</b> ilgi noktası.
/// PostGIS tarafında <c>geometry(Point,4326)</c> olarak saklanır.
/// </summary>
/// <remarks>
/// <para>
/// <b>Bu bir <see cref="Poi"/> DEĞİLDİR ve o tabloya girmez.</b> Normal POI
/// envanteri bir KULLANICI envanteridir: sahibi vardır (<c>user_id</c>, gerçek
/// FK), çöp kutusuna gider ve geri gelir, "POI'lerim" listesinde çıkar, normal
/// aramada görünür, yönetim ekranından düzenlenir ve <c>poi_read</c> SQL
/// View'ı üzerinden herkesin haritasına çizilir. Yüz binlerce satırlık bir açık
/// veri kümesini o tabloya dökmek, sayılan bu altı akışın hepsini aynı anda
/// bozardı — ve hiçbirinin kapatma anahtarı yoktur.
/// </para>
/// <para>
/// <b>Taksonomi ORTAKTIR.</b> Kategori için ikinci bir tablo açılmaz; bu kayıt
/// da <see cref="PoiCategory"/>'ye bağlanır. İki taksonomi, aynı kategorinin
/// iki farklı kimliği demek olurdu ve GeoServer stillerinin eşleştiği slug tek
/// bir yerde tanımlı kalmalıdır.
/// </para>
/// <para>
/// <b>Salt okunur uygulama verisidir.</b> Kullanıcıya açık bir CRUD yolu
/// YOKTUR; tabloyu yalnızca içe aktarıcı doldurur. Bu yüzden sahiplik, çöp
/// kutusu ve onay durumu alanları da bilinçli olarak yoktur — bkz. aşağıdaki
/// alan notları.
/// </para>
/// </remarks>
public class AnalysisPoi
{
    /// <summary>EF <c>HasMaxLength</c> ile aynı sınır.</summary>
    /// <remarks><see cref="Poi.MaxNameLength"/> ile aynı tutulur.</remarks>
    public const int MaxNameLength = 200;

    /// <summary>EF <c>HasMaxLength</c> ile aynı sınır.</summary>
    public const int MaxSourceLength = 32;

    /// <summary>EF <c>HasMaxLength</c> ile aynı sınır.</summary>
    public const int MaxExternalIdLength = 128;

    public int Id { get; set; }

    /// <summary>
    /// Kaydın dış kaynaktaki adı. <b><see cref="Poi.Name"/>'in aksine
    /// NULL olabilir.</b>
    /// </summary>
    /// <remarks>
    /// Açık veri kümelerinde adsız ama geçerli ilgi noktaları sıradandır
    /// (adı girilmemiş bir eczane hâlâ bir eczanedir ve yoğunluk analizinde
    /// sayılmalıdır). Kolonu zorunlu yapmak, içe aktarıcıyı ya o kayıtları
    /// atmaya ya da <c>"İsimsiz"</c> gibi bir ad UYDURMAYA zorlardı; ikisi de
    /// veriyi bozar. Ad, analizin ölçütü değildir — kategori ve konumdur.
    /// </remarks>
    public string? Name { get; set; }

    /// <summary>Ortak taksonomideki kategori.</summary>
    /// <remarks>
    /// <para>
    /// İçe aktarıcı dış etiketi kanonik <b>slug</b> ile eşler ve çözülen
    /// kimliği buraya yazar: sayısal kimlikler ortama özeldir, slug ise
    /// projenin kalıcı kimliğidir.
    /// </para>
    /// <para>
    /// <b>DEĞİŞMEZ — bir dış nesne, TEK bir kanonik kategori.</b> İçe aktarıcı
    /// her zaman EN ÖZEL geçerli kategoriyi seçer (<c>amenity=cafe</c> →
    /// <c>kafe</c>, üst kategorisi <c>yeme-icme</c> DEĞİL) ve aynı dış nesne
    /// için ikinci bir satır YAZMAZ. Üst kategori toplaması içe aktarımda
    /// satır çoğaltarak değil, ANALİZ sırasında alt ağaç genişletmesiyle
    /// yapılır (bkz. <c>LocationAnalysisService</c>). Aksi hâlde aynı kafe hem
    /// <c>kafe</c> hem <c>yeme-icme</c> altında sayılır, tekil dış kimlik
    /// kısıtı anlamını yitirir ve yoğunluk haritası aynı noktayı iki kez
    /// gösterirdi.
    /// </para>
    /// </remarks>
    public int CategoryId { get; set; }

    public PoiCategory? Category { get; set; }

    /// <summary>Konum. SRID 4326.</summary>
    /// <remarks>
    /// Alansal bir dış kaynak nesnesi (bina, park) için içe aktarıcı temsilî
    /// bir nokta üretecektir; bu tablo her zaman NOKTA saklar, çünkü analiz
    /// yoğunluk üzerinden çalışır.
    /// </remarks>
    public Point Coordinate { get; set; } = null!;

    /// <summary>Verinin geldiği kaynak (<c>"osm"</c> gibi).</summary>
    /// <remarks>
    /// <see cref="ExternalId"/> ile birlikte TEKİL bir dış kimlik kurar:
    /// aynı dış nesne iki kez içe aktarılamaz. İkisi ayrı kolonlardır çünkü
    /// ileride ikinci bir kaynak eklendiğinde kimlik uzayları çakışabilir —
    /// tek bir birleşik metin, iki kaynağın aynı numarayı kullanmasını sessiz
    /// bir çakışmaya çevirirdi.
    /// </remarks>
    public string Source { get; set; } = string.Empty;

    /// <summary>Kaynaktaki kimlik (<c>"node/123456"</c> gibi).</summary>
    public string ExternalId { get; set; } = string.Empty;

    /// <summary>Kaydın içe aktarıldığı an; UTC.</summary>
    /// <remarks>
    /// <b>Dış kaynağın düzenleme zamanı DEĞİLDİR.</b> OSM'in kendi
    /// <c>timestamp</c>'i başka bir sistemdeki düzenlemeyi anlatır; onu bir
    /// uygulama denetim alanına yazmak, iki farklı olayı tek bir kolonda
    /// karıştırmak olurdu. Bu alan yalnızca "bu satır bize ne zaman girdi"
    /// sorusunu yanıtlar.
    /// </remarks>
    public DateTime ImportedAt { get; set; }

    /* --- Bilinçli olarak YOK OLAN alanlar --------------------------------------

       UserId / OwnerId / CreatedBy:
           Açık veri kaydının bir GeoWorkspace kullanıcısı yoktur. Uydurma bir
           "içe aktarım kullanıcısı" yazmak, o kimliğe PoiAuthority üzerinden
           gerçek düzenleme/silme yetkisi vermek demekti; sahiplik sınırı bir
           kurgu üzerine kurulurdu.

       IsDeleted / IsActive:
           Normal POI'de bu ikili TEK BAŞINA üç sözleşmeye birden hizmet eder —
           çöp kutusu akışı, EF global query filter'ı ve `poi_read` SQL View'ı.
           Buradaki kaydın çöp kutusu akışı yoktur; yukarıdan gelen bir silme
           bir KULLANICI kararı değil, bir eşitleme olayıdır ve o gün kendi
           anlamıyla modellenmelidir. Boş bir bayrak çifti eklemek, ileride
           birinin onu çöp kutusu sanmasına davetiye olurdu.

       Onay durumu (approval):
           Normal POI'de de yoktur; buraya eklemek var olmayan bir iş akışını
           şemaya yazmak olurdu. */
}
