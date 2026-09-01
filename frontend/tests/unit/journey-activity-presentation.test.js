import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  activityContext,
  journeyActivityContext,
  transportActivityContext,
} from '../../src/map/transportActivityPresentation.js'

/**
 * Faz 5E-B · Dilim 7B — yolculuk olaylarının GÜVENLİ sunumu.
 *
 * Aynı defter, aynı ekran, aynı çözümleyici: yeni bir aktivite sayfası ya da
 * ikinci bir ayrıştırıcı yoktur. Ölçülen şey, ayrıntıların okunabilir Türkçeye
 * çevrilmesi ve tanınmayan içeriğin ASLA ham JSON olarak sızmamasıdır.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

const PAGE = read('../../src/pages/admin/ActivityPage.jsx')
const PRESENTATION = read('../../src/map/transportActivityPresentation.js')

const details = (patch = {}) => JSON.stringify({
  kind: 'JourneyStarted',
  simulationId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  mode: 'RouteSegment',
  profile: 'Driving',
  ...patch,
})

/* --- 15/16/17. Üç olay da okunabilir --------------------------------------------- */

test('a started journey is presented in safe Turkish', () => {
  const context = journeyActivityContext(details({ routeId: 7, distanceMeters: 4200, durationSeconds: 600 }))

  assert.match(context, /Profil: Araç/)
  assert.match(context, /Tür: İki durak arası/)
  assert.match(context, /Hat #7/)
  // Ham JSON ya da alan adları görünmez.
  assert.ok(!context.includes('{'))
  assert.ok(!context.includes('kind'))
})

test('a cancelled journey shows its final server progress', () => {
  const context = journeyActivityContext(details({
    kind: 'JourneyCancelled',
    profile: 'Cycling',
    mode: 'Waypoints',
    waypointCount: 3,
    progressPercent: 61.4,
  }))

  assert.match(context, /Profil: Bisiklet/)
  assert.match(context, /Tür: Özel rota/)
  assert.match(context, /3 nokta/)
  // Yüzde SUNUCUNUN değeridir; burada yalnızca gösterim için yuvarlanır.
  assert.match(context, /Tamamlanma: %61/)
})

test('a completed journey shows one hundred percent from the server', () => {
  const context = journeyActivityContext(details({
    kind: 'JourneyCompleted',
    profile: 'Walking',
    mode: 'RouteFull',
    progressPercent: 100,
  }))

  assert.match(context, /Profil: Yaya/)
  assert.match(context, /Tür: Tam güzergâh/)
  assert.match(context, /Tamamlanma: %100/)
})

/* --- 18/20. Profil sözlüğü --------------------------------------------------------- */

test('exactly three profiles are labelled and transit is absent', () => {
  assert.match(journeyActivityContext(details({ profile: 'Driving' })), /Profil: Araç/)
  assert.match(journeyActivityContext(details({ profile: 'Walking' })), /Profil: Yaya/)
  assert.match(journeyActivityContext(details({ profile: 'Cycling' })), /Profil: Bisiklet/)

  /* Otobüs/tramvay/tren bir profil DEĞİLDİR: tanınmayan değer sessizce
     atlanır, uydurma bir etiket üretilmez. */
  const bus = journeyActivityContext(details({ profile: 'Bus' }))
  assert.ok(!bus.includes('Profil:'))
  assert.ok(!bus.includes('Bus'))

  /* Sözlükte transit KARŞILIĞI yoktur. Yorumlar ayıklanır: bir kavramın
     yokluğunu ANLATMAK ile onu uygulamak farklı şeylerdir. */
  const code = PRESENTATION.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
  for (const forbidden of ['Otobüs', 'Tramvay', 'Tren', 'Bus:', "'Bus'"]) {
    assert.ok(!code.includes(forbidden), `transit semantiği sızdı (${forbidden})`)
  }
})

/* --- 19. Bozuk ayrıntı asla ham gösterilmez ---------------------------------------- */

test('malformed or unknown details never reach the screen as raw JSON', () => {
  for (const value of [
    null,
    undefined,
    '',
    'not json',
    '[]',
    '{"kind":"SomethingElse"}',
    JSON.stringify({ kind: 'JourneyStarted' }),
  ]) {
    const context = journeyActivityContext(value)
    assert.ok(context === null || !context.includes('{'), `ham JSON sızdı: ${value}`)
  }

  // Tanınmayan hiçbir alanı olmayan bir yolculuk olayı null döner…
  assert.equal(journeyActivityContext(JSON.stringify({ kind: 'JourneyStarted' })), null)
  /* …ve sayfa yalnızca ÇÖZÜLMÜŞ bağlamı çizer: ham `details` alanı hiçbir
     yerde doğrudan render edilmez. */
  assert.match(PAGE, /\{context && <small className="admin-transport-activity-context">\{context\}<\/small>\}/)
  assert.ok(!PAGE.includes('{item.details}'))
  assert.equal((PAGE.match(/item\.details/g) ?? []).length, 1, 'details yalnızca çözümleyiciye verilmeli')
})

test('numeric fields are ignored unless they are real numbers', () => {
  const context = journeyActivityContext(details({
    routeId: 'seven',
    waypointCount: 2.5,
    progressPercent: 'çok',
  }))

  assert.ok(!context.includes('Hat #'))
  assert.ok(!context.includes('nokta'))
  assert.ok(!context.includes('Tamamlanma'))
  // Yine de tanınan alanlar okunur kalır.
  assert.match(context, /Profil: Araç/)
})

test('progress is clamped for display without inventing a value', () => {
  assert.match(journeyActivityContext(details({ progressPercent: 140 })), /Tamamlanma: %100/)
  assert.match(journeyActivityContext(details({ progressPercent: -5 })), /Tamamlanma: %0/)
})

/* --- 21. Mevcut kayıtlar değişmedi ------------------------------------------------ */

test('existing transport activity presentation is unchanged', () => {
  const transport = JSON.stringify({
    kind: 'StopCoordinateMove',
    stopId: 71,
    stopName: 'Batı',
    routeId: 7,
    routeName: 'Hat 1',
  })

  assert.equal(transportActivityContext(transport), 'Batı #71 · Hat 1 #7 · konum güncellendi')
  // Ortak giriş noktası da aynı sonucu verir: ulaşım önce çözülür.
  assert.equal(activityContext(transport), transportActivityContext(transport))

  // Ve yolculuk çözümleyicisi ulaşım olaylarına HİÇ karışmaz.
  assert.equal(journeyActivityContext(transport), null)
  assert.equal(transportActivityContext(details()), null)
})

test('the page reads one shared context helper for every product', () => {
  assert.match(PAGE, /import \{ activityContext \} from '\.\.\/\.\.\/map\/transportActivityPresentation\.js'/)
  assert.match(PAGE, /const context = activityContext\(item\.details\)/)

  // Kaynak etiketi de mevcut sözlüğe eklendi; yeni bir ekran açılmadı.
  assert.match(PAGE, /journey_simulation: 'Yolculuk simülasyonu'/)
  assert.equal((PAGE.match(/admin-activity-rows/g) ?? []).length, 1)
})

test('no client side lifecycle record is ever created in the browser', () => {
  /* Denetim kaydı SUNUCUDA doğar. Tarayıcı yalnızca okur; buradan bir yazma
     ucu ya da yerel bir günlük çağrılmaz. */
  for (const forbidden of ['POST', 'writeActivity', 'logActivity', 'activityLog(']) {
    assert.ok(!PRESENTATION.includes(forbidden), `sunum katmanı kayıt yazıyor (${forbidden})`)
  }
})
