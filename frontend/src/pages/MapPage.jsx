import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import 'ol/ol.css'
import Map from 'ol/Map'
import View from 'ol/View'
import { defaults as defaultControls, ScaleLine } from 'ol/control'
import { boundingExtent } from 'ol/extent'
import { fromLonLat, toLonLat } from 'ol/proj'
import { useAuth } from '../auth/AuthContext'
import { canManageAll, canManageDrawing } from '../auth/permissions.js'
import { usePermissions } from '../auth/permissionStore.js'
import { PERMISSIONS } from '../auth/permissionCodes.js'
import { useTransition } from '../transition/TransitionContext.jsx'
import {
  analyzeLocation,
  createPoi,
  deletePoi,
  fetchPoiCategories,
  readApiError,
  setConnectionHandler,
  updatePoi,
} from '../services/api'
import Sidebar from '../components/map/Sidebar.jsx'
import Topbar from '../components/map/Topbar.jsx'
import MapLoadingOverlay from '../components/map/MapLoadingOverlay.jsx'
import DrawToolbar from '../components/map/DrawToolbar.jsx'
import QuickActions from '../components/map/QuickActions.jsx'
import MapToasts from '../components/map/MapToasts.jsx'
import StylePanel from '../components/map/StylePanel.jsx'
import SelectedFeaturePanel from '../components/map/SelectedFeaturePanel.jsx'
import MultiSelectionPanel from '../components/map/MultiSelectionPanel.jsx'
import LayersPanel from '../components/map/LayersPanel.jsx'
import DrawingsPanel from '../components/map/DrawingsPanel.jsx'
import TrashPanel from '../components/map/TrashPanel.jsx'
import MyPoisPanel from '../components/map/MyPoisPanel.jsx'
import MyStopsPanel from '../components/map/MyStopsPanel.jsx'
import BasemapSelector from '../components/map/BasemapSelector.jsx'
import ConfirmDialog from '../components/map/ConfirmDialog.jsx'
import AttributePopup from '../components/map/AttributePopup.jsx'
import AnalysisPanel from '../components/map/AnalysisPanel.jsx'
import HeatmapPanel from '../components/map/HeatmapPanel.jsx'
import LocationAnalysisPanel from '../components/map/LocationAnalysisPanel.jsx'
import AnalysisPoiPopup from '../components/map/AnalysisPoiPopup.jsx'
import { SettingsPanel, AboutPanel } from '../components/map/InfoPanels.jsx'
import PoiFormSheet from '../components/map/PoiFormSheet.jsx'
import PoiInfoSheet from '../components/map/PoiInfoSheet.jsx'
import TransportStopForm from '../components/map/TransportStopForm.jsx'
import TransportStopEditForm from '../components/map/TransportStopEditForm.jsx'
import TransportStopPopup from '../components/map/TransportStopPopup.jsx'
import TransportVehiclePopup from '../components/map/TransportVehiclePopup.jsx'
import {
  DrawingHint,
  HoverTooltip,
  MeasurementReadout,
  SavingIndicator,
} from '../components/map/MapOverlays.jsx'
import JourneyPlannerPanel from '../components/map/JourneyPlannerPanel.jsx'
import JourneyVehiclePopup from '../components/map/JourneyVehiclePopup.jsx'
import useMediaQuery from '../hooks/useMediaQuery.js'
import useToasts from '../hooks/useToasts.js'
import useDrawingWorkspace from '../hooks/useDrawingWorkspace.js'
import useTrash from '../hooks/useTrash.js'
import useMyPois from '../hooks/useMyPois.js'
import useMyStops from '../hooks/useMyStops.js'
import useBasemap from '../hooks/useBasemap.js'
import useInventoryAnalysis from '../hooks/useInventoryAnalysis.js'
import useWorkspaceMode, { STYLE_PANEL_MODES } from '../hooks/useWorkspaceMode.js'
import useMapContext from '../hooks/useMapContext.js'
import {
  MAP_CONTEXTS,
  POI_CONTEXTS,
  SELECTION_CONTEXTS,
  SIDEBAR_CONTEXTS,
  TRANSPORT_STOP_CONTEXTS,
  sharesState,
} from '../map/mapContexts.js'
import useWorkspacePermissions from '../hooks/useWorkspacePermissions.js'
import useGeographicScope from '../hooks/useGeographicScope.js'
import useGeographicScopeLayer from '../hooks/useGeographicScopeLayer.js'
import useMapView, { TURKEY_CENTER_LON_LAT, TURKEY_ZOOM } from '../hooks/useMapView.js'
import useMeasurement from '../hooks/useMeasurement.js'
import useFeatureInteraction from '../hooks/useFeatureInteraction.js'
import useSelectionTools from '../hooks/useSelectionTools.js'
import useKeyboardShortcuts from '../hooks/useKeyboardShortcuts.js'
import useGeometryEditing, { GEOMETRY_EDIT_MODES } from '../hooks/useGeometryEditing.js'
import useEditSession from '../hooks/useEditSession.js'
import useVertexOverlay from '../hooks/useVertexOverlay.js'
import useAnalysisHighlight from '../hooks/useAnalysisHighlight.js'
import useHeatmapLayer from '../hooks/useHeatmapLayer.js'
import useLocationAnalysisArea from '../hooks/useLocationAnalysisArea.js'
import useLocationAnalysisLayer from '../hooks/useLocationAnalysisLayer.js'
import useLocationAnalysisPoiLayer from '../hooks/useLocationAnalysisPoiLayer.js'
import useLocationAnalysisPoiInspect from '../hooks/useLocationAnalysisPoiInspect.js'
import useLocationAnalysisTargetCatalog from '../hooks/useLocationAnalysisTargetCatalog.js'
import useMapPresentationLayer from '../hooks/useMapPresentationLayer.js'
import usePoiLayer from '../hooks/usePoiLayer.js'
import usePoiPresentationLayer from '../hooks/usePoiPresentationLayer.js'
import useLayerVisibility from '../hooks/useLayerVisibility.js'
import PoiSearchBar from '../components/map/PoiSearchBar.jsx'
import usePoiPlacement from '../hooks/usePoiPlacement.js'
import usePoiInteraction from '../hooks/usePoiInteraction.js'
import usePoiSearch from '../hooks/usePoiSearch.js'
import usePoiEditDraft from '../hooks/usePoiEditDraft.js'
import useTransportLayer from '../hooks/useTransportLayer.js'
import useTransportSimulation from '../hooks/useTransportSimulation.js'
import useTransportVehicleLayer from '../hooks/useTransportVehicleLayer.js'
import {
  sharedStopIntent,
  sharedStopIntentIsCurrent,
  transportSimulationControls,
} from '../map/transportSimulationState.js'
import {
  JOURNEY_PRODUCTS,
  canOpenJourneyWorkspace,
  journeyProductTabs,
  resolveJourneyProduct,
  sharedJourneyPresentation,
} from '../map/journeyWorkspace.js'
import {
  mergeVehiclePresentations,
  transportStarterTerminalPresentation,
  transportVehiclePopupModel,
  transportWatchedVehiclePresentations,
} from '../map/transportVehicle.js'
import {
  LIFECYCLE_OPERATIONS,
  activeSimulationsPresentation,
  lifecycleIntent,
} from '../map/activeSimulations.js'
import { sharedNavigationPresentation } from '../map/sharedNavigation.js'

/** Yıkıcı yaşam döngüsü işlemleri ONAY ister; duraklat/sürdür istemez. */
const isDestructiveLifecycleOperation = (operation) =>
  operation === LIFECYCLE_OPERATIONS.RESET || operation === LIFECYCLE_OPERATIONS.RESTART
import {
  journeyDisplayGeometryWkt,
  journeyStatusIndicator,
  journeyVehiclePopupModel,
} from '../map/journeySimulationState.js'
import { JOURNEY_COMPACT_QUERY } from '../map/journeyLayout.js'
import useTransportStopPlacement from '../hooks/useTransportStopPlacement.js'
import useTransportStopInteraction from '../hooks/useTransportStopInteraction.js'
import useJourneyPlanner from '../hooks/useJourneyPlanner.js'
import useJourneyPreviewLayer from '../hooks/useJourneyPreviewLayer.js'
import useJourneyWaypointPicking from '../hooks/useJourneyWaypointPicking.js'
import useJourneySimulation from '../hooks/useJourneySimulation.js'
import useSavedJourneys from '../hooks/useSavedJourneys.js'
import useJourneyHistory from '../hooks/useJourneyHistory.js'
import JourneyNameDialog from '../components/map/JourneyNameDialog.jsx'
import { savedJourneyDraft, savedJourneyTarget } from '../map/savedJourneys.js'
import { journeyHistoryDraft } from '../map/journeyHistory.js'
import { PANEL_STATES, PERSONAL_SECTIONS } from '../map/journeyPlanning.js'
import useJourneyVehicleLayer from '../hooks/useJourneyVehicleLayer.js'
import useJourneyWaypointLayer from '../hooks/useJourneyWaypointLayer.js'
import useTransportStopRelocation from '../hooks/useTransportStopRelocation.js'
import { createTransportStop, deleteTransportStop, updateTransportStop } from '../services/transportApi.js'
import { deleteStopThenMaybeGenerate, persistStopThenMaybeGenerate } from '../services/transportStopWorkflow.js'
import { DRAWING_TYPES, DRAWING_TYPE_LIST, colorPatchFor, normalizeTags } from '../map/drawingTypes.js'
import { trashRecordOf } from '../map/trashFilters.js'
import {
  categoryIndex,
  isDescendantOf,
  MAX_CRITERIA,
  MIN_CRITERIA,
  emptyCriterion,
  toRequestCriteria,
  validateAnalysis,
} from '../map/locationAnalysis.js'
import {
  buildPoiCategoryTree,
  drawingGroups as layerDrawingGroups,
  recordRows,
} from '../map/layerManager.js'
import {
  drawingIdentities,
  drawingVisibilityState,
  hideRecords,
  isRecordVisible,
  showRecords,
  visibilityState,
} from '../map/layerVisibility.js'
import { isGeometryInsideScope } from '../map/geographicScope.js'
import {
  formatArea,
  formatLength,
  formatLonLat,
  measureArea,
  measureLength,
  measurePerimeter,
} from '../map/measure.js'
import './MapPage.css'

const MAP_READY_FALLBACK_MS = 2500

/** Katlama tercihlerinin localStorage anahtarları. */
const SIDEBAR_COLLAPSE_KEY = 'map.sidebarCollapsed'
const TOOLBAR_COLLAPSE_KEY = 'map.toolbarCollapsed'

/**
 * Katlama tercihini okur. Erişim başarısız olursa AÇIK kabul edilir: bir
 * kontrolü gizlemek, göstermekten daha riskli bir varsayılandır.
 */
function readCollapsePreference(key) {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeCollapsePreference(key, value) {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* Depolama yoksa tercih yalnızca bu oturumda yaşar; hata gösterilmez —
       kullanıcının düzeltebileceği bir şey değildir. */
  }
}

