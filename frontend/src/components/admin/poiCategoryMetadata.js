/**
 * Kategori sunum metadatasının arayüz tarafındaki saf yardımcıları: simge
 * seçenekleri, renk paleti ve renk normalleştirme.
 *
 * <b>İzin listesinin SAHİBİ backend'dir.</b> Buradaki liste, sunucudaki
 * `PoiCategoryIcons` kümesinin arayüz karşılığıdır ve yalnızca kullanıcıya
 * seçenek sunmak içindir — sunucu her anahtarı yeniden doğrular ve orada
 * verilen karar bağlayıcıdır. Bu dosya bir güvenlik sınırı DEĞİLDİR.
 *
 * <b>Simgeler burada ÇİZİLMEZ.</b> Bu faz yalnızca anahtarı seçtirir; anahtarın
 * gerçek glif karşılığı (frontend'de bir bileşen, GeoServer'da yerel bir SVG)
 * sonraki fazın konusudur. Seçim bu yüzden metin etiketiyle yapılır — henüz
 * çizilemeyen bir simgeyi temsilen rastgele bir glif göstermek, yanlış bir
 * önizleme vaat etmek olurdu.
 */

/** Backend sınırı (PoiCategory.MaxIconKeyLength). */
export const MAX_ICON_KEY_LENGTH = 50

/**
 * Onaylı simge anahtarları ve Türkçe etiketleri.
 *
 * Etiket, anahtarın NE İŞE YARADIĞINI söyler; anahtarın kendisi ikincil olarak
 * gösterilir çünkü yönetici ileride SLD tarafında onu görecektir.
 */
export const ICON_OPTIONS = [
  /* --- Kök / çekirdek ------------------------------------------------------ */
  { key: 'store', label: 'Ticaret / Dükkân' },
  { key: 'shopping-bag', label: 'Alışveriş' },
  { key: 'zap', label: 'Enerji' },
  { key: 'party-popper', label: 'Eğlence' },
  { key: 'house', label: 'Konut' },
  { key: 'landmark', label: 'Kültürel Tesis' },
  { key: 'recycle', label: 'Altyapı / Geri Dönüşüm' },
  { key: 'hospital', label: 'Hastane' },
  { key: 'graduation-cap', label: 'Eğitim' },
  { key: 'radio-tower', label: 'Telekomünikasyon' },
  { key: 'wheat', label: 'Tarım' },
  { key: 'factory', label: 'Sanayi' },
  { key: 'trees', label: 'Yeşil Alan' },
  { key: 'route', label: 'Karayolu' },
  { key: 'building-2', label: 'Resmî Kurum' },
  { key: 'shield', label: 'Askerî Kurum' },
  { key: 'train', label: 'Demiryolu' },
  { key: 'badge-dollar-sign', label: 'Finans Kurumu' },
  { key: 'castle', label: 'Tarihî / Turistik' },
  { key: 'map-pin', label: 'Önemli Nokta' },
  { key: 'dumbbell', label: 'Spor' },
  { key: 'users', label: 'Sivil Toplum' },
  { key: 'heart-handshake', label: 'Sosyal Kurum' },
  { key: 'utensils', label: 'Yeme-İçme' },
  { key: 'church', label: 'Dinî Tesis' },
  { key: 'plane', label: 'Havayolu' },
  { key: 'ship', label: 'Denizyolu' },

  /* --- Özel alt kategoriler ------------------------------------------------ */
  { key: 'banknote', label: 'Banka / ATM' },
  { key: 'gauge', label: 'EPDK / Ölçüm' },
  { key: 'pill', label: 'Eczane' },
  { key: 'battery-charging', label: 'Şarj İstasyonu' },
  { key: 'school', label: 'Okul' },
  { key: 'car', label: 'Otomotiv' },
  { key: 'armchair', label: 'Mobilya' },
  { key: 'shopping-cart', label: 'Market' },
  { key: 'shirt', label: 'Giyim' },
  { key: 'monitor', label: 'Elektronik' },
  { key: 'key-round', label: 'Emlak' },
  { key: 'hammer', label: 'Yapı Marketi' },
  { key: 'car-front', label: 'Araç Kiralama' },
  { key: 'shopping-basket', label: 'Ayakkabı / Çanta' },

  /* --- Mevcut alt kategoriler ---------------------------------------------- */
  { key: 'coffee', label: 'Kafe' },
  { key: 'utensils-crossed', label: 'Restoran' },
  { key: 'music', label: 'Konser / Müzik' },
]

/** Tanınmayan/boş anahtarda render tarafının düşeceği yedek. */
export const FALLBACK_ICON_KEY = 'map-pin'

/** Rengi olmayan kayıtların gösterim yedeği. Veritabanına YAZILMAZ. */
export const FALLBACK_COLOR = '#64748B'

/**
 * Denetimli palet: sektör başına bir renk.
 *
 * Sunucudaki `PoiCategoryPalette` ile aynı değerler. Palet bir KISIT değil bir
 * varsayılandır — sunucu doğrulaması `#RRGGBB` biçimine bakar, paletle
 * eşitliğe değil.
 */
export const COLOR_OPTIONS = [
  { value: '#EF4444', label: 'Sağlık' },
  { value: '#F59E0B', label: 'Eğitim / Enerji' },
  { value: '#F97316', label: 'Yeme-İçme' },
  { value: '#22C55E', label: 'Doğa / Tarım' },
  { value: '#3B82F6', label: 'Ulaşım / Konut / Spor' },
  { value: '#334155', label: 'Kamu / Askerî / Sanayi' },
  { value: '#8B5CF6', label: 'Ticaret / Alışveriş' },
  { value: '#06B6D4', label: 'Finans / Altyapı' },
  { value: '#A855F7', label: 'Kültür / Turizm / Dinî' },
  { value: '#EC4899', label: 'Sosyal / Eğlence' },
]

/** Yeni kategori formunun başlangıç rengi. */
export const DEFAULT_COLOR = '#8B5CF6'

/** Anahtar onaylı listede mi. */
export function isApprovedIconKey(iconKey) {
  return ICON_OPTIONS.some((option) => option.key === iconKey)
}

/** Anahtarın Türkçe etiketi; tanınmıyorsa anahtarın kendisi. */
export function iconLabel(iconKey) {
  return ICON_OPTIONS.find((option) => option.key === iconKey)?.label ?? iconKey ?? ''
}

/**
 * Rengi kanonik `#RRGGBB` biçimine çevirir.
 *
 * Sunucunun kuralıyla AYNI: tam yedi karakter, baştaki `#`, altı onaltılık
 * basamak, harfler büyük. `#RGB` kısa yazımı ve `#RRGGBBAA` alfa yazımı
 * uzunluk denetiminde elenir — ikisi için ayrı kural yoktur.
 *
 * `<input type="color">` her zaman küçük harfli `#rrggbb` üretir, dolayısıyla
 * bu normalleştirme olmadan aynı renk iki farklı metin olarak gönderilirdi.
 *
 * @returns {string|null} kanonik renk ya da geçersizse null
 */
export function normalizeColorHex(value) {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()

  if (trimmed.length !== 7 || trimmed[0] !== '#') return null
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) return null

  return trimmed.toUpperCase()
}

/** Listede gösterilecek renk: yoksa nötr yedek. */
export function displayColor(category) {
  return normalizeColorHex(category?.colorHex) ?? FALLBACK_COLOR
}
