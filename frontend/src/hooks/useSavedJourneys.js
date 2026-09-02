import { useCallback, useEffect, useRef, useState } from 'react'
import { readApiError } from '../services/api.js'
import {
  createSavedJourney,
  deleteSavedJourney,
  fetchSavedJourney,
  fetchSavedJourneys,
  reuseSavedJourney,
  updateSavedJourney,
} from '../services/transportApi.js'
import {
  SAVED_JOURNEY_MESSAGES,
  savedJourneyErrorMessage,
  savedJourneyList,
  validateSavedJourneyName,
} from '../map/savedJourneys.js'

/**
 * Kaydedilmiş kişisel yolculukların REST durumu.
 *
 * <b><code>useJourneySimulation</code> ile BİRLEŞTİRİLMEZ.</b> O kanca canlı
 * bir çalıştırmanın sahibidir: SignalR bağlantısı kurar, gruba katılır, anlık
 * görüntü uygular ve kamera hakkı taşır. Buradaki veri ise SIRADAN kalıcı
 * kayıttır. İkisini tek kancada toplamak, bir liste yenilemesinin canlı
 * durumu ezmesine ya da bir kaydın ikinci bir canlı kanal açmasına kapı
 * aralardı — <b>ikinci bir kişisel SignalR istemcisi bu fazda AÇILMAZ.</b>
 *
 * <b>Yoklama YOKTUR.</b> Hiçbir zamanlayıcı, hiçbir aralık kurulmaz: veri
 * yalnızca kullanıcının kendi eylemleriyle değişir, dolayısıyla yalnızca
 * bölüm açıldığında ve kendi mutasyonlarımızdan sonra okunur.
 *
 * <b>LocalStorage OTORİTE DEĞİLDİR</b> ve hiç kullanılmaz: kayıtlar
 * sunucudadır; tarayıcıda bir kopya tutmak, iki cihazda iki farklı "kayıtlı
 * yolculuk listesi" demekti.
 *
 * <b>Kimlik DONDURULUR.</b> Her mutasyon kendisine verilen kimlikle çalışır ve
 * eylem çözüldüğünde seçili olan kayda BAKMAZ: A seçiliyken başlatılan bir
 * silme, sonradan B seçilse bile A'yı siler.
 *
 * @param {{ permitted?: boolean, enabled?: boolean }} [options]
 */
