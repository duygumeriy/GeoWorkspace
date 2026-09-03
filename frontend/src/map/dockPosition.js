/**
 * "Araçlar" yüzer panelinin KONUMU — saf sunum bilgisi.
 *
 * <b>Bu bir iş kuralı DEĞİLDİR.</b> Panelin nerede durduğu hiçbir izleme,
 * takip, seçim ya da yönetim kararını etkilemez; bu yüzden depolama katmanı da
 * sunucuya değil yalnızca tarayıcıya bakar ve erişilemediğinde sessizce
 * varsayılana düşer.
 *
 * <b>Konum ORANLA saklanır, pikselle değil.</b> Mutlak piksel, pencere
 * boyutu ya da kenar çubuğu değiştiği anda anlamını yitirir ve paneli
 * ulaşılamaz bir yere düşürebilirdi. Oran, panelin MERKEZİNİN kullanılabilir
 * harita alanına göre yeridir; piksele çevrilirken her seferinde yeniden
 * kelepçelenir.
 */

/** Sürümlenmiş, yalnızca sunuma ait tercih anahtarı. */
export const DOCK_POSITION_STORAGE_KEY = 'map.transportDockPosition.v1'

/** Panelin harita alanının kenarlarına bırakması gereken en küçük boşluk (px). */
export const DOCK_EDGE_MARGIN = 12

/** Klavyeyle bir adımda kayma miktarı (px). */
export const DOCK_KEYBOARD_STEP = 16

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Saklanan/gelen değer bir konum sayılabilir mi?
 *
 * Aralık kontrolü BURADA yapılmaz: aralık dışı bir oran hatalı değil, yalnızca
 * kelepçelenecek bir değerdir. Reddedilen şey sayı OLMAYANDIR.
 */
export function isDockPosition(value) {
  return Boolean(value) && finite(value.xRatio) && finite(value.yRatio)
}

/**
 * Oranı, harita alanı içindeki piksel konumuna (sol/üst) çevirir ve GÜVENLİ
 * sınırlara kelepçeler.
 *
 * Kelepçe zorunludur ve tek yerdedir: sürüklerken, geri yüklerken ve pencere
 * yeniden boyutlandığında aynı fonksiyon çalışır — panel hiçbir yoldan
 * ulaşılamaz hâle gelemez.
 */
export function dockPositionToOffset({
  position,
  viewport,
  dock,
  margin = DOCK_EDGE_MARGIN,
} = {}) {
  if (!isDockPosition(position)) return null
  if (!finite(viewport?.width) || !finite(viewport?.height)) return null
  if (!finite(dock?.width) || !finite(dock?.height)) return null

  return clampDockOffset({
    left: position.xRatio * viewport.width - dock.width / 2,
    top: position.yRatio * viewport.height - dock.height / 2,
    viewport,
    dock,
    margin,
  })
}

/**
 * Piksel konumunu kullanılabilir harita alanına kelepçeler.
 *
 * Panel harita alanından GENİŞSE (dar telefon) en küçük sınır kazanır: panel
 * kenardan taşmak yerine kenara yaslanır ve sol kenarı her zaman görünür
 * kalır.
 */
export function clampDockOffset({
  left,
  top,
  viewport,
  dock,
  margin = DOCK_EDGE_MARGIN,
} = {}) {
  if (!finite(left) || !finite(top)) return null
  if (!finite(viewport?.width) || !finite(viewport?.height)) return null
  if (!finite(dock?.width) || !finite(dock?.height)) return null

  const minLeft = margin
  const minTop = margin
  const maxLeft = Math.max(minLeft, viewport.width - dock.width - margin)
  const maxTop = Math.max(minTop, viewport.height - dock.height - margin)

  return {
    left: Math.round(Math.min(Math.max(left, minLeft), maxLeft)),
    top: Math.round(Math.min(Math.max(top, minTop), maxTop)),
  }
}

/** Piksel konumunu, yeniden boyutlanmaya dayanıklı orana çevirir. */
export function dockOffsetToPosition({ left, top, viewport, dock } = {}) {
  if (!finite(left) || !finite(top)) return null
  if (!finite(viewport?.width) || !finite(viewport?.height)) return null
  if (!finite(dock?.width) || !finite(dock?.height)) return null
  if (viewport.width <= 0 || viewport.height <= 0) return null

  return {
    xRatio: (left + dock.width / 2) / viewport.width,
    yRatio: (top + dock.height / 2) / viewport.height,
  }
}

/**
 * Saklanan tercihi okur.
 *
 * <b>Her başarısızlık VARSAYILANA düşer.</b> Depolama kapalı olabilir, JSON
 * bozulmuş olabilir, başka bir sürüm başka bir şey yazmış olabilir; hiçbiri
 * kullanıcıya gösterilecek bir hata değildir — panel yalnızca varsayılan
 * yerinde açılır.
 */
export function readDockPosition(storage) {
  try {
    const raw = storage?.getItem(DOCK_POSITION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return isDockPosition(parsed) ? { xRatio: parsed.xRatio, yRatio: parsed.yRatio } : null
  } catch {
    return null
  }
}

/** Tercihi yazar; yazamamak sessizdir — sürükleme bu oturumda çalışmaya devam eder. */
export function writeDockPosition(storage, position) {
  try {
    if (!isDockPosition(position)) {
      storage?.removeItem(DOCK_POSITION_STORAGE_KEY)
      return
    }
    storage?.setItem(
      DOCK_POSITION_STORAGE_KEY,
      JSON.stringify({ xRatio: position.xRatio, yRatio: position.yRatio }),
    )
  } catch {
    /* Depolama yoksa tercih yalnızca bu oturumda yaşar. */
  }
}
