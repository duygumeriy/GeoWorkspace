import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Style from 'ol/style/Style.js'
import Fill from 'ol/style/Fill.js'
import Stroke from 'ol/style/Stroke.js'
import CircleStyle from 'ol/style/Circle.js'
import Icon from 'ol/style/Icon.js'
import { FALLBACK_COLOR, accentColor, iconForKey } from '../components/map/poiIconRegistry.js'
import { MARKER_SCALE_BANDS } from './poiMarkerScale.js'

/**
 * POI'nin VEKTÖR gösterimi: kategori rozeti, seçim halkası ve isabet alanı.
 *
 * ## Neden bu dosya var
 *
 * Kalıcı gösterim Faz 4'ten beri GeoServer WMS rasteridir. Faz 5A, ölçek
 * değişirken bayat bitmap'in geometrik olarak ölçeklenmesini engellemek için
 * rasteri o an ekrandan çeker — ve o boşluğu Faz 4'ten kalan sade MAVİ NOKTA
 * dolduruyordu. Canlı denemede görülen şey buydu: her yakınlaşmada POI'ler bir
 * anlığına kimliklerini kaybedip aynı mavi noktaya dönüşüyordu.
 *
 * <b>Bir POI hiçbir durumda genel bir noktaya dönüşmez.</b> Raster çekildiğinde
 * vektör AYNI kategori rozetini çizer; kullanıcı yalnızca çok küçük bir keskinlik
 * farkı görür, kimlik değişimi görmez.
 *
 * ## Lucide neden ve NASIL yeniden kullanılıyor
 *
 * İkinci bir 44 satırlık simge tablosu ya da elle kopyalanmış 44 SVG yolu
 * YOKTUR. Tek kaynak <c>poiIconRegistry</c>'dir — arama kutusunun kullandığı
 * eşlemenin aynısı. OpenLayers bir React bileşeni çizemediği için bileşen bir
 * KEZ <c>renderToStaticMarkup</c> ile durağan SVG'ye çevrilir; sonuç
 * önbelleklenir ve bir daha üretilmez.
 *
 * Ağ yoktur, CDN yoktur, uzak simge adresi yoktur, tarayıcıdan GeoServer'a
 * istek yoktur: üretilen şey bellekte duran bir <c>data:</c> URI'dir.
 *
 * ## GeoServer rozetiyle görsel süreklilik
 *
 * Rozet, üretilmiş SVG'lerle (bkz. <c>PoiStyleTemplates.RenderIcon</c>) AYNI
 * geometriyi kullanır: beyaz kılıf halkası, kategori renginde disk, 0.55
 * ölçeğinde beyaz sembol. İkisi bayt olarak aynı değildir — biri Batik, öteki
 * tarayıcı tarafından çizilir — ama aralarında geçiş yapmak "simge sistemi
 * değişti" hissi vermez.
 */

/** Rozetin çizildiği kanonik kutu; üretilmiş SVG'lerle aynı viewBox. */
const VIEW_BOX = 24

/**
 * Rozet SVG'sinin doğal boyut çarpanı.
 *
 * Tarayıcı bir SVG'yi <c>Image</c> olarak DOĞAL boyutunda rasterleştirir;
 * OpenLayers de onu cihazın piksel oranıyla ölçekleyerek çizer. 1× üretilmiş
 * bir rozet retina ekranda bulanık görünürdü — WMS rasteri zaten
 * <c>devicePixelRatio</c> ile isteniyor ve vektör yedeğinin ondan daha kötü
 * görünmesi geçişi fark edilir kılardı.
 */
const SOURCE_SCALE = 2

/**
 * Seçim halkasının rengi.
 *
 * Tasarım sisteminin vurgu tonudur (<c>--primary-light</c>). OpenLayers bir CSS
 * değişkenini okuyamaz, dolayısıyla değer burada sabittir; kategori renkleriyle
 * karışmaması bilinçlidir — halka bir KATEGORİ değil, bir DURUM anlatır.
 */
export const SELECTION_COLOR = '#6366F1'

/** Seçim halkasının dış beyaz kılıfı: açık ve koyu altlıkta da görünür. */
const SELECTION_HALO = 'rgba(255, 255, 255, 0.92)'

/** Tamamen saydam ama isabet denetlenebilir. */
const TRANSPARENT = 'rgba(0, 0, 0, 0)'

/* --- Simge gövdesi ---------------------------------------------------------- */

/** `iconKey|color` → Lucide sembolünün iç işaretlemesi. */
const glyphCache = new Map()

/**
 * Lucide bileşeninin İÇ işaretlemesini verir (dış <c>&lt;svg&gt;</c> olmadan).
 *
 * Bileşen bir kez çizilir; dış sarmalayıcı atılır çünkü rozetin kendi
 * <c>viewBox</c>'ı, kendi ölçeği ve kendi kılıfı vardır.
 */
