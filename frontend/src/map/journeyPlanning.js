/**
 * Yolculuk planlayıcısının SAF çekirdeği.
 *
 * <b>Neden React'ten ayrı.</b> Kip geçişleri, geçiş noktası düzeni, doğrulama
 * ve istek eşlemesi bir DOM'a ihtiyaç duymaz; bileşenin içine gömülselerdi ne
 * testten ne de gözden geçirmeden geçebilirlerdi. Kanca (`useJourneyPlanner`)
 * yalnızca bu indirgeyiciyi React durumuna bağlar.
 *
 * <b>Backend otoritedir.</b> Buradaki doğrulama, garanti 400 alacak istekleri
 * yola çıkarmamak içindir; gerçek kural sunucudadır ve aynı isteği yeniden
 * uygular. Koordinat, geometri ve süre bu dosyada HİÇ üretilmez.
 */

/** Backend `JourneyContractNames` ile birebir aynı tel değerleri. */
export const JOURNEY_MODES = Object.freeze({
  ROUTE_FULL: 'routeFull',
  ROUTE_SEGMENT: 'routeSegment',
  WAYPOINTS: 'waypoints',
})

export const WAYPOINT_SOURCES = Object.freeze({
  STOP: 'transportStop',
  POI: 'poi',
})

/**
 * Desteklenen seyahat profilleri — TAM OLARAK üç tane.
 *
 * Otobüs/toplu taşıma KAPSAM DIŞIDIR: projede GTFS, transit grafiği veya
 * tarife altyapısı yoktur ve karayolu davranışıyla desteklenen sahte bir
 * otobüs seçeneği sunulmaz. Backend de `bus`'ı bilinmeyen profil olarak
 * reddeder.
 */
export const JOURNEY_PROFILES = Object.freeze([
  Object.freeze({ id: 'driving', label: 'Araç', icon: 'car' }),
  Object.freeze({ id: 'walking', label: 'Yürüyüş', icon: 'pedestrian' }),
  Object.freeze({ id: 'cycling', label: 'Bisiklet', icon: 'bicycle' }),
])

export const JOURNEY_PROFILE_IDS = Object.freeze(JOURNEY_PROFILES.map((profile) => profile.id))

export const DEFAULT_JOURNEY_PROFILE = 'driving'

/** Panelin ÜÇ ayrı durumu. Katlanmış, kapalı DEĞİLDİR. */
export const PANEL_STATES = Object.freeze({
  OPEN: 'open',
  COLLAPSED: 'collapsed',
  CLOSED: 'closed',
})

/** Geçiş noktasının plandaki rolü. */
export const WAYPOINT_ROLES = Object.freeze({
  ORIGIN: 'origin',
  VIA: 'via',
  DESTINATION: 'destination',
})

/** Backend `JourneyPlanningService.MaxWaypoints` ile aynı sınır. */
export const MAX_WAYPOINTS = 25

const MIN_WAYPOINTS = 2

export const JOURNEY_MESSAGES = Object.freeze({
  routeRequired: 'Önce bir hat seçin.',
  segmentStopsRequired: 'Başlangıç ve bitiş durağını seçin.',
  segmentStopsIdentical: 'Başlangıç ve bitiş durağı aynı olamaz.',
  waypointsRequired: 'En az bir başlangıç ve bir varış noktası seçin.',
  waypointsIncomplete: 'Eklenen tüm noktaları doldurun ya da boş olanları kaldırın.',
  waypointsTooMany: `Bir yolculukta en fazla ${MAX_WAYPOINTS} nokta olabilir.`,
  consecutiveDuplicate: 'Aynı noktayı arka arkaya iki kez seçemezsiniz.',
})

let waypointKeySeed = 0

/** Listede kararlı kimlik: dizin, yeniden sıralamada güvenilir bir anahtar değildir. */
function nextWaypointKey() {
  waypointKeySeed += 1
  return `wp-${waypointKeySeed}`
}

export function createWaypointSlot(reference = null) {
  return { key: nextWaypointKey(), reference }
}

/**
 * Bir geçiş noktası referansı: YALNIZCA kaynak + kimlik + gösterim adı.
 *
 * <b>Koordinat BİLİNÇLİ olarak taşınmaz.</b> Konumu sunucu çözer; tarayıcının
 * gönderdiği bir koordinat, silinmiş bir kaydın konumunu ya da hiç
 * kaydedilmemiş bir noktayı plana sokabilirdi. `label` yalnızca ekranda
 * gösterilir ve isteğe HİÇ girmez.
 */
export function waypointReference({ source, id, label = '', routeName = '' }) {
  return { source, id: Number(id), label, routeName }
}

