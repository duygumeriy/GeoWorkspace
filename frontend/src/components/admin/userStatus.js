import { isAdministrativeRole } from '../../auth/roles.js'

export function mfaLabel(user) {
  if (isAdministrativeRole(user.role)) {
    return user.twoFactorEnabled ? 'Etkin / Zorunlu' : 'Kurulum Bekliyor'
  }
  return user.twoFactorEnabled ? 'Etkin' : 'Kapalı'
}

/**
 * Turkish label and badge tone for each account state.
 *
 * The backend sends the enum name (`PendingApproval`); it is a wire value, not
 * something a user should ever read. This table is the single place the two
 * vocabularies meet, so the list, the drawer and the filter cannot describe the
 * same account differently.
 */
const ACCOUNT_STATUS = {
  PendingEmailVerification: { label: 'E-posta Bekleniyor', tone: 'warning' },
  PendingApproval: { label: 'Onay Bekliyor', tone: 'warning' },
  Active: { label: 'Aktif', tone: 'success' },
  Suspended: { label: 'Askıya Alındı', tone: 'danger' },
  Rejected: { label: 'Reddedildi', tone: 'danger' },
}

/** Falls back to the legacy active/passive reading if a state is ever unknown. */
export function accountStatusBadge(user) {
  return (
    ACCOUNT_STATUS[user.accountStatus] ??
    (user.isActive ? ACCOUNT_STATUS.Active : ACCOUNT_STATUS.Suspended)
  )
}

export function isPendingApproval(user) {
  return user?.accountStatus === 'PendingApproval'
}

/** The filter options above the list, in lifecycle order. */
export const STATUS_FILTERS = [
  { value: 'All', label: 'Tümü' },
  { value: 'Active', label: 'Aktif' },
  { value: 'PendingApproval', label: 'Onay Bekleyen' },
  { value: 'PendingEmailVerification', label: 'E-posta Bekleyen' },
  { value: 'Suspended', label: 'Pasif' },
  { value: 'Rejected', label: 'Reddedilen' },
]
