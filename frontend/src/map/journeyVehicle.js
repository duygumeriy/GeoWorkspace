import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import { Icon, Style } from 'ol/style.js'
import { fromLonLat } from 'ol/proj.js'
import { journeyProfileIcon } from '../components/map/journeyProfileIcons.js'

/**
 * Kişisel yolculuğun canlı işaretçisi.
 *
 * <b>Paylaşılan hat aracına DOKUNULMAZ.</b> <code>transportVehicle.js</code>
 * bir hattın herkese görünen aracını çizer ve hat rengini taşır; buradaki
 * işaretçi tek bir kullanıcıya aittir, bir hatta bağlı olmak zorunda değildir
 * ve seyahat türüne göre farklı görünür. İkisini tek katmanda birleştirmek,
 * bir kullanıcının kişisel yolculuğunu paylaşılan araç akışına karıştırırdı.
 *
 * <b>Otobüs/toplu taşıma semantiği YOKTUR</b> — desteklenen üç profil dışında
 * bir görünüm tanımlanmaz. Marka/logo işi de bu fazın konusu değildir.
 */

export const JOURNEY_VEHICLE_LAYER_CLASSNAME = 'journey-vehicle-layer'
export const JOURNEY_VEHICLE_KIND = 'journey-vehicle'

/** Önizleme çizgisinin ÜSTÜNDE, paylaşılan araçla çakışmayan bir seviye. */
export const JOURNEY_VEHICLE_Z_INDEX = 21

const ACCENT = '#7c3aed'
const HALO = 'rgba(255, 255, 255, 0.92)'

/* --- Profil rozeti ----------------------------------------------------------
   İşaretçi artık EMOJİ DEĞİLDİR. Emoji, işletim sistemine göre bambaşka bir
   resme dönüşür ve panelin çizgi ikonlarıyla aynı yolculuğu anlatmaz. Sembol,
   panelin okuduğu AYNI sözlükten gelir; OpenLayers bir React bileşeni
   çizemediği için bileşen bir KEZ durağan SVG'ye çevrilip `data:` URI olarak
   önbelleklenir — POI rozetlerinde kurulmuş olan yolun aynısı.

   Ağ yoktur, CDN yoktur, uzak simge adresi yoktur, yeni bir ikon paketi
   yoktur. */

/** Rozetin kanonik çizim kutusu; Lucide'ın kendi viewBox'ı. */
const VIEW_BOX = 24

/** İşaretçinin ekrandaki çapı (px) — eski dairesel rozetle aynı ağırlıkta. */
const MARKER_SIZE = 28

/** Retina ekranda bulanıklaşmaması için SVG iki katı doğal boyutta üretilir. */
const SOURCE_SCALE = 2

/** `profileId` → Lucide sembolünün İÇ işaretlemesi (dış <svg> olmadan). */
const glyphCache = new Map()

function profileGlyphMarkup(profileId) {
  const cached = glyphCache.get(profileId)
  if (cached !== undefined) return cached

  const ProfileIcon = journeyProfileIcon(profileId)
  const markup = renderToStaticMarkup(
    createElement(ProfileIcon, { size: VIEW_BOX, color: '#FFFFFF', strokeWidth: 2 }),
  )

  /* Yalnızca çocuk düğümler alınır: rozetin kendi viewBox'ı, kendi ölçeği ve
     kendi kılıfı vardır. Girdi kullanıcıdan değil kendi bağımlılığımızdan
     gelir ve tek kök <svg> taşır. */
  const inner = markup.replace(/^<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '')

  glyphCache.set(profileId, inner)
  return inner
}

/** `profileId` → `data:` URI. */
const badgeCache = new Map()

/**
 * Profil rozetinin <code>data:</code> URI'si.
 *
 * <b>Önbellek zorunludur:</b> stil fonksiyonu her karede çağrılabilir ve SVG
 * metnini yeniden kurup yeniden kodlamak haritayı kilitlerdi. Anahtar sonludur
 * — üç profil, artı güvenli varsayılan.
 */