export function initialJourneyPlannerState() {
  return {
    mode: JOURNEY_MODES.ROUTE_FULL,
    profile: DEFAULT_JOURNEY_PROFILE,
    routeId: null,
    fromStopId: null,
    toStopId: null,
    // Başlangıç ve varış her zaman vardır; aradakiler isteğe bağlıdır.
    waypoints: [createWaypointSlot(), createWaypointSlot()],
    panel: PANEL_STATES.OPEN,
    activeSlotKey: null,
  }
}

/* --- İndirgeyici --------------------------------------------------------------
   Her eylem YALNIZCA kendi alanına dokunur. Kip değişimi diğer kiplerin
   seçimlerini SİLMEZ: kullanıcı sekmeler arasında gezinip geri döndüğünde
   emeğini kaybetmemelidir. */

export function journeyPlannerReducer(state, action) {
  switch (action.type) {
    case 'setMode': {
      if (!Object.values(JOURNEY_MODES).includes(action.mode)) return state
      if (action.mode === state.mode) return state
      // Kip değişince silah bırakılır: yanlış yuvaya atama yapılmamalıdır.
      return { ...state, mode: action.mode, activeSlotKey: null }
    }

    case 'setProfile': {
      /* Bilinmeyen bir profil sessizce KABUL EDİLMEZ. Bu, otobüs gibi
         kaldırılmış bir değerin arayüze geri sızmasını engeller. */
      if (!JOURNEY_PROFILE_IDS.includes(action.profile)) return state
      return { ...state, profile: action.profile }
    }

    case 'setRoute': {
      const routeId = action.routeId == null ? null : Number(action.routeId)
      if (routeId === state.routeId) return state
      // Hat değişti: eski hattın durakları artık geçerli değildir.
      return { ...state, routeId, fromStopId: null, toStopId: null }
    }

    case 'setSegmentStop': {
      const value = action.stopId == null ? null : Number(action.stopId)
      if (action.end !== 'from' && action.end !== 'to') return state
      return { ...state, [action.end === 'from' ? 'fromStopId' : 'toStopId']: value }
    }

    case 'swapSegmentStops':
      // Ters seçim GEÇERLİDİR; yönü backend belirler, tarayıcı sıralama varsaymaz.
      return { ...state, fromStopId: state.toStopId, toStopId: state.fromStopId }

    case 'addWaypoint': {
      if (state.waypoints.length >= MAX_WAYPOINTS) return state
      const slot = createWaypointSlot()
      const next = [...state.waypoints]
      // Yeni nokta ARA noktadır: varıştan önce eklenir.
      next.splice(Math.max(1, next.length - 1), 0, slot)
      return { ...state, waypoints: next, activeSlotKey: slot.key }
    }

    case 'removeWaypoint': {
      const index = state.waypoints.findIndex((slot) => slot.key === action.key)
      // Başlangıç ve varış KALDIRILAMAZ; yalnızca boşaltılabilir.
      if (index <= 0 || index >= state.waypoints.length - 1) return state
      const waypoints = state.waypoints.filter((slot) => slot.key !== action.key)
      return {
        ...state,
        waypoints,
        activeSlotKey: state.activeSlotKey === action.key ? null : state.activeSlotKey,
      }
    }

    case 'moveWaypoint': {
      const from = state.waypoints.findIndex((slot) => slot.key === action.key)
      if (from < 0) return state
      const to = from + (action.direction === 'up' ? -1 : 1)
      /* Yalnızca ARA noktalar taşınabilir ve uçlar yerinde kalır: başlangıcın
         ya da varışın ortaya kayması, kullanıcının kastetmediği bir yolculuk
         üretirdi. */
      if (from <= 0 || from >= state.waypoints.length - 1) return state
      if (to <= 0 || to >= state.waypoints.length - 1) return state
      const waypoints = [...state.waypoints]
      const [moved] = waypoints.splice(from, 1)
      waypoints.splice(to, 0, moved)
      return { ...state, waypoints }
    }

    case 'assignWaypoint': {
      const index = state.waypoints.findIndex((slot) => slot.key === action.key)
      if (index < 0) return state
      const waypoints = [...state.waypoints]
      waypoints[index] = { ...waypoints[index], reference: action.reference ?? null }
      return {
        ...state,
        waypoints,
        // Atama yapıldı: silah kendiliğinden bırakılır.
        activeSlotKey: action.reference ? null : state.activeSlotKey,
      }
    }

    case 'armSlot': {
      if (action.key == null) return { ...state, activeSlotKey: null }
      return {
        ...state,
        // Aynı yuvaya tekrar basmak silahı bırakır.
        activeSlotKey: state.activeSlotKey === action.key ? null : action.key,
      }
    }

    case 'setPanel': {
      if (!Object.values(PANEL_STATES).includes(action.panel)) return state
      // Panel kapanınca harita seçimi de bırakılır; görünmeyen bir yuva doldurulmaz.
      const activeSlotKey = action.panel === PANEL_STATES.OPEN ? state.activeSlotKey : null
      return { ...state, panel: action.panel, activeSlotKey }
    }

    case 'reset': {
      /* Panel durumu KORUNUR: "Temizle" seçimleri siler, kullanıcının açtığı
         paneli kapatmaz. */
      return { ...initialJourneyPlannerState(), panel: state.panel, mode: state.mode, profile: state.profile }
    }

    default:
      return state
  }
}

