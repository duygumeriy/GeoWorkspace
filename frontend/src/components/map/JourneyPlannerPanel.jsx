import { useMemo } from 'react'
import {
  ArrowDownUp,
  ArrowLeft,
  Crosshair,
  RotateCcw,
  Play,
  Square,
  ChevronDown,
  ChevronUp,
  Loader2,
  MapPin,
  Minus,
  Plus,
  Route as RouteIcon,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import './JourneyPlanner.css'
import { journeyProfileIcon } from './journeyProfileIcons.js'
import {
  JOURNEY_MODES,
  JOURNEY_PROFILES,
  PANEL_STATES,
  PERSONAL_SECTIONS,
  WAYPOINT_SOURCES,
  resolvePersonalSection,
  waypointRoleAt,
} from '../../map/journeyPlanning.js'
import { journeyPreviewSummary, journeyProfileLabel as journeyProfileLabelOf } from '../../map/journeyPresentation.js'
import { journeyStepList } from '../../map/journeyManeuvers.js'
import { JOURNEY_STEP_STATES, journeyNavigationModel } from '../../map/journeyNavigation.js'
import {
  JOURNEY_PHASES,
  journeyLiveModel,
  journeyPhase,
  journeyTerminalTitle,
} from '../../map/journeySimulationState.js'
import { journeyPanelStyle } from '../../map/journeyLayout.js'
import { JOURNEY_PRODUCTS, journeyProductLabel } from '../../map/journeyWorkspace.js'
import SharedTransportJourneyContent from './SharedTransportJourneyContent.jsx'
import SavedJourneysSection from './SavedJourneysSection.jsx'
import JourneyHistorySection from './JourneyHistorySection.jsx'
import { formatRouteDistance, formatRouteDuration } from '../../map/transportPathPresentation.js'

/* Profil ikonları TEK sözlükten gelir (`journeyProfileIcons`): haritadaki canlı
   işaretçi de aynı üç sembolü kullanır. İkinci bir tablo, panelle harita
   arasında zamanla ayrışan iki görünüm demekti. */

/* Hat ve Hat Bölümü kipleri ulaşım ağı REFERANSI kullanır; Serbest kip
   kullanmayabilir. `transport` bayrağı bu ayrımı taşır ve kipin hangi
   yetkiyi gerektirdiğini tek yerde saklar. */
const MODE_TABS = [
  { id: JOURNEY_MODES.ROUTE_FULL, label: 'Hat', transport: true },
  { id: JOURNEY_MODES.ROUTE_SEGMENT, label: 'Hat Bölümü', transport: true },
  { id: JOURNEY_MODES.WAYPOINTS, label: 'Serbest', transport: false },
]

const ROLE_LABELS = { origin: 'Başlangıç', via: 'Ara nokta', destination: 'Varış' }

/* Kişisel ürünün İKİ bölümü. Planlama KİPLERİYLE (Hat / Hat Bölümü / Serbest)
   karıştırılmamalıdır: orası "yolculuğum nasıl kurulur", burası "planlıyor
   muyum yoksa kayıtlarıma mı bakıyorum". */
const SECTION_TABS = [
  { id: PERSONAL_SECTIONS.PLAN, label: 'Planla' },
  { id: PERSONAL_SECTIONS.SAVED, label: 'Kaydedilenler' },
  { id: PERSONAL_SECTIONS.HISTORY, label: 'Geçmiş' },
]

/**
 * Seçilebilen nokta türlerinin ADI.
 *
 * Metin YETKİYE göre kurulur: durak seçemeyen birine "bir durak ya da yer
 * seçin" demek, seçemeyeceği bir şeye davet etmektir. İki yetki de yoksa metin
 * hiçbir tür vaat etmez.
 */
function pickableLabelOf({ canUseStops, canUsePois }) {
  if (canUseStops && canUsePois) return 'durak ya da yer'
  if (canUseStops) return 'durak'
  if (canUsePois) return 'yer'
  return 'nokta'
}

/* Ürün adı başlıkta okunur: kullanıcı hangi ÜRÜNE baktığını, hangi kipte
   olduğundan önce bilmelidir. */
function workspaceTitle(activeProduct) {
  return activeProduct === JOURNEY_PRODUCTS.SHARED
    ? journeyProductLabel(JOURNEY_PRODUCTS.SHARED)
    : 'Yolculuk'
}

function formatStepMetric(step) {
  if (!Number.isFinite(step.distanceMeters)) return ''
  return step.distanceMeters < 1000
    ? `${Math.round(step.distanceMeters)} m`
    : `${(step.distanceMeters / 1000).toFixed(1)} km`
}

/**
 * Sol taraftaki yolculuk planlayıcısı.
 *
 * <b>İş kuralı burada YOKTUR.</b> Doğrulama, istek eşlemesi, manevra metni ve
 * biçimlendirme saf modüllerdedir; bileşen yalnızca onları çizer ve kullanıcı
 * niyetini yukarı bildirir. Bu, kuralların DOM'suz sınanabilmesini sağlar.
 *
 * <b>Üç panel durumu ayrıdır.</b> KATLANMIŞ, KAPALI değildir: katlanmış panel
 * ekranda kalır ve özeti gösterir, kapalı panel çalışma alanından çıkar ve
 * yerine küçük bir yeniden açma düğmesi bırakılır.
 */
export default function JourneyPlannerPanel({
  state,
  routes = [],
  stops = [],
  preview = null,
  loading = false,
  /** GERÇEK bir başarısızlık: önizleme/istek hatası. Uyarı olarak sunulur. */
  error = '',
  /** Eksik seçimin NEDENİ: nötr yardım metni, uyarı DEĞİL. */
  guidance = '',
  canRequest = false,
  picking = false,
  canUsePois = false,
  /* Ulaşım rotası/durağı seçimi AYRI bir yetkidir (`transport.view`) ve ürün
     kapısı (`journey.use`) onu İMA ETMEZ. Burada yalnızca GÖRÜNÜRLÜK kararı
     verilir: yetkisi olmayana, backend'in kesin olarak 403 döndüreceği hat
     seçimleri sunulmaz. Bağlayıcı denetim sunucudadır ve burada TEKRARLANMAZ. */
  canUseTransport = false,
  /* ÜST DÜZEY ürün eksenini besleyen üç değer. Panel bunları HESAPLAMAZ:
     hangi ürünlerin sunulacağına saf `journeyWorkspace` modülü karar verir ve
     MapPage o kararı buraya geçirir. */
  product = JOURNEY_PRODUCTS.PERSONAL,
  productTabs = [],
  onProductChange,
  /* Paylaşılan hattın SUNUM modeli; `sharedJourneyPresentation` üretir.
     Panel onu yalnızca çizer ve içinde ikinci bir durum makinesi kurmaz. */
  shared = null,
  onStartShared,
  onPauseShared,
  onResumeShared,
  onStopShared,
  onFollowShared,
  onUnfollowShared,
  /* AKTİF SİMÜLASYONLAR (Faz 4A). Sunum modelini saf `activeSimulations`
     modülü üretir; panel yalnızca aktarır ve içinde ikinci bir durum makinesi
     kurmaz. Liste bir YÖNETİM yüzeyi değildir — satırlarda yaşam döngüsü
     düğmesi yoktur. */
  activeSimulations = null,
  onActiveSearchChange,
  onSelectActiveRoute,
  onToggleWatch,
  onWatchAll,
  onClearWatch,
  onRetryActive,
  /* YÖNETİM (Faz 4B). Panel hiçbirini YORUMLAMAZ; yalnızca aktarır. */
  onToggleManaged,
  onSelectAllActive,
  onClearSelection,
  onRunBatchAction,
  /* NAVİGASYON (Faz 5). Panel hiçbir talimat yorumlamaz; yalnızca aktarır. */
  sharedNavigation = null,
  poiSearch = null,
  onModeChange,
  onProfileChange,
  onRouteChange,
  onSegmentStopChange,
  onSwapSegmentStops,
  onAddWaypoint,
  onRemoveWaypoint,
  onMoveWaypoint,
  onAssignWaypoint,
  onArmSlot,
  onRequestPreview,
  onClear,
  /* KAYDEDİLENLER (Faz 7). Panel hiçbirini YORUMLAMAZ; sunum modelini saf
     `savedJourneys` modülü üretir ve her eylem KAYIT KİMLİĞİ taşır — panelde
     "seçili kayıt" diye bir durum yoktur, dolayısıyla bayat bir seçim yanlış
     kaydı silemez. */
  saved = null,
  onSectionChange,
  onSaveJourney,
  onUseSavedJourney,
  onLoadSavedJourney,
  onRenameSavedJourney,
  onDeleteSavedJourney,
  onToggleSavedFavorite,
  onRetrySavedJourneys,
  /* GEÇMİŞ (Faz 8). Panel hiçbirini YORUMLAMAZ; sunum modelini saf
     `journeyHistory` modülü üretir ve her eylem KAYIT KİMLİĞİ taşır. Tutanak
     DEĞİŞTİRİLEMEZ: burada ad, favori ya da silme eylemi yoktur. */
  history = null,
  onHistoryFilterChange,
  onOpenHistoryDetail,
  onCloseHistoryDetail,
  onReuseHistory,
  onLoadHistoryIntoPlanner,
  onLoadMoreHistory,
  onRetryHistory,
  /* Kaydetme YALNIZCA geçerli bir kanonik tanım varken sunulur; eksik bir
     seçim kaydedilemez. */
  canSaveJourney = false,
  onCollapse,
  onClose,
  onOpen,
  live = null,
  onStartSimulation,
  onStopSimulation,
  onToggleFollow,
  onReturnToPlanning,
  onNewJourney,
}) {
  const summary = useMemo(() => journeyPreviewSummary(preview), [preview])

  /* CANLI mod, önizleme modunun YERİNE geçer: bir simülasyon çalışırken
     panelde gösterilen güzergah sunucunun otoriter yanıtıdır, eski önizleme
     değil. */
  const liveModel = useMemo(
    () => journeyLiveModel({ simulation: live?.simulation, snapshot: live?.snapshot }),
    [live?.simulation, live?.snapshot],
  )

  /* ÜÇ evre, İKİ ayrı soru. "Benimsenmiş bir çalıştırma var mı" ile "hâlâ
     hareket ediyor mu" aynı şey değildir: biten yolculuğun SONUCU durur, ama
     ilerleme, durdurma ve takip anlamını yitirir. */
  const phase = journeyPhase({ simulation: live?.simulation, snapshot: live?.snapshot })

  /* Sunum modeli YOKSA çizilecek bir sonuç da yoktur: anlık görüntü henüz
     gelmemiş bir çalıştırmada panel planlama formunda kalır — Faz 5D'deki
     davranışın aynısı. Evrenin kendisi (kanca düzeyinde) yine ACTIVE'dir;
     burada sorulan soru "ne çizilecek". */
  const isActive = liveModel != null && phase === JOURNEY_PHASES.ACTIVE
  const isTerminal = liveModel != null && phase === JOURNEY_PHASES.TERMINAL
  const isLive = isActive || isTerminal

  /* CANLI yönlendirme: adımlar sunucunun benimsenmiş ayrıntılarından, "şu anki
     adım" ise yine sunucunun `currentStepSequence`'ından gelir. Balon da AYNI
     modeli okur (`journeyNavigationModel`), böylece iki yüzey farklı talimat
     gösteremez. */
  const navigation = useMemo(
    () => journeyNavigationModel({
      steps: live?.simulation?.steps,
      currentStepSequence: liveModel?.currentStepSequence,
    }),
    [live?.simulation?.steps, liveModel?.currentStepSequence],
  )

  /* Önizlemede güncel adım KAVRAMI yoktur: henüz yola çıkılmamıştır. */
  const previewSteps = useMemo(() => journeyStepList(preview?.steps), [preview?.steps])
  const pickableLabel = pickableLabelOf({ canUseStops: canUseTransport, canUsePois })

  const routeStops = useMemo(
    () => stops.filter((stop) => stop.routeId === state.routeId)
      .slice()
      .sort((left, right) => left.sequenceOrder - right.sequenceOrder || left.id - right.id),
    [stops, state.routeId],
  )

  /* KAPALI: panel çalışma alanından tamamen çıkar ve YERİNE HİÇBİR ŞEY
     BIRAKMAZ. Yeniden açma kısayolu artık haritanın kendi denetim yığınındadır
     (`QuickActions`), çünkü buradaki küçük düğme tam olarak analiz panelinin
     durduğu köşeye oturuyor ve onu örtüyordu. Çalıştırma durumu bu karardan
     HİÇ etkilenmez: kapatmak bir sunum kararıdır. */
  if (state.panel === PANEL_STATES.CLOSED) return null

  const collapsed = state.panel === PANEL_STATES.COLLAPSED
  const ActiveProfileIcon = journeyProfileIcon(state.profile)

  /* ÜRÜN, kişisel planlama KİPİNDEN bağımsız bir eksendir: paylaşılan hat
     gösterilirken kişisel evreler (canlı/terminal/planlama) hiç çizilmez ama
     ÇALIŞMAYA DEVAM EDER — panel yalnızca neyi gösterdiğini değiştirir. */
  const showingShared = product === JOURNEY_PRODUCTS.SHARED
  const showingPersonal = !showingShared

  /* Bölüm YALNIZCA kişisel üründe anlamlıdır ve paylaşılan hattın sekmesine
     hiç dokunmaz. Kural SAF modüldedir ve burada yalnızca uygulanır: panel
     bölümleri tek tek sayarsa, eklenen her yeni bölüm sessizce planlamaya
     düşer — Geçmiş sekmesi tam olarak böyle çalışmıyordu. */
  const section = resolvePersonalSection(state.section)
  const showingSaved = section === PERSONAL_SECTIONS.SAVED
  const showingHistory = section === PERSONAL_SECTIONS.HISTORY
  const showingPlanner = !showingSaved && !showingHistory

  /* MEVCUT bayraklar okunur; ikinci bir "meşgul" durumu ya da sahte bir
     ilerleme sayacı üretilmez. */
  const busy = Boolean(loading || live?.starting)

  return (
    <section
      className={`journey-panel ${collapsed ? 'is-collapsed' : ''}`.trim()}
      /* Ölçüler JS'te TANIMLI, CSS'te tüketilir: 340/240 gibi bir sayı iki
         dosyada birden yaşamaz. */
      style={journeyPanelStyle()}
      aria-label="Yolculuk çalışma alanı"
      aria-busy={busy}
    >
      <header className="journey-head">
        <div className="journey-head-title">
          {showingShared
            ? <RouteIcon size={16} aria-hidden="true" />
            : <ActiveProfileIcon size={16} aria-hidden="true" />}
          <span>{workspaceTitle(product)}</span>
        </div>
        <div className="journey-head-actions">
          <button
            type="button"
            className="journey-icon-button"
            onClick={collapsed ? onOpen : onCollapse}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Paneli genişlet' : 'Paneli küçült'}
          >
            {collapsed ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="journey-icon-button"
            onClick={onClose}
            aria-label="Paneli kapat"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* ÜST DÜZEY ürün seçimi. Sekmeler YALNIZCA birden fazla ürüne erişimi
          olan kullanıcıya çıkar (`journeyProductTabs`): tek seçeneği olan bir
          sekme çubuğu hiçbir şey anlatmaz ve paneli gereksizce daraltırdı.

          Bu, kişisel planlama kipleriyle (Hat / Hat Bölümü / Serbest)
          KARIŞTIRILMAMALIDIR: orası kişisel yolculuğun nasıl kurulacağı,
          burası hangi ÜRÜNE bakıldığıdır. Geçiş yapmak hiçbir ürünü
          durdurmaz. */}
      {!collapsed && productTabs.length > 1 && (
        <div className="journey-products" role="group" aria-label="Yolculuk ürünü">
          {productTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={product === tab.id}
              className={`journey-product-tab ${product === tab.id ? 'is-active' : ''}`.trim()}
              onClick={() => onProductChange?.(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* PAYLAŞILAN hat bölümü. Kendi servisini, kendi hub'ını ve kendi
          durumunu kullanır; kişisel yolculukla hiçbir durumu paylaşmaz. */}
      {!collapsed && showingShared && (
        <SharedTransportJourneyContent
          shared={shared}
          navigation={sharedNavigation}
          onStart={onStartShared}
          onPause={onPauseShared}
          onResume={onResumeShared}
          onStop={onStopShared}
          onFollow={onFollowShared}
          onUnfollow={onUnfollowShared}
          active={activeSimulations}
          onActiveSearchChange={onActiveSearchChange}
          onSelectActiveRoute={onSelectActiveRoute}
          onToggleWatch={onToggleWatch}
          onWatchAll={onWatchAll}
          onClearWatch={onClearWatch}
          onRetryActive={onRetryActive}
          onToggleManaged={onToggleManaged}
          onSelectAllActive={onSelectAllActive}
          onClearSelection={onClearSelection}
          onRunBatchAction={onRunBatchAction}
        />
      )}

      {/* TEK hata bölgesi, ÜÇ evre için. Canlı hata yalnızca planlayıcı
          dalında yaşasaydı, çalışan ya da bitmiş bir yolculukta hiç
          görünmezdi. Aynı bloğu üç kez yazmak yerine sahibi burasıdır.

          Hata KENDİ BAŞINA hiçbir şey durdurmaz ya da bırakmaz: sunucudaki
          çalıştırma sürer, bırakma kullanıcının açık kararıdır. */}
      {!collapsed && showingPersonal && (error || live?.error) && (
        <div className="journey-feedback">
          {error && <p className="journey-error" role="alert">{error}</p>}
          {live?.error && <p className="journey-error" role="alert">{live.error}</p>}
        </div>
      )}

      {/* KATLANMIŞ: panel kaybolmaz, yeniden açmaya yetecek kadarını gösterir. */}
      {collapsed && (
        <button type="button" className="journey-collapsed-summary" onClick={onOpen}>
          {showingShared ? (
            /* Katlanmış PAYLAŞILAN görünüm kendi özetini verir: kişisel
               yolculuk özetini burada göstermek, kullanıcıya baktığı ürünün
               değil öbürünün durumunu okuturdu. */
            shared ? (
              <>
                <strong>{shared.routeName || `Hat #${shared.routeId}`}</strong>
                <span>{shared.isActive ? `${shared.statusLabel} · ${shared.progressLabel}` : 'Aktif simülasyon yok'}</span>
              </>
            ) : (
              <span>Hat simülasyonu için bir hat seçin</span>
            )
          ) : isTerminal ? (
            /* Katlanmış terminal: sonuç GİZLENİR ama kaybolmaz — panel
               açıldığında hâlâ oradadır, yalnızca kullanıcı bırakınca gider. */
            <>
              <strong>{journeyTerminalTitle(liveModel.status)}</strong>
              <span>
                {formatRouteDistance(liveModel.totalDistanceMeters)} ·{' '}
                {formatRouteDuration(liveModel.totalDurationSeconds)}
              </span>
            </>
          ) : isActive ? (
            <>
              <strong>%{Math.round(liveModel.progressPercent)} tamamlandı</strong>
              <span>
                {formatRouteDistance(liveModel.remainingDistanceMeters)} kaldı ·{' '}
                {formatRouteDuration(liveModel.totalDurationSeconds)}
              </span>
            </>
          ) : summary ? (
            <>
              <strong>{summary.destinationName}</strong>
              <span>{summary.duration} · {summary.distance}</span>
            </>
          ) : (
            <span>Yolculuk planlamak için dokunun</span>
          )}
        </button>
      )}

      {!collapsed && showingPersonal && isLive && (
        <div className="journey-body">
          {isActive && (
            <>
              <div className="journey-live-metrics">
                <strong>%{Math.round(liveModel.progressPercent)}</strong>
                <span>{formatRouteDistance(liveModel.remainingDistanceMeters)} kaldı</span>
              </div>

              {/* İlerleme SUNUCUNUN değeridir (kırpılmış canlı modelden);
                  ikinci bir yüzde hesaplanmaz. */}
              <div
                className="journey-live-bar"
                role="progressbar"
                aria-label="Yolculuk ilerlemesi"
                aria-valuenow={Math.round(liveModel.progressPercent)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuetext={`%${Math.round(liveModel.progressPercent)} tamamlandı`}
              >
                <span style={{ width: `${liveModel.progressPercent}%` }} />
              </div>
            </>
          )}

          {/* TERMİNAL: hareket bitti, SONUÇ durur. İlerleme çubuğu ve kalan
              mesafe yerine sunucunun son ölçümleri gösterilir; hiçbir değer
              tarayıcıda yeniden hesaplanmaz. */}
          {isTerminal && (
            <div className="journey-terminal">
              <strong>{journeyTerminalTitle(liveModel.status)}</strong>
              <span>%{Math.round(liveModel.progressPercent)} tamamlandı</span>
            </div>
          )}

          <p className="journey-summary-meta">
            {journeyProfileLabelOf(liveModel.profileId)}
            {' · '}
            {formatRouteDistance(liveModel.totalDistanceMeters)}
            {' · '}
            {formatRouteDuration(liveModel.totalDurationSeconds)}
          </p>

          {/* Takip ve durdurma YALNIZCA hareket varken sunulur: biten bir
              yolculuğu takip etmek ya da durdurmak diye bir şey yoktur. */}
          {isActive && (
            <div className="journey-actions">
              {/* Gerçekten bir AÇMA/KAPAMA düğmesidir; durumu bildirilir.
                  Kamera davranışının kendisi bu dilimde değişmez. */}
              <button
                type="button"
                className="journey-secondary"
                onClick={onToggleFollow}
                aria-pressed={Boolean(live?.following)}
              >
                <Crosshair size={14} aria-hidden="true" />
                {live?.following ? 'Takibi Bırak' : 'Takip Et'}
              </button>
              <button type="button" className="journey-danger" onClick={onStopSimulation}>
                <Square size={14} aria-hidden="true" />
                Simülasyonu Durdur
              </button>
            </div>
          )}

          {/* Terminal çıkışı: sonucu bırakmak KULLANICININ kararıdır ve onay
              sorulmaz — ortada kaybolacak bir iş yoktur. */}
          {isTerminal && (
            <div className="journey-actions">
              <button type="button" className="journey-primary" onClick={onNewJourney}>
                <RotateCcw size={14} aria-hidden="true" />
                Yeni Yolculuk
              </button>
              <button type="button" className="journey-secondary" onClick={onReturnToPlanning}>
                <ArrowLeft size={14} aria-hidden="true" />
                Planlamaya Dön
              </button>
            </div>
          )}

          {/* Manevra YOKSA hata gibi sunulmaz: kalıcı güzergahı yeniden
              kullanan tam-hat yolculuğunda adım verisi bulunmaz. */}
          {!navigation.hasSteps && (
            <p className="journey-note">Bu güzergâh için adım adım yönlendirme bulunmuyor.</p>
          )}

          {navigation.hasSteps && (
            <>
              <h3 className="journey-steps-title">Yol Tarifi</h3>
              <ol className="journey-steps">
                {navigation.steps.map((step) => {
                  const isCurrent = step.state === JOURNEY_STEP_STATES.CURRENT
                  return (
                    <li
                      key={step.key}
                      className={`journey-step dir-${step.direction} is-${step.state}`}
                      /* Güncel adım programatik olarak da ayırt edilir; sahte
                         sekme/radyo semantiği kurulmaz. */
                      aria-current={isCurrent ? 'step' : undefined}
                    >
                      <div className="journey-step-text">
                        <strong>{step.instruction}</strong>
                        {step.name && <span>{step.name}</span>}
                      </div>
                      <span className="journey-step-metric">{formatStepMetric(step)}</span>
                    </li>
                  )
                })}
              </ol>
            </>
          )}
        </div>
      )}

      {!collapsed && showingPersonal && !isLive && (
        <div className="journey-body">
          {/* Kişisel ürünün İKİ bölümü. Bölüm değiştirmek hiçbir taslağı
              silmez, hiçbir çalıştırmaya dokunmaz ve hiçbir kanal açmaz.
              Aynı gerekçeyle `role="tab"` KULLANILMAZ: yarım bir sekme kalıbı
              (tabpanel ilişkisi ve ok tuşlarıyla dolaşan odak olmadan) hiç
              sekme olmamasından daha yanıltıcıdır. */}
          <div className="journey-tabs" role="group" aria-label="Kişisel yolculuk bölümü">
            {SECTION_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={section === tab.id}
                className={`journey-tab ${section === tab.id ? 'is-active' : ''}`.trim()}
                onClick={() => onSectionChange?.(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* KAYDEDİLENLER: sıradan kalıcı kayıtlar. Burada canlı durum,
              SignalR ya da zamanlayıcı YOKTUR. */}
          {showingSaved && (
            <SavedJourneysSection
              items={saved?.items ?? []}
              loading={Boolean(saved?.loading)}
              loaded={Boolean(saved?.loaded)}
              error={saved?.error ?? ''}
              busyId={saved?.busyId ?? null}
              onUse={onUseSavedJourney}
              onLoad={onLoadSavedJourney}
              onRename={onRenameSavedJourney}
              onDelete={onDeleteSavedJourney}
              onToggleFavorite={onToggleSavedFavorite}
              onRetry={onRetrySavedJourneys}
            />
          )}

          {/* GEÇMİŞ: sona ermiş çalıştırmaların değişmez tutanağı. Burada
              canlı durum, SignalR ya da zamanlayıcı YOKTUR ve hiçbir canlı
              POI/durak/hat kaydı okunmaz — adlar tutanağın kendi
              kopyalarındandır. */}
          {showingHistory && (
            <JourneyHistorySection
              items={history?.items ?? []}
              filterId={history?.filterId ?? 'all'}
              loading={Boolean(history?.loading)}
              loadingMore={Boolean(history?.loadingMore)}
              loaded={Boolean(history?.loaded)}
              hasMore={Boolean(history?.hasMore)}
              error={history?.error ?? ''}
              detail={history?.detail ?? null}
              detailId={history?.detailId ?? null}
              busyId={history?.busyId ?? null}
              onFilterChange={onHistoryFilterChange}
              onOpenDetail={onOpenHistoryDetail}
              onCloseDetail={onCloseHistoryDetail}
              onReuse={onReuseHistory}
              onLoadIntoPlanner={onLoadHistoryIntoPlanner}
              onLoadMore={onLoadMoreHistory}
              onRetry={onRetryHistory}
            />
          )}

          {showingPlanner && (
          <>
            {/* SEKME DEĞİL, kip düğmeleri. `role="tab"` bir tabpanel ilişkisi ve
                ok tuşlarıyla dolaşan bir odak (roving tabindex) sözü verir;
                ikisi de burada yoktur ve yarım bir sekme kalıbı, hiç sekme
                olmamasından daha yanıltıcıdır. Sıradan düğmeler klavyeyle
                zaten çalışır; söylenmesi gereken tek şey hangisinin AÇIK
                olduğudur. */}
            <div className="journey-tabs" role="group" aria-label="Planlama türü">
              {MODE_TABS.filter((tab) => canUseTransport || !tab.transport).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={state.mode === tab.id}
                  className={`journey-tab ${state.mode === tab.id ? 'is-active' : ''}`.trim()}
                  onClick={() => onModeChange?.(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tam olarak üç profil. Otobüs/toplu taşıma seçeneği YOKTUR. */}
            {/* Aynı gerekçe: `role="radio"` ok tuşlarıyla dolaşan bir grup
                sözü verir. Üç düğme birer AÇMA/KAPAMA kontrolüdür ve durumları
                `aria-pressed` ile bildirilir. */}
            <div className="journey-profiles" role="group" aria-label="Seyahat türü">
              {JOURNEY_PROFILES.map((profile) => {
                const Icon = journeyProfileIcon(profile.id)
                return (
                  <button
                    key={profile.id}
                    type="button"
                    aria-pressed={state.profile === profile.id}
                    className={`journey-profile ${state.profile === profile.id ? 'is-active' : ''}`.trim()}
                    onClick={() => onProfileChange?.(profile.id)}
                    title={profile.label}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{profile.label}</span>
                  </button>
                )
              })}
            </div>

            {canUseTransport && state.mode !== JOURNEY_MODES.WAYPOINTS && (
              <label className="journey-field">
                <span>Hat</span>
                <select
                  value={state.routeId ?? ''}
                  onChange={(event) => onRouteChange?.(event.target.value === '' ? null : Number(event.target.value))}
                >
                  <option value="">Hat seçin…</option>
                  {routes.map((route) => (
                    <option key={route.id} value={route.id}>{route.name}</option>
                  ))}
                </select>
              </label>
            )}

            {canUseTransport && state.mode === JOURNEY_MODES.ROUTE_SEGMENT && (
              <div className="journey-segment">
                <label className="journey-field">
                  <span>Başlangıç durağı</span>
                  <select
                    value={state.fromStopId ?? ''}
                    disabled={state.routeId == null}
                    onChange={(event) => onSegmentStopChange?.('from', event.target.value === '' ? null : Number(event.target.value))}
                  >
                    <option value="">Durak seçin…</option>
                    {routeStops.map((stop) => (
                      <option key={stop.id} value={stop.id}>{stop.name}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="journey-icon-button journey-swap"
                  onClick={onSwapSegmentStops}
                  aria-label="Yönü ters çevir"
                  title="Yönü ters çevir"
                >
                  <ArrowDownUp size={16} aria-hidden="true" />
                </button>
                <label className="journey-field">
                  <span>Varış durağı</span>
                  <select
                    value={state.toStopId ?? ''}
                    disabled={state.routeId == null}
                    onChange={(event) => onSegmentStopChange?.('to', event.target.value === '' ? null : Number(event.target.value))}
                  >
                    <option value="">Durak seçin…</option>
                    {routeStops.map((stop) => (
                      <option key={stop.id} value={stop.id}>{stop.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {state.mode === JOURNEY_MODES.WAYPOINTS && (
              <div className="journey-waypoints">
                {state.waypoints.map((slot, index) => {
                  const role = waypointRoleAt(index, state.waypoints.length)
                  const armed = state.activeSlotKey === slot.key
                  const isVia = role === 'via'
                  return (
                    <div key={slot.key} className={`journey-waypoint role-${role}`}>
                      <span className="journey-waypoint-role">{ROLE_LABELS[role]}</span>
                      <button
                        type="button"
                        className={`journey-waypoint-slot ${armed ? 'is-armed' : ''}`.trim()}
                        onClick={() => onArmSlot?.(slot.key)}
                        aria-pressed={armed}
                      >
                        <MapPin size={14} aria-hidden="true" />
                        <span>
                          {slot.reference?.label
                            || (armed ? 'Haritadan seçin…' : 'Nokta seçin')}
                        </span>
                      </button>
                      <div className="journey-waypoint-actions">
                        {isVia && (
                          <>
                            <button
                              type="button"
                              className="journey-icon-button"
                              onClick={() => onMoveWaypoint?.(slot.key, 'up')}
                              aria-label="Yukarı taşı"
                            >
                              <ChevronUp size={14} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="journey-icon-button"
                              onClick={() => onMoveWaypoint?.(slot.key, 'down')}
                              aria-label="Aşağı taşı"
                            >
                              <ChevronDown size={14} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="journey-icon-button"
                              onClick={() => onRemoveWaypoint?.(slot.key)}
                              aria-label="Ara noktayı kaldır"
                            >
                              <Minus size={14} aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}

                <button type="button" className="journey-add-waypoint" onClick={onAddWaypoint}>
                  <Plus size={14} aria-hidden="true" />
                  Ara nokta ekle
                </button>

                {/* Haritanın BEKLEDİĞİ durum görünür bir cümleyle söylenir:
                    ipucu balonu tek başına yeterli değildir, imleç de öyle.
                    `role="status"` nazik bir canlı bölgedir — bu bir hata
                    değil, sürmekte olan bir kiptir. */}
                {picking && (
                  <p className="journey-picking-status" role="status">
                    Haritadan bir {pickableLabel} seçin · Vazgeçmek için Esc
                  </p>
                )}

                {/* Silahlı yuva için arama: sınırlı sonuç, mevcut arama yolu. */}
                {state.activeSlotKey && (
                  <WaypointPicker
                    /* Duraklar yetkisi olmayana HİÇ sunulmaz: liste haritadan
                       gelse de, seçilemeyecek bir kaydı öneriye koymak
                       kullanıcıyı garanti 403'e davet etmek olurdu. */
                    routeStops={canUseTransport ? stops : []}
                    canUsePois={canUsePois}
                    poiSearch={poiSearch}
                    onAssign={(reference) => onAssignWaypoint?.(state.activeSlotKey, reference)}
                  />
                )}
              </div>
            )}

            <div className="journey-actions">
              <button
                type="button"
                className="journey-primary"
                disabled={!canRequest}
                aria-busy={loading}
                onClick={onRequestPreview}
              >
                {loading ? <Loader2 size={15} className="journey-spin" aria-hidden="true" /> : null}
                {loading ? 'Hesaplanıyor…' : 'Rotayı Hesapla'}
              </button>
              {/* KAYDETMEK BAŞLATMAK DEĞİLDİR: bu düğme yalnızca tanımı
                  saklar — simülasyon kurmaz, kimlik değiştirmez, kamerayı
                  oynatmaz. Geçerli bir kanonik tanım yoksa kapalıdır. */}
              <button
                type="button"
                className="journey-secondary"
                disabled={!canSaveJourney}
                aria-busy={Boolean(saved?.saving)}
                onClick={onSaveJourney}
              >
                <Save size={14} aria-hidden="true" />
                Kaydet
              </button>
              <button type="button" className="journey-secondary" onClick={onClear}>
                <Trash2 size={14} aria-hidden="true" />
                Temizle
              </button>
            </div>

            {/* Eksik seçim bir HATA DEĞİLDİR: kullanıcı henüz yanlış bir şey
                yapmadı, planı tamamlamadı. Düğmenin kapalı olmasının nedenini
                anlatan nötr bir yardım metnidir — uyarı sunumu (role="alert")
                gerçek başarısızlıklara ayrılmıştır. Gerçek bir hata varken
                tekrar etmez: o zaman söylenecek şey yukarıdaki hatadır. */}
            {!error && guidance && !loading && (
              <p className="journey-note journey-guidance">{guidance}</p>
            )}

            {summary && (
              <div className="journey-summary">
                <div className="journey-summary-metrics">
                  <strong>{summary.duration}</strong>
                  <span>{summary.distance}</span>
                </div>
                <p className="journey-summary-line">
                  <span>{summary.originName}</span>
                  <span aria-hidden="true"> → </span>
                  <span>{summary.destinationName}</span>
                </p>
                <p className="journey-summary-meta">
                  {summary.profileLabel}
                  {summary.routeName ? ` · ${summary.routeName}` : ''}
                  {summary.viaCount > 0 ? ` · ${summary.viaCount} ara nokta` : ''}
                </p>

                {/* Başlatma YALNIZCA güncel bir önizlemeden sonra sunulur ve
                    önizlemenin kendisini GÖNDERMEZ: sunucu yolculuğu niyetten
                    yeniden planlar. */}
                <button
                  type="button"
                  className="journey-primary journey-start"
                  disabled={!canRequest || live?.starting}
                  aria-busy={Boolean(live?.starting)}
                  onClick={onStartSimulation}
                >
                  {live?.starting
                    ? <Loader2 size={15} className="journey-spin" aria-hidden="true" />
                    : <Play size={15} aria-hidden="true" />}
                  {live?.starting ? 'Başlatılıyor…' : 'Simülasyonu Başlat'}
                </button>
              </div>
            )}

            {summary && previewSteps.length > 0 && (
              <ol className="journey-steps">
                {previewSteps.map((step) => (
                  <li key={step.key} className={`journey-step dir-${step.direction}`}>
                    <div className="journey-step-text">
                      <strong>{step.instruction}</strong>
                      {step.name && <span>{step.name}</span>}
                    </div>
                    <span className="journey-step-metric">{formatStepMetric(step)}</span>
                  </li>
                ))}
              </ol>
            )}

            {/* Manevrasız kalıcı hat GEÇERLİDİR; hata gibi sunulmaz. */}
            {summary && previewSteps.length === 0 && summary.stepsUnavailableIsExpected && (
              <p className="journey-note">
                Bu hat için kayıtlı güzergah kullanıldı; adım adım yol tarifi bulunmuyor.
              </p>
            )}
          </>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * Silahlı yuva için nokta seçici.
 *
 * <b>Sınırsız veri yüklenmez.</b> Duraklar zaten haritada yüklü olan kümeden
 * süzülür; POI'ler ise mevcut sunucu taraflı arama yolundan gelir — dropdown
 * uğruna tüm POI envanterini indirmek güvenli bir yol değildir.
 */
function WaypointPicker({ routeStops, canUsePois, poiSearch, onAssign }) {
  const canUseStops = routeStops.length > 0
  const term = poiSearch?.query ?? ''
  const normalized = term.trim().toLocaleLowerCase('tr')

  const stopMatches = useMemo(() => {
    if (!normalized) return routeStops.slice(0, 6)
    return routeStops
      .filter((stop) => stop.name?.toLocaleLowerCase('tr').includes(normalized))
      .slice(0, 6)
  }, [routeStops, normalized])

  return (
    <div className="journey-picker">
      <input
        type="search"
        className="journey-picker-input"
        placeholder="Durak veya yer ara…"
        value={term}
        onChange={(event) => poiSearch?.onQueryChange?.(event.target.value)}
        aria-label="Nokta ara"
      />
      <p className="journey-picker-hint">
        Haritadan bir {pickableLabelOf({ canUseStops, canUsePois })} seçebilirsiniz.
      </p>

      <ul className="journey-picker-list">
        {stopMatches.map((stop) => (
          <li key={`stop-${stop.id}`}>
            <button
              type="button"
              onClick={() => onAssign?.({
                source: WAYPOINT_SOURCES.STOP,
                id: stop.id,
                label: stop.name,
                routeName: stop.routeName ?? '',
              })}
            >
              <RouteIcon size={13} aria-hidden="true" />
              <span>{stop.name}</span>
              <em>{stop.routeName ?? ''}</em>
            </button>
          </li>
        ))}

        {canUsePois && (poiSearch?.results ?? []).map((poi) => (
          <li key={`poi-${poi.id}`}>
            <button
              type="button"
              onClick={() => onAssign?.({
                source: WAYPOINT_SOURCES.POI,
                id: poi.id,
                label: poi.name,
                routeName: '',
              })}
            >
              <MapPin size={13} aria-hidden="true" />
              <span>{poi.name}</span>
              <em>{poi.categoryName ?? ''}</em>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
