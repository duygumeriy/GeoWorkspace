import { useCallback, useEffect, useRef, useState } from 'react'
import { createPoiLayer, featureToPoi, poiToFeature } from '../map/poi.js'
import { markerBandForResolution } from '../map/poiMarkerScale.js'
import { prewarmPoiBadges } from '../map/poiMarkerStyle.js'
import { fetchPois, readApiError } from '../services/api.js'

/**
 * Kalıcı POI katmanı: tek kaynak, tek katman, yetkiye bağlı yaşam döngüsü.
 *
 * <b>Katman bir kez kurulur.</b> Harita örneği değişmedikçe kaynak da katman da
 * yeniden yaratılmaz; veri geldiğinde yalnızca kaynağın içeriği değişir. POI
 * başına katman açmak (ya da her render'da katmanı yeniden kurmak) OpenLayers
 * nesnelerini çoğaltır ve dinleyici sızdırırdı.
 *
 * <b>Yetki CANLIDIR.</b> `permitted` false olduğu anda kaynak boşaltılır: veri
 * bir kez çekilmiş olması, yetkisi alınmış birinin onu görmeye devam etmesi
 * için sebep değildir. Aynı şekilde yetki yokken uç HİÇ çağrılmaz — garanti
 * 403 alacak bir istek açmanın anlamı yok.
 *
 * <b>Kalıcı GÖRÜNÜM raster'e ait olabilir.</b> `rasterActiveRef` true iken
 * vektör kendi rozetini çizmez (saydam ama tıklanabilir kalır), böylece aynı
 * POI hem WMS görüntüsünde hem vektörde iki kez görünmez. Ref üzerinden okunur
 * çünkü raster bir React render'ı olmadan da yerine oturabilir ve stil
 * fonksiyonu o anki doğru cevabı görmelidir.
 *
 * <b>Yakınlık BANDI izlenir, çözünürlük değil.</b> İşaretçi boyutu üç bantta
 * değişir (bkz. `map/poiMarkerScale.js`); ölçek her değiştiğinde yeniden çizim
 * istemek, yakınlaşma animasyonu boyunca kare başına bir yeniden çizim demek
 * olurdu. Yalnızca bant DEĞİŞTİĞİNDE — yani en fazla iki eşikte — kaynağa
 * haber verilir.
 *
 * <b>GÖRÜNÜRLÜK yetkiden AYRIDIR.</b> "Katmanlar → POI'ler" kapatıldığında
 * kaynak boşaltılmaz — katmanın kendisi görünmez yapılır. Fark önemlidir:
 * yetkisi olmayan biri veriyi HİÇ almamalıdır, katmanı kapatan biri ise yalnızca
 * görünümü gizlemiştir ve tekrar açtığında veri yeniden indirilmemelidir.
 * Görünmez bir OpenLayers katmanı isabet denetimine de girmez, dolayısıyla
 * gizlenmiş bir POI yanlışlıkla tıklanamaz.
 *
 * @param {import('ol/Map').default | null} map
 * @param {{ permitted: boolean, visible?: boolean, selectedId: number|null,
 *           showToast: Function, rasterActiveRef?: { current: boolean },
 *           categoryPresentation?: Map<number, object>|null }} deps
 *   `categoryPresentation` kategori kimliğinden simge/renk çözer; yoksa ya da
 *   kayıt bulunamazsa nötr yedeğe düşülür — POI yine bir rozettir.
 */
