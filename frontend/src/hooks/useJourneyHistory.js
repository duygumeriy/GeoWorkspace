import { useCallback, useEffect, useRef, useState } from 'react'
import { readApiError } from '../services/api.js'
import {
  fetchJourneyHistory,
  fetchJourneyHistoryDetail,
  reuseJourneyHistory,
} from '../services/transportApi.js'
import {
  JOURNEY_HISTORY_MESSAGES,
  historyFilterStatus,
  journeyHistoryDetail,
  journeyHistoryErrorMessage,
  journeyHistoryPage,
} from '../map/journeyHistory.js'

/** Sunucunun varsayılanıyla aynı sayfa boyutu; ikinci bir sınır uydurulmaz. */
const PAGE_SIZE = 20

/**
 * Kişisel yolculuk geçmişinin REST durumu.
 *
 * <b><code>useJourneySimulation</code> ile BİRLEŞTİRİLMEZ.</b> O kanca CANLI
 * bir çalıştırmanın sahibidir: SignalR bağlantısı kurar, gruba katılır, anlık
 * görüntü uygular ve kamera hakkı taşır. Buradaki veri ise sona ermiş
 * yolculukların tutanağıdır ve bir daha değişmez. İkisini tek kancada
 * toplamak, bir liste yenilemesinin canlı durumu ezmesine ya da bir tutanağın
 * ikinci bir canlı kanal açmasına kapı aralardı — <b>ikinci bir kişisel
 * SignalR istemcisi bu fazda da AÇILMAZ.</b>
 *
 * <b><code>useSavedJourneys</code> ile de birleştirilmez.</b> Kaydedilmiş
 * yolculuk yeniden kullanılabilir bir NİYETTİR ve kullanıcı onu adlandırır,
 * siler; geçmiş ise olmuş bir şeyin kaydıdır. Bu kancada ad, favori ya da
 * silme eylemi YOKTUR ve olmamalıdır.
 *
 * <b>Yoklama YOKTUR.</b> Hiçbir zamanlayıcı, hiçbir aralık kurulmaz: geçmiş
 * yalnızca bir yolculuk sona erdiğinde değişir ve o an kullanıcı zaten
 * ekrandadır. Veri, bölüm açıldığında ve kullanıcının kendi eylemlerinden
 * sonra okunur.
 *
 * <b>LocalStorage OTORİTE DEĞİLDİR</b> ve hiç kullanılmaz: tutanak
 * sunucudadır.
 *
 * @param {{ permitted?: boolean, enabled?: boolean }} [options]
 */
