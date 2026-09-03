import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronRight, MapPin, Search } from 'lucide-react'
import MapSheet from './MapSheet.jsx'
import { filterPoiCategoryTree, matchesLayerSearch } from '../../map/layerManager.js'
import { PointIcon, LineIcon, PolygonIcon, ShieldIcon } from '../ui/icons/index.js'
import './LayersPanel.css'

const TYPE_ICONS = { point: PointIcon, line: LineIcon, polygon: PolygonIcon }
const DEFAULT_EXPANDED = new Set(['poi', 'stops', 'drawings', 'routes'])

function VisibilityCheckbox({ label, state, onChange, disabled = false, testId = undefined }) {
  const ref = useRef(null)
  const id = useId()

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state?.indeterminate === true
  }, [state?.indeterminate])

  return (
    <label className={`layers-check ${disabled ? 'is-disabled' : ''}`} htmlFor={id}>
      <input
        ref={ref}
        id={id}
        type="checkbox"
        checked={state?.checked === true}
        disabled={disabled}
        data-testid={testId}
        onChange={(event) => onChange?.(event.target.checked)}
      />
      <span className="layers-check-label">{label}</span>
    </label>
  )
}

function Disclosure({ groupKey, label, count, expanded, onToggle, icon: Icon = null }) {
  const contentId = `layers-group-${groupKey}`
  return (
    <div className="layers-section-heading">
      <button type="button" className="layers-disclosure" aria-expanded={expanded} aria-controls={contentId} onClick={onToggle}>
        <ChevronRight className="layers-chevron" size={17} aria-hidden="true" />
        {Icon && <span className="layers-heading-icon" aria-hidden="true"><Icon size={17} /></span>}
        <span className="layers-heading-label">{label}</span>
        <span className="layers-count" aria-label={`${count} kayıt`}>{count}</span>
      </button>
    </div>
  )
}

function RecordCheckbox({ label, visible, onChange, meta = null, color = null }) {
  return (
    <li className="layers-record">
      <VisibilityCheckbox label={label} state={{ checked: visible, indeterminate: false }} onChange={onChange} />
      {color && <span className="layers-color" style={{ backgroundColor: color }} aria-hidden="true" />}
      {meta && <span className="layers-record-meta">{meta}</span>}
    </li>
  )
}