/* --- Doğrulama ve istek eşlemesi --------------------------------------------- */

export function segmentSelectionIsValid(state) {
  if (state.routeId == null) return false
  if (state.fromStopId == null || state.toStopId == null) return false
  return state.fromStopId !== state.toStopId
}

/** Doldurulmuş geçiş noktaları, kullanıcının verdiği SIRAYLA. */
export function filledWaypoints(state) {
  return state.waypoints.filter((slot) => slot.reference != null).map((slot) => slot.reference)
}

/**
 * Planlayıcı durumunu backend `JourneyPlanRequest` gövdesine çevirir.
 *
 * <b>Gönderilenler yalnızca SEÇİMLERDİR.</b> Geometri, koordinat, PlanId veya
 * herhangi bir yönlendirme verisi isteğe girmez — sunucu her şeyi kendi
 * verisinden yeniden çözer.
 *
 * @returns {{ ok: boolean, request?: object, error?: string }}
 */
export function buildJourneyPreviewRequest(state) {
  const profile = JOURNEY_PROFILE_IDS.includes(state.profile) ? state.profile : DEFAULT_JOURNEY_PROFILE

  if (state.mode === JOURNEY_MODES.ROUTE_FULL) {
    if (state.routeId == null) return { ok: false, error: JOURNEY_MESSAGES.routeRequired }
    return { ok: true, request: { mode: JOURNEY_MODES.ROUTE_FULL, profile, routeId: state.routeId } }
  }

  if (state.mode === JOURNEY_MODES.ROUTE_SEGMENT) {
    if (state.routeId == null) return { ok: false, error: JOURNEY_MESSAGES.routeRequired }
    if (state.fromStopId == null || state.toStopId == null) {
      return { ok: false, error: JOURNEY_MESSAGES.segmentStopsRequired }
    }
    if (state.fromStopId === state.toStopId) {
      return { ok: false, error: JOURNEY_MESSAGES.segmentStopsIdentical }
    }
    return {
      ok: true,
      request: {
        mode: JOURNEY_MODES.ROUTE_SEGMENT,
        profile,
        routeId: state.routeId,
        fromStopId: state.fromStopId,
        toStopId: state.toStopId,
      },
    }
  }

  const references = filledWaypoints(state)

  if (references.length < MIN_WAYPOINTS) return { ok: false, error: JOURNEY_MESSAGES.waypointsRequired }

  /* Yarı dolu bir liste sessizce SIKIŞTIRILMAZ: boş bir ara noktayı atlayıp
     istek göndermek, kullanıcının eklediği ama doldurmadığı durağı yok
     saymak olurdu. */
  if (references.length !== state.waypoints.length) {
    return { ok: false, error: JOURNEY_MESSAGES.waypointsIncomplete }
  }

  if (references.length > MAX_WAYPOINTS) return { ok: false, error: JOURNEY_MESSAGES.waypointsTooMany }

  for (let index = 1; index < references.length; index += 1) {
    const previous = references[index - 1]
    const current = references[index]
    if (previous.source === current.source && previous.id === current.id) {
      return { ok: false, error: JOURNEY_MESSAGES.consecutiveDuplicate }
    }
  }

  return {
    ok: true,
    request: {
      mode: JOURNEY_MODES.WAYPOINTS,
      profile,
      // Sıra KORUNUR; `order` gönderilmez, dizinin kendi sırası yeterlidir.
      waypoints: references.map((reference) => ({
        source: reference.source,
        referenceId: reference.id,
      })),
    },
  }
}

/** Yuvanın plandaki rolü — yalnızca gösterim içindir. */
export function waypointRoleAt(index, total) {
  if (index === 0) return WAYPOINT_ROLES.ORIGIN
  if (index === total - 1) return WAYPOINT_ROLES.DESTINATION
  return WAYPOINT_ROLES.VIA
}
