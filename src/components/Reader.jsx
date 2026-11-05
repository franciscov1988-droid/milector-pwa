import { useEffect, useRef, useState } from 'react'
import ePub from 'epubjs'
import { loadSettings, saveSettings, uuid } from '../lib/settings.js'
import { cleanTitle } from '../lib/cover.js'

const THEMES = {
  paper: { body: { background: '#F6F5F1', color: '#2B2A27' } },  // PaperWhite (tinta electrónica)
  light: { body: { background: '#FFFFFF', color: '#1A1A1A' } },
  sepia: { body: { background: '#FBF6EC', color: '#3A2F1E' } },
  dark: { body: { background: '#121212', color: '#D8D8D8' } },
  night: { body: { background: '#000000', color: '#B8B8B8' } }
}
const PAGE_BG = { paper: '#F6F5F1', light: '#FFFFFF', sepia: '#FBF6EC', dark: '#121212', night: '#000000' }
const FONTS = {
  original: null,
  serif: 'Georgia, Cambria, "Times New Roman", serif',
  sans: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace'
}
const HL_COLORS = [
  { name: 'Amarillo', value: '#FFE066' },
  { name: 'Verde', value: '#A7E0A0' },
  { name: 'Azul', value: '#9BD1F5' },
  { name: 'Rosa', value: '#F3A6C4' }
]