export function journeyVehicleBadgeDataUri(profileId) {
  const key = profileId ?? ''
  const cached = badgeCache.get(key)
  if (cached !== undefined) return cached

  const pixels = MARKER_SIZE * SOURCE_SCALE

  /* POI rozetiyle AYNI üç katman — beyaz kılıf, vurgu renginde disk, beyaz
     sembol — böylece harita üzerindeki iki işaretçi tek bir sistemden gelmiş
     gibi okunur ve açık/koyu altlıkta da ayırt edilir. */
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 ${VIEW_BOX} ${VIEW_BOX}">`
    + `<circle cx="12" cy="12" r="11" fill="${HALO}"/>`
    + `<circle cx="12" cy="12" r="9.5" fill="${ACCENT}"/>`
    + '<g transform="translate(12 12) scale(0.55) translate(-12 -12)"'
    + ' fill="none" stroke="#FFFFFF" stroke-width="2.4"'
    + ' stroke-linecap="round" stroke-linejoin="round">'
    + profileGlyphMarkup(profileId)
    + '</g></svg>'

  // base64 DEĞİL: okunabilir kalır ve kodlaması ucuzdur.
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  badgeCache.set(key, uri)
  return uri
}

/**
 * Bir pikseldeki kişisel yolculuk işaretçisi.
 *
 * <b>Kimlik AÇIKÇA sorulur:</b> hem katman sınıfı hem de feature'ın kendi
 * <code>featureKind</code> ayırt edicisi aranır. Stile ya da katman sırasına
 * bakarak "herhalde yolculuk aracıdır" demek, paylaşılan hat aracını ya da bir
 * POI'yi yanlışlıkla yolculuk sanmaya açık kapı bırakırdı. Desen paylaşılan
 * araçtaki <code>findTransportVehicleAtPixel</code> ile birebir aynıdır.
 */
export function findJourneyVehicleAtPixel(map, pixel, hitTolerance = 10) {
  if (!map || !pixel) return null
  return map.forEachFeatureAtPixel(
    pixel,
    (feature, layer) => (
      layer?.getClassName?.().includes(JOURNEY_VEHICLE_LAYER_CLASSNAME)
      && feature.get('featureKind') === JOURNEY_VEHICLE_KIND
        ? feature
        : null
    ),
    { hitTolerance },
  ) ?? null
}

/**
 * Kameranın SAHİBİ olan çalıştırma; sahip yoksa <code>null</code>.
 *
 * <b>Neden saf bir fonksiyon.</b> "Uçan animasyon hâlâ bizim mi" sorusu bir
 * kimlik sorusudur ve React'e ihtiyaç duymaz. Takip kapalıysa ya da ortada
 * araç yoksa sahip yoktur; başka bir çalıştırma devraldıysa sahip DEĞİŞMİŞTİR
 * ve önceki animasyonun bayrağı devralınmamalıdır. Aynı yolculuk sürerken
 * değer sabit kalır — kısma davranışı bu sayede korunur.
 */
export function journeyCameraOwner({ following = false, presentation = null } = {}) {
  if (!following || !presentation) return null
  return presentation.simulationId ?? null
}

/**
 * Kamera animasyonunun KİLİDİ ve sahiplik kuşağı.
 *
 * <b>Sorun.</b> Tek bir "animasyon sürüyor" bayrağı yetmez, çünkü OpenLayers
 * yeni bir <code>view.animate</code> çağrıldığında ÖNCEKİ animasyonun geri
 * çağrısını da (iptal edildi diye) tetikler. Sahiplik A'dan B'ye geçtikten
 * sonra gelen A geri çağrısı, B'nin kilidini açardı: kısma devre dışı kalır ve
 * üst üste binen animasyonlar başlardı.
 *
 * <b>Çözüm.</b> Her sahiplik değişimi bir KUŞAK atlatır. Animasyon başlarken
 * içinde bulunduğu kuşağı alır; geri çağrı ancak kendi kuşağı hâlâ geçerliyse
 * kilidi bırakabilir. Eski bir geri çağrı böylece sessizce yutulur.
 *
 * React'ten bağımsız ve saf tutulur: yarış senaryosunun tamamı bir DOM ya da
 * harita olmadan adım adım çalıştırılabilir.
 */
