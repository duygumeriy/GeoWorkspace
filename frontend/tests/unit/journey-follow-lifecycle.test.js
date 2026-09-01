import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  JOURNEY_ADOPTION,
  JOURNEY_SIMULATION_STATUS,
  adoptedJourneyFollow,
} from '../../src/map/journeySimulationState.js'
import { createJourneyCameraLock, journeyCameraOwner } from '../../src/map/journeyVehicle.js'

/**
 * Faz 5E-B · Dilim 5 — GÖZLEM ≠ TAKİP.
 *
 * Yenilemeden sonra sunucudaki yolculuğu izlemeye devam etmek, kullanıcının
 * bıraktığı görüntüyü ele geçirmek DEĞİLDİR. Kural saf modülde durur ve burada
 * çalıştırılır; kancadaki bağlama ise ilgili geri çağrı/efekt ayıklanarak
 * denetlenir.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const SIM_HOOK = stripComments(read('../../src/hooks/useJourneySimulation.js'))
const VEHICLE_HOOK = stripComments(read('../../src/hooks/useJourneyVehicleLayer.js'))
const MAP_PAGE = stripComments(read('../../src/pages/MapPage.jsx'))

/** Adı verilen `useCallback` gövdesi. */
const callbackBody = (source, name) => {
  const from = source.indexOf(`const ${name} = useCallback(`)
  assert.ok(from > 0, `${name} bulunamadı`)
  return source.slice(from, source.indexOf('}, [', from))
}

/**
 * İçinde verilen işareti geçen `useEffect` çağrısının TAMAMI.
 *
 * Sınır, ilk `])` aranarak bulunamaz: gövdedeki sıradan bir dizi kapanışı
 * (`fromLonLat([...])`) iddiayı sessizce yarıda keserdi. Parantezler sayılır.
 */
const effectWith = (source, marker) => {
  const bodies = source.split('useEffect(').slice(1)
  const found = bodies.find((body) => body.includes(marker))
  assert.ok(found, `${marker} efekti bulunamadı`)

  let depth = 1
  for (let index = 0; index < found.length; index += 1) {
    const char = found[index]
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return found.slice(0, index + 1)
    }
  }

  return assert.fail(`${marker} efektinin kapanışı bulunamadı`)
}

/* --- 1/7. Benimseme kaynağı kamerayı belirler ------------------------------------ */

test('only a freshly started journey claims the camera', () => {
  assert.equal(adoptedJourneyFollow(JOURNEY_ADOPTION.START), true)
  assert.equal(adoptedJourneyFollow(JOURNEY_ADOPTION.RECOVERY), false)
})

test('an unknown or missing adoption source never claims the camera', () => {
  /* Kural KAPALI tarafa düşer: yeni bir benimseme yolu eklendiğinde kamera
     sessizce ele geçirilmez, bilinçli olarak açılması gerekir. */
  for (const value of [undefined, null, '', 'reconnect', 'unknown']) {
    assert.equal(adoptedJourneyFollow(value), false)
  }
})

test('the adoption sources are an explicit, frozen vocabulary', () => {
  // Zamanlamadan ya da eksik alandan ÇIKARILMAZ: çağıran açıkça söyler.
  assert.deepEqual(Object.keys(JOURNEY_ADOPTION).sort(), ['RECOVERY', 'START'])
  assert.ok(Object.isFrozen(JOURNEY_ADOPTION))
})

test('camera ownership starts closed and every adoption writes it explicitly', () => {
  assert.match(SIM_HOOK, /const \[following, setFollowing\] = useState\(false\)/)

  // İki benimseme yolu da değeri KURALDAN yazar; ikinci bir "true" yoktur.
  const writes = SIM_HOOK.match(/setFollowing\([^)]*\)/g) ?? []
  assert.ok(!writes.includes('setFollowing(true)'), 'koşulsuz kamera talebi kaldı')
  assert.equal(
    writes.filter((call) => call.includes('adoptedJourneyFollow')).length,
    2,
    'başlatma ve kurtarma kuralı birlikte kullanmalı',
  )
})

/* --- 1/2/3/4. Kurtarma: gözle, ama kamerayı alma ---------------------------------- */

