namespace StajProject.Application.DTOs;

/// <summary>
/// <c>POST /api/analysis/location</c> gövdesi.
/// </summary>
/// <remarks>
/// <para>
/// <b><see cref="IntersectionAnalysisRequest"/> YENİDEN KULLANILMAZ.</b> İkisi
/// farklı sorular sorar: envanter analizi çağıranın KENDİ çizimlerini sayar ve
/// tek bir poligon alır; konum analizi ORTAK açık veri kümesini kategori
/// ağırlıklarıyla puanlar ve çok parçalı bir hedef alabilir. Ortak bir gövdeye
/// zorlamak, her iki uçta da anlamsız alanlar taşımak olurdu. Ortak olan şey
/// gövde değil, <b>doğrulama yolu</b>dur (bkz. <c>WktGeometryParser</c>).
/// </para>
/// <para>
/// <b>Sahiplik burada YOKTUR ve olmamalıdır.</b> Konum analizi sahibe göre
/// daraltılmaz; açık veri kümesi ortaktır. Gövdeye bir kullanıcı kimliği
/// koymak, kapsamı istemcinin belirlemesine izin vermek olurdu.
/// </para>
/// <para>
/// <b>Hedef alan KAYDEDİLMEZ.</b> Yalnızca sorgu parametresidir — envanter
/// analiziyle aynı sözleşme. Coğrafi yetki alanı tablosuyla hiçbir ilişkisi
/// yoktur: orası bir YAZMA sınırıdır.
/// </para>
/// </remarks>
public class LocationAnalysisRequest
{
    /// <summary>
    /// Hazır idari hedefin türü: <c>province</c> veya <c>region</c>.
    /// Serbest çizimde boş bırakılır.
    /// </summary>
    public string? AdministrativeTargetType { get; set; }

    /// <summary>
    /// Hazır hedefin kanonik anahtarı (<c>TR-55</c>, <c>IC_ANADOLU</c>).
    /// Ad değil anahtar taşınır; sunucu hem yetkiyi hem geometriyi kendi
    /// kataloğundan doğrular.
    /// </summary>
    public string? AdministrativeTargetKey { get; set; }

    /// <summary>
    /// Hedef alanın parçaları; her biri EPSG:4326 <b>POLYGON</b> WKT'si.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Neden liste, neden tek bir MultiPolygon değil.</b> Ön yüzdeki il ve
    /// bölge seçimi zaten parça başına bir POLYGON üretir
    /// (<c>turkeyGeography.provinceAreas()</c>) ve saklama modeli de satır
    /// başına tek poligondur (<c>geographic_authorizations</c>). Liste, o
    /// biçimin birebir karşılığıdır: istemci hiçbir dönüşüm yapmaz ve mevcut
    /// <c>Parse&lt;Polygon&gt;</c> doğrulaması parça başına AYNEN çalışır.
    /// </para>
    /// <para>
    /// <b>Hiçbir parça atılmaz.</b> Adaları olan bir il ya da boğazla ayrılan
    /// bir bölge birden çok parça gönderir; sunucu hepsini birleştirip TEK bir
    /// hedef olarak kullanır. Yalnızca ilk parçayı almak ya da kapsayan
    /// dikdörtgene indirgemek, o ilin adalarını sessizce analiz dışında
    /// bırakmak olurdu.
    /// </para>
    /// <para>
    /// Serbest çizim tek elemanlı bir liste gönderir; özel bir durum değildir.
    /// </para>
    /// </remarks>
    public List<string>? AreaWkts { get; set; }

    /// <summary>Ağırlıklandırılmış kategori ölçütleri: en az 2, en çok 5.</summary>
    public List<LocationAnalysisCriterionRequest>? Criteria { get; set; }
}

/// <summary>
/// Kullanıcının konum analizinde seçebileceği idari hedefler.
/// </summary>
public sealed class LocationAnalysisTargetCatalogResponse
{
    public bool IsRestricted { get; set; }

