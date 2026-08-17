/**
 * The password policy the BACKEND actually enforces.
 *
 * Mirrors `AddIdentityCore` in `StajProject.Api/Program.cs`:
 *
 *   RequiredLength      = 8
 *   RequireUppercase    = true
 *   RequireLowercase    = true
 *   RequireDigit        = true
 *   RequireNonAlphanumeric = false   <- deliberately NOT required
 *   RequiredUniqueChars = 1          <- satisfied by any non-empty password
 *
 * Nothing is invented here. A frontend checklist that asked for a symbol would
 * block passwords the server accepts; one that asked for less would let the
 * user submit something the server rejects with a generic error. Identity stays
 * the authority — this list only lets the user see the same rules while typing,
 * and the server still validates every submission.
 */

export const PASSWORD_RULES = Object.freeze([
  { id: 'length', label: 'En az 8 karakter', test: (value) => value.length >= 8 },
  { id: 'uppercase', label: 'En az bir büyük harf', test: (value) => /\p{Lu}/u.test(value) },
  { id: 'lowercase', label: 'En az bir küçük harf', test: (value) => /\p{Ll}/u.test(value) },
  { id: 'digit', label: 'En az bir rakam', test: (value) => /\d/.test(value) },
])

/**
 * Evaluates every rule against a candidate password.
 *
 * @param {string} value
 * @returns {Array<{ id: string, label: string, met: boolean }>}
 */
export function evaluatePassword(value) {
  const password = value ?? ''
  return PASSWORD_RULES.map(({ id, label, test }) => ({ id, label, met: test(password) }))
}

/** True when the candidate satisfies every rule Identity enforces. */
export function isPasswordValid(value) {
  const password = value ?? ''
  return PASSWORD_RULES.every((rule) => rule.test(password))
}
