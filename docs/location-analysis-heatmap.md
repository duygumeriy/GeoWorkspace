# Konum analizi — ağırlıklı yoğunluk yüzeyi

`POST /api/analysis/location/image`, seçilen alan ve kategori ağırlıklarına göre
renklenen bir PNG döndürür.

**Görüntüyü artık GeoServer üretmiyor.** Yüzey backend'de, özet ucunun saydığı
kayıtların ta kendisinden hesaplanır. Bu belge nedenini, denklemi, veri
kümesini ve GeoServer kataloğunda **elle** yapılması gereken tek değişikliği
anlatır.

---

## 1. Denklem

Her ölçüt `c` için, seçilen alandaki kendi noktalarından bir yoğunluk yüzeyi
kurulur; **önce ölçüt başına** 0–1'e çekilir, ağırlıklar **sonra** uygulanır:

```
D_c(x) = Σ_{p ∈ c} K(|x − p|)               çekirdek toplamı
M_c    = max_x D_c(x)                        ölçütün kendi tepesi
N_c(x) = D_c(x) / M_c                        ÖLÇÜT BAŞINA normalleştirme
S(x)   = Σ_c (ağırlık_c / 100) · N_c(x)     ağırlıklı bileşim
```

Ağırlıkların toplamı 100 ve her `N_c ≤ 1` olduğu için `S(x) ∈ [0,1]`'dir; renk
rampası ikinci bir normalleştirme yapmaz.

Her ölçüt tam olarak kendi mutlak tepesine bölünür. Noktası olmayan ölçütün
katkısı sıfırdır; ağırlığı başka ölçütlere dağıtılmaz. P99, POI sayısı veya
toplam çekirdek kütlesi bu normalleştirmede kullanılmaz.

Çekirdek **quartic (biweight)**'tir: `K(d) = (1 − d²)²`, `d ≤ 1`. Taşıyıcısı
sonludur — bir noktanın etkisi bant genişliğinin ötesinde **tam olarak**
sıfırdır. Gauss çekirdeğinin kuyruğu hiç sıfırlanmadığı için tek bir yoğun
küme bütün pencereye ölçülebilir bir taban değer yayar ve normalleştirmeden
sonra "her yer biraz sıcak" görüntüsü verirdi.

Tek ölçütlü görünümde ağırlık 1'dir ve yüzey `N_c`'nin kendisidir: sonuç o
kategorinin saf yoğunluğudur.

### Dört raster LOD bandı

Her bant aynı gönderilmiş analiz geometrisini, POI kümesini, ölçütleri,
ağırlıkları ve analiz zarfını kullanır. Yalnızca çözünürlük ve coğrafi
çekirdek yarıçapı değişir:

| Bant | OpenLayers zoom | Uzun raster kenarı | Çekirdek yarıçapı |
| --- | ---: | ---: | ---: |
| FAR | `< 9` | 768 px | 8000 m |
| MEDIUM | `9–<12` | 1024 px | 4000 m |
| NEAR | `12–<15` | 1536 px | 2000 m |
| VERY_NEAR | `>=15` | 2048 px | 800 m |

Kaydırma ve aynı bant içindeki zoom yeni istek açmaz. Bir sınır geçildiğinde
yeni raster yine aynı EPSG:4326 analiz zarfına yerleştirilir; hotspot coğrafyası
bu nedenle hareket etmez.

---

## 2. Önceki iki model ve neden ikisi de yanlıştı

| Model | Yuvadaki değer | Yüzeyde ne oluyordu |
| --- | --- | --- |
| İlk | `ağırlık / 100` | Ölçütün etkisi `sayı × ağırlık`. Kategori sayıları büyüklük mertebesinde ayrıştığında (Ankara: Alışveriş 345, Demiryolu 52) kullanıcının verdiği yüzde etkisiz kalıyordu: 80/20 ile 20/80 arasında gerçek etki oranı 26,5:1'den yalnızca 1,66:1'e iniyor, KALABALIK kategori her iki hâlde de baskın çıkıyordu. Ölçüldü: iki görüntü arasında boyalı piksellerin yalnızca %17'si değişiyordu. |
| İkinci (bu fazdan önceki) | `ağırlık / 100 / N_c` | Bu, `D_c`'yi **toplam kütlesine** göre normalleştirmektir (`Σ = 1`), yerel yoğunluk **aralığına** göre değil. |

