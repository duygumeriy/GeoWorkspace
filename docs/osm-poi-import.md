# OpenStreetMap POI içe aktarımı (konum analizi)

Bu belge, konum analizinin kullanacağı **açık veri POI kümesinin** nereden
geleceğini, hangi lisansla kullanıldığını, hangi dönüşümlerden geçtiğini ve
içe aktarımın nasıl tekrar üretileceğini kaydeder.

> **Bu depoda içe aktarılmış gerçek OSM verisi YOKTUR.**
> Hiçbir veri kümesi indirilmemiş, hiçbir gerçek nesne veritabanına
> yazılmamıştır. Aşağıdakiler, ilk gerçek içe aktarımdan **önce** izlenecek
> adımlardır.

---

## 1. Kaynak

| | |
|---|---|
| **Kaynak** | OpenStreetMap katkıcıları |
| **Lisans** | **ODbL 1.0** (Open Database License) |
| **Beklenen indirme kaynağı** | Geofabrik Türkiye çıkarımı ya da eşdeğer bir yerel OSM çıkarımı |
| **Çalışma zamanı ağ bağımlılığı** | **YOK** |
| **Gerekli atıf** | **© OpenStreetMap contributors** |

### Lisans notu — Natural Earth ile KARIŞTIRILMAMALIDIR

Depodaki il/bölge sınırları **Natural Earth** kaynaklıdır ve **kamu malıdır**:
atıf zorunlu değildir, türev çalışma için bir yükümlülük doğurmaz
(bkz. [`geographic-data-sources.md`](geographic-data-sources.md)).

OpenStreetMap **aynı şey değildir**. ODbL:

* **atıf ister** — "© OpenStreetMap contributors" görünür olmalıdır,
* **share-alike** taşır — türetilmiş bir *veritabanı* dağıtılırsa aynı lisansla
  dağıtılmalıdır,
* veriden üretilen **görseller** (ısı haritası gibi) "produced work" sayılır ve
  atıf yükümlülüğü sürer.

İki kaynak bu yüzden ayrı belgelerde tutulur ve tek bir "veri kaynakları"
başlığı altında birleştirilmez: biri için doğru olan cümle diğeri için yanlıştır.

### Atıf nerede görünecek

Uygulamanın harita altlığı zaten OpenStreetMap döşemeleri kullanıyor ve
OpenLayers'ın attribution kontrolü "© OpenStreetMap contributors" ibaresini
gösteriyor. İçe aktarılmış POI verisi haritada gösterildiğinde bu ibare
**yetersizdir**: altlık ile veri ayrı kullanımlardır. Konum analizi arayüzü
(sonraki faz) sonucun yanında kaynağı açıkça belirtmelidir.

---

## 2. Depoya veri GÖMÜLMEZ

İl sınırlarının aksine OSM çıkarımı depoya **paketlenmez**:

* Türkiye çıkarımı yüz megabaytlar ölçeğindedir ve bir Git deposuna ait değildir,
* veri sık güncellenir; depoya gömülen bir kopya ilk günden eskimeye başlar,
* ODbL share-alike, veritabanının yeniden dağıtımına yükümlülük bağlar.

Bunun yerine **içe aktarma tarifi** depoda durur (bu belge + araç), veri kümesi
ise çalıştıran kişi tarafından elle indirilir.

---

## 3. Araç

```text
backend/tools/StajProject.OsmPoiImporter
```

Bir **geliştirici aracıdır**: API'nin DI kabına kaydedilmez, uygulama açılışında
çalışmaz ve **hiçbir ağ erişimi yapmaz**. Geofabrik'ten indirme, Overpass
sorgusu ya da openstreetmap.org çağrısı içermez; girdi her zaman elle verilen
yerel bir dosya yoludur ve hiçbir yol koda gömülü değildir.

Yazdığı tek tablo `analysis_poi`'dir. Normal POI envanteri (`poi`), kategori
taksonomisi (`poi_category`) ve GeoServer'a **dokunmaz**.

### Girdi biçimi

Bugün desteklenen biçim **OSM XML** (`.osm`) — OSM'in kendi değişim biçimidir.
PBF nihai hedeftir ama **henüz desteklenmiyor**; gerekçesi ve eksik parçanın
tanımı için bkz. bölüm 7.

