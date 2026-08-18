import { useId, useMemo } from 'react'
import { activeCount, assignedInactive, groupByCategory } from './rolePermissions.js'

/**
 * Rolün yetki matrisi: okuma ve — sunucu izin veriyorsa — düzenleme.
 *
 * Düzenlenebilirliği tek bir şey belirler: sunucunun `canEditPermissions`
 * bayrağı. Rol ADINA bakılmaz. "Admin ise dondur" gibi bir kural burada ikinci
 * bir kural kitabı kurar ve backend'in RoleCatalog'u değiştiği gün sessizce
 * onunla çelişirdi. Devre dışı bir onay kutusu zaten yalnızca nezakettir:
 * sunucu, tarayıcının ne çizdiğine bakmadan reddeder.
 *
 * Pasif (kullanımdan kaldırılmış) yetkiler görünür ama SEÇİLEMEZ. Atanmış bir
 * pasif yetki de işaretli görünür; istek gövdesine hiç girmez ve sunucu bu bağı
 * kendiliğinden korur. Kaydetme onları ne siler ne de yeniden atar.
 */
export default function RolePermissionEditor({
  role,
  permissions,
  selected,
  loading,
  error,
  saving,
  saveError,
  dirty,
  onToggle,
  onSetCategory,
  onReset,
  onSave,
  onRetry,
}) {
  const headingId = useId()
  const editable = role.canEditPermissions === true

  const groups = useMemo(() => groupByCategory(permissions), [permissions])
  const selectableTotal = useMemo(() => activeCount(permissions), [permissions])
  const preservedInactive = useMemo(() => assignedInactive(permissions), [permissions])

  if (loading) {
    /* Yalnızca BU bölüm bekler. Rol listesi ve detayın geri kalanı kullanılabilir
       kalır; tüm ekranı boşaltmak, tek bir bölümün yüklenmesi için sayfayı
       kaybetmek olurdu. */
    return (
      <section className="admin-management" aria-labelledby={headingId}>
        <h3 id={headingId}>Yetkiler</h3>
        <p className="admin-readonly-note" role="status">Rol yetkileri yükleniyor…</p>
      </section>
    )
  }

  if (error) {
    return (
      <section className="admin-management" aria-labelledby={headingId}>
        <h3 id={headingId}>Yetkiler</h3>
        {/* Hata bölümde KALIR: detay kendiliğinden kapanmaz, çünkü kapanan bir
            panel kişiye ne olduğunu anlatma şansını da götürür. */}
        <div className="admin-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={onRetry}>Tekrar dene</button>
        </div>
      </section>
    )
  }

  return (
    <section className="admin-management admin-permissions" aria-labelledby={headingId}>
      <h3 id={headingId}>Yetkiler</h3>

      <p className="admin-permission-summary">
        <strong>{selected.size}</strong> / {selectableTotal}{' '}
        {editable ? 'yetki seçili' : 'yetki atanmış'}
        {dirty && <span className="admin-permission-dirty"> · Kaydedilmemiş değişiklik var</span>}
      </p>

      {!editable && (
        <p className="admin-policy-note">
          {role.isLegacy
            ? 'Bu legacy rolün yetkileri geriye dönük uyumluluk nedeniyle değiştirilemez.'
            : 'Bu rolün yetkileri sistem tarafından dondurulmuştur ve değiştirilemez.'}
        </p>
      )}

      {preservedInactive.length > 0 && (
        <p className="admin-readonly-note">
          Bu rolde kullanımdan kaldırılmış {preservedInactive.length} yetki bağı var. Salt okunur
          gösterilir, etkin erişim vermez ve kaydetme sırasında SİLİNMEZ.
        </p>
      )}

      {selected.size === 0 && preservedInactive.length === 0 && (
        <p className="admin-readonly-note">Bu role henüz yetki atanmamış.</p>
      )}

      {/* Kaydet/geri al bölümün BAŞINDA durur: 27 satırın altına inmek zorunda
          kalmadan, panel açıldığı anda görünür ve erişilebilir olsun diye. */}
      {editable && (
        <div className="admin-role-actions">
          <button
            type="button"
            className="admin-button"
            disabled={!dirty || saving}
            onClick={onSave}
          >
            {saving ? 'Kaydediliyor…' : 'Değişiklikleri Kaydet'}
          </button>
          {dirty && (
            <button type="button" className="admin-button secondary" disabled={saving} onClick={onReset}>
              Değişiklikleri Geri Al
            </button>
          )}
        </div>
      )}

      {saveError && (
        <div className="admin-error" role="alert">
          <span>{saveError}</span>
        </div>
      )}

      {groups.map((group) => {
        const selectable = group.items.filter((item) => item.isActive)
        const allSelected = selectable.length > 0 && selectable.every((item) => selected.has(item.code))

        return (
          <div
            className="admin-permission-group"
            key={group.category}
            role="group"
            aria-label={group.label}
          >
            <div className="admin-permission-group-head">
              {/* h4: bölüm başlığının altındaki gerçek bir alt başlık. Kalın bir
                  div, ekran okuyucuya hiçbir yapı bilgisi vermezdi. */}
              <h4>{group.label}</h4>
              {editable && selectable.length > 1 && (
                <button
                  type="button"
                  className="admin-permission-bulk"
                  disabled={saving}
                  onClick={() => onSetCategory(selectable.map((item) => item.code), !allSelected)}
                >
                  {allSelected ? 'Tümünü Kaldır' : 'Tümünü Seç'}
                </button>
              )}
            </div>

            <ul className="admin-permission-list">
              {group.items.map((item) => {
                const checked = item.isActive ? selected.has(item.code) : item.assigned
                // Pasif satır hiçbir rolde seçilemez; aktif satır yalnızca rol
                // düzenlenebilirse seçilebilir.
                const locked = !editable || !item.isActive

                return (
                  <li key={item.code}>
                    <label className={`admin-permission-row ${locked ? 'is-locked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={locked}
                        onChange={() => onToggle(item.code)}
                      />
                      <span className="admin-permission-text">
                        <strong>
                          {item.name}
                          {!item.isActive && <span className="admin-badge">Pasif</span>}
                        </strong>
                        {item.description && <span>{item.description}</span>}
                        {/* Teknik kod yöneticiye faydalıdır ama satırın konusu
                            değildir: küçük, sönük ve en altta. */}
                        <code>{item.code}</code>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </section>
  )
}