export default function Reader({
  buffer, book, onSaveProgress, onAddBookmark, onRemoveBookmark,
  onSaveHighlight, onRemoveHighlight, onBack
}) {
  const bookId = book.id
  const progress = book.progress
  const bookmarks = book.bookmarks || []

  const viewerRef = useRef(null)
  const bookRef = useRef(null)
  const rendRef = useRef(null)
  const spineLen = useRef(1)
  const saveTimer = useRef(null)
  const lastPos = useRef(null)
  const wakeLock = useRef(null)
  const selContents = useRef(null)
  const hlRef = useRef(book.highlights || [])

  const [settings, setSettings] = useState(loadSettings())
  const [panel, setPanel] = useState(null)
  const [pos, setPos] = useState({ percent: progress?.percent || 0, page: 1, total: 1, chapterIndex: 0, progressInChapter: 0 })
  const [ready, setReady] = useState(false)

  const [sel, setSel] = useState(null)          // selección activa: {cfiRange, text}
  const [selColor, setSelColor] = useState(HL_COLORS[0].value)
  const [editNote, setEditNote] = useState(null) // highlight cuya nota se edita
  const [activeHL, setActiveHL] = useState(null) // id del subrayado tocado
  const [shareBox, setShareBox] = useState(null) // texto de la cita a compartir

  useEffect(() => { hlRef.current = book.highlights || [] }, [book.highlights])

  function onAnnotationClick(id) { setActiveHL(id) }

  function applyAllAnnotations() {
    const r = rendRef.current
    if (!r) return
    for (const hl of hlRef.current) {
      try {
        r.annotations.highlight(hl.cfi, { id: hl.id }, () => onAnnotationClick(hl.id), '',
          { fill: hl.color, 'fill-opacity': '0.35' })
      } catch {}
    }
  }

  useEffect(() => {
    let destroyed = false
    const b = ePub(buffer, { openAs: 'binary' })
    bookRef.current = b
    const rendition = b.renderTo(viewerRef.current, {
      width: '100%', height: '100%', flow: 'paginated', manager: 'default', spread: 'auto'
    })
    rendRef.current = rendition
    registerThemes(rendition)
    applySettings(rendition, settings)

    b.ready.then(async () => {
      if (destroyed) return
      spineLen.current = b.spine?.items?.length || 1
      await restore(rendition, b, progress)
      applyAllAnnotations()
      setReady(true)
      b.locations.generate(1600).catch(() => {})
    })

    rendition.on('relocated', (loc) => {
      const chapterIndex = loc.start.index || 0
      const page = loc.start.displayed?.page || 1
      const total = loc.start.displayed?.total || 1
      const progressInChapter = total > 1 ? (page - 1) / (total - 1) : 0
      let percent
      if (b.locations && b.locations.length && b.locations.length()) percent = (b.locations.percentageFromCfi(loc.start.cfi) || 0) * 100
      else percent = ((chapterIndex + progressInChapter) / spineLen.current) * 100
      const p = { chapterIndex, progressInChapter, percent, page, total }
      lastPos.current = p; setPos(p); scheduleSave(p)
    })

    // Selección de texto → barra de acciones
    rendition.on('selected', (cfiRange, contents) => {
      let text = ''
      try { text = contents.window.getSelection().toString() } catch {}
      if (!text || !text.trim()) return
      selContents.current = contents
      setSel({ cfiRange, text: text.trim() })
    })

    return () => {
      destroyed = true
      if (saveTimer.current) clearTimeout(saveTimer.current)
      flushSave()
      try { rendition.destroy() } catch {}
      try { b.destroy() } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer])

  useEffect(() => { saveSettings(settings); if (rendRef.current) applySettings(rendRef.current, settings) }, [settings])
  useEffect(() => {
    const onResize = () => { try { rendRef.current?.resize() } catch {} }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  useEffect(() => {
    async function lock() { try { if ('wakeLock' in navigator) wakeLock.current = await navigator.wakeLock.request('screen') } catch {} }
    lock()
    const onVis = () => { if (document.visibilityState === 'hidden') flushSave(); else lock() }
    const onUnload = () => flushSave()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('beforeunload', onUnload)
      try { wakeLock.current?.release() } catch {}
    }
  }, [])
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') rendRef.current?.next()
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') rendRef.current?.prev()
    }
    window.addEventListener('keyup', onKey)
    return () => window.removeEventListener('keyup', onKey)
  }, [])

  function scheduleSave(p) { if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => flushSave(p), 700) }
  function flushSave(p) {
    const cur = p || lastPos.current
    if (!cur) return
    onSaveProgress(bookId, { chapterIndex: cur.chapterIndex, progressInChapter: cur.progressInChapter, percent: cur.percent })
  }
  function addBookmark() {
    const cur = lastPos.current || pos
    onAddBookmark(bookId, {
      id: uuid(), bookId, chapterIndex: cur.chapterIndex, progressInChapter: cur.progressInChapter,
      percent: cur.percent, snippet: `Capítulo ${cur.chapterIndex + 1} · ${Math.round(cur.percent)}%`, createdAt: Date.now()
    })
  }
  async function goToBookmark(bm) { setPanel(null); await restore(rendRef.current, bookRef.current, bm) }

  // --- Selección / subrayados ---
  function clearSelection() {
    try { selContents.current?.window.getSelection().removeAllRanges() } catch {}
    setSel(null)
  }
  function createHighlight(color, openNote) {
    if (!sel) return
    const hl = {
      id: uuid(), cfi: sel.cfiRange, text: sel.text, color, note: '',
      chapterIndex: pos.chapterIndex, percent: pos.percent, createdAt: Date.now(), updatedAt: Date.now()
    }
    try {
      rendRef.current.annotations.highlight(hl.cfi, { id: hl.id }, () => onAnnotationClick(hl.id), '',
        { fill: color, 'fill-opacity': '0.35' })
    } catch {}
    onSaveHighlight(bookId, hl)
    clearSelection()
    if (openNote) setEditNote(hl)
  }
  function saveNote(hl, note) {
    onSaveHighlight(bookId, { ...hl, note, updatedAt: Date.now() })
    setEditNote(null)
  }
  function changeColor(hl, color) {
    try { rendRef.current.annotations.remove(hl.cfi, 'highlight') } catch {}
    try {
      rendRef.current.annotations.highlight(hl.cfi, { id: hl.id }, () => onAnnotationClick(hl.id), '',
        { fill: color, 'fill-opacity': '0.35' })
    } catch {}
    onSaveHighlight(bookId, { ...hl, color, updatedAt: Date.now() })
  }
  function deleteHighlight(hl) {
    try { rendRef.current.annotations.remove(hl.cfi, 'highlight') } catch {}
    onRemoveHighlight(bookId, hl.id)
    setActiveHL(null)
  }
  async function goToHighlight(hl) { setPanel(null); try { await rendRef.current.display(hl.cfi) } catch {} }

  // --- Compartir con cita ---
  function buildCita(text) {
    const autorTitulo = `${book.author ? book.author + ', ' : ''}${cleanTitle(book.title)}`
    return `"${text.trim()}"\n\n— ${autorTitulo}`
  }
  function doShare(text) {
    const cita = buildCita(text)
    if (navigator.share) { navigator.share({ text: cita }).catch(() => {}); return }
    setShareBox(cita)
  }

  const highlights = book.highlights || []

  return (
    <div className="reader">
      <div className="rbar">
        <button className="icon" onClick={() => { flushSave(); onBack() }} title="Volver">←</button>
        <h2 style={{ flex: 1 }}>{cleanTitle(book.title)}</h2>
        <button className="icon" onClick={addBookmark} title="Marcar página">🔖</button>
        <button className="icon" onClick={() => setPanel('notes')} title="Notas y subrayados">🖍️</button>
        <button className="icon" onClick={() => setPanel('bookmarks')} title="Marcadores">≡</button>
        <button className="icon" onClick={() => setPanel('settings')} title="Ajustes">Aa</button>
      </div>

      <div className="viewer" style={{ padding: `0 ${settings.margin}px`, background: PAGE_BG[settings.theme] }}>
        <div ref={viewerRef} style={{ height: '100%' }} />
        {!ready && (
          <div className="overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: PAGE_BG[settings.theme] }}>
            <span className="spinner" />
          </div>
        )}
        {!sel && <div className="nav left" onClick={() => rendRef.current?.prev()}><span>‹</span></div>}
        {!sel && <div className="nav right" onClick={() => rendRef.current?.next()}><span>›</span></div>}
      </div>

      {/* Barra que aparece al seleccionar texto */}
      {sel && (
        <div className="selbar">
          <div className="swatches">
            {HL_COLORS.map((c) => (
              <button key={c.value} className={`sw ${selColor === c.value ? 'on' : ''}`}
                style={{ background: c.value }} title={c.name} onClick={() => setSelColor(c.value)} />
            ))}
          </div>
          <button className="sb" onClick={() => createHighlight(selColor, false)}>🖍️ Subrayar</button>
          <button className="sb" onClick={() => createHighlight(selColor, true)}>📝 Nota</button>
          <button className="sb" onClick={() => { doShare(sel.text); clearSelection() }}>📤 Compartir</button>
          <button className="icon" onClick={clearSelection} title="Cancelar">✕</button>
        </div>
      )}

      <div className="rfoot">
        <span>{Math.round(pos.percent)}%</span>
        <input type="range" min="0" max="100" value={Math.round(pos.percent)}
          onChange={(e) => seekPercent(rendRef.current, bookRef.current, Number(e.target.value))} />
        <span>{pos.total > 1 ? `${pos.total - pos.page} pág. rest.` : ''}</span>
      </div>

      {panel && <div className="overlay" onClick={() => setPanel(null)} />}
      {panel === 'settings' && <SettingsPanel settings={settings} setSettings={setSettings} onClose={() => setPanel(null)} />}
      {panel === 'bookmarks' && <BookmarksPanel bookmarks={bookmarks} onGo={goToBookmark} onRemove={(id) => onRemoveBookmark(bookId, id)} onClose={() => setPanel(null)} />}
      {panel === 'notes' && (
        <NotesPanel highlights={highlights} onGo={goToHighlight} onEdit={(hl) => setEditNote(hl)}
          onShare={(t) => doShare(t)} onDelete={deleteHighlight} onClose={() => setPanel(null)} />
      )}

      {/* Acciones al tocar un subrayado existente */}
      {activeHL && (() => {
        const hl = highlights.find((h) => h.id === activeHL)
        if (!hl) return null
        return (
          <HLActions hl={hl}
            onNote={() => { setActiveHL(null); setEditNote(hl) }}
            onShare={() => { setActiveHL(null); doShare(hl.text) }}
            onColor={(c) => changeColor(hl, c)}
            onDelete={() => deleteHighlight(hl)}
            onClose={() => setActiveHL(null)} />
        )
      })()}

      {editNote && <NoteEditor hl={editNote} onSave={saveNote} onClose={() => setEditNote(null)} />}
      {shareBox && <ShareDialog text={shareBox} onClose={() => setShareBox(null)} />}
    </div>
  )
}

