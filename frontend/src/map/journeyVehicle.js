import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from 'ol/style.js'
import { fromLonLat } from 'ol/proj.js'

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

/**
 * Profil → görsel semantik.
 *
 * Glif, ikon dosyası yerine metin olarak çizilir: mevcut araç işaretçisi de
 * aynı yaklaşımı kullanır ve böylece yeni bir varlık hattı açılmaz.
 */
const PROFILE_GLYPHS = Object.freeze({
  driving: '\u{1F697}',
  walking: '\u{1F6B6}',
  cycling: '\u{1F6B2}',
})

export const JOURNEY_VEHICLE_FALLBACK_GLYPH = PROFILE_GLYPHS.driving

export function journeyVehicleGlyph(profileId) {
  /* Bilinmeyen bir profil ÇÖKERTMEZ: sunucu sözleşmesi üç profille sınırlı
     olsa da arayüz savunmacı davranır. */
  return PROFILE_GLYPHS[profileId] ?? JOURNEY_VEHICLE_FALLBACK_GLYPH
}

const styleCache = new Map()

function journeyVehicleStyle(profileId) {
  const glyph = journeyVehicleGlyph(profileId)
  if (!styleCache.has(glyph)) {
    styleCache.set(glyph, new Style({
      image: new CircleStyle({
        radius: 13,
        fill: new Fill({ color: HALO }),
        stroke: new Stroke({ color: ACCENT, width: 3 }),
      }),
      text: new Text({ text: glyph, font: '14px sans-serif', offsetY: 1 }),
      zIndex: JOURNEY_VEHICLE_Z_INDEX,
    }))
  }
  return styleCache.get(glyph)
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
