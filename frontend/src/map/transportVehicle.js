import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style.js'
import { fromLonLat } from 'ol/proj.js'
import { isTerminalSimulationStatus, simulationStatusLabel } from './transportSimulationState.js'

/**
 * Canlı aracın harita sunumu.
 *
 * <b>Burada hareket ÜRETİLMEZ.</b> Konum da ilerleme de sunucudan gelir
 * (Faz 2 runner → Faz 3 kanonik durum); bu modülün işi o durumu bir
 * OpenLayers feature'ına çevirmek, sahipliğini yönetmek ve kamera kararını
 * vermektir. Tarayıcıda ne yol geometrisi okunur, ne yüzde hesaplanır, ne de
 * bir zamanlayıcı kurulur.
 */

export const TRANSPORT_VEHICLE_KIND = 'transport-vehicle'
export const TRANSPORT_VEHICLE_LAYER_CLASSNAME = 'transport-vehicle-layer'

/** Aracı kimin "sahiplendiği": canlı takip mi, yoksa başlatma anlık görüntüsü mü. */
export const VEHICLE_OWNERSHIP = Object.freeze({
  FOLLOW: 'follow',
  START: 'start',
})

const FALLBACK_COLOR = '#2563EB'
const vehicleStyles = new Map()

function safeColor(value) {
  return /^#[0-9A-F]{6}$/i.test(value ?? '') ? value.toUpperCase() : FALLBACK_COLOR
}

/**
 * Duraklardan ve rota çizgilerinden GÖRSEL OLARAK ayrışan işaret: beyaz halka
 * içinde dolu bir çekirdek. Duraklar sıra numarası taşıyan daire/üçgen/kare,
 * rota ise çizgidir; araç hiçbirine benzemez ve en üstte durur.
 *
 * Yeni bir ikon kütüphanesi EKLENMEZ — projenin OpenLayers stil primitifleri
 * kullanılır (bkz. transport.js).
 */
function vehicleStyle(colorHex, live = true) {
  const color = safeColor(colorHex)
  const key = `${color}:${live ? 'live' : 'idle'}`
  if (!vehicleStyles.has(key)) {
    vehicleStyles.set(key, [
      new Style({
        image: new CircleStyle({
          radius: 15,
          fill: new Fill({ color: '#FFFFFFEE' }),
          stroke: new Stroke({ color, width: 3, lineDash: live ? undefined : [3, 3] }),
        }),
        zIndex: 60,
      }),
      new Style({
        image: new CircleStyle({
          radius: 7,
          fill: new Fill({ color }),
          stroke: new Stroke({ color: '#FFFFFF', width: 2 }),
        }),
        zIndex: 61,
      }),
    ])
  }
  return vehicleStyles.get(key)
}

/**
 * Aracın KENDİ katmanı. Ayrı olması bilinçlidir: durak/rota kaynakları
 * yeniden yüklenirken temizlenir ve araç onlarla birlikte silinmemelidir;
 * ayrıca isabet denetimi (hit detection) sırasında araç, mevcut durak/rota
 * sınıf adlarına göre ayırt edilebilir kalır.
 */
export function createTransportVehicleLayer() {
  const source = new VectorSource()
  const layer = new VectorLayer({
    source,
    className: TRANSPORT_VEHICLE_LAYER_CLASSNAME,
    // Durak (5-30) ve rota (0-22) zIndex aralıklarının ÜSTÜNDE.
    zIndex: 60,
    style: (feature) => vehicleStyle(feature.get('colorHex'), feature.get('isLive') !== false),
  })
  return { source, layer }
}