function formatRemaining(expiresAt) {
  if (!expiresAt) return ''
  const diffMs = new Date(expiresAt).getTime() - Date.now()
  if (diffMs <= 0) return '00:00'
  const totalSeconds = Math.floor(diffMs / 1000)
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

export default function MapPage() {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const { logout, expiresAt, username, isAdmin, userId } = useAuth()
  const { can, canAll } = usePermissions()
  const { reportMapReady, isIdle } = useTransition()
  const navigate = useNavigate()
  const location = useLocation()

  const [remaining, setRemaining] = useState(() => formatRemaining(expiresAt))
  const [mapReady, setMapReady] = useState(false)
  /* Panel katlama tercihleri OTURUMLAR ARASI hatırlanır. Kişi kenar çubuğunu
     her açılışta yeniden kapatmak zorunda kalmamalıdır. Depolama erişilemezse
     (özel mod, kapalı çerezler) varsayılana düşülür — tercih bir kolaylıktır,
     uygulamanın çalışması ona bağlanmaz. */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readCollapsePreference(SIDEBAR_COLLAPSE_KEY))
  const [toolbarCollapsed, setToolbarCollapsed] = useState(() => readCollapsePreference(TOOLBAR_COLLAPSE_KEY))
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  /** "Yetki Alanım" katmanının görünürlüğü. Katman salt görselleştirmedir. */
  const [scopeLayerVisible, setScopeLayerVisible] = useState(true)
  const [heatmapEnabled, setHeatmapEnabled] = useState(false)
  // Exposed as state (not just a ref) so the drawing hook re-runs when the map
  // instance is actually created or torn down, StrictMode double-mount included.
  const [mapInstance, setMapInstance] = useState(null)

  /* --- Harita bağlam sahipliği ---------------------------------------------

     Eskiden her bağlamsal panel kendi açık/kapalı durumunu tutuyordu
     (`activePanel`, `styleTarget`, seçim sayısı, `selectedPoi`, analiz
     sonucu) ve hiçbiri diğerini bilmiyordu; bu yüzden bir panel açıkken başka
     bir bağlama geçmek eskisini ekranda bırakıyordu.

     Artık TEK bir sahip vardır: `mapContext`. Bir bağlam etkinleştiğinde
     önceki kendiliğinden emekliye ayrılır. Hiçbir tıklama işleyicisi başka bir
     panelin setter'ını tanımaz — yeni bir panel eklemek mevcut panellerin
     hiçbirine dokunmayı gerektirmez.

     Emeklilik yalnızca PANEL durumunu bırakır; altındaki harita özelliğini
     kapatmaz (bkz. `contextRetirers` ve ısı haritası). */

  /* Emeklilik tablosu, çağrılarının tanımlarından ÖNCE hook'a verilmelidir;
     bu yüzden kimliği sabit bir nesnedir ve içeriği render sonunda yerinde
     tazelenir (aşağıdaki Object.assign). Tablonun kendisini değiştirmek,
     hook'un elindeki referansı eskitirdi. */
  const contextRetirers = useRef({})
  const mapContext = useMapContext(contextRetirers.current)

  /** What the style panel is editing: null | 'tool' | 'feature' | 'bulk'. */
  const [styleTarget, setStyleTarget] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  /** Non-null while the trash is asking whether to reopen a deleted drawing. */
  const [pendingRestore, setPendingRestore] = useState(null)

  // Hover tooltips and letter shortcuts only make sense with a real pointer
  // and a physical keyboard; on touch devices tap-to-select is the interaction.
  const hasFinePointer = useMediaQuery('(hover: hover) and (pointer: fine)')

  const { toasts, showToast, dismissToast } = useToasts()

  // ONE source of truth for what the map is currently doing. Every interaction
  // below is created from it, and the toolbar and style panel both render from
  // it — so the bar, the panel and the OpenLayers interaction cannot disagree.
  const workspaceMode = useWorkspaceMode()

  /* Yetki katmanı modun ÜSTÜNDE durur, yanına ikinci bir araç durumu koymaz.
     Yetkisiz bir aracın hem açılmasını engeller hem de yetki harita açıkken
     kaldırıldığında çalışan etkileşimi söker — düğmeyi gizlemek tek başına
     OpenLayers etkileşimini durdurmazdı. */
  const allowed = useWorkspacePermissions(workspaceMode)

  /**
   * Çalışma alanının DİNLENME durumu: sıradan tekli seçim.
   *
   * Yolculuk noktası seçimi de bir etkileşim ailesidir ve yalnızca burada
   * silahlanabilir. Kutu/alan seçimi de dışarıdadır: ikisi de canlı bir
   * sürükleme/çizim etkileşimidir, dolayısıyla "sıradan tıklama" değildir.
   */
  const workspaceAtRest =
    workspaceMode.isSelecting && workspaceMode.activeSelectionTool === 'single'

  /* --- Yolculuk planlayıcısı durumu (Faz 5C) ---------------------------------
     Kancanın KENDİSİ burada, haritanın tıklama sahipliğini kuran kancalardan
     ÖNCE çağrılır: `journey.isPicking` aşağıdaki her etkileşim kapısının
     girdisidir ve "bir sonraki tıklama ne yapar" sorusunun tek cevabı odur.
     Haritaya dokunan yolculuk kancaları (önizleme katmanı, nokta seçimi, canlı
     simülasyon) yerlerinde, aşağıda kalır. */
  const journey = useJourneyPlanner({
    /* ÜRÜN kapısı: kişisel yolculuk kendi yetkisini okur. `transport.view`
       DEĞİLDİR — ulaşım ağını izleyebilen herkesin kişisel yolculuk da
       kullanabildiği varsayımı bilinçli olarak kaldırıldı. */
    permitted: allowed.canUseJourney,
    /* Hat tabanlı kipler ulaşım ağına erişim ister ve bu AYRI bir yetkidir;
       yetkisi olmayana yalnızca serbest nokta kipi sunulur. */
    canUseTransport: allowed.canViewTransport,
    workspaceAtRest,
  })

  /* --- Çalışma alanı ürünleri (Faz 2) -----------------------------------------
     Çalışma alanı TEK bir paneldir ama İKİ ürünü sunar; ürünlerin kendileri
     teknik olarak ayrı kalır (ayrı servis, ayrı hub, ayrı depo). Hangi ürünün
     sunulacağına saf `journeyWorkspace` modülü karar verir; burada yalnızca
     etkin yetkiler ona verilir. Rol adı, kullanıcı adı ya da yönetici bayrağı
     hiçbir yerde okunmaz. */
  const journeyCapabilities = useMemo(() => ({
    canUseJourney: allowed.canUseJourney,
    canViewTransport: allowed.canViewTransport,
  }), [allowed.canUseJourney, allowed.canViewTransport])

  /* Kısayol EN AZ BİR ürünle görünür. Bu bir yetki genişletmesi DEĞİLDİR:
     içerideki her bölüm kendi yetkisini ayrıca ister ve bağlayıcı denetim
     backend'dedir. */
  const canOpenJourney = canOpenJourneyWorkspace(journeyCapabilities)

  /* Kullanıcının erişemediği bir ürün seçili kalırsa boş panel çizilmez:
     erişilen ürüne indirgenir. Yetki anında değiştiğinde de doğru kalır. */
  const journeyProduct = resolveJourneyProduct({
    requested: journey.state.product,
    ...journeyCapabilities,
  })

  const journeyProductOptions = useMemo(
    () => journeyProductTabs(journeyCapabilities),
    [journeyCapabilities],
  )

  /* --- Panel sahipliği (Faz 5E-B · Dilim 4) ----------------------------------
     Yolculuk paneli sol üstte analiz paneliyle AYNI yeri kaplar. Bu yüzden
     mevcut KOORDİNATÖRE katılır: bir birincil bağlam açıldığında panel çekilir,
     panel açıldığında diğeri emekliye ayrılır. İkinci bir koordinatör
     kurulmaz.

     Devredilen şey YALNIZCA paneldir. Emeklilik `closePanel` çağırır — bu bir
     SUNUM durumudur: çalışan simülasyon, terminal sonuç ve plan seçimleri
     olduğu gibi kalır, yeniden açıldığında panel doğru içeriği gösterir. */
  const openJourneyPanel = useCallback(() => {
    journey.openPanel()
    mapContext.activate(MAP_CONTEXTS.journey)
  }, [journey, mapContext])

  /* Belirli bir ÜRÜNLE açmak: haritadan bir hatta tıklamak çalışma alanını
     paylaşılan bağlamda açar. Yalnızca SUNUM değişir — hiçbir simülasyon
     başlamaz, hiçbir kamera talep edilmez. */
  const openJourneyWorkspaceWith = useCallback((product) => {
    journey.setProduct(product)
    journey.openPanel()
    mapContext.activate(MAP_CONTEXTS.journey)
  }, [journey, mapContext])

  const closeJourneyPanel = useCallback(() => {
    // Kapatma da koordinatörden geçer: sahiplik bırakılmadan panel gizlenmez.
    mapContext.close(MAP_CONTEXTS.journey)
    journey.closePanel()
  }, [journey, mapContext])

  /* Katlanmış panel HÂLÂ görünürdür ve aynı köşeyi kaplar; sahipliği bırakmaz. */
  const toggleJourneyPanel = useCallback(() => {
    if (journey.state.panel === 'closed') openJourneyPanel()
    else closeJourneyPanel()
  }, [journey.state.panel, openJourneyPanel, closeJourneyPanel])

  /* Görünür panel, sahipliği de TAŞIR. Açılış durumu (panel açık, henüz
     hiçbir bağlam etkin değil) tek istisnadır; sahiplik burada devralınır ki
     ardından açılan bir birincil bağlam paneli gerçekten emekliye ayırabilsin.
     Döngü yoktur: sahiplik alındıktan sonra koşul sağlanmaz, panel bir başkası
     devraldığında ise emeklilikle KAPANIR ve koşul yine sağlanmaz. */
  useEffect(() => {
    if (journey.state.panel === 'closed') return
    if (mapContext.active !== null) return
    mapContext.activate(MAP_CONTEXTS.journey)
  }, [journey.state.panel, mapContext])

  /* Düzenin TEK ölçütü görüntü alanı genişliğidir; işaretçi yeteneği değil.
     Sorgu, CSS'teki kesme noktasının birebir aynısıdır (`journeyLayout.js`). */
  const journeyCompact = useMediaQuery(JOURNEY_COMPACT_QUERY)

  // Declared before the drawing workspace because saving a polygon feeds
  // straight into it: one analysis engine serves both the temporary tool and
  // the automatic run after a polygon record is created.
  const analysis = useInventoryAnalysis(mapInstance, {
    active: Boolean(workspaceMode.activeAnalysisTool) && allowed.canAnalyze,
    showToast,
  })
  const { analyzeSaved } = analysis

  /**
   * Kaydedilen poligonun otomatik analizi de bir BAĞLAM AÇAR.
   *
   * Sonuç paneli ekranda belirirken çakışan bağlam (seçili kayıt paneli, POI
   * bilgisi, ısı haritası paneli …) koordinatör üzerinden kapanır; panelin
   * kendisi başkalarını tanımaz.
   */
  const analyzeSavedWithContext = useCallback(
    (record) => {
      mapContext.activate(MAP_CONTEXTS.inventory)
      return analyzeSaved(record)
    },
    [analyzeSaved, mapContext],
  )

  /* Kullanıcının KENDİ coğrafi sınırı. Kapsam CANLI okunur ve JWT'de taşınmaz;
     yönetici bir alanı daralttığında yeniden giriş gerekmez.

     Bu bir güvenlik sınırı DEĞİLDİR: uç hiç çağrılmasa bile çizim uçları kendi
     coğrafi denetimini uygular. Buradaki veri, sınırı haritada göstermek ve
     izinsiz bir çizimi BAŞLAMADAN durdurmak içindir. */
  const geographic = useGeographicScope()

  // Sınır, kullanıcının kendi çizimlerinin ALTINDA duran ayrı bir katmandır.
  useGeographicScopeLayer(mapInstance, {
    scope: geographic.scope,
    visible: scopeLayerVisible,
  })

  const canUseHeatmap = can(PERMISSIONS.HEATMAP_VIEW)

  /* Çöp Kutusu, geri yükleyebileceği bir şeyi olan herkese açıktır: çizim
     yarısı için drawings.view + drawings.restore, POI yarısı için poi.view +
     (poi.delete ya da poi.manage). Yalnızca birine sahip olmak paneli açmaya
     yeter — açılan panel diğer yarıyı zaten hiç istemez. */
  const canOpenTrash = (allowed.canViewDrawings && allowed.canRestoreDrawings)
    || allowed.canRestorePoi
    || (allowed.canViewTransport && (allowed.canRestoreTransportStop || allowed.canRestoreTransportRoute))

  /* "POI'lerim" yalnızca `poi.view` ister: kendi kayıtlarını görebilmek ayrı
     bir yetenek değildir. Yönetim yetkileri (poi.manage / poi.categories.manage)
     İSTENMEZ — uç zaten yalnızca çağıranın kendi kayıtlarını döndürür. */
  const canOpenMyPois = allowed.canViewPoi
  const canOpenMyStops = allowed.canViewTransport
  const heatmap = useHeatmapLayer(mapInstance, {
    enabled: heatmapEnabled,
    permitted: canUseHeatmap,
    scopeVersion: `${geographic.areaCount}:${geographic.effectiveWkt ?? ''}`,
  })


  /* Canlı yetki yenilemesi bu ekran açıkken erişimi kaldırabilir. Katmanı
     sökmek hook'un, artık erişilemeyen paneli kapatmak bu sayfanın işidir. */
  useEffect(() => {
    if (canUseHeatmap) return
    setHeatmapEnabled(false)
    // Panel sahipliği bağlam koordinatöründedir; yalnızca ısı haritası
    // açıksa kapanır, başka bir bağlam devraldıysa ona dokunulmaz.
    mapContext.close(MAP_CONTEXTS.heatmap)
  }, [canUseHeatmap, mapContext])

  /* Phase 5 köprüsü. Hangi türün NORMAL görünümünü artık sunucu tarafında
     üretilen WMS görüntüsünün çizdiğini tutar. Ref'tir çünkü cevabı okuyan
     yer OpenLayers'ın stil fonksiyonudur ve o React render'ının dışında
     çalışır; bir state, görüntü yerine oturduğu anda değil bir render sonra
     görünürdü ve çizim bir kare boyunca iki kez boyanırdı. */
  const presentationActiveRef = useRef({ point: false, line: false, polygon: false })

  /* POI'nin aynı köprüsü. Ayrı bir ref'tir çünkü POI bir çizim değildir: kendi
     yetkisi (`poi.view`), kendi katmanı ve kendi tazeleme sayacı vardır ve
     çizim türlerinin görünürlük/askıya alma kavramlarının hiçbirini
     paylaşmaz. */
  const poiPresentationActiveRef = useRef(false)

  /* Kalıcı POI görüntüsünün tazelenmesi gereken durumların sayacı. Yalnızca
     BAŞARILI bir mutasyondan sonra artar — gönderilmiş ama yazılmamış bir
     değişiklik için görüntü yenilenmez. Çizim tarafındaki
     `presentationVersion` ile aynı sözleşme. */
  const [poiPresentationVersion, setPoiPresentationVersion] = useState(0)

  const layerVisibility = useLayerVisibility()

  /* Konum analizi normal POI görünürlüğünü DEĞİŞTİRMEZ; yalnızca sonuç
     oturumu boyunca bastırır. Böylece Temizle, kullanıcının analizden önceki
     tercihini (açık ya da kapalı) kendiliğinden geri getirir. Ayrı bayrak,
     taslak değişirken ve analiz yeniden çalışırken normal POI'lerin bir kare
     için bile geri parlamasını önler. */
  const [activeAnalysis, setActiveAnalysis] = useState(null)
  const [locationAnalysisResultActive, setLocationAnalysisResultActive] = useState(false)

  /**
   * POI arama kutusunun açıklığı.
   *
   * <b>Varsayılan KAPALI.</b> Arama sürekli duran bir kutu değil, istendiğinde
   * açılan bir araçtır; haritanın üstünü kalıcı olarak işgal etmesi için bir
   * sebep yok. Kapalıyken bileşen HİÇ monte edilmez, dolayısıyla hiçbir arama
   * isteği de açılmaz.
   */
  const [poiSearchOpen, setPoiSearchOpen] = useState(false)

  /* Kapanışta odak, aramayı açan düğmeye geri döner: klavyeyle çalışan biri
     kapattığı anda odağı belgenin başına kaybetmemelidir. */
  const poiSearchButtonRef = useRef(null)

  const togglePoiSearch = useCallback(() => {
    setPoiSearchOpen((current) => !current)
  }, [])

  const closePoiSearch = useCallback(() => {
    setPoiSearchOpen(false)
    poiSearchButtonRef.current?.focus()
  }, [])
  const invalidatePoiPresentation = useCallback(
    () => setPoiPresentationVersion((value) => value + 1),
    [],
  )

  const workspace = useDrawingWorkspace(mapInstance, {
    showToast,
    dismissToast,
    activeDrawTool: workspaceMode.activeDrawTool,
    canViewDrawings: allowed.canViewDrawings,
    /* Geri/ileri al adım BAZINDA denetlenir: her komutun iki yönü de gerçek
       birer API mutasyonudur ve farklı yetkiler isteyebilir (bir silmeyi geri
       almak `drawings.restore` ister, ileri almak `drawings.delete`). */
    hasPermissions: canAll,
    /* Poligon kaydedildikten sonra çalışan OTOMATİK analiz, yetki YOKSA hiç
       başlatılmaz — istek gönderilip 403 yutulmaz. Yetkisiz kullanıcı, sıradan
       bir poligon çizdiği için "Analiz yapılamadı (HTTP 403)" görmemelidir;
       istemediği bir işin hatası ona ait değildir.

       Kapı çağrıdan ÖNCEdir ve merkezî yetki durumundan okunur; rol adına
       bakan hiçbir kural yoktur. Açık "Envanter" aracı kendi kapısını zaten
       taşır (bkz. yukarıdaki `active`), dolayısıyla yetkili kullanıcının
       bilerek başlattığı analiz etkilenmez. Çizim akışının geri kalanı —
       AttributePopup, kaydetme, coğrafi denetim — değişmez. */
    onPolygonSaved: allowed.canAnalyze ? analyzeSavedWithContext : null,
    /* Alan dışı bir tık köşe olarak EKLENMEZ ve alan dışı kalan bir çizim
       için AttributePopup hiç açılmaz. */
    geographicScope: geographic.scope,
    /* Sunucu coğrafi bir ret döndürürse tarayıcının sınırı eskimiş demektir. */
    onForbidden: geographic.refresh,
    presentationActiveRef,
    hiddenDrawingIds: layerVisibility.hiddenDrawingIds,
  })

  /* Hangi türlerin sunum görüntüsü, KAYDEDİLMEMİŞ yerel değişiklik yüzünden
     geçici olarak devre dışı bırakılmalı.

     Sunum görüntüsü VERİTABANINDAKİ hâli gösterir ve düzenleme sırasında bu
     doğru olmaya devam eder — ama kullanıcının baktığı şey artık o değildir.
     Görüntü kaldırılmazsa taşınan/yeniden renklendirilen çizimin eski hâli
     hayalet bir kopya olarak ekranda kalır. Bu yüzden yalnızca ilgili TÜR
     askıya alınır: nokta düzenlerken çizgi ve poligon sunumu yerinde kalır.

     Katman görünürlüğüyle karıştırılmaz: biri kullanıcının kapattığı katman,
     diğeri geçici bir düzenleme durumudur. */
  const presentationSuspendedTypes = useMemo(() => {
    const individuallyFiltered = new Set(
      [...layerVisibility.hiddenDrawingIds].map((identity) => identity.split(':')[0]),
    )
    /* Geometri oturumu: Modify ve Translate aynı oturumdan yürür, dolayısıyla
       ikisi de aynı askıya alma yaşam döngüsünü kullanır. */
    if (workspaceMode.isEditing && workspace.selectedFeature) {
      individuallyFiltered.add(workspace.selectedFeature.type)
      return [...individuallyFiltered]
    }

    /* Stil paneli canlı ÖNİZLEME yapar (`previewStyle`) ve önizleme henüz
       kaydedilmemiştir; kayıtlı renkli görüntü altta durursa eski ve yeni renk
       üst üste biner. Araç stili ('tool') hiçbir kaydı önizlemez. */
    if (styleTarget === 'feature' || styleTarget === 'bulk') {
      for (const item of workspace.selectedFeatures) individuallyFiltered.add(item.type)
      return [...individuallyFiltered]
    }

    return [...individuallyFiltered]
  }, [
    workspaceMode.isEditing,
    workspace.selectedFeature,
    workspace.selectedFeatures,
    styleTarget,
    layerVisibility.hiddenDrawingIds,
  ])

  /* Kalıcı çizimlerin GENEL GÖSTERİMİ: kimlik doğrulamalı WMS görüntüsü.
     Etkileşim (seçim, popup, düzenleme, taşıma, kutu/poligon seçimi) WFS
     vektörleri üzerinde kalır — bu katman yalnızca görünümü devralır.

     Yetki, çizim VERİSİNİ görme yetkisiyle aynıdır (`drawings.view`): harita
     `map.view` ile açılır ama kayıtlı çizimlerin görüntüsü ayrı bir yetkidir
     ve backend aynı yetkiyi bağımsız olarak yeniden arar. */
  /* Dönüş değeri KULLANILMAZ ve bu bilinçlidir: sunum görüntüsü yüklenemezse
     vektörler kendi normal stilini çizmeye döner, yani kullanıcı için görünen
     bir arıza yoktur. Buna bir uyarı iliştirmek, hiçbir şeyin bozulmadığı bir
     durumda bildirim göstermek olurdu. Aynı kalıp `useGeographicScopeLayer`
     çağrısında da kullanılır. */
  useMapPresentationLayer(mapInstance, {
    permitted: allowed.canViewDrawings,
    visibility: workspace.visibility,
    version: workspace.presentationVersion,
    suspendedTypes: presentationSuspendedTypes,
    activeRef: presentationActiveRef,
    onChange: workspace.onPresentationChange,
  })
  /* The one owner of the selected basemap. It is independent of the UI theme in
     both directions: nothing here reads `useTheme`, and the theme never picks a
     basemap — every light/dark × standard/uydu combination is valid. */
  const basemap = useBasemap(mapInstance)

  const mapView = useMapView(mapInstance, { showToast })
  const measurement = useMeasurement(mapInstance, workspaceMode.activeMeasureTool)

  const { selectFeature, extentOf, extentOfKeys, visibleExtent, selectedKeys, selectedFeature, featureByKey } =
    workspace

  /* Click-to-select runs in select mode only, and not while an area polygon is
     being drawn — there a click is a vertex, not a selection.

     Yolculuk noktası seçimi silahlıyken de çekilir: aynı tıklama hem bir geçiş
     noktası yazıp hem bir çizimi seçemez. Bayrak İKİ şeyi birden kapatır —
     seçim tıklaması ve hover imleci — böylece seçim kipinin artı imleci
     ayakta kalır. */
  const clickSelectEnabled =
    allowed.canSelect
    && workspaceMode.isSelecting
    && workspaceMode.activeSelectionTool !== 'polygon'
    && !journey.isPicking

  /**
   * Haritadan seçim: seçimi kur, sonra çizim bağlamını etkinleştir.
   *
   * Etkinleştirme, çakışan bağlamı (POI Bilgisi, ısı haritası paneli, açık bir
   * liste …) koordinatör üzerinden kendiliğinden kapatır; burada tek tek
   * kapatılan bir panel YOKTUR. Boş haritaya tıklama seçimi düşürür ve
   * aşağıdaki senkron efekt paneli kapatır.
   */
  const selectFromMap = useCallback(
    (key, options) => {
      selectFeature(key, options)
      if (key) mapContext.activate(MAP_CONTEXTS.drawingInfo)
    },
    [selectFeature, mapContext],
  )

  const { hovered } = useFeatureInteraction(mapInstance, {
    enabled: clickSelectEnabled,
    hoverEnabled: hasFinePointer,
    onSelect: selectFromMap,
  })

  /* --- POI ------------------------------------------------------------------
     POI, çizimlerden AYRI bir alan nesnesidir: kendi katmanı, kendi uçları ve
     kendi yetkileri vardır. Buradaki kod yalnızca orkestrasyondur — katman
     yaşam döngüsü, yerleştirme etkileşimi ve isabet denetimi kendi
     kancalarında yaşar. */

  const [selectedPoi, setSelectedPoi] = useState(null)
  const [poiFormOpen, setPoiFormOpen] = useState(false)
  const [poiSaving, setPoiSaving] = useState(false)
  const [poiError, setPoiError] = useState('')
  /** Non-null while a POI delete confirmation is on screen. */
  const [pendingPoiDelete, setPendingPoiDelete] = useState(null)
  const poiSaveInFlight = useRef(false)
  /* `loaded`, "bu okuma BİR KEZ yapıldı" demektir ve `items.length`'ten AYRI bir
     olgudur: boş ama başarılı bir yanıt da tamamlanmış bir okumadır. İkisini
     karıştırmak, kategori tanımlanmamış bir kurulumda listenin sonsuza kadar
     yeniden istenmesine yol açıyordu. */
  const [poiCategories, setPoiCategories] = useState({ items: [], loading: false, error: '', loaded: false })

  /**
   * Kategori kimliği → rozetin ihtiyacı olan iki alan.
   *
   * <b>Taksonomi burada İKİNCİ KEZ tanımlanmaz.</b> Yalnızca sunucudan gelen
   * listenin haritanın soracağı soruya göre indekslenmiş hâlidir; bir kategori
   * yönetim ekranından düzenlendiğinde bu eşleme de kendiliğinden değişir.
   *
   * `Map` bilinçlidir: stil fonksiyonu her POI için çağrılır ve bir dizide
   * arama yapmak, kayıt sayısıyla çarpan bir maliyet olurdu.
   */
  const poiCategoryPresentation = useMemo(() => {
    const lookup = new Map()

    for (const category of poiCategories.items) {
      lookup.set(category.id, { iconKey: category.iconKey, colorHex: category.colorHex })
    }

    return lookup
  }, [poiCategories.items])

  const normalPoiLayerVisible = !locationAnalysisResultActive

  const poi = usePoiLayer(mapInstance, {
    permitted: allowed.canViewPoi,
    selectedId: selectedPoi?.id ?? null,
    /* Rozet kategorisinin simgesini ve rengini buradan alır; gelmeden önce de
       POI genel bir noktaya DÜŞMEZ, nötr bir rozetle çizilir. */
    categoryPresentation: poiCategoryPresentation,
    /* Görünürlük yetkiden AYRIDIR: katmanı kapatmak veriyi atmaz, yalnızca
       gizler — tekrar açıldığında yeniden indirilmez. */
    visible: normalPoiLayerVisible,
    showToast,
    rasterActiveRef: poiPresentationActiveRef,
    hiddenPoiIds: layerVisibility.hiddenPoiIds,
  })
  const {
    addPoi: addPoiToLayer,
    updatePoi: updatePoiOnLayer,
    removePoi: removePoiFromLayer,
    findPoi: findPoiOnLayer,
    notifyRasterChanged: notifyPoiRasterChanged,
  } = poi

  /* POI sunum rasteri. Yetki `poi.view`'dur — yönetici olmak gerekmez ve rol
     adına bakan hiçbir kural yoktur. Yetki yoksa katman hiç kurulmaz ve uç hiç
     çağrılmaz; POI'ler kendi vektör işaretleriyle çizilmeye devam eder. */
  usePoiPresentationLayer(mapInstance, {
    /* Katman kapalıyken raster HİÇ kurulmaz ve uç HİÇ çağrılmaz: kanca zaten
       yetkisiz durumda tam olarak bunu yapıyor, dolayısıyla gizlenmiş bir
       katman için kaydırma/yakınlaşma boyunca istek üretilmez ve uçan istek
       kancanın kendi temizliğinde iptal edilir. */
    permitted: allowed.canViewPoi && normalPoiLayerVisible,
    suspended: layerVisibility.hiddenPoiIds.size > 0,
    version: poiPresentationVersion,
    activeRef: poiPresentationActiveRef,
    /* Raster devraldığında/bıraktığında vektör katmanının yeniden çizilmesi
       gerekir: stil fonksiyonu React dışında çalışır ve cevabın değiştiğini
       ancak böyle öğrenir. */
    onChange: notifyPoiRasterChanged,
  })

  /* "POI'lerim": kapsamı SUNUCU belirler (`GET /api/poi/mine`). Ortak harita
     listesini tarayıcıda süzmek mümkün değildir — o sözleşme kaydın sahibini
     bilinçli olarak taşımaz — ve `canUpdate`/`canDelete` de sahiplik ölçüsü
     DEĞİLDİR: `poi.manage` taşıyan biri onları yabancı kayıtlarda da taşır.

     Liste yalnızca panel AÇILDIĞINDA okunur; oluşturma ve geri yükleme akışları
     başka bir bağlam etkinken yürüdüğü için panel bir sonraki açılışında zaten
     tazelenir. Yerinde güncelleme yalnızca panelin görünür kalabildiği iki
     durumda yapılır: düzenleme sonrası tazeleme ve satırdan silme. */
  const myPois = useMyPois({
    active: mapContext.isActive(MAP_CONTEXTS.myPois),
    permitted: allowed.canViewPoi,
  })
  const { replace: replaceMyPoi, remove: removeMyPoi } = myPois

  const placement = usePoiPlacement(mapInstance, {
    /* Mod `useWorkspaceMode`'a aittir; yetki kapısı burada ikinci kez aranır ki
       yetkisi alınan biri için etkileşim tek bir render bile ayakta kalmasın. */
    active: workspaceMode.isPlacingPoi && allowed.canCreatePoi,
    // Nokta konduğu anda HİÇBİR ŞEY kaydedilmez; yalnızca form açılır.
    onPlaced: useCallback(() => { setPoiError(''); setPoiFormOpen(true) }, []),
  })
  const { pending: pendingPoi, clearPending: clearPendingPoi } = placement

  /* POI tıklaması, haritanın tıklamasının sahibi olan bir araç varken
     DEVREYE GİRMEZ: kullanıcı poligon çizerken bir tık köşe noktasıdır, POI
     seçimi değil. Koşul çizim seçimiyle aynı dinlenme durumunu arar ama kendi
     yetkisine (poi.view) bakar — seçim yetkisi olmayan biri de POI'ye
     tıklayabilmelidir. */
  const poiClickEnabled =
    allowed.canViewPoi
    /* Gizlenmiş bir POI tıklanamaz. Görünmez bir OpenLayers katmanı zaten
       isabet denetimine girmez; bu koşul aynı kararı okunur kılar ve
       etkileşimin kaynağını tek bir yerde toplar. */
    && normalPoiLayerVisible
    && workspaceMode.isSelecting
    && workspaceMode.activeSelectionTool !== 'polygon'

  /**
   * POI tıklaması: kaydı seç ve POI bağlamını etkinleştir.
   *
   * Boş haritaya tıklama YALNIZCA POI bağlamını kapatır (`close(poiInfo)`):
   * aynı tıkla bir çizim seçilmişse bağlam çoktan ona geçmiştir ve geç kalan
   * bir kapatma onu düşürmemelidir.
   */
  const handlePoiSelected = useCallback(
    (record) => {
      if (!record) {
        mapContext.close(MAP_CONTEXTS.poiInfo)
        return
      }
      setSelectedPoi(record)
      mapContext.activate(MAP_CONTEXTS.poiInfo)
    },
    [mapContext],
  )


  /* --- Akıllı ulaşım -------------------------------------------------------
     Güzergah çizgileri ve duraklar POI kaynağına KATILMAZ. Kanca iki ayrı
     vektör kaynağını sahiplenir; çizgileri her okumada sıralı duraklardan
     yeniden türetir. */
  const [selectedTransportStop, setSelectedTransportStop] = useState(null)
  const [selectedTransportRouteId, setSelectedTransportRouteId] = useState(null)
  const [transportStopFormOpen, setTransportStopFormOpen] = useState(false)
  const [transportStopEditing, setTransportStopEditing] = useState(null)
  const [transportStopEditVersion, setTransportStopEditVersion] = useState(0)
  const [transportStopSaving, setTransportStopSaving] = useState(false)
  const [transportStopError, setTransportStopError] = useState('')
  const [transportStopBusyId, setTransportStopBusyId] = useState(null)
  const [pendingTransportStopDelete, setPendingTransportStopDelete] = useState(null)
  const [transportRoutesVisible, setTransportRoutesVisible] = useState(true)
  const [hiddenTransportRouteIds, setHiddenTransportRouteIds] = useState(() => new Set())
  const transportStopSaveInFlight = useRef(false)

  const transport = useTransportLayer(mapInstance, {
    permitted: allowed.canViewTransport,
    selectedStopId: selectedTransportStop?.id ?? null,
    selectedRouteId: selectedTransportRouteId,
    routesVisible: transportRoutesVisible,
    stopsVisible: true,
    hiddenRouteIds: hiddenTransportRouteIds,
    hiddenStopIds: layerVisibility.hiddenTransportStopIds,
    showToast,
  })

  const transportRouteOptions = useMemo(() => transport.activeRoutes.map((route) => ({
    ...route,
    stopCount: transport.stops.filter((stop) => stop.routeId === route.id && stop.isActive !== false).length,
  })), [transport.activeRoutes, transport.stops])

  /* --- Canlı takip (Faz 3/4 mimarisi AYNEN yeniden kullanılır) ---------------
     Ana harita, `transport.view` yetkisiyle ulaşılabilen tek yüzeydir; yönetim
     yetkileri gerektiren güzergah yönetimi ekranına girmeden de çalışan bir
     hattı izleyebilmek buradan mümkün olur. İkinci bir SignalR istemcisi,
     ikinci bir araç uygulaması ya da ikinci bir harita KURULMAZ. */
  const [startedSimulationId, setStartedSimulationId] = useState(null)
  /* Balon KİMLİĞİ rota + çalıştırmadır. Tek bir "seçili araç" kimliği, birden
     fazla işaretçi varken hangisine tıklanırsa tıklansın aynı balonu açardı. */
  const [vehiclePopupTarget, setVehiclePopupTarget] = useState(null)
  const [activeSimulationSearch, setActiveSimulationSearch] = useState('')

  const simulation = useTransportSimulation({
    routeId: selectedTransportRouteId,
    canView: allowed.canViewTransport,
    /* AKTİF KEŞİF yalnızca bu yüzeyde açılır: çalışma alanı "Aktif
       Simülasyonlar" bölümünün sahibidir. Yönetim ekranı tek bir seçili hatla
       ilgilenir ve orada tüm hatların yayınına abone olmak gereksiz bir trafik
       demekti. */
    discoverActive: allowed.canViewTransport,
  })

  /* Yetenek TEK yerde okunur ve İKİ yerde tüketilir: görünürlük kararı ve
     KOMUT yolu. Yalnızca görünürlüğe bağlamak, açık bir onay kutusu dururken
     yetkisi geri alınan bir kullanıcının komutu yine de gönderebilmesi demekti
     (yetkiler oturum içinde `refreshPermissions` ile değişebilir). */
  const canStopSharedSimulation = can(PERMISSIONS.TRANSPORT_SIMULATION_STOP)

  /* Başlatma AYRI bir yetkidir ve durdurmayı İMA ETMEZ. Faz 4B'de ikinci bir
     tüketicisi oldu: YENİDEN BAŞLATMA gerçekten iki şey yapar (canlı bir yayını
     herkes için bitirir ve yenisini kurar), bu yüzden İKİ kodu birden ister ve
     üçüncü bir kod uydurulmaz. */
  const canStartSharedSimulation = can(PERMISSIONS.TRANSPORT_SIMULATION_START)

  const simulationControls = useMemo(() => transportSimulationControls({
    routeId: selectedTransportRouteId,
    simulation: simulation.simulation,
    followingRouteId: simulation.followingRouteId,
    canStart: canStartSharedSimulation,
    /* DURDURMA da AYRI bir yetkidir ve başlatmayı İMA ETMEZ: bir kurulum
       hattı işletebilen birine durdurma vermeyebilir, ya da tersi. İki kod
       burada ayrı ayrı okunur ve biri diğerinin yerine geçmez. */
    canStop: canStopSharedSimulation,
    starting: simulation.starting,
    stopping: simulation.stopping,
    pausing: simulation.pausing,
    resuming: simulation.resuming,
    following: simulation.following,
  }), [
    selectedTransportRouteId,
    simulation.simulation,
    simulation.followingRouteId,
    simulation.starting,
    simulation.stopping,
    simulation.pausing,
    simulation.resuming,
    simulation.following,
    canStopSharedSimulation,
    canStartSharedSimulation,
  ])

  /* BAŞLATMA da komut yolunda YENİDEN denetlenir ve bu, durdurma/duraklatma
     tarafındaki kuralın aynısıdır: yetkiler oturum içinde tazelenebilir,
     dolayısıyla düğmenin görünürlüğü bir denetim değildir. İki yaşam döngüsü
     tarafının farklı sıkılıkta kurallar taşıması, aynı yeteneğin iki ayrı
     kural kitabına sahip olması demekti. */
  const startSharedSimulation = useCallback(async () => {
    if (!canStartSharedSimulation) return
    if (selectedTransportRouteId == null) return
    const snapshot = await simulation.start(selectedTransportRouteId)
    if (snapshot) setStartedSimulationId(snapshot.simulationId)
  }, [canStartSharedSimulation, selectedTransportRouteId, simulation])

  /* Paylaşılan durdurma ONAYIN arkasındadır: çok kullanıcılı canlı bir
     çalıştırmayı sonlandırır ve yanlış bir tıklama başkalarının izlediği
     yayını keser.

     BEKLEYEN DURUM BİR BAYRAK DEĞİL, BİR KİMLİKTİR. Onay kutusu açıkken A
     çalıştırması bitip AYNI rotada B başlayabilir; yalnızca "onay açık"
     bilgisi tutulsaydı, onay anında o anki kimlik okunur ve kullanıcının A
     için verdiği karar sessizce B'yi durdururdu. Sunucu bunu yakalayamaz:
     kendisine B için geçerli, yetkili ve kimliği tutan bir istek ulaşırdı.
     Niyet bu yüzden TETİKLEME anında dondurulur. */
  const [pendingSharedStop, setPendingSharedStop] = useState(null)
  const sharedStopInFlight = useRef(false)

  /* Onayı AÇMAK da bir yetenek ve KİMLİK kararıdır: düğme zaten gizli olsa
     bile komut yolunun girişi kendi kapısını taşır, ve tam olarak burada
     hangi çalıştırmanın durdurulmak istendiği YAKALANIR. */
  const requestSharedStop = useCallback(() => {
    if (!canStopSharedSimulation) return

    const intent = sharedStopIntent({
      routeId: selectedTransportRouteId,
      simulationId: simulationControls.stoppableSimulationId,
    })

    // Rota + çalıştırma çiftinden biri eksikse niyet KURULAMAZ.
    if (!intent) return

    setPendingSharedStop(intent)
  }, [canStopSharedSimulation, selectedTransportRouteId, simulationControls.stoppableSimulationId])

  const confirmSharedStop = useCallback(async () => {
    /* ÇİFT GÖNDERİM KORUMASI. Ref anında yazılır; state güncellemesini
       beklemek, hızlı iki tıklamada ikinci isteğin yola çıkmasına izin
       verirdi. */
    if (sharedStopInFlight.current) return

    const intent = pendingSharedStop

    /* KOMUT ANINDA yeniden denetim — FAIL-CLOSED, İKİ eksende:

       YETKİ: onay kutusu açıkken yetki geri alınmış olabilir (yetkiler
       oturum içinde tazelenebilir); düğme kaybolur ama açık kalan kutu hâlâ
       tıklanabilirdi. Görünürlük bir denetim değildir.

       KİMLİK: yakalanan niyet HÂLÂ o anki çalıştırmaya işaret etmiyorsa
       (A bitti, yerine B geçti ya da başka bir hatta geçildi) komut
       GÖNDERİLMEZ. Yakalanan kimliği o anki kimlikle DEĞİŞTİRMEK,
       kullanıcının hiç vermediği bir kararı uygulamak olurdu. */
    if (!canStopSharedSimulation
      || !sharedStopIntentIsCurrent(intent, {
        routeId: selectedTransportRouteId,
        stoppableSimulationId: simulationControls.stoppableSimulationId,
      })) {
      setPendingSharedStop(null)
      return
    }

    sharedStopInFlight.current = true

    try {
      /* Komut YAKALANMIŞ kimlikleri taşır — o anki değerleri değil. İkisi de
         tetikleme anındaki sunucu gerçeğinden gelir. */
      await simulation.stop(intent.routeId, intent.simulationId)
    } finally {
      sharedStopInFlight.current = false
      setPendingSharedStop(null)
    }
  }, [
    simulation,
    pendingSharedStop,
    selectedTransportRouteId,
    simulationControls.stoppableSimulationId,
    canStopSharedSimulation,
  ])

  /* DURAKLAT / DEVAM ETTİR yıkıcı DEĞİLDİR: aynı çalıştırma sürer, yalnızca
     saati durur. Bu yüzden onay istemezler ve o anda ekranda duran KANONİK
     çalıştırma kimliğini doğrudan taşırlar. Yetenek yine de komut yolunda
     yeniden denetlenir: görünürlük bir denetim değildir. */
  const pauseSharedSimulation = useCallback(() => {
    if (!canStopSharedSimulation) return
    return simulation.pause(selectedTransportRouteId, simulationControls.stoppableSimulationId)
  }, [canStopSharedSimulation, simulation, selectedTransportRouteId, simulationControls.stoppableSimulationId])

  const resumeSharedSimulation = useCallback(() => {
    if (!canStopSharedSimulation) return
    return simulation.resume(selectedTransportRouteId, simulationControls.stoppableSimulationId)
  }, [canStopSharedSimulation, simulation, selectedTransportRouteId, simulationControls.stoppableSimulationId])

  const followSharedSimulation = useCallback(
    () => simulation.follow(selectedTransportRouteId),
    [simulation, selectedTransportRouteId],
  )

  /* Takibi bırakmak yalnızca KAMERA sahipliğini bırakır: yayın sürer,
     işaretçi hareket etmeye devam eder ve sunucudaki simülasyon herkes için
     çalışmaya devam eder. "Takibi Bırak", "Simülasyonu Durdur" DEĞİLDİR. */
  const unfollowSharedSimulation = useCallback(() => simulation.unfollow(), [simulation])

  /* Paylaşılan hattın SUNUM modeli. Hiçbir değer burada üretilmez: rota adı
     katalogdan, mesafe/süre kalıcı güzergahtan, durum/ilerleme sunucunun
     anlık görüntüsünden ve denetim görünürlüğü mevcut saf karardan gelir. */
  const sharedJourney = useMemo(() => sharedJourneyPresentation({
    routeId: selectedTransportRouteId,
    routes: transport.activeRoutes,
    paths: transport.paths,
    controls: simulationControls,
    statusLoading: simulation.statusLoading,
    starting: simulation.starting,
    stopping: simulation.stopping,
    pausing: simulation.pausing,
    resuming: simulation.resuming,
    error: simulation.error,
  }), [
    selectedTransportRouteId,
    transport.activeRoutes,
    transport.paths,
    simulationControls,
    simulation.statusLoading,
    simulation.starting,
    simulation.stopping,
    simulation.pausing,
    simulation.resuming,
    simulation.error,
  ])

  /* --- ÇOKLU İZLEME (Faz 4A) --------------------------------------------------
     AKTİF bir aracın haritada görünmesinin TEK sahibi kullanıcının İZLEME
     seçimidir.

     SEÇİM görünürlük sahibi DEĞİLDİR: seçili ama izlenmeyen bir hattın
     ayrıntıları panelde canlı akmaya devam eder, işaretçisi çizilmez.
     GÖZLEM (observe) yalnızca VERİ sahipliğidir — o abonelik olmasaydı panel
     donardı; ama abone olmak "çiz" demek değildir. AKTİF KÜME üyeliği de
     yalnızca listenin tazeliğini sahiplenir. BAŞLATMA sahipliği ise hiçbir
     aktif çalıştırmayı görünür kılmaz.

     Bu ayrım SUNUM DÜZEYİNDE kurulur: aktif çizim listesi yalnızca izleme
     sunumundan doğar, sonradan bir sahiplik dizesine göre süzülmez. */
  const watchedVehicles = useMemo(() => transportWatchedVehiclePresentations({
    byRoute: simulation.byRoute,
    watchedRuns: simulation.watchedRuns,
    selectedRouteId: selectedTransportRouteId,
    followingRouteId: simulation.followingRouteId,
    subscribedRouteIds: simulation.subscribedRouteIds,
    routes: transport.activeRoutes,
  }), [
    simulation.byRoute,
    simulation.watchedRuns,
    simulation.followingRouteId,
    simulation.subscribedRouteIds,
    selectedTransportRouteId,
    transport.activeRoutes,
  ])

  /* ESKİ, DAR ve TERMİNAL sunum: çalıştırmayı BAŞLATAN kullanıcı, o
     çalıştırma bittikten sonra son konumunu görmeye devam eder.

     Bu sunum AKTİF koleksiyonun DIŞINDADIR ve öyle kalmalıdır: fonksiyon
     terminal olmayan bir çalıştırma için ASLA bir sunum üretmez, dolayısıyla
     başlatma sahipliği aktif bir aracı görünür kılamaz. Canlı değildir ve
     kamera talep etmez. */
  const starterTerminalVehicle = useMemo(() => transportStarterTerminalPresentation({
    simulation: simulation.simulation,
    startedSimulationId,
    selectedRouteId: selectedTransportRouteId,
    routes: transport.activeRoutes,
  }), [
    simulation.simulation,
    startedSimulationId,
    selectedTransportRouteId,
    transport.activeRoutes,
  ])

  /* Çizim listesi: AKTİF izlenen araçlar + isteğe bağlı TERMİNAL başlatıcı
     sunumu. İkisi ayrı kavramdır; kimlik (rota + çalıştırma) çakışmayı
     tekilleştirir. */
  const vehiclePresentations = useMemo(
    () => mergeVehiclePresentations(watchedVehicles, starterTerminalVehicle),
    [watchedVehicles, starterTerminalVehicle],
  )

  /* Tıklama, TIKLANAN aracın kimliğini yakalar: hiçbir simülasyon
     değiştirilmez, takip ele geçirilmez ve diğer işaretçiler etkilenmez. */
  const openVehiclePopup = useCallback((vehicle) => {
    setVehiclePopupTarget(
      vehicle ? { routeId: vehicle.routeId, simulationId: vehicle.simulationId } : null,
    )
  }, [])

  useTransportVehicleLayer(mapInstance, {
    presentations: vehiclePresentations,
    onVehicleClick: openVehiclePopup,
    /* Yolculuk noktası seçimi silahlıyken YALNIZCA balon çekilir. Araçlar
       çizilmeye, canlı konumlarını almaya ve takip kamerasını sürdürmeye devam
       eder — sabit hat simülasyonu ürünü bu koddan hiç etkilenmez. */
    clickEnabled: !journey.isPicking,
  })

  /* Balon TIKLANAN çalıştırmanın kanonik durumunu okur; küresel bir "seçili
     araç" modeli DEĞİL. Çalıştırma listeden düştüğünde (bitti, izlemeden
     çıkarıldı) balon da kendiliğinden kapanır. */
  const vehiclePopup = useMemo(() => {
    if (!vehiclePopupTarget) return null
    const target = vehiclePresentations.find(
      (item) => item.routeId === vehiclePopupTarget.routeId
        && item.simulationId === vehiclePopupTarget.simulationId,
    )
    return target ? transportVehiclePopupModel(target) : null
  }, [vehiclePopupTarget, vehiclePresentations])

  /* --- AKTİF SİMÜLASYONLAR bölümünün sunum modeli ------------------------------
     Hiçbir değer burada üretilmez: durum/ilerleme sunucunun anlık
     görüntüsünden, ad/renk mevcut rota katalogundan gelir. Arama YALNIZCA
     sunum süzgecidir — aktif kümeye, izleme seçimine ve aboneliklere hiç
     dokunmaz. */
  const activeSimulations = useMemo(() => activeSimulationsPresentation({
    byRoute: simulation.byRoute,
    routes: transport.activeRoutes,
    watchedRuns: simulation.watchedRuns,
    /* YÖNETİM SEÇİMİ İZLEMEDEN AYRI bir girdidir: biri haritada ne çizileceğine,
       diğeri hangi çalıştırmaya komut gideceğine karar verir. */
    managedRuns: simulation.managedRuns,
    selectedRouteId: selectedTransportRouteId,
    followedRouteId: simulation.followingRouteId,
    search: activeSimulationSearch,
    loading: simulation.activeLoading,
    loaded: simulation.activeLoaded,
    error: simulation.activeError,
    /* Yetenekler TEK yerden okunur ve İKİ yerde tüketilir: görünürlük ve KOMUT
       yolu. Yeniden başlatma İKİSİNİ birden ister — başlatabilmek, başkalarının
       yayınlarını bitirme yetkisi değildir. */
    canStart: canStartSharedSimulation,
    canStop: canStopSharedSimulation,
    pending: simulation.lifecyclePending,
    batchError: simulation.batchError,
    batchSummary: simulation.batchSummary,
  }), [
    simulation.byRoute,
    simulation.watchedRuns,
    simulation.managedRuns,
    simulation.followingRouteId,
    simulation.activeLoading,
    simulation.activeLoaded,
    simulation.activeError,
    simulation.lifecyclePending,
    simulation.batchError,
    simulation.batchSummary,
    selectedTransportRouteId,
    transport.activeRoutes,
    activeSimulationSearch,
    canStartSharedSimulation,
    canStopSharedSimulation,
  ])

  /* --- NAVİGASYON (Faz 5) ------------------------------------------------------
     SEÇİLİ hattın bağlamına aittir. İzlemek (haritada araç), takip etmek
     (kamera) ve yönetim seçimi (komut hedefi) bu bölümü ne açar ne kapatır.

     Hiçbir değer BURADA üretilmez: hangi manevrada olunduğuna ve sonrakine ne
     kadar kaldığına sunucu karar verir; sayfa yalnızca iki otoriter parçayı
     (sabit adım listesi + canlı sıra) bir araya getirir. */
  const sharedNavigation = useMemo(() => sharedNavigationPresentation({
    routeId: selectedTransportRouteId,
    simulation: simulation.simulation,
    navigation: selectedTransportRouteId == null
      ? null
      : simulation.navigationByRoute[selectedTransportRouteId] ?? null,
  }), [
    selectedTransportRouteId,
    simulation.simulation,
    simulation.navigationByRoute,
  ])

  /* Satır SEÇİMİ yalnızca ayrıntı bağlamını taşır: izlemeyi DEĞİŞTİRMEZ,
     takibi ele GEÇİRMEZ ve yönetim seçimi YAPMAZ. */
  const selectActiveSimulationRow = useCallback((rowRouteId) => {
    setSelectedTransportRouteId(rowRouteId)
  }, [])

  /* --- TOPLU YAŞAM DÖNGÜSÜ (Faz 4B) --------------------------------------------
     BEKLEYEN DURUM BİR BAYRAK DEĞİL, DONDURULMUŞ BİR NİYETTİR: işlem + her
     hedefin TAM kimliği. Paylaşılan Sıfırla akışındaki ilkenin aynısıdır,
     yalnızca çoğul hâli — onay kutusu açıkken A bitip yerine B geçebilir ve
     onay anında o anki kimliği okumak, kullanıcının hiç vermediği bir kararı
     uygulamak olurdu. Sunucu bunu yakalayamazdı: kendisine B için geçerli,
     yetkili ve kimliği tutan bir istek ulaşırdı. */
  const [pendingBatchCommand, setPendingBatchCommand] = useState(null)

  /**
   * Bir işlemi ÇALIŞTIRIR ya da onayını açar.
   *
   * <b>Yetenek KOMUT YOLUNDA yeniden denetlenir</b> — görünürlük bir denetim
   * değildir ve yetkiler oturum içinde tazelenebilir.
   */
  const runLifecycleOperation = useCallback((operation, overrideTargets = null) => {
    if (!canStopSharedSimulation) return
    if (operation === LIFECYCLE_OPERATIONS.RESTART && !canStartSharedSimulation) return

    /* Satır komutu ile toplu komut AYNI yoldan geçer; satır yalnızca TEK
       hedefli bir yönetim seçimi gibi davranır. İkinci bir komut uygulaması
       YOKTUR. */
    const intent = overrideTargets
      ? lifecycleIntent(operation, {
        managedRuns: { [overrideTargets.routeId]: overrideTargets.simulationId },
        byRoute: simulation.byRoute,
      })
      : lifecycleIntent(operation, {
        managedRuns: simulation.managedRuns,
        byRoute: simulation.byRoute,
      })

    // Uygun hedef yoksa hiçbir istek yola çıkmaz.
    if (!intent) return

    /* YIKICI işlemler ONAYIN arkasındadır ve tıklama komut GÖNDERMEZ: yalnızca
       niyeti dondurur. Duraklat/Devam Ettir yıkıcı DEĞİLDİR — aynı çalıştırma
       sürer, yalnızca saati durur — bu yüzden onay istemezler. */
    if (isDestructiveLifecycleOperation(operation)) {
      setPendingBatchCommand(intent)
      return
    }

    simulation.runLifecycleBatch(intent)
  }, [canStopSharedSimulation, canStartSharedSimulation, simulation])

  const confirmBatchCommand = useCallback(async () => {
    const intent = pendingBatchCommand

    /* KOMUT ANINDA yeniden denetim — FAIL-CLOSED: onay kutusu açıkken yetki
       geri alınmış olabilir. Hedefler ise YENİDEN HESAPLANMAZ; niyetin
       içindeki kimlikler olduğu gibi gönderilir ve bayat olanı sunucu
       reddeder. */
    if (!intent
      || !canStopSharedSimulation
      || (intent.operation === LIFECYCLE_OPERATIONS.RESTART && !canStartSharedSimulation)) {
      setPendingBatchCommand(null)
      return
    }

    setPendingBatchCommand(null)
    await simulation.runLifecycleBatch(intent)
  }, [pendingBatchCommand, canStopSharedSimulation, canStartSharedSimulation, simulation])

  const toggleTransportRoute = useCallback((routeId) => {
    setHiddenTransportRouteIds((current) => {
      const next = new Set(current)
      if (next.has(routeId)) next.delete(routeId)
      else next.add(routeId)
      return next
    })
  }, [])

  useEffect(() => {
    const activeIds = new Set(transport.routes.map((route) => route.id))
    setHiddenTransportRouteIds((current) => {
      const next = new Set([...current].filter((routeId) => activeIds.has(routeId)))
      return next.size === current.size ? current : next
    })
  }, [transport.routes])

  const myStops = useMyStops({
    active: mapContext.isActive(MAP_CONTEXTS.myStops),
    permitted: canOpenMyStops,
  })

  const handleTransportStopPlaced = useCallback(() => {
    setTransportStopError('')
    setTransportStopFormOpen(true)
  }, [])

  const transportPlacement = useTransportStopPlacement(mapInstance, {
    active: workspaceMode.isPlacingTransportStop && allowed.canCreateTransportStop,
    onPlaced: handleTransportStopPlaced,
  })

  const transportRelocation = useTransportStopRelocation(mapInstance, {
    active: workspaceMode.isRelocatingTransportStop && allowed.canUpdateTransportStop,
  })

  const handleTransportStopSelected = useCallback((stop) => {
    if (!stop) {
      mapContext.close(MAP_CONTEXTS.transportStopInfo)
      return
    }
    setSelectedTransportRouteId(null)
    setSelectedTransportStop({ ...stop, colorHex: stop.colorHex || stop.routeColor })
    mapContext.activate(MAP_CONTEXTS.transportStopInfo)
  }, [mapContext])

  /* Haritadaki güzergah çizgisine doğrudan tıklamak, MEVCUT seçim durumunu
     kullanır: ikinci bir "seçili rota" kavramı doğmaz. Kamera oynatılmaz —
     kullanıcı zaten baktığı yere tıklamıştır.

     Faz 2'de tıklamanın SONUCU değişti: ayrı bir takip kartı açılmaz, YOLCULUK
     çalışma alanı paylaşılan hat bağlamında açılır. Tıklama hâlâ bir SEÇİMDİR
     ve bir yaşam döngüsü komutu DEĞİLDİR: simülasyon başlamaz, takip
     açılmaz, kamera talep edilmez ve güzergah yeniden hesaplanmaz. */
  const handleTransportRouteSelected = useCallback((routeId) => {
    const next = Number(routeId)
    if (!Number.isFinite(next)) return
    setSelectedTransportRouteId(next)
    setSelectedTransportStop(null)
    mapContext.close(MAP_CONTEXTS.transportStopInfo)
    openJourneyWorkspaceWith(JOURNEY_PRODUCTS.SHARED)
  }, [mapContext, openJourneyWorkspaceWith])

  /* --- Boş harita tıklaması: seçili güzergahı bırakır (Faz 10) ---------------
     POI, durak ve çizim seçimleri boş tıklamada ZATEN bırakılıyordu; güzergah
     bırakılmıyordu ve kullanıcı için bu tutarsızlıktı.

     <b>YALNIZCA SEÇİMDİR.</b> Burada durdurma, duraklatma, sıfırlama, izlemeyi
     bırakma, takibi bırakma ya da yönetim seçimini değiştirme YOKTUR — ve
     olamaz: bu satır tek bir sunum durumunu boşaltır. İzlenen ve takip edilen
     araçlar da kaybolmaz, çünkü sahiplik `followingRouteId`'dedir,
     `selectedRouteId`'de değil (bkz. `transportVehicle`). */
  const clearSelectedTransportRoute = useCallback(() => {
    setSelectedTransportRouteId(null)
  }, [])

  /* Gizlenen güzergah tıklanamaz: kullanıcı onu bilerek kapatmıştır. */
  const isTransportRouteSelectable = useCallback(
    (routeId) => transportRoutesVisible && !hiddenTransportRouteIds.has(Number(routeId)),
    [transportRoutesVisible, hiddenTransportRouteIds],
  )

  const isTransportStopSelectable = useCallback(
    (stopId) => isRecordVisible(layerVisibility.hiddenTransportStopIds, stopId),
    [layerVisibility.hiddenTransportStopIds],
  )

  const isPoiSelectable = useCallback(
    (poiId) => isRecordVisible(layerVisibility.hiddenPoiIds, poiId),
    [layerVisibility.hiddenPoiIds],
  )

  /* --- Yolculuk planlayıcısı (Faz 5C) ---------------------------------------
     Durum ve istek yaşam döngüsü `useJourneyPlanner`'dadır; burada yalnızca
     mevcut parçalar bağlanır. Önizleme CANLI SİMÜLASYON DEĞİLDİR: SignalR
     kancasına, takip kamerasına ya da araç durumuna hiçbir biçimde
     dokunmaz ve kendi katmanında yaşar.

     Kancanın kendisi YUKARIDA, `allowed`ın hemen ardında çağrılır: tıklama
     sahipliğini kuran kapılar `journey.isPicking`i okur ve ondan önce
     tanımlanmış olmaları gerekir. */

  const assignActiveJourneyWaypoint = useCallback((reference) => {
    journey.assignWaypoint(journey.state.activeSlotKey, reference)
  }, [journey])

  /* Nokta seçicinin POI araması MEVCUT sunucu taraflı arama yolunu kullanır:
     dropdown uğruna tüm POI envanterini indirmek güvenli bir yol değildir ve
     ikinci bir POI ucu AÇILMAZ. */
  const [journeyPickerQuery, setJourneyPickerQuery] = useState('')

  const journeyPoiSearch = usePoiSearch({
    enabled: allowed.canViewPoi && journey.isPicking,
    query: journeyPickerQuery,
  })

  const journeyPickerSearch = useMemo(() => ({
    query: journeyPickerQuery,
    onQueryChange: setJourneyPickerQuery,
    results: journeyPoiSearch.results,
    loading: journeyPoiSearch.loading,
  }), [journeyPickerQuery, journeyPoiSearch.results, journeyPoiSearch.loading])

  /* --- Kişisel yolculuk simülasyonu (Faz 5D) ---------------------------------
     Paylaşılan hat simülasyonundan TAMAMEN ayrıdır: kendi hub'ı, kendi
     kancası, kendi katmanı ve kendi takip durumu vardır. `simulation`
     (Faz 1-4) ve `simulation.followingRouteId` bu koddan HİÇ etkilenmez —
     bir yolculuk başlatmak/durdurmak bir hat grubuna katılmaz. */
  const journeySimulation = useJourneySimulation({ permitted: allowed.canUseJourney })

  const journeyVehicle = useMemo(() => {
    const snapshot = journeySimulation.snapshot
    if (!snapshot || !journeySimulation.simulation) return null
    return {
      simulationId: snapshot.simulationId,
      // İşaretçi TALEP EDİLEN profile göre görünür (araç / yaya / bisiklet).
      profileId: journeySimulation.simulation.requestedProfile,
      longitude: snapshot.longitude,
      latitude: snapshot.latitude,
    }
  }, [journeySimulation.simulation, journeySimulation.snapshot])

  /* --- Yolculuk aracı balonu (Faz 5E-B · Dilim 7A) ---------------------------
     Balon KENDİ ürünüdür: paylaşılan hat aracının balonuyla birleştirilmez.
     Açık olup olmadığı ÇALIŞTIRMA KİMLİĞİYLE tutulur — bir kimlik değiştiğinde
     ya da sonuç bırakıldığında eski balon kendiliğinden düşer, çünkü model
     yalnızca benimsenmiş çalıştırmadan türetilir. */
  const [journeyPopupSimulationId, setJourneyPopupSimulationId] = useState(null)

  const openJourneyVehiclePopup = useCallback((simulationId) => {
    if (!simulationId) return
    setJourneyPopupSimulationId(simulationId)
    /* Aynı anda tek araç balonu: paylaşılan hattınki koordinasyonla kapanır.
       İki ürün birbirini TANIMAZ; sıralamayı sayfa kurar. */
    setVehiclePopupTarget(null)
  }, [])

  useJourneyVehicleLayer(mapInstance, {
    presentation: journeyVehicle,
    following: journeySimulation.following,
    onVehicleClick: openJourneyVehiclePopup,
    /* Nokta seçimi silahlıyken tıklamanın sahibi odur (Dilim 1); balon
       açılmaz. */
    clickEnabled: !journey.isPicking,
  })

  /* Balon modeli SUNUCUNUN benimsenmiş çalıştırmasından türetilir: yüzde canlı
     panelin okuduğu anlık görüntünün aynısıdır, profil ise
     `requestedProfile` — planlayıcının o anki seçimi değil. Kimlik
     eşleşmiyorsa balon yoktur: önceki çalıştırmanın bilgisi gösterilmez. */
  const journeyVehiclePopup = useMemo(() => {
    if (!journeyPopupSimulationId) return null
    const model = journeyVehiclePopupModel({
      simulation: journeySimulation.simulation,
      snapshot: journeySimulation.snapshot,
    })
    return model && model.simulationId === journeyPopupSimulationId ? model : null
  }, [journeyPopupSimulationId, journeySimulation.simulation, journeySimulation.snapshot])

  /* Diğer yön: paylaşılan hat aracının balonu açıldığında kişisel yolculuk
     balonu çekilir. İki ürün birbirini tanımaz; sıra yalnızca burada,
     sayfanın kendi düzeyinde kurulur. */
  useEffect(() => {
    if (vehiclePopupTarget == null) return
    setJourneyPopupSimulationId(null)
  }, [vehiclePopupTarget])

  /* Başlatma niyeti PLANLAYICININ mevcut seçiminden türetilir; önizlemenin
     planId'si, geometrisi ya da ölçümleri GÖNDERİLMEZ. */
  const startJourney = useCallback(async () => {
    const intent = journey.buildIntent()
    if (!intent) return
    const started = await journeySimulation.start(intent)

    // Başarılı başlatmada panel kendiliğinden AÇILIR (sahipliğiyle birlikte).
    if (started) openJourneyPanel()
  }, [journey, journeySimulation, openJourneyPanel])

  /* --- Durdurma onayı (Faz 5E-B · Dilim 7A) ----------------------------------
     Durdurmak GERİ ALINAMAZ: sunucudaki çalıştırma sona erer. Uygulamanın kendi
     onay diyaloğu kullanılır (`window.confirm` DEĞİL) — silme akışlarıyla aynı
     bileşen, aynı Esc davranışı, aynı erişilebilirlik.

     Onay YALNIZCA çalışan bir yolculuğu durdurmaya aittir: paneli kapatmak,
     katlamak, terminal sonucu bırakmak ya da yeni yolculuk başlatmak onay
     sormaz ve hiçbiri sunucuya durdurma isteği göndermez. */
  const [journeyStopPending, setJourneyStopPending] = useState(false)
  const [journeyStopping, setJourneyStopping] = useState(false)
  const journeyStopInFlight = useRef(false)

  const requestJourneyStop = useCallback(() => setJourneyStopPending(true), [])

  const confirmJourneyStop = useCallback(async () => {
    // Çift gönderim koruması: düğme de kilitlenir, ama ref yarışı da kapatır.
    if (journeyStopInFlight.current) return
    journeyStopInFlight.current = true
    setJourneyStopping(true)

    try {
      // MEVCUT durdurma eylemi; ikinci bir uç ya da ikinci bir akış yoktur.
      await journeySimulation.stop()
    } finally {
      journeyStopInFlight.current = false
      setJourneyStopping(false)
      setJourneyStopPending(false)
    }
  }, [journeySimulation])

  /* Kapalı/katlanmış panelde bile yolculuğun VARLIĞI söylenir. Özet
     sunucunun evre + ilerleme değerlerinden türetilir; yeni bir ölçüm
     hesaplanmaz. */
  const journeyStatus = useMemo(
    () => journeyStatusIndicator({
      simulation: journeySimulation.simulation,
      snapshot: journeySimulation.snapshot,
    }),
    [journeySimulation.simulation, journeySimulation.snapshot],
  )

  const toggleJourneyFollow = useCallback(() => {
    journeySimulation.setFollowing((current) => !current)
  }, [journeySimulation])

  /* --- Terminal sonuçtan çıkış (Faz 5E-B) ------------------------------------
     Biten bir yolculuğun sonucu, kullanıcı BIRAKANA kadar durur. İki çıkış da
     aynı yaşam döngüsü işlemini (`dismiss`) kullanır — ikinci bir "canlı
     yolculuğu sıfırla" mekanizması açılmaz — ve ikisi de sunucuya durdurma
     isteği GÖNDERMEZ: terminal bir çalıştırma zaten terminaldir. */

  /** Sonucu bırakır, planlayıcı seçimlerini OLDUĞU GİBİ bırakır. */
  const returnToJourneyPlanning = useCallback(async () => {
    await journeySimulation.dismiss()
    // Panel zaten açıktır; kapalıyken bırakılırsa da planlayıcı geri gelir.
    openJourneyPanel()
  }, [journeySimulation, openJourneyPanel])

  /** Sonucu bırakır ve MEVCUT temizleme davranışıyla sıfırdan planlamaya döner. */
  const startNewJourney = useCallback(async () => {
    await journeySimulation.dismiss()
    journey.clear()
    openJourneyPanel()
  }, [journeySimulation, journey, openJourneyPanel])

  /* Haritadaki yolculuk çizgisinin sahibi: benimsenmiş çalıştırma varken
     sunucunun OTORİTER yanıtı, bırakıldığında yeniden önizleme. Kural saf
     modüldedir; geometri hiçbir yere KOPYALANMAZ. */
  const journeyGeometryWkt = journeyDisplayGeometryWkt({
    simulation: journeySimulation.simulation,
    previewGeometryWkt: journey.preview?.geometryWkt ?? null,
  })

  /* Geçiş noktalarının OTORİTESİ: benimsenmiş çalıştırma varken sunucunun
     çözdüğü noktalar (ad, konum, sıra, rol) kazanır — planlayıcının o anki
     seçimi canlı haritayı boyayamaz. Çalıştırma yokken önizlemenin kendi
     noktaları gösterilir; bırakıldığında katman boşalır. */
  const journeyWaypoints = useMemo(
    () => journeySimulation.simulation?.waypoints ?? journey.preview?.waypoints ?? null,
    [journeySimulation.simulation, journey.preview],
  )

  useJourneyWaypointLayer(mapInstance, { waypoints: journeyWaypoints })

  /* --- Kaydedilmiş kişisel yolculuklar (Faz 7) -------------------------------
     Kaydedilmiş bir yolculuk canlı durum DEĞİLDİR: burada SignalR yoktur,
     ikinci bir kişisel kanal açılmaz, hiçbir zamanlayıcı kurulmaz ve
     LocalStorage otorite olarak kullanılmaz. Liste yalnızca kullanıcı o
     bölümü AÇTIĞINDA okunur; veri başka hiçbir şeyle değişmez.

     Paylaşılan hat bu koddan HİÇ etkilenmez: onun sekmesi, servisi, hub'ı ve
     durumu olduğu gibi kalır. */

  const journeySavedSectionOpen = journey.state.panel === PANEL_STATES.OPEN
    && journeyProduct === JOURNEY_PRODUCTS.PERSONAL
    && journey.state.section === PERSONAL_SECTIONS.SAVED

  const savedJourneys = useSavedJourneys({
    permitted: allowed.canUseJourney,
    enabled: journeySavedSectionOpen,
  })

  /* --- Kaydetme ------------------------------------------------------------
     KAYDETMEK BAŞLATMAK DEĞİLDİR: bu akış hiçbir simülasyon kurmaz,
     `simulationId` değiştirmez, kamerayı oynatmaz ve paylaşılan duruma
     dokunmaz. Kaydedilen şey planlayıcının KANONİK niyetidir — önizlemenin
     geometrisi ya da ölçümleri değil. */
  const [journeySavePending, setJourneySavePending] = useState(false)

  const requestJourneySave = useCallback(() => {
    // Geçersiz bir seçim için diyalog hiç açılmaz.
    if (!journey.buildIntent()) return
    savedJourneys.clearError()
    setJourneySavePending(true)
  }, [journey, savedJourneys])

  const confirmJourneySave = useCallback(async (name) => {
    const intent = journey.buildIntent()
    if (!intent) return

    const created = await savedJourneys.save({ name, journey: intent })
    if (created) setJourneySavePending(false)
  }, [journey, savedJourneys])

  /* --- Yeniden adlandırma ---------------------------------------------------
     KİMLİK DONDURULUR. Diyalog açıldığı andaki kayıt hedeftir: kullanıcı
     arada başka bir satıra dokunsa bile eylem A'ya uygulanır. Bu, projedeki
     diğer bayat-niyet korumalarıyla aynı ilkedir. */
  const [journeyRenamePending, setJourneyRenamePending] = useState(null)

  const requestSavedJourneyRename = useCallback((savedJourneyId) => {
    // Hedef DONDURULUR; kural saf modüldedir ve burada yalnızca uygulanır.
    const target = savedJourneyTarget(savedJourneys.items, savedJourneyId)
    if (!target) return
    savedJourneys.clearError()
    setJourneyRenamePending(target)
  }, [savedJourneys])

  const confirmSavedJourneyRename = useCallback(async (name) => {
    const target = journeyRenamePending
    if (!target) return

    // Dondurulmuş kimlik: çözülme anındaki liste durumu okunmaz.
    const renamed = await savedJourneys.rename(target.id, name)
    if (renamed) setJourneyRenamePending(null)
  }, [journeyRenamePending, savedJourneys])

  /* --- Silme ----------------------------------------------------------------
     Silmek GERİ ALINAMAZ: kaydedilmiş yolculuğun çöp kutusu yoktur. Mevcut
     onay diyaloğu kullanılır (`window.confirm` DEĞİL) ve hedef kimlik onay
     anında DONDURULUR. */
  const [journeyDeletePending, setJourneyDeletePending] = useState(null)
  const [journeyDeleting, setJourneyDeleting] = useState(false)
  const journeyDeleteInFlight = useRef(false)

  const requestSavedJourneyDelete = useCallback((savedJourneyId) => {
    // Hedef DONDURULUR: onay çözüldüğünde listedeki seçim okunmaz.
    const target = savedJourneyTarget(savedJourneys.items, savedJourneyId)
    if (!target) return
    savedJourneys.clearError()
    setJourneyDeletePending(target)
  }, [savedJourneys])

  const confirmSavedJourneyDelete = useCallback(async () => {
    const target = journeyDeletePending
    if (!target || journeyDeleteInFlight.current) return

    journeyDeleteInFlight.current = true
    setJourneyDeleting(true)

    try {
      // A seçiliyken açılan onay, sonradan B seçilse bile A'yı siler.
      await savedJourneys.remove(target.id)
    } finally {
      journeyDeleteInFlight.current = false
      setJourneyDeleting(false)
      setJourneyDeletePending(null)
    }
  }, [journeyDeletePending, savedJourneys])

  /* Yıldız DEĞER gönderir; sunucuda "tersine çevir" yoktur. İyimser güncelleme
     YAPILMAZ: geri alma mekanizması kurmadan iyimser olmak, başarısız bir
     istekte yıldızı kullanıcının görmediği bir durumda bırakırdı. */
  const toggleSavedJourneyFavorite = useCallback(
    (savedJourneyId, next) => savedJourneys.setFavorite(savedJourneyId, next),
    [savedJourneys],
  )

  /* --- Yükleme (BAŞLATMA DEĞİL) ---------------------------------------------
     Kaydı planlayıcıya yüklemek yalnızca TASLAĞI değiştirir: hiçbir simülasyon
     kurulmaz, çalışan bir yolculuk durdurulmaz ve kamera takibi değişmez.
     Kullanıcı yüklenen yolculuğu inceleyip başlatmayı AYRICA seçer. */
  const loadSavedJourney = useCallback(async (savedJourneyId) => {
    const saved = await savedJourneys.load(savedJourneyId)
    if (!saved) return

    const draft = savedJourneyDraft(saved)
    if (!draft) return

    journey.loadSaved(draft)
  }, [journey, savedJourneys])

  /* --- Yeniden kullanma (AÇIK başlatma) -------------------------------------
     Sunucu kanonik referansları yeniden çözer, güzergahı yeniden hesaplar ve
     YENİ bir çalıştırma kimliği üretir. Yanıt mevcut kişisel kancaya
     benimsetilir: ikinci bir canlı durum ya da ikinci bir SignalR bağlantısı
     açılmaz. */
  const startSavedJourney = useCallback(async (savedJourneyId) => {
    const started = await savedJourneys.reuse(savedJourneyId)
    if (!started) return

    await journeySimulation.adopt(started)
    openJourneyPanel()
  }, [savedJourneys, journeySimulation, openJourneyPanel])

  /* --- Kişisel yolculuk geçmişi (Faz 8) --------------------------------------
     SONA ERMİŞ çalıştırmaların değişmez tutanağı. Kaydedilmiş yolculuklardan
     (Faz 7) ve canlı simülasyondan AYRI bir durumdur: burada SignalR yoktur,
     ikinci bir kişisel kanal açılmaz, hiçbir zamanlayıcı kurulmaz ve
     LocalStorage otorite olarak kullanılmaz.

     Liste yalnızca kullanıcı o bölümü AÇTIĞINDA okunur; geçmiş yalnızca bir
     yolculuk sona erdiğinde değişir.

     Paylaşılan hat bu koddan HİÇ etkilenmez. */

  const journeyHistorySectionOpen = journey.state.panel === PANEL_STATES.OPEN
    && journeyProduct === JOURNEY_PRODUCTS.PERSONAL
    && journey.state.section === PERSONAL_SECTIONS.HISTORY

  const journeyHistory = useJourneyHistory({
    permitted: allowed.canUseJourney,
    enabled: journeyHistorySectionOpen,
  })

  /* --- Yeniden yapma (AÇIK başlatma) -----------------------------------------
     Sunucu kanonik referansları yeniden çözer, güzergahı yeniden hesaplar ve
     YENİ bir çalıştırma kimliği üretir; tarihsel kimlik isteğe hiç girmez ve
     tutanak değişmez. Yanıt mevcut kişisel kancaya benimsetilir: ikinci bir
     canlı durum ya da ikinci bir SignalR bağlantısı açılmaz.

     Bu yol KAYDEDİLMİŞ YOLCULUK OLUŞTURMAZ: geçmişi yeniden yapmak onu
     saklamak değildir ve saklamak isteyen kullanıcının kendi "Kaydet" eylemi
     zaten vardır. */
  const reuseJourneyFromHistory = useCallback(async (journeyHistoryId) => {
    const started = await journeyHistory.reuse(journeyHistoryId)
    if (!started) return

    await journeySimulation.adopt(started)
    openJourneyPanel()
  }, [journeyHistory, journeySimulation, openJourneyPanel])

  /* --- Planlayıcıya yükleme (BAŞLATMA DEĞİL) ---------------------------------
     Tutanağı planlayıcıya koymak yalnızca TASLAĞI değiştirir: hiçbir simülasyon
     kurulmaz ve tarihsel çalıştırma diriltilmez — taslakta bir çalıştırma
     kimliği yoktur. Kullanıcı yüklenen yolculuğu inceleyip başlatmayı AYRICA
     seçer. */
  const loadJourneyFromHistory = useCallback(async (journeyHistoryId) => {
    /* Ayrıntı AÇIK olsa bile kimlikle yeniden istenir. Ekrandaki modeli
       okumak bir tık daha ucuz olurdu ama hangi kaydın açık olduğuna bakan
       bir kod, geç gelen bir ayrıntı cevabından sonra YANLIŞ yolculuğu
       taslağa koyabilirdi. Kimlik dondurulur; dönen kayıt istenen kayıttır. */
    const detail = await journeyHistory.openDetail(journeyHistoryId)
    if (!detail) return

    const draft = journeyHistoryDraft(detail)
    if (!draft) return

    journey.loadSaved(draft)
  }, [journey, journeyHistory])

  /* Çağrı BURADADIR: gösterilecek geometri canlı simülasyona da bağlı olduğu
     için planlayıcıdan SONRA gelmesi gerekir. Katman ve uyum davranışı
     Faz 5C'deki gibidir. */
  useJourneyPreviewLayer(mapInstance, {
    geometryWkt: journeyGeometryWkt,
    previewToken: journey.previewToken,
    /* Panel haritanın bir kenarını kapatır; hangi kenarı ve ne kadarı tek bir
       düzen modelinden gelir. Görünürlük, panelin KAPALI olmamasıdır. */
    panelVisible: journey.state.panel !== 'closed',
    compact: journeyCompact,
  })

  /* Harita seçimi yalnızca bir yuva silahlıyken devrededir; o sırada normal
     ulaşım/POI tıklaması kapatılır (aşağıda), böylece öncelik kayıt sırasına
     değil AÇIK bir moda bağlı kalır ve mod bittiğinde her şey aynen geri
     döner. */
  useJourneyWaypointPicking(mapInstance, {
    active: journey.isPicking,
    allowPoi: allowed.canViewPoi,
    isStopSelectable: isTransportRouteSelectable,
    onPick: assignActiveJourneyWaypoint,
  })

  /* POI tıklaması da yolculuk seçimi sırasında çekilir. Çağrı bilinçli olarak
     BURADADIR: koşulu `journey.isPicking`e bağlayabilmek için planlayıcıdan
     sonra gelmesi gerekir. Koşulun kendisi (`poiClickEnabled`) değişmedi. */
  usePoiInteraction(mapInstance, {
    enabled: poiClickEnabled && !journey.isPicking,
    onSelect: handlePoiSelected,
    isPoiVisible: isPoiSelectable,
  })

  useTransportStopInteraction(mapInstance, {
    // Yolculuk seçimi silahlıyken normal durak/güzergah tıklaması çekilir.
    enabled: allowed.canViewTransport && workspaceMode.isSelecting && !journey.isPicking,
    hoverEnabled: hasFinePointer,
    onSelect: handleTransportStopSelected,
    onSelectRoute: handleTransportRouteSelected,
    /* Boş tıklamada seçim bırakılır; yaşam döngüsüne dokunulmaz. */
    onClearRoute: clearSelectedTransportRoute,
    isRouteVisible: isTransportRouteSelectable,
    isStopVisible: isTransportStopSelectable,
  })

  const retireTransportStopCreate = useCallback(() => {
    setTransportStopFormOpen(false)
    setTransportStopError('')
    transportPlacement.clearPending()
    workspaceMode.stopTransportStopPlacement()
  }, [transportPlacement, workspaceMode])

  const closeTransportStopForm = useCallback(() => {
    mapContext.close(MAP_CONTEXTS.transportStopCreate)
  }, [mapContext])

  const saveTransportStop = useCallback(async ({ generatePath, ...payload }) => {
    if (transportStopSaveInFlight.current) return
    transportStopSaveInFlight.current = true
    setTransportStopSaving(true)
    setTransportStopError('')
    try {
      const result = await persistStopThenMaybeGenerate({
        save: () => createTransportStop(payload),
        routeId: payload.routeId,
        generatePath,
        saveFailureMessage: 'Durak eklenemedi.',
      })
      await transport.refresh()
      await myStops.reload()
      closeTransportStopForm()
      if (result.generationError) {
        showToast('error', `Durak eklendi ancak rota yeniden hesaplanamadı. ${result.generationError}`)
      } else if (result.routeGenerated) {
        showToast('success', 'Durak eklendi, rota hesaplandı ve harita güncellendi.')
      } else {
        showToast('success', 'Durak başarıyla eklendi.')
      }
    } catch (error) {
      setTransportStopError(error.message || 'Durak eklenemedi.')
    } finally {
      transportStopSaveInFlight.current = false
      setTransportStopSaving(false)
    }
  }, [closeTransportStopForm, showToast, transport, myStops])

  const focusMyStop = useCallback((stop) => {
    if (!stop || !Number.isFinite(stop.longitude) || !Number.isFinite(stop.latitude)) return
    mapView.focusPoint(fromLonLat([stop.longitude, stop.latitude]))
    if (!isTransportStopSelectable(stop.id)) return
    setSelectedTransportRouteId(null)
    setSelectedTransportStop({ ...stop, colorHex: stop.colorHex || stop.routeColor })
    mapContext.activate(MAP_CONTEXTS.transportStopInfo)
  }, [mapView, mapContext, isTransportStopSelectable])

  const showTransportRoute = useCallback((routeId) => {
    const routeStops = transport.stops
      .filter((stop) => stop.routeId === Number(routeId))
      .sort((left, right) => left.sequenceOrder - right.sequenceOrder || left.id - right.id)

    setSelectedTransportRouteId(Number(routeId))
    /* Durak balonundaki "Hattı Göster" de bir SEÇİMDİR ve seçimin karşılığı
       artık çalışma alanının paylaşılan bölümüdür — ayrı kart kaldırıldığı
       için aksi hâlde seçim hiçbir yerde görünmezdi. Kamera davranışı
       DEĞİŞMEZ: bu uç zaten kullanıcının açık "bana bu hattı göster"
       isteğidir; takip yine açılmaz ve simülasyon başlamaz. */
    openJourneyWorkspaceWith(JOURNEY_PRODUCTS.SHARED)
    if (selectedTransportStop?.routeId !== Number(routeId)) setSelectedTransportStop(null)
    if (routeStops.length === 0) {
      showToast('info', 'Bu güzergahın haritada gösterilecek etkin durağı yok.')
      return
    }
    if (routeStops.length === 1) {
      setSelectedTransportStop({
        ...routeStops[0],
        colorHex: routeStops[0].colorHex || routeStops[0].routeColor,
      })
      mapView.focusPoint(fromLonLat([routeStops[0].longitude, routeStops[0].latitude]))
      return
    }
    mapView.fitExtent(boundingExtent(routeStops.map((stop) => fromLonLat([stop.longitude, stop.latitude]))))
  }, [transport.stops, selectedTransportStop, mapView, showToast, openJourneyWorkspaceWith])

  const editTransportStop = useCallback((stop) => {
    if (!stop?.id || !allowed.canUpdateTransportStop) return
    const normalized = { ...stop, colorHex: stop.colorHex || stop.routeColor }
    setSelectedTransportStop(normalized)
    setTransportStopEditing(normalized)
    setTransportStopError('')
    setTransportStopEditVersion((value) => value + 1)
    mapContext.activate(MAP_CONTEXTS.transportStopEdit)
  }, [allowed.canUpdateTransportStop, mapContext])

  const cancelTransportStopRelocation = useCallback(() => {
    transportRelocation.clearPending()
    workspaceMode.stopTransportStopRelocation()
  }, [transportRelocation, workspaceMode])

  const closeTransportStopEdit = useCallback(() => {
    mapContext.close(MAP_CONTEXTS.transportStopEdit)
  }, [mapContext])

  const saveTransportStopEdit = useCallback(async ({ generatePath, ...payload }) => {
    const target = transportStopEditing
    if (!target?.id || transportStopSaveInFlight.current) return
    transportStopSaveInFlight.current = true
    setTransportStopSaving(true)
    setTransportStopError('')
    try {
      const result = await persistStopThenMaybeGenerate({
        save: () => updateTransportStop(target.id, payload),
        routeId: payload.routeId,
        generatePath,
        sourceRouteId: target.routeId,
        generateTransferredRoutes: allowed.canUpdateTransportRoute,
        reloadTransport: transport.refresh,
        saveFailureMessage: 'Durak güncellenemedi.',
      })
      const updated = result.stop
      cancelTransportStopRelocation()
      if (!result.canonicalRefreshed || result.generationAttempted || result.refreshError) {
        await transport.refresh()
      }
      await myStops.reload()
      setSelectedTransportStop({ ...updated, colorHex: updated.colorHex || updated.routeColor })
      setTransportStopEditing(null)
      mapContext.activate(MAP_CONTEXTS.transportStopInfo)
      if (result.transferred && result.refreshError) {
        showToast('error', result.refreshError)
      } else if (result.transferred) {
        const failures = result.affectedRouteOutcomes.filter((outcome) => outcome.attempted && !outcome.generated)
        if (failures.length > 0) {
          const details = failures.map((outcome) => `${outcome.routeName}: ${outcome.error}`).join(' ')
          showToast('error', `Durak taşındı ancak bazı güzergâh rotaları yeniden hesaplanamadı. ${details}`)
        } else if (result.generationAttempted) {
          showToast('success', 'Durak taşındı, etkilenen güzergâh rotaları yeniden hesaplandı.')
        } else {
          showToast('success', 'Durak başka güzergaha taşındı.')
        }
      } else if (result.generationError) {
        showToast('error', `Durak güncellendi ancak rota yeniden hesaplanamadı. ${result.generationError}`)
      } else if (result.routeGenerated) {
        showToast('success', 'Durak güncellendi, rota hesaplandı ve harita yenilendi.')
      } else {
        showToast('success', 'Durak başarıyla güncellendi.')
      }
    } catch (error) {
      cancelTransportStopRelocation()
      setTransportStopEditVersion((value) => value + 1)
      setTransportStopError(error?.message || 'Durak güncellenemedi.')
      showToast('error', error?.message || 'Durak güncellenemedi.')
    } finally {
      transportStopSaveInFlight.current = false
      setTransportStopSaving(false)
    }
  }, [transportStopEditing, cancelTransportStopRelocation, transport, myStops, mapContext, showToast, allowed.canUpdateTransportRoute])

  const requestTransportStopDelete = useCallback((stop) => {
    if (!stop?.id || !allowed.canDeleteTransportStop || transportStopBusyId != null) return
    setPendingTransportStopDelete(stop)
  }, [allowed.canDeleteTransportStop, transportStopBusyId])

  const confirmTransportStopDelete = useCallback(async () => {
    const stop = pendingTransportStopDelete
    setPendingTransportStopDelete(null)
    if (!stop?.id || transportStopBusyId != null) return
    setTransportStopBusyId(stop.id)
    try {
      const result = await deleteStopThenMaybeGenerate({
        remove: () => deleteTransportStop(stop.id),
        routeId: stop.routeId,
        generatePath: allowed.canUpdateTransportRoute,
        reloadTransport: transport.refresh,
      })
      myStops.remove(stop.id)
      if (selectedTransportStop?.id === stop.id) {
        setSelectedTransportStop(null)
        mapContext.close(MAP_CONTEXTS.transportStopInfo)
        mapContext.close(MAP_CONTEXTS.transportStopEdit)
      }
      if (result.generationAttempted) await transport.refresh()
      await myStops.reload()
      if (result.refreshError) {
        showToast('error', result.refreshError)
      } else if (result.generationError) {
        showToast('error', `Durak silindi ancak rota yeniden hesaplanamadı. ${result.generationError}`)
      } else if (result.routeGenerated) {
        showToast('success', 'Durak silindi, rota yeniden hesaplandı ve harita güncellendi.')
      } else {
        showToast('success', 'Durak çöp kutusuna taşındı.')
      }
    } catch (error) {
      showToast('error', error?.message || 'Durak silinemedi.')
    } finally {
      setTransportStopBusyId(null)
    }
  }, [pendingTransportStopDelete, transportStopBusyId, myStops, selectedTransportStop, mapContext, transport, showToast, allowed.canUpdateTransportRoute])

  useEffect(() => {
    if (allowed.canViewTransport) return
    setSelectedTransportStop(null)
    setSelectedTransportRouteId(null)
    mapContext.close(MAP_CONTEXTS.transportStopInfo)
    mapContext.close(MAP_CONTEXTS.transportStopEdit)
    mapContext.close(MAP_CONTEXTS.myStops)
  }, [allowed.canViewTransport, mapContext])

  useEffect(() => {
    if (allowed.canCreateTransportStop) return
    mapContext.close(MAP_CONTEXTS.transportStopCreate)
  }, [allowed.canCreateTransportStop, mapContext])

  useEffect(() => {
    if (allowed.canUpdateTransportStop) return
    mapContext.close(MAP_CONTEXTS.transportStopEdit)
    cancelTransportStopRelocation()
  }, [allowed.canUpdateTransportStop, mapContext, cancelTransportStopRelocation])

  useEffect(() => {
    if (workspaceMode.isPlacingTransportStop) return
    mapContext.close(MAP_CONTEXTS.transportStopCreate)
  }, [workspaceMode.isPlacingTransportStop, mapContext])

  useEffect(() => {
    if (!selectedTransportStop) return
    if (transport.stops.some((stop) => stop.id === selectedTransportStop.id)) return
    setSelectedTransportStop(null)
    mapContext.close(MAP_CONTEXTS.transportStopInfo)
    mapContext.close(MAP_CONTEXTS.transportStopEdit)
  }, [selectedTransportStop, transport.stops, mapContext])

  useEffect(() => {
    if (selectedTransportRouteId == null) return
    if (transport.routes.some((route) => route.id === selectedTransportRouteId)) return
    setSelectedTransportRouteId(null)
  }, [selectedTransportRouteId, transport.routes])

  const globalSearchTypes = useMemo(() => [
    ...(allowed.canViewPoi ? [{ id: 'poi', label: 'POI' }] : []),
    ...(allowed.canViewDrawings ? [{ id: 'drawing', label: 'Çizim' }] : []),
    ...(allowed.canViewTransport
      ? [{ id: 'stop', label: 'Durak' }, { id: 'route', label: 'Güzergah' }]
      : []),
  ], [allowed.canViewPoi, allowed.canViewDrawings, allowed.canViewTransport])

  useEffect(() => {
    if (globalSearchTypes.length === 0) setPoiSearchOpen(false)
  }, [globalSearchTypes])

  /* Kategoriler artık HARİTANIN KENDİSİ için de gereklidir, yalnızca form için
     değil: POI'nin vektör rozeti kategorisinin simgesini ve rengini taşır ve o
     metadata yalnızca bu uçtan gelir (harita sözleşmesi `GET /api/poi` bilinçli
     olarak yalnızca ad/yol taşır — sunum metadatası kategorinin kendisine
     aittir, kaydın kopyasına değil).

     Yetki aynıdır (`poi.view`), dolayısıyla yeni bir yetki yüzeyi açılmaz;
     eklenen tek şey, POI görebilen bir kullanıcının harita açılışında bir kez
     daha küçük bir GET yapmasıdır. Metadata gelmeden de POI kaybolmaz: nötr
     renkli bir MapPin rozetiyle çizilir ve liste gelince yerine oturur. */
  /**
   * Uçan bir kategori okuması var mı.
   *
   * <b><c>loading</c> bunu GÜVENİLİR biçimde söyleyemez.</b> O bir React
   * state'idir ve yalnızca bir sonraki render'da görünür hâle gelir; aynı
   * karede iki kez çağrılan bir yükleyici ikisinde de <c>false</c> görür ve iki
   * özdeş GET açar. Ref eşzamanlı güncellenir, dolayısıyla ikinci çağrı
   * birincisini ANINDA görür.
   *
   * Bunun somut görüldüğü yer React'in <c>StrictMode</c>'udur: geliştirme
   * modunda her effect monte → temizle → yeniden monte edilir ve her iki
   * çalıştırma da aynı commit içinde, hiçbir state güncellemesi işlenmeden
   * gerçekleşir. Ama sorun StrictMode'a ÖZGÜ değildir — tetikleyici bayrak
   * hızlıca değiştiğinde üretimde de aynı çift istek oluşurdu.
   *
   * Aynı korumanın POI kaydetme tarafındaki karşılığı <c>poiSaveInFlight</c>'tir.
   */
  const poiCategoriesInFlight = useRef(false)

  const loadPoiCategories = useCallback(async () => {
    // İkinci bir eşzamanlı okuma AÇILMAZ: aynı yanıtı iki kez indirmek olurdu.
    if (poiCategoriesInFlight.current) return

    poiCategoriesInFlight.current = true
    setPoiCategories((current) => ({ ...current, loading: true, error: '' }))
    try {
      const res = await fetchPoiCategories()
      if (!res.ok) throw new Error(await readApiError(res, 'Kategoriler yüklenemedi.'))
      setPoiCategories({ items: await res.json(), loading: false, error: '', loaded: true })
    } catch (error) {
      setPoiCategories({
        items: [],
        loading: false,
        error: error.message || 'Kategoriler yüklenemedi.',
        loaded: true,
      })
    } finally {
      /* Bayrak HER SONUÇTA bırakılır. Hatadan sonra bırakılmasaydı "Tekrar
         dene" sessizce hiçbir şey yapmayan bir düğmeye dönerdi. */
      poiCategoriesInFlight.current = false
    }
  }, [])

  /* Düzenleme formu da aynı listeyi kullanır: iki form, tek okuma. Harita da
     aynı okumayı paylaşır — rozetler için ÜÇÜNCÜ bir istek açılmaz. */
  const poiNeedsCategories =
    allowed.canViewPoi || poiFormOpen || mapContext.isActive(MAP_CONTEXTS.poiEdit)

  /* Okuma bir KEZ yapılır. Ölçüt "elimde kayıt var mı" DEĞİL, "bu okuma
     tamamlandı mı"dır: kategori tanımlanmamış bir kurulumda boş liste geçerli
     bir yanıttır ve `items.length`'e bakan bir koşul onu "hiç okumadım" sayıp
     isteği sonsuz bir döngüye sokuyordu (tek bir oturumda binlerce çağrı) —
     üstelik `loading` sürekli true kaldığı için form da kalıcı olarak
     "yükleniyor" görünüyor, kullanıcı kategori olmadığını hiç öğrenemiyordu.

     Bağımlılıklar da nesnenin tamamı değil, kararı veren iki bayraktır: her
     liste değişimi bu etkiyi yeniden çalıştırmamalıdır. Hatadan sonra yeniden
     denemek kullanıcının açık eylemidir ("Tekrar dene") ve `loadPoiCategories`'i
     doğrudan çağırır. */
  useEffect(() => {
    if (!poiNeedsCategories || poiCategories.loading || poiCategories.loaded) return
    loadPoiCategories()
  }, [poiNeedsCategories, poiCategories.loading, poiCategories.loaded, loadPoiCategories])

  /* --- Konum analizi ---------------------------------------------------------

     Ödevin "Konum Analizi" özelliği. Mevcut ısı haritasının KARDEŞİDİR, devamı
     değil: o, kişinin kendi çizim noktalarının yoğunluğunu gösterir; bu, ortak
     açık veri POI kümesini (analysis_poi) kategori ağırlıklarıyla puanlar ve
     `location.analysis` + `poi.view` ister.

     Durum sahipliği üçe ayrılır ve hiçbiri diğerini kopyalamaz:
       · TASLAK form (burada): alan kipi, il, ölçütler, ağırlıklar.
       · GÖNDERİLMİŞ analiz (burada, `activeAnalysis`): "ANALİZİ BAŞLAT"
         anındaki anlık görüntü.
       · Katman yaşam döngüsü (`useLocationAnalysisLayer`): yalnızca gönderilmiş
         anlık görüntüyü okur.

     Ayrım ödevin gereğidir: kullanıcı bir ağırlığı değiştirdiğinde harita
     SESSİZCE yeniden boyanmaz — analiz, kullanıcının başlattığı bir eylemdir. */

  const canOpenLocationAnalysis = allowed.canRunLocationAnalysis
  const locationAnalysisOpen =
    canOpenLocationAnalysis && mapContext.isActive(MAP_CONTEXTS.locationAnalysis)
  const analysisCatalog = useLocationAnalysisTargetCatalog({
    enabled: locationAnalysisOpen,
    cacheKey: canOpenLocationAnalysis ? userId : null,
  })

  const [areaMode, setAreaMode] = useState('province')
  const [provinceCode, setProvinceCode] = useState('')
  const [criteria, setCriteria] = useState(() => [emptyCriterion(), emptyCriterion()])
  const [analysisStatus, setAnalysisStatus] = useState('idle')
  const [analysisSummary, setAnalysisSummary] = useState(null)
  const [analysisError, setAnalysisError] = useState('')

  const locationArea = useLocationAnalysisArea(mapInstance, {
    // Çizim etkileşimi YALNIZCA mod ona aitken canlıdır — diğer araçlarla
    // aynı sözleşme, dolayısıyla dışlayıcılık yapısaldır.
    active: workspaceMode.activeLocationAnalysisTool !== null,
    /* Analiz alanı da çizim/POI ile AYNI coğrafi sınıra tabidir. */
    scope: geographic.scope,
    onRejected: (message) =>
      showToast('error', message, { id: 'geographic-scope', timeout: 5000, placement: 'top' }),
  })

  /* Isı haritası görünümü: boş = ağırlıklı birleşik, dolu = tek ölçüt.
     Gönderilmiş analiz DEĞİŞMEZ; bu yalnızca aynı analizin hangi kesitinin
     çizildiğidir. */
  const [heatmapCriterion, setHeatmapCriterion] = useState('')

  const locationAnalysisLayer = useLocationAnalysisLayer(mapInstance, {
    analysis: activeAnalysis,
    permitted: canOpenLocationAnalysis,
    criterionSlug: heatmapCriterion,
  })

  /* Örtü VARSAYILAN OLARAK KAPALIDIR. Analizin cevabı ısı haritasıdır;
     binlerce nokta onun üstüne kendiliğinden serilirse, kullanıcının
     sormadığı bir ayrıntı asıl sonucu örterdi. */
  const [poiOverlayVisible, setPoiOverlayVisible] = useState(false)

  /* İdari hedefler birleşik WKT'den tarayıcıda yeniden TÜRETİLMEZ.
     Backend, yürürlükteki kaynak kimliklerini ve kanonik ilişkiyi kullanır. */
  const analysisProvinces = analysisCatalog.provinces
  const analysisRegions = analysisCatalog.regions

  /* Bölge, ilin ÜSTÜdür: seçilince il listesi o bölgenin illerine daralır.
     Bölge tek başına da bir hedef alandır. */
  const [regionKey, setRegionKey] = useState('')

  /* Bölge seçiliyse il listesi o bölgenin illerine daralır; yetki süzmesi
     ZATEN uygulanmıştır, bu ikinci bir daraltmadır. */
  const visibleProvinces = useMemo(() => {
    const region = regionKey ? analysisRegions.find((item) => item.key === regionKey) : null
    if (!region) return analysisProvinces
    const codes = new Set(region.provinceKeys ?? [])
    return analysisProvinces.filter((province) => codes.has(province.code))
  }, [analysisProvinces, analysisRegions, regionKey])

  const locationAnalysisPoiLayer = useLocationAnalysisPoiLayer(mapInstance, {
    analysis: activeAnalysis,
    permitted: canOpenLocationAnalysis,
    visible: poiOverlayVisible,
    categories: poiCategories.items,
    criterionSlug: heatmapCriterion,
    /* Rozetin simgesi ve rengi NORMAL POI'lerle AYNI eşlemeden gelir; analiz
       için ikinci bir kategori metadatası kurulmaz. */
    categoryPresentation: poiCategoryPresentation,
  })

  /* İnceleme, POI bilgi paneli ve çizim seçimiyle AYNI sahiplik kuralına
     uyar: haritanın tıklamasının sahibi olan bir araç varken devreye girmez.
     Ek olarak yalnızca örtü AÇIKKEN anlamlıdır — görünmeyen bir noktayı
     tıklamak diye bir şey yoktur. */
  const analysisPoiClickEnabled =
    poiOverlayVisible
    && workspaceMode.isSelecting
    && workspaceMode.activeSelectionTool !== 'polygon'
    /* Yolculuk seçimi de bir sahiptir. Kapatılan YALNIZCA tıklama
       inceleyicisidir: analiz sonucu, ısı haritası ve açık kart yerinde kalır. */
    && !journey.isPicking

  const analysisPoiInspect = useLocationAnalysisPoiInspect(mapInstance, {
    analysis: activeAnalysis,
    permitted: canOpenLocationAnalysis,
    visible: poiOverlayVisible,
    enabled: analysisPoiClickEnabled,
  })

  /* Gönderilmiş analiz, TASLAK değiştiği anda düşer. Eski bir ısı haritasını
     yeni ölçütlerin sonucuymuş gibi ekranda bırakmak, kullanıcıya yanlış bir
     cevabı doğru gibi göstermek olurdu. */
  const invalidateAnalysis = useCallback(() => {
    setActiveAnalysis(null)
    setAnalysisSummary(null)
    setAnalysisError('')
    setAnalysisStatus('idle')
  }, [])

  const locationValidation = useMemo(
    () => validateAnalysis({ areaWkts: locationArea.areaWkts, criteria, categories: poiCategories.items }),
    [locationArea.areaWkts, criteria, poiCategories.items],
  )

  const handleAreaModeChange = useCallback(
    (nextMode) => {
      invalidateAnalysis()
      setAreaMode(nextMode)
      setProvinceCode('')
      setRegionKey('')
      locationArea.clearArea()

      /* Çizim kipi MOD MAKİNESİNDEN açılır; burada doğrudan bir Draw
         eklenmez. İl kipine dönmek de modu bırakır, yoksa görünmeyen bir
         çizim aracı ayakta kalırdı. */
      if (nextMode === 'draw') {
        if (!workspaceMode.isSelectingAnalysisArea) allowed.toggleLocationAnalysisTool()
      } else if (workspaceMode.isSelectingAnalysisArea) {
        workspaceMode.stopLocationAnalysis()
      }
    },
    [invalidateAnalysis, locationArea, workspaceMode, allowed],
  )

  /**
   * Bölge seçimi.
   *
   * Bölge TEK BAŞINA da bir hedef alandır: kullanıcı il seçmeden "İç Anadolu"
   * için analiz çalıştırabilir. İl seçilirse il KAZANIR — daha dar olan
   * kullanıcının son söylediği şeydir.
   */
  const handleRegionChange = useCallback(
    (key) => {
      invalidateAnalysis()
      setRegionKey(key)
      setProvinceCode('')

      if (!key) {
        locationArea.clearArea()
        return
      }

      const region = analysisRegions.find((item) => item.key === key)
      const wkts = region?.areaWkts ?? []
      locationArea.setProvinceArea(
        wkts,
        `${region?.name ?? 'Seçilen bölge'} Bölgesi`,
      )
      locationArea.fitToArea()
    },
    [analysisRegions, invalidateAnalysis, locationArea],
  )

  const handleProvinceChange = useCallback(
    (code) => {
      invalidateAnalysis()
      setProvinceCode(code)

      if (!code) {
        locationArea.clearArea()
        return
      }

      /* Çok parçalı iller BİRLEŞTİRİLMEZ: sözleşme zaten bir liste alır ve
         yalnızca en büyük parçayı almak o ilin adalarını analiz dışında
         bırakırdı. */
      const selectedProvince = analysisProvinces.find((item) => item.key === code)
      const wkts = selectedProvince?.areaWkts ?? []
      const province = selectedProvince?.name ?? 'Seçilen il'
      locationArea.setProvinceArea(wkts, wkts.length > 1 ? `${province} (${wkts.length} parça)` : province)
      locationArea.fitToArea()
    },
    [analysisProvinces, invalidateAnalysis, locationArea],
  )

  const handleCriterionChange = useCallback(
    (index, patch) => {
      invalidateAnalysis()
      setCriteria((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
    },
    [invalidateAnalysis],
  )

  const handleAddCriterion = useCallback(() => {
    invalidateAnalysis()
    setCriteria((current) => (current.length >= MAX_CRITERIA ? current : [...current, emptyCriterion()]))
  }, [invalidateAnalysis])

  const handleRemoveCriterion = useCallback(
    (index) => {
      invalidateAnalysis()
      setCriteria((current) => (current.length <= MIN_CRITERIA ? current : current.filter((_, i) => i !== index)))
    },
    [invalidateAnalysis],
  )

  /**
   * "ANALİZİ BAŞLAT".
   *
   * ÖNCE kompakt özet istenir, SONRA raster. İki nedeni var: özet sunucunun
   * doğrulamasını ve gerçekten eşleşen POI olup olmadığını söyler, ve boş bir
   * sonuçta saydam bir rasteri "sonuç" diye göstermek yerine dürüst bir boş
   * durum gösterilebilir. Özet binlerce nokta DEĞİL, ölçüt başına birer sayaç
   * döndürür.
   */
  const handleRunAnalysis = useCallback(async () => {
    if (!locationValidation.valid) return

    const snapshot = {
      areaWkts: [...locationArea.areaWkts],
      criteria: toRequestCriteria(criteria, poiCategories.items),
      administrativeTargetType: provinceCode ? 'province' : regionKey ? 'region' : undefined,
      administrativeTargetKey: provinceCode || regionKey || undefined,
    }

    setActiveAnalysis(null)
    setAnalysisSummary(null)
    setAnalysisError('')
    setAnalysisStatus('loading')

    try {
      const res = await analyzeLocation(snapshot)
      if (!res.ok) throw new Error(await readApiError(res, 'Analiz çalıştırılamadı.'))

      const body = await res.json()
      setAnalysisSummary(body)
      /* Başarılı özet (boş sonuç dahil) artık analiz sonucudur. Normal POI
         tercihi yerinde kalır ama Temizle'ye kadar haritada bastırılır. */
      setLocationAnalysisResultActive(true)

      if (!body.totalMatchingPoiCount) {
        // Boş sonuç bir HATA değildir; ama saydam bir raster de bir cevap değildir.
        setAnalysisStatus('empty')
        return
      }

      setAnalysisStatus('done')
      /* Yeni analiz birleşik görünümle açılır: önceki analizin ölçüt kesiti,
         yeni ölçüt kümesinde var olmayabilir. */
      setHeatmapCriterion('')
      setActiveAnalysis(snapshot)
    } catch (runError) {
      setAnalysisError(runError?.message || 'Analiz çalıştırılamadı.')
      setAnalysisStatus('error')
    }
  }, [locationValidation.valid, locationArea.areaWkts, criteria, poiCategories.items, provinceCode, regionKey])

  const handleClearAnalysis = useCallback(() => {
    invalidateAnalysis()
    setLocationAnalysisResultActive(false)
    /* Örtü de kapanır: "Temizle" ekranı analiz öncesine döndürür ve açık
       kalan bir anahtar, bir sonraki analizde sorulmadan nokta çizerdi.
       Açık POI kartı da onunla gider — gösterdiği kayıt silinen analize
       aitti. */
    setPoiOverlayVisible(false)
    setHeatmapCriterion('')
    analysisPoiInspect.close()
    setCriteria([emptyCriterion(), emptyCriterion()])
    setProvinceCode('')
    setRegionKey('')
    locationArea.clearArea()
    if (workspaceMode.isSelectingAnalysisArea) workspaceMode.stopLocationAnalysis()
  }, [invalidateAnalysis, locationArea, workspaceMode, analysisPoiInspect])

  /* Canlı yetki yenilemesi bu ekran açıkken erişimi kaldırabilir. Katmanı
     sökmek hook'un, paneli kapatmak ve gönderilmiş analizi düşürmek bu
     sayfanın işidir. */
  useEffect(() => {
    if (canOpenLocationAnalysis) return
    invalidateAnalysis()
    setLocationAnalysisResultActive(false)
    mapContext.close(MAP_CONTEXTS.locationAnalysis)
  }, [canOpenLocationAnalysis, invalidateAnalysis, mapContext])


  /**
   * POI oluşturma bağlamının EMEKLİLİĞİ: form, bekleyen işaret ve yerleştirme
   * modu birlikte bırakılır.
   *
   * Koordinatörü BURADAN çağırmaz (activate/close yok): bu fonksiyon zaten
   * koordinatörün emeklilik tablosundan çalışır ve kendini geri çağırmak
   * özyineleme olurdu. Bağlamı kapatmak isteyen çağıranlar
   * `mapContext.close(MAP_CONTEXTS.poiCreate)` kullanır.
   */
  const retirePoiCreate = useCallback(() => {
    setPoiFormOpen(false)
    setPoiError('')
    clearPendingPoi()
    workspaceMode.stopPoiPlacement()
  }, [clearPendingPoi, workspaceMode])

  /** Formun "İptal"i ve × düğmesi: bağlamı koordinatör üzerinden kapatır. */
  const closePoiForm = useCallback(() => {
    mapContext.close(MAP_CONTEXTS.poiCreate)
  }, [mapContext])

  const savePoi = useCallback(async (payload) => {
    // Çift gönderim koruması: düğme de kilitlenir, ama ref yarışı da kapatır.
    if (poiSaveInFlight.current) return
    poiSaveInFlight.current = true
    setPoiSaving(true)
    setPoiError('')

    try {
      const res = await createPoi(payload)

      if (!res.ok) {
        /* Sunucunun mesajı olduğu gibi gösterilir — coğrafi yetki reddi dâhil.
           O mesaj izin verilen alanı AÇIKLAMAZ, yalnızca burada eklenemediğini
           söyler; arayüz de fazlasını uydurmaz. */
        throw new Error(await readApiError(res, 'POI eklenemedi.'))
      }

      /* Yanıt kaydın kanonik hâlidir ve listeyle AYNI eşlemeden geçer; ikinci
         bir GET, az önce yazılanı yeniden indirmek olurdu. */
      addPoiToLayer(await res.json())
      /* Raster VERİTABANINDAKİ hâli gösterir; yazma tuttuğuna göre görüntü
         eskidi. Yeni kayıt, yerine geleni gelene kadar vektör olarak görünür
         kalır — bu yüzden hiçbir anda kaybolmaz. */
      invalidatePoiPresentation()
      closePoiForm()
      showToast('success', 'POI başarıyla eklendi.')
    } catch (error) {
      /* Başarısızlıkta form AÇIK kalır, girilen değerler ve bekleyen konum
         yerinde durur: kullanıcı düzeltip yeniden deneyebilmelidir. Kalıcı
         kaynağa hiçbir şey eklenmez. */
      setPoiError(error.message || 'POI eklenemedi.')
    } finally {
      poiSaveInFlight.current = false
      setPoiSaving(false)
    }
  }, [addPoiToLayer, closePoiForm, invalidatePoiPresentation, showToast])

  /* --- POI düzenleme / silme ------------------------------------------------
     İkisi de SUNUCUNUN kararını uygular, onu ikinci kez üretmez: hangi kayıtta
     hangi eylemin sunulacağını kaydın `canUpdate` / `canDelete` bayrakları
     söyler ve o bayrakları sunucu hesaplar (poi.manage VEYA sahiplik VE
     poi.update/poi.delete). Buradaki hiçbir koşul kaydın sahibini tahmin
     etmeye çalışmaz; uçlar da aynı kararı bağımsız olarak yeniden verir. */

  /** Düzenlenmekte olan POI; POI Düzenle bağlamının konusu. */
  const [poiEditing, setPoiEditing] = useState(null)

  /* Düzenlemenin TASLAK konumu ve "Haritada Taşı" kipi.
     Değer burada tutulur, formda değil: aynı sayıyı iki yer düzenler —
     formdaki boylam/enlem kutuları ve haritada sürüklenen taslak işaret. İki
     kopya, kutularla işaretin bir noktada ayrışması demek olurdu. Kalıcı kayıt
     ve haritadaki kalıcı işaret, BAŞARILI bir güncellemeye kadar yerinde
     durur. */
  const [poiEditCoordinate, setPoiEditCoordinate] = useState(null)
  const [poiMoveActive, setPoiMoveActive] = useState(false)

  /**
   * Bir kaydı düzenlemeye açarken taslağın başlangıç durumu.
   *
   * `draft` yalnızca başka bir ekrandan devralınan kaydedilmemiş taslak için
   * doludur; konumu da o belirler, aksi hâlde kaydın kalıcı koordinatı.
   */
  const beginPoiEdit = useCallback((record, draft = null) => {
    setPoiError('')
    setPoiEditing(record)

    const handedOver =
      Number.isFinite(draft?.longitude) && Number.isFinite(draft?.latitude)
        ? { longitude: draft.longitude, latitude: draft.latitude }
        : null

    setPoiEditCoordinate(
      handedOver
        ?? (Number.isFinite(record?.longitude) && Number.isFinite(record?.latitude)
          ? { longitude: record.longitude, latitude: record.latitude }
          : null),
    )
    // Taşıma kipi her düzenlemede KAPALI başlar: bir önceki kayıttan devralınan
    // sürüklenebilir bir işaret, kullanıcının açmadığı bir araç olurdu.
    setPoiMoveActive(false)
  }, [])

  /* Taslak işaret ve taşıma etkileşimi. Etkileşim yalnızca düzenleme bağlamı
     açıkken ve yalnızca "Haritada Taşı" seçiliyken kurulur; kalıcı POI
     kaynağına hiçbir koşulda dokunmaz. */
  usePoiEditDraft(mapInstance, {
    active: mapContext.isActive(MAP_CONTEXTS.poiEdit) && Boolean(poiEditing),
    coordinate: poiEditCoordinate,
    /* Taşınabilirlik kaydın KENDİ yetenek bayrağına bakar — sunucunun kararı
       budur ve tarayıcıda yeniden hesaplanmaz. */
    movable: poiMoveActive && poiEditing?.canUpdate === true,
    onMove: setPoiEditCoordinate,
  })

  /* --- Yönetim panelinden devralınan düzenleme ------------------------------
     `/admin/poi` ekranında "Haritada Taşı"ya basıldığında oraya kaydedilmemiş
     bir taslakla birlikte gelinir. Devralma AYNI düzenleme bağlamına girer
     (`MAP_CONTEXTS.poiEdit`), aynı formu ve aynı taslak işaretini kullanır;
     "harita üzerinde yönetim düzenlemesi" diye ikinci bir birincil bağlam
     açmak, tek-birincil-panel kuralını iki farklı yerden yönetmek olurdu.

     <b>Gezinme durumu İSTEMCİ GİRDİSİDİR.</b> İçinden yalnızca kimlik ve
     taslak DEĞERLER okunur; hiçbir yetki iddiası taşınmaz ve taşınsa da
     kullanılmazdı. Kaydın kendisi haritanın kendi listesinden çözülür,
     düzenlenebilirliği sunucunun o kayıt için verdiği `canUpdate` bayrağından
     okunur ve PUT yine sunucuda sahiplik, kategori, koordinat ve coğrafi
     yetki denetiminden geçer. */
  const [poiEditHandoffDraft, setPoiEditHandoffDraft] = useState(null)

  /* Yönlendirme durumunun temizlenmesi bir sonraki render'da görünür; bu arada
     etki (örneğin katman yüklenmesi bittiği için) yeniden çalışabilir. Ref,
     devralmanın GERÇEKTEN tek sefer uygulanmasını garanti eder. */
  const consumedHandoffRef = useRef(false)

  const poiEditHandoff = location.state?.poiEditHandoff ?? null

  useEffect(() => {
    if (!poiEditHandoff || consumedHandoffRef.current) return

    if (!allowed.canViewPoi) {
      // Yetkisiz çağıran için devralma sessizce tüketilir; panel açılmaz.
      consumedHandoffRef.current = true
      navigate(location.pathname, { replace: true, state: null })
      return
    }

    /* İLK OKUMA BİTENE KADAR KARAR VERİLMEZ.
       Ölçüt `!loading` DEĞİL, `loaded`'dır: kanca `loading: false` ile doğar ve
       okumayı bir effect başlatır, dolayısıyla ilk render'da kaynak boştur ama
       istek daha yola çıkmamıştır. "Yüklenmiyor" ile "yüklendi" karıştırılırsa
       devralma, veri gelmeden önce "kayıt bulunamadı" diye reddedilir — ve
       reddetme tek seferlik olduğu için veri sonradan gelse de düzenleme bir
       daha açılmaz. */
    if (!poi.loaded) return

    const record = findPoiOnLayer(poiEditHandoff.poiId)

    consumedHandoffRef.current = true

    /* Devralma TEK SEFERLİKTİR ve her durumda tüketilir: aksi hâlde başka bir
       panel açmak, geri/ileri gitmek ya da sayfayı yenilemek eskimiş bir
       taslağı yeniden uygulardı. */
    navigate(location.pathname, { replace: true, state: null })

    /* Kayıt silinmiş, artık görünmüyor ya da bu çağıran düzenleyemiyorsa
       düzenlemeye HİÇ girilmez. Mesaj sahiplik ayrıntısı açıklamaz. */
    if (!record?.canUpdate) {
      showToast('error', 'Bu POI kaydı artık düzenlenemiyor.')
      return
    }

    const draft = poiEditHandoff.draft ?? null

    setSelectedPoi(record)
    /* Konum taslağı da devralınır: yönetimde elle değiştirilmiş bir koordinat
       haritada taslak işaretin AÇILIŞ yeri olur. Kalıcı işaret kaydedilene
       kadar eski yerinde durur — kalıcı/taslak ayrımı bozulmaz. */
    beginPoiEdit(record, draft)
    setPoiEditHandoffDraft(draft)
    mapContext.activate(MAP_CONTEXTS.poiEdit)
  }, [
    poiEditHandoff,
    allowed.canViewPoi,
    poi.loaded,
    findPoiOnLayer,
    beginPoiEdit,
    mapContext,
    navigate,
    location.pathname,
    showToast,
  ])

  /** "Düzenle": bilgi panelinden düzenleme bağlamına geçilir. */
  const startPoiEdit = useCallback(() => {
    if (!selectedPoi?.canUpdate) return
    beginPoiEdit(selectedPoi)
    mapContext.activate(MAP_CONTEXTS.poiEdit)
  }, [selectedPoi, beginPoiEdit, mapContext])

  /** POI Düzenle bağlamının emekliliği. Koordinatörü çağırmaz (bkz. yukarısı). */
  const retirePoiEdit = useCallback(() => {
    setPoiEditing(null)
    setPoiError('')
    /* Taslak konum ve taşıma kipi de bırakılır: düzenleme oturumu bittiğinde
       haritada, artık hiçbir formun anlatmadığı sürüklenebilir bir işaret
       kalmamalıdır. Kalıcı kayıt zaten hiç kıpırdamadı. */
    setPoiEditCoordinate(null)
    setPoiMoveActive(false)
    // Devralınan taslak da bırakılır: bir sonraki düzenleme onu miras almaz.
    setPoiEditHandoffDraft(null)
  }, [])

  /** "İptal": düzenlemeden ÇIKIP bilgi paneline döner, hiçbir şey kaydetmeden. */
  const cancelPoiEdit = useCallback(() => {
    if (selectedPoi) mapContext.activate(MAP_CONTEXTS.poiInfo)
    else mapContext.close(MAP_CONTEXTS.poiEdit)
  }, [selectedPoi, mapContext])

  const savePoiEdit = useCallback(
    async (payload) => {
      const target = poiEditing
      if (!target || poiSaveInFlight.current) return

      poiSaveInFlight.current = true
      setPoiSaving(true)
      setPoiError('')

      try {
        const res = await updatePoi(target.id, payload)
        if (!res.ok) throw new Error(await readApiError(res, 'POI güncellenemedi.'))

        /* Yanıt kaydın kanonik hâlidir: katman yerinde tazelenir, tam sayfa
           yenilemesi ya da listenin baştan okunması gerekmez. */
        const updated = await res.json()
        updatePoiOnLayer(updated)
        invalidatePoiPresentation()
        // Bilgi paneli aynı kaydı gösterdiği için o da tazelenir.
        setSelectedPoi(updated)
        // "POI'lerim" de aynı kaydı gösterebilir; yerinde tazelenir.
        replaceMyPoi(updated)
        mapContext.activate(MAP_CONTEXTS.poiInfo)
        showToast('success', 'POI güncellendi.')
      } catch (error) {
        /* Başarısızlıkta form AÇIK kalır ve girilen değerler durur: sunucunun
           mesajı (yetki/sahiplik reddi dâhil) olduğu gibi gösterilir. */
        setPoiError(error.message || 'POI güncellenemedi.')
      } finally {
        poiSaveInFlight.current = false
        setPoiSaving(false)
      }
    },
    [poiEditing, updatePoiOnLayer, invalidatePoiPresentation, replaceMyPoi, mapContext, showToast],
  )

  /** "Sil": önce onay. Soft delete de olsa kullanıcı ne olduğunu bilmelidir. */
  const requestPoiDelete = useCallback(() => {
    if (selectedPoi?.canDelete) setPendingPoiDelete(selectedPoi)
  }, [selectedPoi])

  const confirmPoiDelete = useCallback(async () => {
    const target = pendingPoiDelete
    setPendingPoiDelete(null)
    if (!target) return

    setPoiSaving(true)
    try {
      const res = await deletePoi(target.id)
      if (!res.ok) throw new Error(await readApiError(res, 'POI silinemedi.'))

      /* Kayıt veritabanında DURUR (soft delete); haritadan kaldırılan yalnızca
         temsilidir ve Çöp Kutusu'ndan geri yüklenebilir. */
      removePoiFromLayer(target.id)
      removeMyPoi(target.id)
      invalidatePoiPresentation()
      // Silinen kaydın bilgi paneli açık kalamaz.
      if (selectedPoi?.id === target.id) mapContext.close(MAP_CONTEXTS.poiInfo)
      showToast('success', 'POI çöp kutusuna taşındı.')
    } catch (error) {
      showToast('error', error.message || 'POI silinemedi.')
    } finally {
      setPoiSaving(false)
    }
  }, [pendingPoiDelete, removePoiFromLayer, removeMyPoi, invalidatePoiPresentation, selectedPoi, mapContext, showToast])

  /* --- "POI'lerim" eylemleri -------------------------------------------------
     Üçü de HARİTADAKİ akışların ta kendisini çağırır: ayrı bir seçim, ayrı bir
     form ya da ikinci bir silme yolu YOKTUR. Panelden yapılan bir düzenleme,
     POI'ye haritada tıklayıp Düzenle demekle aynı bağlamı ve aynı isteği
     kullanır. */

  /**
   * Satır: haritada ODAKLAN + POI Bilgisi'ni aç (bağlam devri dâhil).
   *
   * `panTo` değil `focusPoint`: yalnızca ortalamak, Türkiye ölçeğinde açılmış
   * bir haritada kullanıcıyı hâlâ ayırt edilemeyen bir noktanın karşısında
   * bırakırdı. `focusPoint` gerekiyorsa yakınlaştırır ama zaten daha yakındaysa
   * GERİ ÇEKMEZ (bkz. `useMapView`).
   *
   * Kamera yardımcısı `mapView` ÜZERİNDEN okunur, ayrıca destructure edilmiş
   * bir bağlamadan değil: o bağlamalar bu satırdan SONRA tanımlanır ve
   * bağımlılık dizisi render sırasında değerlendirildiği için `const`'un
   * temporal dead zone'una düşerdi — sayfa daha ilk render'da patlardı.
   */
  const focusMyPoi = useCallback(
    (poi) => {
      if (!poi) return
      mapView.focusPoint(fromLonLat([poi.longitude, poi.latitude]))
      setSelectedPoi(poi)
      mapContext.activate(MAP_CONTEXTS.poiInfo)
    },
    [mapView, mapContext],
  )

  /**
   * Arama sonucuna odaklan.
   *
   * <b>Kamera yardımcısı YENİDEN YAZILMAZ</b> ama arama POI kamerasını kullanır:
   * `focusPoi` sabit bir HEDEF yakınlığa yerleşir ve gerekirse UZAKLAŞIR.
   * `focusPoint`'in "asla geri çekme" kuralı POI'lerim ve envanter gezinmesi
   * için doğrudur, ama aramada 19. seviyeden başka bir POI'ye gidildiğinde
   * kullanıcıyı çevresiz bir yakınlıkta bırakırdı. `setCenter`/`setZoom`
   * çağırmak ise bu kuralın ikinci ve kaçınılmaz olarak ayrışacak bir
   * kopyasını üretirdi. Aynı yardımcıyı POI Bilgisi panelindeki "Zoom Yap" da
   * çağırır — iki eylem aynı yerde biter.
   *
   * <b>Kalıcı bir işaret EKLENMEZ.</b> POI'nin haritadaki gösterimi Faz 4'teki
   * WMS rasterine aittir; ikinci bir katman aynı POI'yi iki kez çizerdi.
   *
   * Bilgi paneli yalnızca kayıt zaten haritada YÜKLÜYSE açılır: arama sonucu
   * dar bir sözleşmedir (yetenek bayrakları ve mesai taşımaz) ve paneli eksik
   * bir kayıtla beslemek, düzenle/sil düğmelerinin yanlış davranması demek
   * olurdu. Kanonik kayıt vektör kaynağından okunur.
   */
  const focusSearchResult = useCallback(
    (result) => {
      if (!result) return

      if (result.searchType === 'drawing') {
        workspace.selectFeature(result.key)
        const extent = workspace.extentOf(result.key)
        if (extent) mapView.fitExtent(extent)
        mapContext.activate(MAP_CONTEXTS.drawingInfo)
        return
      }

      if (result.searchType === 'stop') {
        focusMyStop(result)
        return
      }

      if (result.searchType === 'route') {
        showTransportRoute(result.id)
        return
      }

      mapView.focusPoi(fromLonLat([result.longitude, result.latitude]))

      /* <b>Gizli katman KENDİLİĞİNDEN açılmaz.</b> Görünürlük kullanıcının
         açık bir tercihidir; arama onu sessizce geri almaz. Arama yine de
         çalışır — veri keşfi bir sunum kararı değildir — ama kamera gittiği
         yerde görünmeyen bir kaydı seçip panelini açmak, katmanı kapatan
         kişiye tam da gizlediği şeyi göstermek olurdu. */
      if (!isPoiSelectable(result.id)) return

      const record = findPoiOnLayer(result.id)
      if (!record) return

      setSelectedPoi(record)
      mapContext.activate(MAP_CONTEXTS.poiInfo)
    },
    [workspace, mapView, mapContext, findPoiOnLayer, isPoiSelectable, focusMyStop, showTransportRoute],
  )

  /**
   * "Zoom Yap": seçili POI'ye AYNI kamera sözleşmesiyle gider.
   *
   * <b>Seçimi ve paneli KIPIRDATMAZ.</b> Bu bir gezinme eylemidir, bir bağlam
   * değişimi değil: panel açık kalır, POI seçili kalır ve rozetinin çevresindeki
   * seçim halkası varış boyunca görünür durur. Paneli kapatsaydı kullanıcı,
   * bakmak için yaklaştığı kaydın bilgilerini tam o anda kaybederdi.
   *
   * Arama sonucuyla aynı `focusPoi`'yi çağırır: 19. seviyedeyken basıldığında
   * hedefe UZAKLAŞARAK gider, 6. seviyedeyken yaklaşarak — iki durumda da aynı
   * öngörülebilir inceleme ölçeğinde biter.
   */
  const zoomToSelectedPoi = useCallback(() => {
    if (!selectedPoi) return
    if (!Number.isFinite(selectedPoi.longitude) || !Number.isFinite(selectedPoi.latitude)) return

    mapView.focusPoi(fromLonLat([selectedPoi.longitude, selectedPoi.latitude]))
  }, [selectedPoi, mapView])

  /** "Düzenle": haritadakiyle AYNI düzenleme bağlamı ve aynı form. */
  const editMyPoi = useCallback(
    (poi) => {
      if (!poi?.canUpdate) return
      setSelectedPoi(poi)
      beginPoiEdit(poi)
      mapContext.activate(MAP_CONTEXTS.poiEdit)
    },
    [beginPoiEdit, mapContext],
  )

  /** "Sil": haritadakiyle AYNI onay ve aynı yumuşak silme akışı. */
  const deleteMyPoi = useCallback((poi) => {
    if (poi?.canDelete) setPendingPoiDelete(poi)
  }, [])

  /* Yetki CANLIDIR. `poi.create` alındığında yerleştirme modu
     useWorkspacePermissions tarafından kapatılır; burada da açık kalmış form
     ve bekleyen işaret temizlenir — korumalı hiçbir arayüz ayakta kalmaz. */
  useEffect(() => {
    if (allowed.canCreatePoi) return
    // Bağlam da bırakılır; temizliğin geri kalanını emeklilik yapar.
    mapContext.close(MAP_CONTEXTS.poiCreate)
    setPoiFormOpen(false)
    setPoiError('')
    clearPendingPoi()
  }, [allowed.canCreatePoi, clearPendingPoi, mapContext])

  /* `poi.view` alındığında katmanı boşaltmak kancanın işi; artık erişilemeyen
     bilgi panelini kapatmak bu sayfanın. */
  useEffect(() => {
    if (allowed.canViewPoi) return
    setSelectedPoi(null)
    // Bağlam da bırakılır: erişilemeyen bir panel bir kare bile ayakta kalmaz.
    mapContext.close(MAP_CONTEXTS.poiInfo)
    mapContext.close(MAP_CONTEXTS.poiEdit)
    mapContext.close(MAP_CONTEXTS.myPois)
  }, [allowed.canViewPoi, mapContext])

  /* Düzenleme yetkisi harita açıkken geri alınabilir; açık kalan form da
     kapanır. Kaydetme zaten sunucuda reddedilirdi — ama reddedileceği belli
     olan bir formu açık tutmanın anlamı yok. */
  useEffect(() => {
    if (!allowed.canUpdatePoi && !allowed.canManagePoi) mapContext.close(MAP_CONTEXTS.poiEdit)
  }, [allowed.canUpdatePoi, allowed.canManagePoi, mapContext])

  /* The trash is fetched only while its panel is open, and a successful restore
     reloads the map through the workspace's own loader — the record has to come
     back where the user deleted it from, not only leave this list. That is also
     why there is no second "add it to the map" code path here. */
  const trash = useTrash({
    active: mapContext.isActive(MAP_CONTEXTS.trash) && canOpenTrash,
    showToast,
    onRestored: workspace.reloadDrawings,
    /* Her yarı KENDİ yetkisine bağlıdır. Çizim yarısı koşulsuz okunsaydı,
       yalnızca POI yetkisi olan bir kullanıcı (ör. map.view + poi.* taşıyan
       özel bir rol) `/api/drawings/deleted`ten 403 alır ve o hata paneli
       düşürerek kendi sildiği POI'yi görmesini engellerdi. */
    includeDrawings: allowed.canViewDrawings && allowed.canRestoreDrawings,
    includePois: allowed.canRestorePoi,
    includeTransportStops: allowed.canViewTransport && allowed.canRestoreTransportStop,
    includeTransportRoutes: allowed.canViewTransport && allowed.canRestoreTransportRoute,
    reloadTransport: transport.refresh,
    canUpdateTransportRoute: allowed.canUpdateTransportRoute,
    onPoiRestored: (restored) => {
      /* Geri yüklenen kayıt sunucudan kanonik hâliyle döner ve doğrudan
         haritaya konur; ikinci bir GET gereksizdir.

         "POI'lerim" listesine BURADAN eklenmez: geri yüklenen kayıt yabancı da
         olabilir (poi.manage) ve `canUpdate`/`canDelete` sahiplik ölçüsü
         değildir. Panel bir sonraki açılışında sunucudan tazelenir ve kapsam
         kararını yine sunucu verir. */
      if (restored) addPoiToLayer(restored)
      invalidatePoiPresentation()
    },
    onTransportRestored: async (_restored, type, result) => {
      if (type === 'transport-route' || result?.generationAttempted || result?.refreshError) {
        await transport.refresh()
      }
      await myStops.reload()
    },
  })

  /** Box / area selection results land in the same canonical selection set. */
  const handleSpatialSelect = useCallback(
    (keys, { additive }) => {
      if (additive) workspace.addToSelection(keys)
      else workspace.setSelection(keys)

      /* Kutu/alan seçimi de aynı kapıdan geçer: sonucu gösteren panel
         devralırken çakışan bağlam kendiliğinden kapanır. */
      if (keys.length === 1) mapContext.activate(MAP_CONTEXTS.drawingInfo)
      else if (keys.length > 1) mapContext.activate(MAP_CONTEXTS.multiSelection)

      showToast('info', keys.length ? `${keys.length} çizim seçildi.` : 'Seçilen alanda çizim bulunamadı.')
    },
    [workspace, mapContext, showToast],
  )

  useSelectionTools(mapInstance, {
    // Non-null only in select mode, so a box drag can never be live while a
    // draw or measure interaction is — and null outright without `selection.use`,
    // so losing the permission tears the box/lasso interaction down too.
    tool:
      !allowed.canSelect || workspaceMode.activeSelectionTool === 'single'
        ? null
        : workspaceMode.activeSelectionTool,
    onSelect: handleSpatialSelect,
    selectKeysIn: workspace.selectKeysIn,
  })

  /* --- Map bootstrap ------------------------------------------------------ */
  // Unchanged from the original: same tile source, same Türkiye centre/zoom.
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    /* No base layer here any more: the basemaps are owned by `useBasemap`,
       which adds all of them below the overlays and shows one. The Map, its
       View and this effect are otherwise unchanged — the map instance is
       created exactly once and a basemap change never reaches it. */
    const map = new Map({
      target: mapContainerRef.current,
      controls: defaultControls().extend([new ScaleLine({ units: 'metric' })]),
      view: new View({
        center: fromLonLat(TURKEY_CENTER_LON_LAT),
        zoom: TURKEY_ZOOM,
      }),
    })

    mapRef.current = map
    setMapInstance(map)

    const fallbackTimer = setTimeout(() => setMapReady(true), MAP_READY_FALLBACK_MS)
    map.once('rendercomplete', () => {
      clearTimeout(fallbackTimer)
      setMapReady(true)
    })

    return () => {
      clearTimeout(fallbackTimer)
      map.setTarget(undefined)
      mapRef.current = null
      setMapInstance(null)
    }
  }, [])

  // Lets the app-level transition overlay (if one is currently holding, e.g.
  // right after a successful login) know it's safe to reveal.
  useEffect(() => {
    if (mapReady) reportMapReady()
  }, [mapReady, reportMapReady])

  // The profile (username, role) is owned by AuthContext, which fetches
  // /api/auth/me once per session — this page just reads it, so there is a
  // single source of truth and a single request.

  // Connection feedback derived from real request outcomes — no polling.
  useEffect(() => {
    let online = true
    setConnectionHandler((isOnline) => {
      if (isOnline === online) return
      online = isOnline
      if (isOnline) showToast('success', 'Bağlantı yeniden kuruldu.', { id: 'connection' })
      else showToast('error', 'Bağlantı kurulamadı.', { id: 'connection', timeout: 8000 })
    })
    return () => setConnectionHandler(null)
  }, [showToast])

  // Optional session countdown display, purely derived from expiresAt.
  useEffect(() => {
    setRemaining(formatRemaining(expiresAt))
    if (!expiresAt) return

    const interval = setInterval(() => {
      setRemaining(formatRemaining(expiresAt))
    }, 1000)

    return () => clearInterval(interval)
  }, [expiresAt])

  /* --- Actions ------------------------------------------------------------ */

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  /* Katlama tercihleri hem duruma hem depolamaya YAZILIR. Depolamayı ayrı bir
     efektten yazmak, aynı gerçeği iki yerde tutmak olurdu. */
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((value) => {
      const next = !value
      writeCollapsePreference(SIDEBAR_COLLAPSE_KEY, next)
      return next
    })
  }, [])

  const toggleToolbar = useCallback(() => {
    setToolbarCollapsed((value) => {
      const next = !value
      writeCollapsePreference(TOOLBAR_COLLAPSE_KEY, next)
      return next
    })
  }, [])

  const { fitExtent, panTo, ensureVisible } = mapView
  const { selectionCount, selectionCounts, selectedFeatures } = workspace

  /** Selecting from the drawings list also frames the geometry. */
  const selectAndZoom = useCallback(
    (key) => {
      selectFeature(key)
      const extent = extentOf(key)
      if (extent) fitExtent(extent)
    },
    [selectFeature, extentOf, fitExtent],
  )

  const focusAllDrawings = useCallback(() => {
    const extent = visibleExtent()
    if (!extent) {
      showToast('info', 'Henüz görüntülenecek çizim yok.')
      return
    }
    fitExtent(extent)
  }, [visibleExtent, fitExtent, showToast])

  /**
   * "Seçime Odaklan": one combined extent for the whole selection.
   * `fitExtent` already treats a zero-area extent (a lone point) as a centre
   * plus a sensible zoom rather than an infinite zoom-in, and it skips the
   * animation entirely when the user prefers reduced motion.
   */
  const focusSelection = useCallback(() => {
    const extent = extentOfKeys(selectedKeys)
    if (extent) fitExtent(extent)
  }, [extentOfKeys, selectedKeys, fitExtent])

  // Deleting or deselecting the feature being styled leaves nothing to edit.
  useEffect(() => {
    if (styleTarget === 'feature' && !selectedFeature) setStyleTarget(null)
    if (styleTarget === 'bulk' && selectionCount < 2) setStyleTarget(null)
  }, [styleTarget, selectedFeature, selectionCount])

  /* --- Seçim ile bağlam arasındaki eşgüdüm ---------------------------------

     Seçim bir VERİ, panel ise onun görünümüdür. Bu efekt yalnızca ikisinin
     tutarlılığını korur ve YALNIZCA seçim bağlamlarından biri UI'ın sahibiyken
     çalışır: kullanıcının açtığı bir liste ya da POI paneli, seçim sayısı
     değişti diye devrilmez.

       seçim boşaldı        -> seçim bağlamı bırakılır
       1 -> 2+              -> çoklu seçim paneli devralır
       2+ -> 1              -> tekil kayıt paneli devralır

     Araç stili ('tool') hiçbir kaydı düzenlemez; boş seçimde de ayakta kalır. */
  useEffect(() => {
    /* Sahipsiz UI + canlı seçim: panel seçimin kendisine düşer.

       Phase 3 öncesinde bu koşul panelin açılma kuralıydı (`selectionCount === 1
       && !activePanel`). Sahiplik koordinatöre taşındığında, bir SEÇİM
       bağlamı dışından yapılan seçimler (çizim listesinden bir satır, analiz
       sonucundan "Çizimi Aç") paneli hiç açamaz hâle geldi: aşağıdaki eşgüdüm
       yalnızca bir seçim bağlamı zaten sahipken çalışır. Kural burada
       GENEL biçimde geri konur ve pinlenmiş bir listeyi devirmez — yalnızca
       hiçbir bağlam sahip DEĞİLKEN devreye girer. */
    if (mapContext.active === null && selectionCount > 0) {
      mapContext.activate(
        selectionCount === 1 ? MAP_CONTEXTS.drawingInfo : MAP_CONTEXTS.multiSelection,
      )
      return
    }

    if (!SELECTION_CONTEXTS.includes(mapContext.active)) return

    if (selectionCount === 0) {
      if (mapContext.active === MAP_CONTEXTS.styleEditor && styleTarget === 'tool') return
      mapContext.close()
      return
    }

    if (mapContext.active === MAP_CONTEXTS.drawingInfo && selectionCount >= 2) {
      mapContext.activate(MAP_CONTEXTS.multiSelection)
    } else if (mapContext.active === MAP_CONTEXTS.multiSelection && selectionCount === 1) {
      mapContext.activate(MAP_CONTEXTS.drawingInfo)
    }
  }, [selectionCount, styleTarget, mapContext])

  /* Stil paneli SEÇİMİ düzenler; bu yüzden seçim bağlamlarıyla aynı kümededir
     ve devralırken seçim BIRAKILMAZ (bkz. SELECTION_CONTEXTS). */
  const openStyleForSelection = useCallback(() => {
    setStyleTarget('feature')
    mapContext.activate(MAP_CONTEXTS.styleEditor)
  }, [mapContext])

  const openStyleForBulk = useCallback(() => {
    setStyleTarget('bulk')
    mapContext.activate(MAP_CONTEXTS.styleEditor)
  }, [mapContext])

  /**
   * The toolbar palette always edits the *tool* defaults — the style the next
   * drawing will get. Editing existing records goes through "Stili Değiştir"
   * (one) or "Stil Uygula" (many), so the three never get confused.
   *
   * Which type it opens on is read from the canonical mode, not from a copy
   * kept here; the panel's tabs write back to that same state.
   */
  const openStyleForTool = useCallback(() => {
    setStyleTarget('tool')
    mapContext.activate(MAP_CONTEXTS.styleEditor)
  }, [mapContext])

  /**
   * Stil panelini kapatmak, seçimi bırakmak DEĞİLDİR: seçili kayıt duruyorsa
   * sahiplik ona geri döner ve kaydın bilgi paneli açılır. Yalnızca
   * `close()` çağırmak, kullanıcının hâlâ seçili olan kaydını sessizce
   * bırakırdı.
   */
  const closeStylePanel = useCallback(() => {
    setStyleTarget(null)
    if (selectionCount === 1) mapContext.activate(MAP_CONTEXTS.drawingInfo)
    else if (selectionCount >= 2) mapContext.activate(MAP_CONTEXTS.multiSelection)
    else mapContext.close(MAP_CONTEXTS.styleEditor)
  }, [selectionCount, mapContext])

  const requestDelete = useCallback(() => {
    if (selectedFeatures.length > 0) setPendingDelete(selectedFeatures)
  }, [selectedFeatures])

  const confirmDelete = useCallback(async () => {
    const targets = pendingDelete
    setPendingDelete(null)
    if (!targets?.length) return
    // One record still goes through the single-record endpoint; two or more use
    // the atomic bulk endpoint so a half-finished delete is not possible.
    if (targets.length === 1) await workspace.removeFeature(targets[0].key)
    else await workspace.removeFeatures(targets.map((item) => item.key))
  }, [pendingDelete, workspace])

  /* Restoring goes through the same confirmation step deleting does, using the
     app's own dialog rather than `window.confirm`. Reopening a drawing is
     recoverable — it can simply be deleted again — so the dialog asks in the
     primary tone instead of the destructive red. */
  const requestRestore = useCallback((item) => setPendingRestore(item), [])

  const confirmRestore = useCallback(async () => {
    const target = pendingRestore
    setPendingRestore(null)
    if (target) await trash.restore(target)
  }, [pendingRestore, trash])

  /**
   * Kenar çubuğu satırı.
   *
   * "Harita" (`id: null`) açık olan HER bağlamı kapatır — panel, sheet ya da
   * seçim paneli fark etmez; hepsi aynı sahiplikten geçer. Diğer satırlar
   * kendi bağlamlarını açar; aynı satıra tekrar basmak kapatır.
   *
   * Buradaki hiçbir dal başka bir panelin setter'ını çağırmaz: çakışan bağlamı
   * koordinatör emekliye ayırır.
   */
  const handleSelectPanel = useCallback(
    (panelId) => {
      if (!panelId) {
        mapContext.close()
        return
      }
      if (mapContext.active === panelId) mapContext.close(panelId)
      else mapContext.activate(panelId)
    },
    [mapContext],
  )

  const selectedGeometry = selectedFeature ? featureByKey(selectedFeature.key)?.getGeometry() ?? null : null

  /* İKİ ayrı eksen ve ikisi de gereklidir:

       yetki  — "bu kişi çizim silebilir mi"   (etkin yetki kodu)
       sahiplik — "BU kaydı yönetebilir mi"    (Admin veya kaydın sahibi)

     Backend her mutasyonda ikisini de bağımsız olarak yeniden denetler ve
     yetkisiz isteğe 403 döner; buradaki hesap yalnızca hangi kontrolün
     sunulacağına karar verir. Sahiplik ekseni (KAPSAM) bilinçli olarak
     backend'in DrawingAuthorizationHandler'ı ile aynı kuralı yansıtır. */
  const ownsSelected = canManageDrawing({ isAdmin, userId }, selectedFeature)
  const ownsSelection = canManageAll({ isAdmin, userId }, selectedFeatures)

  /* Tek bir kaydın panelinde en az bir eylem sunulabiliyorsa yönetim bölümü
     görünür. "Düzenle" üç yetkiyi birden ister, çünkü tek bir PUT gönderir. */
  const canManageSelected =
    ownsSelected && (allowed.canEditDrawing || allowed.canUpdateStyle || allowed.canDeleteDrawings)
  const canManageSelection =
    ownsSelection && (allowed.canUpdateStyle || allowed.canDeleteDrawings)
  const foreignSelectedCount = selectedFeatures.filter(
    (item) => !canManageDrawing({ isAdmin, userId }, item),
  ).length

  /* --- Geometry edit session ----------------------------------------------
     `workspaceMode.isEditing` is the single switch: it turns the OpenLayers
     Modify/Translate interactions on here and simultaneously makes every other
     interaction (draw, measure, box-select) inactive, because each of those is
     derived from a mode that is no longer current. */

  const editingFeature = workspaceMode.isEditing && selectedFeature
    ? featureByKey(selectedFeature.key)
    : null

  /** Which gesture the map performs: drag a vertex, or drag the whole shape. */
  const [geometryEditMode, setGeometryEditMode] = useState(GEOMETRY_EDIT_MODES.vertex)

  /* THE edit state. Every editing surface — the two panel tabs, the coordinate
     inputs, the line tools and the map interactions below — reads and writes
     this one session, so there is a single geometry rather than several copies
     to reconcile. */
  const editSession = useEditSession({
    feature: editingFeature,
    descriptor: selectedFeature,
    active: workspaceMode.isEditing,
  })

  // The map's gestures feed the same session: `commitFromMap` reads the geometry
  // OpenLayers just changed and puts it on the session's undo stack, exactly as
  // a typed coordinate would.
  useGeometryEditing(mapInstance, {
    active: workspaceMode.isEditing,
    feature: editingFeature,
    mode: geometryEditMode,
    onCommit: editSession.commitFromMap,
  })

  /* Numbered vertex markers over the drawing being edited, and clicks on them.
     The overlay renders the SAME session — it holds no geometry and no second
     selection — so the "Köşe 3" in the panel and the "3" on the map are one
     index that both surfaces read and write. */
  useVertexOverlay(mapInstance, {
    active: workspaceMode.isEditing,
    type: editSession.type ?? null,
    coords: editSession.coords ?? null,
    selectedVertex: editSession.selectedVertex,
    selectedEdge: editSession.selectedEdge,
    // A selection made ON the map needs no camera move: the user is looking
    // right at what they clicked.
    onSelectVertex: editSession.selectVertex,
    onSelectEdge: editSession.selectEdge,
    onClearSelection: editSession.clearSelection,
  })

  const { startEditing, stopEditing } = workspaceMode
  const { updateFeature } = workspace
  const { revertGeometry, isDirty: hasUnsavedEdits } = editSession

  /** Non-null while the unsaved-changes dialog is asking; holds what to do next. */
  const [pendingDiscard, setPendingDiscard] = useState(null)

  const startEdit = useCallback(() => {
    if (!canManageSelected) return
    // Every session starts on vertex editing; translate is an explicit choice.
    setGeometryEditMode(GEOMETRY_EDIT_MODES.vertex)
    startEditing()
  }, [canManageSelected, startEditing])

  /** Closes the session, putting the map geometry back as it was. */
  const discardEdit = useCallback(() => {
    revertGeometry()
    stopEditing()
  }, [revertGeometry, stopEditing])

  /**
   * "İptal" / panel close / navigating away mid-edit.
   *
   * With unsaved work the user is asked first, through the app's own dialog —
   * never `window.confirm`, which cannot be styled, cannot be dismissed with the
   * app's Escape handling and looks like a browser error rather than a choice.
   * With nothing to lose the session simply closes; a confirmation that always
   * appears is one people learn to click through.
   */
  const cancelEdit = useCallback(
    (afterDiscard = null) => {
      if (hasUnsavedEdits) {
        setPendingDiscard(() => afterDiscard ?? (() => {}))
        return
      }
      discardEdit()
      afterDiscard?.()
    },
    [hasUnsavedEdits, discardEdit],
  )

  const confirmDiscard = useCallback(() => {
    const next = pendingDiscard
    setPendingDiscard(null)
    discardEdit()
    next?.()
  }, [pendingDiscard, discardEdit])

  /**
   * "Kaydet": metadata, colour and geometry travel in ONE request, so the
   * record can never end up half-updated. Colour is expanded into the style
   * columns the type actually has (stroke always, fill where supported) by the
   * same helper the attribute popup uses, and the geometry is written from the
   * SESSION's vertex list rather than read back off the map — the session is
   * the source of truth, and a manual coordinate that has not yet round-tripped
   * through the map would otherwise be lost.
   */
  const saveEdit = useCallback(async () => {
    const draft = editSession.draft
    const wkt = editSession.toWkt()
    if (!draft || !wkt || !selectedFeature || !editSession.canSave) return

    /* Edit/translate sırasında ara konumlar bilinçli olarak sınanmaz: kullanıcı
       kopuk iki yetkili alan arasındaki boşluktan geçebilmelidir. Yalnızca son
       aday burada UX amacıyla sınanır; backend aynı adayı yeniden ve otoriter
       olarak denetlemeye devam eder. Kapsam okunamadıysa istemci karar vermez. */
    if (
      editSession.isGeometryDirty &&
      geographic.scope &&
      !isGeometryInsideScope(geographic.scope, editSession.toMapGeometry())
    ) {
      showToast('error', 'Bu geometri mevcut coğrafi yetki alanlarınızın dışında.')
      editSession.restoreOriginalGeometry()
      return
    }

    const ok = await updateFeature(selectedFeature.key, {
      name: draft.name.trim(),
      // Empty strings are meaningful here: they clear the field server-side.
      description: draft.description.trim(),
      category: draft.category,
      tags: normalizeTags(draft.tags),
      style: colorPatchFor(selectedFeature.type, draft.color),
      /* Geometri DEĞİŞMEDİYSE hiç gönderilmez. Coğrafi yetki yalnızca
         geometriye bakar; dokunulmamış bir geometriyi göndermek, sunucudan onu
         yeni bir çizimmiş gibi sınamasını istemek olurdu — ve alanı sonradan
         daraltılan bir kullanıcı, eski kaydının adını bile değiştiremezdi.

         Bu bir güvenlik gevşetmesi DEĞİLDİR: geometri gerçekten değiştiğinde
         WKT gider ve sunucu yeni konumu tam olarak eskisi gibi denetler. */
      ...(editSession.isGeometryDirty ? { wkt } : {}),
    })

    if (ok) stopEditing()
    else editSession.restoreOriginalGeometry()
  }, [editSession, selectedFeature, geographic.scope, showToast, updateFeature, stopEditing])

  /* --- Analysis results -> the map -----------------------------------------
     Every match the analysis returns is, by definition, one of the caller's own
     drawings — the backend scopes the query to them — so it is already on the
     map. That is what lets the result list carry only identity and metadata:
     the geometry is looked up here rather than sent twice. */

  /** The map feature behind a matched record, or null if it is not loaded. */
  const analysisFeature = useCallback(
    (item) => {
      if (!item) return null
      const match = workspace.drawings.find(
        (drawing) => drawing.type === item.drawingType && drawing.databaseId === item.id,
      )
      return match ? featureByKey(match.key) : null
    },
    [workspace.drawings, featureByKey],
  )

  /** The geometry the highlight layer draws, derived from the shared selection. */
  const highlightedGeometry = useMemo(() => {
    const selected = analysis.selectedKey
    if (!selected) return null

    const [type, rawId] = selected.split(':')
    const feature = analysisFeature({ drawingType: type, id: Number(rawId) })
    return feature?.getGeometry() ?? null
  }, [analysis.selectedKey, analysisFeature])

  useAnalysisHighlight(mapInstance, { geometry: highlightedGeometry })

  /**
   * Geometry-derived detail for one match, measured with the app's own helpers.
   *
   * Computed from the feature on the map rather than returned by the API so a
   * length shown here and in the drawing panel are the same number produced by
   * the same code, not two answers that could drift apart.
   */
  const analysisMetrics = useCallback(
    (item) => {
      const geometry = analysisFeature(item)?.getGeometry()
      if (!geometry) return []

      if (item.drawingType === 'point') {
        const { lon, lat } = formatLonLat(toLonLat(geometry.getCoordinates()))
        return [
          { label: 'Boylam', value: lon },
          { label: 'Enlem', value: lat },
        ]
      }

      if (item.drawingType === 'line') {
        return [
          { label: 'Toplam Uzunluk', value: formatLength(measureLength(geometry)) },
          { label: 'Nokta Sayısı', value: `${geometry.getCoordinates().length}` },
        ]
      }

      return [
        { label: 'Alan', value: formatArea(measureArea(geometry)) },
        { label: 'Çevre', value: formatLength(measurePerimeter(geometry)) },
        // The ring repeats its first vertex to close; the user counts corners.
        { label: 'Köşe Sayısı', value: `${Math.max(0, (geometry.getCoordinates()?.[0]?.length ?? 1) - 1)}` },
      ]
    },
    [analysisFeature],
  )

  /** "Haritada Göster": frames the match without disturbing the analysis. */
  const showAnalysisItemOnMap = useCallback(
    (item) => {
      const feature = analysisFeature(item)
      if (!feature) {
        showToast('info', 'Bu çizim haritada bulunamadı.')
        return
      }
      /* The selection is deliberately left alone. This button only exists inside
         an already-expanded result, so the record is selected and its highlight
         is already lit; re-running the row's toggle would switch it back OFF and
         the user would watch the highlight vanish as the map flew to it.
         Only the camera moves — the analysis area, the result and the panel all
         stay exactly as they were. */
      fitExtent(feature.getGeometry()?.getExtent())
    },
    [analysisFeature, fitExtent, showToast],
  )

  /**
   * "Çizimi Aç": hands the record to the ORDINARY drawing detail panel rather
   * than growing a second one inside the analysis results.
   *
   * Devir İKİ adımdır ve ikisi de gereklidir: kaydı SEÇMEK (veri) ve çizim
   * bağlamını ETKİNLEŞTİRMEK (panel sahipliği). Yalnızca seçmek, Phase 3'ten
   * beri hiçbir panel açmaz — birincil bağlam hâlâ analiz sonucundadır ve
   * seçim/panel eşgüdüm efekti bilinçli olarak yalnızca bir SEÇİM bağlamı
   * UI'ın sahibiyken çalışır (kullanıcının açtığı bir liste, seçim sayısı
   * değişti diye devrilmesin diye). POI satırının yolu (`openAnalysisPoi`)
   * bağlamını zaten etkinleştiriyordu; çizim satırı bunu yapmıyordu.
   *
   * SIRA önemlidir: önce seçim kurulur, sonra bağlam devralınır. Analiz
   * bağlamının emekliliği geçici alanı ve sonucu temizler ama çizim seçimine
   * DOKUNMAZ, dolayısıyla az önce devredilen kayıt devrin içinde hayatta
   * kalır.
   */
  const openAnalysisItemDrawing = useCallback(
    (item) => {
      const match = workspace.drawings.find(
        (drawing) => drawing.type === item.drawingType && drawing.databaseId === item.id,
      )
      if (!match) {
        showToast('info', 'Bu çizim haritada bulunamadı.')
        return
      }
      selectAndZoom(match.key)
      mapContext.activate(MAP_CONTEXTS.drawingInfo)
    },
    [workspace.drawings, selectAndZoom, mapContext, showToast],
  )

  /**
   * Analiz sonucundaki bir POI satırı: haritada odaklan + POI Bilgisi'ni aç.
   *
   * Çizim satırlarındaki "Çizimi Aç" ile aynı ilke — sonuç paneli ikinci bir
   * detay görünümü üretmez, kaydı SIRADAN paneline devreder. Bu devir de
   * koordinatörden geçtiği için analiz sonucu kendiliğinden kapanır.
   */
  const openAnalysisPoi = useCallback(
    (item) => {
      if (!item) return
      panTo(fromLonLat([item.longitude, item.latitude]))

      /* Kayıt haritada zaten yüklüdür ve TAM hâli oradadır: mesai saatleri ve
         yetenek bayrakları analiz sözleşmesinde taşınmaz. Katmandan okunamazsa
         (katman kapalı ya da kayıt yeni) sonuç satırındaki dar bilgi gösterilir
         ve eylemler kapalı kalır — fail-closed. */
      setSelectedPoi(
        findPoiOnLayer(item.id) ?? {
          id: item.id,
          name: item.name,
          categoryName: item.categoryName,
          categoryPath: item.categoryPath,
          workHours: null,
          longitude: item.longitude,
          latitude: item.latitude,
          canUpdate: false,
          canDelete: false,
        },
      )
      mapContext.activate(MAP_CONTEXTS.poiInfo)
    },
    [panTo, findPoiOnLayer, mapContext],
  )

  /** Copy helper shared by the point and "all coordinates" actions. */
  const copyText = useCallback(
    async (text, successMessage) => {
      try {
        await navigator.clipboard.writeText(text)
        showToast('success', successMessage)
      } catch {
        // Clipboard access can be denied (insecure origin, permission); saying
        // so beats a button that silently does nothing.
        showToast('error', 'Panoya kopyalanamadı.')
      }
    },
    [showToast],
  )

  /* --- Panel -> map vertex selection ---------------------------------------
     The mirror of the overlay's map -> panel direction. Both write the session's
     one `selectedVertex`, so neither surface can be showing a different vertex
     than the other. */

  /** The vertex under `index`, in map coordinates, or null. */
  const { coords: editCoords } = editSession
  const vertexCoordinate = useCallback(
    (index) => {
      const vertex = editCoords?.[index]
      return vertex ? fromLonLat(vertex) : null
    },
    [editCoords],
  )

  /**
   * Clicking a row: select it, and move the map only if the vertex is not
   * already on screen. Panning on every click would jolt the map for a marker
   * the user can already see.
   */
  const selectEditedVertex = useCallback(
    (index) => {
      editSession.selectVertex(index)
      const coordinate = vertexCoordinate(index)
      if (coordinate) ensureVisible(coordinate)
    },
    [editSession, vertexCoordinate, ensureVisible],
  )

  /**
   * "Haritada Göster": centres on one vertex at the CURRENT zoom.
   *
   * Deliberately not a zoom-in — the number the user just read only means
   * anything in the context of the shape around it, and framing a single vertex
   * would push the rest of the geometry off screen.
   */
  const focusEditedVertex = useCallback(
    (index) => {
      editSession.selectVertex(index)
      const coordinate = vertexCoordinate(index)
      if (coordinate) panTo(coordinate)
    },
    [editSession, vertexCoordinate, panTo],
  )

  // Losing the selection mid-edit (delete, deselect) must not strand the map in
  // edit mode with nothing to edit.
  useEffect(() => {
    if (workspaceMode.isEditing && !selectedFeature) stopEditing()
  }, [workspaceMode.isEditing, selectedFeature, stopEditing])

  /* --- Çizimlerim row actions ----------------------------------------------
     Both route through the SAME state the map uses: the row selects the
     drawing first, then the shared edit / delete flow takes over. That is what
     keeps the sidebar and the map showing one selection rather than two. */

  /* Leaving an open edit session by picking a different drawing has to go
     through the same unsaved-changes guard as closing the panel; otherwise the
     list becomes a side door that silently discards work. `cancelEdit` runs the
     follow-up action itself once it is safe to, so the guarded and unguarded
     paths stay one code path.

     Clicking the MAP cannot reach here: selection is disabled outside select
     mode, and edit is its own mode — that door is already closed. */
  const guardEdit = useCallback(
    (action) => {
      if (workspaceMode.isEditing) cancelEdit(action)
      else action()
    },
    [workspaceMode.isEditing, cancelEdit],
  )

  const selectFromList = useCallback((key) => guardEdit(() => selectAndZoom(key)), [guardEdit, selectAndZoom])

  /* --- Yolculuk noktası seçiminin sahipliği (Faz 5E-B) ------------------------
     Silahlanmak, haritanın tıklamasını DEVRALMAKTIR. Devralmadan önce o an
     tıklamanın sahibi olan aile bırakılır ve bırakma her zaman o ailenin
     KENDİ mevcut çıkışından geçer: ikinci bir kapatma yolu açmak, yerleştirme
     kipinin bekleyen noktası ya da analizin canlı Draw aracı gibi durumların
     görünmeden ayakta kalmasına kapı aralardı. */
  const leaveActiveWorkspaceTool = useCallback(() => {
    /* Yerleştirme kipleri BAĞLAMLARIYLA birlikte yaşar: emeklilik bekleyen
       noktayı ve formu da temizler (koordinatördeki emeklilik tablosu). */
    if (workspaceMode.isPlacingPoi) mapContext.close(MAP_CONTEXTS.poiCreate)
    if (workspaceMode.isPlacingTransportStop) mapContext.close(MAP_CONTEXTS.transportStopCreate)
    if (workspaceMode.isRelocatingTransportStop) cancelTransportStopRelocation()

    /* Analiz ailelerinde yalnızca ARAÇ bırakılır — Esc'nin yaptığının aynısı.
       Sonuç ve paneli kapatmak, kullanıcının istemediği bir veri kaybı olurdu. */
    if (workspaceMode.isAnalyzing) workspaceMode.stopAnalysis()
    if (workspaceMode.isSelectingAnalysisArea) workspaceMode.stopLocationAnalysis()

    if (workspaceMode.isDrawing) workspaceMode.stopDrawing()
    if (workspaceMode.isMeasuring) workspaceMode.stopMeasuring()

    // Kutu/alan seçimi de canlı bir etkileşimdir: sıradan tıklamaya dönülür.
    if (workspaceMode.activeSelectionTool && workspaceMode.activeSelectionTool !== 'single') {
      workspaceMode.selectSelectionTool('single')
    }
  }, [workspaceMode, mapContext, cancelTransportStopRelocation])

  /**
   * Silahlanma üreten eylemleri dinlenme durumunda çalıştırır.
   *
   * Dinlenme durumundaysak tek iş eylemin kendisidir; değilsek ÖNCE çalışma
   * alanı dinlenmeye döner. Düzenleme oturumu mevcut `guardEdit` kapısından
   * geçer: kaydedilmemiş geometri, uygulamanın kendi onayı sorulmadan atılmaz
   * — ve onay verildikten sonra eylem kaldığı yerden sürer.
   */
  const withWorkspaceAtRest = useCallback(
    (action) => {
      if (workspaceAtRest) {
        action()
        return
      }
      guardEdit(() => {
        leaveActiveWorkspaceTool()
        action()
      })
    },
    [workspaceAtRest, guardEdit, leaveActiveWorkspaceTool],
  )

  /** Bir geçiş noktası yuvasını silahlar. */
  const armJourneySlot = useCallback(
    (key) => withWorkspaceAtRest(() => journey.armSlot(key)),
    [withWorkspaceAtRest, journey],
  )

  /* Yeni bir ara nokta da yuvasını SİLAHLI açar (indirgeyicideki kural), yani
     o da bir devralmadır: aynı kapıdan geçer, yoksa eklenen yuva doğduğu anda
     silahsız bırakılırdı. */
  const addJourneyWaypoint = useCallback(
    () => withWorkspaceAtRest(() => journey.addWaypoint()),
    [withWorkspaceAtRest, journey],
  )

  /** Esc ve panel dışı çıkışlar: silahı bırakır, başka hiçbir şeye dokunmaz. */
  const disarmJourneySlot = useCallback(() => journey.disarmSlot(), [journey])

  const editFromList = useCallback(
    (key) =>
      guardEdit(() => {
        selectAndZoom(key)
        /* Düzenleme, kaydın kendi bağlamında yapılır: listeyi (ya da açık olan
           başka hangi bağlamsa) koordinatör bırakır, böylece Modify tutamakları
           gerçekten erişilebilir olur. */
        mapContext.activate(MAP_CONTEXTS.drawingInfo)
        setGeometryEditMode(GEOMETRY_EDIT_MODES.vertex)
        startEditing()
      }),
    [guardEdit, selectAndZoom, mapContext, startEditing],
  )

  const deleteFromList = useCallback(
    (key) =>
      guardEdit(() => {
        const item = workspace.drawings.find((drawing) => drawing.key === key)
        // Same confirmation dialog as the map's own delete — one flow, so soft
        // delete can never happen without a confirmation step.
        if (item) setPendingDelete([item])
      }),
    [guardEdit, workspace.drawings],
  )
  /** Esc: abort drawing first, then close whatever is open. */
  const handleEscape = useCallback(() => {
    // The unsaved-changes dialog is the most modal thing on screen; Esc there
    // means "go back to editing", which is its safe answer.
    if (pendingDiscard) {
      setPendingDiscard(null)
      return
    }
    if (pendingDelete) {
      setPendingDelete(null)
      return
    }
    if (pendingRestore) {
      setPendingRestore(null)
      return
    }
    if (pendingPoiDelete) {
      setPendingPoiDelete(null)
      return
    }
    /* SİLAHLI bir yolculuk yuvası, açık bir panelden ya da etkin bir araçtan
       daha yereldir: haritanın bir SONRAKİ tıklamasını o tutuyordur ve Esc'nin
       ilk anlamı "bu tıklamayı geri ver"dir. Tek başına silahı bırakır; ne bir
       bağlam kapatır ne de başka bir araç değiştirir — bir tuş, bir iş. */
    if (journey.isPicking) {
      disarmJourneySlot()
      return
    }
    // The attribute popup is the most modal thing on screen: Esc there means
    // "discard this shape", not "leave the tool".
    if (workspace.pendingDrawing) {
      workspace.cancelPendingDrawing()
      return
    }
    // An open edit session is the next most modal: Esc abandons the edit and
    // puts the geometry back, rather than dropping the selection under it.
    if (workspaceMode.isEditing) {
      // Asks first when there is unsaved work; closes straight away when not.
      cancelEdit()
      return
    }
    if (workspaceMode.isAnalyzing) {
      workspaceMode.stopAnalysis()
      return
    }
    if (workspaceMode.isDrawing) {
      workspaceMode.stopDrawing()
      return
    }
    if (workspaceMode.isMeasuring) {
      workspaceMode.stopMeasuring()
      return
    }
    // A spatial selection tool is a mode too; Esc drops back to plain clicking.
    if (workspaceMode.activeSelectionTool && workspaceMode.activeSelectionTool !== 'single') {
      workspaceMode.selectSelectionTool('single')
      return
    }
    /* Açık bağlam TEK bir yerden kapanır: hangi panel olduğu Esc'nin
       bilmesi gereken bir şey değil. */
    if (mapContext.active) {
      mapContext.close()
      return
    }
    if (selectionCount > 0) workspace.clearSelection()
  }, [
    pendingDiscard,
    pendingDelete,
    pendingRestore,
    pendingPoiDelete,
    journey.isPicking,
    disarmJourneySlot,
    workspaceMode,
    mapContext,
    selectionCount,
    workspace,
    cancelEdit,
  ])

  /* --- Araç düğmeleri de aynı sisteme katılır -------------------------------

     Bir aracı açmak bir BAĞLAM açmaktır; kapatmak o bağlamı bırakmaktır.
     Sarmalayıcılar yalnızca kendi bağlamlarını bilir — hiçbiri "önce POI
     panelini kapat, sonra çizim panelini kapat" demez. */

  const { isPlacingPoi, isPlacingTransportStop, activeAnalysisTool } = workspaceMode

  /** "POI Ekle": yerleştirme + form bağlamı. */
  const togglePoiPlacement = useCallback(() => {
    const wasActive = isPlacingPoi
    allowed.togglePoiTool()
    // Yetki kapısı `allowed`ın içindedir; mod değişmediyse bağlam da değişmez.
    if (wasActive) mapContext.close(MAP_CONTEXTS.poiCreate)
    else if (allowed.canCreatePoi) mapContext.activate(MAP_CONTEXTS.poiCreate)
  }, [isPlacingPoi, allowed, mapContext])

  /** "Durak Ekle": etkin güzergah seçimi zorunlu tek nokta yerleştirmesi. */
  const toggleTransportStopPlacement = useCallback(() => {
    if (!isPlacingTransportStop) {
      if (transport.loading) {
        showToast('info', 'Güzergahlar yükleniyor. Lütfen kısa bir süre sonra tekrar deneyin.')
        return
      }
      if (transport.activeRoutes.length === 0) {
        showToast('error', 'Durak eklemek için etkin bir güzergah bulunmalıdır.')
        return
      }
    }

    const wasActive = isPlacingTransportStop
    allowed.toggleTransportStopTool()
    if (wasActive) mapContext.close(MAP_CONTEXTS.transportStopCreate)
    else if (allowed.canCreateTransportStop) mapContext.activate(MAP_CONTEXTS.transportStopCreate)
  }, [isPlacingTransportStop, transport.loading, transport.activeRoutes, allowed, mapContext, showToast])

  /** "Envanter Analizi": alan çizimi ve sonucu tek bağlamdır. */
  const toggleInventoryAnalysis = useCallback(() => {
    const wasActive = Boolean(activeAnalysisTool)
    allowed.toggleAnalysisTool()
    if (wasActive) mapContext.close(MAP_CONTEXTS.inventory)
    else if (allowed.canAnalyze) mapContext.activate(MAP_CONTEXTS.inventory)
  }, [activeAnalysisTool, allowed, mapContext])

  const handleMeasureShortcut = useCallback(
    () => allowed.selectMeasureTool(workspaceMode.activeMeasureTool ?? 'distance'),
    [allowed, workspaceMode.activeMeasureTool],
  )

  useKeyboardShortcuts({
    lettersEnabled: hasFinePointer,
    /* The shortcuts drive the same canonical actions the toolbar does; there is
       no second code path that could leave the two out of step. They go through
       the SAME permission guard for that reason — a hidden Point button would
       otherwise still be reachable by pressing P. */
    onTool: allowed.selectDrawTool,
    onMeasure: handleMeasureShortcut,
    onEscape: handleEscape,
    onUndo: workspace.undo,
    onRedo: workspace.redo,
  })

  /* --- Derived ------------------------------------------------------------ */

  const poiCategoryById = useMemo(() => categoryIndex(poiCategories.items), [poiCategories.items])
  const poiCategoryIsDescendant = useCallback(
    (candidateId, ancestorId) => isDescendantOf(poiCategoryById, candidateId, ancestorId),
    [poiCategoryById],
  )
  const poiCategoryTree = useMemo(
    () => buildPoiCategoryTree(
      poi.pois,
      poiCategories.items,
      layerVisibility.hiddenPoiIds,
      poiCategoryIsDescendant,
    ),
    [poi.pois, poiCategories.items, layerVisibility.hiddenPoiIds, poiCategoryIsDescendant],
  )
  const drawingLayerGroups = useMemo(
    () => layerDrawingGroups(workspace.drawings, layerVisibility.hiddenDrawingIds),
    [workspace.drawings, layerVisibility.hiddenDrawingIds],
  )
  const drawingLayerIds = useMemo(() => drawingIdentities(workspace.drawings), [workspace.drawings])
  const stopLayerIds = useMemo(() => transport.stops.map((stop) => stop.id), [transport.stops])
  const routeLayerIds = useMemo(() => transport.routes.map((route) => route.id), [transport.routes])

  useEffect(() => layerVisibility.reconcilePois(poi.pois.map((item) => item.id)), [poi.pois, layerVisibility.reconcilePois])
  useEffect(() => layerVisibility.reconcileStops(stopLayerIds), [stopLayerIds, layerVisibility.reconcileStops])
  useEffect(() => layerVisibility.reconcileDrawings(drawingLayerIds), [drawingLayerIds, layerVisibility.reconcileDrawings])


  /* Panellerin açıklığı ARTIK TÜRETİLİR: sahibi tek bir bağlamdır. "Aynı anda
     yalnızca bir sağ panel" kuralı bu yüzden her panelde ayrı ayrı yazılan bir
     koşul değil, yapının kendisidir. */
  const isStylePanelOpen = mapContext.isActive(MAP_CONTEXTS.styleEditor) && styleTarget !== null
  const isSelectedPanelOpen = mapContext.isActive(MAP_CONTEXTS.drawingInfo) && selectionCount === 1
  const isMultiPanelOpen = mapContext.isActive(MAP_CONTEXTS.multiSelection) && selectionCount >= 2
  // Drives the CSS that moves the OpenLayers zoom control out from under the
  // docked panel; on phones the panel is a bottom sheet and nothing shifts.
  const hasDockedPanel =
    isStylePanelOpen || isSelectedPanelOpen || isMultiPanelOpen || SIDEBAR_CONTEXTS.includes(mapContext.active)

  /* --- Emeklilik tablosu ----------------------------------------------------

     Bir bağlam UI sahipliğini kaybederken NE bırakır. Tabloyu tek bir yerde
     tutmak, "hangi panel hangi paneli kapatır" sorusunu ortadan kaldırır:
     kimse kimseyi kapatmaz, herkes yalnızca kendini bırakır.

     İki kural yapısaldır ve `mapContexts.js` içinde beyan edilir:
       · Seçim bağlamları (kayıt paneli, çoklu seçim, stil) aynı SEÇİMİ
         paylaşır; birbirlerine devrederken seçim düşmez.
       · POI bağlamları (bilgi, düzenleme) aynı KAYDI paylaşır.

     Bırakılan şey daima PANEL durumudur. Isı haritası bunun en açık örneğidir:
     emekliliği BOŞTUR — panel kapanır, katman (heatmapEnabled) haritada kalır.
     Aynı şekilde hiçbir emeklilik bir kaydı silmez ya da bir katmanı
     gizlemez. */
  Object.assign(contextRetirers.current, {
    [MAP_CONTEXTS.drawingInfo]: (next) => {
      /* CANLI BİR GEOMETRİ OTURUMU BİR PANEL DEĞİL, BİR ETKİLEŞİMDİR.

         Panel sahipliğini bırakmak onu sonlandırmaz: kullanıcı düzenleme
         sürerken Katmanlar'ı (ya da başka bir kenar çubuğu panelini) açtığında
         panel gizlenir, Modify tutamakları ve seçim yerinde kalır, panel
         kapanınca kaldığı yerden devam eder — Phase 3 öncesindeki davranışın
         aynısı.

         Burada oturumu kapatmak İKİ şeyi birden bozardı: kaydedilmemiş
         geometri, uygulamanın kendi "Değişiklikleri At" onayı hiç sorulmadan
         sessizce geri alınırdı (o onay tam da bunun için var), ve düzenlenen
         türün sunum görüntüsü askıdan çıkıp yeniden istenirdi — yani harita,
         kullanıcının üzerinde çalıştığı kaydın ESKİ hâlini geri getirirdi.

         Oturumu sonlandırmanın yolları değişmez: Kaydet, İptal, Esc — hepsi
         kaydedilmemiş iş varsa önce sorar. */
      if (workspaceMode.isEditing) return

      if (!sharesState(SELECTION_CONTEXTS, next)) workspace.clearSelection()
    },
    [MAP_CONTEXTS.multiSelection]: (next) => {
      if (!sharesState(SELECTION_CONTEXTS, next)) workspace.clearSelection()
    },
    [MAP_CONTEXTS.styleEditor]: (next) => {
      setStyleTarget(null)
      if (!sharesState(SELECTION_CONTEXTS, next)) workspace.clearSelection()
    },
    [MAP_CONTEXTS.poiInfo]: (next) => {
      if (!sharesState(POI_CONTEXTS, next)) setSelectedPoi(null)
    },
    [MAP_CONTEXTS.poiEdit]: (next) => {
      retirePoiEdit()
      if (!sharesState(POI_CONTEXTS, next)) setSelectedPoi(null)
    },
    [MAP_CONTEXTS.poiCreate]: retirePoiCreate,
    [MAP_CONTEXTS.transportStopInfo]: (next) => {
      if (!sharesState(TRANSPORT_STOP_CONTEXTS, next)) setSelectedTransportStop(null)
    },
    [MAP_CONTEXTS.transportStopEdit]: (next) => {
      cancelTransportStopRelocation()
      setTransportStopEditing(null)
      setTransportStopError('')
      if (!sharesState(TRANSPORT_STOP_CONTEXTS, next)) setSelectedTransportStop(null)
    },
    [MAP_CONTEXTS.transportStopCreate]: retireTransportStopCreate,
    /* Yolculuk paneli: bırakılan şey YALNIZCA paneldir.

       Çalışan bir simülasyon DURDURULMAZ, terminal sonuç BIRAKILMAZ, plan
       seçimleri TEMİZLENMEZ — bunların hepsi kullanıcının açık kararlarıdır
       (Durdur / Planlamaya Dön / Yeni Yolculuk / Temizle). Isı haritasıyla
       aynı sözleşme: panel kapanır, ürün yaşamaya devam eder ve panel
       yeniden açıldığında doğru evrenin içeriği geri gelir. */
    [MAP_CONTEXTS.journey]: () => {
      journey.closePanel()
    },
    [MAP_CONTEXTS.inventory]: () => {
      /* Analiz alanı geçicidir ve sonuç onunla birlikte gider; veritabanına
         hiçbir şey yazılmamıştı. Çizim katmanları etkilenmez. */
      workspaceMode.stopAnalysis()
      analysis.clear()
    },
    /* Kenar çubuğu panelleri yalnızca birer görünümdür: bıraktıkları bir durum
       yoktur. Isı haritası da buradadır — paneli kapanır, KATMANI kalır. */
    [MAP_CONTEXTS.heatmap]: () => {},
    /* Konum analizi ısı haritasıyla aynı sözleşmeyi izler: panel kapanır,
       TAMAMLANMIŞ analiz haritada kalır — kullanıcı sonucu görmek için paneli
       açık tutmak zorunda değildir.

       Ama CANLI BİR ÇİZİM ETKİLEŞİMİ bir panel DEĞİLDİR: paneli kapatmak
       görünmeyen bir Draw aracını ayakta bırakırdı ve bir sonraki tık hâlâ
       poligon başlatırdı. Mod bu yüzden burada bırakılır. */
    [MAP_CONTEXTS.locationAnalysis]: () => {
      workspaceMode.stopLocationAnalysis()
    },
    [MAP_CONTEXTS.drawings]: () => {},
    /* "POI'lerim" de yalnızca bir GÖRÜNÜMDÜR: kapanması POI katmanını
       gizlemez, seçimi düşürmez, hiçbir kaydı silmez. */
    [MAP_CONTEXTS.myPois]: () => {},
    [MAP_CONTEXTS.myStops]: () => {},
    [MAP_CONTEXTS.layers]: () => {},
    [MAP_CONTEXTS.trash]: () => {},
    [MAP_CONTEXTS.settings]: () => {},
    [MAP_CONTEXTS.about]: () => {},
  })

  const stylePanelMode =
    styleTarget === 'feature'
      ? STYLE_PANEL_MODES.selectedFeature
      : styleTarget === 'bulk'
        ? STYLE_PANEL_MODES.bulkSelection
        : STYLE_PANEL_MODES.drawingDefault

  /**
   * Geri yükleme onayında gösterilecek kayıt adı.
   *
   * Çöp Kutusu girişleri iki türdür ve gövdeyi FARKLI alanda taşır (çizim:
   * `drawing`, POI: `poi`); `trashRecordOf` o okumanın tek tanımıdır ve panel
   * de aynı yardımcıyı kullanır — böylece satırda görünen ad ile diyalogda
   * sorulan ad ayrışamaz. Adsız bir kayıt için türün etiketine düşülür.
   */
  const restoreTargetName = (item) =>
    trashRecordOf(item)?.name || (item?.type === 'poi' ? 'POI' : DRAWING_TYPES[item?.type]?.label) || 'Kayıt'

  /** "1 Nokta, 1 Çizgi ve 1 Poligon" for the delete confirmation. */
  const describeSelection = (items) => {
    const parts = DRAWING_TYPE_LIST.map((type) => {
      const count = items.filter((item) => item.type === type.id).length
      return count > 0 ? `${count} ${type.label}` : null
    }).filter(Boolean)

    if (parts.length <= 1) return parts.join('')
    return `${parts.slice(0, -1).join(', ')} ve ${parts.at(-1)}`
  }

  return (
    <div className={`map-page ${mapReady ? 'map-page--ready' : ''}`}>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        activePanel={mapContext.active}
        onSelectPanel={handleSelectPanel}
        canOpenTrash={canOpenTrash}
        canOpenMyPois={canOpenMyPois}
        canOpenMyStops={canOpenMyStops}
        canOpenLocationAnalysis={canOpenLocationAnalysis}
        /* Yolculuk Merkezi'nin TEK kenar çubuğu girişi. Görünürlük, panelin
           kendisiyle AYNI yetki hesabından gelir: kullanıcının erişebildiği
           en az bir ürün varsa satır çıkar. */
        canOpenJourneyCenter={canOpenJourney}
        /* Satır paneli açar/kapatır — harita kısayoluyla AYNI eylem. Hiçbir
           simülasyon, izleme ya da takip durumu değişmez. */
        onOpenJourneyCenter={toggleJourneyPanel}
        username={username}
        remaining={remaining}
        onLogout={handleLogout}
      />

      <div className="map-main">
        <Topbar
          username={username}
          remaining={remaining}
          onLogout={handleLogout}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          mobileMenuOpen={mobileMenuOpen}
        />

        <div className={`map-viewport ${hasDockedPanel ? 'has-docked-panel' : ''}`}>
          <div className="map-container" ref={mapContainerRef} />

          {mapReady && (
            <>
              <QuickActions
                search={{
                  permitted: globalSearchTypes.length > 0,
                  open: poiSearchOpen,
                  onToggle: togglePoiSearch,
                  buttonRef: poiSearchButtonRef,
                }}
                /* Yolculuk kısayolu haritanın KENDİ denetim yığınındadır:
                   panelin köşesindeki eski yeniden açma düğmesi analiz
                   panelinin üstüne oturuyordu. Durum özeti sunucudan türetilir
                   ve panel kapalıyken de yolculuğun sürdüğünü söyler. */
                journey={{
                  /* BİRLEŞİK çalışma alanı kısayolu: paylaşılan hat de bu
                     panelin içinde olduğu için, kısayolu yalnızca
                     `journey.use`'a bağlamak `transport.view` taşıyan bir
                     kullanıcının hat simülasyonuna hiçbir yerden
                     ulaşamaması demek olurdu. Kapı EN AZ BİR ürünle açılır;
                     içerideki her bölüm kendi yetkisini ayrıca ister. */
                  permitted: canOpenJourney,
                  open: journey.state.panel !== 'closed',
                  onToggle: toggleJourneyPanel,
                  status: journeyStatus,
                }}
                onGoTurkey={mapView.goToTurkey}
                onGoMyLocation={mapView.goToMyLocation}
                onFocusAll={focusAllDrawings}
              >
                {/* Background imagery. Not the "Katmanlar" panel, which toggles
                    the data overlays drawn on top of whatever is chosen here. */}
                <BasemapSelector
                  value={basemap.basemapId}
                  options={basemap.basemaps}
                  onChange={basemap.selectBasemap}
                />

                {/* Yığının en altındaki dördüncü denetim. Yalnızca bir
                    ANAHTARDIR: kutu kendi onaylanmış üst-orta konumunda açılır.
                    Görünürlüğü izinli global arama türlerinden türer. */}
              </QuickActions>

              {/* Arama kutusu yetkiden VE açıklıktan türer: izinli POI, çizim
                  veya ulaşım türü yoksa ya da kutu kapalıysa hiç çizilmez ve
                  hiçbir arama işi açılmaz. Rol adına bakan kural yoktur.

                  Koşullu monte etmek bilinçlidir: kapanış, bileşenin
                  SÖKÜLMESİDİR ve uçan isteğin iptali, açılır listenin
                  kaybolması, klavye imlecinin sıfırlanması ve sorgunun
                  temizlenmesi bundan kendiliğinden gelir. */}
              {globalSearchTypes.length > 0 && poiSearchOpen && (
                <PoiSearchBar
                  enabled
                  availableTypes={globalSearchTypes}
                  drawings={workspace.drawings}
                  stops={transport.stops}
                  routes={transport.routes}
                  onSelect={focusSearchResult}
                  onClose={closePoiSearch}
                />
              )}

              {/* Everything below renders straight from the canonical mode —
                  no component keeps its own idea of the active tool. */}
              <DrawToolbar
                activeTool={workspaceMode.activeDrawTool}
                /* Guarded actions, not the raw mode ones: the bar, the letter
                   shortcuts and the style panel's tabs all pass through the
                   same gate, so a hidden tool has no second way in. */
                onSelectTool={allowed.selectDrawTool}
                measureMode={workspaceMode.activeMeasureTool}
                onSelectMeasure={(mode) => allowed.selectMeasureTool(mode ?? 'distance')}
                selectionTool={workspaceMode.activeSelectionTool}
                onSelectSelectionTool={allowed.selectSelectionTool}
                analysisActive={Boolean(workspaceMode.activeAnalysisTool)}
                /* Araç düğmeleri bağlam koordinatöründen geçer: açılan araç
                   çakışan paneli kendiliğinden kapatır. */
                onToggleAnalysis={toggleInventoryAnalysis}
                poiActive={workspaceMode.isPlacingPoi}
                onTogglePoi={togglePoiPlacement}
                transportStopActive={workspaceMode.isPlacingTransportStop}
                onToggleTransportStop={toggleTransportStopPlacement}
                onOpenStyle={openStyleForTool}
                canUndo={workspace.canUndo}
                canRedo={workspace.canRedo}
                onUndo={workspace.undo}
                onRedo={workspace.redo}
                permissions={allowed}
                /* Katlamak MOD DEĞİŞTİRMEZ: etkin araç workspaceMode'da
                   yaşamaya devam eder ve çubuk açıldığında her şey bıraktığı
                   gibidir. */
                collapsed={toolbarCollapsed}
                onToggleCollapse={toggleToolbar}
              />

              <DrawingHint
                activeTool={workspaceMode.activeDrawTool}
                measureMode={workspaceMode.activeMeasureTool}
                selectionTool={workspaceMode.activeSelectionTool}
                analysisActive={Boolean(workspaceMode.activeAnalysisTool)}
                transportStopActive={workspaceMode.isPlacingTransportStop}
                /* Kısıt, araç seçilir seçilmez SÖYLENİR — ilk geçersiz tıkla
                   öğrenilmesi beklenmez. */
                scopeRestricted={analysisCatalog.isRestricted}
              />

              {/* Çalışma alanı EN AZ BİR ürünle çizilir; içindeki bölümler
                  kendi yetkilerini ayrıca ister (kişisel: `journey.use`,
                  paylaşılan: `transport.view`). Hiçbir ürünü olmayana panel
                  hiç çizilmez — backend'in 403 döndüreceği bir akış
                  gösterilmez. Rol adı, kullanıcı adı ya da yönetici bayrağı
                  hiçbir biçimde okunmaz. */}
              {canOpenJourney && (
                <JourneyPlannerPanel
                  state={journey.state}
                  routes={transport.activeRoutes}
                  stops={transport.stops}
                  preview={journey.preview}
                  loading={journey.loading}
                  /* HATA ve REHBERLİK ayrı iki kavramdır: eksik bir seçim
                     kullanıcının yaptığı bir yanlış değildir ve kırmızı bir
                     uyarı gibi sunulmaz. */
                  error={journey.error}
                  guidance={journey.validationError}
                  canRequest={journey.canRequest}
                  /* Etkin seçim kipi: yalnızca çalışma alanı dinlenirken
                     doğrudur (Faz 5E-B · Dilim 1), dolayısıyla haritanın
                     gerçekten beklediği durumu anlatır. */
                  picking={journey.isPicking}
                  canUsePois={allowed.canViewPoi}
                  /* Ürün kapısı bir KAYNAK anahtarı değildir: hat ve durak
                     seçimleri kendi yetkisini ister. Bu yalnızca GÖRÜNÜRLÜK
                     kararıdır; bağlayıcı denetim backend'dedir. */
                  canUseTransport={allowed.canViewTransport}
                  /* ÜST DÜZEY ürün ekseni. Kararı saf modül verir; panel
                     yalnızca çizer ve MapPage yetkiyi ikinci kez yorumlamaz. */
                  product={journeyProduct}
                  productTabs={journeyProductOptions}
                  onProductChange={journey.setProduct}
                  shared={sharedJourney}
                  onStartShared={startSharedSimulation}
                  onPauseShared={pauseSharedSimulation}
                  onResumeShared={resumeSharedSimulation}
                  onStopShared={requestSharedStop}
                  onFollowShared={followSharedSimulation}
                  onUnfollowShared={unfollowSharedSimulation}
                  /* AKTİF SİMÜLASYONLAR (Faz 4A). Liste bir YÖNETİM yüzeyi
                     değildir: satırlar yaşam döngüsü düğmesi taşımaz ve
                     izleme/seçim/takip birbirinden bağımsız kalır. */
                  activeSimulations={activeSimulations}
                  onActiveSearchChange={setActiveSimulationSearch}
                  onSelectActiveRoute={selectActiveSimulationRow}
                  onToggleWatch={simulation.toggleWatch}
                  onWatchAll={simulation.watchAll}
                  onClearWatch={simulation.clearWatch}
                  onRetryActive={simulation.reloadActive}
                  onToggleManaged={simulation.toggleManaged}
                  onSelectAllActive={simulation.manageAllActive}
                  onClearSelection={simulation.clearManaged}
                  onRunBatchAction={runLifecycleOperation}
                  sharedNavigation={sharedNavigation}
                  poiSearch={journeyPickerSearch}
                  onModeChange={journey.setMode}
                  onProfileChange={journey.setProfile}
                  onRouteChange={journey.setRoute}
                  onSegmentStopChange={journey.setSegmentStop}
                  onSwapSegmentStops={journey.swapSegmentStops}
                  onAddWaypoint={addJourneyWaypoint}
                  onRemoveWaypoint={journey.removeWaypoint}
                  onMoveWaypoint={journey.moveWaypoint}
                  onAssignWaypoint={journey.assignWaypoint}
                  /* Silahlanma çalışma alanının dinlenmesini İSTER: sarmalayıcı
                     önce etkin aracı bırakır, sonra yuvayı silahlar. */
                  onArmSlot={armJourneySlot}
                  onRequestPreview={journey.requestPreview}
                  onClear={journey.clear}
                  /* KAYDEDİLENLER (Faz 7). Sunum modeli saf modülden gelir;
                     her eylem KAYIT KİMLİĞİ taşır ve panelde "seçili kayıt"
                     diye bir durum yoktur. */
                  saved={{
                    items: savedJourneys.items,
                    loading: savedJourneys.loading,
                    loaded: savedJourneys.loaded,
                    error: savedJourneys.error,
                    busyId: savedJourneys.busyId,
                    saving: savedJourneys.saving,
                  }}
                  onSectionChange={journey.setSection}
                  /* KAYDETMEK BAŞLATMAK DEĞİLDİR: bu yol simülasyona hiç
                     dokunmaz. */
                  onSaveJourney={requestJourneySave}
                  canSaveJourney={Boolean(journey.buildIntent())}
                  /* YÜKLEMEK de başlatmak değildir; başlatma ayrı eylemdir. */
                  onLoadSavedJourney={loadSavedJourney}
                  onUseSavedJourney={startSavedJourney}
                  onRenameSavedJourney={requestSavedJourneyRename}
                  onDeleteSavedJourney={requestSavedJourneyDelete}
                  onToggleSavedFavorite={toggleSavedJourneyFavorite}
                  onRetrySavedJourneys={savedJourneys.refresh}
                  /* GEÇMİŞ (Faz 8). Tutanak DEĞİŞTİRİLEMEZ: ad, favori ya da
                     silme eylemi geçirilmez çünkü böyle bir eylem yoktur. */
                  history={{
                    items: journeyHistory.items,
                    filterId: journeyHistory.filterId,
                    loading: journeyHistory.loading,
                    loadingMore: journeyHistory.loadingMore,
                    loaded: journeyHistory.loaded,
                    hasMore: journeyHistory.hasMore,
                    error: journeyHistory.error,
                    detail: journeyHistory.detail,
                    detailId: journeyHistory.detailId,
                    busyId: journeyHistory.busyId,
                  }}
                  onHistoryFilterChange={journeyHistory.setFilter}
                  /* Ayrıntıyı AÇMAK bir simülasyon başlatmaz. */
                  onOpenHistoryDetail={journeyHistory.openDetail}
                  onCloseHistoryDetail={journeyHistory.closeDetail}
                  /* YÜKLEMEK de başlatmak değildir; başlatma ayrı eylemdir. */
                  onLoadHistoryIntoPlanner={loadJourneyFromHistory}
                  onReuseHistory={reuseJourneyFromHistory}
                  onLoadMoreHistory={journeyHistory.loadMore}
                  onRetryHistory={journeyHistory.refresh}
                  onCollapse={journey.collapsePanel}
                  onClose={closeJourneyPanel}
                  onOpen={openJourneyPanel}
                  live={{
                    simulation: journeySimulation.simulation,
                    snapshot: journeySimulation.snapshot,
                    starting: journeySimulation.starting,
                    error: journeySimulation.error,
                    following: journeySimulation.following,
                  }}
                  onStartSimulation={startJourney}
                  /* Durdurma ONAYDAN geçer; balon/panel kapatma geçmez. */
                  onStopSimulation={requestJourneyStop}
                  onToggleFollow={toggleJourneyFollow}
                  /* Terminal çıkışları: ikisi de YALNIZCA sunucu sonucunu
                     bırakır; paneli kapatmak ya da durdurmak değildir. */
                  onReturnToPlanning={returnToJourneyPlanning}
                  onNewJourney={startNewJourney}
                />
              )}

              {/* One readout for both analysis entry points: the temporary tool
                  and the run that follows a saved polygon. */}
              <AnalysisPanel
                loading={analysis.isLoading}
                result={analysis.result}
                error={analysis.error}
                selectedKey={analysis.selectedKey}
                onSelectItem={analysis.selectItem}
                onShowOnMap={showAnalysisItemOnMap}
                onOpenDrawing={openAnalysisItemDrawing}
                metricsFor={analysisMetrics}
                onOpenPoi={openAnalysisPoi}
                onClear={analysis.clear}
                /* Paneli kapatmak BAĞLAMI bırakmaktır; analiz alanı ve sonucu
                   emeklilikte temizlenir. */
                onClose={() => mapContext.close(MAP_CONTEXTS.inventory)}
              />

              {/* Yoğunluk ölçeği artık harita üzerinde yüzen bir katman
                  değil, HeatmapPanel'in bir bölümüdür — bkz. HeatmapLegend.
                  Böylece hiçbir görünüm genişliğinde harita kontrollerinin
                  üstüne binemez. */}

              <MeasurementReadout
                mode={workspaceMode.activeMeasureTool}
                liveLabel={measurement.liveLabel}
                results={measurement.results}
                onSelectMode={allowed.selectMeasureTool}
                onClear={measurement.clear}
                onClose={() => {
                  measurement.clear()
                  workspaceMode.stopMeasuring()
                }}
              />

              {hasFinePointer && <HoverTooltip hovered={hovered} />}

              <SavingIndicator visible={workspace.isSaving} />

              {workspace.loadingDrawings && (
                <div className="map-drawings-loading" role="status">
                  Kayıtlı çizimler yükleniyor...
                </div>
              )}

              <StylePanel
                open={isStylePanelOpen}
                mode={stylePanelMode}
                onClose={closeStylePanel}
                editingFeature={styleTarget === 'feature' ? selectedFeature : null}
                selectedFeatures={styleTarget === 'bulk' ? selectedFeatures : []}
                toolStyles={workspace.toolStyles}
                // The type the panel edits and the tool the map draws with are
                // the same value, read from and written back to one place.
                activeType={workspaceMode.styleToolType}
                /* Tip sekmeleri de aracı DEĞİŞTİRİR; aynı kapıdan geçerler,
                   aksi hâlde gizli bir araç panelden açılabilirdi. */
                onSelectDrawTool={allowed.setDrawTool}
                onSetToolStyle={workspace.setToolStyle}
                onPreview={workspace.previewStyle}
                onPreviewPatch={workspace.previewStylePatch}
                onApply={workspace.applyStyle}
                onApplyPatch={workspace.applyStylePatchToSelection}
              />

              <SelectedFeaturePanel
                open={isSelectedPanelOpen}
                feature={selectedFeature}
                geometry={selectedGeometry}
                onClose={workspace.clearSelection}
                onZoom={() => selectedFeature && fitExtent(extentOf(selectedFeature.key))}
                onEditStyle={openStyleForSelection}
                onDelete={requestDelete}
                editing={workspaceMode.isEditing}
                saving={workspace.isSaving}
                onStartEdit={startEdit}
                onSaveEdit={saveEdit}
                onCancelEdit={() => cancelEdit()}
                session={editSession}
                editMode={geometryEditMode}
                onEditModeChange={setGeometryEditMode}
                onSelectVertex={selectEditedVertex}
                onFocusVertex={focusEditedVertex}
                onCopyText={copyText}
                onNotify={showToast}
                canManage={canManageSelected}
                canEdit={allowed.canEditDrawing}
                canRestyle={allowed.canUpdateStyle}
                canDelete={allowed.canDeleteDrawings}
              />

              <MultiSelectionPanel
                open={isMultiPanelOpen}
                count={selectionCount}
                counts={selectionCounts}
                onClose={workspace.clearSelection}
                onFocus={focusSelection}
                onEditStyle={openStyleForBulk}
                onDelete={requestDelete}
                onClear={workspace.clearSelection}
                canManageAll={canManageSelection}
                canRestyle={allowed.canUpdateStyle}
                canDelete={allowed.canDeleteDrawings}
                foreignCount={foreignSelectedCount}
              />

              <DrawingsPanel
                open={mapContext.isActive(MAP_CONTEXTS.drawings) && allowed.canViewDrawings}
                onClose={() => mapContext.close(MAP_CONTEXTS.drawings)}
                drawings={workspace.drawings}
                selectedKeys={selectedKeys}
                visibility={workspace.visibility}
                visibleCount={workspace.visibleCount}
                loading={workspace.loadingDrawings}
                error={workspace.loadError}
                onRetry={workspace.reloadDrawings}
                onSelect={selectFromList}
                onToggleSelect={workspace.toggleSelection}
                onSelectAllVisible={() => {
                  const count = workspace.selectAllVisible()
                  showToast('info', count ? `${count} çizim seçildi.` : 'Görünür çizim yok.')
                }}
                onClearSelection={workspace.clearSelection}
                onEdit={editFromList}
                onDelete={deleteFromList}
                canManage={(item) => canManageDrawing({ isAdmin, userId }, item)}
                canEdit={allowed.canEditDrawing}
                canDelete={allowed.canDeleteDrawings}
              />

              {/* Çizimlerim'in kardeşi: aynı iskelet, ayrı alan nesnesi.
                  Kapsamı sunucu belirler; burada sahiplik süzgeci yoktur. */}
              <MyPoisPanel
                open={mapContext.isActive(MAP_CONTEXTS.myPois) && canOpenMyPois}
                onClose={() => mapContext.close(MAP_CONTEXTS.myPois)}
                pois={myPois.items}
                loading={myPois.loading}
                error={myPois.error}
                onRetry={myPois.reload}
                onSelect={focusMyPoi}
                /* Haritanın zaten okuduğu kategori metadatası; POI'lerim için
                   ikinci bir istek açılmaz. */
                categoryPresentation={poiCategoryPresentation}
                onEdit={editMyPoi}
                onDelete={deleteMyPoi}
                busyId={poiSaving ? pendingPoiDelete?.id ?? poiEditing?.id ?? null : null}
              />

              <MyStopsPanel
                open={mapContext.isActive(MAP_CONTEXTS.myStops) && canOpenMyStops}
                onClose={() => mapContext.close(MAP_CONTEXTS.myStops)}
                stops={myStops.items}
                loading={myStops.loading}
                error={myStops.error}
                onRetry={myStops.reload}
                onSelect={focusMyStop}
                onEdit={editTransportStop}
                onDelete={requestTransportStopDelete}
                canEdit={allowed.canUpdateTransportStop}
                canDelete={allowed.canDeleteTransportStop}
                busyId={transportStopBusyId}
              />

              {/* Soft delete made visible: the rows the database kept, with
                  the one action that puts them back. No permanent delete. */}
              <TrashPanel
                open={mapContext.isActive(MAP_CONTEXTS.trash) && canOpenTrash}
                onClose={() => mapContext.close(MAP_CONTEXTS.trash)}
                items={trash.items}
                loading={trash.loading}
                error={trash.error}
                restoringKey={trash.restoringKey}
                onRetry={trash.reload}
                onRestore={requestRestore}
              />

              <LayersPanel
                open={mapContext.isActive(MAP_CONTEXTS.layers) && can(PERMISSIONS.LAYERS_VIEW)}
                onClose={() => mapContext.close(MAP_CONTEXTS.layers)}
                poi={{
                  permitted: allowed.canViewPoi,
                  count: poi.count,
                  ids: poi.pois.map((item) => item.id),
                  state: visibilityState(poi.pois.map((item) => item.id), layerVisibility.hiddenPoiIds),
                  categories: poiCategoryTree,
                }}
                onSetPoiVisibility={layerVisibility.setPoiVisible}
                onTogglePoi={layerVisibility.togglePoi}
                drawings={{
                  permitted: allowed.canViewDrawings,
                  count: drawingLayerIds.length,
                  ids: drawingLayerIds,
                  state: drawingVisibilityState(drawingLayerIds, layerVisibility.hiddenDrawingIds),
                  groups: drawingLayerGroups,
                }}
                onSetDrawingVisibility={layerVisibility.setDrawingVisible}
                onToggleDrawing={layerVisibility.toggleDrawing}
                transport={{
                  permitted: allowed.canViewTransport,
                  routesVisible: transportRoutesVisible,
                  routeCount: transport.routes.length,
                  stopCount: transport.stops.length,
                  routeIds: routeLayerIds,
                  routeState: visibilityState(routeLayerIds, hiddenTransportRouteIds),
                  stopIds: stopLayerIds,
                  stopState: visibilityState(stopLayerIds, layerVisibility.hiddenTransportStopIds),
                  stops: recordRows(transport.stops, layerVisibility.hiddenTransportStopIds),
                  routes: transport.routes.map((route) => ({
                    id: route.id,
                    name: route.name,
                    colorHex: route.colorHex,
                    visible: !hiddenTransportRouteIds.has(route.id),
                    isStale: transport.paths.find((path) => path.routeId === route.id)?.isStale === true,
                  })),
                }}
                onToggleTransportRoutes={() => setTransportRoutesVisible((value) => !value)}
                onSetTransportRoutes={(ids, visible) => setHiddenTransportRouteIds(
                  (current) => visible ? showRecords(current, ids) : hideRecords(current, ids),
                )}
                onToggleTransportRoute={toggleTransportRoute}
                onSetTransportStops={layerVisibility.setStopVisible}
                onToggleTransportStop={layerVisibility.toggleStop}
                /* Salt görselleştirme: katman kapatılabilir ama silinemez ve
                   başka bir kullanıcının alanını göstermez. */
                scope={{
                  isRestricted: geographic.isRestricted,
                  areaCount: geographic.areaCount,
                  failed: geographic.failed,
                  visible: scopeLayerVisible,
                }}
                onToggleScope={() => setScopeLayerVisible((value) => !value)}
              />

              <HeatmapPanel
                open={mapContext.isActive(MAP_CONTEXTS.heatmap) && canUseHeatmap}
                enabled={heatmapEnabled}
                opacity={heatmap.opacity}
                loading={heatmap.loading}
                error={heatmap.error}
                hasImage={heatmap.hasImage}
                /* Paneli kapatmak ısı haritasını KAPATMAZ: katman
                   `heatmapEnabled` ile yaşar ve haritada kalmaya devam eder. */
                onClose={() => mapContext.close(MAP_CONTEXTS.heatmap)}
                onToggle={() => setHeatmapEnabled((value) => !value)}
                onOpacityChange={heatmap.setOpacity}
                onRetry={heatmap.refresh}
              />

              <AnalysisPoiPopup
                map={mapInstance}
                poi={analysisPoiInspect.poi}
                error={analysisPoiInspect.error}
                onClose={analysisPoiInspect.close}
              />

              <TransportStopPopup
                map={mapInstance}
                stop={mapContext.isActive(MAP_CONTEXTS.transportStopInfo) ? selectedTransportStop : null}
                onClose={() => mapContext.close(MAP_CONTEXTS.transportStopInfo)}
                onZoom={focusMyStop}
                onShowRoute={showTransportRoute}
                onEdit={editTransportStop}
                onDelete={requestTransportStopDelete}
                canEdit={allowed.canUpdateTransportStop}
                canDelete={allowed.canDeleteTransportStop}
                busy={transportStopBusyId === selectedTransportStop?.id}
              />

              <TransportVehiclePopup
                map={mapInstance}
                vehicle={vehiclePopup}
                onClose={() => setVehiclePopupTarget(null)}
              />

              {/* Kişisel yolculuk balonu AYRI bir üründür; paylaşılan hat
                  aracının balonuyla aynı yerleşim dilini kullanır ama onunla
                  hiçbir durumu paylaşmaz. Kapatmak yalnızca kapatır. */}
              <JourneyVehiclePopup
                map={mapInstance}
                journey={journeyVehiclePopup}
                onClose={() => setJourneyPopupSimulationId(null)}
              />

              {/* AYRI "Hat Simülasyonu" kartı KALDIRILDI (Faz 2). Aynı
                  yetenekler artık YOLCULUK çalışma alanının paylaşılan
                  bölümündedir: iki bağımsız panelin ekranda yarışması,
                  kullanıcıya iki ayrı ürün gibi görünen tek bir işi iki yerden
                  yönettiriyordu.

                  Ana harita o kartın bileşenine ARTIK HİÇ BAĞLI DEĞİLDİR —
                  ne içe aktarır ne çizer. Bileşenin kendisi silinmedi;
                  güzergah yönetimi ekranı onu kendi düzeninde kullanmaya
                  devam eder ve sahibi orasıdır. Adı burada bilinçli olarak
                  yazılmaz: kaldırılmış bir bağımlılığa yapılan ölü bir atıf,
                  arayan kişiyi hâlâ burada duruyormuş gibi yanıltır. */}

              <LocationAnalysisPanel
                open={locationAnalysisOpen}
                onClose={() => mapContext.close(MAP_CONTEXTS.locationAnalysis)}
                areaMode={areaMode}
                onAreaModeChange={handleAreaModeChange}
                provinceCode={provinceCode}
                onProvinceChange={handleProvinceChange}
                areaLabel={locationArea.areaLabel}
                isDrawing={workspaceMode.isSelectingAnalysisArea}
                provinces={visibleProvinces}
                regions={analysisRegions}
                catalogLoading={analysisCatalog.loading}
                catalogError={analysisCatalog.error}
                regionKey={regionKey}
                onRegionChange={handleRegionChange}
                scopeRestricted={geographic.isRestricted}
                categories={poiCategories.items}
                categoriesLoading={poiCategories.loading}
                categoriesError={poiCategories.error}
                onRetryCategories={loadPoiCategories}
                criteria={criteria}
                onCriterionChange={handleCriterionChange}
                onAddCriterion={handleAddCriterion}
                onRemoveCriterion={handleRemoveCriterion}
                validation={locationValidation}
                onAnalyze={handleRunAnalysis}
                onClear={handleClearAnalysis}
                status={analysisStatus}
                summary={analysisSummary}
                error={analysisError}
                imageLoading={locationAnalysisLayer.loading}
                imageError={locationAnalysisLayer.error}
                onRetryImage={locationAnalysisLayer.refresh}
                opacity={locationAnalysisLayer.opacity}
                onOpacityChange={locationAnalysisLayer.setOpacity}
                hasActiveAnalysis={activeAnalysis !== null}
                heatmapCriterion={heatmapCriterion}
                onHeatmapCriterionChange={setHeatmapCriterion}
                poiOverlayVisible={poiOverlayVisible}
                onPoiOverlayVisibleChange={setPoiOverlayVisible}
                poiOverlayLoading={locationAnalysisPoiLayer.loading}
                poiOverlayCount={locationAnalysisPoiLayer.count}
                poiOverlayTruncated={locationAnalysisPoiLayer.truncated}
                poiOverlayError={locationAnalysisPoiLayer.error}
              />

              <SettingsPanel
                open={mapContext.isActive(MAP_CONTEXTS.settings)}
                onClose={() => mapContext.close(MAP_CONTEXTS.settings)}
                shortcutsEnabled={hasFinePointer}
              />

              <AboutPanel
                open={mapContext.isActive(MAP_CONTEXTS.about)}
                onClose={() => mapContext.close(MAP_CONTEXTS.about)}
              />

              {/* Opens the instant a shape is finished. Until "Kaydet" is
                  pressed the geometry exists only on the pending layer — no
                  record has been created, so "İptal" simply throws it away. */}
              <AttributePopup
                open={Boolean(workspace.pendingDrawing)}
                pending={workspace.pendingDrawing}
                saving={workspace.isSaving}
                onSave={workspace.savePendingDrawing}
                onCancel={workspace.cancelPendingDrawing}
                onColorChange={workspace.previewPendingColor}
              />

              {/* Nokta konduktan SONRA açılan öznitelik formu. `key` bekleyen
                  konuma bağlıdır: yeni bir yerleştirme formu sıfırdan kurar ve
                  bir önceki denemenin değerleri sonrakine sızmaz. */}
              <PoiFormSheet
                key={pendingPoi ? `${pendingPoi.longitude},${pendingPoi.latitude}` : 'poi-form'}
                mode="create"
                open={poiFormOpen && allowed.canCreatePoi && mapContext.isActive(MAP_CONTEXTS.poiCreate)}
                point={pendingPoi}
                categories={poiCategories.items}
                categoriesLoading={poiCategories.loading}
                categoriesError={poiCategories.error}
                onRetryCategories={loadPoiCategories}
                saving={poiSaving}
                error={poiError}
                onSave={savePoi}
                onCancel={closePoiForm}
              />

              <TransportStopForm
                key={transportPlacement.pending
                  ? `${transportPlacement.pending.longitude},${transportPlacement.pending.latitude}`
                  : 'transport-stop-form'}
                open={
                  transportStopFormOpen
                  && allowed.canCreateTransportStop
                  && mapContext.isActive(MAP_CONTEXTS.transportStopCreate)
                }
                point={transportPlacement.pending}
                routes={transportRouteOptions}
                saving={transportStopSaving}
                error={transportStopError}
                canGenerateRoutePath={allowed.canUpdateTransportRoute}
                onSave={saveTransportStop}
                onCancel={closeTransportStopForm}
              />

              <TransportStopEditForm
                key={transportStopEditing ? `transport-stop-edit-${transportStopEditing.id}-${transportStopEditVersion}` : 'transport-stop-edit'}
                open={mapContext.isActive(MAP_CONTEXTS.transportStopEdit) && Boolean(transportStopEditing)}
                stop={transportStopEditing}
                routes={transportRouteOptions}
                pendingPoint={transportRelocation.pending}
                moving={workspaceMode.isRelocatingTransportStop}
                saving={transportStopSaving}
                error={transportStopError}
                canGenerateRoutePath={allowed.canUpdateTransportRoute}
                onStartMove={workspaceMode.startTransportStopRelocation}
                onCancelMove={cancelTransportStopRelocation}
                onSave={saveTransportStopEdit}
                onCancel={closeTransportStopEdit}
              />

              {/* Düzenleme formu OLUŞTURMA formuyla aynı bileşendir; `key`
                  kayda bağlıdır, böylece başka bir POI'ye geçmek formu
                  sıfırdan kurar ve önceki kaydın değerleri sızmaz. */}
              <PoiFormSheet
                key={poiEditing ? `poi-edit-${poiEditing.id}-${poiEditHandoffDraft ? 'handoff' : 'own'}` : 'poi-edit'}
                mode="edit"
                open={mapContext.isActive(MAP_CONTEXTS.poiEdit) && Boolean(poiEditing)}
                poi={poiEditing}
                /* Devralınan taslak yalnızca BAŞLANGIÇ değerleridir; "neye göre
                   değişti" ve "geri al" hâlâ kalıcı kaydı referans alır. */
                initialDraft={poiEditHandoffDraft}
                categories={poiCategories.items}
                categoriesLoading={poiCategories.loading}
                categoriesError={poiCategories.error}
                onRetryCategories={loadPoiCategories}
                /* Taslak konumun sahibi bu sayfadır; form ve haritadaki
                   sürükleme AYNI değeri yazar. */
                coordinate={poiEditCoordinate}
                onCoordinateChange={setPoiEditCoordinate}
                moveActive={poiMoveActive}
                onToggleMove={setPoiMoveActive}
                saving={poiSaving}
                error={poiError}
                onSave={savePoiEdit}
                onCancel={cancelPoiEdit}
              />

              <PoiInfoSheet
                open={mapContext.isActive(MAP_CONTEXTS.poiInfo) && Boolean(selectedPoi) && allowed.canViewPoi}
                poi={selectedPoi}
                onClose={() => mapContext.close(MAP_CONTEXTS.poiInfo)}
                /* Düğmeler kaydın kendi yetenek bayraklarına bakar; sahiplik
                   kuralı tarayıcıda yeniden hesaplanmaz. */
                onEdit={startPoiEdit}
                onDelete={requestPoiDelete}
                /* "Zoom Yap" bir yetkiye bağlı DEĞİLDİR: paneli görebilen zaten
                   kaydı görebiliyor demektir ve kameranın hareketi hiçbir veriyi
                   açığa çıkarmaz. */
                onZoom={zoomToSelectedPoi}
                busy={poiSaving}
              />

              <MapToasts toasts={toasts} onDismiss={dismissToast} />

              {/* One dialog for both cases: the wording scales with the count
                  and always names exactly what is about to be removed. */}
              <ConfirmDialog
                open={Boolean(pendingDelete?.length)}
                title={pendingDelete?.length > 1 ? 'Çizimleri sil' : 'Çizimi sil'}
                message={
                  !pendingDelete?.length
                    ? ''
                    : pendingDelete.length === 1
                      ? // Naming the drawing makes the dialog specific enough to
                        // catch a mis-click on the wrong row.
                        `“${pendingDelete[0].name || DRAWING_TYPES[pendingDelete[0].type].label}” çizimini silmek istediğinize emin misiniz?`
                      : `${pendingDelete.length} çizimi silmek istediğinize emin misiniz?`
                }
                description={
                  !pendingDelete?.length
                    ? ''
                    : // Soft delete: the row stays in the database, so promising
                      // permanent removal here would be untrue.
                      `${describeSelection(pendingDelete)} haritadan ve Çizimlerim listesinden kaldırılacaktır. Bu işlem geri alınabilir.`
                }
                confirmLabel={pendingDelete?.length > 1 ? `${pendingDelete.length} Çizimi Sil` : 'Sil'}
                onConfirm={confirmDelete}
                onCancel={() => setPendingDelete(null)}
              />

              {/* POI silme onayı. Çizimlerle AYNI diyalog bileşeni: iki
                  silme de aynı görünür ve ikisi de yumuşak silmedir — metin
                  bu yüzden kalıcı bir kayıp vaat etmez. */}
              {/* PAYLAŞILAN hat durdurma onayı. Kişisel yolculuk onayıyla AYNI
                  diyalog bileşeni ama AYRI bir durum ve ayrı bir metin: bu
                  çalıştırmayı yalnızca kullanıcının kendisi değil, hattı
                  izleyen HERKES kaybeder — metin bunu açıkça söyler. */}
              <ConfirmDialog
                open={pendingSharedStop != null && canStopSharedSimulation}
                title="Hat simülasyonunu sıfırla"
                message="Bu hat simülasyonunu sıfırlamak istediğinize emin misiniz?"
                /* Metin ürün anlamını OLDUĞU GİBİ söyler: çalıştırma sona
                   erer ve hat başlangıç durumuna döner. "Aynı simülasyon
                   %0'a alınır" demek yanlış olurdu — sonraki başlatma YENİ
                   bir çalıştırma üretir. Yalnızca duraklatmak isteyen
                   kullanıcı için ayrı bir eylem (Duraklat) vardır. */
                description="Bu simülasyon sona erdirilecek ve hat başlangıç durumuna dönecek; onu izleyen diğer kullanıcılar da aracı görmeyi bırakır. Yeniden başlatıldığında %0'dan yeni bir simülasyon oluşturulur."
                confirmLabel="Sıfırla"
                cancelLabel="Vazgeç"
                busy={simulation.stopping}
                onConfirm={confirmSharedStop}
                /* Vazgeçmek HİÇBİR ŞEY yapmaz: sunucuya istek gitmez. */
                onCancel={() => setPendingSharedStop(null)}
              />

              {/* TOPLU yaşam döngüsü onayı (Faz 4B). Aynı diyalog bileşeni,
                  AYRI bir durum ve işleme göre AYRI bir metin.

                  METİN ÜRÜN ANLAMINI OLDUĞU GİBİ SÖYLER. Sıfırlama hat
                  TANIMINI silmez ve yerine yeni bir çalıştırma koymaz; yeniden
                  başlatma ise mevcut çalıştırmaları bitirip her hat için %0'dan
                  YENİ bir simülasyon kurar — izleme, takip ve yönetim seçimi
                  yeni çalıştırmaya GEÇMEZ. GUID gösterilmez: kullanıcıya
                  anlatılan şey kaç çalıştırmanın etkileneceğidir. */}
              <ConfirmDialog
                open={pendingBatchCommand != null && canStopSharedSimulation}
                title={pendingBatchCommand?.operation === LIFECYCLE_OPERATIONS.RESTART
                  ? 'Seçili simülasyonları yeniden başlat'
                  : 'Seçili simülasyonları sıfırla'}
                message={pendingBatchCommand?.operation === LIFECYCLE_OPERATIONS.RESTART
                  ? `Seçili ${pendingBatchCommand?.targets.length ?? 0} simülasyon yeniden başlatılsın mı?`
                  : `Seçili ${pendingBatchCommand?.targets.length ?? 0} simülasyon sıfırlansın mı?`}
                description={pendingBatchCommand?.operation === LIFECYCLE_OPERATIONS.RESTART
                  ? 'Şu anki çalıştırmalar sona erer ve başarılı olan her hat için %0’dan YENİ bir simülasyon oluşturulur. Yeni simülasyonlar otomatik olarak izlenmez, takip edilmez ve yönetim seçiminde yer almaz. Hat tanımları silinmez.'
                  : 'Seçili simülasyonlar sona erdirilecek ve bu hatlar başlangıç durumuna dönecek; onları izleyen diğer kullanıcılar da aracı görmeyi bırakır. Yerlerine yeni bir simülasyon oluşturulmaz ve hat tanımları silinmez.'}
                confirmLabel={pendingBatchCommand?.operation === LIFECYCLE_OPERATIONS.RESTART
                  ? 'Yeniden Başlat'
                  : 'Sıfırla'}
                cancelLabel="Vazgeç"
                onConfirm={confirmBatchCommand}
                /* Vazgeçmek HİÇBİR ŞEY yapmaz: sunucuya istek gitmez. */
                onCancel={() => setPendingBatchCommand(null)}
              />

              <ConfirmDialog
                open={journeyStopPending}
                title="Yolculuğu durdur"
                message="Bu yolculuk simülasyonunu durdurmak istediğinize emin misiniz?"
                description="Durdurulan yolculuk yeniden başlatılamaz; sonuç panelde kalır ve dilediğinizde yeni bir yolculuk planlayabilirsiniz."
                confirmLabel="Yolculuğu Durdur"
                cancelLabel="Vazgeç"
                busy={journeyStopping}
                onConfirm={confirmJourneyStop}
                /* Vazgeçmek HİÇBİR ŞEY yapmaz: sunucuya istek gitmez. */
                onCancel={() => setJourneyStopPending(false)}
              />

              <ConfirmDialog
                open={Boolean(pendingPoiDelete)}
                title="POI'yi sil"
                message={
                  pendingPoiDelete
                    ? `“${pendingPoiDelete.name || 'POI'}” kaydını silmek istediğinize emin misiniz?`
                    : ''
                }
                description="POI haritadan kaldırılır ve Çöp Kutusu'na taşınır. Bu işlem geri alınabilir."
                confirmLabel="Sil"
                onConfirm={confirmPoiDelete}
                onCancel={() => setPendingPoiDelete(null)}
              />

              <ConfirmDialog
                open={Boolean(pendingTransportStopDelete)}
                title="Durağı sil"
                message={pendingTransportStopDelete ? `“${pendingTransportStopDelete.name || 'Durak'}” durağını silmek istediğinize emin misiniz?` : ''}
                description="Durak haritadan ve Duraklarım listesinden kaldırılır, sıra sunucuda yeniden düzenlenir ve kayıt Çöp Kutusu'na taşınır."
                confirmLabel="Sil"
                onConfirm={confirmTransportStopDelete}
                onCancel={() => setPendingTransportStopDelete(null)}
              />

              {/* Restore confirmation. Same dialog component as the delete one,
                  in the primary tone: the record is coming back, and the row
                  it comes back into is the very one that was deleted.

                  Metin KAYDIN TÜRÜNE göre kurulur. Çöp Kutusu artık çizimleri
                  ve POI'leri birlikte taşır; sabit "çizim" metni bir POI
                  satırında adı da kaybederdi (POI gövdesi `poi` alanında
                  gelir, `drawing` değil) ve diyalog "Çizim" diye sorardı —
                  yanlış satıra basıldığını yakalamak için var olan tek
                  ayrıntı tam da odur. */}
              <ConfirmDialog
                open={Boolean(pendingRestore)}
                tone="primary"
                title={pendingRestore?.type === 'poi' ? "POI'yi geri yükle" : 'Çizimi geri yükle'}
                message={
                  !pendingRestore
                    ? ''
                    : // Naming the record makes the dialog specific enough to
                      // catch a mis-tap on the neighbouring row.
                      `“${restoreTargetName(pendingRestore)}” kaydını geri yüklemek istiyor musunuz?`
                }
                description={
                  pendingRestore?.type === 'poi'
                    ? "POI aynı kayıt olarak haritaya geri döner, Çöp Kutusu'ndan kalkar."
                    : "Çizim aynı kayıt olarak haritaya ve Çizimlerim listesine geri döner, Çöp Kutusu'ndan kalkar."
                }
                confirmLabel="Geri Yükle"
                onConfirm={confirmRestore}
                onCancel={() => setPendingRestore(null)}
              />

              {/* Kaydedilmiş yolculuk SİLME onayı. Aynı diyalog bileşeni,
                  aynı Esc davranışı, aynı erişilebilirlik — tarayıcının
                  `confirm()`'i DEĞİL. Hedef kimlik onay anında DONDURULMUŞTUR:
                  A için açılan onay, arada B'ye dokunulsa bile A'yı siler. */}
              <ConfirmDialog
                open={Boolean(journeyDeletePending)}
                title="Kaydedilen yolculuğu sil"
                message={
                  journeyDeletePending
                    ? `“${journeyDeletePending.name}” yolculuğunu silmek istediğinize emin misiniz?`
                    : ''
                }
                description="Kayıt kalıcı olarak silinir ve geri alınamaz. Çalışan bir yolculuğunuz varsa durmaz."
                confirmLabel="Sil"
                busy={journeyDeleting}
                onConfirm={confirmSavedJourneyDelete}
                onCancel={() => setJourneyDeletePending(null)}
              />

              {/* Planlanan yolculuğu KAYDETME diyaloğu. Ad ister; simülasyon
                  başlatmaz. */}
              <JourneyNameDialog
                open={journeySavePending}
                title="Yolculuğu kaydet"
                description="Bu yolculuk yalnızca size özeldir ve daha sonra yeniden kullanabilirsiniz."
                confirmLabel="Kaydet"
                busy={savedJourneys.saving}
                error={savedJourneys.error}
                onConfirm={confirmJourneySave}
                onCancel={() => setJourneySavePending(false)}
              />

              {/* YENİDEN ADLANDIRMA. Kimlik diyalog açıldığında dondurulur;
                  eylem çözüldüğünde listedeki seçim okunmaz. */}
              <JourneyNameDialog
                open={Boolean(journeyRenamePending)}
                title="Yolculuğu yeniden adlandır"
                description="Yalnızca ad değişir; yolculuğun kendisi olduğu gibi kalır."
                confirmLabel="Kaydet"
                initialName={journeyRenamePending?.name ?? ''}
                busy={savedJourneys.busyId === journeyRenamePending?.id}
                error={savedJourneys.error}
                onConfirm={confirmSavedJourneyRename}
                onCancel={() => setJourneyRenamePending(null)}
              />

              {/* Unsaved edits. The same dialog component as the delete
                  confirmation, so both destructive moments look and behave
                  alike — and neither is a browser `confirm()`. Cancelling is
                  the safe answer, so it is the one that returns to editing. */}
              <ConfirmDialog
                open={Boolean(pendingDiscard)}
                title="Kaydedilmemiş değişiklikler"
                message="Kaydedilmemiş değişiklikleriniz var."
                description="Şimdi çıkarsanız bu düzenlemeler kaybolur. Çizim veritabanında olduğu gibi kalır."
                confirmLabel="Değişiklikleri At"
                cancelLabel="Düzenlemeye Dön"
                onConfirm={confirmDiscard}
                onCancel={() => setPendingDiscard(null)}
              />
            </>
          )}

          <MapLoadingOverlay visible={!mapReady && isIdle} />
        </div>
      </div>
    </div>
  )
}
