import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fromLonLat } from 'ol/proj.js'
import {
  JOURNEY_FALLBACK_PROFILE_ICON,
  JOURNEY_PROFILE_ICONS,
  journeyProfileIcon,
} from '../../src/components/map/journeyProfileIcons.js'
import {
  JOURNEY_VEHICLE_KIND,
  createJourneyVehicleLayer,
  journeyVehicleBadgeDataUri,
  syncJourneyVehicleFeature,
} from '../../src/map/journeyVehicle.js'
import { JOURNEY_PROFILE_IDS } from '../../src/map/journeyPlanning.js'

/**
 * Faz 5E-B · Dilim 6 — panel ile harita AYNI dili konuşur.
 *
 * Ölçülen şey görsel semantiktir: üç profil, üç ayrı sembol, tek sözlük ve
 * emoji yok. Rozetin kendisi (SVG `data:` URI) burada üretilerek incelenir;
 * bir DOM'a ya da haritaya ihtiyaç yoktur.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const VEHICLE = stripComments(read('../../src/map/journeyVehicle.js'))
const VEHICLE_HOOK = stripComments(read('../../src/hooks/useJourneyVehicleLayer.js'))
const PANEL = stripComments(read('../../src/components/map/JourneyPlannerPanel.jsx'))
const MAP_PAGE = stripComments(read('../../src/pages/MapPage.jsx'))
const ICONS = stripComments(read('../../src/components/map/journeyProfileIcons.js'))

/** Rozet SVG'sini `data:` URI'den geri çözer. */
const badgeSvg = (profileId) => {
  const uri = journeyVehicleBadgeDataUri(profileId)
  assert.ok(uri.startsWith('data:image/svg+xml;charset=utf-8,'), 'rozet bir data: URI olmalı')
  return decodeURIComponent(uri.slice('data:image/svg+xml;charset=utf-8,'.length))
}

/* --- 1/2/6. Tam olarak üç semantik ------------------------------------------------ */

test('exactly three live marker semantics exist and they match the planner profiles', () => {
  assert.deepEqual(Object.keys(JOURNEY_PROFILE_ICONS).sort(), ['cycling', 'driving', 'walking'])
  assert.ok(Object.isFrozen(JOURNEY_PROFILE_ICONS))

  // Sözlük, planlayıcının kanonik profil kimlikleriyle BİREBİR aynıdır.
  assert.deepEqual(Object.keys(JOURNEY_PROFILE_ICONS).sort(), [...JOURNEY_PROFILE_IDS].sort())
})

test('bus and other transit modes have no marker semantic at all', () => {
  for (const absent of ['bus', 'tram', 'train', 'ferry', 'transit']) {
    assert.equal(JOURNEY_PROFILE_ICONS[absent], undefined)
    // Bilinmeyen profil uydurulmaz: güvenli varsayılana düşer.
    assert.equal(journeyProfileIcon(absent), JOURNEY_FALLBACK_PROFILE_ICON)
  }

  for (const source of [ICONS, VEHICLE, PANEL]) {
    for (const forbidden of ['BusFront', 'TramFront', 'TrainFront', 'Bus', 'Train']) {
      assert.ok(!source.includes(forbidden), `transit ikonu sızdı (${forbidden})`)
    }
  }
})

test('an unknown or malformed profile fails safely instead of throwing', () => {
  for (const value of [undefined, null, '', 0, 'DRIVING', { id: 'driving' }]) {
    assert.equal(journeyProfileIcon(value), JOURNEY_FALLBACK_PROFILE_ICON)
    assert.doesNotThrow(() => journeyVehicleBadgeDataUri(value))
  }

  // Güvenli varsayılan sürüş görünümüdür, uydurma bir taşıma türü değil.
  assert.equal(JOURNEY_FALLBACK_PROFILE_ICON, JOURNEY_PROFILE_ICONS.driving)
})

/* --- 3/4/5. Her profil kendi sembolünü çizer -------------------------------------- */

test('driving, walking and cycling each render their own distinct badge', () => {
  const driving = badgeSvg('driving')
  const walking = badgeSvg('walking')
  const cycling = badgeSvg('cycling')

  // Üç ayrı görsel: aynı sembolü iki profile vermek semantiği yok ederdi.
  assert.equal(new Set([driving, walking, cycling]).size, 3)

  /* Sembol gövdeleri Lucide'ın kendi çizimidir; her biri gerçek bir SVG yolu
     taşır ve rozet üç katmanlı kalır (kılıf, disk, sembol). */
  for (const svg of [driving, walking, cycling]) {
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
    assert.match(svg, /viewBox="0 0 24 24"/)
    // Rozetin İKİ katmanı her profilde aynıdır; üstündeki sembol değişir.
    assert.match(svg, /<circle cx="12" cy="12" r="11" fill="rgba\(255, 255, 255, 0\.92\)"\/>/)
    assert.match(svg, /<circle cx="12" cy="12" r="9\.5" fill="#7c3aed"\/>/)
    assert.match(svg, /stroke="#FFFFFF"/)
    // Sembol gövdesi gerçek bir Lucide çizimidir, boş bir grup değil.
    assert.ok(/<path|<circle|<line|<polyline|<rect/.test(svg.slice(svg.indexOf('<g transform='))))
  }

  // Bilinmeyen profil sürüş rozetiyle aynı çizimi verir.
  assert.equal(badgeSvg('bus'), driving)
})