/* ------------ helpers epub.js ------------ */
function registerThemes(r) { for (const [n, rules] of Object.entries(THEMES)) r.themes.register(n, rules) }
function applySettings(r, s) {
  r.themes.select(s.theme)
  r.themes.fontSize(`${s.fontSize}%`)
  const fam = FONTS[s.fontFamily]
  r.themes.override('font-family', fam || '', !!fam)
  r.themes.override('line-height', String(s.lineHeight), true)
  r.themes.override('text-align', s.textAlign, true)
}
async function restore(rendition, book, prog) {
  if (!rendition || !book) return
  try {
    let href
    if (prog && typeof prog.chapterIndex === 'number') href = book.spine.get(prog.chapterIndex)?.href
    await rendition.display(href || undefined)
    const frac = prog?.progressInChapter || 0
    if (frac > 0) {
      const total = rendition.currentLocation()?.start?.displayed?.total || 1
      const target = Math.round(frac * (total - 1)) + 1
      let guard = 0
      while ((rendition.currentLocation()?.start?.displayed?.page || 1) < target && guard < total + 3) { await rendition.next(); guard++ }
    }
  } catch { try { await rendition.display() } catch {} }
}
async function seekPercent(rendition, book, pct) {
  if (!rendition || !book) return
  try { if (book.locations?.length?.()) await rendition.display(book.locations.cfiFromPercentage(pct / 100)) } catch {}
}

