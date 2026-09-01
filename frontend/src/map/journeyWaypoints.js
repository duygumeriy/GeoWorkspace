import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from 'ol/style.js'
import { fromLonLat } from 'ol/proj.js'

/**
 * Yolculuğun BAŞLANGIÇ / ARA / VARIŞ noktalarının haritadaki gösterimi.
 *
 * <b>Otorite SUNUCUDUR.</b> Ad, konum, sıra ve rol; sunucunun benimsenmiş
 * yolculuk ayrıntılarından (`simulation.waypoints`) olduğu gibi okunur.
 * Planlayıcının o anki seçimi CANLI haritayı boyayamaz: yolculuk başladıktan
 * sonra panelde başka bir durak seçmek, çalışan yolculuğun noktalarını
 * değiştirmemelidir.
 *
 * <b>İkinci bir POI/durak kopyası ÜRETİLMEZ.</b> Mevcut POI ve durak
 * katmanları kendi kayıtlarını çizmeye devam eder; burası yalnızca "bu
 * yolculuk hangi noktalardan geçiyor" sorusunu cevaplar ve kendi katmanında
 * yaşar. Ad için ikinci bir istek de atılmaz — sunucu adı zaten çözmüştür.
 */

export const JOURNEY_WAYPOINT_LAYER_CLASSNAME = 'journey-waypoint-layer'
export const JOURNEY_WAYPOINT_KIND = 'journey-waypoint'

/** Önizleme çizgisinin ÜSTÜNDE, canlı aracın ALTINDA. */
export const JOURNEY_WAYPOINT_Z_INDEX = 18

const ACCENT = '#7c3aed'
const HALO = 'rgba(255, 255, 255, 0.92)'

/** Rol → görsel ağırlık ve Türkçe etiket. Sunucunun rol değerleriyle aynı. */
const ROLE_PRESENTATION = Object.freeze({
  origin: { label: 'Başlangıç', radius: 8, color: '#16a34a' },
  via: { label: 'Ara nokta', radius: 6, color: ACCENT },
  destination: { label: 'Hedef', radius: 8, color: '#dc2626' },
})

const FALLBACK_ROLE = 'via'

export function journeyWaypointRole(role) {
  return Object.hasOwn(ROLE_PRESENTATION, role) ? role : FALLBACK_ROLE
}

/**
 * Sunucunun geçiş noktalarını çizilebilir sunuma çevirir.
 *
 * <b>Uydurma etiket YOKTUR.</b> Adı boş gelen bir nokta rolüyle anılır
 * ("Başlangıç"), kimliği ya da kaynağı ekrana yazılmaz. Koordinatı olmayan bir
 * nokta hiç çizilmez: haritada yanlış yerde duran bir işaret, hiç olmayandan
 * kötüdür.
 *
 * <b>Sıra KORUNUR.</b> Numara sunucunun `position`ından gelir; tarayıcı
 * yeniden sıralama yapmaz.
 */
export function journeyWaypointPresentation(waypoints) {
  if (!Array.isArray(waypoints)) return []

  return waypoints
    .filter((waypoint) =>
      Number.isFinite(waypoint?.longitude) && Number.isFinite(waypoint?.latitude))
    .map((waypoint, index) => {
      const role = journeyWaypointRole(waypoint.role)
      const name = typeof waypoint.name === 'string' && waypoint.name.trim()
        ? waypoint.name.trim()
        : ROLE_PRESENTATION[role].label

      return {
        key: `${waypoint.source ?? 'waypoint'}-${waypoint.referenceId ?? index}-${waypoint.position ?? index}`,
        position: Number.isInteger(waypoint.position) ? waypoint.position : index,
        role,
        roleLabel: ROLE_PRESENTATION[role].label,
        name,
        source: waypoint.source ?? null,
        referenceId: waypoint.referenceId ?? null,
        longitude: waypoint.longitude,
        latitude: waypoint.latitude,
      }
    })
    .sort((left, right) => left.position - right.position)
}

/**
 * Ara noktaların ekrandaki numarası.
 *
 * Başlangıç ve varış zaten rolleriyle okunur; numara YALNIZCA aradakileri
 * birbirinden ayırmak için vardır ve 1'den başlar.
 */
export function journeyWaypointLabel(waypoint, viaOrder) {
  if (waypoint.role === 'origin' || waypoint.role === 'destination') return waypoint.name
  return `${viaOrder}. ${waypoint.name}`
}

function waypointStyle(role, label) {
  const presentation = ROLE_PRESENTATION[journeyWaypointRole(role)]

  return new Style({
    image: new CircleStyle({
      radius: presentation.radius,
      fill: new Fill({ color: presentation.color }),
      stroke: new Stroke({ color: HALO, width: 3 }),
    }),
    text: new Text({
      text: label,
      font: '12px system-ui, sans-serif',
      offsetY: -(presentation.radius + 10),
      fill: new Fill({ color: presentation.color }),
      /* Kılıf, açık ve koyu altlıkta da okunabilirlik sağlar; tema değişkeni
         OpenLayers'tan okunamadığı için değer burada durur. */
      stroke: new Stroke({ color: HALO, width: 3 }),
      overflow: true,
    }),
    zIndex: JOURNEY_WAYPOINT_Z_INDEX,
  })
}

export function createJourneyWaypointLayer() {
  const source = new VectorSource()
  const layer = new VectorLayer({
    source,
    className: JOURNEY_WAYPOINT_LAYER_CLASSNAME,
    zIndex: JOURNEY_WAYPOINT_Z_INDEX,
    style: (feature) => waypointStyle(feature.get('role'), feature.get('label')),
  })
  return { source, layer }
}

/**
 * Kaynağı verilen sunumla eşitler.
 *
 * Her yazım ÖNCE temizler: yeni bir yolculuk eskisinin noktalarını devralmaz
 * ve bırakma (`dismiss`) katmanı boşaltır.
 *
 * @returns {number} çizilen nokta sayısı
 */
export function syncJourneyWaypointFeatures(source, waypoints) {
  if (!source) return 0

  source.clear()

  const presentation = journeyWaypointPresentation(waypoints)
  if (presentation.length === 0) return 0

  let viaOrder = 0

  for (const waypoint of presentation) {
    if (waypoint.role === 'via') viaOrder += 1

    const feature = new Feature({
      geometry: new Point(fromLonLat([waypoint.longitude, waypoint.latitude])),
    })

    feature.set('featureKind', JOURNEY_WAYPOINT_KIND)
    feature.set('role', waypoint.role)
    feature.set('label', journeyWaypointLabel(waypoint, viaOrder))
    feature.set('journeyWaypoint', waypoint, true)

    source.addFeature(feature)
  }

  return presentation.length
}
