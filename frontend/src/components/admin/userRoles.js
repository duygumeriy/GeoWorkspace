/**
 * The role options above the user list.
 *
 * Derived from the loaded users, NOT from `GET /api/admin/users/roles`. Those
 * are two different questions: that endpoint answers "which roles may I assign
 * right now", which is actor-specific and deliberately narrower — a role the
 * current admin cannot grant may still be worn by someone in the list, and
 * filtering it away would hide real rows. This is a filter over data already on
 * screen, so it needs no request of its own.
 */

/**
 * Preferred order for the roles the system ships with: the legacy bridge first,
 * then the target profiles in their own progression. Roles the administrator
 * defined later are unknown here by definition and fall in alphabetically after
 * these.
 */
const KNOWN_ROLE_ORDER = [
  'Admin',
  'User',
  'Viewer',
  'GIS Editor',
  'GIS Analyst',
  'GIS Manager',
  'Administrator',
]

/**
 * Distinct roles actually present in the loaded users, in a stable order.
 *
 * Nothing is fabricated: a role nobody holds is not offered, because selecting
 * it could only ever produce an empty list. That also means a custom role
 * appears here the moment one user has it, with no change to this file.
 *
 * @param {Array<{ role?: string|null }>} users
 * @returns {string[]}
 */
export function roleFilterOptions(users) {
  const present = new Set()

  for (const user of users ?? []) {
    /* Rolsüz hesaplar (onay bekleyenler) atlanır: `null` bir rol değildir ve
       seçenek olarak sunulsa boş etiketli, seçilince hiçbir şey filtrelemeyen
       bozuk bir satır olurdu. */
    const role = typeof user?.role === 'string' ? user.role.trim() : ''
    if (role) present.add(role)
  }

  return [...present].sort((a, b) => {
    const left = KNOWN_ROLE_ORDER.indexOf(a)
    const right = KNOWN_ROLE_ORDER.indexOf(b)

    // Both known: ship order. One known: it leads. Neither: alphabetical.
    if (left !== -1 && right !== -1) return left - right
    if (left !== -1) return -1
    if (right !== -1) return 1
    return a.localeCompare(b, 'tr-TR')
  })
}