    public List<LocationAnalysisAdministrativeTargetResponse> Regions { get; set; } = [];

    public List<LocationAnalysisAdministrativeTargetResponse> Provinces { get; set; } = [];
}

/// <summary>Backend tarafından yetkilendirilmiş tek bir il veya bölge.</summary>
public sealed class LocationAnalysisAdministrativeTargetResponse
{
    public string Key { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Katalogdaki EPSG:4326 Polygon parçaları. İstemci bunları haritada
    /// gösterir; analiz ucu aynı parçaları yeniden backend kataloğuyla
    /// karşılaştırır.
    /// </summary>
    public List<string> AreaWkts { get; set; } = [];

    /// <summary>Bölge kaydında, kataloğa girebilen üye il anahtarları.</summary>
    public List<string> ProvinceKeys { get; set; } = [];
}

/// <summary>Tek bir ağırlıklandırılmış kategori ölçütü.</summary>
public class LocationAnalysisCriterionRequest
{
    /// <summary>
    /// Kanonik kategori slug'ı (<c>eczane</c>, <c>okullar</c>).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Bir ALT AĞAÇ seçer.</b> Üst kategori gönderildiğinde o kategoriye
    /// doğrudan bağlı kayıtlar ve tüm aktif torunları tek bir ölçüt olarak
    /// sayılır. Bu yüzden bir üst kategori ile onun alt kategorisi aynı
    /// istekte BİRLİKTE gönderilemez: alt zaten üstün kapsamındadır ve ikisi
    /// birlikte aynı kaydı iki kez ağırlıklandırırdı. Kardeş kategoriler
    /// (<c>kafe</c> + <c>restoran</c>) ve ilgisiz kökler serbesttir.
    /// </para>
    /// <b>Sayısal kimlik DEĞİL.</b> <c>poi_category.id</c> identity kolonundan
    /// üretilir ve ortamdan ortama farklıdır; geliştirme veritabanında
    /// <c>eczane</c> olan 34, üretimde başka bir kategori olabilir. Slug ise
    /// bir kez üretilir ve değişmez — GeoServer stillerinin ve taksonomi
    /// kataloğunun eşleştiği kimlik de odur.
    /// </remarks>
    public string? CategorySlug { get; set; }

    /// <summary>Yüzde olarak ağırlık; pozitif TAM SAYI, toplamı tam 100.</summary>
    /// <remarks>
    /// <b>Tam sayıdır, ondalık değil.</b> "Toplam tam 100 olmalı" kuralı
    /// ondalık sayılarla güvenilir biçimde sınanamaz: <c>33.33 + 33.33 +
    /// 33.34</c> ikili gösterimde 100'e eşit ÇIKMAYABİLİR ve kullanıcı,
    /// ekranda 100 gördüğü hâlde reddedilirdi. Tam sayı toplamı kesindir.
    /// </remarks>
    public int Weight { get; set; }
}

/// <summary>
/// Konum analizi sonucu — <b>kompakt özet</b>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Eşleşen POI'lerin kendisi DÖNMEZ.</b> Envanter analizi kayıtları
/// listeler ve bu doğrudur: orada küme, çağıranın kendi çizimleridir ve
/// haritada zaten yüklüdür. Burada küme ülke ölçeğinde bir açık veri
/// kümesidir; tek bir il seçimi yüz binlerce noktaya karşılık gelebilir ve
/// hepsini JSON olarak taşımak, tarayıcıyı da ağı da anlamsızca yorardı.
/// Yoğunluğun GÖRSEL karşılığı sonraki fazda sunucuda üretilecek bir
/// katmandır; bu uç yalnızca SAYIYI ve ağırlık aritmetiğini açıklar.
/// </para>
/// <para>
/// <b>Değişmez:</b> <see cref="TotalMatchingPoiCount"/>, ölçüt kırılımlarının
/// toplamına eşittir — ölçütler ayrık kategorilerdir ve bir POI'nin tek bir
/// kategorisi vardır.
/// </para>
/// </remarks>
public class LocationAnalysisResponse
{
    /// <summary>Hedef alanın özeti; geometrinin kendisi geri gönderilmez.</summary>
    public LocationAnalysisTargetResponse Target { get; set; } = new();