function glyphMarkup(iconKey) {
  const cached = glyphCache.get(iconKey)
  if (cached !== undefined) return cached

  const LucideIcon = iconForKey(iconKey)
  const markup = renderToStaticMarkup(
    createElement(LucideIcon, { size: VIEW_BOX, color: '#FFFFFF', strokeWidth: 2 }),
  )

  /* Yalnızca çocuk düğümler alınır. Dış etiketi düzenli ifadeyle soymak
     burada güvenlidir: girdi kullanıcıdan değil, kendi bağımlılığımızdan
     gelen ve tek bir kök <svg> taşıyan denetimli bir işaretlemedir. */
  const inner = markup.replace(/^<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '')

  glyphCache.set(iconKey, inner)
  return inner
}

/* --- Rozet ------------------------------------------------------------------ */

/** `iconKey|color|size` → `data:` URI. */
const badgeCache = new Map()

/**
 * Bir kategori rozetinin <c>data:</c> URI'si.
 *
 * <b>Önbellek zorunludur.</b> Yakınlaşma sırasında stil fonksiyonu her POI için
 * her karede çağrılabilir; SVG metnini yeniden kurmak ve yeniden kodlamak
 * haritayı kilitlerdi. Anahtar üç değerdir ve üçü de sonludur: 44 simge, 44
 * renk, 3 boyut bandı.
 */
export function poiBadgeDataUri(iconKey, colorHex, size) {
  const color = accentColor(colorHex)
  const key = `${iconKey ?? ''}|${color}|${size}`

  const cached = badgeCache.get(key)
  if (cached !== undefined) return cached

  const pixels = size * SOURCE_SCALE

  /* Üretilmiş GeoServer rozetiyle AYNI üç katman: beyaz kılıf, renkli disk,
     beyaz sembol. Sayılar oradan gelir, yeniden seçilmez. */
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 ${VIEW_BOX} ${VIEW_BOX}">`
    + '<circle cx="12" cy="12" r="11" fill="#FFFFFF"/>'
    + `<circle cx="12" cy="12" r="9.5" fill="${color}"/>`
    + '<g transform="translate(12 12) scale(0.55) translate(-12 -12)"'
    + ' fill="none" stroke="#FFFFFF" stroke-width="2.4"'
    + ' stroke-linecap="round" stroke-linejoin="round">'
    + glyphMarkup(iconKey)
    + '</g></svg>'

  // `encodeURIComponent`: base64 değil — okunabilir kalır ve kodlaması ucuzdur.
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  badgeCache.set(key, uri)

  return uri
}

/* --- OpenLayers stilleri ---------------------------------------------------- */

/** Tam anahtar → hazır `Style[]`. */
const styleCache = new Map()

/**
 * Boyuta göre saydam isabet dairesi.
 *
 * <b>Stilsiz bırakmak (undefined) YANLIŞ olurdu:</b> stil döndürmemek feature'ı
 * isabet denetiminden de çıkarır ve POI tıklanamaz hâle gelirdi. Bu fazda
 * GetFeatureInfo YOKTUR — kimlik hâlâ vektörde yaşar.
 *
 * Her durumda döndürülür, rozet çizilse de çizilmese de: tıklanabilir alanın
 * rasterin gelip gitmesiyle değişmemesi, haritanın imleç altındaki hissini
 * sabit tutar.
 */
function hitCircle(size) {
  return new Style({
    image: new CircleStyle({
      radius: size / 2,
      fill: new Fill({ color: TRANSPARENT }),
      stroke: new Stroke({ color: TRANSPARENT, width: 2 }),
    }),
  })
}

/**
 * Seçim halkası: rozeti DEĞİŞTİRMEZ, çevreler.
 *
 * Eski davranışta seçili POI büyük bir mavi noktaya dönüşüyordu — yani seçim,
 * kaydın kategori kimliğini siliyordu. Halka aynı bilgiyi kimliği bozmadan
 * verir: dışta yumuşak beyaz bir kılıf, içte vurgu renginde ince bir çember.
 */
function selectionRings(size) {
  const radius = size / 2 + 3

  return [
    new Style({
      image: new CircleStyle({
        radius: radius + 1.5,
        fill: new Fill({ color: TRANSPARENT }),
        stroke: new Stroke({ color: SELECTION_HALO, width: 3.5 }),
      }),
    }),
    new Style({
      image: new CircleStyle({
        radius,
        fill: new Fill({ color: TRANSPARENT }),
        stroke: new Stroke({ color: SELECTION_COLOR, width: 2.5 }),
      }),
    }),
  ]
}

/**
 * Bir POI'nin o anki görsel durumu.
 *
 * Dört hâl vardır ve hiçbirinde POI kimliksiz bir noktaya dönüşmez:
 *
 * <list type="bullet">
 * <item>raster açık + seçili değil → yalnızca isabet alanı; rozeti WMS çizer,</item>
 * <item>raster açık + seçili → isabet alanı + seçim halkası; rozet yine WMS'ten
 *   gelir, ikinci bir rozet ÜSTÜNE çizilmez,</item>
 * <item>raster kapalı + seçili değil → kategori rozeti,</item>
 * <item>raster kapalı + seçili → kategori rozeti + seçim halkası.</item>
 * </list>
 *
 * @param {{ iconKey?: string|null, colorHex?: string|null, size: number,
 *           selected: boolean, rasterActive: boolean }} state
 */
