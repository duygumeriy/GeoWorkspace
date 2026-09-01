import { useMemo } from 'react'
import {
  ArrowDownUp,
  ArrowLeft,
  Crosshair,
  RotateCcw,
  Play,
  Square,
  Bike,
  ChevronDown,
  ChevronUp,
  Car,
  Footprints,
  Loader2,
  MapPin,
  Minus,
  Plus,
  Route as RouteIcon,
  Trash2,
  X,
} from 'lucide-react'
import './JourneyPlanner.css'
import {
  JOURNEY_MODES,
  JOURNEY_PROFILES,
  PANEL_STATES,
  WAYPOINT_SOURCES,
  waypointRoleAt,
} from '../../map/journeyPlanning.js'
import { journeyPreviewSummary, journeyProfileLabel as journeyProfileLabelOf } from '../../map/journeyPresentation.js'
import { journeyStepList } from '../../map/journeyManeuvers.js'
import {
  JOURNEY_PHASES,
  JOURNEY_SIMULATION_STATUS,
  journeyLiveModel,
  journeyPhase,
} from '../../map/journeySimulationState.js'
import { formatRouteDistance, formatRouteDuration } from '../../map/transportPathPresentation.js'

const PROFILE_ICONS = { car: Car, pedestrian: Footprints, bicycle: Bike }

const MODE_TABS = [
  { id: JOURNEY_MODES.ROUTE_FULL, label: 'Hat' },
  { id: JOURNEY_MODES.ROUTE_SEGMENT, label: 'Hat Bölümü' },
  { id: JOURNEY_MODES.WAYPOINTS, label: 'Serbest' },
]

const ROLE_LABELS = { origin: 'Başlangıç', via: 'Ara nokta', destination: 'Varış' }

/**
 * Terminal başlıkları — durum SUNUCUDAN gelir, tarayıcıda türetilmez.
 *
 * Bilinmeyen bir terminal durum çökertmez: sözleşme iki değerle sınırlı olsa
 * da arayüz savunmacı davranır ve nötr bir başlık gösterir.
 */