test('the badge is small, restrained and readable over any basemap', () => {
  const svg = badgeSvg('driving')

  // Beyaz kılıf + vurgu diski: açık ve koyu altlıkta da ayırt edilir.
  assert.match(svg, /<circle cx="12" cy="12" r="11" fill="rgba\(255, 255, 255, 0\.92\)"\/>/)
  assert.match(svg, /<circle cx="12" cy="12" r="9\.5" fill="#7c3aed"\/>/)

  /* Ölçü ölçülüdür: 28px'lik işaretçi, retina için iki katı üretilir ve
     OpenLayers tarafında geri ölçeklenir. */
  assert.match(svg, /width="56" height="56"/)
  assert.match(VEHICLE, /scale: 1 \/ SOURCE_SCALE/)

  // Gölge, animasyon, karikatür ya da logo yoktur.
  for (const forbidden of ['filter', 'animate', 'feDropShadow', '<image', 'logo']) {
    assert.ok(!svg.includes(forbidden), `rozet ${forbidden} içeriyor`)
  }
})

/* --- 13/14. Emoji, yeni paket ya da ağ yok --------------------------------------- */

test('no emoji marker remains anywhere in the journey live vehicle path', () => {
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u

  for (const [name, source] of [
    ['journeyVehicle.js', VEHICLE],
    ['useJourneyVehicleLayer.js', VEHICLE_HOOK],
    ['journeyProfileIcons.js', ICONS],
  ]) {
    assert.ok(!emoji.test(source), `${name} hâlâ emoji taşıyor`)
  }

  // Eski glif API'si tamamen kalktı; ikinci bir sözlük geri gelemez.
  assert.ok(!VEHICLE.includes('journeyVehicleGlyph'))
  assert.ok(!VEHICLE.includes('PROFILE_GLYPHS'))
  assert.ok(!VEHICLE.includes('new Text('))
})