PBF'ten dönüştürme (çalıştıran kişi tarafından, tek komut):

```bash
osmium cat turkey-latest.osm.pbf -o turkey-latest.osm
# ya da yalnızca bir bölgeyi kesip almak (ÖNERİLEN ilk adım):
osmium extract -b 32.6,39.8,33.1,40.1 turkey-latest.osm.pbf -o ankara-merkez.osm
```

### Kullanım

```bash
# eşleme tablosunu gözden geçir — veritabanı gerekmez
dotnet run --project backend/tools/StajProject.OsmPoiImporter -- rules

# kuru çalıştırma: hiçbir satır yazılmaz, istatistik üretilir
dotnet run --project backend/tools/StajProject.OsmPoiImporter -- import \
  --input /yerel/yol/ankara-merkez.osm \
  --connection "Host=localhost;Database=staj_db;Username=…;Password=…" \
  --dry-run

# gerçek içe aktarım
dotnet run --project backend/tools/StajProject.OsmPoiImporter -- import \
  --input /yerel/yol/ankara-merkez.osm \
  --connection "…"
```

Bağlantı dizesi `STAJPROJECT_ANALYSIS_CONNECTION` ortam değişkeninden de
okunabilir ve **hiçbir zaman loglanmaz**.

---

## 4. Uygulanan dönüşüm

```text
OSM nesnesi (node / closed way / multipolygon relation)
  → etiket eşlemesi        → kanonik kategori slug'ı (EN ÖZEL olan)
  → temsilî nokta          → Point, EPSG:4326
  → (source, external_id)  → idempotent upsert
  → analysis_poi
```

### Kategori: en özel olan kazanır

Bir nesne **tam olarak bir** kanonik kategoriye yazılır ve o kategori
mümkün olan **en özel** olandır: `amenity=cafe` → `kafe`, üst kategorisi
`yeme-icme` **değil**. Üst kategori toplaması içe aktarımda satır çoğaltarak
değil, **analiz sırasında** alt ağaç genişletmesiyle yapılır. Aksi hâlde aynı
kafe hem `kafe` hem `yeme-icme` altında sayılır ve yoğunluk haritası aynı
noktayı iki kez gösterirdi.

Eşleme tablosunun tamamı `rules` komutuyla yazdırılabilir. **Bilinçli olarak
eşlenmeyen** kategoriler (`karayolu`, `zincir-marketler`, `epdk`,
`onemli-noktalar`, …) ve gerekçeleri de aynı çıktıdadır: emin olunmayan veri
kategoriye **zorlanmaz** ve `onemli-noktalar` bir çöp kutusu olarak
kullanılmaz.

### Geometri: temsilî nokta

* **node** → koordinatı doğrudan (`lon` = X, `lat` = Y).
* **kapalı yol (alan)** → poligon → **iç nokta** (PointOnSurface).
* **`type=multipolygon` ilişkisi** → dış üyeleri kapalı yollar olduğunda alan →
  iç nokta.

Ağırlık merkezi (centroid) **kullanılmaz**: içbükey, halka biçimli ya da kopuk
parçalardan oluşan bir alanın merkezi alanın **dışına** düşebilir ve POI,
temsil ettiği tesisin dışında görünürdü.

### Kapsam dışı bırakılanlar

* **Ağ geometrileri** — `highway=*`, `railway=rail` ve benzerleri bir tesis
  değil, bir ağdır; POI üretmezler.
* **Açık (kapanmayan) yollar** — bir alan değildir; halka **uydurulmaz**.
* **Halkası birden çok açık yola bölünmüş multipolygon'lar** — doğru dikiş
  algoritması uygulanmadığı için atlanır ve istatistikte görünür (bkz. bölüm 7).
* **Arazi örtüsü** — `landuse=residential`, `landuse=farmland` gibi etiketler
  tesis değildir.
* **Nokta olmayan tesis eşleşmeleri** — ATM ya da şarj direği alan olarak
  çizilmişse atlanır.

---

## 5. Idempotens ve senkron sınırları

Kimlik `(source, external_id)`'dir — `analysis_poi` üzerinde **tekil bir
veritabanı indeksi**. `external_id`, tür ön ekini taşır (`node/123`,
`way/456`, `relation/789`): OSM'de üç kimlik uzayı ayrıdır.