test('recovery adopts the run, rejoins the hub and does not claim the camera', () => {
  const recovery = effectWith(SIM_HOOK, 'fetchCurrentJourneySimulation')

  // Benimseme: sunucunun gövdesi ve anlık görüntüsü olduğu gibi alınır.
  assert.match(recovery, /setSimulation\(body\)/)
  assert.match(recovery, /setSnapshot\(body\.snapshot \?\? null\)/)
  // Gözlem sürer: SignalR grubuna yeniden katılınır.
  assert.match(recovery, /await join\(body\.simulationId\)/)

  // Kamera AÇIKÇA bırakılır; sezgiyle değil, kuralla.
  assert.match(recovery, /setFollowing\(adoptedJourneyFollow\(JOURNEY_ADOPTION\.RECOVERY\)\)/)
})

test('recovery never restarts, previews, stops or recentres', () => {
  const recovery = effectWith(SIM_HOOK, 'fetchCurrentJourneySimulation')

  for (const forbidden of [
    'startJourneySimulation',
    'stopJourneySimulation',
    'previewJourney',
    'setFollowing(true)',
    'toggleFollow',
    'view.animate',
    'setCenter',
    'setZoom',
  ]) {
    assert.ok(!recovery.includes(forbidden), `kurtarma ${forbidden} çağırıyor`)
  }

  // Ve geometri istemcide yeniden kurulmaz: gövde olduğu gibi otoritedir.
  assert.ok(!recovery.includes('geometryWkt'))
})

/* --- 5/6. Açık takip eylemi ------------------------------------------------------- */

test('follow is an explicit toggle that never touches observation', () => {
  assert.match(SIM_HOOK, /\bfollowing,\s*\n\s*setFollowing,/)

  const toggle = callbackBody(MAP_PAGE, 'toggleJourneyFollow')
  // false -> true ve true -> false: tek eylem, iki yön.
  assert.match(toggle, /setFollowing\(\(current\) => !current\)/)

  /* Takibi açmak/kapatmak aboneliğe DOKUNMAZ: gözlem ve kamera ayrı
     eksenlerdir. */
  for (const forbidden of ['join(', 'leave(', 'stopJourneySimulation', 'dismiss(']) {
    assert.ok(!toggle.includes(forbidden), `takip düğmesi ${forbidden} çağırıyor`)
  }
})

/* --- 8/9/10. Sahiplik miras kalmaz ------------------------------------------------ */

test('a terminal snapshot releases the camera along with the group', () => {
  const terminal = effectWith(SIM_HOOK, 'isTerminalJourneyStatus(snapshot.status)')

  assert.match(terminal, /leave\(\)/)
  assert.match(terminal, /setFollowing\(false\)/)
  // Sonuç EKRANDA kalır: terminal olmak veriyi silmez.
  assert.ok(!terminal.includes('setSimulation(null)'))
  assert.ok(!terminal.includes('setSnapshot(null)'))
})

test('dismiss leaves no camera claim behind and still makes no backend stop call', () => {
  const dismiss = callbackBody(SIM_HOOK, 'dismiss')

  assert.match(dismiss, /setFollowing\(false\)/)
  assert.match(dismiss, /setSimulation\(null\)/)
  assert.ok(!dismiss.includes('stopJourneySimulation'))
})

test('a new run cannot inherit the previous run camera ownership', () => {
  /* Kancada: her benimseme yolu değeri yazar (yukarıda ölçüldü).
     Katmanda: sahip kimliği değişince uçan animasyonun bayrağı düşer. */
  const previous = { simulationId: 'sim-1', longitude: 36.3, latitude: 41.2 }
  const next = { simulationId: 'sim-2', longitude: 36.3, latitude: 41.2 }

  assert.equal(journeyCameraOwner({ following: true, presentation: previous }), 'sim-1')
  assert.notEqual(
    journeyCameraOwner({ following: true, presentation: next }),
    journeyCameraOwner({ following: true, presentation: previous }),
  )
})

/* --- 11/12/13. Kamera sahipliği kuralı ------------------------------------------- */