İkinci modelin hatası ölçülebilir ve yönü bellidir. Aynı noktada toplanmış
`N` kayıt için kütleye bölünmüş tepe değeri `K(0)`; birbirinden uzak `N`
yalıtık kayıt için `K(0)/N`'dir. Yani kütle normalizasyonu **kümelenmiş**
kategorileri sistematik olarak yükseltir, **dağılmış** olanları — bir il
boyunca dizilmiş demiryolu durakları gibi — `N` katına varan bir oranda
bastırır. Bu, kullanıcının verdiği yüzdeden bağımsız bir çarpıklıktır.

`LocationAnalysisHeatmapRendererTests` üç durumu birden sabitler: eşit
ağırlıklı kümelenmiş ve dağılmış iki ölçütün tepe değerleri **eşit** çıkar,
80/20 ile 20/80 arasındaki tepe oranı **tam olarak 4**'tür ve her ölçütün
tepesi kendi ağırlığına oturur.

---

## 3. Neden GeoServer değil

`vec:Heatmap` bütün kayıtlar üzerinde **tek geçiş** yapar, her kayda bir
ağırlık uygular ve yalnızca **sonuç** yüzeyini kendi en yükseğine göre
normalleştirir. Ölçüt başına ayrı bir en yüksek değer o sürecin içinde ne
hesaplanabilir ne de ifade edilebilir; §1'deki denklem tek bir WMS isteğiyle
**kurulamaz**.

Değerlendirilen ve reddedilen alternatifler:

| Seçenek | Neden değil |
| --- | --- |
| Ölçüt başına ayrı WMS isteği + backend'de birleştirme | Backend'e bir **PNG çözücü** (yani yeni bir görüntü kütüphanesi bağımlılığı), istek başına 2–5 ağ gidiş dönüşü ve ağırlıklandırmadan ÖNCE ölçüt başına 8 bitlik nicemleme eklerdi. |
| Aynısını tarayıcıda canvas ile birleştirmek | Ağırlıklandırma denklemi istemciye taşınırdı; sunucu artık ne çizdiğini bilmezdi. |
| Tek geçişte "yaklaşık" bir ağırlıklandırma bırakmak | Doğru görünen ama savunulamayan bir görüntü. |

Seçilen yol **sunucu tarafı raster matematiğidir**: nokta verisi zaten aynı
veritabanındadır, yüzey çift duyarlıkla üretilir ve denklem doğrudan
sınanabilir. PNG kodlaması `System.IO.Compression.ZLibStream` üzerine kurulu
yüz satırlık bir yazıcıdır (`PngWriter`) — yeni bir NuGet bağımlılığı yoktur ve
bir PNG **çözücüye** hiç ihtiyaç duyulmaz.

GeoServer projeden çıkmadı: çizim sunumu, POI katmanları, çizim ısı haritası ve
analiz POI **nokta örtüsü** hâlâ oradan gelir. Çıkan tek şey, bir SLD ile
doğru ifade edilemeyen bir hesaptır.

### Emekli edilen yapıtlar

- `geoserver/styles/analysis_weighted_heatmap.sld`
- `LocationAnalysisWeightSlots` (48 `env` yuvası, `Recode` ifadesi)
- `GeoServer:AnalysisHeatmapStyle` ayarı
- `GeoServer:AnalysisHeatmapRadiusPixels` ayarı (yerine `AnalysisHeatmapRadiusMeters`)

`LocationAnalysisStyleArtifactTests`, SLD dosyasının **geri gelmemesini**
sabitler: yeniden eklenen bir stil, artık kimsenin göndermediği ağırlıklarla
sessizce yanlış bir harita çizerdi.

---

## 4. Yarıçap — yer ölçüsü, ekran ölçüsü değil

Önceki ayar CSS pikseliydi (`radiusPixels: 30`). Raster analiz alanının
tamamını sabit sayıda piksele çizdiği için aynı 30 piksel:

- Ankara ölçeğinde (~205 km / 1536 px ≈ 133 m/px) **~4 km**,
- elle çizilmiş 5 km'lik bir poligonda birkaç yüz metre

anlamına geliyordu. Yani çekirdek, seçilen alan büyüdükçe sessizce genişliyor
ve bir ilin tamamını tek bir lekeye çeviriyordu. Kullanıcının bildirdiği
"boyanmış alan" görüntüsünün **başlıca** nedeni budur.

Bant genişliği artık metredir (`AnalysisHeatmapRadiusMeters`, varsayılan
**2000 m**) ve rasterin çözünürlüğü üzerinden piksele çevrilir:

```
metre/piksel_x = (maxX − minX) · 111320 · cos(φ) / genişlik
metre/piksel_y = (maxY − minY) · 110574 / yükseklik
yarıçap_px     = clamp(bant / metre/piksel, 3, min(64, uzun kenar × 0.04))
```

Üç şeye birden bağlıdır ve üçü de savunulabilir:

- **raster çözünürlüğü** — metre/piksel doğrudan bu hesaptan gelir;
- **piksel boyutları** — tavan, görüntünün uzun kenarının %4'ü;
- **seçilen alan büyüklüğü** — pencerenin coğrafi genişliği metre/piksel'i
  belirler.

Ankara için (185 m/piksel) sonuç ~11 pikseldir; eskisinin yaklaşık üçte biri.
Çok dar bir alanda tavan devreye girer, böylece yakınlaştıkça yeniden
"boyanmış alan" oluşmaz.

Değer gerçek veriyle bakılarak seçildi: 1500 m alt kümeleri ayrı ayrı
gösteriyor ama beneksi duruyordu, 4000 m yapıyı tek bir lekeye eritiyordu;
2000 m yakın kümeleri doğal biçimde birleştirirken ilçe ölçeğindeki ayrımı
koruyor.

**İki eksen ayrıdır.** Türkiye enlemlerinde bir derece boylam bir derece
enlemin ~%77'si kadardır; tek bir piksel yarıçapı, yerde daire olması gereken
çekirdeği doğu-batı doğrultusunda ezerdi.

### Rampanın alt ucu

Renk durakları mevcut `point_density_heatmap` ile **aynıdır**
(`#2C7BB6 → #00A6CA → #F9D057 → #D7191C`). Değişen tek şey alfanın alt ucudur:
eski SLD rampası 0.00'da saydam, 0.25'te tam opaktı ve arada **doğrusal**
geçiyordu — yani çekirdeğin uzak kuyruğuna denk gelen 0.05 gibi bir değer bile
ekranda gözle görülür bir mavi bırakıyordu. Bu, boyanmış görüntünün ikinci
nedeniydi. Alfa artık 0 → 0.06 aralığında yükselir; altındaki her şey gerçekten
saydamdır.

---

## 5. Veri kümesi — açık veri **ve** uygulama POI'leri

Konum analizinin **tek** mantıksal veri kümesi vardır:

```
analysis_poi                     (OSM'den içe aktarılan açık veri)
UNION ALL
poi WHERE is_deleted = false AND is_active = true   (uygulama envanteri)
```

Bu birleşim **bütün** yollara hizmet eder: özet sayımı, ölçüt kırılımı,
ağırlıklı raster, tek ölçütlü raster, nokta listesi ve isabet testi. Sayılar
ile haritadaki noktalar bu yüzden asla farklı bir kümeye bakamaz.

Kullanıcının uygulamada oluşturduğu bir POI, **aktifse**, **silinmemişse**,
kategorisi ölçütün alt ağacındaysa ve koordinatı seçilen alandaysa bir sonraki
analizde anında sayılır, listelenir ve ısı üretir. Pasifleştirildiğinde ya da
çöp kutusuna atıldığında üçünden birden düşer.
(`LocationAnalysisUnionSourceTests`)

### Kapsam: kimin POI'leri?

**Tüm aktif uygulama POI'leri**, yalnızca oturum açan kullanıcınınkiler değil.