    /// <summary>Seçili kategorilerden herhangi birine ait, alan içindeki POI sayısı.</summary>
    public int TotalMatchingPoiCount { get; set; }

    /// <summary>
    /// Ölçütlerin ağırlıklı katkılarının toplamı.
    /// </summary>
    /// <remarks>
    /// <b>Bir "skor" DEĞİLDİR</b> ve öyle adlandırılmaz: nihai analiz çıktısı
    /// MEKÂNSAL bir yoğunluktur ve sonraki fazda üretilir. Buradaki sayı
    /// yalnızca ağırlık aritmetiğinin şeffaf toplamıdır — tek bir sayıya
    /// "konum skoru" demek, mekânsal dağılımı hiç hesaba katmayan bir değeri
    /// nihai cevap gibi sunmak olurdu.
    /// </remarks>
    public decimal TotalWeightedContribution { get; set; }

    /// <summary>Ölçüt kırılımı; istekteki sırayla döner.</summary>
    public List<LocationAnalysisCriterionResponse> Criteria { get; set; } = [];
}

/// <summary>Hedef alanın kompakt özeti.</summary>
/// <remarks>
/// Geometrinin kendisi geri DÖNMEZ: istemci onu zaten göndermiştir ve elinde
/// tutar. Buradaki iki alan, sonucun hangi alana ait olduğunu doğrulamaya ve
/// haritayı sonuca odaklamaya yeter.
/// </remarks>
public class LocationAnalysisTargetResponse
{
    /// <summary>Birleştirilen poligon parçası sayısı (ada/kopuk bölüm dâhil).</summary>
    public int PartCount { get; set; }

    /// <summary>Birleşik hedefin kapsayan dikdörtgeni: minLon, minLat, maxLon, maxLat.</summary>
    /// <remarks>
    /// Kapsayan dikdörtgen analizde KULLANILMAZ — eşleşme her zaman gerçek
    /// poligonla hesaplanır. Yalnızca sonucun sunumu içindir.
    /// </remarks>
    public double MinLongitude { get; set; }

    public double MinLatitude { get; set; }

    public double MaxLongitude { get; set; }

    public double MaxLatitude { get; set; }
}

/// <summary>Tek bir ölçütün sonucu.</summary>
public class LocationAnalysisCriterionResponse
{
    public string CategorySlug { get; set; } = string.Empty;

    /// <summary>Kategorinin görünen adı; istemci ikinci bir istek açmasın diye taşınır.</summary>
    public string CategoryName { get; set; } = string.Empty;

    /// <summary>İstekte gönderilen tam sayı ağırlık.</summary>
    public int Weight { get; set; }

    /// <summary><see cref="Weight"/> / 100. Sonraki fazda POI başına uygulanacak değer.</summary>
    public decimal NormalizedWeight { get; set; }

    /// <summary>
    /// Hedef alan içinde, bu ölçütün <b>alt ağacına</b> düşen POI sayısı.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Bir ölçüt bir ALT AĞACI temsil eder.</b> Yaprak bir kategori
    /// seçildiğinde sayı yalnızca o kategorinin kayıtlarıdır; bir ÜST kategori
    /// seçildiğinde ise o kategoriye doğrudan bağlı kayıtlar VE tüm aktif
    /// torunlarının kayıtları birlikte sayılır. Taksonomi hiyerarşiktir ve bir
    /// POI her zaman en özel kategorisine yazılır — "Sağlık Kurumları" seçen
    /// bir kullanıcı, eczaneler <c>eczane</c> altında durduğu için hiçbir
    /// eczaneyi göremeseydi sonuç yanlış olurdu.
    /// </para>
    /// <para>
    /// <b>Çifte sayım imkânsızdır.</b> Bir üst kategori ile onun alt
    /// kategorisi aynı analizde birlikte seçilemez (400), dolayısıyla eşleşen
    /// her POI en fazla BİR ölçüte sayılır ve
    /// <see cref="LocationAnalysisResponse.TotalMatchingPoiCount"/> gerçekten
    /// eşleşen kayıt sayısıdır.
    /// </para>
    /// </remarks>
    public int MatchingPoiCount { get; set; }

