import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createAdminRoleGeographicArea,
  createAdminUserGeographicArea,
  deleteAdminRoleGeographicArea,
  deleteAdminUserGeographicArea,
  fetchAdminRoleGeographicAreas,
  fetchAdminUserGeographicAreas,
  readApiError,
  updateAdminRoleGeographicArea,
  updateAdminUserGeographicArea,
} from '../../services/api.js'
import { AREA_SOURCES } from '../../map/turkeyGeography.js'
import GeographicScopeMap from './GeographicScopeMap.jsx'
import GeographicPlacePicker from './GeographicPlacePicker.jsx'
import CoordinateAreaInput from './CoordinateAreaInput.jsx'
import { areaSourceLabel, inheritedScopeWkt } from './geographicScope.js'
import './GeographicAuthorizationEditor.css'

/* Hedef türüne göre uç seti. Bileşenin geri kalanı "kullanıcı mı rol mü" diye
   dallanmaz: iki ekran arasındaki fark burada biter. */
const ENDPOINTS = {
  user: {
    fetch: fetchAdminUserGeographicAreas,
    create: createAdminUserGeographicArea,
    update: updateAdminUserGeographicArea,
    remove: deleteAdminUserGeographicArea,
  },
  role: {
    fetch: fetchAdminRoleGeographicAreas,
    create: createAdminRoleGeographicArea,
    update: updateAdminRoleGeographicArea,
    remove: deleteAdminRoleGeographicArea,
  },
}

/** Yeni alan oluşturma yöntemleri. Hepsi aynı anda gösterilmez. */
const METHODS = [
  { id: 'map', label: 'Haritada Çiz' },
  { id: 'place', label: 'İl / Bölge Seç' },
  { id: 'coords', label: 'Koordinat Gir' },
]

/**
 * Kullanıcı ve rol için ORTAK coğrafi yetki düzenleyicisi — ÇOK ALANLI.
 *
 * İki hedef türü için iki ayrı harita uygulaması yazmak, projeksiyon
 * dönüşümünden kirlilik takibine kadar her kuralın iki yerde tutulması demekti;
 * biri düzeltilirken diğeri geride kalırdı. Fark yalnızca dört uçtur ve miras
 * kavramının kullanıcıya özgü olmasıdır.
 *
 * <b>Ekleme silme DEĞİLDİR.</b> (Phase 9) "Yeni Alan Ekle" var olan alanlara
 * dokunmaz: onlar haritada ve listede durmaya devam eder, yeni alan bir TASLAK
 * olarak yanlarına çizilir. Kaydetmek POST açar; düzenlemek yalnızca seçili
 * alanın PUT'unu, silmek yalnızca seçili alanın DELETE'ini gönderir.
 *
 * <b>Bu ekran bir güvenlik sınırı DEĞİLDİR.</b> Düğmeleri gizlemek yetki
 * vermez: uçlar users.update/roles.update + geography.manage arar ve tarayıcı
 * ne gösterirse göstersin 403 döndürür. Buradaki kurallar yalnızca yapılamayacak
 * bir işi teklif etmemek içindir.
 */
