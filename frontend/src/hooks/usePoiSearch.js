import { useCallback, useEffect, useRef, useState } from 'react'
import { POI_SEARCH_LIMITS, readApiError, searchPois } from '../services/api.js'

/** Bir tuş vuruşu değil, bir DURAKLAMA arama başlatır. */
export const POI_SEARCH_DEBOUNCE_MS = 280

/**
 * POI arama durumu: kısa sorguyu eler, gecikmeli sorar, eskiyeni iptal eder.
 *
 * <b>Neden ayrı bir kanca.</b> Aynı üç kural (en az iki karakter, gecikme,
 * eskiyenin kazanamaması) bileşenin içine gömülseydi, ne testten ne de gözden
 * geçirmeden geçebilirdi: hepsi zamanlamaya bağlıdır ve bir DOM'a ihtiyaç
 * duymazlar.
 *
 * <b>Eski cevap yeniyi EZEMEZ.</b> İki koruma birden vardır ve ikisi de
 * gereklidir: `AbortController` uçan isteği iptal eder, istek sayacı ise
 * iptalden ÖNCE yola çıkmış bir cevabın geç gelip sonucu geri sarmasını
 * engeller. Yalnızca birine güvenmek, hızlı yazan bir kullanıcıda yanlış
 * listeyi ekranda bırakabilirdi.
 *
 * <b>Yetki yoksa hiçbir şey sorulmaz.</b> Garanti 403 alacak istekleri
 * döngüye sokmanın anlamı yok — aynı ilke POI raster katmanında da geçerli.
 *
 * @param {{ enabled: boolean, query: string }} options
 */
export default function usePoiSearch({ enabled, query }) {
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  /** İlk arama tamamlandı mı — "henüz sormadım" ile "sordum, yok"u ayırır. */
  const [searched, setSearched] = useState(false)

  const controllerRef = useRef(null)
  const requestIdRef = useRef(0)

  const reset = useCallback(() => {
    requestIdRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    setResults([])
    setLoading(false)
    setError('')
    setSearched(false)
  }, [])

  useEffect(() => {
    const term = query.trim()

    /* İki karakterden kısa sorgu İSTEK AÇMAZ: sunucu da onu reddeder,
       dolayısıyla göndermek garanti bir 400'e davet olurdu. */
    if (!enabled || term.length < POI_SEARCH_LIMITS.minQueryLength) {
      reset()
      return undefined
    }

    setLoading(true)
    setError('')

    const timer = window.setTimeout(async () => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller

      requestIdRef.current += 1
      const requestId = requestIdRef.current

      try {
        const response = await searchPois({ query: term, signal: controller.signal })

        // Sayaç: iptalden önce yola çıkmış bir cevap da eskiyse yazılamaz.
        if (requestId !== requestIdRef.current) return

        if (!response.ok) throw new Error(await readApiError(response, 'Arama yapılamadı.'))

        const payload = await response.json()
        if (requestId !== requestIdRef.current) return

        setResults(Array.isArray(payload) ? payload : [])
        setSearched(true)
      } catch (searchError) {
        // İptal bir yaşam döngüsü olayıdır, bir hata değil.
        if (searchError?.name === 'AbortError') return
        if (requestId !== requestIdRef.current) return

        /* Hata haritayı DÜŞÜRMEZ: liste boşalır, küçük bir mesaj gösterilir ve
           otomatik yeniden deneme YAPILMAZ — sonsuz döngüye dönüşebilirdi. */
        setResults([])
        setSearched(true)
        setError(searchError.message || 'Arama yapılamadı.')
      } finally {
        if (requestId === requestIdRef.current) setLoading(false)
      }
    }, POI_SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [enabled, query, reset])

  /* Bileşen kalktığında uçan istek de gider: kaldırılmış bir bileşene state
     yazmak React uyarısı ve boşuna bir ağ isteğidir. */
  useEffect(() => () => {
    requestIdRef.current += 1
    controllerRef.current?.abort()
  }, [])

  return { results, loading, error, searched, reset }
}
