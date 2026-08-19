import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchMyGeographicScope, readApiError } from '../services/api.js'
import { parseScope } from '../map/geographicScope.js'

/**
 * Çağıranın KENDİ yürürlükteki coğrafi sınırı.
 *
 * <b>Kapsam CANLI durumdur.</b> JWT'ye yazılmaz ve oturum boyunca
 * önbelleklenmiş bir gerçek gibi tutulmaz: yönetici bir alanı daralttığında,
 * kullanıcının yeniden giriş yapması gerekmemelidir. Bu yüzden hook bir
 * <c>refresh</c> döndürür ve sunucudan coğrafi bir ret geldiğinde çağrılır.
 *
 * <b>"Bilinmiyor" ile "kısıt yok" AYRI şeylerdir.</b> İstek başarısız olursa
 * <c>isRestricted</c> false'a düşmez ve <c>failed</c> true olur. Hata durumunu
 * kısıtsızlık saymak, sınırı olan bir kullanıcıya haritada hiçbir sınır
 * göstermemek — ve onu, sunucunun reddedeceği bir çizimi bitirmeye davet
 * etmek — olurdu.
 *
 * <b>Bu bir güvenlik sınırı DEĞİLDİR.</b> Uç hiç çağrılmasa bile çizim uçları
 * kendi coğrafi denetimini aynen uygular. Buradaki veri yalnızca haritanın
 * sınırı gösterebilmesi ve izinsiz bir çizimi başlamadan durdurabilmesi
 * içindir.
 */
export default function useGeographicScope({ enabled = true } = {}) {
  const [state, setState] = useState({
    loading: enabled,
    failed: false,
    isRestricted: false,
    effectiveWkt: null,
    areaCount: 0,
  })

  /* Aynı anda birden çok tazeleme isteği açılmaz. Coğrafi bir 403 art arda
     birkaç kez gelebilir (toplu işlem, hızlı tıklama); her biri için ayrı bir
     istek açmak sonsuz bir tazeleme döngüsüne dönüşebilirdi. */
  const inFlight = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const refresh = useCallback(async () => {
    if (!enabled || inFlight.current) return
    inFlight.current = true

    try {
      const res = await fetchMyGeographicScope()
      if (!res.ok) throw new Error(await readApiError(res, 'Coğrafi yetki alanı okunamadı.'))

      const body = await res.json()
      if (!mounted.current) return

      setState({
        loading: false,
        failed: false,
        isRestricted: body.isRestricted === true,
        effectiveWkt: body.effectiveWkt ?? null,
        areaCount: body.areaCount ?? 0,
      })
    } catch {
      if (!mounted.current) return
      /* Sessiz başarısızlık: kullanıcıya gösterilecek bir eylem yok ve çizim
         yolu zaten sunucu tarafından korunuyor. Ama durum "kısıtsız" diye
         KAYDEDİLMEZ. */
      setState((current) => ({ ...current, loading: false, failed: true }))
    } finally {
      inFlight.current = false
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) {
      setState({ loading: false, failed: false, isRestricted: false, effectiveWkt: null, areaCount: 0 })
      return
    }
    refresh()
  }, [enabled, refresh])

  /* Ayrıştırma WKT değiştiğinde BİR kez yapılır. Her tıklamada yeniden
     ayrıştırmak, çizim sırasında her köşe için poligonu baştan okumak olurdu. */
  const scope = useMemo(
    () => (state.isRestricted ? parseScope(state.effectiveWkt) : null),
    [state.isRestricted, state.effectiveWkt],
  )

  return { ...state, scope, refresh }
}
