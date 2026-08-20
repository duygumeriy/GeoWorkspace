import { accountStatusBadge, mfaLabel } from './userStatus.js'
import { isAdministrativeRole } from '../../auth/roles.js'

function Badge({ tone = '', children }) { return <span className={`admin-badge ${tone}`}>{children}</span> }
export default function UserManagementList({ users, currentUserId, loading, selectedId, onSelect, emptyMessage }) {
  if (loading) return <div className="admin-users-list" aria-label="Kullanıcılar yükleniyor">{[1, 2, 3, 4].map((n) => <div className="admin-skeleton" key={n} />)}</div>
  if (!users.length) return <div className="admin-empty"><strong>Kullanıcı bulunamadı</strong><span>{emptyMessage}</span></div>
  return <div className="admin-users-list"><div className="admin-table-head" aria-hidden="true"><span>Kullanıcı</span><span>Rol</span><span>Hesap durumu</span><span>E-posta</span><span>2FA</span><span>Son güncelleme</span></div>{users.map((u) => { const status = accountStatusBadge(u); return <button type="button" className={`admin-user-row ${selectedId === u.id ? 'is-selected' : ''}`} key={u.id} onClick={() => onSelect(u.id)} aria-label={`${u.username} kullanıcısının detayını aç`}>
    <span className="admin-user-identity"><strong>{u.username} {u.id === currentUserId && <Badge tone="info">Siz</Badge>}</strong><small>{u.email || 'E-posta yok'}</small></span>
    <span data-label="Rol"><Badge tone={isAdministrativeRole(u.role) ? 'purple' : ''}>{u.role || 'Atanmamış'}</Badge></span><span data-label="Hesap durumu"><Badge tone={status.tone}>{status.label}</Badge></span><span data-label="E-posta"><Badge tone={u.emailConfirmed ? 'success' : 'warning'}>{u.emailConfirmed ? 'Doğrulandı' : 'Doğrulanmadı'}</Badge></span><span data-label="2FA"><Badge tone={u.twoFactorEnabled ? 'success' : 'warning'}>{mfaLabel(u)}</Badge></span><span data-label="Son güncelleme" className="admin-user-date">{new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(u.modifiedDate))}</span>
  </button> })}</div>
}
