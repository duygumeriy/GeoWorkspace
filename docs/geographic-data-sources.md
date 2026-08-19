# Coğrafi Veri Kaynakları

Bu belge, uygulamada kullanılan **coğrafi sınır verilerinin** nereden geldiğini,
hangi lisansla kullanıldığını ve üzerinde hangi işlemlerin yapıldığını kaydeder.

Kaydın amacı tekrar üretilebilirliktir: veri kümesi bir gün güncellenecekse,
aşağıdaki bilgiler o güncellemenin aynı adımlarla yapılabilmesini sağlar.

---

## 1. Türkiye il sınırları

| | |
|---|---|
| **Veri kümesi** | Natural Earth — Admin 1: States & Provinces (10m) |
| **Dosya** | `geojson/ne_10m_admin_1_states_provinces.geojson` |
| **Depo** | https://github.com/nvkelso/natural-earth-vector |
| **Doğrudan bağlantı** | https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson |
| **Dosyanın son işlendiği commit** | `117488dc884bad03366ff727eca013e434615127` (2022-05-05) |
| **Depo sürümü** | v5.1.2 serisi |
| **İndirilme tarihi** | 2026-08-19 |
| **Lisans** | **Kamu malı (public domain)** |

### Lisans notu

Natural Earth verileri kamu malıdır. Yazarların kendi ifadesiyle: veriler
kişisel, eğitim ve **ticari** amaçlarla serbestçe kullanılabilir; değiştirilebilir
ve yeniden dağıtılabilir. Kullanım için izin gerekmez, atıf zorunlu değildir.
Bu belge yine de atfı kayda geçirir — kaynağı bilmek, veriyi bir gün
güncellemek için gereklidir.

Yeniden dağıtım hakkı **açıktır**; bu yüzden veri kümesi depoya doğrudan
gömülebilmiştir.

### Neden yerel bir varlık

Sınır verisi uygulamayla birlikte paketlenir (`frontend/src/map/data/turkeyProvinces.json`).
Çalışma zamanında üçüncü taraf bir servise istek atılmaz. Bunun üç sebebi var:

1. Yönetici ekranı, uzak bir servis kapalıyken de çalışmalıdır.
2. Testler canlı internete bağımlı olamaz.
3. Uzaktan gelen bir sınır, sessizce değişip kaydedilmiş bir yetki alanının
   anlamını kaydırabilirdi.

### Uygulanan işlemler

`frontend/scripts/build-turkey-provinces.mjs` betiği şunları yapar:

1. **Ayıklama** — yalnızca `adm0_a3 === 'TUR'` kayıtları alınır. Sonuç tam
   **81 il**dir; betik bu sayıyı doğrular ve tutmazsa hata verir.
2. **Anahtarlama** — her il, ISO 3166-2 kodu ile tanınır (`TR-06`, `TR-34`…).
   Bu kod `source_key` olarak saklanır.
3. **Sadeleştirme** — Douglas–Peucker, tolerans **0.002°** (Türkiye
   enlemlerinde yaklaşık 170–220 m). Bir halka sadeleştirme sonucunda geçerli
   bir poligon oluşturamayacak hâle gelirse, **o halka sadeleştirilmeden
   bırakılır**; küçük adalar ve kopuk parçalar atılmaz.
4. **Yuvarlama** — koordinatlar 4 ondalık basamağa (≈ 11 m) yuvarlanır;
   halkaların kapalı kalması ayrıca sağlanır.
5. **Parçaların korunması** — MultiPolygon kayıtları birleştirilmez ve
   kırpılmaz; her parça kendi poligonu olarak listeye girer. Saklama modeli
   satır başına tek `Polygon` olduğu için, adaları olan bir il birden çok
   yetki alanı satırı hâline gelir.

Sonuç: **81 il, 87 poligon, 8.362 nokta.**

### Doğruluk sınırı — önemli

Natural Earth 10m verisi **1:10.000.000 ölçek için genelleştirilmiş kartografik
bir sınırdır**. Kadastral, hukuki ya da ölçüm amaçlı bir sınır **değildir**;
gerçek il sınırından yer yer birkaç yüz metre sapabilir.

