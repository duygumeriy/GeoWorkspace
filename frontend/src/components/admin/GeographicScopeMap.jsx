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
 * Coğrafi yetki alanının haritası: tek bir düzenlenebilir poligon.
 *
 * <b>Üretim haritasının kopyası DEĞİLDİR.</b> Çizim araç çubuğu, envanter,
 * katman listesi, seçim, geçmiş yığını ve gezinme burada yoktur; bu ekranın tek
 * işi bir alanı göstermek ve düzenlemektir. Ana haritayı yeniden kullanmak,
 * yönetim kipinde anlamı olmayan onlarca kontrolü de beraberinde getirirdi.
 *
 * <b>Geometri YEREL kalır.</b> Çizim ve düzenleme yalnızca bu bileşenin
 * kaynağını değiştirir ve sonucu WKT olarak yukarı bildirir; hiçbir istek
 * açılmaz. Kaydetme kararı üst bileşenindir — köşe sürüklerken sunucuya
 * yazmak, yarım bırakılan bir düzenlemeyi kalıcı hâle getirirdi.
 *
 * <b>İki kaynak ayrı durur.</b> Düzenlenebilir kaynak hedefin KENDİ alanıdır;
 * referans kaynağı ise kullanıcının rollerinden gelen ve buradan
 * değiştirilemeyen alandır. Tek katmanda birleştirmek, yöneticinin silemeyeceği
 * bir poligonu kendi alanıymış gibi göstermek olurdu.
 *
 * @param {object} props
 * @param {string|null} props.baselineWkt sunucunun onayladığı doğrudan alan
 *   (EPSG:4326). Değiştiğinde çalışma geometrisi buna sıfırlanır.
 * @param {string|null} props.inheritedWkt rol(ler)den gelen referans alan.
 * @param {'idle'|'draw'|'modify'} props.mode etkin etkileşim.
 * @param {number} props.clearToken artırıldığında çalışma geometrisi silinir
 *   ve harita boş bırakılır ("yeniden çiz"). Sunucudan HİÇBİR ŞEY silmez.
 * @param {(wkt: string|null) => void} props.onWorkingChange
 * @param {() => void} props.onDrawEnd
 */
