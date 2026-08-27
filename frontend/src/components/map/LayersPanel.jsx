import { MapPin } from 'lucide-react'
import MapSheet from './MapSheet.jsx'
import { DRAWING_TYPE_LIST } from '../../map/drawingTypes.js'
import { PointIcon, LineIcon, PolygonIcon, ShieldIcon } from '../ui/icons/index.js'
import './LayersPanel.css'

const TYPE_ICONS = { point: PointIcon, line: LineIcon, polygon: PolygonIcon }

/**
 * Per-geometry-type visibility, plus the caller's own authorization boundary.
 *
 * Turning a layer off only stops it rendering (the style function returns no
 * style for that type) — the features stay in the source and the rows stay in
 * PostGIS, so switching back on restores them with no refetch.
 *
 * <b>"Yetki Alanım" bir SİSTEM katmanıdır.</b> (Phase 9) Görünürlüğü
 * kapatılabilir ama silinemez, düzenlenemez ve başka bir kullanıcının alanını
 * göstermez: kapsam, kişinin kendi oturumundan okunur. Coğrafi alan YÖNETİMİ
 * burada değil, yönetim panelindedir — bu katman salt görselleştirmedir.
 *
 * Kısıtsız kullanıcıya sahte bir katman gösterilmez; bunun yerine durumun
 * kendisi ("Sınırsız") yazılır. Kapatılabilir ama hiçbir şey göstermeyen bir
 * satır, var olmayan bir sınırı varmış gibi ima ederdi.
 *
 * <b>POI çizim türlerinin yanında ama onlardan AYRI durur.</b> Aynı listede
 * dördüncü satırdır çünkü kullanıcı için hepsi "haritada ne görünüyor"
 * sorusunun parçasıdır; ama `DRAWING_TYPE_LIST`'e KATILMAZ, çünkü POI bir çizim
 * değildir — kendi yetkisi (`poi.view`), kendi uçları ve kendi katmanları
 * vardır. Listeye katılsaydı toplu seçime, stil düzenleyicisine ve
 * `/api/drawings/*` uçlarına da kendiliğinden karışırdı.
 *
 * Satır YALNIZCA `poi.view` taşıyan çağırana gösterilir ve bu karar çağırandan
 * gelir; burada rol adına bakan hiçbir kural yoktur.
 */
