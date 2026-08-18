import { DRAWING_TYPES, drawingItemPath } from '../map/drawingTypes.js'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5154'

let unauthorizedHandler = null
let connectionHandler = null

/** AuthProvider registers its logout function here so any 401 can trigger it. */
export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler
}

/**
 * Lets the map surface "connection lost / restored" feedback. Derived purely
 * from the outcome of requests the app was going to make anyway — there is no
 * health-check polling.
 *
 * @param {(online: boolean) => void} handler
 */
export function setConnectionHandler(handler) {
  connectionHandler = handler
}

export async function login(username, password) {
  return fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
}

/* --- Account (register / e-posta doğrulama / şifre) --------------------------
   Bu uçların hiçbiri token gerektirmez (change-password hariç), bu yüzden
   authFetch değil düz fetch kullanırlar: 401 otomatik logout'u buraya
   uygulamak, giriş yapmamış kullanıcıyı boşuna logout akışına sokardı. */

function publicPost(path, body) {
  return fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function register({ username, email, password, confirmPassword }) {
  return publicPost('/api/auth/register', { username, email, password, confirmPassword })
}

export function confirmEmail({ userId, token }) {
  return publicPost('/api/auth/confirm-email', { userId, token })
}

export function resendConfirmation(email) {
  return publicPost('/api/auth/resend-confirmation', { email })
}

export function forgotPassword(email) {
  return publicPost('/api/auth/forgot-password', { email })
}

export function resetPassword({ email, token, newPassword, confirmPassword }) {
  return publicPost('/api/auth/reset-password', { email, token, newPassword, confirmPassword })
}

/** Oturum gerektirir; hangi hesabın şifresi değişeceğini backend token'dan belirler. */
export function changePassword({ currentPassword, newPassword, confirmPassword }) {
  return authFetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
  })
}

/* --- İki faktörlü doğrulama (AUTH-5) -----------------------------------------
   İki ayrı grup var ve karıştırılmamalıdır:

   1) Login'in ikinci adımı — çağıran henüz oturum AÇMAMIŞTIR. Yetki, gövdedeki
      challenge biletidir; bu bilet Authorization header'ına KONULMAZ, çünkü
      access token değildir (backend onu zaten kabul etmez).
   2) Ayarlar → Güvenlik — çağıran oturum açmıştır; authFetch ile normal Bearer
      token kullanılır. */

export function loginTwoFactor({ challengeToken, code }) {
  return publicPost('/api/auth/login/2fa', { challengeToken, code })
}

export function loginTwoFactorRecovery({ challengeToken, recoveryCode }) {
  return publicPost('/api/auth/login/2fa/recovery', { challengeToken, recoveryCode })
}

/** Zorunlu (Admin) kurulumun başlatılması. Cevap yenilenmiş bir bilet taşır. */
export function startMandatoryTwoFactorSetup(challengeToken) {
  return publicPost('/api/auth/login/2fa/setup', { challengeToken })
}

/** Zorunlu kurulumun doğrulanması: aynı cevapta hem JWT hem kurtarma kodları. */
export function verifyMandatoryTwoFactorSetup({ challengeToken, code }) {
  return publicPost('/api/auth/login/2fa/setup/verify', { challengeToken, code })
}

export function fetchTwoFactorStatus() {
  return authFetch('/api/auth/2fa')
}

export function startTwoFactorSetup(currentPassword) {
  return authFetch('/api/auth/2fa/setup', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ currentPassword }),
  })
}

export function enableTwoFactor(code) {
  return authFetch('/api/auth/2fa/enable', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ code }),
  })
}

export function disableTwoFactor({ currentPassword, code, recoveryCode }) {
  return authFetch('/api/auth/2fa/disable', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ currentPassword, code, recoveryCode }),
  })
}

export function regenerateRecoveryCodes({ currentPassword, code }) {
  return authFetch('/api/auth/2fa/recovery-codes/regenerate', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ currentPassword, code }),
  })
}