    /// <summary>
    /// Bu ölçütün KAPSADIĞI kategori sayısı: kendisi + aktif torunları.
    /// </summary>
    /// <remarks>
    /// <b>Eşleşme BULUNAN kategori sayısı DEĞİLDİR.</b> Alt ağaçtaki bir
    /// kategoriye hiç POI düşmese bile kapsama dâhildir; sayı taksonomiyi
    /// anlatır, sonucu değil. Ad bu yüzden "matched" değil "covered"dır.
    /// Yaprak bir ölçütte <c>1</c>'dir. Sayının varlık sebebi
    /// <see cref="MatchingPoiCount"/>'un NE ANLAMA geldiğini açıklamaktır:
    /// <c>3</c> gören bir kullanıcı, sayının tek bir kategoriden değil bir alt
    /// ağaçtan geldiğini görür. Taksonominin şeklini sızdırmaz — aynı bilgi
    /// zaten <c>GET /api/poi/categories</c> ile açıktır.
    /// </remarks>
    public int CoveredCategoryCount { get; set; }

    /// <summary>
    /// <see cref="MatchingPoiCount"/> × <see cref="NormalizedWeight"/>.
    /// </summary>
    /// <remarks>
    /// Aritmetiği ŞEFFAF tutmak içindir: istemci aynı çarpımı kendisi yapabilir
    /// ve sonucun ağırlıkları gerçekten uyguladığını doğrulayabilir.
    /// </remarks>
    public decimal WeightedContribution { get; set; }
}

/// <summary>
/// <c>POST /api/analysis/location/image</c> gövdesi: aynı analiz + görüntü
/// penceresi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden <see cref="LocationAnalysisRequest"/>'ten TÜRER.</b> Analizin
/// tanımı (alan + ölçütler) iki uçta da AYNIdır ve tek bir doğrulayıcıdan
/// geçer; raster ucunun eklediği tek şey nereye çizileceğidir. Alanları
/// kopyalamak, ilerideki bir doğrulama değişikliğinin yalnızca bir uca
/// uygulanması riskini yaratırdı.
/// </para>
/// <para>
/// <b>Neden ÖZET ucundan ayrı bir uç.</b> Özet, görüntü penceresinden
/// bağımsızdır ve harita hareketinde değişmez; raster ise yalnızca dört
/// yakınlık bandından biri geçildiğinde yeniden istenir. İkisini tek uçta birleştirmek,
/// yalnızca sayı isteyen her çağrıda bir PNG çizdirmek olurdu.
/// </para>
/// <para>
/// <b>Neden POST.</b> Çok parçalı bir il seçimi binlerce köşe taşır; WKT
/// listesi bir sorgu dizesine sığmaz. Mevcut heatmap servisi de aynı nedenle
/// GeoServer'a POST eder.
/// </para>
/// <para>
/// <b>GeoServer'a dair hiçbir alan YOKTUR ve eklenmemelidir.</b> LAYERS,
/// STYLES, CQL_FILTER, env, SLD_BODY ve workspace sunucuya aittir; istemci
/// yalnızca görüntü penceresini ve tanımlı dört LOD adından birini söyler.
/// </para>
/// </remarks>
public sealed class LocationAnalysisImageRequest : LocationAnalysisRequest
{
    /// <summary>
    /// Sunucunun tanıdığı yakınlık bandı: <c>far</c>, <c>medium</c>,
    /// <c>near</c> veya <c>very_near</c>. Boşsa geriye dönük uyumluluk için
    /// <c>near</c> kullanılır.
    /// </summary>
    public string? HeatmapLod { get; set; }

