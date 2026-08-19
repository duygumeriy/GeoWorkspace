import { useCallback, useEffect, useRef } from 'react'
import Map from 'ol/Map'
import View from 'ol/View'
import Draw from 'ol/interaction/Draw'
import Modify from 'ol/interaction/Modify'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import Fill from 'ol/style/Fill'
import Stroke from 'ol/style/Stroke'
import Style from 'ol/style/Style'
import { defaults as defaultControls } from 'ol/control'
import { createEmpty, extend as extendExtent, isEmpty as isEmptyExtent } from 'ol/extent'
import { toLonLat } from 'ol/proj'
import { basemapById, DEFAULT_BASEMAP_ID } from '../../map/basemaps.js'
import { geometryToWkt4326, wkt4326ToFeature } from '../../map/drawing.js'
import { turkeyExtent } from '../../map/turkey.js'

/**
 * Coğrafi yetki alanlarının haritası: KAYITLI alanların tamamı, seçili olan
 * vurgulu, üzerine bir de düzenlenmekte olan taslak.
 *
 * <b>Üretim haritasının kopyası DEĞİLDİR.</b> Çizim araç çubuğu, envanter,
 * katman listesi, seçim, geçmiş yığını ve gezinme burada yoktur; bu ekranın tek
 * işi alanları göstermek ve birini düzenlemektir.
 *
 * <b>Ekleme, var olanı GİZLEMEZ.</b> (Phase 9) Yeni bir alan çizilirken diğer
 * alanlar haritada durmaya devam eder. Aksi hâlde yönetici, ikinci bölgeyi
 * birincisini göremeden çizmek zorunda kalırdı — ve iki bölgenin çakışıp
 * çakışmadığını ancak kaydettikten sonra görürdü.
 *
 * <b>Geometri YEREL kalır.</b> Çizim ve düzenleme yalnızca bu bileşenin
 * kaynağını değiştirir ve sonucu WKT olarak yukarı bildirir; hiçbir istek
 * açılmaz. Kaydetme kararı üst bileşenindir — köşe sürüklerken sunucuya
 * yazmak, yarım bırakılan bir düzenlemeyi kalıcı hâle getirirdi.
 *
 * <b>Üç kaynak ayrı durur.</b> Kayıtlı alanlar, taslak ve miras alınan alan
 * kendi katmanlarındadır. Tek katmanda birleştirmek, yöneticinin silemeyeceği
 * bir poligonu kendi alanıymış gibi göstermek olurdu.
 *
 * @param {object} props
 * @param {{id:number,name:string,wkt:string}[]} props.areas kayıtlı alanlar
 * @param {number|null} props.selectedId vurgulanan kayıtlı alan
 * @param {string|null} props.inheritedWkt rol(ler)den gelen referans alan
 * @param {string[]} props.draftWkts düzenlenmekte olan geometriler. Serbest
 *   çizim ve koordinat girişi tek eleman üretir; il/bölge seçimi kopuk
 *   parçalar için birden çok eleman üretebilir ve hiçbiri atılmaz.
 * @param {number} props.draftToken artınca taslak kaynağı `draftWkts`'ten
 *   YENİDEN kurulur. Her render'da kurmak, kullanıcının sürüklediği köşeyi
 *   elinden alırdı.
 * @param {'idle'|'draw'|'modify'} props.mode etkin etkileşim
 * @param {{token:number, areaId:number|null}} props.fit kamera hedefi
 * @param {(wkt: string|null) => void} props.onWorkingChange
 * @param {() => void} props.onDrawEnd
 * @param {(areaId: number) => void} props.onSelectArea
 */
