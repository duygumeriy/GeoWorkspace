/**
 * Backend'in yapılandırılmış `workHours` sözleşmesini okunabilir Türkçe
 * metne çevirir.
 *
 * <b>Ham JSON asla gösterilmez.</b> Sunucu haftalık programı gün başına
 * `{ closed, open, close }` olarak döner; bu modül onu tabloya sığan tek
 * satırlık bir özete ve detay görünümü için yedi günlük listeye dönüştürür.
 *
 * <b>Hiçbir saat UYDURULMAZ.</b> Gönderilmemiş bir gün "Belirtilmemiş"tir ve
 * kapalı SAYILMAZ — ikisi farklı şeylerdir ve arayüz de onları ayırmalıdır.
 * Bir özet ancak veriden doğrudan türetilebiliyorsa üretilir.
 */

/** Gün anahtarları, hafta sırasıyla. Sunucu sözleşmesindeki adlar. */
const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

const DAY_LABELS = Object.freeze({
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
