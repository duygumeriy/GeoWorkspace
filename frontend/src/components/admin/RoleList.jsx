import { roleType } from './roleType.js'

/**
 * The global role inventory.
 *
 * A table rather than cards: the Users screen next door is a table, the data is
 * uniformly shaped, and counts are far easier to compare down a column than
 * across a grid of boxes.
 */
export default function RoleList({ roles, loading, selectedId, onSelect }) {
  if (loading) {
    return (
      <div className="admin-users-list" aria-label="Roller yükleniyor">
        {[1, 2, 3, 4, 5].map((n) => <div className="admin-skeleton" key={n} />)}
      </div>
    )
  }

  if (!roles.length) {
    /* Gerçek veritabanında korunan roller her zaman bulunur, dolayısıyla bu
       durum normalde oluşmaz — ama boş bir başarılı yanıt, uydurma kart
       göstermek için sebep değildir. */
    return (
      <div className="admin-empty">
        <strong>Rol bulunamadı</strong>
        <span>Sistemde tanımlı rol yok.</span>
      </div>
    )
  }

  return (
    <div className="admin-users-list admin-roles-list">
      <div className="admin-table-head" aria-hidden="true">
        <span>Rol</span>
        <span>Tür</span>
        <span>Kullanıcı</span>
        <span>Yetki</span>
        <span>Atama</span>
      </div>
      {roles.map((role) => {
        const type = roleType(role)
        return (
          <button
            type="button"
            key={role.id}
            className={`admin-user-row ${selectedId === role.id ? 'is-selected' : ''}`}
            onClick={() => onSelect(role.id)}
            aria-label={`${role.name} rolünün detayını aç`}
          >
            <span className="admin-user-identity"><strong>{role.name}</strong></span>
            <span data-label="Tür"><span className={`admin-badge role-${type.tone}`}>{type.label}</span></span>
            {/* Sayımlar sunucudan gelir; rol başına ikinci bir istekle
                üretilmez. */}
            <span data-label="Kullanıcı" className="admin-role-count">{role.userCount}</span>
            <span data-label="Yetki" className="admin-role-count">{role.permissionCount}</span>
            <span data-label="Atama">
              {role.isAssignable
                ? <span className="admin-badge success">Atanabilir</span>
                : <span className="admin-badge">Kapalı</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
