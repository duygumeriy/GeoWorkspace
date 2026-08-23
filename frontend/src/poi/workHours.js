/**
 * POI mesai saatleri sözleşmesinin TEK yorumu: okuma (gösterim) ve yazma
 * (form) aynı gün anahtarlarını, aynı üç durumu ve aynı doğrulamayı paylaşır.
 *
 * <b>Ham JSON asla gösterilmez.</b> Sunucu haftalık programı gün başına
 * `{ closed, open, close }` olarak döner; bu modül onu tabloya sığan tek
 * satırlık bir özete ve detay görünümü için yedi günlük listeye dönüştürür.
 *
 * <b>Hiçbir saat UYDURULMAZ.</b> Gönderilmemiş bir gün "Belirtilmemiş"tir ve
 * kapalı SAYILMAZ — ikisi farklı şeylerdir ve arayüz de onları ayırmalıdır.
 * Bir özet ancak veriden doğrudan türetilebiliyorsa üretilir.
 *
 * <b>Neden yönetim klasöründe değil.</b> Aynı sözleşmeyi hem yönetim listesi
 * hem harita bilgi paneli hem de harita üzerindeki oluşturma formu okur. İki
 * kopya, "Kapalı" ile "Belirtilmemiş" ayrımının bir gün yalnızca birinde
 * korunması demek olurdu.
 */

/**
 * Gün anahtarları, hafta sırasıyla.
 *
 * Bunlar SUNUCU SÖZLEŞMESİNİN adlarıdır ve çevrilmez; Türkçe karşılıkları
 * yalnızca gösterim etiketidir (<see cref="DAY_LABELS"/>). Anahtarı
 * yerelleştirmek, gövdenin sunucuda hiç tanınmaması demek olurdu.
 */
export const DAY_KEYS = Object.freeze([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
])

export const DAY_LABELS = Object.freeze({
  monday: 'Pazartesi',
  tuesday: 'Salı',
  wednesday: 'Çarşamba',
  thursday: 'Perşembe',
  friday: 'Cuma',
  saturday: 'Cumartesi',
  sunday: 'Pazar',
})

/** Hafta içi/hafta sonu özetleri bu bölünmeden türetilir. */
const WEEKDAYS = DAY_KEYS.slice(0, 5)
const WEEKEND = DAY_KEYS.slice(5)

export const UNSPECIFIED = 'Belirtilmemiş'
export const CLOSED = 'Kapalı'

/** Yarım tire ile aralık: "09:00 – 18:00". */
const range = (day) => `${day.open} – ${day.close}`

/**
 * Tek bir günün gösterim metni.
 *
 * Üç durum ayrı ayrı temsil edilir: bildirilmemiş, kapalı, ve saatli. Kapalı
 * bir günde saat alanları sunucuda zaten temizlenir; yine de yalnızca `closed`
 * bayrağına bakılır ki çelişkili bir satır saat gösteremesin.
 */
export function dayText(day) {
  if (!day) return UNSPECIFIED
  if (day.closed) return CLOSED
  return day.open && day.close ? range(day) : UNSPECIFIED
}

/** Yedi günün tamamı; detay görünümünün okuduğu liste. */
export function weekSchedule(workHours) {
  return DAY_KEYS.map((key) => ({
    key,
    label: DAY_LABELS[key],
    text: dayText(workHours?.[key]),
  }))
}

/** Programda en az bir gün bildirilmiş mi. */
export function hasSchedule(workHours) {
  return Boolean(workHours) && DAY_KEYS.some((key) => workHours[key])
}

/**
 * Bir gün kümesinin TAMAMI aynı saat aralığındaysa o aralığı, hepsi kapalıysa
 * "Kapalı"yı döner; kümede bildirilmemiş ya da farklı bir gün varsa `null`.
 *
 * `null` dönmesi bir hata değildir — "bu küme tek cümleyle özetlenemez"
 * demektir ve çağıran o zaman gün gün göstermeye düşer.
 */
function uniformText(workHours, keys) {
  const days = keys.map((key) => workHours?.[key])

  if (days.some((day) => !day)) return null
  if (days.every((day) => day.closed)) return CLOSED
  if (days.some((day) => day.closed || !day.open || !day.close)) return null

  const first = range(days[0])

  return days.every((day) => range(day) === first) ? first : null
}