export function createJourneyCameraLock() {
  let generation = 0
  let animating = false

  return {
    /** Şu an bize ait, uçan bir animasyon var mı? */
    get isAnimating() {
      return animating
    },

    /** Geçerli sahiplik kuşağı; yalnızca gözlem/test içindir. */
    get generation() {
      return generation
    },

    /** Sahiplik değişti: eski geri çağrılar geçersizleşir, kilit açılır. */
    invalidate() {
      generation += 1
      animating = false
      return generation
    },

    /** Animasyon başlıyor; geri çağrısının taşıyacağı jeton döner. */
    begin() {
      animating = true
      return generation
    },

    /**
     * Animasyon bitti/iptal edildi. Kilit YALNIZCA jeton hâlâ güncel kuşağa
     * aitse bırakılır.
     *
     * @returns {boolean} kilidin gerçekten bırakılıp bırakılmadığı
     */
    release(token) {
      if (token !== generation) return false
      animating = false
      return true
    },
  }
}

const styleCache = new Map()

function journeyVehicleStyle(profileId) {
  const key = profileId ?? ''
  if (!styleCache.has(key)) {
    styleCache.set(key, new Style({
      image: new Icon({
        src: journeyVehicleBadgeDataUri(profileId),
        // SVG iki katı boyutta üretildi; ekrandaki ölçü sabit kalır.
        scale: 1 / SOURCE_SCALE,
      }),
      zIndex: JOURNEY_VEHICLE_Z_INDEX,
    }))
  }
  return styleCache.get(key)
}

export function createJourneyVehicleLayer() {
  const source = new VectorSource()
  const layer = new VectorLayer({
    source,
    className: JOURNEY_VEHICLE_LAYER_CLASSNAME,
    zIndex: JOURNEY_VEHICLE_Z_INDEX,
    style: (feature) => journeyVehicleStyle(feature.get('profileId')),
  })
  return { source, layer }
}

/**
 * İşaretçiyi anlık görüntüyle eşitler.
 *
 * <b>Feature YERİNDE güncellenir.</b> Her tick'te yeni bir feature üretmek
 * saniyede bir yeniden çizim, kaybolan seçim durumu ve gereksiz çöp demekti;
 * yalnızca geometri taşınır. Sunum <code>null</code> olduğunda kaynak
 * temizlenir — hayalet işaretçi kalmaz.
 *
 * @returns {import('ol/Feature.js').default | null}
 */
export function syncJourneyVehicleFeature(source, presentation) {
  if (!source) return null

  if (!presentation || !Number.isFinite(presentation.longitude) || !Number.isFinite(presentation.latitude)) {
    source.clear()
    return null
  }

  const coordinate = fromLonLat([presentation.longitude, presentation.latitude])
  const existing = source.getFeatures()[0] ?? null

  if (existing) {
    existing.getGeometry().setCoordinates(coordinate)
    // Profil değişmiş olabilir (yeni bir yolculuk): stil anahtarı tazelenir.
    if (existing.get('profileId') !== presentation.profileId) {
      existing.set('profileId', presentation.profileId)
    }
    existing.set('simulationId', presentation.simulationId, true)
    return existing
  }

  const feature = new Feature({ geometry: new Point(coordinate) })
  feature.set('featureKind', JOURNEY_VEHICLE_KIND)
  feature.set('profileId', presentation.profileId)
  feature.set('simulationId', presentation.simulationId, true)
  source.addFeature(feature)
  return feature
}