    /// <summary>
    /// Yalnızca BU ölçütün yoğunluğunu çiz; boşsa ağırlıklı birleşik yüzey.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Neden gerekli.</b> Ağırlıklı birleşik yüzey tek bir skaler alandır:
    /// bir bölgenin neden sıcak olduğunu — hangi kategoriden ötürü — SÖYLEMEZ.
    /// Yoğunlukları ölçüt başına kendi maksimumuna göre normalleştirmek
    /// yüzdenin gerçekten etkili olmasını sağlar ama kategori KİMLİĞİNİ geri getirmez; toplanan bir
    /// yüzeyde o bilgi yapısal olarak kaybolur.
    /// </para>
    /// <para>
    /// Tek ölçütlü görünüm o soruyu doğrudan yanıtlar: kullanıcı "Alışveriş"
    /// ile "Demiryolu" yoğunluğunu ayrı ayrı görüp karşılaştırabilir.
    /// Ölçütün KENDİSİ değişmez — alan, ölçüt kümesi ve doğrulama aynıdır;
    /// değişen yalnızca hangi kategorilerin çizildiğidir.
    /// </para>
    /// <para>
    /// <b>Serbest metin DEĞİLDİR:</b> değer gönderilen ölçütlerden biri
    /// olmalıdır, aksi hâlde istek reddedilir. Böylece istemci bu alanla
    /// analizin kapsamını genişletemez.
    /// </para>
    /// </remarks>
    public string? CriterionSlug { get; set; }

    /// <summary>
    /// <b>EPSG:4326</b> görüntü penceresi: <c>minX,minY,maxX,maxY</c> —
    /// yani <c>minBoylam,minEnlem,maxBoylam,maxEnlem</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Analiz alanıyla AYNI koordinat sisteminde: istemci tek bir istek içinde
    /// iki farklı CRS taşımaz.
    /// </para>
    /// <para>
    /// <b>Düzen X,Y'dir</b> — OpenLayers, NetTopologySuite ve projenin geri
    /// kalanıyla aynı. WMS 1.3.0'ın EPSG:4326'yı enlem/boylam okuması bir
    /// TAŞIMA ayrıntısıdır ve sunucu tarafında çevrilir
    /// (<c>WmsBboxFormatter</c>); istemci bunu bilmez ve bilmemelidir.
    /// </para>
    /// <para>
    /// Boyut, piksel bütçesi ve piksel oranı denetimi mevcut çizim/heatmap
    /// uçlarıyla AYNI sözleşmeden (<c>WmsRenderContract</c>) geçer; farklı olan
    /// tek şey koordinat sınırlarının EPSG:4326'ya göre uygulanmasıdır
    /// (boylam ±180, enlem ±90).
    /// </para>
    /// </remarks>
    public string Bbox { get; set; } = string.Empty;

    public int Width { get; set; }

    public int Height { get; set; }