Bu, coğrafi yetkilendirme için bilinçli olarak kabul edilebilir bulunmuştur:
alan bir *çizim kapsamı* tanımlar, bir mülkiyet sınırı değil. Yönetici
isterse il seçimiyle üretilen alanı haritada elle düzenleyebilir.

---

## 2. Coğrafi bölgeler (7 bölge)

| | |
|---|---|
| **Kaynak** | Yukarıdaki il sınırlarının **birleşimi** |
| **Eşleme** | `frontend/scripts/turkeyRegions.mjs` |
| **Lisans** | Türetildiği veriyle aynı (kamu malı) |

### Bu bir YAKLAŞIMDIR

Türkiye'nin 7 coğrafi bölgesi **1941 Birinci Türk Coğrafya Kongresi**'nde
fiziki coğrafya ölçütleriyle (iklim, yer şekilleri, bitki örtüsü) tanımlanmıştır.
Bu sınırlar **il sınırlarını birebir takip etmez**: bazı iller iki bölgeye
bölünür — örneğin Afyonkarahisar, Isparta, Sivas ve Kastamonu'nun toprakları
birden fazla bölgeye yayılır.

Serbestçe yeniden dağıtılabilen, güvenilir ve **resmî** bir 7-bölge poligon veri
kümesi bulunamadığı için, bölgeler burada **illerin birleşimiyle** üretilmiştir.
Her il, ağırlıklı olarak bulunduğu **tek** bir bölgeye bağlanmıştır (yaygın idari
basitleştirme).

**Bu durum kullanıcıdan gizlenmez.** Arayüzdeki bölge seçimi şu ifadeyle
etiketlenir:

> "İl sınırlarının birleşiminden oluşturulan yaklaşık bölge kapsamı."

Yaklaşık bir sınır, resmî bir sınır gibi sunulmaz.

### Uygulanan işlemler

Bölgeler **derleme zamanında** üretilir; uygulama çalışırken bir topoloji
kütüphanesi taşımaz.

1. Bölgeye bağlı illerin tüm poligonları toplanır.
2. `@turf/union` ile **gerçek mekânsal birleşim** alınır. Kapsayan dikdörtgen
   ya da halkaları uç uca ekleme **kullanılmaz**: ikisi de hiçbir ilin
   kapsamadığı yerleri bölgenin içindeymiş gibi gösterirdi.
3. Komşu illerin ortak sınırları erir; kopuk parçalar (adalar, boğazla ayrılan
   kıyılar) **ayrı poligon olarak kalır**.
4. Betik, eşlemenin 81 ilin her birini **tam bir kez** içerdiğini doğrular.

Sonuç: **7 bölge, 12 poligon, 4.526 nokta.** (Marmara 6 poligondur: adalar ve
boğazla ayrılan parçalar korunduğu için.)

---

## 3. Geçerlilik doğrulaması

Üretilen 87 il poligonunun ve 12 bölge poligonunun tamamı **PostGIS
`ST_IsValid`** ile doğrulanmıştır: geçersiz (kendisiyle kesişen) poligon
yoktur.

Bu bir formalite değildir: backend, yetki alanı olarak kaydedilen her poligonu
NetTopologySuite `IsValid` ile denetler ve geçersiz olanı **reddeder**.
Sadeleştirme sırasında oluşacak bir kendini-kesme, il seçiminin sunucu
tarafından reddedilmesi anlamına gelirdi.

Yeniden doğrulama:

```bash
# frontend/ içinden — poligonları WKT olarak dışa aktarıp PostGIS'e sorar
node -e "…"   # bkz. betiğin çıktısı ve psql ST_IsValid sorgusu
```

---

## 4. Harita altlıkları (mevcut durum)

Uygulamanın harita **altlıkları** (OpenStreetMap ve Esri World Imagery) bu
belgenin kapsamı dışındadır: onlar çalışma zamanında döşeme servisi olarak
çekilir ve depoya gömülmez. Atıfları harita üzerinde OpenLayers'ın attribution
kontrolünde gösterilir.

`frontend/src/map/turkey.js` içindeki `TURKEY_EXTENT_LON_LAT` bir **veri kümesi
değildir**: yalnızca kamerayı Türkiye'ye konumlandıran kaba bir kutudur,
hiçbir yetki kararında kullanılmaz ve hiçbir alanı kırpmaz.