/**
 * Hesap uçlarının hata gövdesini tek satır mesaja çevirir. Backend
 * `{ message, errors[] }` döner; alan bazlı hatalar varsa onlar gösterilir.
 */
export async function readAccountError(res, fallback) {
  const body = await res.json().catch(() => null)
  if (body?.errors?.length) return body.errors.join(' ')
  return body?.message || `${fallback} (HTTP ${res.status})`
}

/** Fetch wrapper for protected endpoints: attaches the token and triggers auto-logout on 401. */
export async function authFetch(path, options = {}) {
  const token = sessionStorage.getItem('token')
  const headers = { ...(options.headers || {}) }
  if (token) headers.Authorization = `Bearer ${token}`

  let res
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers })
  } catch (error) {
    // Network-level failure (server down, DNS, offline) — never a 4xx/5xx.
    connectionHandler?.(false)
    throw error
  }

  connectionHandler?.(true)

  /* 401 and 403 mean different things and must be handled differently:
       401 — the token is missing/expired/invalid: the session is over, so log out.
       403 — the token is fine, the user simply lacks the required role.
             Logging out here would throw an authenticated user out of the app
             just for touching an admin-only endpoint. */
  if (res.status === 401 && unauthorizedHandler) {
    unauthorizedHandler()
  }

  return res
}

export function fetchMe() {
  return authFetch('/api/auth/me')
}

/* --- Admin (AuthorizationPolicies.AdminMfaRequired) --------------------------
   Non-admins get 403 from these; that is deliberately NOT a logout. The admin
   UI itself is AUTH-6's scope — these exist so the guard and the backend
   policy can be exercised end to end. */

export function fetchAdminUsers() {
  return authFetch('/api/admin/users')
}

export function fetchAdminUser(id) {
  return authFetch(`/api/admin/users/${id}`)
}

export function updateUserRole(id, role) {
  return authFetch(`/api/admin/users/${id}/role`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ role }),
  })
}

export function updateUserStatus(id, isActive) {
  return authFetch(`/api/admin/users/${id}/status`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ isActive }),
  })
}

/**
 * The roles an administrator may assign when approving. Read from the server
 * rather than hard-coded here, so the list the admin sees and the list the
 * backend accepts cannot drift apart.
 */
export function fetchAssignableRoles() {
  return authFetch('/api/admin/users/roles')
}

/**
 * Approves a pending account with the selected role.
 *
 * Only the role travels. Activation, the approval timestamp and the approving
 * administrator are decided server-side from the verified token — sending them
 * from here would be sending the server its own answer.
 */
export function approveUser(id, role) {
  return authFetch(`/api/admin/users/${id}/approve`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ role }),
  })
}

/** Rejects a pending application. The reason is an internal note, never mailed. */
export function rejectUser(id, reason) {
  return authFetch(`/api/admin/users/${id}/reject`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ reason }),
  })
}

/* --- Admin: roller ----------------------------------------------------------
   Hepsi MFA + roles.* yetkisi ister. Yetkisi olmayan authenticated bir
   kullanıcı 403 alır ve bu bir logout sebebi DEĞİLDİR; authFetch bu ayrımı
   zaten yapıyor. */

/**
 * Sistemdeki rollerin envanteri.
 *
 * <b>`fetchAssignableRoles` ile karıştırılmamalıdır.</b> O uç "bu yönetici
 * hangi rolleri ATAYABİLİR" sorusunu yanıtlar ve çağırana göre daralır; bu uç
 * "sistemde hangi roller VAR" sorusunu yanıtlar ve daraltılmaz — rol yönetimi
 * ekranı, atayamayacağı rolleri de yönetebilmelidir.
 *
 * Satırlar listeyi çizmek için gereken her şeyi taşır (sayımlar ve yetenek
 * bayrakları dâhil), bu yüzden rol başına ikinci bir istek gerekmez.
 */