export default function GeographicScopeMap({
  areas = [],
  selectedId = null,
  inheritedWkt = null,
  draftWkts = [],
  draftToken = 0,
  mode = 'idle',
  fit = { token: 0, areaId: null },
  onWorkingChange,
  onDrawEnd,
  onSelectArea,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const savedSourceRef = useRef(null)
  const draftSourceRef = useRef(null)
  const inheritedSourceRef = useRef(null)
  const savedLayerRef = useRef(null)
  /* Sığdırılmayı BEKLEYEN kapsam. Kip penceresi açılırken kapsayıcının
     ölçüsü bir kare boyunca 0 olabilir ve o ölçüyle yapılan bir `fit`
     geçersiz bir çözünürlük üretir — harita boş görünürdü. Hedef burada
     bekletilir ve ölçü gerçekleşir gerçekleşmez uygulanır. */
  const pendingFitRef = useRef(null)

  /* Geri çağrılar ve seçim ref üzerinden okunur: üst bileşen her render'da yeni
     bir fonksiyon üretse bile harita yeniden kurulmaz. Haritayı yeniden kurmak,
     kullanıcının kaydırdığı görünümü ve çizmekte olduğu poligonu silerdi. */
  const handlersRef = useRef({ onWorkingChange, onDrawEnd, onSelectArea })
  handlersRef.current = { onWorkingChange, onDrawEnd, onSelectArea }

  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId

  const draftWktsRef = useRef(draftWkts)
  draftWktsRef.current = draftWkts

  /**
   * Haritanın durumunu kapsayıcının veri niteliklerine yazar.
   *
   * Kameranın NEREDE olduğu ve hangi kaynakta KAÇ alan bulunduğu bu ekranın
   * gözlenebilir gerçekleridir; ikisi de tuvale çizilir, yani DOM'dan
   * okunamaz. Burada okunabilir hâle getirilirler — hem testler hem de elle
   * inceleme için.
   *
   * Merkez, haritanın çalıştığı EPSG:3857 metre değerlerinde değil boylam/enlem
   * olarak yazılır: "Türkiye'ye odaklı mı" sorusunun cevabı ancak coğrafi
   * birimlerde anlamlıdır.
   */
  const publishState = useCallback(() => {
    const map = mapRef.current
    const container = containerRef.current
    if (!map || !container) return

    const view = map.getView()
    const center = toLonLat(view.getCenter() ?? [0, 0])
    const zoom = view.getZoom()

    container.dataset.centerLon = center[0].toFixed(4)
    container.dataset.centerLat = center[1].toFixed(4)
    container.dataset.zoom = zoom == null ? '' : zoom.toFixed(2)
    container.dataset.areaCount = String(savedSourceRef.current?.getFeatures().length ?? 0)
    container.dataset.draftCount = String(draftSourceRef.current?.getFeatures().length ?? 0)
    container.dataset.inheritedCount = String(inheritedSourceRef.current?.getFeatures().length ?? 0)
    container.dataset.selectedId = selectedRef.current == null ? '' : String(selectedRef.current)
  }, [])

  /**
   * Bekleyen kamera hareketini uygular — ancak harita gerçekten ölçülebiliyorsa.
   *
   * Ölçü henüz yoksa hedef BEKLEMEDE bırakılır: `fit`'i 0x0 bir tuvale
   * uygulamak sessizce geçersiz bir çözünürlük yazar ve harita, ölçü sonradan
   * gelse bile boş kalırdı.
   */
  const applyPendingFit = useCallback(() => {
    const map = mapRef.current
    const target = pendingFitRef.current
    if (!map || !target) return

    const size = map.getSize()
    if (!size || size[0] < 1 || size[1] < 1) return

    map.getView().fit(target.extent, {
      size,
      padding: target.padding,
      ...(target.maxZoom ? { maxZoom: target.maxZoom } : {}),
    })
    pendingFitRef.current = null
    publishState()
  }, [publishState])

  /* --- Harita kurulumu: BİR kez ------------------------------------------- */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined

    const savedSource = new VectorSource()
    const draftSource = new VectorSource()
    const inheritedSource = new VectorSource()

    /* Kayıtlı alanların stili SEÇİLİ OLANA göre değişir. Seçim yalnızca renkle
       değil, çizgi KALINLIĞIYLA da anlatılır; renk ayırt edemeyen biri için tek
       başına ton farkı yeterli olmazdı. */
    const savedStyle = (feature) => {
      const isSelected = feature.getId() === selectedRef.current
      return new Style({
        fill: new Fill({ color: isSelected ? 'rgba(99, 102, 241, 0.22)' : 'rgba(99, 102, 241, 0.08)' }),
        stroke: new Stroke({
          color: isSelected ? '#4f46e5' : '#818cf8',
          width: isSelected ? 3.5 : 1.75,
        }),
      })
    }

    const savedLayer = new VectorLayer({
      source: savedSource,
      className: 'geo-scope-layer',
      zIndex: 11,
      style: savedStyle,
    })

    const map = new Map({
      target: containerRef.current,
      /* Varsayılan kontrollerden yalnızca atıf kalır: sağlayıcıların istediği
         atıf hukuki bir gerekliliktir. Yakınlaştırma düğmeleri ve dönme oku,
         dar bir kip penceresinde haritanın üstünü kaplardı; tekerlek ve
         çift tıklama zaten çalışır. */
      controls: defaultControls({ zoom: false, rotate: false }),
      layers: [
        ...basemapById(DEFAULT_BASEMAP_ID).build(),
        new VectorLayer({
          source: inheritedSource,
          className: 'geo-scope-layer',
          zIndex: 10,
          /* Miras alınan alan KESİKLİ ve nötr çizilir: kayıtlı alanlardan
             yalnızca renkle değil, çizgi biçimiyle de ayrılır. Efsane ayrıca
             metinle de anlatır. */
          style: new Style({
            fill: new Fill({ color: 'rgba(100, 116, 139, 0.12)' }),
            stroke: new Stroke({ color: '#64748b', width: 2, lineDash: [8, 6] }),
          }),
        }),
        savedLayer,
        new VectorLayer({
          source: draftSource,
          className: 'geo-scope-layer',
          zIndex: 13,
          /* Taslak, kayıtlı alanlardan AYRI bir renkle ve noktalı çizgiyle
             gösterilir: henüz kaydedilmemiş bir alanı kayıtlıymış gibi
             göstermek, yöneticinin kaydetmeyi unutmasına davetiye olurdu. */
          style: new Style({
            fill: new Fill({ color: 'rgba(217, 155, 22, 0.18)' }),
            stroke: new Stroke({ color: '#d99b16', width: 3, lineDash: [10, 5] }),
          }),
        }),
      ],
      view: new View({ center: [0, 0], zoom: 2 }),
    })

    mapRef.current = map
    savedSourceRef.current = savedSource
    draftSourceRef.current = draftSource
    inheritedSourceRef.current = inheritedSource
    savedLayerRef.current = savedLayer

    /* Kamera ve kaynaklar bağımsız değişir: kip düğmesi geometriyi, tekerlek
       görünümü oynatır. Hepsi aynı yayımı tetikler. */
    map.on('moveend', publishState)
    savedSource.on('change', publishState)
    draftSource.on('change', publishState)
    inheritedSource.on('change', publishState)

    /* Haritadaki bir poligona tıklamak onu SEÇER. Alan kartlarına tıklamakla
       aynı sonucu verir: iki yüzey tek bir seçim durumunu paylaşır, ikisi
       birbirinden farklı bir alanı gösteremez. */
    const handleClick = (event) => {
      const hit = map.forEachFeatureAtPixel(
        event.pixel,
        (feature) => feature,
        { layerFilter: (layer) => layer === savedLayerRef.current },
      )
      const id = hit?.getId()
      if (id != null) handlersRef.current.onSelectArea?.(id)
    }
    map.on('singleclick', handleClick)

    publishState()

    /* Kip penceresi açılırken kapsayıcının ölçüsü henüz sıfır olabilir;
       OpenLayers o ölçüyle boş bir tuval çizer ve öylece kalır. Kapsayıcı
       büyüdüğünde harita da büyür. */
    const observer = new ResizeObserver(() => {
      map.updateSize()
      applyPendingFit()
    })
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      /* Hedef bırakılır ve örnek atılır: aynı düzenleyici tekrar tekrar
         açıldığında geride çalışan bir harita, dinleyici ya da ikinci bir
         tuval bırakmamak için. */
      map.un('moveend', publishState)
      map.un('singleclick', handleClick)
      savedSource.un('change', publishState)
      draftSource.un('change', publishState)
      inheritedSource.un('change', publishState)
      map.setTarget(undefined)
      map.dispose()
      mapRef.current = null
      savedSourceRef.current = null
      draftSourceRef.current = null
      inheritedSourceRef.current = null
      savedLayerRef.current = null
    }
  }, [applyPendingFit, publishState])

  /* --- Kayıtlı alanlar ----------------------------------------------------- */
  useEffect(() => {
    const source = savedSourceRef.current
    if (!source) return

    source.clear()

    for (const area of areas) {
      const feature = wkt4326ToFeature(area.wkt)
      if (!feature) continue
      // Kimlik, haritadaki poligonu alan kaydına bağlar: tıklanan şey hangi
      // satırsa seçilen de odur.
      feature.setId(area.id)
      source.addFeature(feature)
    }
  }, [areas])

  /* Seçim değişince yalnızca STİL yenilenir; kaynak yeniden kurulmaz. */
  useEffect(() => {
    savedLayerRef.current?.changed()
    publishState()
  }, [selectedId, publishState])

  /* --- Referans (miras) alanı --------------------------------------------- */
  useEffect(() => {
    const source = inheritedSourceRef.current
    if (!source) return

    source.clear()
    if (!inheritedWkt) return

    const feature = wkt4326ToFeature(inheritedWkt)
    if (feature) source.addFeature(feature)
  }, [inheritedWkt])

  /* --- Taslak: yalnızca token değiştiğinde yeniden kurulur ----------------- */
  useEffect(() => {
    const source = draftSourceRef.current
    if (!source) return

    source.clear()

    const features = (draftWktsRef.current ?? [])
      .map((wkt) => wkt4326ToFeature(wkt))
      .filter(Boolean)

    for (const feature of features) source.addFeature(feature)

    /* <b>Buradan GERİ BİLDİRİM YAPILMAZ</b> ve bu bilinçlidir. Taslağın sahibi
       üst bileşendir; harita onu yalnızca ÇİZER. Kurulumda geometriyi
       OpenLayers'ın yeniden yazdığı hâliyle geri bildirmek, üst bileşenin az
       önce kurduğu taslağın üzerine yazardı — ve o taslakla birlikte gelen
       kaynak bilgisini (il kodu, bölge anahtarı, koordinat girişi) silerdi.
       Yukarıya yalnızca KULLANICININ ürettiği geometri bildirilir: drawend ve
       modifyend. */
  }, [draftToken])

  /* --- Kamera -------------------------------------------------------------- */
  useEffect(() => {
    if (!mapRef.current) return

    /* Kamera yalnızca AÇIKÇA istendiğinde konumlanır. Her çizimden ya da her
       seçim değişikliğinden sonra yeniden sığdırmak, yöneticinin kaydırdığı
       görünümü elinden almak olurdu. */
    const extent = createEmpty()

    if (fit.areaId != null) {
      const feature = savedSourceRef.current?.getFeatureById(fit.areaId)
      const featureExtent = feature?.getGeometry()?.getExtent()
      if (featureExtent && !isEmptyExtent(featureExtent)) extendExtent(extent, featureExtent)
    } else {
      for (const source of [savedSourceRef.current, draftSourceRef.current, inheritedSourceRef.current]) {
        const sourceExtent = source?.getExtent()
        if (sourceExtent && !isEmptyExtent(sourceExtent)) extendExtent(extent, sourceExtent)
      }
    }

    pendingFitRef.current = isEmptyExtent(extent)
      // Hiç alan yok: Türkiye sınırlarına odaklanmış açılış görünümü.
      ? { extent: turkeyExtent(), padding: [24, 24, 24, 24], maxZoom: undefined }
      : { extent, padding: [48, 48, 48, 48], maxZoom: 15 }

    applyPendingFit()
  }, [fit, applyPendingFit])

  /* --- Çizim --------------------------------------------------------------- */
  useEffect(() => {
    const map = mapRef.current
    const source = draftSourceRef.current
    if (!map || !source || mode !== 'draw') return undefined

    const draw = new Draw({ source, type: 'Polygon' })

    /* Taslak başına TEK poligon: yeni çizim başlarken eski taslak düşer.
       KAYITLI alanlara dokunulmaz — onlar başka bir kaynaktadır ve ekranda
       kalmaya devam ederler. */
    draw.on('drawstart', () => source.clear())

    draw.on('drawend', (event) => {
      handlersRef.current.onWorkingChange?.(geometryToWkt4326(event.feature.getGeometry()))
      // Çizim biter bitmez nötr kipe dönülür; art arda poligon üretilmez.
      handlersRef.current.onDrawEnd?.()
    })

    map.addInteraction(draw)

    return () => {
      map.removeInteraction(draw)
      draw.dispose()
    }
  }, [mode])

  /* --- Düzenleme ----------------------------------------------------------- */
  useEffect(() => {
    const map = mapRef.current
    const source = draftSourceRef.current
    if (!map || !source || mode !== 'modify') return undefined

    // Modify YALNIZCA taslak kaynağına bağlanır: kayıtlı bir alanın köşesi
    // kazara sürüklenip kaydedilmemiş bir değişiklik üretemez.
    const modify = new Modify({ source })

    modify.on('modifyend', () => {
      const feature = source.getFeatures()[0]
      handlersRef.current.onWorkingChange?.(
        feature ? geometryToWkt4326(feature.getGeometry()) : null,
      )
    })

    map.addInteraction(modify)

    return () => {
      map.removeInteraction(modify)
      modify.dispose()
    }
  }, [mode])

  return (
    <div
      ref={containerRef}
      className="geo-scope-map"
      data-testid="geographic-scope-map"
      role="application"
      aria-label="Coğrafi yetki alanları haritası"
    />
  )
}