/**
 * Tabloya sığan tek satırlık özet.
 *
 * Sırayla denenir: bütün hafta tek aralık → "Her gün …"; hafta içi tek aralık
 * → "Hafta içi …" (+ hafta sonu ayrıca özetlenebiliyorsa o da); hiçbiri
 * türetilemiyorsa bildirilen İLK günün kendi metni, kaç günün daha
 * bildirildiği bilgisiyle. Böylece satır asla yedi satır yüksekliğinde olmaz
 * ve gösterilen her şey gerçekten veriden gelir.
 */
export function summarize(workHours) {
  if (!hasSchedule(workHours)) return UNSPECIFIED

  const everyDay = uniformText(workHours, DAY_KEYS)
  if (everyDay) return everyDay === CLOSED ? 'Her gün kapalı' : `Her gün ${everyDay}`

  const weekday = uniformText(workHours, WEEKDAYS)

  if (weekday) {
    const weekend = uniformText(workHours, WEEKEND)
    const weekdayText = weekday === CLOSED ? 'Hafta içi kapalı' : `Hafta içi ${weekday}`

    if (!weekend) return weekdayText
    return weekend === CLOSED ? `${weekdayText}, hafta sonu kapalı` : `${weekdayText}, hafta sonu ${weekend}`
  }

  // Düzensiz program: ilk bildirilen gün gösterilir, gerisi detayda.
  const declared = DAY_KEYS.filter((key) => workHours[key])
  const firstKey = declared[0]
  const head = `${DAY_LABELS[firstKey]} ${dayText(workHours[firstKey])}`

  return declared.length === 1 ? head : `${head} +${declared.length - 1} gün`
}

/* ===========================================================================
   Yazma tarafı: form taslağı → API gövdesi
   =========================================================================== */

/** <c>HH:mm</c>, 24 saat. Sunucudaki katı ayrıştırmanın birebir karşılığı. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Formun boş başlangıç taslağı: yedi gün de <b>bildirilmemiş</b>.
 *
 * Hiçbir güne varsayılan saat konmaz. "09:00–18:00" ile doldurmak, kullanıcının
 * söylemediği bir şeyi veriye yazmak olurdu — ve bildirilmemiş bir gün kapalı
 * da SAYILMAZ.
 */
export function emptyWorkHoursDraft() {
  return Object.fromEntries(
    DAY_KEYS.map((key) => [key, { enabled: false, closed: false, open: '', close: '' }]),
  )
}

const minutesOf = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))

/**
 * Taslağı doğrular.
 *
 * Yalnızca AÇIK günler sınanır: kapalı günün saati anlamsızdır, bildirilmemiş
 * günün ise doğrulanacak bir şeyi yoktur. Saat biçimi ONARILMAZ — "9:00" gibi
 * bir değer sessizce "09:00"a çevrilmez; sözleşmenin geçersiz saydığı bir
 * girdiyi geçerli kılmak, istemcileri biçimi yalnızca kısmen uygulamaya
 * alıştırırdı. Yerel `<input type="time">` zaten dolgulu değer üretir.
 *
 * @returns {Record<string, string>} gün anahtarı → hata metni; boşsa geçerli
 */
export function validateWorkHoursDraft(draft) {
  const errors = {}

  for (const key of DAY_KEYS) {
    const day = draft?.[key]
    if (!day?.enabled || day.closed) continue

    if (!TIME_PATTERN.test(day.open ?? '') || !TIME_PATTERN.test(day.close ?? '')) {
      errors[key] = 'Açılış ve kapanış saati SS:dd biçiminde girilmelidir.'
      continue
    }

    if (minutesOf(day.open) >= minutesOf(day.close)) {
      errors[key] = 'Açılış saati kapanış saatinden önce olmalıdır.'
    }
  }

  return errors
}

/**
 * Taslağı API gövdesine çevirir.
 *
 * Bildirilmemiş günler gövdeye HİÇ girmez; sunucu da onları "bilinmiyor"
 * olarak saklar. Hiçbir gün bildirilmemişse <c>null</c> döner — "boş program"
 * ile "program yok" tek biçimde temsil edilir, tıpkı sunucudaki gibi.
 */
export function buildWorkHoursPayload(draft) {
  const payload = {}

  for (const key of DAY_KEYS) {
    const day = draft?.[key]
    if (!day?.enabled) continue

    payload[key] = day.closed
      // Kapalı günde saat gönderilmez: sunucu da onları temizler.
      ? { closed: true }
      : { closed: false, open: day.open, close: day.close }
  }

  return Object.keys(payload).length ? payload : null
}
