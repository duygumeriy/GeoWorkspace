import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { fetchMe, setUnauthorizedHandler } from '../services/api'

const AuthContext = createContext(null)

/* Yönetim panelini görebilen rol adları (geçiş dönemi).
   `Admin` legacy köprü rolü, `Administrator` ise Phase 4'ün kanonik hedef
   rolüdür; ikisi de 27 yetkinin tamamını taşır. Liste bilinçli olarak bu ikisiyle
   sınırlıdır ve başka rollere genişletilmez. */
const ADMIN_PANEL_ROLES = ['Admin', 'Administrator']

function readStoredAuth() {
  const token = sessionStorage.getItem('token')
  const expiresAt = sessionStorage.getItem('expiresAt')

  if (!token || !expiresAt) {
    return { token: null, expiresAt: null }
  }

  if (new Date(expiresAt).getTime() <= Date.now()) {
    sessionStorage.removeItem('token')
    sessionStorage.removeItem('expiresAt')
    return { token: null, expiresAt: null }
  }

  return { token, expiresAt }
}

export function AuthProvider({ children }) {
  const [{ token, expiresAt }, setAuth] = useState(readStoredAuth)
  // Authoritative profile, always from GET /api/auth/me. The JWT is never
  // decoded client-side: a token's claims are what the *server* trusts, and
  // treating them as a second source of truth here would let a tampered
  // token change what the UI believes about the user.
  const [user, setUser] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const timerRef = useRef(null)

  /* The half-finished login: the password step passed, the second factor has
     not. Deliberately kept in memory only and NEVER written to the `token`
     key in sessionStorage — a challenge is not a session. Storing it there
     would make every "is the user signed in?" check in the app (including
     ProtectedRoute and authFetch) answer yes for someone who has not yet
     proven their second factor.
       mode: 'verify' — the account has an authenticator; ask for the code.
             'setup'  — 2FA is mandatory for this account but not configured. */
  const [challenge, setChallenge] = useState(null)

  const logout = useCallback(() => {
    sessionStorage.removeItem('token')
    sessionStorage.removeItem('expiresAt')
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setAuth({ token: null, expiresAt: null })
    setUser(null)
    setChallenge(null)
  }, [])

  const login = useCallback((newToken, newExpiresAt) => {
    sessionStorage.setItem('token', newToken)
    sessionStorage.setItem('expiresAt', newExpiresAt)
    setAuth({ token: newToken, expiresAt: newExpiresAt })
    // The challenge has done its job; it must not outlive the login.
    setChallenge(null)
  }, [])

  /**
   * Records the pending second factor after a successful password step.
   *
   * @param {{ challengeToken: string, mode: 'verify'|'setup', username?: string }} pending
   */
  const beginTwoFactor = useCallback((pending) => {
    setChallenge(pending)
  }, [])

  /** The challenge token rotates when the server re-issues it mid-setup. */
  const updateChallengeToken = useCallback((challengeToken) => {
    setChallenge((prev) => (prev ? { ...prev, challengeToken } : prev))
  }, [])

  const cancelTwoFactor = useCallback(() => setChallenge(null), [])

  // Any 401 from a protected API call triggers logout automatically.
  // A 403 must NOT: that means "signed in but not allowed here", and logging
  // the user out on it would kick them out of the app for opening one page.
  useEffect(() => {
    setUnauthorizedHandler(logout)
  }, [logout])

  // Loads the profile whenever a token appears (login, or a reload with a
  // still-valid stored token).
  useEffect(() => {
    if (!token) {
      setUser(null)
      return undefined
    }

    let cancelled = false
    setProfileLoading(true)

    fetchMe()
      .then(async (res) => {
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (!cancelled) setUser(data)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setProfileLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [token])

  /* Re-reads the profile from the server after something changed it (enabling
     or disabling 2FA). The client never patches `user` locally: the server
     stays the single source of truth for what the account actually is. */
  const refreshUser = useCallback(async () => {
    try {
      const res = await fetchMe()
      if (res.ok) setUser(await res.json())
    } catch {
      // Offline/transient: the stale profile is harmless, the next load fixes it.
    }
  }, [])

  // Expiry timer: schedules automatic logout for the moment the JWT expires.
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (!token || !expiresAt) {
      return
    }

    const remainingMs = new Date(expiresAt).getTime() - Date.now()

    if (remainingMs <= 0) {
      logout()
      return
    }

    timerRef.current = setTimeout(() => {
      logout()
    }, remainingMs)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [token, expiresAt, logout])

  const value = {
    token,
    expiresAt,
    isAuthenticated: Boolean(token),
    user,
    userId: user?.userId ?? null,
    username: user?.username ?? '',
    // Single derived source: isAdmin is computed from the role the server
    // reported, never stored separately.
    role: user?.role ?? null,
    isAdmin: user?.role === 'Admin',
    /* Yalnızca yönetim panelinin GÖRÜNÜRLÜĞÜ için geçici bir uyumluluk kuralı.
       Phase 4 ile `Administrator` gerçek bir hedef rol oldu ve backend'in admin
       uçları ona rol ADINA değil yetki satırlarına bakarak izin veriyor. Bu
       liste olmasaydı, backend'in kabul ettiği bir yönetici React tarafında
       /admin'e giremezdi.

       `isAdmin` bilinçli olarak DEĞİŞTİRİLMEDİ: onu haritadaki çizim sahiplik
       kuralı (canManageDrawing) kullanıyor ve burada genişletmek, bu fazın
       kapsamı dışında sessiz bir yetki değişikliği olurdu.

       Bu bir güvenlik sınırı DEĞİLDİR — gerçek karar backend'de verilir ve
       yetkisiz bir istek 403 alır. Yetki tabanlı frontend kararları (can(...))
       ayrı bir fazın konusu; o geldiğinde bu rol adı listesi kaldırılacak. */
    canAccessAdminPanel: ADMIN_PANEL_ROLES.includes(user?.role),
    profileLoading,
    login,
    logout,
    // Multi-step login. `challenge` being set does NOT make isAuthenticated
    // true — the two states are intentionally independent.
    challenge,
    beginTwoFactor,
    updateChallengeToken,
    cancelTwoFactor,
    // Lets the settings screen refresh `twoFactorEnabled` without a reload.
    refreshUser,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
