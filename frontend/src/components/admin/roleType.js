/**
 * A role's visual classification.
 *
 * The decision is the SERVER'S: `isLegacy` / `isSystem` come from the response,
 * which derives them from the backend's own RoleCatalog. Nothing here compares
 * role names. Re-deriving "is this Admin?" in the browser would create a second
 * rulebook that silently disagrees with the first the day a role is added.
 */
const ROLE_TYPES = {
  legacy: {
    label: 'Legacy',
    tone: 'legacy',
    summary: 'Geçiş dönemi rolü. Mevcut kullanıcılarla geriye dönük uyumluluk için korunur; yeni atamalara kapalıdır.',
  },
  system: {
    label: 'Sistem',
    tone: 'system',
    summary: 'Sistem rolü. Adı ve varlığı korunur; yetkileri yönetilebilir.',
  },
  custom: {
    label: 'Özel',
    tone: 'custom',
    summary: 'Yöneticinin tanımladığı rol. Yeniden adlandırılabilir ve silinebilir.',
  },
}

/**
 * @param {{ isLegacy?: boolean, isSystem?: boolean }} role
 * @returns {{ key: 'legacy'|'system'|'custom', label: string, tone: string, summary: string }}
 */
export function roleType(role) {
  /* Sıra önemli: legacy roller sunucuda AYNI ZAMANDA isSystem'dir (ikisi de
     korunur). Önce legacy sorulmazsa Admin/User "Sistem" görünür ve geçiş
     dönemine ait oldukları bilgisi kaybolurdu. */
  const key = role?.isLegacy ? 'legacy' : role?.isSystem ? 'system' : 'custom'
  return { key, ...ROLE_TYPES[key] }
}