    /// <summary>
    /// Görüntünün CSS pikseline göre yoğunluğu; varsayılan 1.
    /// </summary>
    /// <remarks>
    /// Genişlik ve yüksekliği ÇARPMAZ (bkz. <c>WmsRenderContract</c>); yalnızca
    /// ısı çekirdeğinin yarıçapının kaç fiziksel piksele karşılık geldiğini
    /// belirler.
    /// </remarks>
    public double PixelRatio { get; set; } = 1.0;
}

/// <summary>Backend tarafından üretilmiş, doğrulanmış ağırlıklı ısı PNG'si.</summary>
/// <remarks>
/// <see cref="HeatmapImage"/> YENİDEN KULLANILMAZ: o tip kullanıcının kendi
/// çizim noktalarının yoğunluğunu temsil eder ve iki özelliği aynı olsa da
/// aynı şeyi ifade etmezler. Ortak bir "resim" tipi, ileride birine eklenecek
/// bir alanın diğerinde anlamsız durmasına yol açardı.
/// </remarks>
public sealed class LocationAnalysisImage
{
    public required byte[] Content { get; init; }
}

/// <summary>
/// Haritada tıklanan noktaya en yakın analiz POI'sini soran istek.
/// </summary>
/// <remarks>
/// <para>
/// <b>Aktif analizi TAŞIR ve bu zorunludur.</b> İstek, <c>areaWkts</c> ve
/// <c>criteria</c> alanlarını <see cref="LocationAnalysisRequest"/>'ten
/// devralır: isabet testi tüm <c>analysis_poi</c> tablosunda değil, YALNIZCA
/// ekranda gösterilen analiz kümesinde arar. Aksi hâlde kullanıcı, analizine
/// girmeyen — hatta seçmediği bir kategoriye ait — bir noktayı analizin
/// sonucu sanabilirdi.
/// </para>
/// <para>
/// <b>Koordinat KANONİKTİR: X = boylam, Y = enlem.</b> Harita EPSG:3857'dir ve
/// dönüşümü tarayıcı yapar; bu uca gelen sayı her zaman derecedir.
/// </para>
/// </remarks>
public sealed class LocationAnalysisHitTestRequest : LocationAnalysisRequest
{
    public double Longitude { get; set; }

    public double Latitude { get; set; }

    /// <summary>
    /// Arama yarıçapı, <b>metre</b>.
    /// </summary>
    /// <remarks>
    /// Tarayıcı bunu haritanın çözünürlüğünden türetir (birkaç ekran pikseli
    /// karşılığı), böylece kullanıcı noktanın tam merkez pikseline basmak
    /// zorunda kalmaz. Sunucu değeri <see cref="Analysis.LocationAnalysisHitTest"/>
    /// sınırlarına ÇEKER — istemciden gelen bir sayı sorgunun kapsamını
    /// belirleyemez.
    /// </remarks>
    public double? ToleranceMeters { get; set; }
}

/// <summary>
/// Tıklamayla çözülen analiz POI'si. <b>Yalnızca modelde gerçekten var olan
/// alanlar</b> döner.
/// </summary>
/// <remarks>
/// <b>Adres, telefon, web sitesi ve çalışma saati YOKTUR</b> — çünkü
/// <c>analysis_poi</c> bu alanları taşımaz. Var olmayan bir alanı boş
/// göstermek, verinin eksik olduğu izlenimini verirdi; hiç göstermemek
/// dürüsttür.
/// </remarks>
public sealed class LocationAnalysisPointResponse
{
    /// <summary>
    /// Birleşik veri kümesindeki <b>TEKİL</b> kimlik: <c>"osm:12"</c> /
    /// <c>"app:12"</c>.
    /// </summary>
    /// <remarks>
    /// <b><see cref="Id"/> tek başına tekil DEĞİLDİR.</b> Analiz artık iki
    /// tablonun birleşimini okur ve <c>poi.id</c> ile <c>analysis_poi.id</c>
    /// ayrı identity dizileridir: ikisinde de 42 numaralı satır vardır. Ham
    /// tam sayıyı liste anahtarı ya da eşleşme kimliği olarak kullanmak, iki
    /// farklı kaydı aynı kayıt sanmak olurdu.
    /// </remarks>
    public string FeatureId { get; set; } = string.Empty;

    /// <summary>Kaydın KENDİ tablosundaki kimliği. Birleşimde tekil değildir.</summary>
    public int Id { get; set; }

    /// <summary>
    /// Kaydın kanonik kategori kimliği.
    /// </summary>
    /// <remarks>
    /// <b>Simge ve renk BURADA taşınmaz ve bu bilinçlidir.</b> Projenin harita
    /// sözleşmesi zaten böyle çalışıyor: <c>GET /api/poi</c> yalnızca ad/yol ve
    /// kategori KİMLİĞİ döndürür, sunum metadatası (<c>iconKey</c>,
    /// <c>colorHex</c>) ise kategori ucundan gelir ve istemcide tek bir
    /// eşlemede tutulur. Aynı metadatayı bir de kaydın kopyasına yazmak, bir
    /// yönetici kategorinin simgesini değiştirdiğinde analiz POI'lerinin eski
    /// simgeyle kalması demek olurdu.
    /// </remarks>
    public int CategoryId { get; set; }

