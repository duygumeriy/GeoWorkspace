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
import TransportTrackingControls from '../components/map/TransportTrackingControls.jsx'
import {
  DrawingHint,
  HoverTooltip,
  MeasurementReadout,
  SavingIndicator,
} from '../components/map/MapOverlays.jsx'
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
import PoiSearchBar from '../components/map/PoiSearchBar.jsx'
import usePoiPlacement from '../hooks/usePoiPlacement.js'
import usePoiInteraction from '../hooks/usePoiInteraction.js'
import usePoiEditDraft from '../hooks/usePoiEditDraft.js'
import useTransportLayer from '../hooks/useTransportLayer.js'
import useTransportSimulation from '../hooks/useTransportSimulation.js'
import useTransportVehicleLayer from '../hooks/useTransportVehicleLayer.js'
import { transportSimulationControls } from '../map/transportSimulationState.js'
import { transportVehiclePopupModel, transportVehiclePresentation } from '../map/transportVehicle.js'
import useTransportStopPlacement from '../hooks/useTransportStopPlacement.js'
import useTransportStopInteraction from '../hooks/useTransportStopInteraction.js'
import useTransportStopRelocation from '../hooks/useTransportStopRelocation.js'
import { createTransportStop, deleteTransportStop, updateTransportStop } from '../services/transportApi.js'
import { deleteStopThenMaybeGenerate, persistStopThenMaybeGenerate } from '../services/transportStopWorkflow.js'
import { DRAWING_TYPES, DRAWING_TYPE_LIST, colorPatchFor, normalizeTags } from '../map/drawingTypes.js'
import { trashRecordOf } from '../map/trashFilters.js'
import {
  MAX_CRITERIA,
  MIN_CRITERIA,
  emptyCriterion,
  toRequestCriteria,
  validateAnalysis,
} from '../map/locationAnalysis.js'
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

  /**
   * "Katmanlar → POI'ler": kalıcı POI gösteriminin görünürlüğü.
   *
   * <b>Çizim görünürlüğüyle aynı kavram, AYRI durum.</b> Çizim türlerinin
   * görünürlüğü `useDrawingWorkspace`'e aittir ve POI oraya katılamaz — POI bir
   * çizim değildir. Bu, panelin ikinci sistem satırı olan "Yetki Alanım"la
   * (`scopeLayerVisible`) aynı kalıptır: kendi state'i, kendi prop'u, aynı
   * görsel dil.
   *
   * Varsayılan AÇIK: POI'ler haritanın normal içeriğidir ve gizli açılmaları
   * kullanıcıya kayıp veri gibi görünürdü.
   */
  const [poiLayerVisible, setPoiLayerVisible] = useState(true)

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
    /* Geometri oturumu: Modify ve Translate aynı oturumdan yürür, dolayısıyla
       ikisi de aynı askıya alma yaşam döngüsünü kullanır. */
    if (workspaceMode.isEditing && workspace.selectedFeature) {
      return [workspace.selectedFeature.type]
    }

    /* Stil paneli canlı ÖNİZLEME yapar (`previewStyle`) ve önizleme henüz
       kaydedilmemiştir; kayıtlı renkli görüntü altta durursa eski ve yeni renk
       üst üste biner. Araç stili ('tool') hiçbir kaydı önizlemez. */
    if (styleTarget === 'feature' || styleTarget === 'bulk') {
      return [...new Set(workspace.selectedFeatures.map((item) => item.type))]
    }

    return []
  }, [workspaceMode.isEditing, workspace.selectedFeature, workspace.selectedFeatures, styleTarget])

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

  // Click-to-select runs in select mode only, and not while an area polygon is
  // being drawn — there a click is a vertex, not a selection.
  const clickSelectEnabled =
    allowed.canSelect && workspaceMode.isSelecting && workspaceMode.activeSelectionTool !== 'polygon'

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

  const normalPoiLayerVisible = poiLayerVisible && !locationAnalysisResultActive

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

  usePoiInteraction(mapInstance, { enabled: poiClickEnabled, onSelect: handlePoiSelected })

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
  const [transportStopsVisible, setTransportStopsVisible] = useState(true)
  const [hiddenTransportRouteIds, setHiddenTransportRouteIds] = useState(() => new Set())
  const transportStopSaveInFlight = useRef(false)

  const transport = useTransportLayer(mapInstance, {
    permitted: allowed.canViewTransport,
    selectedStopId: selectedTransportStop?.id ?? null,
    selectedRouteId: selectedTransportRouteId,
    routesVisible: transportRoutesVisible,
    stopsVisible: transportStopsVisible,
    hiddenRouteIds: hiddenTransportRouteIds,
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
  const [vehiclePopupSimulationId, setVehiclePopupSimulationId] = useState(null)

  const simulation = useTransportSimulation({
    routeId: selectedTransportRouteId,
    canView: allowed.canViewTransport,
  })

  const simulationControls = useMemo(() => transportSimulationControls({
    routeId: selectedTransportRouteId,
    simulation: simulation.simulation,
    followingRouteId: simulation.followingRouteId,
    // Başlatma AYRI bir yetkidir; yalnızca izleyen kullanıcı bu düğmeyi görmez.
    canStart: can(PERMISSIONS.TRANSPORT_SIMULATION_START),
    starting: simulation.starting,
    following: simulation.following,
  }), [
    selectedTransportRouteId,
    simulation.simulation,
    simulation.followingRouteId,
    simulation.starting,
    simulation.following,
    can,
  ])

  const transportVehicle = useMemo(() => transportVehiclePresentation({
    simulation: simulation.followedSimulation ?? simulation.observedSimulation ?? simulation.simulation,
    followingRouteId: simulation.followingRouteId,
    observedRouteId: simulation.observedRouteId,
    selectedRouteId: selectedTransportRouteId,
    startedSimulationId,
    routes: transport.activeRoutes,
  }), [
    simulation.followedSimulation,
    simulation.observedSimulation,
    simulation.simulation,
    simulation.followingRouteId,
    simulation.observedRouteId,
    selectedTransportRouteId,
    startedSimulationId,
    transport.activeRoutes,
  ])

  const openVehiclePopup = useCallback((vehicle) => {
    setVehiclePopupSimulationId(vehicle?.simulationId ?? null)
  }, [])

  useTransportVehicleLayer(mapInstance, {
    presentation: transportVehicle,
    onVehicleClick: openVehiclePopup,
  })

  const vehiclePopup = transportVehicle && vehiclePopupSimulationId === transportVehicle.simulationId
    ? transportVehiclePopupModel(transportVehicle)
    : null

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
     kullanır: ikinci bir "seçili rota" kavramı doğmaz ve takip kartı bu sayede
     olduğu gibi açılır. Kamera oynatılmaz — kullanıcı zaten baktığı yere
     tıklamıştır. */
  const handleTransportRouteSelected = useCallback((routeId) => {
    const next = Number(routeId)
    if (!Number.isFinite(next)) return
    setSelectedTransportRouteId(next)
    setSelectedTransportStop(null)
    mapContext.close(MAP_CONTEXTS.transportStopInfo)
  }, [mapContext])

  /* Gizlenen güzergah tıklanamaz: kullanıcı onu bilerek kapatmıştır. */
  const isTransportRouteSelectable = useCallback(
    (routeId) => transportRoutesVisible && !hiddenTransportRouteIds.has(Number(routeId)),
    [transportRoutesVisible, hiddenTransportRouteIds],
  )

  useTransportStopInteraction(mapInstance, {
    enabled: allowed.canViewTransport && workspaceMode.isSelecting,
    hoverEnabled: hasFinePointer,
    onSelect: handleTransportStopSelected,
    onSelectRoute: handleTransportRouteSelected,
    isRouteVisible: isTransportRouteSelectable,
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
    setSelectedTransportRouteId(null)
    setSelectedTransportStop({ ...stop, colorHex: stop.colorHex || stop.routeColor })
    mapContext.activate(MAP_CONTEXTS.transportStopInfo)
  }, [mapView, mapContext])

  const showTransportRoute = useCallback((routeId) => {
    const routeStops = transport.stops
      .filter((stop) => stop.routeId === Number(routeId))
      .sort((left, right) => left.sequenceOrder - right.sequenceOrder || left.id - right.id)

    setSelectedTransportRouteId(Number(routeId))
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
  }, [transport.stops, selectedTransportStop, mapView, showToast])

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
      if (!poiLayerVisible) return

      const record = findPoiOnLayer(result.id)
      if (!record) return

      setSelectedPoi(record)
      mapContext.activate(MAP_CONTEXTS.poiInfo)
    },
    [workspace, mapView, mapContext, findPoiOnLayer, poiLayerVisible, focusMyStop, showTransportRoute],
  )

  /**
   * "Katmanlar → POI'ler" anahtarı.
   *
   * <b>Kapatmak SEÇİMİ de emekliye ayırır.</b> Görünmeyen bir kaydı anlatan
   * açık bir bilgi paneli bırakmak, kullanıcıya haritada olmayan bir şeyi
   * gösterirdi. Aynı kural çizim tarafında da geçerlidir: bir tür gizlendiğinde
   * o türdeki seçimler ayıklanır (`useDrawingWorkspace.toggleVisibility`), yani
   * burada yapılan o kuralın POI karşılığıdır — yeni bir davranış değil.
   *
   * <b>Veritabanına HİÇBİR şey yazılmaz.</b> Bu bir sunum durumudur: silme,
   * pasifleştirme ya da güncelleme çağrısı yoktur.
   */
  const togglePoiLayer = useCallback(() => {
    setPoiLayerVisible((current) => {
      const next = !current

      if (!next) {
        mapContext.close(MAP_CONTEXTS.poiInfo)
        setSelectedPoi(null)
      }

      return next
    })
  }, [mapContext])

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

  const layerCounts = workspace.drawingGroups.reduce(
    (acc, group) => ({ ...acc, [group.type.id]: group.items.length }),
    {},
  )


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
                visibility={workspace.visibility}
                counts={layerCounts}
                onToggle={workspace.toggleVisibility}
                /* POI satırı YETKİDEN türer: `poi.view` yoksa satır hiç
                   çizilmez, raster istenmez ve vektör katmanı zaten kurulmaz.
                   Rol adına bakan hiçbir kural yoktur. */
                poi={{
                  permitted: allowed.canViewPoi,
                  visible: poiLayerVisible,
                  count: poi.count,
                }}
                onTogglePoi={togglePoiLayer}
                transport={{
                  permitted: allowed.canViewTransport,
                  routesVisible: transportRoutesVisible,
                  stopsVisible: transportStopsVisible,
                  routeCount: transport.routes.length,
                  stopCount: transport.stops.length,
                  routes: transport.routes.map((route) => ({
                    id: route.id,
                    name: route.name,
                    colorHex: route.colorHex,
                    visible: !hiddenTransportRouteIds.has(route.id),
                    isStale: transport.paths.find((path) => path.routeId === route.id)?.isStale === true,
                  })),
                }}
                onToggleTransportRoutes={() => setTransportRoutesVisible((value) => !value)}
                onToggleTransportRoute={toggleTransportRoute}
                onToggleTransportStops={() => setTransportStopsVisible((value) => !value)}
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
                onClose={() => setVehiclePopupSimulationId(null)}
              />

              {allowed.canViewTransport && selectedTransportRouteId != null && (
                <TransportTrackingControls
                  className="transport-tracking-card"
                  primaryButtonClassName="transport-popup-action"
                  secondaryButtonClassName="transport-popup-action"
                  controls={simulationControls}
                  statusLoading={simulation.statusLoading}
                  starting={simulation.starting}
                  error={simulation.error}
                  onStart={async () => {
                    const snapshot = await simulation.start(selectedTransportRouteId)
                    if (snapshot) setStartedSimulationId(snapshot.simulationId)
                  }}
                  onFollow={() => simulation.follow(selectedTransportRouteId)}
                  onUnfollow={() => simulation.unfollow()}
                />
              )}

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
