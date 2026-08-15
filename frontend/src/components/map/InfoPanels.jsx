import MapSheet from './MapSheet.jsx'
import ThemeToggle from '../ui/ThemeToggle.jsx'
import ChangePasswordForm from './ChangePasswordForm.jsx'
import TwoFactorSettings from './TwoFactorSettings.jsx'
import { DRAWING_TYPE_LIST } from '../../map/drawingTypes.js'
import './InfoPanels.css'
import '../../pages/AuthShell.css'

/** Theme choice, account security and the keyboard reference — all real. */
export function SettingsPanel({ open, onClose, shortcutsEnabled }) {
  if (!open) return null

  const shortcuts = [
    ...DRAWING_TYPE_LIST.map((type) => ({ keys: type.shortcut, action: `${type.label} aracı` })),
    { keys: 'M', action: 'Ölçüm aracı' },
    { keys: 'Esc', action: 'Çizimi iptal et / paneli kapat' },
    { keys: 'Ctrl/⌘ + Z', action: 'Geri al' },
    { keys: 'Ctrl/⌘ + ⇧ + Z', action: 'İleri al' },
  ]

  return (
    <MapSheet open={open} title="Ayarlar" onClose={onClose} className="info-panel">
      <section className="info-section">
        <h3 className="info-heading">Görünüm</h3>
        <div className="info-row">
          <span>Tema</span>
          <ThemeToggle />
        </div>
        <p className="info-note">
          Sistem temanız otomatik uygulanır; buradan açık veya koyu temayı sabitleyebilirsiniz.
        </p>
      </section>

      {/* Account security: password and two-factor authentication. */}
      <section className="info-section">
        <h3 className="info-heading">Güvenlik</h3>
        <p className="info-note">Şifre Değiştir</p>
        <ChangePasswordForm />
      </section>

      <section className="info-section">
        <h3 className="info-heading">İki Faktörlü Doğrulama</h3>
        <TwoFactorSettings />
      </section>

      <section className="info-section">
        <h3 className="info-heading">Klavye Kısayolları</h3>
        {!shortcutsEnabled && (
          <p className="info-note">Kısayollar bu ekran boyutunda devre dışıdır.</p>
        )}
        <dl className="info-shortcuts">
          {shortcuts.map((item) => (
            <div className="info-shortcut" key={item.action}>
              <dt>
                <kbd>{item.keys}</kbd>
              </dt>
              <dd>{item.action}</dd>
            </div>
          ))}
        </dl>
      </section>
    </MapSheet>
  )
}

/** What the app is and which stack it actually runs on. */
export function AboutPanel({ open, onClose }) {
  if (!open) return null

  return (
    <MapSheet open={open} title="Hakkında" onClose={onClose} className="info-panel">
      <section className="info-section">
        <h3 className="info-heading">Staj Harita Uygulaması</h3>
        <p className="info-note">
          Nokta, çizgi ve poligon çizimlerini kalıcı olarak saklayan küçük bir GIS çalışma alanı.
          Çizimler ve görünüm ayarları PostGIS üzerinde tutulur.
        </p>
      </section>

      <section className="info-section">
        <h3 className="info-heading">Teknik</h3>
        <dl className="info-rows">
          <div className="info-row">
            <dt>Harita</dt>
            <dd>OpenLayers · OSM</dd>
          </div>
          <div className="info-row">
            <dt>Harita projeksiyonu</dt>
            <dd>EPSG:3857</dd>
          </div>
          <div className="info-row">
            <dt>Veri projeksiyonu</dt>
            <dd>EPSG:4326</dd>
          </div>
          <div className="info-row">
            <dt>API</dt>
            <dd>.NET 8 · JWT</dd>
          </div>
          <div className="info-row">
            <dt>Veritabanı</dt>
            <dd>PostgreSQL · PostGIS</dd>
          </div>
        </dl>
      </section>
    </MapSheet>
  )
}
