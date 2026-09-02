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
  /* KULLANICININ AÇIK İZLEME SEÇİMİ (Faz 4A). Aynı anda BİRÇOK araç bu
     sahiplikle ekranda olabilir; kamera talep etmez ve seçimden bağımsızdır.
     "Seçili hattın aracı" ile karıştırılmamalıdır. */
  WATCH: 'watch',
  /* SEÇİLİ rotanın PASİF gözlemi. Kamera talep etmez ama aracı ekranda
     tutar: "Takibi Bırak" yalnızca kamerayı bırakır — aracı haritadan
     silmez. Bu sahiplik olmasaydı, takibi bırakan kullanıcı hâlâ seçili ve
     hâlâ çalışan bir hattın aracını kaybederdi. */
  OBSERVE: 'observe',
})

const FALLBACK_COLOR = '#2563EB'
const vehicleStyles = new Map()

/**
 * Araç VURGUSU: aynı anda birçok araç görünürken hangisinin bağlamda olduğunu
 * anlatır.
 *
 * <b>Vurgu GÖRÜNÜRLÜK değildir.</b> Seçim değiştiğinde hiçbir izlenen araç
 * kaybolmaz; yalnızca hangisinin öne çıktığı değişir. Bu yüzden kısık vurgu
 * "neredeyse görünmez" değil, okunabilir biçimde geri çekilmiş demektir.
 */
export const VEHICLE_EMPHASIS = Object.freeze({
  FULL: 'full',
  MUTED: 'muted',
})

/* Kısık vurgunun ölçüleri. Görsel kimlik BU FAZDA değişmez: aynı halka, aynı
   çekirdek, yalnızca saydamlık ve ölçek geri çekilir.

   Saydamlık RENGE yazılır, ayrı bir opaklık özelliğine değil: OpenLayers'ta
   `Style` bir opaklık seçeneği taşımaz ve daire sembolünde opaklığı ayrıca
   ayarlamak, stilin önbelleklenebilir saf bir değer olmaktan çıkması demekti.
   Sekiz haneli renk gösterimi (#RRGGBBAA) projenin zaten kullandığı biçimdir
   (bkz. halkanın #FFFFFFEE dolgusu). */
const MUTED_ALPHA = 'A6'
const MUTED_HALO_FILL = '#FFFFFF99'
const MUTED_CORE_STROKE = '#FFFFFFB3'
const MUTED_SCALE = 0.8