test('ownership ends when following stops or the vehicle disappears', () => {
  const presentation = { simulationId: 'sim-1', longitude: 36.3, latitude: 41.2 }

  assert.equal(journeyCameraOwner({ following: false, presentation }), null)
  assert.equal(journeyCameraOwner({ following: true, presentation: null }), null)
  assert.equal(journeyCameraOwner({ following: false, presentation: null }), null)
  assert.equal(journeyCameraOwner(), null)

  // Aynı yolculuk sürerken sahip DEĞİŞMEZ: kısma davranışı korunur.
  assert.equal(journeyCameraOwner({ following: true, presentation }), 'sim-1')
  assert.equal(
    journeyCameraOwner({ following: true, presentation: { ...presentation, longitude: 36.9 } }),
    'sim-1',
  )
})

test('the layer resets the animation lock exactly when ownership changes', () => {
  const ownership = effectWith(VEHICLE_HOOK, 'journeyCameraOwner')

  assert.match(ownership, /const owner = journeyCameraOwner\(\{ following, presentation \}\)/)
  // Sahip aynıysa hiçbir şey yapılmaz — uçan animasyon kesilmez.
  assert.match(ownership, /if \(owner === followedSimulationRef\.current\) return/)
  assert.match(ownership, /followedSimulationRef\.current = owner/)
  assert.match(ownership, /cameraLockRef\.current\.invalidate\(\)/)
  assert.match(ownership, /\}, \[following, presentation\]\)/)

  /* Sıra önemlidir: sahiplik efekti kamera efektinden ÖNCE gelmeli ki
     devralan taraf aynı commit'te temiz bayrakla başlasın. */
  assert.ok(VEHICLE_HOOK.indexOf('journeyCameraOwner({ following, presentation })') < VEHICLE_HOOK.indexOf('vehicleCameraTarget({'))
})

test('teardown cannot leave a permanently stale animation flag', () => {
  const layer = effectWith(VEHICLE_HOOK, 'createJourneyVehicleLayer()')

  assert.match(layer, /map\.removeLayer\(layer\)/)
  assert.match(layer, /cameraLockRef\.current\.invalidate\(\)/)
  assert.match(layer, /followedSimulationRef\.current = null/)
})

/* --- 14/15. Animasyon ve mevcut kamera sözleşmesi --------------------------------- */

test('a finished animation releases the lock through its own token', () => {
  const camera = effectWith(VEHICLE_HOOK, 'vehicleCameraTarget({')

  // Animasyon başlarken KENDİ kuşağını taşıyan bir jeton alır…
  assert.match(camera, /const token = lock\.begin\(\)/)
  // …ve geri çağrı yalnızca o jetonla kilidi bırakmayı DENER.
  assert.match(camera, /\(\) => \{ lock\.release\(token\) \}/)
  // Yeni bir animasyon, uçan biri varken kuyruğa EKLENMEZ.
  assert.match(camera, /if \(!target \|\| lock\.isAnimating\) return/)
})

/* --- Bayat geri çağrı yarışı ------------------------------------------------------ */

test('a stale callback from a previous owner cannot unlock the new owner animation', () => {
  /* Yarışın TAMAMI çalıştırılır. OpenLayers yeni bir `view.animate` çağrısında
     önceki animasyonun geri çağrısını da tetikler; o geri çağrı, sahiplik
     değiştikten sonra gelir. */
  const lock = createJourneyCameraLock()

  // 1) A sahibi altında animasyon başlar.
  const tokenA = lock.begin()
  assert.equal(lock.isAnimating, true)

  // 2) Sahiplik değişir (yeni yolculuk / takip kapanıp açılır / araç değişir).
  lock.invalidate()
  assert.equal(lock.isAnimating, false)

  // 3) B sahibi altında yeni animasyon başlar.
  const tokenB = lock.begin()
  assert.equal(lock.isAnimating, true)
  assert.notEqual(tokenA, tokenB)

  // 4) BAYAT A geri çağrısı gelir: B'nin kilidini AÇAMAZ.
  assert.equal(lock.release(tokenA), false)
  assert.equal(lock.isAnimating, true, 'bayat geri çağrı yeni sahibin kilidini açtı')

  // 5) B'nin kendi geri çağrısı kilidi bırakır.
  assert.equal(lock.release(tokenB), true)
  assert.equal(lock.isAnimating, false)
})

test('the same owner completing normally still releases the lock', () => {
  const lock = createJourneyCameraLock()

  const token = lock.begin()
  assert.equal(lock.isAnimating, true)
  assert.equal(lock.release(token), true)
  assert.equal(lock.isAnimating, false)

  // Ve arka arkaya iki animasyon aynı sahiplikte sorunsuz akar.
  const next = lock.begin()
  assert.equal(next, token, 'aynı sahiplikte kuşak değişmemeli')
  assert.equal(lock.release(next), true)
})