function CategoryNode({ node, depth, query, expanded, onToggleExpanded, onSetVisible, onTogglePoi }) {
  const key = `category:${node.key}`
  const open = Boolean(query) || expanded.has(key)

  return (
    <li className="layers-category" style={{ '--layers-depth': Math.min(depth, 4) }}>
      <Disclosure groupKey={key} label={node.label} count={node.count} expanded={open} onToggle={() => onToggleExpanded(key)} />
      {open && (
        <div className="layers-branch" id={`layers-group-${key}`}>
          <VisibilityCheckbox label="Tümünü Göster" state={node.state} onChange={(visible) => onSetVisible(node.poiIds, visible)} />
          {node.directPois.length > 0 && (
            <ul className="layers-record-list">
              {node.directPois.map((poi) => (
                <RecordCheckbox key={poi.id} label={poi.name || `Adsız POI #${poi.id}`} visible={poi.visible} onChange={() => onTogglePoi(poi.id)} />
              ))}
            </ul>
          )}
          {node.children.length > 0 && (
            <ul className="layers-category-list">
              {node.children.map((child) => (
                <CategoryNode key={child.key} node={child} depth={depth + 1} query={query} expanded={expanded} onToggleExpanded={onToggleExpanded} onSetVisible={onSetVisible} onTogglePoi={onTogglePoi} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

export default function LayersPanel({
  open,
  onClose,
  poi = null,
  drawings = null,
  transport = null,
  onSetPoiVisibility,
  onTogglePoi,
  onSetDrawingVisibility,
  onToggleDrawing,
  onToggleTransportRoutes,
  onSetTransportRoutes,
  onToggleTransportRoute,
  onSetTransportStops,
  onToggleTransportStop,
  scope = null,
  onToggleScope,
}) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(() => new Set(DEFAULT_EXPANDED))

  const toggleExpanded = (key) => setExpanded((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const searching = query.trim().length > 0
  const poiCategories = useMemo(
    () => matchesLayerSearch("POI'ler", query)
      ? (poi?.categories ?? [])
      : filterPoiCategoryTree(poi?.categories ?? [], query),
    [poi?.categories, query],
  )
  const drawingGroups = useMemo(() => (drawings?.groups ?? []).map((group) => {
    const groupMatches = matchesLayerSearch('Çizimler', query) || matchesLayerSearch(group.label, query)
    return {
      ...group,
      records: groupMatches ? group.records : group.records.filter((record) => matchesLayerSearch(record.name, query)),
    }
  }).filter((group) => group.records.length > 0), [drawings?.groups, query])
  const stops = useMemo(() => matchesLayerSearch('Duraklar', query)
    ? (transport?.stops ?? [])
    : (transport?.stops ?? []).filter((stop) => matchesLayerSearch(`${stop.name ?? ''} ${stop.routeName ?? ''}`, query)), [transport?.stops, query])
  const routes = useMemo(() => matchesLayerSearch('Güzergâhlar', query)
    ? (transport?.routes ?? [])
    : (transport?.routes ?? []).filter((route) => matchesLayerSearch(route.name, query)), [transport?.routes, query])

  if (!open) return null

  const scopeOn = scope?.visible !== false
  const poiOpen = searching || expanded.has('poi')
  const stopsOpen = searching || expanded.has('stops')
  const drawingsOpen = searching || expanded.has('drawings')
  const routesOpen = searching || expanded.has('routes')
  const showPoi = poi?.permitted && poi.count > 0 && (!searching || poiCategories.length > 0)
  const showStops = transport?.permitted && transport.stopCount > 0 && (!searching || stops.length > 0)
  const showDrawings = drawings?.permitted && drawings.count > 0 && (!searching || drawingGroups.length > 0)
  const showRoutes = transport?.permitted && transport.routeCount > 0 && (!searching || routes.length > 0)
  const hasResults = showPoi || showStops || showDrawings || showRoutes

  return (
    <MapSheet open={open} title="Katmanlar" onClose={onClose} className="layers-panel">
      <div className="layers-search">
        <Search size={17} aria-hidden="true" />
        <label className="sr-only" htmlFor="layer-manager-search">Katman ara</label>
        <input id="layer-manager-search" type="search" value={query} placeholder="Katman ara..." autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
      </div>

      <p className="layers-hint">Görünürlük yalnızca haritayı değiştirir; kayıtlar korunur.</p>

      <div className="layers-tree" data-testid="layer-manager-scroll-content">
        {showPoi && (
          <section className="layers-section" data-testid="layers-poi-row">
            <Disclosure groupKey="poi" label="POI'ler" count={poi.count} expanded={poiOpen} onToggle={() => toggleExpanded('poi')} icon={MapPin} />
            {poiOpen && <div className="layers-section-content" id="layers-group-poi">
              <VisibilityCheckbox label="Tümünü Göster" state={poi.state} onChange={(visible) => onSetPoiVisibility?.(poi.ids, visible)} />
              <ul className="layers-category-list">
                {poiCategories.map((node) => <CategoryNode key={node.key} node={node} depth={0} query={query} expanded={expanded} onToggleExpanded={toggleExpanded} onSetVisible={onSetPoiVisibility} onTogglePoi={onTogglePoi} />)}
              </ul>
            </div>}
          </section>
        )}

        {showStops && (
          <section className="layers-section">
            <Disclosure groupKey="stops" label="Duraklar" count={transport.stopCount} expanded={stopsOpen} onToggle={() => toggleExpanded('stops')} icon={MapPin} />
            {stopsOpen && <div className="layers-section-content" id="layers-group-stops">
              <VisibilityCheckbox label="Tümünü Göster" state={transport.stopState} onChange={(visible) => onSetTransportStops?.(transport.stopIds, visible)} />
              <ul className="layers-record-list">
                {stops.map((stop) => <RecordCheckbox key={stop.id} label={stop.name || `Adsız durak #${stop.id}`} visible={stop.visible} meta={stop.routeName} onChange={() => onToggleTransportStop?.(stop.id)} />)}
              </ul>
            </div>}
          </section>
        )}

        {showDrawings && (
          <section className="layers-section">
            <Disclosure groupKey="drawings" label="Çizimler" count={drawings.count} expanded={drawingsOpen} onToggle={() => toggleExpanded('drawings')} />
            {drawingsOpen && <div className="layers-section-content" id="layers-group-drawings">
              <VisibilityCheckbox label="Tümünü Göster" state={drawings.state} onChange={(visible) => onSetDrawingVisibility?.(drawings.ids, visible)} />
              <ul className="layers-category-list">
                {drawingGroups.map((group) => {
                  const Icon = TYPE_ICONS[group.id]
                  const key = `drawing:${group.id}`
                  const groupOpen = Boolean(query) || expanded.has(key)
                  return <li key={group.id} className="layers-category">
                    <Disclosure groupKey={key} label={group.label} count={group.count} expanded={groupOpen} onToggle={() => toggleExpanded(key)} icon={Icon} />
                    {groupOpen && <div className="layers-branch" id={`layers-group-${key}`}>
                      <VisibilityCheckbox label="Tümünü Göster" state={group.state} onChange={(visible) => onSetDrawingVisibility?.(group.ids, visible)} />
                      <ul className="layers-record-list">
                        {group.records.map((record) => <RecordCheckbox key={record.identity} label={record.name || `Adsız çizim #${record.databaseId}`} visible={record.visible} onChange={() => onToggleDrawing?.(record.identity)} />)}
                      </ul>
                    </div>}
                  </li>
                })}
              </ul>
            </div>}
          </section>
        )}

        {showRoutes && (
          <section className="layers-section">
            <Disclosure groupKey="routes" label="Güzergâhlar" count={transport.routeCount} expanded={routesOpen} onToggle={() => toggleExpanded('routes')} />
            {routesOpen && <div className="layers-section-content" id="layers-group-routes">
              <VisibilityCheckbox label="Güzergâh katmanını göster" state={{ checked: transport.routesVisible, indeterminate: false }} onChange={onToggleTransportRoutes} testId="layers-transport-routes" />
              <VisibilityCheckbox label="Tümünü Göster" state={transport.routeState} onChange={(visible) => onSetTransportRoutes?.(transport.routeIds, visible)} />
              <ul className="layers-record-list" aria-label="Güzergah görünürlüğü">
                {routes.map((route) => <RecordCheckbox key={route.id} label={route.name || `Adsız güzergâh #${route.id}`} visible={route.visible} color={route.colorHex} meta={route.isStale ? 'Güncel değil' : null} onChange={() => onToggleTransportRoute?.(route.id)} />)}
              </ul>
            </div>}
          </section>
        )}

        {query && !hasResults && <p className="layers-empty">Aramanızla eşleşen katman kaydı bulunamadı.</p>}
      </div>

      {!query && scope?.isRestricted && <section className="layers-system-section">
        <button type="button" className={`layers-system-row ${scopeOn ? 'is-on' : ''}`} aria-pressed={scopeOn} data-testid="layers-scope-row" onClick={onToggleScope}>
          <ShieldIcon size={17} />
          <span>Yetki Alanım <small>sistem</small></span>
          <strong>{scopeOn ? 'AÇIK' : 'KAPALI'}</strong>
        </button>
      </section>}
    </MapSheet>
  )
}