function withMutedAlpha(color) {
  return `${color}${MUTED_ALPHA}`
}

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
function vehicleStyle(colorHex, live = true, emphasis = VEHICLE_EMPHASIS.FULL) {
  const color = safeColor(colorHex)
  const muted = emphasis === VEHICLE_EMPHASIS.MUTED
  const key = `${color}:${live ? 'live' : 'idle'}:${muted ? 'muted' : 'full'}`

  if (!vehicleStyles.has(key)) {
    /* Kısık araçlar SEÇİLİ olanın ALTINDA çizilir: üst üste gelen iki araçta
       kullanıcının bağlamdaki olanı görmesi gerekir. */
    const zBase = muted ? 56 : 60
    const scale = muted ? MUTED_SCALE : 1
    const ring = muted ? withMutedAlpha(color) : color
    const core = muted ? withMutedAlpha(color) : color

    vehicleStyles.set(key, [
      new Style({
        image: new CircleStyle({
          radius: 15 * scale,
          fill: new Fill({ color: muted ? MUTED_HALO_FILL : '#FFFFFFEE' }),
          stroke: new Stroke({ color: ring, width: 3, lineDash: live ? undefined : [3, 3] }),
        }),
        zIndex: zBase,
      }),
      new Style({
        image: new CircleStyle({
          radius: 7 * scale,
          fill: new Fill({ color: core }),
          stroke: new Stroke({ color: muted ? MUTED_CORE_STROKE : '#FFFFFF', width: 2 }),
        }),
        zIndex: zBase + 1,
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
    style: (feature) => vehicleStyle(
      feature.get('colorHex'),
      feature.get('isLive') !== false,
      feature.get('emphasis') ?? VEHICLE_EMPHASIS.FULL,
    ),
  })
  return { source, layer }
}

/**
 * Araç feature'ının KİMLİĞİ: rota VE çalıştırma.
 *
 * <b>Yalnızca rota anahtarlamak yetmez</b> — A biter, aynı hatta B başlarsa
 * eski feature yeni çalıştırmanın kimliğini devralır ve haritada "hayalet"
 * bir süreklilik doğardı. <b>Yalnızca çalıştırma anahtarlamak da eksiktir:</b>
 * kimliğin hangi hatta ait olduğu feature'ın kendisinden okunabilmelidir;
 * uzlaştırma, tıklama ve balon aynı çifti kullanır.
 */
export function vehicleFeatureId(routeId, simulationId) {
  return `transport-vehicle-${routeId}-${simulationId}`
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

  const observed = finiteNumber(observedRouteId)

  /* Terminal olma durumu ownership'ten ÖNCE okunur: yalnızca PASİF GÖZLEM
     sahipliği ona bakar (aşağıda). Takip ve başlatma sahiplikleri kendi
     kabul edilmiş terminal davranışlarını KORUR. */
  const terminal = isTerminalSimulationStatus(simulation.status)

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
  } else if (observed !== null && observed === routeId && selected === routeId && !terminal) {
    /* PASİF GÖZLEM. Kullanıcı hattı seçmiş ve rotanın yayınına abone: araç
       görünür ve sunucunun anlık görüntülerinden hareket etmeye devam eder;
       yalnızca KAMERA onu izlemez. Sahiplik seçime de bağlıdır — bakılmayan
       bir hattın aracını haritada bırakmak yanıltıcı olurdu.

       YALNIZCA ÇALIŞAN (terminal olmayan) çalıştırma için geçerlidir ve bu
       şart zorunludur: GÖZLEM ÖMRÜ ile ARAÇ ÖMRÜ aynı şey değildir. Rota
       seçili kaldığı sürece abonelik sürer (yerine geçecek B'yi almak için),
       ama biten bir çalıştırmanın aracı sonsuza dek haritada durmamalıdır.
       Takip ve başlatma sahiplikleri kendi terminal kurallarını korur;
       burada genel bir "terminal ise gizle" kuralı YOKTUR.

       Duraklatma TERMİNAL DEĞİLDİR: duraklatılmış araç donmuş koordinatında
       görünmeye devam eder. */
    ownership = VEHICLE_OWNERSHIP.OBSERVE
  }

  if (!ownership) return null

  const longitude = finiteNumber(simulation.longitude)
  const latitude = finiteNumber(simulation.latitude)
  if (longitude === null || latitude === null) return null

  const route = routes.find((candidate) => candidate?.id === routeId) ?? null
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
    /* Tek araçlı sunumda vurgu her zaman TAMDIR: kısık vurgu ancak birden
       fazla izlenen araç varken bir şey anlatır. */
    isSelected: selected !== null && selected === routeId,
    emphasis: VEHICLE_EMPHASIS.FULL,
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
 * İZLENEN aktif çalıştırmaların araç sunumları (Faz 4A).
 *
 * <b>Görünürlüğün sahibi İZLEME SEÇİMİDİR</b> — seçim, takip ya da "en son ben
 * başlattım" değil. Kullanıcı aynı anda birçok hattı izleyebilir; hepsi
 * ekranda durur.
 *
 * <b>Kimlik eşleşmesi ZORUNLUDUR.</b> İzleme kaydı rota anahtarlıdır ama
 * DEĞERİ çalıştırma kimliğidir: A biter ve aynı hatta B başlarsa, B kullanıcının
 * hiç vermediği bir kararla izleniyor sayılamaz.
 *
 * <b>Canlılık ABONELİĞE bağlıdır.</b> Aktif küme sahipliği tüm aktif rotalara
 * abone olduğu için izlenen her araç normalde canlıdır; abonelik kurulamamışsa
 * araç canlı DİYE sunulmaz.
 *
 * <b>Vurgu SEÇİMDEN gelir</b> ve yalnızca vurgudur: seçim değiştiğinde hiçbir
 * araç kaybolmaz.
 *
 * <b>Kamera EN FAZLA bir araçtadır</b> ve yalnızca açık <i>Takip Et</i> ile
 * gelir. Takibi bırakmak hiçbir aracı silmez ve hiçbir veriyi dondurmaz.
 */
export function transportWatchedVehiclePresentations({
  byRoute = {},
  watchedRuns = {},
  selectedRouteId = null,
  followingRouteId = null,
  subscribedRouteIds = [],
  routes = [],
} = {}) {
  const selected = finiteNumber(selectedRouteId)
  const following = finiteNumber(followingRouteId)
  const subscribed = new Set(
    (Array.isArray(subscribedRouteIds) ? subscribedRouteIds : [])
      .map(finiteNumber)
      .filter((routeId) => routeId !== null),
  )

  const result = []

  for (const key of Object.keys(watchedRuns)) {
    const routeId = finiteNumber(key)
    if (routeId === null) continue

    const simulation = byRoute[routeId] ?? null
    if (!simulation) continue

    // Yerine geçen çalıştırma eski izleme niyetini DEVRALMAZ.
    if (simulation.simulationId !== watchedRuns[key]) continue

    // Biten çalıştırmanın aracı haritada BIRAKILMAZ.
    if (isTerminalSimulationStatus(simulation.status)) continue

    const longitude = finiteNumber(simulation.longitude)
    const latitude = finiteNumber(simulation.latitude)
    if (longitude === null || latitude === null) continue

    const route = routes.find((candidate) => finiteNumber(candidate?.id) === routeId) ?? null
    const isSelected = selected !== null && selected === routeId
    const isFollowed = following !== null && following === routeId

    result.push(Object.freeze({
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
      ownership: VEHICLE_OWNERSHIP.WATCH,
      isTerminal: false,
      isSelected,
      /* Duraklatılmış araç GÖRÜNÜR ve donmuş koordinatında durur: duraklatma
         terminal değildir ve "kayboldu" ile karıştırılmamalıdır. */
      isLive: subscribed.has(routeId),
      emphasis: isSelected ? VEHICLE_EMPHASIS.FULL : VEHICLE_EMPHASIS.MUTED,
      followCamera: isFollowed,
    }))
  }

  /* Sıra deterministiktir: aynı kümenin her render'da aynı dizilimi, feature
     uzlaştırmasında gereksiz farkları önler. */
  return result.sort((left, right) => left.routeId - right.routeId)
}

/**
 * BAŞLATANIN son konumu: yalnızca BİTMİŞ bir çalıştırma için (eski, kabul
 * edilmiş dar davranış).
 *
 * <b>Neden AYRI bir fonksiyon.</b> Bu sunum AKTİF araç koleksiyonuna AİT
 * DEĞİLDİR ve ona karışmamalıdır. Aynı fonksiyon hem "başlatanın bitmiş
 * çalıştırması" hem de "seçili hattın canlı aracı" üretmeye devam etseydi,
 * çizim listesi son satırda bir sahiplik dizesine göre süzülmek zorunda
 * kalırdı — yani sınır kodda değil, temizlikte kurulurdu. Sınır burada,
 * SUNUM DÜZEYİNDE kurulur.
 *
 * <b>ÇEKİRDEK KISIT: terminal olmayan çalıştırma ASLA döndürülmez.</b> Aktif
 * bir çalıştırmanın haritada görünmesinin TEK yolu İZLEME seçimidir; başlatma
 * sahipliği o kararın otoritesi değildir. Bu kısıt olmasaydı, kullanıcının az
 * önce başlattığı ama izlemediği hat sessizce çizilirdi.
 *
 * <b>Canlı DEĞİLDİR ve kamera TALEP ETMEZ.</b> Bitmiş bir çalıştırmanın
 * konumu bir kayıttır, bir yayın değil.
 */
export function transportStarterTerminalPresentation({
  simulation = null,
  startedSimulationId = null,
  selectedRouteId = null,
  routes = [],
} = {}) {
  if (!simulation) return null

  // Sahiplik ÇALIŞTIRMA kimliğindedir; rota kimliği tek başına yeterli değildir.
  if (!startedSimulationId || startedSimulationId !== simulation.simulationId) return null

  const routeId = finiteNumber(simulation.routeId)
  const selected = finiteNumber(selectedRouteId)
  if (routeId === null || selected === null || selected !== routeId) return null

  // AKTİF çalıştırma buradan ASLA çıkmaz.
  if (!isTerminalSimulationStatus(simulation.status)) return null

  const longitude = finiteNumber(simulation.longitude)
  const latitude = finiteNumber(simulation.latitude)
  if (longitude === null || latitude === null) return null

  const route = routes.find((candidate) => finiteNumber(candidate?.id) === routeId) ?? null

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
    ownership: VEHICLE_OWNERSHIP.START,
    isTerminal: true,
    isSelected: true,
    emphasis: VEHICLE_EMPHASIS.FULL,
    isLive: false,
    followCamera: false,
  })
}

/**
 * Kaynaktaki araç feature'larını İSTENEN kümeyle uzlaştırır.
 *
 * <b>Ekle / güncelle / kaldır — hepsi ANAHTAR üzerinden.</b> Feature'lar
 * biriktirilmez ve her karede silinip yeniden yaratılmaz: silip eklemek hem
 * isabet/seçim durumunu hem de açık bir balonun bağlandığı nesneyi koparır,
 * biriktirmek ise haritada ölü araçlar bırakırdı.
 *
 * <b>Anahtar rota + çalıştırmadır</b> (<code>vehicleFeatureId</code>): A biter
 * ve aynı hatta B başlarsa iki farklı anahtar oluşur, dolayısıyla eski
 * feature YAŞAYAMAZ.
 *
 * @returns {import('ol/Feature.js').default[]} güncel feature'lar
 */
export function syncTransportVehicleFeatures(source, presentations = []) {
  if (!source) return []

  const wanted = Array.isArray(presentations)
    ? presentations.filter(Boolean)
    : []

  const wantedIds = new Set(wanted.map((item) => vehicleFeatureId(item.routeId, item.simulationId)))

  // İstenmeyen her şey (biten çalıştırma, izlemeden çıkarılan hat) gider.
  for (const feature of [...source.getFeatures()]) {
    if (!wantedIds.has(feature.getId())) source.removeFeature(feature)
  }

  return wanted.map((presentation) => {
    const featureId = vehicleFeatureId(presentation.routeId, presentation.simulationId)
    const coordinate = fromLonLat([presentation.longitude, presentation.latitude])
    const existing = source.getFeatureById(featureId)

    const properties = {
      routeId: presentation.routeId,
      routeName: presentation.routeName,
      colorHex: presentation.colorHex,
      isLive: presentation.isLive,
      emphasis: presentation.emphasis ?? VEHICLE_EMPHASIS.FULL,
      transportVehicle: presentation,
    }

    if (existing) {
      // AYNI çalıştırma sürüyor: feature yeniden YARATILMAZ, taşınır.
      existing.getGeometry().setCoordinates(coordinate)
      existing.setProperties(properties)
      return existing
    }

    const feature = new Feature({
      geometry: new Point(coordinate),
      featureKind: TRANSPORT_VEHICLE_KIND,
      type: TRANSPORT_VEHICLE_KIND,
      simulationId: presentation.simulationId,
      ...properties,
    })
    feature.setId(featureId)
    source.addFeature(feature)
    return feature
  })
}

/**
 * TEK araç için uzlaştırma. Çoklu yolun bir kısaltmasıdır; ikinci bir
 * uygulama DEĞİLDİR.
 *
 * Yönetim ekranı (güzergah sayfası) hâlâ tek bir araç sunar; oradaki davranış
 * bu fazda değişmedi.
 *
 * @returns {import('ol/Feature.js').default|null} güncel feature
 */
export function syncTransportVehicleFeature(source, presentation) {
  const features = syncTransportVehicleFeatures(source, presentation ? [presentation] : [])
  return features[0] ?? null
}

/**
 * İki SUNUM kavramını tek bir çizim listesinde birleştirir.
 *
 * <b>Kavramlar AYRI kalır ve bu bilinçlidir.</b>
 * <ul>
 *   <li><code>watched</code> — AKTİF çalıştırmaların araçları. Görünürlüğün
 *       TEK sahibi kullanıcının İZLEME seçimidir.</li>
 *   <li><code>owned</code> — yalnızca TERMİNAL, canlı olmayan eski sunum
 *       (başlatanın son konumu). Buraya AKTİF bir çalıştırma giremez;
 *       <code>transportStarterTerminalPresentation</code> onu zaten üretmez.</li>
 * </ul>
 *
 * <b>Seçim, gözlem, aktif küme üyeliği ve başlatma sahipliği görünürlük
 * otoritesi DEĞİLDİR.</b> Bu fonksiyon bir süzgeç değil, iki AYRI kavramın
 * birleşimidir: sınır, sunumu üreten fonksiyonlarda kurulur, burada bir
 * sahiplik dizesine bakarak DEĞİL. Aynı çalıştırma ikisinde birden görünüyorsa
 * TEK feature üretilir; kimlik (rota + çalıştırma) tekilleştirmeyi yapar.
 */
export function mergeVehiclePresentations(watched = [], owned = null) {
  const list = Array.isArray(watched) ? watched.filter(Boolean) : []
  if (!owned) return list

  const duplicate = list.some(
    (item) => item.routeId === owned.routeId && item.simulationId === owned.simulationId,
  )

  return duplicate ? list : [...list, owned]
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
