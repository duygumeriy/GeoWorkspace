export const ADMINISTRATIVE_ROLES = Object.freeze(['Admin', 'Administrator'])

export function isAdministrativeRole(role) {
  return ADMINISTRATIVE_ROLES.includes(role)
}