Aynı dosyayı iki kez içe aktarmak satır sayısını **değiştirmez**; değişmiş bir
nesne aynı satır üzerinde güncellenir.

**Yukarıdan silinenler SİLİNMEZ.** "Bu çalıştırmada görülmeyen satırları sil"
davranışı bilinçli olarak yoktur: yerel bir çıkarım tek bir ili ya da ilçeyi
içerebilir ve bir nesnenin dosyada olmaması, OSM'de silindiği **anlamına
gelmez**. Böyle bir temizlik ancak kapsamını açıkça beyan eden ayrı bir komutla
yapılabilir.

### Bilinen kaynak sınırı: aynı yerin iki kez modellenmesi

OSM'de bir tesis bazen hem bir **düğüm** hem de bir **alan** olarak modellenir
(farklı OSM kimlikleriyle). Dış kimlikler farklı olduğu için veritabanı
tekilliği bunu yakalayamaz ve iki satır oluşur.

Bu faz **bulanık/coğrafi tekilleştirme uygulamaz**: yakınlık ve ad benzerliğine
dayanan bir birleştirme, farklı iki gerçek tesisi de birleştirebilirdi. Sınır
burada kayda geçirilir; kesin kimlik tekilleştirmesi zorunludur, bulanık
tekilleştirme isteğe bağlı bir gelecek işidir.

---

## 6. Saklanmayan alanlar

OSM `opening_hours`, `addr:*`, `phone` ve `website` taşıyabilir. Konum analizi
bunların hiçbirine ihtiyaç duymaz — ölçüt **kategori** ve **konumdur** — ve
`analysis_poi` şeması bu fazda **genişletilmez**. İleride gerekirse ayrı bir
göçle eklenebilirler.

`name` yoksa `null` kalır: "İsimsiz Eczane #123" gibi bir ad **uydurulmaz**.

---

## 7. Eksik parça: PBF bağdaştırıcısı

Araç bugün OSM XML okur. Türkiye ölçeğinde asıl biçim **PBF**'tir ve eksik olan
tek şey bir **kaynak bağdaştırıcısıdır**: `OsmXmlSource` ile aynı sözleşmeyi
(`IEnumerable<OsmSourceFeature>`) karşılayan bir `OsmPbfSource`. Eşleme,
geometri, upsert ve istatistik katmanları biçimden bağımsızdır ve
**değişmeyecektir**.

Bu fazda PBF'in yazılmama gerekçesi bilinçlidir: gerçek bir çıkarım indirmek
yasaktı, elle geçerli bir PBF fikstürü üretmek (protobuf + zlib blob
çerçeveleme) ise **testlerle desteklenemeyecek** bir varsayım yığını demekti.
Doğrulanamayan bir ayrıştırıcı, sessizce yanlış koordinat üretebilirdi.

Bağdaştırıcı yazılırken karşılanması gerekenler:

1. **Akış** — dosyanın tamamı belleğe alınmamalı.
2. **Yol/ilişki tamamlama** — düğüm koordinatları iki geçişli (önce gerekli
   kimlikler, sonra koordinatlar) çözülmeli; tüm düğümleri bellekte tutan bir
   yaklaşım Türkiye çıkarımında ölçeklenmez.
3. **Halka dikişi** — açık yollara bölünmüş dış halkalar doğru sırayla ve yönle
   birleştirilmeli; bugün bu durum atlanıyor.
4. **Lisans/bağımlılık** — eklenecek kütüphane MIT/BSD benzeri uyumlu bir
   lisans taşımalı ve tek bir odaklı bağımlılık olmalıdır.

Bugün **hiçbir yeni NuGet bağımlılığı eklenmemiştir**: OSM XML, BCL'deki
`XmlReader` ile okunur.

---

## 8. Doğrulama

Araç her çalıştırmada **slug başına satır sayısı** raporlar. Kategori
eşlemesinin birincil sağlık göstergesi budur: `yeme-icme` binlerce satır
alırken `kafe` boş kalıyorsa "en özel kategori kazanır" kuralı çalışmıyor
demektir ve bu, yalnızca toplam sayıya bakarak **fark edilmezdi**.

### Belirsizlik tanılaması