export default function LayersPanel({
  open,
  onClose,
  visibility,
  counts,
  onToggle,
  poi = null,
  onTogglePoi,
  transport = null,
  onToggleTransportRoutes,
  onToggleTransportStops,
  scope = null,
  onToggleScope,
}) {
  if (!open) return null

  const scopeOn = scope?.visible !== false
  const poiOn = poi?.visible !== false

  return (
    <MapSheet open={open} title="Katmanlar" onClose={onClose} className="layers-panel">
      <p className="layers-hint">
        Katmanı kapatmak yalnızca görünümü gizler; kayıtlar veritabanında kalır.
      </p>

      <ul className="layers-list">
        {DRAWING_TYPE_LIST.map((type) => {
          const Icon = TYPE_ICONS[type.id]
          const isOn = visibility[type.id] !== false

          return (
            <li key={type.id}>
              <button
                type="button"
                className={`layers-row ${isOn ? 'is-on' : ''}`}
                aria-pressed={isOn}
                onClick={() => onToggle(type.id)}
              >
                <span className="layers-row-icon">
                  <Icon size={18} />
                </span>
                <span className="layers-row-text">
                  <span className="layers-row-label">{type.plural}</span>
                  <span className="layers-row-count">{counts[type.id] ?? 0} kayıt</span>
                </span>
                {/* Text state, not colour alone. */}
                <span className="layers-row-state">{isOn ? 'AÇIK' : 'KAPALI'}</span>
                <span className="layers-switch" aria-hidden="true">
                  <span className="layers-switch-knob" />
                </span>
              </button>
            </li>
          )
        })}

        {/* Dördüncü satır: kalıcı POI gösterimi. Çizim türleriyle AYNI görsel
            dili konuşur — aynı satır, aynı anahtar, aynı AÇIK/KAPALI metni —
            ama kendi durumundan beslenir. */}
        {poi?.permitted && (
          <li>
            <button
              type="button"
              className={`layers-row ${poiOn ? 'is-on' : ''}`}
              aria-pressed={poiOn}
              data-testid="layers-poi-row"
              onClick={onTogglePoi}
            >
              <span className="layers-row-icon">
                <MapPin size={18} strokeWidth={2} />
              </span>
              <span className="layers-row-text">
                <span className="layers-row-label">POI'ler</span>
                <span className="layers-row-count">{poi.count ?? 0} kayıt</span>
              </span>
              <span className="layers-row-state">{poiOn ? 'AÇIK' : 'KAPALI'}</span>
              <span className="layers-switch" aria-hidden="true">
                <span className="layers-switch-knob" />
              </span>
            </button>
          </li>
        )}
      </ul>

      {transport?.permitted && <>
        <h3 className="layers-group-title">Ulaşım</h3>
        <ul className="layers-list">
          {[
            ['routes', 'Güzergahlar', transport.routeCount ?? 0, transport.routesVisible !== false, onToggleTransportRoutes],
            ['stops', 'Duraklar', transport.stopCount ?? 0, transport.stopsVisible !== false, onToggleTransportStops],
          ].map(([id, label, count, isOn, toggle]) => <li key={id}>
            <button type="button" className={`layers-row ${isOn ? 'is-on' : ''}`} aria-pressed={isOn} data-testid={`layers-transport-${id}`} onClick={toggle}>
              <span className="layers-row-icon"><MapPin size={18} strokeWidth={2} /></span>
              <span className="layers-row-text"><span className="layers-row-label">{label}</span><span className="layers-row-count">{count} kayıt</span></span>
              <span className="layers-row-state">{isOn ? 'AÇIK' : 'KAPALI'}</span>
              <span className="layers-switch" aria-hidden="true"><span className="layers-switch-knob" /></span>
            </button>
          </li>)}
        </ul>
      </>}

      {scope?.isRestricted ? (
        <>
          <h3 className="layers-group-title">Yetki</h3>
          <ul className="layers-list">
            <li>
              <button
                type="button"
                className={`layers-row layers-row--system ${scopeOn ? 'is-on' : ''}`}
                aria-pressed={scopeOn}
                data-testid="layers-scope-row"
                onClick={onToggleScope}
              >
                <span className="layers-row-icon">
                  <ShieldIcon size={18} />
                </span>
                <span className="layers-row-text">
                  <span className="layers-row-label">
                    Yetki Alanım
                    {/* Sistem rozeti: bu satır kullanıcının oluşturduğu bir
                        katman değildir ve silinemez. */}
                    <span className="layers-row-badge">sistem</span>
                  </span>
                  <span className="layers-row-count">
                    {scope.areaCount > 1 ? `${scope.areaCount} bölge` : 'Çizim yapabileceğiniz alan'}
                  </span>
                </span>
                <span className="layers-row-state">{scopeOn ? 'AÇIK' : 'KAPALI'}</span>
                <span className="layers-switch" aria-hidden="true">
                  <span className="layers-switch-knob" />
                </span>
              </button>
            </li>
          </ul>
          <p className="layers-hint">
            Bu sınır yalnızca size uygulanır ve buradan değiştirilemez; coğrafi yetki
            yönetimi yönetim panelindedir.
          </p>
        </>
      ) : (
        <p className="layers-hint" data-testid="layers-scope-note">
          {scope?.failed
            ? 'Yetki alanı bilgisi şu anda okunamadı.'
            : 'Yetki alanı: Sınırsız — çiziminizi kısıtlayan bir coğrafi sınır yok.'}
        </p>
      )}
    </MapSheet>
  )
}