export default function useSavedJourneys({ permitted = false, enabled = false } = {}) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [loaded, setLoaded] = useState(false)

  /* Sürüm sayacı: geç gelen bir liste cevabı, daha yeni bir okumanın sonucunu
     EZEMEZ. Bu, mutasyon sonrası yenilemelerle açılış okumasının yarıştığı
     durumda gerekir. */
  const requestIdRef = useRef(0)
  const disposedRef = useRef(false)

  useEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!permitted) return

    requestIdRef.current += 1
    const requestId = requestIdRef.current

    setLoading(true)
    setError('')

    try {
      const response = await fetchSavedJourneys()
      if (disposedRef.current || requestId !== requestIdRef.current) return

      if (!response.ok) {
        setError(savedJourneyErrorMessage(
          response.status,
          await readApiError(response, ''),
          SAVED_JOURNEY_MESSAGES.loadFailed,
        ))
        return
      }

      const body = await response.json()
      if (disposedRef.current || requestId !== requestIdRef.current) return

      setItems(savedJourneyList(body))
      setLoaded(true)
    } catch {
      if (!disposedRef.current && requestId === requestIdRef.current) {
        setError(SAVED_JOURNEY_MESSAGES.loadFailed)
      }
    } finally {
      if (!disposedRef.current && requestId === requestIdRef.current) setLoading(false)
    }
  }, [permitted])

  /* Liste bölüm AÇILDIĞINDA okunur — panel kapalıyken değil. Yetkisi olmayan
     birine garanti 403 alacak bir istek gönderilmez. */
  useEffect(() => {
    if (!permitted || !enabled) return
    refresh()
  }, [permitted, enabled, refresh])

  /**
   * Planlanan yolculuğu kaydeder.
   *
   * Simülasyon BAŞLATMAZ, `simulationId` değiştirmez, kamerayı oynatmaz ve
   * paylaşılan durumu tanımaz — yalnızca tanımı saklar.
   */
  const save = useCallback(async ({ name, journey, isFavorite = false }) => {
    if (!permitted) return null

    const validated = validateSavedJourneyName(name)
    if (!validated.ok) {
      setError(validated.error)
      return null
    }

    if (!journey) {
      setError(SAVED_JOURNEY_MESSAGES.saveFailed)
      return null
    }

    setSaving(true)
    setError('')

    try {
      const response = await createSavedJourney({ name: validated.name, isFavorite, journey })

      if (!response.ok) {
        setError(savedJourneyErrorMessage(
          response.status,
          await readApiError(response, ''),
          SAVED_JOURNEY_MESSAGES.saveFailed,
        ))
        return null
      }

      const body = await response.json()
      await refresh()
      return body
    } catch {
      setError(SAVED_JOURNEY_MESSAGES.saveFailed)
      return null
    } finally {
      if (!disposedRef.current) setSaving(false)
    }
  }, [permitted, refresh])

  /**
   * Tek bir kayıt üzerinde çalışan mutasyonların ORTAK gövdesi.
   *
   * Kimlik parametredir ve kapanışta dondurulur: eylem çözüldüğünde hangi
   * satırın seçili olduğunun hiçbir önemi yoktur.
   */
  const mutate = useCallback(async (savedJourneyId, run, fallback) => {
    if (!permitted || savedJourneyId == null) return null

    const id = Number(savedJourneyId)

    setBusyId(id)
    setError('')

    try {
      const response = await run(id)

      if (!response.ok) {
        setError(savedJourneyErrorMessage(response.status, await readApiError(response, ''), fallback))
        return null
      }

      // 204 gövdesiz olabilir; okunamayan gövde bir hata değildir.
      const body = await response.json().catch(() => null)
      await refresh()
      return body ?? true
    } catch {
      setError(fallback)
      return null
    } finally {
      if (!disposedRef.current) setBusyId(null)
    }
  }, [permitted, refresh])

  const rename = useCallback((savedJourneyId, name) => {
    const validated = validateSavedJourneyName(name)
    if (!validated.ok) {
      setError(validated.error)
      return Promise.resolve(null)
    }

    return mutate(
      savedJourneyId,
      (id) => updateSavedJourney(id, { name: validated.name }),
      SAVED_JOURNEY_MESSAGES.saveFailed,
    )
  }, [mutate])

  /* Yıldız DEĞER olarak gönderilir: sunucuda "tersine çevir" yoktur, çünkü iki
     hızlı tıklama ya da geç gelen bir cevap yıldızı kullanıcının görmediği bir
     duruma çevirebilirdi. */
  const setFavorite = useCallback((savedJourneyId, isFavorite) => mutate(
    savedJourneyId,
    (id) => updateSavedJourney(id, { isFavorite: Boolean(isFavorite) }),
    SAVED_JOURNEY_MESSAGES.saveFailed,
  ), [mutate])

  const remove = useCallback((savedJourneyId) => mutate(
    savedJourneyId,
    (id) => deleteSavedJourney(id),
    SAVED_JOURNEY_MESSAGES.saveFailed,
  ), [mutate])

  /**
   * Tek kaydın TAM tanımını okur (planlayıcıya yüklemek için).
   *
   * Hiçbir simülasyon başlatmaz: yükleme ile başlatma AYRI kararlardır.
   */
  const load = useCallback(async (savedJourneyId) => {
    if (!permitted || savedJourneyId == null) return null

    const id = Number(savedJourneyId)
    setBusyId(id)
    setError('')

    try {
      const response = await fetchSavedJourney(id)

      if (!response.ok) {
        setError(savedJourneyErrorMessage(
          response.status,
          await readApiError(response, ''),
          SAVED_JOURNEY_MESSAGES.notFound,
        ))
        return null
      }

      return await response.json()
    } catch {
      setError(SAVED_JOURNEY_MESSAGES.notFound)
      return null
    } finally {
      if (!disposedRef.current) setBusyId(null)
    }
  }, [permitted])

  /**
   * Kayıttan YENİ bir çalıştırma ister ve sunucunun yanıtını GERİ VERİR.
   *
   * <b>Benimseme burada YAPILMAZ.</b> Canlı durumun ve tek SignalR kanalının
   * sahibi `useJourneySimulation`'dır; yanıtı ona vermek, bu kancanın ikinci
   * bir canlı durum ya da ikinci bir bağlantı kurmasını yapısal olarak
   * imkânsız kılar.
   *
   * Eski çalıştırma diriltilmez: yanıt her çağrıda yeni bir `simulationId`
   * taşır ve güzergah sunucuda yeniden hesaplanır.
   */
  const reuse = useCallback(async (savedJourneyId) => {
    if (!permitted || savedJourneyId == null) return null

    const id = Number(savedJourneyId)
    setBusyId(id)
    setError('')

    try {
      const response = await reuseSavedJourney(id)

      if (!response.ok) {
        /* 404 ve 409 kullanıcının KENDİ kaydıyla ilgilidir ve sunucunun metni
           hangi noktanın çözülemediğini söyler; ham gövde gösterilmez, güvenli
           sözleşme metni gösterilir. */
        setError(savedJourneyErrorMessage(
          response.status,
          await readApiError(response, ''),
          SAVED_JOURNEY_MESSAGES.reuseFailed,
        ))
        return null
      }

      return await response.json()
    } catch {
      setError(SAVED_JOURNEY_MESSAGES.reuseFailed)
      return null
    } finally {
      if (!disposedRef.current) setBusyId(null)
    }
  }, [permitted])

  return {
    items,
    loading,
    loaded,
    error,
    saving,
    busyId,
    clearError: useCallback(() => setError(''), []),
    refresh,
    save,
    rename,
    setFavorite,
    remove,
    load,
    reuse,
  }
}
