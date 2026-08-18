import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchAdminRolePermissions,
  readApiError,
  updateAdminRolePermissions,
} from '../services/api.js'
import { assignedActiveCodes, sameSet } from '../components/admin/rolePermissions.js'

/**
 * Bir rolün yetki matrisinin durumu: yükleme, çalışma seçimi, kirli durum ve
 * kaydetme.
 *
 * Tek kaynak `GET /api/admin/roles/{id}/permissions`'tır. Yanıt hem kataloğun
 * tamamını hem de o roldeki işaretlilik durumunu taşıdığı için katalog ayrıca
 * çekilmez; iki listeyi tarayıcıda eşleştirmek, sunucunun zaten yaptığı işi
 * ikinci bir doğruluk kaynağıyla tekrarlamak olurdu.
 *
 * İstek YALNIZCA bir rol seçiliyken açılır. Liste ekranı rol başına yetki
 * okumaz — 30 rollük bir kurulumda bu, açılışta 30 istek demek olurdu.
 */
export function useRolePermissions(roleId) {
  const [permissions, setPermissions] = useState([])
  const [baseline, setBaseline] = useState(() => new Set())
  const [selected, setSelected] = useState(() => new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  /* Yarışan yanıtlara karşı sıra numarası. Rol hızla değiştirildiğinde önceki
     rolün geç gelen yanıtı, yeni seçilenin matrisini EZERDİ — ve ekran, başka
     bir rolün yetkilerini bu rolünmüş gibi gösterirdi. */
  const requestId = useRef(0)

  const load = useCallback(async () => {
    if (roleId === null || roleId === undefined) return
    const ticket = ++requestId.current

    setLoading(true); setError(''); setSaveError('')
    try {
      const res = await fetchAdminRolePermissions(roleId)
      if (ticket !== requestId.current) return
      if (!res.ok) {
        throw new Error(res.status === 403
          ? 'Bu rolün yetkilerini görüntülemek için gerekli izne sahip değilsiniz.'
          : await readApiError(res, 'Rol yetkileri yüklenemedi.'))
      }

      const body = await res.json()
      if (ticket !== requestId.current) return

      const rows = body?.permissions ?? []
      const assigned = assignedActiveCodes(rows)
      setPermissions(rows)
      setBaseline(assigned)
      // Açılışta çalışma seçimi sunucunun durumudur; kirli DEĞİLDİR.
      setSelected(new Set(assigned))
    } catch (err) {
      if (ticket !== requestId.current) return
      setPermissions([]); setBaseline(new Set()); setSelected(new Set())
      setError(err.message || 'Rol yetkileri yüklenemedi.')
    } finally {
      if (ticket === requestId.current) setLoading(false)
    }
  }, [roleId])

  useEffect(() => {
    /* Rol değiştiğinde önceki matris ANINDA bırakılır. Yeni yanıt gelene kadar
       eski satırları göstermek, bir rolün yetkilerini başka bir rolün altında
       göstermek olurdu. */
    requestId.current++
    setPermissions([]); setBaseline(new Set()); setSelected(new Set())
    setError(''); setSaveError('')

    if (roleId === null || roleId === undefined) { setLoading(false); return }
    load()
  }, [roleId, load])

  const dirty = useMemo(() => !sameSet(selected, baseline), [selected, baseline])

  const toggle = useCallback((code) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }, [])

  /**
   * Bir kategorinin tamamını işaretler veya kaldırır.
   *
   * Yalnızca gerçekten seçilebilir satırlara dokunur: pasif yetkiler kümeye hiç
   * girmez, dolayısıyla "tümünü seç" onları yeni bir atamaya dönüştüremez.
   */
  const setCategorySelection = useCallback((codes, next) => {
    setSelected((current) => {
      const updated = new Set(current)
      for (const code of codes) {
        if (next) updated.add(code)
        else updated.delete(code)
      }
      return updated
    })
  }, [])

  /** Son sunucu durumuna döner. İstek AÇILMAZ — geri alma yerel bir işlemdir. */
  const reset = useCallback(() => {
    setSelected(new Set(baseline))
    setSaveError('')
  }, [baseline])

  /**
   * Hedef kümeyi gönderir ve YANITI bekler.
   *
   * İyimser güncelleme yoktur: yetki değişikliği bir güvenlik kararıdır ve
   * sunucu onaylamadan olmuş gibi gösterilemez. Başarısızlıkta seçim OLDUĞU
   * GİBİ kalır ve kirli durum sürer, böylece kişi ya tekrar dener ya geri alır.
   *
   * @returns {Promise<null | object>} başarıda sunucunun döndüğü güncel rol
   */
  const save = useCallback(async () => {
    if (saving) return null
    setSaving(true); setSaveError('')
    try {
      const res = await updateAdminRolePermissions(roleId, [...selected])
      if (!res.ok) {
        throw new Error(res.status === 403
          ? 'Bu rolün yetkilerini değiştirmek için gerekli izne sahip değilsiniz.'
          : await readApiError(res, 'Yetkiler kaydedilemedi.'))
      }

      /* Yanıt matrisin YENİ hâlini ve rolün güncel sayımlarını taşır; ikinci bir
         okuma gerekmez. Temel küme sunucunun söylediğinden kurulur, tarayıcının
         gönderdiğinden değil — pasif bağların korunması gibi sunucu tarafı
         kurallar ancak böyle görünür. */
      const body = await res.json()
      const rows = body?.permissions ?? []
      const assigned = assignedActiveCodes(rows)
      setPermissions(rows)
      setBaseline(assigned)
      setSelected(new Set(assigned))
      return body?.role ?? null
    } catch (err) {
      setSaveError(err.message || 'Yetkiler kaydedilemedi.')
      return null
    } finally {
      setSaving(false)
    }
  }, [roleId, selected, saving])

  return {
    permissions,
    selected,
    loading,
    error,
    saving,
    saveError,
    dirty,
    reload: load,
    toggle,
    setCategorySelection,
    reset,
    save,
    dismissSaveError: useCallback(() => setSaveError(''), []),
  }
}