Gerekçe projede zaten yazılıdır: POI ortak bir envanterdir. `GET /api/poi`,
POI araması ve `poi_read` WMS katmanı onu `poi.view` taşıyan **herkese**
gösterir; hiçbir okuma yolu POI'yi sahibine göre süzmez. Sahiplik bir **yazma**
sınırıdır (düzenleme/silme `PoiAuthority` ile denetlenir). Analizi kullanıcının
kendi kayıtlarıyla sınırlamak, projenin hiçbir yerinde bulunmayan bir kuralı
tek bir uçta icat etmek olurdu — ve "daha çok veri analizi iyileştirir"
ilkesine de aykırı olurdu.

`analysis_poi` zaten sahipsizdir.

### Kimlik

`poi.id` ile `analysis_poi.id` **ayrı identity dizileridir ve çakışırlar**:
ikisinde de 42 numaralı satır vardır. Birleşimdeki tekil kimlik bu yüzden
`feature_id`'dir (`"osm:42"` / `"app:42"`); API yanıtı hem `featureId` hem ham
`id` taşır ve GeoServer SQL View'ının identifier'ı da `feature_id`'dir.

### Tekilleştirme politikası: **UNION ALL**, bulanık eşleştirme YOK

İki kaynak arasında paylaşılan güvenilir bir dış kimlik yoktur:
`analysis_poi` `source` + `external_id` taşır, `poi` hiç taşımaz. Bugünkü
veride bir kesişim **aranmadı ve varsayılmadı**; ölçülebilir tek şey şudur:
ortak bir anahtar olmadığı için "aynı yer" ancak ada ve konuma bakan bir
tahminle bulunabilirdi.

Böyle bir eşleştirme, aynı binadaki iki ayrı işletmeyi ya da aynı adı taşıyan
iki şubeyi sessizce tek kayda indirebilir — yani var olan veriyi **silerdi**.
Seçilen politika bu yüzden `UNION ALL`'dır.

**Kabul edilen bedel:** aynı gerçek yer her iki kaynakta da varsa **iki kez**
sayılır. Bu, yoğunluk yüzeyinde o noktayı bir miktar yükseltir. Bedel
görünürdür ve açıklanabilir; sessiz silme değildir.
(`LocationAnalysisUnionSourceTests.The_same_real_world_place_in_both_sources_is_counted_twice_on_purpose`)

### İki tanım, tek anlam

EF birleşimi bir C# sorgu ifadesidir ve WMS'e gönderilemez; GeoServer aynı
kümeyi `analysis_poi_union` **VIEW**'ından okur. İkisinin ayrışmadığını bir
drift testi sabitler (kimlik öneki, kaynak etiketleri ve uygulama POI'si
süzgeci karşılaştırılır).

PostgreSQL `UNION ALL` view'larını düzleştirir ve yüklemleri kollara iter;
gerçek veritabanında `EXPLAIN` her iki kolun da kendi indeksini kullandığını
gösterir (`IX_analysis_poi_category_id`, `IX_poi_coordinate`).

---

## 6. Coğrafi yetki

Kullanıcının coğrafi yetki alanı varsa, konum analizi **yalnızca** o geometrinin
içinde çalışabilir. Kural **backend'de** ve **her uçta** uygulanır:

| Uç | Koruyucu |
| --- | --- |
| `POST /api/analysis/location` (özet) | `ILocationAnalysisAreaGuard` |
| `POST /api/analysis/location/image` (ağırlıklı yüzey) | aynı |
| `POST /api/analysis/location/points` (vektör liste) | aynı |
| `POST /api/analysis/location/points/hit-test` | aynı |
| `POST /api/analysis/location/points/image` (örtü rasteri) | aynı |