export function vehicleFeatureId(simulationId) {
  return `transport-vehicle-${simulationId}`
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/**
 * Ekranda araç olup olmayacağının TEK kuralı.
 *
 * <b>Sahiplik `followingRouteId`'dedir, `selectedRouteId`'de değil.</b>
 * Kullanıcı A rotasını takip ederken B rotasını inceleyebilir; araç ve kamera
 * A'ya aittir ve seçim değiştiği için kaybolmaz. Seçimi takip edilen rotaya
 * çekmek de bu modülün işi DEĞİLDİR.
 *
 * İki sahiplik vardır:
 * <ul>
 *   <li><b>follow</b> — kullanıcı bu rotayı açıkça takip ediyor; durum
 *       CANLIDIR ve kamera onu izler.</li>
 *   <li><b>start</b> — kullanıcı simülasyonu az önce başlattı ve o rota
 *       seçili. Araç, rotaya PASİF abone olunduğu sürece (bkz.
 *       <code>observedRouteId</code>) canlı akar; kamera ise ele
 *       GEÇİRİLMEZ. Abonelik yoksa yalnızca son bilinen konum durur ve canlı
 *       diye sunulmaz.</li>
 * </ul>
 *
 * <b>Canlılık ile kamera sahipliği ayrı sorulardır:</b> ilki aboneliğe,
 * ikincisi kullanıcının açık <i>Takip Et</i> eylemine bağlıdır.
 */
export function transportVehiclePresentation({
  simulation = null,
  followingRouteId = null,
  observedRouteId = null,
  selectedRouteId = null,
  startedSimulationId = null,
  routes = [],
} = {}) {
  if (!simulation) return null

  const routeId = finiteNumber(simulation.routeId)
  if (routeId === null) return null

  const following = finiteNumber(followingRouteId)
  const selected = finiteNumber(selectedRouteId)

  let ownership = null
  if (following !== null && following === routeId) {
    ownership = VEHICLE_OWNERSHIP.FOLLOW
  } else if (
    startedSimulationId
    && startedSimulationId === simulation.simulationId
    && selected !== null
    && selected === routeId
  ) {
    ownership = VEHICLE_OWNERSHIP.START
  }

  if (!ownership) return null

  const longitude = finiteNumber(simulation.longitude)
  const latitude = finiteNumber(simulation.latitude)
  if (longitude === null || latitude === null) return null

  const route = routes.find((candidate) => candidate?.id === routeId) ?? null
  const terminal = isTerminalSimulationStatus(simulation.status)
  const observed = finiteNumber(observedRouteId)
  // Takip zaten bir aboneliktir; izleme onun kamerasız kardeşidir.
  const subscribed = ownership === VEHICLE_OWNERSHIP.FOLLOW || (observed !== null && observed === routeId)

  return Object.freeze({
    simulationId: simulation.simulationId,
    routeId,
    routeName: route?.name ?? null,
    colorHex: safeColor(route?.colorHex),
    status: simulation.status,
    statusLabel: simulationStatusLabel(simulation.status),
    progressPercent: simulation.progressPercent,
    longitude,
    latitude,
    updatedAtUtc: simulation.updatedAtUtc ?? null,
    ownership,
    isTerminal: terminal,
    /* Canlı = rotanın yayınına ABONE olunuyor (takip ya da pasif izleme) VE
       çalıştırma henüz bitmemiş. Aboneliksiz bir REST anlık görüntüsünü
       canlıymış gibi göstermek kullanıcıyı yanıltırdı. */
    isLive: subscribed && !terminal,
    /* Kamera YALNIZCA açık takiple gelir. Başlatan kullanıcı aracı canlı
       görür ama görünüm onun elinde kalır. */
    followCamera: ownership === VEHICLE_OWNERSHIP.FOLLOW && !terminal,
  })
}

/**
 * Kaynakta HER ZAMAN en fazla bir araç feature'ı bırakır.
 *
 * Aynı çalıştırma sürerken feature yeniden YARATILMAZ, yalnızca geometrisi
 * güncellenir: her tick'te silip eklemek hem seçim/isabet durumunu hem de
 * olası bir açık popup'ın bağlandığı nesneyi koparırdı. Çalıştırma kimliği ya
 * da rota değişirse eski feature kaldırılır — hayalet araç kalmaz.
 *
 * @returns {import('ol/Feature.js').default|null} güncel feature
 */
export function syncTransportVehicleFeature(source, presentation) {
  if (!source) return null

  if (!presentation) {
    source.clear()
    return null
  }

  const coordinate = fromLonLat([presentation.longitude, presentation.latitude])
  const existing = source.getFeatureById(vehicleFeatureId(presentation.simulationId))

  // Kimliği eşleşmeyen her şey (eski çalıştırma, eski rota) gider.
  for (const feature of [...source.getFeatures()]) {
    if (feature !== existing) source.removeFeature(feature)
  }

  if (existing) {
    existing.getGeometry().setCoordinates(coordinate)
    existing.setProperties({
      routeId: presentation.routeId,
      routeName: presentation.routeName,
      colorHex: presentation.colorHex,
      isLive: presentation.isLive,
      transportVehicle: presentation,
    })
    return existing
  }

  const feature = new Feature({
    geometry: new Point(coordinate),
    featureKind: TRANSPORT_VEHICLE_KIND,
    type: TRANSPORT_VEHICLE_KIND,
    simulationId: presentation.simulationId,
    routeId: presentation.routeId,
    routeName: presentation.routeName,
    colorHex: presentation.colorHex,
    isLive: presentation.isLive,
    transportVehicle: presentation,
  })
  feature.setId(vehicleFeatureId(presentation.simulationId))
  source.addFeature(feature)
  return feature
}

/**
 * Popup'ın gösterdiği alanlar.
 *
 * Yüzde SUNUCUDAN gelir; tarayıcı onu yeniden hesaplamaz. Ham geometri, OSRM
 * adresi, altyapı ayrıntısı ve kullanıcı kimliği bilinçli olarak DIŞARIDADIR.
 */
/**
 * Verilen pikselde araç var mı?
 *
 * Isabet denetimi TEK yerde tanımlıdır; iki ekranın farklı sınıf adı ya da
 * tolerans kullanması, aracın birinde tıklanabilir diğerinde ölü olması
 * demekti. Durak/rota isabetleri bu fonksiyona hiç uğramaz ve olduğu gibi
 * kalır.
 */
export function findTransportVehicleAtPixel(map, pixel, hitTolerance = 10) {
  if (!map || !pixel) return null
  return map.forEachFeatureAtPixel(
    pixel,
    (feature, layer) => (
      layer?.getClassName?.().includes(TRANSPORT_VEHICLE_LAYER_CLASSNAME)
      && feature.get('featureKind') === TRANSPORT_VEHICLE_KIND
        ? feature
        : null
    ),
    { hitTolerance },
  ) ?? null
}

export function transportVehiclePopupModel(presentation) {
  if (!presentation) return null

  return Object.freeze({
    simulationId: presentation.simulationId,
    routeId: presentation.routeId,
    routeName: presentation.routeName ?? `Güzergah #${presentation.routeId}`,
    colorHex: presentation.colorHex,
    status: presentation.status,
    statusLabel: presentation.statusLabel,
    progressPercent: presentation.progressPercent,
    progressLabel: `%${Math.round(presentation.progressPercent)}`,
    isLive: presentation.isLive,
    liveLabel: presentation.isLive ? 'Canlı takip ediliyor' : 'Canlı takip kapalı',
    longitude: presentation.longitude,
    latitude: presentation.latitude,
  })
}

/**
 * Kameranın aracı görüşte tutması için gereken YENİ merkez; gerek yoksa
 * <code>null</code>.
 *
 * <b>Yakınlaştırma DÖNDÜRÜLMEZ.</b> Kullanıcının zoom'unu her tick'te geri
 * almak, haritayı elden çıkarmak demekti; kamera yalnızca kaydırır.
 * <b>Her tick'te de kaydırmaz:</b> araç ekranın orta güvenli kutusunun içinde
 * kaldığı sürece <code>null</code> döner, böylece animasyon kuyruğu ve
 * titreme oluşmaz.
 *
 * @param {number[]} coordinate aracın harita projeksiyonundaki konumu
 * @param {number[]} center görünümün mevcut merkezi
 * @param {number} resolution görünümün çözünürlüğü (harita birimi / piksel)
 * @param {number[]} size harita boyutu [genişlik, yükseklik] piksel
 * @param {number} edgeRatio güvenli kutunun ekrana oranı (0..1)
 */
export function vehicleCameraTarget({
  coordinate,
  center,
  resolution,
  size,
  edgeRatio = 0.35,
} = {}) {
  if (!Array.isArray(coordinate) || coordinate.length < 2) return null
  if (!Array.isArray(center) || center.length < 2) return null

  const pixelResolution = finiteNumber(resolution)
  const width = finiteNumber(size?.[0])
  const height = finiteNumber(size?.[1])

  // Ölçüyü bilmiyorsak merkeze almak tek güvenli davranıştır.
  if (pixelResolution === null || pixelResolution <= 0 || width === null || height === null) {
    return coordinate
  }

  const halfWidth = (width * pixelResolution * edgeRatio) / 2
  const halfHeight = (height * pixelResolution * edgeRatio) / 2

  const insideX = Math.abs(coordinate[0] - center[0]) <= halfWidth
  const insideY = Math.abs(coordinate[1] - center[1]) <= halfHeight

  return insideX && insideY ? null : coordinate
}