export default function useJourneyHistory({ permitted = false, enabled = false } = {}) {
  const [items, setItems] = useState([])
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [filterId, setFilterId] = useState('all')
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  /** Açık olan tutanağın SUNUM modeli; kapalıyken <code>null</code>. */
  const [detail, setDetail] = useState(null)
  const [detailId, setDetailId] = useState(null)
  const [busyId, setBusyId] = useState(null)

  /* Sürüm sayacı: geç gelen bir liste cevabı, daha yeni bir okumanın sonucunu
     EZEMEZ. Süzgeç hızlı değiştirildiğinde tam olarak bu olurdu. */
  const requestIdRef = useRef(0)
  const disposedRef = useRef(false)

  useEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
    }
  }, [])

  /**
   * Bir sayfayı okur.
   *
   * <b>Sayfa EKLENİR, ezilmez</b> (ilk sayfa hariç): "daha fazla" düğmesi
   * listeyi büyütmeli, yerine yenisini koymamalıdır.
   */
  const load = useCallback(async ({ page: wanted = 1, filter = 'all', append = false } = {}) => {
    if (!permitted) return

    requestIdRef.current += 1
    const requestId = requestIdRef.current

    if (append) setLoadingMore(true)
    else setLoading(true)
    setError('')

    try {
      const response = await fetchJourneyHistory({
        page: wanted,
        pageSize: PAGE_SIZE,
        status: historyFilterStatus(filter),
      })

      if (disposedRef.current || requestId !== requestIdRef.current) return

      if (!response.ok) {
        setError(journeyHistoryErrorMessage(
          response.status,
          await readApiError(response, ''),
          JOURNEY_HISTORY_MESSAGES.loadFailed,
        ))
        return
      }

      const body = journeyHistoryPage(await response.json())
      if (disposedRef.current || requestId !== requestIdRef.current) return

      setItems((current) => (append ? [...current, ...body.items] : body.items))
      setPage(body.page)
      setTotalCount(body.totalCount)
      /* "Devamı var mı" sorusunu SUNUCU yanıtlar; sayfa doluluğuna bakıp
         tahmin etmek, son sayfada boş bir düğme bırakırdı. */
      setHasMore(body.hasMore)
      setLoaded(true)
    } catch {
      if (!disposedRef.current && requestId === requestIdRef.current) {
        setError(JOURNEY_HISTORY_MESSAGES.loadFailed)
      }
    } finally {
      if (!disposedRef.current && requestId === requestIdRef.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
    /* Süzgeç bilinçli olarak BAĞIMLILIK DEĞİLDİR ve her çağrıda açıkça
       verilir. Kapanışta okunsaydı `load`un kimliği süzgeçle birlikte
       değişir, aşağıdaki etki yeniden çalışır ve tek bir süzgeç değişimi İKİ
       istek gönderirdi. */
  }, [permitted])

  /* Liste bölüm AÇILDIĞINDA — ve süzgeç değiştiğinde — okunur; panel kapalıyken
     değil. Yetkisi olmayan birine garanti 403 alacak bir istek gönderilmez.

     Sayfa 1'e dönmek zorunludur: üçüncü sayfadayken süzgeç değiştirmek, çok
     daha kısa bir sonuç kümesinin var olmayan üçüncü sayfasını istemek
     olurdu. */
  useEffect(() => {
    if (!permitted || !enabled) return
    load({ page: 1, filter: filterId, append: false })
  }, [permitted, enabled, filterId, load])

  const refresh = useCallback(
    () => load({ page: 1, filter: filterId, append: false }),
    [load, filterId],
  )

  const loadMore = useCallback(() => {
    if (!hasMore || loading || loadingMore) return Promise.resolve()
    return load({ page: page + 1, filter: filterId, append: true })
  }, [hasMore, loading, loadingMore, page, filterId, load])

  /**
   * Süzgeci değiştirir; okumayı yukarıdaki etki üstlenir.
   *
   * Burada ayrıca istek göndermek, aynı sayfayı iki kez istemek olurdu.
   */
  const setFilter = useCallback((nextFilterId) => {
    setFilterId(nextFilterId)
    /* Açık tutanak da kapanır: süzgeç onu listeden düşürmüş olabilir ve
       listede olmayan bir satırın ayrıntısı ekranda kalmamalıdır. */
    setDetail(null)
    setDetailId(null)
  }, [])

  /**
   * Bir tutanağın ayrıntısını açar.
   *
   * <b>Hiçbir simülasyon başlatmaz.</b> Ayrıntıyı görmek, yolculuğu yeniden
   * yapmak değildir; ikisi ayrı eylemlerdir.
   *
   * <b>Kimlik DONDURULUR:</b> cevap geldiğinde hangi satırın seçili olduğunun
   * önemi yoktur — istenen kayıt hangisiyse açılan odur.
   */
  const openDetail = useCallback(async (journeyHistoryId) => {
    if (!permitted || journeyHistoryId == null) return null

    const id = Number(journeyHistoryId)

    setBusyId(id)
    setError('')

    try {
      const response = await fetchJourneyHistoryDetail(id)

      if (!response.ok) {
        setError(journeyHistoryErrorMessage(
          response.status,
          await readApiError(response, ''),
          JOURNEY_HISTORY_MESSAGES.detailFailed,
        ))
        return null
      }

      const body = journeyHistoryDetail(await response.json())
      if (disposedRef.current) return null

      // Dondurulmuş kimlik: açılan kayıt İSTENEN kayıttır.
      setDetail(body)
      setDetailId(id)
      return body
    } catch {
      if (!disposedRef.current) setError(JOURNEY_HISTORY_MESSAGES.detailFailed)
      return null
    } finally {
      if (!disposedRef.current) setBusyId(null)
    }
  }, [permitted])

  const closeDetail = useCallback(() => {
    setDetail(null)
    setDetailId(null)
  }, [])

  /**
   * Tutanaktan YENİ bir çalıştırma ister ve sunucunun yanıtını GERİ VERİR.
   *
   * <b>Benimseme burada YAPILMAZ.</b> Canlı durumun ve tek SignalR kanalının
   * sahibi <code>useJourneySimulation</code>'dır; yanıtı ona vermek, bu
   * kancanın ikinci bir canlı durum ya da ikinci bir bağlantı kurmasını
   * yapısal olarak imkânsız kılar.
   *
   * <b>Tarihsel kimlik GÖNDERİLMEZ:</b> istek yalnızca kaydın kendi kimliğini
   * taşır ve sunucu yeni bir çalıştırma kimliği üretir. Tutanak değişmez.
   */
  const reuse = useCallback(async (journeyHistoryId) => {
    if (!permitted || journeyHistoryId == null) return null

    const id = Number(journeyHistoryId)

    setBusyId(id)
    setError('')

    try {
      const response = await reuseJourneyHistory(id)

      if (!response.ok) {
        /* 404 kullanıcının KENDİ kaydıyla ilgilidir ve sunucunun metni hangi
           noktanın artık bulunmadığını söyler; ham gövde gösterilmez. */
        setError(journeyHistoryErrorMessage(
          response.status,
          await readApiError(response, ''),
          JOURNEY_HISTORY_MESSAGES.reuseFailed,
        ))
        return null
      }

      return await response.json()
    } catch {
      if (!disposedRef.current) setError(JOURNEY_HISTORY_MESSAGES.reuseFailed)
      return null
    } finally {
      if (!disposedRef.current) setBusyId(null)
    }
  }, [permitted])

  return {
    items,
    totalCount,
    hasMore,
    filterId,
    loading,
    loadingMore,
    loaded,
    error,
    detail,
    detailId,
    busyId,
    clearError: useCallback(() => setError(''), []),
    refresh,
    loadMore,
    setFilter,
    openDetail,
    closeDetail,
    reuse,
  }
}