Raster da bir cevaptır: sayıya erişemeyen birinin aynı bilgiyi görüntü olarak
alabilmesi, kuralı yalnızca bir uçta uygulamak olurdu. Kural il, bölge ve elle
çizilmiş poligon için aynıdır ve **iki kaynağa da** (OSM + uygulama POI'leri)
birlikte uygulanır — çünkü sınır, veri kaynağına değil **alana** konur.

Arayüzün il listesini süzmesi bir kolaylıktır; doğrudan API çağrısı 403 alır.
Kısıtsız kullanıcılar için hiçbir şey değişmez.

---

## 7. Veritabanı — `analysis_poi_union` VIEW'ı

Migration: `20260826140320_AddAnalysisPoiUnionView`. **Kod tarafından
uygulanır**, elle bir adım gerekmez:

```bash
dotnet ef database update --project backend/src/StajProject.Infrastructure \
                          --startup-project backend/src/StajProject.Api
```

```sql
CREATE OR REPLACE VIEW analysis_poi_union AS
SELECT
    'osm:' || a.id::text AS feature_id,
    'analysis'::text     AS source_kind,
    a.id                 AS source_id,
    a.name::text         AS name,
    a.category_id        AS category_id,
    a.coordinate         AS coordinate,
    a.source::text       AS source
FROM analysis_poi AS a
UNION ALL
SELECT
    'app:' || p.id::text AS feature_id,
    'app'::text          AS source_kind,
    p.id                 AS source_id,
    p.isim::text         AS name,
    p.kategori_id        AS category_id,
    p.coordinate         AS coordinate,
    'app'::text          AS source
FROM poi AS p
WHERE p.is_deleted = false
  AND p.is_active = true;
```

Materialized **değildir**: bayatlamaz, yenilenmesi gerekmez ve yeni eklenen bir
POI bir sonraki analizde anında görünür.

---

## 8. GeoServer — tek ELLE adım

Nokta örtüsü rasteri (`analysis_poi_points`) hâlâ GeoServer'dan gelir ve
`analysis_poi_read` SQL View'ını okur. O view'ın tanımı **değişmelidir**;
aksi hâlde örtü yalnızca OSM kayıtlarını çizerken özet ve ısı haritası
uygulama POI'lerini de sayardı.

Admin → Stores → `staj_postgis` → `analysis_poi_read` → **Edit SQL view**:

| Alan | Değer |
| --- | --- |
| View adı | `analysis_poi_read` (değişmez) |
| Geometri kolonu | `coordinate` — `Point`, SRID **4326** (değişmez) |
| Identifier | **`feature_id`** ← *değişti* (eskiden `id`) |
| Parametre | **YOK** (değişmez) |

```sql
SELECT
    u.feature_id,
    u.source_kind,
    u.source_id,
    u.coordinate,
    u.category_id,
    c.slug AS kategori_slug
FROM analysis_poi_union AS u
JOIN poi_category AS c
    ON c.id = u.category_id
WHERE
    c.is_deleted = false
    AND c.is_active = true
```

Notlar:

- **Identifier `feature_id`'dir, `id` değil.** Ham tam sayı kimlik birleşimde
  tekil değildir: `poi.id` ve `analysis_poi.id` çakışır. `id` bırakılırsa
  GeoServer iki farklı kaydı aynı feature sanabilir.
- **Parametre yoktur ve eklenmemelidir.** `poi_read` ile aynı sözleşme: SQL
  View'da parametre olmaması enjeksiyon yüzeyini sıfırlar. Alan ve kategori
  süzmesi `CQL_FILTER` ile yapılır ve o süzgeci backend kurar.
- Sahiplik yüklemi yoktur (bkz. §5). Coğrafi yetki koşulu da yoktur: o sınır
  backend'de, alan geometrisi üzerinden uygulanır.
- `poi_read` **değiştirilmez**; bu ayrı bir view'dır.

Ekleme/silme yoktur: yalnızca var olan SQL View'ın metni ve identifier'ı
güncellenir. `analysis_weighted_heatmap` stili kataloğa hiç kaydedilmemiş olsa
da, kaydedildiyse artık kullanılmaz ve silinebilir.

---

## 9. Arayüz metni için

Yüzey `S(x)`, verilen ağırlıklara göre **birleşik yoğunluktur**; bir uygunluk
skoru değildir. Efsane metni bunu gizlememelidir:

- Ölçek **görelidir**: her ölçüt kendi en yoğun bandına göre 0–1'e çekilir.
- İki farklı analizin kırmızısı doğrudan **karşılaştırılamaz**.
- Kırmızı "en iyi yer" **demek değildir**.
- Kategori kimliğini **işaretler** anlatır (ikon + kategori rengi), yoğunluğu
  **rampa**. Rampanın rengi hiçbir zaman bir kategoriyi temsil etmez.