export default function usePoiLayer(
  map,
  {
    permitted,
    visible = true,
    selectedId,
    showToast,
    rasterActiveRef = null,
    categoryPresentation = null,
  },
) {
  const sourceRef = useRef(null)
  const layerRef = useRef(null)
  const [loading, setLoading] = useState(false)

  /**
   * Haritadaki kalıcı POI sayısı — "Katmanlar" panelindeki satır bunu gösterir.
   *
   * Kaynağın kendisinden okunur, AYRI bir istekle değil: liste zaten
   * indirilmiştir ve sunucu onu kendi kurallarıyla süzmüştür (aktif, silinmemiş,
   * kategorisi aktif). Sayıyı ikinci bir uçtan sormak, aynı gerçeğin ayrışabilen
   * ikinci bir kaynağı olurdu.
   */
  const [count, setCount] = useState(0)

  /**
   * İlk okuma TAMAMLANDI mı (başarıyla ya da hatayla).
   *
   * <b><c>loading</c>'in yokluğu bunu SÖYLEMEZ.</b> Kanca `loading: false` ile
   * doğar ve okumayı bir effect başlatır, dolayısıyla ilk render'da "boş
   * kaynak + yüklenmiyor" durumu iki AYRI gerçeğin aynı görünümüdür: "henüz
   * istemedim" ve "istedim, kayıt yok". Bu ayrımı yapamayan bir çağıran, veri
   * daha yola çıkmadan "kayıt bulunamadı" kararı verir.
   *
   * Aynı belirsizlik yönetim panelindeki kategori okumasında da bir hataya yol
   * açmıştı (boş liste "hiç okunmadı" sayılıp sonsuz yeniden istek);
   * <see cref="loaded"/> o dersin buradaki karşılığıdır.
   */
  const [loaded, setLoaded] = useState(false)

  /* Seçili POI stil fonksiyonundan okunur. Ref üzerinden okunması, seçim her
     değiştiğinde katmanı yeniden kurmayı gereksiz kılar. */
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId

  /* Sunum durumu state'e KOPYALANMAZ, okunur — çizim tarafındaki
     `presentationActiveRef` ile aynı gerekçe. */
  const rasterRef = useRef(rasterActiveRef)
  rasterRef.current = rasterActiveRef

  /* Kategori sunum metadatası da ref üzerinden okunur: geç geldiğinde katmanı
     yeniden kurmak, uçan bir POI isteğini ve seçimi boşuna bozardı. */
  const presentationRef = useRef(categoryPresentation)
  presentationRef.current = categoryPresentation

  /* Katman kurulumu render'dan bağımsız çalışır ve o anki görünürlüğü
     bilmelidir; aksi hâlde kapalıyken yeniden kurulan bir katman görünür
     doğardı. */
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  /* Yalnızca EN YENİ isteğin sonucu yazılabilir: yetki değişimi ya da bir
     yenileme sırasında gelen eski cevap kaynağı geri saramaz. */
  const requestIdRef = useRef(0)

  /* --- Katman ------------------------------------------------------------- */

  useEffect(() => {
    if (!map) return undefined

    const { source, layer } = createPoiLayer(
      () => selectedIdRef.current,
      () => rasterRef.current?.current === true,
      (categoryId) => presentationRef.current?.get(categoryId) ?? null,
      () => map.getView().getResolution(),
    )
    sourceRef.current = source
    layerRef.current = layer
    layer.setVisible(visibleRef.current)
    map.addLayer(layer)

    /* Boyut bandı değiştiğinde — ve YALNIZCA o zaman — yeniden çizim istenir.
       `change:resolution` yakınlaşma animasyonu boyunca onlarca kez ateşlenir;
       her birinde kaynağı geçersizleştirmek, Faz 5A'da kazanılan akıcılığı
       geri verirdi. Bant üç değerlidir, dolayısıyla bildirim seyrektir ve stil
       önbelleği zaten hazır nesneleri döndürür. */
    let band = markerBandForResolution(map.getView().getResolution())
    const onResolutionChange = () => {
      const next = markerBandForResolution(map.getView().getResolution())
      if (next === band) return
      band = next
      source.changed()
    }

    map.getView().on('change:resolution', onResolutionChange)

    return () => {
      map.getView().un('change:resolution', onResolutionChange)
      map.removeLayer(layer)
      source.clear()
      sourceRef.current = null
      layerRef.current = null
    }
  }, [map])

  /* Görünürlük katmanın KENDİSİNE uygulanır, stil fonksiyonuna değil. Saydam
     bir stil döndürmek POI'yi görünmez yapardı ama TIKLANABİLİR bırakırdı:
     kullanıcı kapattığı bir katmandaki bir noktaya basıp bilgi paneli
     açabilirdi. Görünmez bir katman OpenLayers'ın isabet denetimine hiç
     girmez. */
  useEffect(() => {
    layerRef.current?.setVisible(visible)
  }, [visible])

  /**
   * Haritada GERÇEKTEN bulunan kategorilerin rozetlerini önceden hazırlar.
   *
   * Bütün taksonomi değil, yalnızca yüklü POI'lerin kategorileri: 44 rozeti
   * boşuna kurmak, çoğu hiç görünmeyecek nesneler üretirdi. Kaynak
   * feature'larından okunur, dolayısıyla liste ve metadata hangi sırada gelirse
   * gelsin sonuç aynıdır.
   */
  const prewarm = useCallback(() => {
    const source = sourceRef.current
    if (!source) return

    const lookup = presentationRef.current
    const seen = new Set()
    const wanted = []

    for (const feature of source.getFeatures()) {
      const categoryId = feature.get('categoryId')
      if (seen.has(categoryId)) continue
      seen.add(categoryId)
      wanted.push(lookup?.get(categoryId) ?? null)
    }

    prewarmPoiBadges(wanted.filter(Boolean))
  }, [])

  /* Yükleyici render'dan bağımsız çalıştığı için ısıtıcı da ref üzerinden
     çağrılır; aksi hâlde her kimlik değişimi okumayı yeniden kurardı. */
  const prewarmRef = useRef(prewarm)
  prewarmRef.current = prewarm

  /* Kategori metadatası geldiğinde yalnızca yeniden çizim istenir: feature'lara
     dokunulmaz, değişen tek şey stil fonksiyonunun vereceği cevaptır. Metadata
     POI listesinden SONRA gelebilir, dolayısıyla ısıtma burada da yapılır —
     iki yol da idempotenttir ve ikinci çağrı yeni nesne üretmez. */
  useEffect(() => {
    sourceRef.current?.changed()
    prewarm()
  }, [categoryPresentation, prewarm])

  /* Seçim değiştiğinde yalnızca yeniden çizim istenir; feature'lara dokunulmaz. */
  useEffect(() => {
    sourceRef.current?.changed()
  }, [selectedId])

  /* --- Veri --------------------------------------------------------------- */

  const load = useCallback(async () => {
    if (!permitted) return

    requestIdRef.current += 1
    const requestId = requestIdRef.current
    setLoading(true)

    try {
      const res = await fetchPois()
      if (!res.ok) throw new Error(await readApiError(res, 'POI kayıtları yüklenemedi.'))

      const records = await res.json()
      if (requestId !== requestIdRef.current) return

      const source = sourceRef.current
      if (!source) return

      /* Kaynak tek seferde değiştirilir: önce boşaltıp tek tek eklemek, her
         eklemede bir render tetikler ve arada boş bir kare gösterirdi. */
      source.clear()
      source.addFeatures(records.map(poiToFeature).filter(Boolean))
      setCount(source.getFeatures().length)
      prewarmRef.current()
    } catch (error) {
      if (requestId !== requestIdRef.current) return
      /* Hata haritayı DÜŞÜRMEZ: diğer katmanlar çalışmaya devam eder ve
         kaynak son geçerli hâlinde kalır. Otomatik yeniden deneme yoktur —
         sonsuz döngüye dönüşebilirdi. */
      showToast?.('error', error.message || 'POI kayıtları yüklenemedi.')
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
        // Hata da bir SONUÇTUR: okuma denendi ve bitti.
        setLoaded(true)
      }
    }
  }, [permitted, showToast])

  /* Tek tetikleyici: yetkinin varlığı. Her render'da değil, `permitted`
     değiştiğinde çalışır — sürekli yoklama yoktur. */
  useEffect(() => {
    if (permitted) {
      load()
      return
    }

    // Yetki yoksa (ya da alındıysa) uçan istek geçersizleşir ve kaynak boşalır.
    requestIdRef.current += 1
    sourceRef.current?.clear()
    setCount(0)
    setLoading(false)
    /* Yetkisiz durum "okundu" SAYILMAZ: yetki geri verildiğinde okuma yeniden
       yapılacaktır ve o ana kadar boş kaynak yine "henüz bilinmiyor"dur. */
    setLoaded(false)
  }, [permitted, load])

  /**
   * Raster durumu değiştiğinde yalnızca yeniden çizim istenir.
   *
   * Feature'lara DOKUNULMAZ: değişen tek şey stil fonksiyonunun vereceği
   * cevaptır. Kaynağı yeniden kurmak, seçimi ve uçan bir isteği boşuna
   * bozardı.
   */
  const notifyRasterChanged = useCallback(() => {
    sourceRef.current?.changed()
  }, [])

  /** Sayacı kaynağın gerçek içeriğinden tazeler; tahmin edilmez, sayılır. */
  const syncCount = useCallback(() => {
    setCount(sourceRef.current?.getFeatures().length ?? 0)
  }, [])

  /**
   * Yeni oluşturulan POI'yi AYNI eşlemeyle kaynağa ekler.
   *
   * Tam bir yeniden okuma yerine tek kayıt eklenir: sunucu yanıtı zaten
   * kaydın kanonik hâlidir ve ikinci bir GET, az önce yazılanı yeniden
   * indirmekten ibaret olurdu. Eşleme fonksiyonu listeyle aynıdır, dolayısıyla
   * iki yol arasında biçim farkı doğamaz.
   */
  const addPoi = useCallback((poi) => {
    const feature = poiToFeature(poi)
    if (feature) sourceRef.current?.addFeature(feature)
    syncCount()
  }, [syncCount])

  /**
   * Güncellenen POI'yi yerinde tazeler.
   *
   * Feature'ın özniteliklerini tek tek yamamak yerine aynı eşlemeyle YENİDEN
   * kurulup değiştirilir: `poiToFeature` kaydın tek yorumudur ve alan alan
   * kopyalamak, ileride eklenecek bir alanın burada unutulması demek olurdu.
   * Tam bir yeniden okuma da yapılmaz — sunucu yanıtı kaydın kanonik hâlidir.
   */
  const updatePoi = useCallback((poi) => {
    const source = sourceRef.current
    if (!source) return

    const existing = source.getFeatureById(`poi-${poi?.id}`)
    if (existing) source.removeFeature(existing)

    const feature = poiToFeature(poi)
    if (feature) source.addFeature(feature)
    syncCount()
  }, [syncCount])

  /**
   * Soft-delete edilen POI'yi haritadan kaldırır.
   *
   * Kayıt veritabanında DURUR (is_deleted) — burada kaldırılan yalnızca
   * haritadaki temsilidir. Geri yükleme aynı kaydı yeniden ekler; bu yüzden
   * tam sayfa yenilemesi hiçbir adımda gerekmez.
   */
  const removePoi = useCallback((id) => {
    const source = sourceRef.current
    const existing = source?.getFeatureById(`poi-${id}`)
    if (existing) source.removeFeature(existing)
    syncCount()
  }, [syncCount])

  /**
   * Katmandaki POI'yi kimliğiyle okur.
   *
   * Analiz sonucu gibi DAR sözleşmeler (yetenek bayrağı ve mesai taşımayan)
   * bir kaydı işaret ettiğinde, bilgi panelinin tam kaydı gösterebilmesi için
   * gereklidir: kayıt zaten haritada yüklüdür ve ikinci bir GET, elde olanı
   * yeniden indirmek olurdu.
   */
  const findPoi = useCallback((id) => {
    const feature = sourceRef.current?.getFeatureById(`poi-${id}`)
    return feature ? featureToPoi(feature) : null
  }, [])

  return { loading, loaded, count, reload: load, addPoi, updatePoi, removePoi, findPoi, notifyRasterChanged }
}