export default function GeographicScopeMap({
  baselineWkt = null,
  inheritedWkt = null,
  mode = 'idle',
  clearToken = 0,
  onWorkingChange,
  onDrawEnd,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const editableSourceRef = useRef(null)
  const inheritedSourceRef = useRef(null)
  /* Sığdırılmayı BEKLEYEN kapsam. Kip penceresi açılırken kapsayıcının
     ölçüsü bir kare boyunca 0 olabilir ve o ölçüyle yapılan bir `fit`
     geçersiz bir çözünürlük üretir — harita boş görünürdü. Hedef burada
     bekletilir ve ölçü gerçekleşir gerçekleşmez uygulanır. */
  const pendingFitRef = useRef(null)

  /* Geri çağrılar ref üzerinden okunur: üst bileşen her render'da yeni bir
     fonksiyon üretse bile harita yeniden kurulmaz. Haritayı yeniden kurmak,
     kullanıcının kaydırdığı görünümü ve çizmekte olduğu poligonu silerdi. */
  const handlersRef = useRef({ onWorkingChange, onDrawEnd })
  handlersRef.current = { onWorkingChange, onDrawEnd }

  /**
   * Haritanın durumunu kapsayıcının veri niteliklerine yazar.
   *
   * Kameranın NEREDE olduğu ve düzenlenebilir kaynakta KAÇ alan bulunduğu, bu
   * ekranın iki temel kuralıdır: alan yokken görünüm Türkiye'ye odaklanır ve
   * hedef başına yalnızca tek bir poligon tutulur. İkisi de tuvale çizilir,
   * yani DOM'dan okunamaz; burada okunabilir hâle getirilirler.
   *
   * Merkez, haritanın çalıştığı EPSG:3857 metre değerlerinde değil boylam/enlem
   * olarak yazılır — "Türkiye'ye odaklı mı" sorusunun cevabı ancak coğrafi
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
    container.dataset.areaCount = String(editableSourceRef.current?.getFeatures().length ?? 0)
    container.dataset.inheritedCount = String(inheritedSourceRef.current?.getFeatures().length ?? 0)
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

    const editableSource = new VectorSource()
    const inheritedSource = new VectorSource()

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
          /* Miras alınan alan KESİKLİ ve nötr çizilir: düzenlenebilir alandan
             yalnızca renkle değil, çizgi biçimiyle de ayrılır. Efsane ayrıca
             metinle de anlatır. */
          style: new Style({
            fill: new Fill({ color: 'rgba(100, 116, 139, 0.12)' }),
            stroke: new Stroke({ color: '#64748b', width: 2, lineDash: [8, 6] }),
          }),
        }),
        new VectorLayer({
          source: editableSource,
          className: 'geo-scope-layer',
          zIndex: 12,
          style: new Style({
            fill: new Fill({ color: 'rgba(99, 102, 241, 0.18)' }),
            stroke: new Stroke({ color: '#6366f1', width: 2.5 }),
          }),
        }),
      ],
      view: new View({ center: [0, 0], zoom: 2 }),
    })

    mapRef.current = map
    editableSourceRef.current = editableSource
    inheritedSourceRef.current = inheritedSource

    /* Kamera ve kaynaklar bağımsız değişir: kip düğmesi geometriyi, tekerlek
       görünümü oynatır. İkisi de aynı yayımı tetikler. */
    map.on('moveend', publishState)
    editableSource.on('change', publishState)
    inheritedSource.on('change', publishState)
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
      editableSource.un('change', publishState)
      inheritedSource.un('change', publishState)
      map.setTarget(undefined)
      map.dispose()
      mapRef.current = null
      editableSourceRef.current = null
      inheritedSourceRef.current = null
    }
  }, [applyPendingFit, publishState])

  /* --- Referans (miras) alanı --------------------------------------------- */
  useEffect(() => {
    const source = inheritedSourceRef.current
    if (!source) return

    source.clear()
    if (!inheritedWkt) return

    const feature = wkt4326ToFeature(inheritedWkt)
    if (feature) source.addFeature(feature)
  }, [inheritedWkt])

  /* --- Çalışma geometrisi: sunucunun onayladığı alandan kurulur ------------ */
  useEffect(() => {
    const source = editableSourceRef.current
    if (!source) return

    source.clear()

    if (!baselineWkt) {
      handlersRef.current.onWorkingChange?.(null)
      return
    }

    const feature = wkt4326ToFeature(baselineWkt)
    if (!feature) {
      handlersRef.current.onWorkingChange?.(null)
      return
    }

    source.addFeature(feature)
    /* Bildirilen değer, sunucudan gelen dizgenin AYNISI değil OpenLayers'ın
       yeniden yazdığı hâlidir. "Kirli mi" sorusu iki dizgeyi karşılaştırır;
       biri sunucunun, diğeri tarayıcının biçimlendirmesiyle yazılırsa hiç
       dokunulmamış bir alan bile değişmiş görünürdü. */
    handlersRef.current.onWorkingChange?.(geometryToWkt4326(feature.getGeometry()))
  }, [baselineWkt])

  /* --- "Yeniden çiz": yerel geometriyi boşaltır ---------------------------- */
  useEffect(() => {
    if (!clearToken) return
    const source = editableSourceRef.current
    if (!source) return
    source.clear()
    handlersRef.current.onWorkingChange?.(null)
  }, [clearToken])

  /* --- Kamera: var olan alana sığdır, yoksa Türkiye ------------------------ */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    /* Kamera yalnızca AÇILIŞTA ve veri değiştiğinde konumlanır. Her çizim
       sonrası yeniden sığdırmak, yöneticinin kaydırdığı görünümü elinden
       almak olurdu. */
    const extent = createEmpty()
    for (const source of [editableSourceRef.current, inheritedSourceRef.current]) {
      const sourceExtent = source?.getExtent()
      if (sourceExtent && !isEmptyExtent(sourceExtent)) extendExtent(extent, sourceExtent)
    }

    pendingFitRef.current = isEmptyExtent(extent)
      // Hiç alan yok: Türkiye sınırlarına odaklanmış açılış görünümü.
      ? { extent: turkeyExtent(), padding: [24, 24, 24, 24], maxZoom: undefined }
      : { extent, padding: [48, 48, 48, 48], maxZoom: 15 }

    applyPendingFit()
  }, [baselineWkt, inheritedWkt, applyPendingFit])

  /* --- Çizim --------------------------------------------------------------- */
  useEffect(() => {
    const map = mapRef.current
    const source = editableSourceRef.current
    if (!map || !source || mode !== 'draw') return undefined

    const draw = new Draw({ source, type: 'Polygon' })

    /* Hedef başına TEK poligon kuralı burada uygulanır: yeni çizim başlarken
       eski geometri düşer. İkincisini eklemek, sunucunun kabul etmediği bir
       durumu ekranda mümkün göstermek olurdu. */
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
    const source = editableSourceRef.current
    if (!map || !source || mode !== 'modify') return undefined

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

  return <div ref={containerRef} className="geo-scope-map" data-testid="geographic-scope-map" role="application" aria-label="Coğrafi yetki alanı haritası" />
}
