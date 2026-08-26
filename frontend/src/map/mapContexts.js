/**
 * Haritanın BİRİNCİL bağlam kimlikleri ve aralarındaki tek yapısal ilişki.
 *
 * ## Sorun
 *
 * Harita üzerindeki her bağlamsal panel kendi açık/kapalı durumunu ayrı bir
 * state'te tutuyordu: `activePanel` (kenar çubuğu panelleri), `styleTarget`,
 * seçim sayısından türetilen çizim panelleri, `selectedPoi`, `poiFormOpen` ve
 * analiz sonucunun kendisi. Hiçbiri diğerini bilmediği için bir panel açıkken
 * başka bir bağlama geçmek ESKİ paneli ekranda bırakıyordu; kullanıcı önce
 * eskisini elle kapatmak zorundaydı.
 *
 * Bunu her tıklama işleyicisine `setŞunuKapat(false)` serpiştirerek çözmek
 * N×N'lik bir özel durum matrisi üretirdi: yeni bir panel eklemek, mevcut tüm
 * panellerin işleyicilerine dokunmak demek olurdu.
 *
 * ## Çözüm
 *
 * Bağlam sahipliği TEK bir state'e taşınır (`useMapContext`). Aynı anda en
 * fazla bir birincil bağlam UI'ın sahibidir; yeni bir bağlam etkinleştiğinde
 * öncekinin durumu "emekliye ayrılır" (retire). Her panel yalnızca kendi
 * kimliğini bilir; hiçbiri diğerinin setter'ını tanımaz.
 *
 * ## Panel görünürlüğü ≠ katman görünürlüğü
 *
 * Buradaki kimlikler PANELLERİ adlandırır, harita katmanlarını değil. Isı
 * haritası paneli kapandığında `heatmapEnabled` DEĞİŞMEZ ve ısı haritası
 * haritada durmaya devam eder; aynı şekilde bir bağlamın emekliye ayrılması
 * hiçbir kaydı silmez, hiçbir katmanı kapatmaz. İkisi ayrı eksenlerdir.
 */

export const MAP_CONTEXTS = Object.freeze({
  /* --- Seçimden doğan bağlamlar ------------------------------------------- */
  /** Tek bir çizim seçili: SelectedFeaturePanel (geometri düzenleme dâhil). */
  drawingInfo: 'drawingInfo',
  /** İki veya daha fazla çizim seçili: MultiSelectionPanel. */
  multiSelection: 'multiSelection',
  /** StylePanel — araç stili, seçili kayıt stili veya toplu stil. */
  styleEditor: 'styleEditor',

  /* --- POI ---------------------------------------------------------------- */
  /** Tıklanan POI'nin bilgi paneli. */
  poiInfo: 'poiInfo',
  /** POI yerleştirme + öznitelik formu (oluşturma). */
  poiCreate: 'poiCreate',
  /** Var olan bir POI'nin düzenleme formu. */
  poiEdit: 'poiEdit',

  /* --- Analiz ------------------------------------------------------------- */
  /** Envanter analizi: alan çizimi ve sonuç paneli tek bir bağlamdır. */
  inventory: 'inventory',
  /**
   * Konum analizi: hedef alan seçimi, ölçüt formu ve ağırlıklı ısı haritası
   * tek bir bağlamdır. Envanter analizinden AYRIDIR — farklı veri kümesi,
   * farklı yetki, farklı çıktı.
   */
  locationAnalysis: 'locationAnalysis',

  /* --- Kenar çubuğu panelleri ---------------------------------------------
     Kimlikler kenar çubuğunun `id` değerleriyle BİREBİR aynıdır; böylece
     "hangi satır etkin" sorusu ikinci bir eşleme tablosu gerektirmez. */
  drawings: 'drawings',
  /* "POI'lerim" Çizimlerim'in kardeşidir, alt kümesi değil: ayrı bir alan
     nesnesini listeler ve ayrı bir yetkiyle (poi.view) açılır. */
  myPois: 'myPois',
  layers: 'layers',
  trash: 'trash',
  heatmap: 'heatmap',
  settings: 'settings',
  about: 'about',
})