`--mapping-diagnostics` bayrağı, **çözülmüş** belirsizlikleri çakışma başına
toplar ve yazdırır:

```text
Çözülen belirsizlikler:
  DescendantBeatsAncestor
    eczane <- saglik-kurumlari      312
      örnek: node/…
  HigherSpecificityWins
    kulturel-tesisler <- tarihi-turistik   18
      örnek: way/…

Çözülemeyen belirsizlik (atlandı): 4
```

"Belirsiz (çözülen): 874" tek başına bir sayıdır; hangi kategori çiftlerinin
çarpıştığını söylemez. Kırılım, gereksiz yere geniş bir kuralı (ör. bir joker)
ya da yanlış yerleştirilmiş bir eşlemeyi görünür kılar. Grup başına en fazla üç
örnek kimlik saklanır — karar OSM üzerinde elle doğrulanabilsin diye — ve
özelliklerin kendisi **hiçbir zaman** bellekte tutulmaz.

Çözülemeyen belirsizlikler de çakışma TÜRÜNE göre gruplanır
(`askeri-kurumlar <> havayolu`), böylece hangi kural çiftinin gözden
geçirileceği görünür olur.

Bayrak **kararı değiştirmez**: eşleme semantiği açıkken de kapalıyken de
aynıdır. Bayraksız çıktı kısa kalır.

### Kural önceliği

Kurallar üç öncelik taşır: tam değer (`amenity=pharmacy`, 100), **bağlamsal**
(75) ve joker (`healthcare=*`, 50). Öncelik **kural tanımında** durur; eşleyicide
"amenity her zaman leisure'ı yener" gibi bir etiket-adı kuralı **yoktur**.

Bağlamsal öncelik, nesnenin *kimliğini* değil *çevresini* anlatan tam değerli
etiketler içindir ve yalnızca gerçek veriyle gerekçelendirilmiş **tek tek
kurallara** verilir:

| Kural | Gerekçe (Ankara çıkarımı) |
| --- | --- |
| `leisure=garden` | Beş vakada da bir kurumun arazisiydi (devlet kurumu, cami, sosyal tesis) |
| `landuse=industrial` | Biyogaz tesisinde arazi kullanımıydı; kimlik `power=plant` |
| `tourism=attraction` | Kocatepe Camii'nde nitelikti; kimlik `amenity=place_of_worship` |

`leisure=park`, `leisure=stadium`, `tourism=museum`, `man_made=works` ve
`landuse=military` **değişmemiştir**: bunlar kendi başlarına birer tesistir.

Öncelik yalnızca **ilgisiz** kategori çakışmalarını çözer ve **ata/torun
elemesinden sonra** devreye girer; `amenity=pharmacy` + `healthcare=*` → `eczane`
kararı hiyerarşiden gelmeye devam eder.

### Sayaçların anlamı

```text
Etiketli OSM elemanı  kaynakta görülen, en az bir etiketi olan eleman
Üretilen özellik      kaynak bağdaştırıcısının ürettiği aday özellik
Kategorisi çözülen    kanonik bir kategoriye çözülenler (geometri denetiminden önce)
Eşleşen               yazılabilir hâle gelenler
Atlanan               her aşamada atlananların toplamı
```

**Atlananın üretilen özellikten büyük olması normaldir.** Bir çıkarımdaki
etiketli elemanların çoğu (bina, adres noktası, yol kesimi) hiçbir POI kuralına
uymaz ve bir özelliğe hiç dönüşmez; "üretilen özellik" dosyadaki eleman sayısı
değildir. Değişmez şudur:

```text
etiketli eleman = üretilen özellik + kaynakta atlanan
```

Etiketsiz düğümler (yolların köşe noktaları) hiçbir sayaca girmez.

Atlama sebepleri de tek bir sayı değil, kırılım olarak raporlanır
(`unmapped_tag`, `ambiguous_mapping`, `invalid_coordinate`,
`unsupported_area_feature`, `incomplete_geometry`, `unsupported_geometry`,
`invalid_geometry`).

Deterministik test fikstürü — elle yazılmış, indirilmemiş, gerçek OSM verisi
içermeyen — şuradadır:

```text
backend/tests/StajProject.Auth.Tests/Fixtures/osm-import-fixture.osm
```