export default function GeographicAuthorizationEditor({
  targetType,
  targetId,
  targetName,
  canView = true,
  canManage = false,
  onClose,
}) {
  const [status, setStatus] = useState('loading')
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  /* Taslak: kaydedilmemiş bir alan (yeni) ya da düzenlenmekte olan bir alan.
     `areaId` null ise ekleme, doluysa güncelleme. `parts` çok parçalı il/bölge
     seçimlerini taşır — hiçbir parça atılmaz. */
  const [draft, setDraft] = useState(null)
  const [draftToken, setDraftToken] = useState(0)
  const [mode, setMode] = useState('idle')
  const [fit, setFit] = useState({ token: 0, areaId: null })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  // 'delete' | 'close' — aynı anda yalnızca biri.
  const [confirm, setConfirm] = useState(null)
  const inFlight = useRef(false)

  const endpoints = ENDPOINTS[targetType]

  const load = useCallback(async () => {
    setStatus('loading'); setLoadError(''); setActionError(''); setNotice('')
    try {
      const res = await endpoints.fetch(targetId)
      if (!res.ok) {
        throw new Error(res.status === 403
          ? 'Bu hedefin coğrafi yetkisini görüntüleme yetkiniz bulunmuyor.'
          : await readApiError(res, 'Coğrafi yetki alanları yüklenemedi.'))
      }
      const body = await res.json()
      setData(body)
      setStatus('ready')
      // Açılışta kamera tüm alanları çerçeveler; alan yoksa Türkiye'ye döner.
      setFit((current) => ({ token: current.token + 1, areaId: null }))
    } catch (err) {
      /* Hata "kısıt yok" DEĞİLDİR ve öyle gösterilemez: yüklenemeyen alanlar
         için boş bir Türkiye haritası çizmek, var olan bir sınırı yokmuş gibi
         göstermek olurdu. Düzenleme, veri gelene kadar kapalı kalır. */
      setLoadError(err.message || 'Coğrafi yetki alanları yüklenemedi.')
      setStatus('error')
    }
  }, [endpoints, targetId])

  useEffect(() => { load() }, [load])

  const areas = useMemo(() => data?.areas ?? [], [data])
  const inheritedWkt = useMemo(() => inheritedScopeWkt(targetType, data), [targetType, data])

  const selected = useMemo(
    () => areas.find((area) => area.id === selectedId) ?? null,
    [areas, selectedId],
  )

  /* Düzenlenmekte olan alan haritada İKİ KEZ çizilmez: kayıtlı katmandan
     çıkarılır, taslak katmanında görünür. */
  const savedAreas = useMemo(
    () => (draft?.areaId == null ? areas : areas.filter((area) => area.id !== draft.areaId)),
    [areas, draft],
  )

  const draftWkts = useMemo(
    () => (draft?.parts ?? []).map((part) => part.wkt).filter(Boolean),
    [draft],
  )

  const hasDraftGeometry = draftWkts.length > 0
  const isDirty = draft !== null && hasDraftGeometry

  /* Seçim, listeden silinen bir alanın üzerinde kalmamalıdır. */
  useEffect(() => {
    if (selectedId != null && !areas.some((area) => area.id === selectedId)) setSelectedId(null)
  }, [areas, selectedId])

  /* Yetki CANLI okunur. Yönetme yetkisi düzenleyici açıkken kaldırılırsa
     etkileşim o anda durur: yarım kalan çizim ekranda kalabilir ama artık
     gönderilemez ve yeni bir köşe eklenemez. */
  useEffect(() => { if (!canManage && mode !== 'idle') setMode('idle') }, [canManage, mode])

  const requestClose = useCallback(() => {
    if (busy) return
    if (isDirty) { setConfirm('close'); return }
    onClose()
  }, [busy, isDirty, onClose])

  /* Escape: kirli değilse kapatır, kirliyse onay ister. Harita kendi klavye
     davranışını çalıştırsa bile bu koruma atlanamaz — dinleyici belgededir. */
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      if (confirm) { setConfirm(null); return }
      requestClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [confirm, requestClose])

  /** Taslağı dışarıdan kurar ve haritaya yeniden yazdırır. */
  const setDraftParts = useCallback((parts, nextMode = 'idle') => {
    setDraft((current) => (current ? { ...current, parts } : current))
    setDraftToken((token) => token + 1)
    setMode(nextMode)
  }, [])

  const startNewArea = () => {
    setActionError(''); setNotice('')
    setSelectedId(null)
    setDraft({ areaId: null, name: '', method: 'map', parts: [] })
    setDraftToken((token) => token + 1)
    setMode('draw')
  }

  const startEditArea = () => {
    if (!selected) return
    setActionError(''); setNotice('')
    setDraft({
      areaId: selected.id,
      name: selected.name,
      // Var olan bir alan düzenlenirken hazır kapsam sekmesi sunulmaz: il/bölge
      // seçimi birden çok parça üretebilir ve "tek alanı değiştir" isteğine
      // birden çok alan sığmaz. Yeni alan olarak eklemek her zaman mümkündür.
      method: 'map',
      parts: [{
        name: selected.name,
        wkt: selected.wkt,
        sourceType: selected.sourceType,
        sourceKey: selected.sourceKey,
      }],
    })
    setDraftToken((token) => token + 1)
    setMode('modify')
  }

  /* "Yeniden çiz" YALNIZCA yerel geometriyi boşaltır ve çizim kipine geçer.
     Sunucudaki alanı burada silmek, vazgeçilebilir bir düzenlemeyi kalıcı bir
     kayba çevirirdi; kaldırma ayrı ve onaylı bir eylemdir. */
  const redraw = () => {
    setActionError(''); setNotice('')
    setDraftParts([], 'draw')
  }

  const cancelDraft = () => {
    setActionError(''); setNotice('')
    setDraft(null)
    setDraftToken((token) => token + 1)
    setMode('idle')
  }

  const selectMethod = (method) => {
    setActionError('')
    setDraft((current) => (current ? { ...current, method, parts: [] } : current))
    setDraftToken((token) => token + 1)
    setMode(method === 'map' ? 'draw' : 'idle')
  }

  /** Haritada çizilen/düzenlenen tek geometri. */
  const handleWorkingChange = useCallback((wkt) => {
    setDraft((current) => {
      if (!current) return current
      if (!wkt) return current.parts.length <= 1 ? { ...current, parts: [] } : current
      const [existing] = current.parts
      return {
        ...current,
        parts: [{
          name: existing?.name ?? current.name,
          wkt,
          // Elle çizilen/taşınan bir geometri artık il sınırı değildir; etiketi
          // olduğu gibi bırakmak, kapsamla ilgisi kalmamış bir rozet olurdu.
          sourceType: current.method === 'coords' ? AREA_SOURCES.COORDINATES : AREA_SOURCES.MANUAL,
          sourceKey: null,
        }],
      }
    })
  }, [])

  /** İl/bölge seçiminden gelen hazır parçalar. */
  const handlePlacePick = useCallback((parts) => {
    setDraft((current) => (current ? { ...current, parts, name: parts.length === 1 ? parts[0].name : '' } : current))
    setDraftToken((token) => token + 1)
    setMode('idle')
  }, [])

  /** Koordinat girişinden gelen tek geometri. */
  const handleCoordinateChange = useCallback((wkt) => {
    setDraft((current) => {
      if (!current) return current
      const parts = wkt
        ? [{ name: current.name, wkt, sourceType: AREA_SOURCES.COORDINATES, sourceKey: null }]
        : []
      // Metin her tuşta değiştiği için token de artar; harita önizlemesi girdiyi
      // canlı takip eder.
      return { ...current, parts }
    })
    setDraftToken((token) => token + 1)
  }, [])

  const run = async (request, describe) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true); setActionError(''); setNotice('')
    try {
      const body = await request()
      /* Yeni durum SUNUCUNUN döndürdüğüdür. Kendi gönderdiğimizi "başarılı"
         saymak, kullanıcı hedefinde son alan silindiğinde devreye giren rol
         alanını ve sunucunun normalleştirdiği geometriyi kaçırırdı. */
      setData(body)
      setDraft(null)
      setDraftToken((token) => token + 1)
      setMode('idle')
      setNotice(describe)
    } catch (err) {
      /* Başarısız istekte taslak KORUNUR: yönetici alanı yeniden çizmek
         zorunda kalmadan tekrar deneyebilsin. */
      setActionError(err.message || 'İşlem tamamlanamadı.')
    } finally {
      inFlight.current = false; setBusy(false)
    }
  }

  const send = async (call) => {
    const res = await call()
    if (!res.ok) {
      throw new Error(res.status === 403
        ? 'Bu coğrafi yetkiyi değiştirme yetkiniz bulunmuyor.'
        : await readApiError(res, 'Coğrafi yetki alanı kaydedilemedi.'))
    }
    return res.json()
  }

  const save = () => {
    if (!draft || !hasDraftGeometry || !canManage) return

    const trimmed = draft.name.trim()

    if (draft.areaId != null) {
      const [part] = draft.parts
      run(
        () => send(() => endpoints.update(targetId, draft.areaId, {
          wkt: part.wkt,
          name: trimmed || part.name,
          sourceType: part.sourceType,
          sourceKey: part.sourceKey,
        })),
        'Coğrafi alan güncellendi.',
      )
      return
    }

    run(
      async () => {
        /* Parçalar SIRAYLA gönderilir ve son cevap kullanılır. Paralel
           göndermek daha hızlı olurdu ama biri başarısız olduğunda ekranın
           hangi parçaların yazıldığını bilmesi imkânsızlaşırdı. */
        let latest = null
        for (const [index, part] of draft.parts.entries()) {
          const name = draft.parts.length === 1 ? (trimmed || part.name) : part.name
          latest = await send(() => endpoints.create(targetId, {
            wkt: part.wkt,
            name,
            sourceType: part.sourceType,
            sourceKey: part.sourceKey,
          }))
          void index
        }
        return latest
      },
      draft.parts.length > 1
        ? `${draft.parts.length} coğrafi alan eklendi.`
        : 'Coğrafi alan eklendi.',
    )
  }

  const removeSelected = () => {
    setConfirm(null)
    if (!selected) return
    run(
      () => send(() => endpoints.remove(targetId, selected.id)),
      'Coğrafi alan kaldırıldı.',
    )
  }

  const selectArea = useCallback((id) => {
    setSelectedId((current) => (current === id ? null : id))
  }, [])

  const focusArea = (id) => {
    setSelectedId(id)
    setFit((current) => ({ token: current.token + 1, areaId: id }))
  }

  const subject = targetType === 'user' ? 'kullanıcının' : 'rolün'
  const areaCount = areas.length

  const statusTone = areaCount > 0 ? 'is-direct' : inheritedWkt ? 'is-inherited' : 'is-none'
  const statusText =
    areaCount > 0
      ? targetType === 'user'
        ? `Bu kullanıcı için ${areaCount} coğrafi alan tanımlı. Rol bazlı alanların yerine bu alanların birleşimi geçer.`
        : `Bu rol için ${areaCount} coğrafi alan tanımlı. Alanların birleşimi geçerlidir.`
      : inheritedWkt
        ? 'Bu kullanıcı için doğrudan coğrafi alan tanımlı değil. Etkin alan rol(ler) üzerinden geliyor.'
        : targetType === 'user'
          ? 'Bu kullanıcı için coğrafi kısıtlama bulunmuyor. Coğrafi alan tanımlanmadığı için kullanıcı mevcut izinleri kapsamında coğrafi olarak sınırsızdır.'
          : 'Bu rol için coğrafi yetki tanımlanmamış.'

  return (
    <div className="geo-editor-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose() }}>
      <section className="geo-editor" role="dialog" aria-modal="true" aria-labelledby="geo-editor-title">
        <header className="geo-editor-head">
          <div>
            <h2 id="geo-editor-title">Coğrafi Yetki — {targetName}</h2>
            <p>Bu alanlar, {subject} çizim yapabileceği coğrafi sınırı belirler.</p>
          </div>
          <button type="button" className="geo-editor-close" onClick={requestClose} aria-label="Coğrafi yetki penceresini kapat">×</button>
        </header>

        {!canView ? (
          /* Görüntüleme yetkisi düzenleyici AÇIKKEN kaldırıldı. Haritayı ve
             etkileşimi çalışır bırakmak, artık okunmasına izin verilmeyen bir
             veriyi ekranda tutmak olurdu. */
          <div className="geo-editor-state" role="alert">
            <p>Coğrafi yetkileri görüntüleme yetkiniz kaldırıldı.</p>
            <button type="button" className="admin-button secondary" onClick={onClose}>Kapat</button>
          </div>
        ) : status === 'loading' ? (
          <div className="geo-editor-state" role="status">Coğrafi yetki alanları yükleniyor…</div>
        ) : status === 'error' ? (
          <div className="geo-editor-state" role="alert">
            <p>{loadError}</p>
            <button type="button" className="admin-button secondary" onClick={load}>Tekrar dene</button>
          </div>
        ) : (
          <>
            <p className={`geo-editor-status ${statusTone}`}>{statusText}</p>

            <div className="geo-editor-body">
              <div className="geo-editor-areas">
                <div className="geo-areas-head">
                  <h3 id="geo-areas-title">Alanlar</h3>
                  {canManage && !draft && (
                    <button type="button" className="admin-button secondary" disabled={busy} onClick={startNewArea}>
                      Yeni Alan Ekle
                    </button>
                  )}
                </div>

                {areaCount === 0 ? (
                  <p className="geo-areas-empty" role="status">
                    {inheritedWkt
                      ? 'Bu hedefe özel alan yok. Haritadaki kesikli sınır rollerden geliyor.'
                      : 'Henüz alan tanımlanmamış.'}
                  </p>
                ) : (
                  <ul className="geo-areas-list" aria-labelledby="geo-areas-title" data-area-count={areaCount}>
                    {areas.map((area) => {
                      const isSelected = area.id === selectedId
                      const isEditing = draft?.areaId === area.id
                      return (
                        <li key={area.id}>
                          <button
                            type="button"
                            className={`geo-area-card ${isSelected ? 'is-selected' : ''} ${isEditing ? 'is-editing' : ''}`}
                            aria-pressed={isSelected}
                            data-area-id={area.id}
                            onClick={() => (isSelected ? focusArea(area.id) : selectArea(area.id))}
                          >
                            <span className="geo-area-name">{area.name}</span>
                            {/* Rozet renge DEĞİL metne dayanır. */}
                            <span className="geo-area-source">{areaSourceLabel(area.sourceType)}</span>
                            {isEditing && <span className="geo-area-flag">düzenleniyor</span>}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}

                {canManage && selected && !draft && (
                  <div className="geo-area-actions">
                    <button type="button" className="admin-button secondary" disabled={busy} onClick={startEditArea}>
                      Alanı Düzenle
                    </button>
                    <button type="button" className="admin-button danger" disabled={busy} onClick={() => setConfirm('delete')}>
                      Alanı Sil
                    </button>
                  </div>
                )}
              </div>

              <div className="geo-editor-mapwrap">
                <GeographicScopeMap
                  areas={savedAreas}
                  selectedId={selectedId}
                  inheritedWkt={inheritedWkt}
                  draftWkts={draftWkts}
                  draftToken={draftToken}
                  mode={mode}
                  fit={fit}
                  onWorkingChange={handleWorkingChange}
                  onDrawEnd={() => setMode('idle')}
                  onSelectArea={selectArea}
                />

                {/* Efsane renge DEĞİL metne dayanır; renk yalnızca ona eşlik eder. */}
                <ul className="geo-editor-legend">
                  <li><span className="geo-swatch is-direct" aria-hidden="true" />{targetType === 'user' ? 'Kullanıcıya özel alanlar' : 'Rol coğrafi alanları'}</li>
                  {draft && <li><span className="geo-swatch is-draft" aria-hidden="true" />Kaydedilmemiş taslak</li>}
                  {inheritedWkt && <li><span className="geo-swatch is-inherited" aria-hidden="true" />Rol üzerinden etkin alan (salt okunur)</li>}
                </ul>
              </div>
            </div>

            {canManage && draft && (
              <div className="geo-draft">
                <div className="geo-draft-head">
                  <h3>{draft.areaId == null ? 'Yeni alan' : 'Alanı düzenle'}</h3>
                  <button type="button" className="admin-button secondary" disabled={busy} onClick={cancelDraft}>
                    Taslağı İptal Et
                  </button>
                </div>

                {/* Yöntem sekmeleri: hepsi aynı anda gösterilmez. Var olan bir
                    alan düzenlenirken hazır kapsam sekmesi yoktur — bir il
                    seçimi birden çok parça üretebilir ve "tek alanı değiştir"
                    isteğine sığmaz. */}
                <div className="geo-method-tabs" role="group" aria-label="Alan oluşturma yöntemi">
                  {METHODS.filter((method) => draft.areaId == null || method.id !== 'place').map((method) => (
                    <button
                      key={method.id}
                      type="button"
                      className={`admin-button secondary ${draft.method === method.id ? 'is-active' : ''}`}
                      aria-pressed={draft.method === method.id}
                      disabled={busy}
                      onClick={() => selectMethod(method.id)}
                    >
                      {method.label}
                    </button>
                  ))}
                </div>

                {draft.method === 'map' && (
                  <div className="geo-method-body">
                    <p className="geo-method-hint" role="status">
                      {mode === 'draw'
                        ? 'Haritada köşeleri tıklayın, bitirmek için çift tıklayın.'
                        : hasDraftGeometry
                          ? 'Köşeleri sürükleyerek alanı düzenleyebilirsiniz.'
                          : 'Alanı haritada çizmek için “Çizime Başla”ya basın.'}
                    </p>
                    <div className="geo-method-actions">
                      {!hasDraftGeometry ? (
                        <button type="button" className={`admin-button secondary ${mode === 'draw' ? 'is-active' : ''}`} disabled={busy} onClick={() => setMode('draw')}>
                          Çizime Başla
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={`admin-button secondary ${mode === 'modify' ? 'is-active' : ''}`}
                            aria-pressed={mode === 'modify'}
                            disabled={busy}
                            onClick={() => setMode(mode === 'modify' ? 'idle' : 'modify')}
                          >
                            Köşeleri Düzenle
                          </button>
                          <button type="button" className="admin-button secondary" disabled={busy} onClick={redraw}>
                            Yeniden Çiz
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {draft.method === 'place' && (
                  <div className="geo-method-body">
                    <GeographicPlacePicker disabled={busy} onPick={handlePlacePick} />
                  </div>
                )}

                {draft.method === 'coords' && (
                  <div className="geo-method-body">
                    <CoordinateAreaInput disabled={busy} onChange={handleCoordinateChange} />
                  </div>
                )}

                {/* Ad yalnızca TEK parçalı taslakta düzenlenebilir: çok parçalı
                    bir il seçiminde her parça kendi adını taşır. */}
                {draft.parts.length <= 1 ? (
                  <label className="geo-field">
                    <span>Alan adı</span>
                    <input
                      type="text"
                      value={draft.name}
                      disabled={busy}
                      maxLength={120}
                      placeholder="Ankara Merkez, Saha 1…"
                      onChange={(event) => setDraft((current) => (current ? { ...current, name: event.target.value } : current))}
                    />
                  </label>
                ) : (
                  <p className="geo-method-hint" role="status">
                    {draft.parts.length} parça kendi adıyla eklenecek: {draft.parts.map((part) => part.name).join(', ')}
                  </p>
                )}
              </div>
            )}

            {/* Miras alınan alan varken çizilen alanın ne yapacağı ÖNCEDEN
                söylenir: doğrudan alanlar rolleri birleştirmez, ezer. */}
            {inheritedWkt && hasDraftGeometry && canManage && (
              <p className="geo-editor-warning" role="status">
                Kullanıcıya özel alan kaydedildiğinde rol bazlı coğrafi alanların yerine geçer.
              </p>
            )}

            {notice && <p className="geo-editor-notice" role="status">{notice}</p>}
            {actionError && <p className="geo-editor-error" role="alert">{actionError}</p>}

            {canManage ? (
              <div className="geo-editor-actions">
                <div className="geo-editor-tools">
                  {!draft && (
                    <button type="button" className="admin-button secondary" disabled={busy} onClick={startNewArea}>
                      Yeni Alan Ekle
                    </button>
                  )}
                </div>
                <div className="geo-editor-submit">
                  <button
                    type="button"
                    className="admin-button"
                    disabled={busy || !hasDraftGeometry}
                    onClick={save}
                  >
                    {busy
                      ? 'Kaydediliyor…'
                      : draft?.areaId != null
                        ? 'Alanı Kaydet'
                        : draft && draft.parts.length > 1
                          ? `${draft.parts.length} Alanı Kaydet`
                          : 'Alanı Kaydet'}
                  </button>
                </div>
              </div>
            ) : (
              /* Devre dışı bir düğme yığını, yapılamayacak bir işi vaat eder.
                 Sebep tek cümleyle yazılır ve kontroller HİÇ çizilmez. */
              <p className="geo-editor-readonly">
                Coğrafi alanlar yalnızca görüntüleniyor. Değişiklik yapmak için
                {targetType === 'user' ? ' kullanıcı düzenleme' : ' rol düzenleme'} ve coğrafi yetki yönetimi izinleri gerekir.
              </p>
            )}
          </>
        )}
      </section>

      {confirm && (
        <div className="admin-dialog-backdrop" role="presentation">
          <div className="admin-dialog" role="alertdialog" aria-modal="true" aria-labelledby="geo-confirm-title" aria-describedby="geo-confirm-copy">
            <h2 id="geo-confirm-title">
              {confirm === 'delete' ? 'Bu alan kaldırılsın mı?' : 'Kaydedilmemiş coğrafi alan değişiklikleri var'}
            </h2>
            <p id="geo-confirm-copy">
              {confirm === 'delete'
                ? areas.length > 1
                  ? `“${selected?.name}” alanı silinecek. Hedefin diğer ${areas.length - 1} alanı olduğu gibi kalır.`
                  : targetType === 'user'
                    ? 'Son alan silinecek. Kullanıcı, rollerinden gelen coğrafi alanlara düşer; rolünde de alan yoksa coğrafi olarak sınırsız olur.'
                    : 'Son alan silinecek. Bu rolü taşıyan ve kendi alanı olmayan kullanıcılar bu sınırdan çıkar.'
                : 'Taslağınız henüz kaydedilmedi. Devam ederseniz kaybolur; kayıtlı alanlara dokunulmaz.'}
            </p>
            <div className="admin-dialog-actions">
              <button type="button" className="admin-button secondary" disabled={busy} onClick={() => setConfirm(null)}>
                {confirm === 'delete' ? 'İptal' : 'Düzenlemeye Dön'}
              </button>
              <button type="button" className="admin-button danger" disabled={busy} onClick={confirm === 'delete' ? removeSelected : onClose}>
                {confirm === 'delete' ? 'Alanı Sil' : 'Değişiklikleri Yoksay'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
