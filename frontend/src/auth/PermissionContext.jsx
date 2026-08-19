import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchMyPermissions, setForbiddenHandler } from '../services/api'
import { useAuth } from './AuthContext'
import { PermissionContext } from './permissionStore.js'

/** Paylaşılan boş küme: her render'da yeni bir Set üretmemek için. */
const NO_PERMISSIONS = Object.freeze(new Set())

/* Beklenmeyen bir 403'ten sonra yetkiler en fazla bu sıklıkta tazelenir.
   Sunucu tarafında yetki gerçekten kaldırıldıysa arayüz bir kez yakalar;
   kaldırılmadıysa (ör. hedefe özel bir kural) ikinci, üçüncü istek aynı 403'ü
   döndüreceği için sınır olmadan bu sonsuz bir tazeleme döngüsü olurdu. */
const FORBIDDEN_REFRESH_COOLDOWN_MS = 10_000

/**
 * Çağıranın ETKİN yetkilerinin tek merkezi kaynağı.
 *
 * <b>Bu bir güvenlik sınırı DEĞİLDİR.</b> Buradaki `can(...)` yalnızca arayüzü
 * biçimlendirir: bir düğmeyi gizlemek onu yetkilendirme yapmaz. React state'i
 * değiştirilse, DOM elle düzenlense veya istek doğrudan atılsa bile backend
 * aynı yetkisiz isteğe 403 döndürmeye devam eder. Buradaki kurallar backend'in
 * kapılarının YERİNE değil, YANINDA durur.
 *
 * <b>Kaynak canlı veridir.</b> Kodlar JWT'den okunmaz ve localStorage'a
 * kalıcı olarak yazılmaz; bellekte tutulur ve `GET /api/auth/me/permissions`
 * ile yüklenir. Bir yönetici yetki değiştirdiğinde `refreshPermissions()`
 * yeterlidir — kullanıcının çıkıp yeniden girmesi gerekmez.
 *
 * <b>Fail-closed.</b> Küme yüklenene kadar `can(...)` HER kod için `false`
 * döner. Bu, "önce hepsini çiz, sonra yetkisizleri kaldır" davranışını
 * yapısal olarak imkânsız kılar: yetkisiz bir düğmenin 300 ms görünüp
 * kaybolması diye bir durum oluşamaz. Yükleme başarısız olursa da cevap
 * yine "hiçbiri"dir; tazeleme için açık bir yol bırakılır.
 */
export function PermissionProvider({ children }) {
  const { token } = useAuth()

  /* Küme, AİT OLDUĞU token ile birlikte tutulur. Kullanıcı değiştiğinde
     `state.token !== token` olur ve eski kullanıcının yetkileri o anda
     geçersizleşir — yeni isteğin dönmesini beklemeden. Ayrı bir "temizle"
     efekti yazmak, temizlenmeden önce bir render sızdırırdı: A kullanıcısı
     çıkıp B girdiğinde B, A'nın düğmelerini bir kare görürdü. */
  const [state, setState] = useState({ token: null, status: 'idle', codes: NO_PERMISSIONS })

  /* Aynı token için açılmış isteğin sırası. Yarış hâlinde yalnızca EN SON
     isteğin cevabı yazılır; yavaş dönen eski bir cevabın yeni kümeyi ezmesi
     sessiz bir yetki hatası olurdu. */
  const requestRef = useRef(0)

  const load = useCallback(async (activeToken) => {
    const requestId = ++requestRef.current

    setState((current) =>
      current.token === activeToken && current.status === 'ready'
        ? // Tazeleme: mevcut küme KORUNUR, böylece ekran boşalıp yeniden
          // dolmaz. İlk yükleme ile tazeleme bilinçli olarak farklı deneyimdir.
          { ...current, status: 'refreshing' }
        : { token: activeToken, status: 'loading', codes: NO_PERMISSIONS },
    )

    try {
      const res = await fetchMyPermissions()

      if (requestId !== requestRef.current) return

      if (!res.ok) {
        /* 401 zaten authFetch üzerinden oturumu kapatır; burada ayrıca bir
           şey yapmak ikinci bir kimlik doğrulama akışı kurmak olurdu. */
        setState({ token: activeToken, status: 'error', codes: NO_PERMISSIONS })
        return
      }

      const body = await res.json()

      if (requestId !== requestRef.current) return

      setState({
        token: activeToken,
        status: 'ready',
        codes: new Set(body?.permissions ?? []),
        userId: body?.userId ?? null,
      })
    } catch {
      // Ağ hatası: fail-closed. Yetkisiz bir arayüz göstermek, olmayan bir
      // erişimi vaat etmekten iyidir; `refreshPermissions` kurtarma yoludur.
      if (requestId !== requestRef.current) return
      setState({ token: activeToken, status: 'error', codes: NO_PERMISSIONS })
    }
  }, [])

  useEffect(() => {
    if (!token) {
      // Çıkış: sıra ilerletilir ki uçuştaki bir cevap geri yazamasın.
      requestRef.current++
      setState({ token: null, status: 'idle', codes: NO_PERMISSIONS })
      return
    }

    load(token)
  }, [token, load])

  const refreshPermissions = useCallback(() => {
    if (!token) return Promise.resolve()
    return load(token)
  }, [token, load])

  /* Beklenmeyen bir 403, canlı yetkilendirmede olağan bir durumdur: yetki
     istek yoldayken kaldırılmış olabilir. Arayüzün yetişmesi için yetkiler
     BİR kez tazelenir. 403 bir oturum sorunu değildir ve çıkış YAPTIRMAZ —
     o ayrım authFetch'te olduğu gibi korunur. */
  const lastForbiddenRefresh = useRef(0)

  useEffect(() => {
    if (!token) {
      setForbiddenHandler(null)
      return undefined
    }

    setForbiddenHandler(() => {
      const now = Date.now()
      if (now - lastForbiddenRefresh.current < FORBIDDEN_REFRESH_COOLDOWN_MS) return
      lastForbiddenRefresh.current = now
      load(token)
    })

    return () => setForbiddenHandler(null)
  }, [token, load])

  const value = useMemo(() => {
    // Küme yalnızca AİT OLDUĞU token hâlâ geçerliyse sayılır.
    const current = state.token === token && token ? state : null
    const loaded = current?.status === 'ready' || current?.status === 'refreshing'
    const codes = loaded ? current.codes : NO_PERMISSIONS

    /**
     * Tam kod eşleşmesi. Hiyerarşi, ima kuralı ve rol adı YOKTUR:
     * `roles.update` kendiliğinden `roles.view` anlamına gelmez, çünkü
     * backend'de de gelmiyor. Bilinmeyen bir kod `false` döner.
     */
    const can = (code) => Boolean(code) && codes.has(code)

    return {
      permissions: codes,
      permissionsLoaded: loaded,
      permissionsLoading: current?.status === 'loading',
      permissionsRefreshing: current?.status === 'refreshing',
      permissionsError: current?.status === 'error',
      can,
      /** Verilen kodlardan EN AZ BİRİ. Boş liste `false` döner. */
      canAny: (list) => Array.isArray(list) && list.some(can),
      /** Verilen kodların TAMAMI. Boş liste `false` döner. */
      canAll: (list) => Array.isArray(list) && list.length > 0 && list.every(can),
      refreshPermissions,
    }
  }, [state, token, refreshPermissions])

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>
}
