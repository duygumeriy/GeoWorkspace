/**
 * Manevra meta verisinin Türkçe SUNUMU.
 *
 * <b>Küçük ve izole tutulur.</b> Bileşenin içine gömülmüş bir eşleme ne
 * testten geçerdi ne de tek yerden düzeltilebilirdi; buradaki her şey saf ve
 * DOM'suzdur.
 *
 * <b>Backend anlambilimi DEĞİŞTİRİLMEZ.</b> `maneuverType` ve
 * `maneuverModifier` sunucudan geldiği gibi taşınır; burada üretilen tek şey
 * kullanıcının okuyacağı metindir. Bilinmeyen bir tür bir HATA DEĞİLDİR:
 * yönlendirme motoru sürüm başına yeni tür ekleyebilir ve arayüz bu yüzden
 * çökmemelidir — güvenli genel bir ifadeye düşer.
 */

/** Bilinmeyen tür/yön için güvenli varsayılan. */
export const FALLBACK_MANEUVER_TEXT = 'Devam edin'

const MODIFIER_TEXT = Object.freeze({
  left: 'sola dönün',
  right: 'sağa dönün',
  'slight left': 'hafif sola dönün',
  'slight right': 'hafif sağa dönün',
  'sharp left': 'keskin sola dönün',
  'sharp right': 'keskin sağa dönün',
  straight: 'düz devam edin',
  uturn: 'geri dönüş yapın',
})

const TYPE_TEXT = Object.freeze({
  depart: 'Yolculuğa başlayın',
  arrive: 'Varış noktasına ulaştınız',
  continue: 'Devam edin',
  'new name': 'Devam edin',
  merge: 'Katılın',
  'on ramp': 'Bağlantı yoluna girin',
  'off ramp': 'Bağlantı yolundan çıkın',
  fork: 'Yol ayrımını takip edin',
  'end of road': 'Yolun sonunda dönün',
  roundabout: 'Göbeğe girin',
  rotary: 'Göbeğe girin',
  'roundabout turn': 'Göbekten çıkın',
  'exit roundabout': 'Göbekten çıkın',
  'exit rotary': 'Göbekten çıkın',
  notification: 'Devam edin',
})

function normalize(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/**
 * Bir manevranın ana talimat metni.
 *
 * <b>Öncelik:</b> motorun hazır metni (varsa) → tür + yön eşlemesi → güvenli
 * varsayılan. Faz 5B `displayText` alanını <code>null</code> döndürebilir ve
 * bu NORMALDİR; OSRM çekirdeği insan okunabilir talimat üretmez.
 */
export function maneuverInstruction(step) {
  const provided = typeof step?.displayText === 'string' ? step.displayText.trim() : ''
  if (provided) return provided

  const type = normalize(step?.maneuverType)
  const modifier = normalize(step?.maneuverModifier)

  if (type === 'depart') return TYPE_TEXT.depart
  if (type === 'arrive') return TYPE_TEXT.arrive

  /* Dönüş türlerinde ANLAMI yön taşır: "turn" tek başına bir talimat
     değildir, "sola dönün" öyledir. */
  if ((type === 'turn' || type === 'end of road' || type === 'fork' || type === 'merge') && MODIFIER_TEXT[modifier]) {
    const text = MODIFIER_TEXT[modifier]
    return text.charAt(0).toUpperCase() + text.slice(1)
  }

  if (TYPE_TEXT[type]) return TYPE_TEXT[type]

  // Yön biliniyor ama tür bilinmiyorsa yön yine de kullanılabilir bilgidir.
  if (MODIFIER_TEXT[modifier]) {
    const text = MODIFIER_TEXT[modifier]
    return text.charAt(0).toUpperCase() + text.slice(1)
  }

  return FALLBACK_MANEUVER_TEXT
}

/** Talimatın yanında gösterilecek yön ipucu; ikon seçimi için de kullanılır. */
export function maneuverDirection(step) {
  const modifier = normalize(step?.maneuverModifier)
  if (modifier.includes('uturn')) return 'uturn'
  if (modifier.includes('left')) return 'left'
  if (modifier.includes('right')) return 'right'
  const type = normalize(step?.maneuverType)
  if (type === 'depart') return 'depart'
  if (type === 'arrive') return 'arrive'
  return 'straight'
}

/**
 * Bir adım listesini panelde gösterilebilir hale getirir.
 *
 * Boş liste GEÇERLİDİR ve bir hata değildir: kalıcı güzergahı yeniden
 * kullanan bir `routeFull` önizlemesinde manevra verisi yoktur, çünkü o kayıt
 * adım saklamaz ve yalnızca adım üretmek için yeniden yönlendirme YAPILMAZ.
 */
export function journeyStepList(steps) {
  if (!Array.isArray(steps)) return []
  return steps.map((step, index) => ({
    key: `${step?.sequence ?? index}`,
    sequence: Number.isFinite(step?.sequence) ? step.sequence : index,
    instruction: maneuverInstruction(step),
    direction: maneuverDirection(step),
    // Boş sokak adı taşınmaz: "" bir bilgi değildir.
    name: typeof step?.name === 'string' && step.name.trim() ? step.name.trim() : null,
    distanceMeters: Number.isFinite(step?.distanceMeters) ? step.distanceMeters : null,
    durationSeconds: Number.isFinite(step?.durationSeconds) ? step.durationSeconds : null,
  }))
}