test('the badge introduces no icon package, CDN or network request', () => {
  // Sembol uygulamanın MEVCUT görsel dilinden gelir.
  assert.match(ICONS, /from 'lucide-react'/)

  const uri = journeyVehicleBadgeDataUri('walking')
  assert.ok(uri.startsWith('data:'), 'rozet bellekte üretilen bir data: URI olmalı')

  for (const source of [ICONS, VEHICLE]) {
    for (const forbidden of ['https://', 'cdn', 'fetch(', 'XMLHttpRequest', 'import(']) {
      assert.ok(!source.includes(forbidden), `rozet ağa çıkıyor (${forbidden})`)
    }
  }

  /* Kaynakta geçen TEK adres, SVG'nin ad alanı bildirimidir — bir istek değil.
     Başka bir http adresi (uzak simge, CDN) sızarsa bu iddia kırılır. */
  const addresses = new Set(VEHICLE.match(/https?:\/\/[^\s"'`)]*/g) ?? [])
  assert.deepEqual([...addresses], ['http://www.w3.org/2000/svg'])
  assert.equal((ICONS.match(/https?:\/\//g) ?? []).length, 0)

  assert.match(badgeSvg('walking'), /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
})

test('the badge is built once per profile and cached', () => {
  /* Stil fonksiyonu her karede çağrılabilir; SVG'yi yeniden kurmak haritayı
     kilitlerdi. Aynı profil AYNI dizeyi döndürür. */
  assert.equal(journeyVehicleBadgeDataUri('cycling'), journeyVehicleBadgeDataUri('cycling'))
  assert.match(VEHICLE, /badgeCache/)
  assert.match(VEHICLE, /glyphCache/)
})

/* --- 7/8/9/10. Hareket sözleşmesi değişmedi --------------------------------------- */

const SIM = 'sim-1'

test('the marker still owns exactly one feature, updated in place', () => {
  const { source } = createJourneyVehicleLayer()

  const first = syncJourneyVehicleFeature(source, {
    simulationId: SIM, profileId: 'walking', longitude: 30, latitude: 40,
  })
  assert.equal(source.getFeatures().length, 1)
  assert.equal(first.get('featureKind'), JOURNEY_VEHICLE_KIND)

  const second = syncJourneyVehicleFeature(source, {
    simulationId: SIM, profileId: 'walking', longitude: 31, latitude: 41,
  })

  assert.equal(second, first, 'saniyede bir yeni feature üretilmemeli')
  assert.equal(source.getFeatures().length, 1)
  // Koordinat SUNUCUNUN sunumundan gelir.
  assert.deepEqual(second.getGeometry().getCoordinates(), fromLonLat([31, 41]))
})

test('changing the profile restyles the marker without moving or duplicating it', () => {
  const { source } = createJourneyVehicleLayer()

  const first = syncJourneyVehicleFeature(source, {
    simulationId: SIM, profileId: 'driving', longitude: 30, latitude: 40,
  })
  const second = syncJourneyVehicleFeature(source, {
    simulationId: SIM, profileId: 'cycling', longitude: 30, latitude: 40,
  })

  assert.equal(second, first)
  assert.equal(source.getFeatures().length, 1)
  assert.equal(second.get('profileId'), 'cycling')
  // Konum profil yüzünden DEĞİŞMEZ: profil yalnızca bir görünümdür.
  assert.deepEqual(second.getGeometry().getCoordinates(), fromLonLat([30, 40]))
})

test('profile never participates in movement, progress or duration', () => {
  /* Rozet yalnızca stil fonksiyonunda okunur; konum/ilerleme hesabına hiç
     girmez. */
  assert.match(VEHICLE, /style: \(feature\) => journeyVehicleStyle\(feature\.get\('profileId'\)\)/)

  const sync = VEHICLE.slice(VEHICLE.indexOf('export function syncJourneyVehicleFeature'))
  for (const forbidden of ['progressPercent', 'distanceCovered', 'durationSeconds', 'speed']) {
    assert.ok(!sync.includes(forbidden), `eşitleme ${forbidden} okuyor`)
  }
})

/* --- 11/12. Canlı profilin OTORİTESİ --------------------------------------------- */

test('the live marker profile comes from the adopted simulation, not planner state', () => {
  const presentation = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const journeyVehicle = useMemo('),
    MAP_PAGE.indexOf('}, [journeySimulation.simulation, journeySimulation.snapshot])'),
  )

  // Kaynak: sunucunun benimsenmiş çalıştırma ayrıntıları.
  assert.match(presentation, /profileId: journeySimulation\.simulation\.requestedProfile/)

  /* Başlattıktan SONRA panelde profil değiştirmek çalışan işaretçiyi
     yeniden boyamaz: planlayıcı durumu buraya HİÇ girmez. */
  assert.ok(!presentation.includes('journey.state.profile'))
  assert.ok(!presentation.includes('journey.preview'))
})

test('recovery renders the same profile contract as a fresh start', () => {
  /* Kurtarma da aynı gövdeyi (`simulation`) benimser; sunum tek bir yerden
     türetildiği için iki yol arasında görsel fark oluşamaz. */
  const hook = stripComments(read('../../src/hooks/useJourneySimulation.js'))
  assert.match(hook, /setSimulation\(body\)/)
  assert.equal((hook.match(/setSimulation\(body\)/g) ?? []).length, 2, 'başlatma ve kurtarma aynı alanı yazmalı')

  // Ve sunum yalnızca o alandan okur (yukarıdaki testte ölçüldü).
  assert.match(MAP_PAGE, /profileId: journeySimulation\.simulation\.requestedProfile/)
})

/* --- 15/16. Komşu ürünler ve kamera --------------------------------------------- */

test('the fixed-route transport vehicle implementation is untouched', () => {
  const transport = read('../../src/map/transportVehicle.js')
  const transportHook = read('../../src/hooks/useTransportVehicleLayer.js')

  // Paylaşılan araç kendi görünümünü korur; yolculuk rozetini tanımaz.
  for (const source of [transport, transportHook]) {
    assert.ok(!source.includes('journeyProfileIcon'))
    assert.ok(!source.includes('journeyVehicleBadgeDataUri'))
    assert.ok(!source.includes('JOURNEY_VEHICLE'))
  }

  // İki katman ayrı kalır.
  assert.ok(transport.includes('TRANSPORT_VEHICLE_LAYER_CLASSNAME'))
})

test('the camera contracts survive the visual change', () => {
  // Rozet bir STİL kararıdır; kamera kodu ona hiç bakmaz.
  assert.ok(!VEHICLE_HOOK.includes('profileId'))
  assert.ok(!VEHICLE_HOOK.includes('BadgeDataUri'))

  // Güvenli kutu ve zum sözleşmesi yerinde.
  assert.match(VEHICLE_HOOK, /vehicleCameraTarget\(\{/)
  assert.ok(!VEHICLE_HOOK.includes('zoom'))
  assert.match(VEHICLE_HOOK, /cameraDuration = 400/)
})