export function poiMarkerStyle({ iconKey, colorHex, size, selected, rasterActive }) {
  const color = accentColor(colorHex)
  const key = `${iconKey ?? ''}|${color}|${size}|${selected ? 's' : '-'}|${rasterActive ? 'r' : '-'}`

  const cached = styleCache.get(key)
  if (cached !== undefined) return cached

  const styles = [hitCircle(size)]

  if (selected) styles.push(...selectionRings(size))

  /* Rozet yalnızca raster ÇEKİLDİĞİNDE çizilir. Raster ekrandayken vektör de
     rozet çizseydi aynı POI iki kez görünür ve hafifçe kaymış iki simge
     üst üste binerdi. */
  if (!rasterActive) {
    styles.push(
      new Style({
        image: new Icon({
          src: poiBadgeDataUri(iconKey, color, size),
          /* Boyut `width`/`height` ile DEĞİL, ölçekle verilir. İkisi
             OpenLayers'a görüntüyü daha kurucuda çözdürür (doğal boyutu
             öğrenmek için) ve DOM'suz bir ortamda — birim testlerinde —
             düşerdi. SVG zaten hedefin iki katı doğal boyutta üretiliyor,
             dolayısıyla ölçek sabittir ve aynı sonucu verir. */
          scale: 1 / SOURCE_SCALE,
        }),
      }),
    )
  }

  styleCache.set(key, styles)
  return styles
}

/** Kategori metadatası olmayan kayıtların nötr yedeği. */
export const FALLBACK_PRESENTATION = Object.freeze({ iconKey: null, colorHex: FALLBACK_COLOR })

/* --- Ön ısıtma ---------------------------------------------------------------- */

/**
 * Rozetleri, ihtiyaç duyulmadan ÖNCE çözdürür.
 *
 * <b>Boş kareyi doğuran şey buydu.</b> OpenLayers bir <c>Icon</c>'un kaynağını
 * <c>Image</c> üzerinden ASENKRON yükler. Rozet ilk kez ancak raster çekildiği
 * anda — yani yakınlaşmanın ortasında — oluşturuluyordu; o karede görüntü henüz
 * çözülmemiş oluyor ve OpenLayers hiçbir şey çizmiyordu. Kullanıcının gördüğü
 * "WMS kayboldu → bir an boş → rozet geldi" sırası tam olarak budur.
 *
 * Çare stil sistemini değiştirmek değil, ZAMANLAMAYI değiştirmektir: haritada
 * yüklü POI'lerin gerektirdiği rozetler daha veri gelir gelmez hazırlanır.
 * Yakınlaşma başladığında vektör zaten çizilebilir durumdadır ve devir teslim
 * tek karede olur.
 *
 * <b>Sınırlıdır.</b> Ağ isteği yoktur, React çizimi yoktur, kare başına iş
 * yoktur: yalnızca yüklü POI'lerde GERÇEKTEN bulunan kategoriler × üç boyut
 * bandı kadar rozet, mevcut önbelleklere yazılır. Aynı çağrı ikinci kez
 * yapıldığında hiçbir yeni nesne üretilmez.
 *
 * @param {Iterable<{ iconKey?: string|null, colorHex?: string|null }>} presentations
 */
export function prewarmPoiBadges(presentations) {
  const seen = new Set()

  /* Tanınmayan/eksik anahtarın yedeği de ISITILIR: metadatası olmayan bir
     kategori de ilk karede hazır olmalıdır. */
  const wanted = [FALLBACK_PRESENTATION, ...(presentations ?? [])]

  for (const presentation of wanted) {
    const iconKey = presentation?.iconKey ?? null
    const color = accentColor(presentation?.colorHex)
    const key = `${iconKey ?? ''}|${color}`

    if (seen.has(key)) continue
    seen.add(key)

    for (const { size } of MARKER_SCALE_BANDS) {
      const styles = poiMarkerStyle({
        iconKey,
        colorHex: color,
        size,
        selected: false,
        rasterActive: false,
      })

      /* Çözme işini BAŞLATIR. `Image` olmayan bir ortamda (birim testleri)
         sessizce atlanır — önbellekler yine dolmuş olur ve ölçülen şey zaten
         nesnelerin hazırlanmasıdır. */
      if (typeof Image === 'undefined') continue

      for (const style of styles) style.getImage()?.load?.()
    }
  }

  return seen.size
}

/** Testler ve tanılama için: önbelleklerin doluluk sayıları. */
export function markerCacheSizes() {
  return { glyphs: glyphCache.size, badges: badgeCache.size, styles: styleCache.size }
}