test('every ownership invalidation opens the lock and burns the old generation', () => {
  const lock = createJourneyCameraLock()

  /* Sahiplik bitişinin ÜÇ yolu da aynı çağrıya iner (takip kapandı, araç
     kayboldu, kimlik değişti) ve hepsi jetonları geçersizler. */
  const stale = lock.begin()
  const first = lock.invalidate()
  const second = lock.invalidate()

  assert.notEqual(first, second)
  assert.equal(lock.isAnimating, false)
  assert.equal(lock.release(stale), false)

  // Geçersizleme kilidi AÇAR: devralan taraf hemen animasyon başlatabilir.
  const fresh = lock.begin()
  assert.equal(lock.isAnimating, true)
  assert.equal(lock.release(fresh), true)
})

test('a stale callback arriving after teardown cannot lock out a remount', () => {
  /* Sökülmede geri çağrı hiç gelmeyebilir; geldiğinde de kilide dokunmamalı.
     İkisi de aynı mekanizmayla karşılanır. */
  const lock = createJourneyCameraLock()
  const stale = lock.begin()

  lock.invalidate() // teardown
  assert.equal(lock.isAnimating, false)

  const afterRemount = lock.begin()
  assert.equal(lock.release(stale), false)
  assert.equal(lock.isAnimating, true)
  assert.equal(lock.release(afterRemount), true)
})

test('the safe box and the no-zoom-reset contract are untouched', () => {
  const camera = effectWith(VEHICLE_HOOK, 'vehicleCameraTarget({')

  // Güvenli kutu hesabı hâlâ paylaşılan saf yardımcıdadır; kopyalanmadı.
  assert.match(camera, /vehicleCameraTarget\(\{\s*coordinate,\s*center: view\.getCenter\(\),\s*resolution: view\.getResolution\(\),\s*size: map\.getSize\(\),\s*\}\)/)
  assert.match(camera, /\{ center: target, duration: cameraDuration \}/)

  // Zum HİÇ verilmez ve eşik/animasyon süresi bu dilimde değişmedi.
  assert.ok(!camera.includes('zoom'))
  assert.ok(!camera.includes('edgeRatio'))
  assert.ok(!VEHICLE_HOOK.includes('requestAnimationFrame'))
  assert.ok(!VEHICLE_HOOK.includes('setInterval'))
  // İptal çağrısıyla çözülmedi: başka animasyonlar da öldürülürdü.
  assert.ok(!VEHICLE_HOOK.includes('cancelAnimations'))
  assert.match(VEHICLE_HOOK, /cameraDuration = 400/)
})

/* --- Gözlem ve kamera ayrı eksenler ---------------------------------------------- */

test('observation and camera ownership never share a code path', () => {
  const join = callbackBody(SIM_HOOK, 'join')
  const leave = callbackBody(SIM_HOOK, 'leave')

  for (const [name, body] of [['join', join], ['leave', leave]]) {
    assert.ok(!body.includes('setFollowing'), `${name} kamera sahipliğine dokunuyor`)
    assert.ok(!body.includes('animating'), `${name} kamera animasyonuna dokunuyor`)
  }

  // Ve kamera katmanı hiçbir zaman hub'a ya da sunucuya dokunmaz.
  for (const forbidden of ['signalR', 'HubConnection', 'fetch(', 'join(', 'leave(']) {
    assert.ok(!VEHICLE_HOOK.includes(forbidden), `araç katmanı ${forbidden} kullanıyor`)
  }
})

test('recovery still restores the phase the panel renders', () => {
  /* Kurtarılan çalıştırma ACTIVE olarak görünür; kamera kapalı olması bunu
     değiştirmez — gözlem ile takip ayrı eksenlerdir. */
  const running = { simulationId: 'sim-1', status: JOURNEY_SIMULATION_STATUS.RUNNING, progressPercent: 10 }
  assert.equal(adoptedJourneyFollow(JOURNEY_ADOPTION.RECOVERY), false)
  assert.equal(journeyCameraOwner({ following: false, presentation: { simulationId: running.simulationId } }), null)
})