export function fetchAdminRoles() {
  return authFetch('/api/admin/roles')
}

/** Tek bir rolün güncel hâli; liste satırıyla aynı şekli döner. */
export function fetchAdminRole(id) {
  return authFetch(`/api/admin/roles/${id}`)
}

/** Yeni özel rol. Başarıda 201 ve oluşturulan rol döner. */
export function createAdminRole(name) {
  return authFetch('/api/admin/roles', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  })
}

/**
 * Rolü yeniden adlandırır.
 *
 * PATCH'tir çünkü bu bir KİMLİK değişikliği değildir: rolün Id'si, yetkileri ve
 * kullanıcı üyelikleri korunur. Sil + yeniden oluştur, rolü taşıyan herkesi
 * sessizce rolsüz bırakırdı.
 */
export function renameAdminRole(id, name) {
  return authFetch(`/api/admin/roles/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  })
}

/** Rolü siler. Başarıda 204 döner ve gövde YOKTUR. */
export function deleteAdminRole(id) {
  return authFetch(`/api/admin/roles/${id}`, { method: 'DELETE' })
}

/* --- Admin: yetki kataloğu ---------------------------------------------------
   MFA + `permissions.view` ister. Katalog SALT OKUNURDUR: sunucuda create /
   update / delete ucu yoktur, çünkü bir yetki kodda karşılığı olan bir
   yeteneği temsil eder ve çalışma zamanında icat edilemez. */

/**
 * Kanonik yetki kataloğu: `{ id, code, name, description, category, isActive,
 * sortOrder }` satırları.
 *
 * Kullanımdan kaldırılmış yetkiler de DÖNER (`isActive = false`); yönetici
 * mevcut durumu eksiksiz görebilmelidir. Sıra sunucudan gelir (category →
 * sortOrder → code) ve tarayıcıda yeniden sıralanmaz.
 *
 * Katalog ekranı yalnızca bunu çağırır. Rol bazlı `.../roles/{id}/permissions`
 * bambaşka bir soruyu yanıtlar ("bu rolde ne işaretli") ve burada işi yoktur.
 */
export function fetchAdminPermissions() {
  return authFetch('/api/admin/permissions')
}

/**
 * Rolün yetki matrisi: kataloğun TAMAMI, her satırda `assigned` bayrağıyla,
 * ayrıca rolün güncel hâli (liste satırıyla aynı şekil, sayımlar dâhil).
 *
 * Tek istek yeter, iki değil: yanıt katalog alanlarını (code, name,
 * description, category, sortOrder, isActive) zaten taşır, dolayısıyla yanına
 * `GET /api/admin/permissions` eklemek aynı satırları ikinci kez indirmek
 * olurdu. Yalnızca rol detayı açıldığında çağrılır — liste rol başına yetki
 * okumaz.
 */
export function fetchAdminRolePermissions(id) {
  return authFetch(`/api/admin/roles/${id}/permissions`)
}

/**
 * Rolün AKTİF yetki kümesini gönderilen kümeye eşitler.
 *
 * Gövde farkı değil, HEDEF durumu taşır (`{ permissionCodes }`); ekleme ve
 * kaldırmayı sunucu tek transaction içinde hesaplar. Kimlik olarak kod
 * kullanılır, satır Id'si değil: kodlar kanonik, Id'ler kuruluma özgüdür.
 *
 * Pasif yetkiler bilinçli olarak GÖNDERİLMEZ. Sunucu pasif bir kodu doğrudan
 * reddeder (400), buna karşılık rolün mevcut pasif bağlarını isteğe bakmadan
 * KORUR — istek yalnızca aktif kümeyi tanımlar. Bu yüzden onları listeye
 * eklemek, her kaydetmeyi 400'e çevirmekten başka bir şey yapmazdı.
 */
export function updateAdminRolePermissions(id, permissionCodes) {
  return authFetch(`/api/admin/roles/${id}/permissions`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ permissionCodes }),
  })
}

/**
 * Bir kullanıcının yetki tablosu: kataloğun TAMAMI, her satırda yetkinin o
 * kullanıcı için KAYNAĞI (`inheritedFromRoles`, `directAssigned`) ve ETKİSİ
 * (`effective`).
 *
 * Kaynak ile etki ayrı alanlardır ve öyle kalmalıdır: bir satırın var olması
 * yetkinin işlediği anlamına gelmez — yetki pasifleştirilmiş ya da hesap askıya
 * alınmış olabilir. Arayüz bu ikisini birleştirirse çalışmayan bir erişimi "var"
 * gösterir.
 *
 * `canAssignDirect` / `canRemoveDirect` / `canManageDirectPermissions` de
 * sunucudan gelir. İstemci "bu kullanıcı Viewer, o hâlde şunu veremem" gibi bir
 * çıkarım YAPMAZ; rol adına bakan bir kural, sunucudaki yetki verisi
 * değiştiğinde sessizce yanlışa düşerdi.
 *
 * Yalnızca kullanıcı detayı açıldığında çağrılır — liste kullanıcı başına yetki
 * okumaz.
 */
export function fetchAdminUserPermissions(userId) {
  return authFetch(`/api/admin/users/${userId}/permissions`)
}

/**
 * Kullanıcının DOĞRUDAN yetkilerini gönderilen kümeye eşitler.
 *
 * Gövde farkı değil HEDEF durumu taşır (`{ permissionCodes }`); ekleme ve
 * kaldırmayı sunucu hesaplar. Küme yalnızca AKTİF ve DOĞRUDAN atamaları
 * kapsar:
 *
 * - rolden gelen kodlar GÖNDERİLMEZ — sunucu onları reddeder (400), çünkü
 *   ikinci bir satır hiçbir erişim eklemez ama rol değiştiğinde arkada kalırdı;
 * - pasif kodlar GÖNDERİLMEZ — sunucu yeni atamayı reddeder ama mevcut tarihsel
 *   bağı isteğe bakmadan korur.
 */
export function updateAdminUserPermissions(userId, permissionCodes) {
  return authFetch(`/api/admin/users/${userId}/permissions`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ permissionCodes }),
  })
}

/* --- Drawings ---------------------------------------------------------------
   All calls go through authFetch, so the Bearer token, the 401 handler and the
   automatic logout keep working exactly as they do for /api/auth/me. The WKT
   sent here is already EPSG:4326 — the backend rejects anything else. Paths
   come from the drawing-type table, not from a second lookup map. */

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/**
 * Reads a failed response into a human message. The backend answers with
 * `{ message }`; anything else falls back to the status code.
 */
export async function readApiError(res, fallback) {
  if (res.status === 401) return 'Oturum süresi doldu. Yeniden giriş yapın.'
  const body = await res.json().catch(() => null)
  return body?.message || `${fallback} (HTTP ${res.status})`
}

/**
 * POST: creates a record from a finished shape.
 *
 * Metadata (description / category / tags) is optional on both sides — the
 * attribute popup keeps it behind "Daha fazla seçenek", and the backend accepts
 * a record without any of it.
 *
 * @param {{ name?: string, style?: object, description?: string,
 *           category?: string, tags?: string[] }} attributes
 */
export function createDrawing(type, wkt, { name = '', style = null, description = '', category = '', tags = [] } = {}) {
  return authFetch(DRAWING_TYPES[type].createPath, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ wkt, name, style, description, category, tags }),
  })
}

export function fetchDrawings(type) {
  return authFetch(DRAWING_TYPES[type].listPath)
}

/**
 * The Çöp Kutusu list: the caller's own soft-deleted drawings, all three types
 * in ONE response, newest deletion first.
 *
 * There is no `type` parameter on purpose — the trash is a single screen, not
 * three, and asking the server three times would only give the client three
 * lists to merge. The scoping is the server's: it returns records that are both
 * deleted AND owned by the caller, so another user's deleted drawing cannot
 * appear here no matter what the UI does with the answer.
 *
 * Each entry is `{ type, deletedAt, drawing }`, where `drawing` is the same
 * body the normal list endpoints return.
 */
export function fetchDeletedDrawings() {
  return authFetch('/api/drawings/deleted')
}

/**
 * PUT: the detail popup's "Kaydet". Updates name, style (colour) and geometry
 * in one request.
 *
 * Only the fields present are sent, and the backend preserves anything it does
 * not receive — so editing just the name never risks rewriting the geometry
 * with a stale copy. The WKT is already EPSG:4326 (`geometryToWkt4326` does the
 * reprojection); ownership is decided server-side from the token, never here.
 *
 * Metadata follows the same rule with one addition: an empty string (or an
 * empty tag array) means "clear this field", while omitting it means "leave it
 * alone". That is what lets a description be removed as well as changed.
 *
 * @param {{ name?: string, style?: object, wkt?: string, description?: string,
 *           category?: string, tags?: string[] }} changes
 */
export function updateDrawing(type, id, changes) {
  return authFetch(drawingItemPath(type, id), {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(changes),
  })
}

/** PATCH: style only. The geometry is never touched by this endpoint. */
export function updateDrawingStyle(type, id, style) {
  return authFetch(`${drawingItemPath(type, id)}/style`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(style),
  })
}

export function deleteDrawing(type, id) {
  return authFetch(drawingItemPath(type, id), { method: 'DELETE' })
}

/* --- Bulk operations --------------------------------------------------------
   Each of these is ONE atomic request. Looping single-record calls from the
   client would leave the map and the database disagreeing whenever a call in
   the middle failed; the backend wraps every batch in a transaction instead, so
   the only two outcomes are "all applied" and "nothing applied". */

/**
 * @param {{ type: string, id: number }[]} items
 */
export function bulkDeleteDrawings(items) {
  return authFetch('/api/drawings/bulk-delete', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ items }),
  })
}

/**
 * @param {{ type: string, id: number, style?: object }[]} items per-item `style`
 *   overrides the shared one — that is how undo restores each record's own
 *   previous style in a single atomic call.
 * @param {object|null} style shared style; only the fields present are applied.
 */
export function bulkStyleDrawings(items, style) {
  return authFetch('/api/drawings/bulk-style', {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ items, style }),
  })
}

/**
 * Recreates several records atomically as BRAND NEW drawings. The server owns
 * them to the caller — this is a create, not a restore.
 *
 * @param {{ type: string, wkt: string, name?: string, style?: object }[]} items
 */
export function bulkCreateDrawings(items) {
  return authFetch('/api/drawings/bulk-create', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ items }),
  })
}

/**
 * Undo of a delete: reopens rows the server soft-deleted.
 *
 * Only the identity of each record travels (`type` + `id`). Geometry, name,
 * style and — critically — ownership come from the row that is already in the
 * database, so an admin undoing someone else's deletion cannot end up owning
 * their drawing. The client is structurally unable to claim an owner here.
 *
 * @param {{ type: string, id: number }[]} items
 */
export function restoreDrawings(items) {
  return authFetch('/api/drawings/restore', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ items }),
  })
}

/* --- Spatial analysis -------------------------------------------------------
   Read-only: the polygon sent here is a query parameter, never a record. The
   backend counts with ST_Intersects and writes nothing, which is what lets the
   temporary "Envanter Analizi" tool run without touching the database. */

/**
 * Counts inventory records intersecting a polygon.
 *
 * @param {string} wkt EPSG:4326 POLYGON, same contract as the drawing endpoints.
 * @param {{ excludePolygonId?: number|null }} [options] the polygon's own record
 *   id when a just-saved polygon analyses itself, so it is not counted twice.
 */
export function analyzeIntersections(wkt, { excludePolygonId = null } = {}) {
  return authFetch('/api/analysis/intersections', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ wkt, excludePolygonId }),
  })
}
