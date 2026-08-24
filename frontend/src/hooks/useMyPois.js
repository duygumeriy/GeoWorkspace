import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchOwnPois, readApiError } from '../services/api.js'

/**
 * "POI'lerim" verisi: çağıranın KENDİ aktif POI'leri.
 *
 * <b>Kapsamı SUNUCU belirler.</b> Liste `GET /api/poi/mine`ten gelir ve
 * sahiplik yüklemi SQL'dedir. Haritanın ortak listesini (`GET /api/poi`)
 * tarayıcıda süzmek mümkün değildir ve olmamalıdır: o sözleşme kaydın sahibini
 * bilinçli olarak taşımaz, dolayısıyla "benimkiler" ancak sunucuya sorularak
 * yanıtlanabilir. `canUpdate` / `canDelete` bayrakları da sahiplik ölçüsü
 * DEĞİLDİR — `poi.manage` taşıyan biri onları yabancı kayıtlarda da taşır.
 *
 * <b>Yalnızca panel açıkken okunur.</b> Çöp Kutusu'yla aynı ilke: kapalı bir
 * panel hiçbir istek açmaz, açıldığında ise liste tazelenir — POI ekleme ve
 * silme uygulama açıkken sürer ve panelin doğruyu göstermesi buna bağlıdır.
 *
 * @param {{ active: boolean, permitted: boolean }} deps
 */
export default function useMyPois({ active, permitted }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  /** Non-null when the last load failed; drives the panel's error state. */
  const [error, setError] = useState(null)

  /* Her okuma bir jeton taşır: kapatılmış bir panelin ya da eskiyen bir
     "Tekrar Dene"nin geç gelen cevabı taze durumu ezmez. */
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    if (!permitted) return false

    const token = (requestRef.current += 1)
    setLoading(true)
    setError(null)

    try {
      const res = await fetchOwnPois()
      if (!res.ok) throw new Error(await readApiError(res, 'POI kayıtlarınız yüklenemedi'))

      const body = await res.json()
      if (token !== requestRef.current) return false

      setItems(Array.isArray(body) ? body : [])
      return true
    } catch (loadError) {
      if (token !== requestRef.current) return false
      // Panelin hatası haritayı düşürmez; kendi hata durumunda kalır.
      setError(loadError?.message || 'POI kayıtlarınız yüklenemedi.')
      return false
    } finally {
      if (token === requestRef.current) setLoading(false)
    }
  }, [permitted])

  useEffect(() => {
    if (!active || !permitted) return
    load()
  }, [active, permitted, load])

  /* Yetki CANLIDIR: `poi.view` alındığında elde kalan kayıtlar temizlenir —
     korumalı veri, panel kapanana kadar ekranda unutulmaz. */
  useEffect(() => {
    if (permitted) return
    requestRef.current += 1
    setItems([])
    setError(null)
    setLoading(false)
  }, [permitted])

  /**
   * Bir kaydı yerinde tazeler (düzenleme sonrası) — listeyi baştan okumadan.
   * Sunucu yanıtı kaydın kanonik hâlidir.
   */
  const replace = useCallback((poi) => {
    if (!poi?.id) return
    setItems((current) => current.map((item) => (item.id === poi.id ? poi : item)))
  }, [])

  /** Soft-delete edilen kaydı listeden düşürür; satır veritabanında durur. */
  const remove = useCallback((id) => {
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  /** Yeni oluşturulan ya da geri yüklenen kayıt listeye döner. */
  const add = useCallback((poi) => {
    if (!poi?.id) return
    setItems((current) => (current.some((item) => item.id === poi.id) ? current : [...current, poi]))
  }, [])

  return { items, loading, error, reload: load, replace, remove, add }
}
