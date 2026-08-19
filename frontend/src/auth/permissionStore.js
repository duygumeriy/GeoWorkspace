import { createContext, useContext } from 'react'

/**
 * Yetki bağlamının kimliği ve okuyucusu.
 *
 * Sağlayıcıdan AYRI bir dosyadadır: bir modül hem bileşen hem de bileşen
 * olmayan şeyler dışa aktardığında Fast Refresh o modülü sıcak yenileyemez ve
 * her düzenlemede tüm ağaç yeniden mount olur — yetki durumu da onunla birlikte
 * sıfırlanırdı. Sağlayıcı `PermissionContext.jsx`'te, bağlam ile kanca burada.
 */
export const PermissionContext = createContext(null)

/**
 * Merkezî yetki durumuna erişim.
 *
 * `can(code)` TAM kod eşleşmesidir; hiyerarşi, ima kuralı ve rol adı yoktur.
 * Yetkiler yüklenene kadar her kod için `false` döner (fail-closed).
 */
export function usePermissions() {
  const ctx = useContext(PermissionContext)
  if (!ctx) {
    throw new Error('usePermissions must be used within a PermissionProvider')
  }
  return ctx
}
