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
 */
export default function LayersPanel({
  open,
  onClose,
  visibility,
  counts,
  onToggle,
  scope = null,
  onToggleScope,
}) {
  if (!open) return null

  const scopeOn = scope?.visible !== false

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
      </ul>

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
