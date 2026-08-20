export const ADMINISTRATIVE_ROLES = Object.freeze(['Administrator'])

export function isAdministrativeRole(role) {
  return ADMINISTRATIVE_ROLES.includes(role)
}
