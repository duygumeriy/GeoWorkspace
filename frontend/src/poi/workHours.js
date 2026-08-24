/**
 * POI mesai saatleri sözleşmesinin TEK yorumu: okuma (gösterim) ve yazma
 * (form) aynı gün anahtarlarını, aynı üç durumu ve aynı doğrulamayı paylaşır.
 *
 * <b>Ham JSON asla gösterilmez.</b> Sunucu haftalık programı gün başına
 * `{ closed, open, close }` olarak döner; bu modül onu tabloya sığan tek
 * satırlık bir özete ve detay görünümü için yedi günlük listeye dönüştürür.
 *
 * <b>Gece aşan aralık GEÇERLİDİR.</b> 17:00 – 01:00, açılış günü başlayıp
 * ertesi gün kapanan bir aralıktır; sözleşmede ek bir alanla değil, kapanışın
 * açılıştan küçük olmasıyla temsil edilir (bkz. <see cref="isOvernightRange"/>).
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

/**
 * Günün DÖRDÜNCÜ durumu: kesintisiz açık.
 *
 * <b>Eşit saatlerle temsil EDİLMEZ.</b> "00:00 – 00:00" ya da "09:00 – 09:00"
 * yazmak, süresi olmayan bir aralıkla 24 saati aynı veriye sıkıştırmak olurdu;
 * o gösterim geçersiz kalır (bkz. <see cref="validateWorkHoursDraft"/>) ve 24
 * saat açık olmak kendi AÇIK bayrağını taşır. Belirsizlik böylece hiç doğmaz.
 */
export const OPEN_24_HOURS = '24 Saat Açık'

/**
 * Gece yarısını aşan aralığın gösterim eki.
 *
 * Ayrı bir depolama alanı DEĞİLDİR ve olamaz: "ertesi gün" bilgisi zaten
 * saatlerin kendisindedir (kapanış açılıştan küçükse ertesi gündür), dolayısıyla
 * bir `overnight` bayrağı saklamak aynı gerçeği iki yerde tutmak ve ikisinin bir
 * gün çelişmesine izin vermek olurdu.
 */
export const OVERNIGHT_SUFFIX = '(ertesi gün)'

/**
 * Aralık gece yarısını aşıyor mu: kapanış, açılıştan KÜÇÜKSE ertesi gündür.
 *
 * Biçimi bozuk değerler için `false` döner — geçersiz bir girdi hakkında
 * "ertesi gün" demek, doğrulamanın reddedeceği bir şeyi yorumlamak olurdu.
 * Eşit saatler de gece aşımı DEĞİLDİR; onlar geçersizdir (bkz.
 * <see cref="validateWorkHoursDraft"/>).
 */
export function isOvernightRange(open, close) {
  if (!TIME_PATTERN.test(open ?? '') || !TIME_PATTERN.test(close ?? '')) return false
  return minutesOf(close) < minutesOf(open)
}

/**
 * Bir aralığın TEK gösterim biçimi: "09:00 – 18:00", gece aşımında
 * "17:00 – 01:00 (ertesi gün)".
 *
 * Tek yerde tanımlıdır çünkü aynı aralık POI Bilgisi'nde, POI'lerim satırında,
 * yönetim listesinde ve haftalık özet cümlelerinde görünür; ikinci bir biçim,
 * "ertesi gün" uyarısının bir gün yalnızca birinde kalması demek olurdu.
 */
export function formatHourRange(open, close) {
  const text = `${open} – ${close}`
  return isOvernightRange(open, close) ? `${text} ${OVERNIGHT_SUFFIX}` : text
}

const range = (day) => formatHourRange(day.open, day.close)

/**
 * Tek bir günün gösterim metni.
 *
 * DÖRT durum ayrı ayrı temsil edilir: bildirilmemiş, kapalı, 24 saat açık ve
 * saatli. Kapalı ya da 24 saat açık bir günde saat alanları sunucuda zaten
 * temizlenir; yine de yalnızca bayraklara bakılır ki çelişkili bir satır saat
 * gösteremesin. Sıra da anlamlıdır: `closed` önce sınanır, böylece bozuk bir
 * kayıt (ikisi de true) hiçbir yerde "24 saat açık" diye görünmez — sunucu
 * böyle bir gövdeyi zaten reddeder.
 */
export function dayText(day) {
  if (!day) return UNSPECIFIED
  if (day.closed) return CLOSED
  if (day.open24Hours) return OPEN_24_HOURS
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
  // 24 saat açık gün kümesi de tek cümleyle özetlenebilir.
  if (days.every((day) => !day.closed && day.open24Hours)) return OPEN_24_HOURS
  if (days.some((day) => day.closed || day.open24Hours || !day.open || !day.close)) return null

  const first = range(days[0])

  return days.every((day) => range(day) === first) ? first : null
}

/**
 * Bir küme özetini cümleye çevirir: "Her gün 09:00 – 18:00", "Her gün kapalı",
 * "Her gün 24 Saat Açık".
 *
 * Durum adları (Kapalı / 24 Saat Açık) zaten kendi başına bir cümle olduğu için
 * biçimlendirme tek yerde toplanır; üç çağrı yerinin üç ayrı `? :` zinciri
 * yazması, bir gün birinin diğerinden sapması demek olurdu.
 */