    /// <summary>Kaynaktaki ad; <b>null olabilir</b>.</summary>
    /// <remarks>
    /// Açık veri kümelerinde adsız ama geçerli kayıtlar sıradandır. Sunucu bir
    /// ad UYDURMAZ; boşluğu nasıl anlatacağına arayüz karar verir.
    /// </remarks>
    public string? Name { get; set; }

    public string CategorySlug { get; set; } = string.Empty;

    public string CategoryName { get; set; } = string.Empty;

    /// <summary>Kökten itibaren tam yol (<c>Sağlık Kurumları / Eczane</c>).</summary>
    /// <remarks>
    /// Panelin ölçüt seçicisi ve özet satırları da tam yol gösterir; aynı
    /// kategoriyi iki farklı biçimde adlandırmak, kullanıcıya başka bir şeye
    /// baktığını düşündürürdü.
    /// </remarks>
    public string CategoryPath { get; set; } = string.Empty;

    public double Longitude { get; set; }

    public double Latitude { get; set; }

    /// <summary>Verinin geldiği kaynağın <b>gösterilebilir</b> adı.</summary>
    /// <remarks>
    /// Ham kolon değeri (<c>"osm"</c>) bir uygulama ayrıntısıdır; kullanıcıya
    /// "OpenStreetMap" denir. Bilinmeyen bir kaynak olduğu gibi geçer —
    /// uydurulmuş bir etiket, verinin nereden geldiği sorusunu yanlış
    /// yanıtlardı.
    /// </remarks>
    public string Source { get; set; } = string.Empty;
}

/// <summary>
/// İsabet testinin sonucu. <b>Boş sonuç bir HATA DEĞİLDİR.</b>
/// </summary>
/// <remarks>
/// Boşluğa tıklamak geçerli bir kullanıcı davranışıdır ve 404 ya da 400 ile
/// karşılanmamalıdır; arayüz yalnızca hiçbir şey açmaz.
/// </remarks>
public sealed class LocationAnalysisHitTestResponse
{
    public LocationAnalysisPointResponse? Poi { get; set; }
}


/// <summary>
/// Aktif analize giren POI'lerin <b>vektör</b> gösterimi için liste.
/// </summary>
/// <remarks>
/// <para>
/// <b>Tüm tablo DÖNMEZ.</b> Süzgeç özet, ısı haritası ve isabet testiyle aynı
/// koddan gelir: yalnızca seçilen alanın içinde ve seçilen ölçütlerin kapsadığı
/// kategorilerdeki kayıtlar. Ankara + iki kök ölçüt için bu 1533 satırdır.
/// </para>
/// <para>
/// <b>Kesme SESSİZ DEĞİLDİR.</b> Sunucu bir üst sınır uygular ama bunu
/// <see cref="Truncated"/> ile SÖYLER; kullanıcının kendi analizinin bir
/// kısmını sessizce gizlemek, haritada eksik bir sonucu tam sanmasına yol
/// açardı.
/// </para>
/// </remarks>
public sealed class LocationAnalysisPointsResponse
{
    public List<LocationAnalysisPointResponse> Pois { get; set; } = [];

    /// <summary>Süzgece uyan TOPLAM kayıt sayısı (kesmeden önce).</summary>
    public int TotalCount { get; set; }

    /// <summary>Sunucunun uyguladığı üst sınır.</summary>
    public int Limit { get; set; }

    /// <summary>Liste sınıra takıldı mı; arayüz bunu kullanıcıya söyler.</summary>
    public bool Truncated { get; set; }
}
