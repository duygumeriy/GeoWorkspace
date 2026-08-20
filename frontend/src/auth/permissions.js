/**
 * Client-side permission helpers.
 *
 * These exist ONLY to shape the UI — to hide or disable controls that would
 * fail anyway. They are not security. The backend re-derives ownership from
 * the verified JWT and the row's own `CreatedByUserId` on every mutation and
 * answers 403 regardless of what the browser decided, so tampering with
 * client state buys nothing.
 */

/**
 * Can the current user edit or delete this drawing?
 *
 * Mirrors the backend rule exactly: Administrator, or the drawing's owner.
 *
 * @param {{ isAdmin?: boolean, userId?: number|null }} user from useAuth()
 * @param {{ createdByUserId?: number }|null|undefined} drawing
 */
export function canManageDrawing(user, drawing) {
  if (!user || !drawing) return false
  if (user.isAdmin) return true
  return user.userId != null && drawing.createdByUserId === user.userId
}

/**
 * True when every drawing in the selection is manageable — bulk style/delete
 * is all-or-nothing on the backend, so a mixed selection must not offer it.
 *
 * @param {{ isAdmin?: boolean, userId?: number|null }} user
 * @param {Array<{ createdByUserId?: number }>} drawings
 */
export function canManageAll(user, drawings) {
  if (!drawings?.length) return false
  return drawings.every((drawing) => canManageDrawing(user, drawing))
}