function phrase(prefix, text) {
  if (text === CLOSED) return `${prefix} kapalı`
  return `${prefix} ${text}`
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
  if (everyDay) return phrase('Her gün', everyDay)

  const weekday = uniformText(workHours, WEEKDAYS)

  if (weekday) {
    const weekend = uniformText(workHours, WEEKEND)
    const weekdayText = phrase('Hafta içi', weekday)

    if (!weekend) return weekdayText
    return `${weekdayText}, ${phrase('hafta sonu', weekend)}`
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
    DAY_KEYS.map((key) => [
      key,
      { enabled: false, closed: false, open24Hours: false, open: '', close: '' },
    ]),
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
    /* Kapalı ya da 24 saat açık bir günün saati yoktur, dolayısıyla
       doğrulanacak bir şeyi de yoktur; bildirilmemiş günün ise hiç. */
    if (!day?.enabled || day.closed || day.open24Hours) continue

    if (!TIME_PATTERN.test(day.open ?? '') || !TIME_PATTERN.test(day.close ?? '')) {
      errors[key] = 'Açılış ve kapanış saati SS:dd biçiminde girilmelidir.'
      continue
    }

    /* GECE AŞIMI GEÇERLİDİR. Kapanışın sayıca küçük olması hata değildir:
       17:00 – 01:00 açılış günü başlayıp ERTESİ GÜN kapanan gerçek bir mesai
       aralığıdır ve bunu reddetmek, gece çalışan hiçbir işletmenin saatini
       giremeyeceği anlamına gelirdi. Geçersiz olan tek durum aralığın hiç
       olmamasıdır — aynı açılış ve kapanış. Eşitliği "24 saat açık" saymak da
       veriden türetilemeyen bir anlam uydurmak olurdu; 24 saat desteği
       istenirse kendi alanıyla açıkça eklenmelidir. */
    if (minutesOf(day.open) === minutesOf(day.close)) {
      errors[key] = 'Açılış ve kapanış saati aynı olamaz.'
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

    if (day.closed) {
      // Kapalı günde saat gönderilmez: sunucu da onları temizler.
      payload[key] = { closed: true }
      continue
    }

    /* 24 saat açık gün AÇIK bir bayrakla gider ve saat taşımaz. Bayrak yalnızca
       true iken yazılır: alanı hiç taşımayan eski gövde biçimi böylece bit bit
       aynı kalır ve "alan yoksa false" kuralı her iki yönde de geçerli olur. */
    payload[key] = day.open24Hours
      ? { closed: false, open24Hours: true }
      : { closed: false, open: day.open, close: day.close }
  }

  return Object.keys(payload).length ? payload : null
}

/**
 * API gövdesini forma geri çevirir — <see cref="buildWorkHoursPayload"/>'un
 * tersi.
 *
 * Düzenleme formu var olan bir kaydı açar ve o kaydın programını AYNI taslak
 * biçiminde göstermek zorundadır; aksi hâlde adı değiştirmek için formu açan
 * biri, kaydettiğinde mesai saatlerini sessizce silerdi.
 *
 * Üç durum korunur: gövdede hiç bulunmayan gün "bildirilmemiş" (enabled:false)
 * kalır, `closed: true` olan gün kapalı işaretlenir, saatli gün saatleriyle
 * gelir. Hiçbir değer UYDURULMAZ — eksik bir saat boş dize olarak açılır ve
 * doğrulama onu zaten yakalar.
 */
export function workHoursToDraft(workHours) {
  const draft = emptyWorkHoursDraft()

  if (!workHours || typeof workHours !== 'object') return draft

  for (const key of DAY_KEYS) {
    const day = workHours[key]
    if (!day) continue

    if (day.closed) {
      draft[key] = { enabled: true, closed: true, open24Hours: false, open: '', close: '' }
      continue
    }

    // Alanı taşımayan ESKİ kayıtlar için `open24Hours` yokluğu = false.
    draft[key] = day.open24Hours
      ? { enabled: true, closed: false, open24Hours: true, open: '', close: '' }
      : {
          enabled: true,
          closed: false,
          open24Hours: false,
          open: day.open ?? '',
          close: day.close ?? '',
        }
  }

  return draft
}

/**
 * İki haftalık programın ANLAMCA eşit olup olmadığı.
 *
 * Nesne kimliği ya da JSON metni karşılaştırılmaz: kullanıcı bir güne dokunup
 * eski hâline döndürebilir, alanları farklı sırada yazdırabilir ya da
 * bildirilmemiş bir günü açıp yeniden kapatabilir. Bunların hiçbiri programı
 * DEĞİŞTİRMEZ, ama ham karşılaştırma hepsini "değişti" sayardı.
 *
 * Kıyas bu yüzden kanonik gövde üzerinden ve SABİT gün sırasıyla yapılır
 * (<see cref="DAY_KEYS"/>): üç durum — bildirilmemiş, kapalı, saatli — ayrı
 * ayrı korunur ve hiçbir gün UYDURULMAZ. Girdi ham API gövdesi de olabilir,
 * `buildWorkHoursPayload` çıktısı da; ikisi de aynı biçimdedir.
 */
export function workHoursEqual(left, right) {
  for (const key of DAY_KEYS) {
    const a = left?.[key]
    const b = right?.[key]

    // Bildirilmemiş gün: iki tarafta da yoksa eşit, birinde varsa değil.
    if (!a || !b) {
      if (a || b) return false
      continue
    }

    if (Boolean(a.closed) !== Boolean(b.closed)) return false
    // Kapalı günün saatleri anlamsızdır ve karşılaştırmaya girmez.
    if (a.closed) continue

    /* 24 saat açık olmak ile saatli olmak FARKLI durumlardır: biri diğerine
       dönüştüğünde program değişmiştir. Alanı hiç taşımayan eski gövdeler
       `false` sayılır, dolayısıyla eski bir kayıt kendisiyle eşit kalır. */
    if (Boolean(a.open24Hours) !== Boolean(b.open24Hours)) return false
    if (a.open24Hours) continue

    if ((a.open ?? '') !== (b.open ?? '')) return false
    if ((a.close ?? '') !== (b.close ?? '')) return false
  }

  return true
}