/**
 * Çizim SEÇİMİ üzerinde çalışan bağlamlar.
 *
 * Bu küme, kodun tek "ilişki" bilgisidir ve bir özel durum listesi değil bir
 * ÖZELLİK beyanıdır: bu bağlamlar aynı seçimi paylaşır, dolayısıyla biri
 * diğerine devrederken seçim TEMİZLENMEZ. "Stili Değiştir" tam olarak bu
 * yüzden çalışır — panel seçili kaydı düzenler ve seçim ayaklarının altından
 * çekilmemelidir. Kümenin dışındaki her bağlam (POI, analiz, ısı haritası,
 * kenar çubuğu panelleri) devraldığında seçim bırakılır.
 */
export const SELECTION_CONTEXTS = Object.freeze([
  MAP_CONTEXTS.drawingInfo,
  MAP_CONTEXTS.multiSelection,
  MAP_CONTEXTS.styleEditor,
])

/**
 * Seçili POI üzerinde çalışan bağlamlar. Aynı gerekçe: "Düzenle", bilgi
 * panelindeki POI'yi düzenler; geçiş sırasında seçili POI düşürülmemelidir.
 */
export const POI_CONTEXTS = Object.freeze([MAP_CONTEXTS.poiInfo, MAP_CONTEXTS.poiEdit])

/** Kenar çubuğunun açtığı bağlamlar — satır vurgusu bunlardan birinde durur. */
export const SIDEBAR_CONTEXTS = Object.freeze([
  MAP_CONTEXTS.drawings,
  MAP_CONTEXTS.myPois,
  MAP_CONTEXTS.layers,
  MAP_CONTEXTS.trash,
  MAP_CONTEXTS.heatmap,
  MAP_CONTEXTS.locationAnalysis,
  MAP_CONTEXTS.settings,
  MAP_CONTEXTS.about,
])

/** `next` bağlamı, `group` kümesindeki bir bağlamın durumunu paylaşıyor mu. */
export function sharesState(group, next) {
  return next !== null && group.includes(next)
}

/**
 * Bağlam sahipliğinin SAF çekirdeği — React'siz.
 *
 * Kural tek bir cümledir ve yalnızca burada yazılıdır: <b>yeni bir bağlam
 * etkinleşirken önceki emekliye ayrılır.</b> React katmanı (`useMapContext`)
 * bunun üzerine yalnızca render tetiklemeyi ekler.
 *
 * Çekirdeğin ayrı olması, kuralın bir bileşen ağacı kurmadan doğrudan
 * sınanabilmesi demektir: "aynı anda tek panel", "önceki bağlam bırakılır",
 * "durumu paylaşan bağlam bırakılmaz" iddiaları hook'un içinde saklı kalmaz.
 *
 * @param {{ getRetirer: (id: string) => ((next: string|null) => void) | undefined,
 *           onChange: (active: string|null) => void }} deps
 *   `getRetirer` her çağrıda TAZE okunur; emeklilik fonksiyonları render başına
 *   yeniden kurulur ve koordinatör eskimiş bir kopyayı tutmamalıdır.
 */
export function createMapContextCoordinator({ getRetirer, onChange }) {
  let active = null

  const retire = (id, next) => {
    if (!id) return
    getRetirer?.(id)?.(next)
  }

  return {
    /** Şu an UI'ın sahibi olan bağlam; hiçbiri yoksa null. */
    get active() {
      return active
    },

    isActive: (id) => active === id,

    /**
     * Bağlamı devralır. Aynı bağlam yeniden etkinleştirilirse hiçbir şey
     * olmaz — kendi kendini emekliye ayırmak, açık bir paneli sıfırlardı.
     */
    activate(next) {
      const previous = active
      if (previous === next) return

      // Sıra: önce sahiplik geçer, sonra eski bağlam bırakır. Böylece
      // "hiçbir panelin olmadığı" bir ara durum oluşmaz.
      active = next
      onChange(next)
      retire(previous, next)
    },

    /**
     * @param {string} [id] Verilirse YALNIZCA o bağlam etkinken kapatır: geç
     *   kalan bir kapatma, aradan devralan bağlamı düşürmemelidir.
     */
    close(id = undefined) {
      const previous = active
      if (previous === null) return
      if (id !== undefined && previous !== id) return

      active = null
      onChange(null)
      retire(previous, null)
    },
  }
}