const TERMINAL_TITLES = {
  [JOURNEY_SIMULATION_STATUS.COMPLETED]: 'Yolculuk tamamlandı',
  [JOURNEY_SIMULATION_STATUS.CANCELLED]: 'Yolculuk durduruldu',
  default: 'Yolculuk sona erdi',
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
  error = '',
  canRequest = false,
  canUsePois = false,
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

  const steps = useMemo(
    () => journeyStepList(isLive ? live?.simulation?.steps : preview?.steps),
    [isLive, live?.simulation?.steps, preview?.steps],
  )
  const routeStops = useMemo(
    () => stops.filter((stop) => stop.routeId === state.routeId)
      .slice()
      .sort((left, right) => left.sequenceOrder - right.sequenceOrder || left.id - right.id),
    [stops, state.routeId],
  )

  if (state.panel === PANEL_STATES.CLOSED) {
    return (
      <button
        type="button"
        className="journey-reopen"
        onClick={onOpen}
        aria-label="Yolculuk planlayıcısını aç"
        title="Yolculuk planla"
      >
        <RouteIcon size={18} aria-hidden="true" />
      </button>
    )
  }

  const collapsed = state.panel === PANEL_STATES.COLLAPSED
  const activeProfile = JOURNEY_PROFILES.find((profile) => profile.id === state.profile)
  const ActiveProfileIcon = PROFILE_ICONS[activeProfile?.icon] ?? Car

  return (
    <section
      className={`journey-panel ${collapsed ? 'is-collapsed' : ''}`.trim()}
      aria-label="Yolculuk planlayıcısı"
    >
      <header className="journey-head">
        <div className="journey-head-title">
          <ActiveProfileIcon size={16} aria-hidden="true" />
          <span>Yolculuk</span>
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

      {/* KATLANMIŞ: panel kaybolmaz, yeniden açmaya yetecek kadarını gösterir. */}
      {collapsed && (
        <button type="button" className="journey-collapsed-summary" onClick={onOpen}>
          {isTerminal ? (
            /* Katlanmış terminal: sonuç GİZLENİR ama kaybolmaz — panel
               açıldığında hâlâ oradadır, yalnızca kullanıcı bırakınca gider. */
            <>
              <strong>{TERMINAL_TITLES[liveModel.status] ?? TERMINAL_TITLES.default}</strong>
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

      {!collapsed && isLive && (
        <div className="journey-body">
          {isActive && (
            <>
              <div className="journey-live-metrics">
                <strong>%{Math.round(liveModel.progressPercent)}</strong>
                <span>{formatRouteDistance(liveModel.remainingDistanceMeters)} kaldı</span>
              </div>

              <div className="journey-live-bar" role="progressbar" aria-valuenow={Math.round(liveModel.progressPercent)}
                   aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${liveModel.progressPercent}%` }} />
              </div>
            </>
          )}

          {/* TERMİNAL: hareket bitti, SONUÇ durur. İlerleme çubuğu ve kalan
              mesafe yerine sunucunun son ölçümleri gösterilir; hiçbir değer
              tarayıcıda yeniden hesaplanmaz. */}
          {isTerminal && (
            <div className="journey-terminal">
              <strong>{TERMINAL_TITLES[liveModel.status] ?? TERMINAL_TITLES.default}</strong>
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
              <button type="button" className="journey-secondary" onClick={onToggleFollow}>
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
          {steps.length === 0 && (
            <p className="journey-note">Bu yolculuk için adım adım yol tarifi bulunmuyor.</p>
          )}

          {steps.length > 0 && (
            <ol className="journey-steps">
              {steps.map((step) => (
                <li
                  key={step.key}
                  className={`journey-step dir-${step.direction} ${
                    step.sequence === liveModel.currentStepSequence ? 'is-current' : ''
                  }`.trim()}
                  aria-current={step.sequence === liveModel.currentStepSequence ? 'step' : undefined}
                >
                  <div className="journey-step-text">
                    <strong>{step.instruction}</strong>
                    {step.name && <span>{step.name}</span>}
                  </div>
                  <span className="journey-step-metric">{formatStepMetric(step)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {!collapsed && !isLive && (
        <div className="journey-body">
          <div className="journey-tabs" role="tablist" aria-label="Planlama türü">
            {MODE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={state.mode === tab.id}
                className={`journey-tab ${state.mode === tab.id ? 'is-active' : ''}`.trim()}
                onClick={() => onModeChange?.(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tam olarak üç profil. Otobüs/toplu taşıma seçeneği YOKTUR. */}
          <div className="journey-profiles" role="radiogroup" aria-label="Seyahat türü">
            {JOURNEY_PROFILES.map((profile) => {
              const Icon = PROFILE_ICONS[profile.icon] ?? Car
              return (
                <button
                  key={profile.id}
                  type="button"
                  role="radio"
                  aria-checked={state.profile === profile.id}
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

          {state.mode !== JOURNEY_MODES.WAYPOINTS && (
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

          {state.mode === JOURNEY_MODES.ROUTE_SEGMENT && (
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

              {/* Silahlı yuva için arama: sınırlı sonuç, mevcut arama yolu. */}
              {state.activeSlotKey && (
                <WaypointPicker
                  routeStops={stops}
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
              onClick={onRequestPreview}
            >
              {loading ? <Loader2 size={15} className="journey-spin" aria-hidden="true" /> : null}
              {loading ? 'Hesaplanıyor…' : 'Rotayı Hesapla'}
            </button>
            <button type="button" className="journey-secondary" onClick={onClear}>
              <Trash2 size={14} aria-hidden="true" />
              Temizle
            </button>
          </div>

          {error && <p className="journey-error" role="alert">{error}</p>}
          {live?.error && <p className="journey-error" role="alert">{live.error}</p>}

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
                onClick={onStartSimulation}
              >
                {live?.starting
                  ? <Loader2 size={15} className="journey-spin" aria-hidden="true" />
                  : <Play size={15} aria-hidden="true" />}
                {live?.starting ? 'Başlatılıyor…' : 'Simülasyonu Başlat'}
              </button>
            </div>
          )}

          {summary && steps.length > 0 && (
            <ol className="journey-steps">
              {steps.map((step) => (
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
          {summary && steps.length === 0 && summary.stepsUnavailableIsExpected && (
            <p className="journey-note">
              Bu hat için kayıtlı güzergah kullanıldı; adım adım yol tarifi bulunmuyor.
            </p>
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
      <p className="journey-picker-hint">Haritadan bir durak{canUsePois ? ' ya da yer' : ''} seçebilirsiniz.</p>

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
