import { useEffect } from 'react'
import { roleType } from './roleType.js'

/**
 * Role detail, in the same right-hand drawer the user screen uses.
 *
 * The drawer reads from the row already in the list: `GET /api/admin/roles/{id}`
 * returns the SAME shape as a list row (RoleDetail extends RoleListItem and adds
 * nothing), so opening a detail needs no second request.
 *
 * Which actions appear is the SERVER'S answer — `canRename` / `canDelete` — not
 * a name comparison here. If the backend ever unfreezes a role, this screen
 * follows without an edit. Disabling a button is only ever a courtesy: the
 * backend refuses the request regardless of what the browser rendered.
 */
export default function RoleDetailPanel({ role, busy, onClose, onRename, onDelete }) {
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  if (!role) return null

  const type = roleType(role)

  return (
    <>
      <div className="admin-panel-scrim" onMouseDown={onClose} aria-hidden="true" />
      <aside className="admin-detail-panel" role="dialog" aria-modal="true" aria-labelledby="role-detail-title">
        <button type="button" className="admin-panel-close" onClick={onClose} aria-label="Detayı kapat">×</button>

        <header>
          <span className="admin-avatar" aria-hidden="true">{role.name.slice(0, 1).toUpperCase()}</span>
          <div>
            <h2 id="role-detail-title">{role.name}</h2>
            <span className={`admin-badge role-${type.tone}`}>{type.label}</span>
          </div>
        </header>

        <p className="admin-readonly-note">{type.summary}</p>

        <dl className="admin-detail-grid">
          <div><dt>Rol adı</dt><dd>{role.name}</dd></div>
          <div><dt>Rol türü</dt><dd>{type.label}</dd></div>
          <div><dt>Kullanıcı</dt><dd>{role.userCount}</dd></div>
          <div><dt>Yetki</dt><dd>{role.permissionCount}</dd></div>
          <div>
            <dt>Yeni atamalara açık</dt>
            <dd>{role.isAssignable ? 'Evet' : 'Hayır — bu rol yeni atamalarda seçilemez.'}</dd>
          </div>
        </dl>

        {/* Phase 5B yalnızca SAYIYI gösterir. Yetki düzenleyici bilinçli olarak
            yoktur; onay kutusu, kirli durum ve kaydetme akışı sonraki fazın
            konusudur. */}
        <section className="admin-management">
          <h3>Yetkiler</h3>
          <p className="admin-readonly-note">
            Bu rolde {role.permissionCount} aktif yetki var.{' '}
            {role.canEditPermissions
              ? 'Rol yetkilerinin düzenlenmesi bir sonraki aşamada bu ekrana eklenecek.'
              : 'Bu rolün yetkileri sistem tarafından dondurulmuştur ve düzenlenemez.'}
          </p>
        </section>

        <section className="admin-management">
          <h3>Yönetim</h3>
          {role.canRename || role.canDelete ? (
            <div className="admin-role-actions">
              {role.canRename && (
                <button type="button" className="admin-button secondary" disabled={busy} onClick={onRename}>
                  Yeniden Adlandır
                </button>
              )}
              {role.canDelete && (
                <button type="button" className="admin-button danger" disabled={busy} onClick={onDelete}>
                  Rolü Sil
                </button>
              )}
            </div>
          ) : (
            /* Devre dışı düğme yığını yerine tek cümle: kullanılamayan bir
               kontrolü göstermek, sebebini söylemekten daha az bilgi verir. */
            <p className="admin-policy-note">
              {type.key === 'legacy'
                ? 'Geçiş dönemi rolüdür: adı değiştirilemez, silinemez ve yeni atamalarda kullanılamaz.'
                : 'Sistem rolüdür: adı değiştirilemez ve silinemez.'}
            </p>
          )}
        </section>
      </aside>
    </>
  )
}