/* ------------ paneles y diálogos ------------ */
function SettingsPanel({ settings, setSettings, onClose }) {
  const set = (patch) => setSettings({ ...settings, ...patch })
  return (
    <div className="panel">
      <h3>Ajustes de lectura</h3>
      <Row label="Tema" items={[['paper','PaperWhite'],['light','Claro'],['sepia','Sepia'],['dark','Oscuro'],['night','Noche']]} val={settings.theme} on={(v)=>set({theme:v})} />
      <Row label="Fuente" items={[['original','Original'],['serif','Serif'],['sans','Sans'],['mono','Mono']]} val={settings.fontFamily} on={(v)=>set({fontFamily:v})} />
      <Row label="Alineación" items={[['left','Izquierda'],['justify','Justificado'],['center','Centro'],['right','Derecha']]} val={settings.textAlign} on={(v)=>set({textAlign:v})} />
      <div className="row"><label>Tamaño de letra: {settings.fontSize}%</label>
        <input type="range" min="70" max="200" value={settings.fontSize} onChange={(e)=>set({fontSize:Number(e.target.value)})} /></div>
      <div className="row"><label>Interlineado: {settings.lineHeight.toFixed(1)}</label>
        <input type="range" min="1" max="2.6" step="0.1" value={settings.lineHeight} onChange={(e)=>set({lineHeight:Number(e.target.value)})} /></div>
      <div className="row"><label>Márgenes: {settings.margin}px</label>
        <input type="range" min="0" max="160" step="4" value={settings.margin} onChange={(e)=>set({margin:Number(e.target.value)})} /></div>
      <button className="ghost btn-full" onClick={onClose}>Cerrar</button>
    </div>
  )
}
function Row({ label, items, val, on }) {
  return (
    <div className="row">
      <label>{label}</label>
      <div className="chips">{items.map(([v, l]) => <button key={v} className={`chip ${val === v ? 'active' : ''}`} onClick={() => on(v)}>{l}</button>)}</div>
    </div>
  )
}
function BookmarksPanel({ bookmarks, onGo, onRemove, onClose }) {
  return (
    <div className="panel">
      <h3>Marcadores</h3>
      {(!bookmarks || bookmarks.length === 0) && <p style={{ color: 'var(--muted)', fontSize: 14 }}>Sin marcadores todavía.</p>}
      {(bookmarks || []).slice().sort((a, b) => a.percent - b.percent).map((bm) => (
        <div className="bm-item" key={bm.id}>
          <div className="txt" onClick={() => onGo(bm)}>{bm.snippet}<div className="sub">{Math.round(bm.percent)}%</div></div>
          <button className="icon" onClick={() => onRemove(bm.id)} title="Eliminar">🗑</button>
        </div>
      ))}
      <button className="ghost btn-full" onClick={onClose} style={{ marginTop: 12 }}>Cerrar</button>
    </div>
  )
}
function NotesPanel({ highlights, onGo, onEdit, onShare, onDelete, onClose }) {
  const list = (highlights || []).slice().sort((a, b) => (a.percent || 0) - (b.percent || 0))
  return (
    <div className="panel">
      <h3>Notas y subrayados</h3>
      {list.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 14 }}>Selecciona texto mientras lees para subrayar o anotar.</p>}
      {list.map((hl) => (
        <div className="hl-item" key={hl.id}>
          <div className="hl-bar" style={{ background: hl.color }} />
          <div className="hl-body">
            <div className="hl-text" onClick={() => onGo(hl)}>“{hl.text}”</div>
            {hl.note ? <div className="hl-note">📝 {hl.note}</div> : null}
            <div className="hl-actions">
              <button className="mini" onClick={() => onEdit(hl)}>{hl.note ? 'Editar nota' : 'Agregar nota'}</button>
              <button className="mini" onClick={() => onShare(hl.text)}>Compartir</button>
              <button className="mini danger" onClick={() => onDelete(hl)}>Eliminar</button>
            </div>
          </div>
        </div>
      ))}
      <button className="ghost btn-full" onClick={onClose} style={{ marginTop: 12 }}>Cerrar</button>
    </div>
  )
}
function HLActions({ hl, onNote, onShare, onColor, onDelete, onClose }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Subrayado</h3>
        <p style={{ fontStyle: 'italic' }}>“{hl.text}”</p>
        {hl.note ? <p style={{ fontSize: 14 }}>📝 {hl.note}</p> : null}
        <div className="swatches" style={{ margin: '8px 0 16px' }}>
          {HL_COLORS.map((c) => (
            <button key={c.value} className={`sw ${hl.color === c.value ? 'on' : ''}`} style={{ background: c.value }} title={c.name} onClick={() => onColor(c.value)} />
          ))}
        </div>
        <div className="share-grid">
          <button onClick={onNote}>📝 {hl.note ? 'Editar nota' : 'Nota'}</button>
          <button onClick={onShare}>📤 Compartir</button>
        </div>
        <button className="ghost btn-full danger" onClick={onDelete} style={{ marginTop: 10 }}>Eliminar subrayado</button>
        <button className="ghost btn-full" onClick={onClose} style={{ marginTop: 8 }}>Cerrar</button>
      </div>
    </div>
  )
}
function NoteEditor({ hl, onSave, onClose }) {
  const [text, setText] = useState(hl.note || '')
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Nota</h3>
        <p style={{ fontStyle: 'italic' }}>“{hl.text}”</p>
        <textarea className="ta note" placeholder="Escribe tu nota…" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        <div style={{ height: 12 }} />
        <button className="btn-full" onClick={() => onSave(hl, text)}>Guardar nota</button>
        <button className="ghost btn-full" onClick={onClose} style={{ marginTop: 8 }}>Cancelar</button>
      </div>
    </div>
  )
}
function ShareDialog({ text, onClose }) {
  const enc = encodeURIComponent(text)
  const copy = async () => { try { await navigator.clipboard.writeText(text) } catch {} ; onClose() }
  const open = (url) => { window.open(url, '_blank', 'noopener'); onClose() }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Compartir cita</h3>
        <p style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{text}</p>
        <div className="share-grid">
          <button onClick={copy}>📋 Copiar</button>
          <button onClick={() => open('https://wa.me/?text=' + enc)}>WhatsApp</button>
          <button onClick={() => open('https://twitter.com/intent/tweet?text=' + enc)}>X</button>
          <button onClick={() => open('https://t.me/share/url?url=&text=' + enc)}>Telegram</button>
        </div>
        <button className="ghost btn-full" onClick={onClose} style={{ marginTop: 12 }}>Cerrar</button>
      </div>
    </div>
  )
}
