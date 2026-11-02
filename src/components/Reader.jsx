import { useEffect, useRef, useState } from 'react'
import ePub from 'epubjs'
import { loadSettings, saveSettings, uuid } from '../lib/settings.js'
import { cleanTitle } from '../lib/cover.js'

const THEMES = {
  light: { body: { background: '#FFFFFF', color: '#1A1A1A' } },
  sepia: { body: { background: '#FBF6EC', color: '#3A2F1E' } },
  dark: { body: { background: '#121212', color: '#D8D8D8' } },
  night: { body: { background: '#000000', color: '#B8B8B8' } }
}
const PAGE_BG = { light: '#FFFFFF', sepia: '#FBF6EC', dark: '#121212', night: '#000000' }
const FONTS = {
  original: null,
  serif: 'Georgia, Cambria, "Times New Roman", serif',
  sans: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace'
}

export default function Reader({
  buffer, book, onSaveProgress, onAddBookmark, onRemoveBookmark, onBack
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

  const [settings, setSettings] = useState(loadSettings())
  const [panel, setPanel] = useState(null)
  const [pos, setPos] = useState({ percent: progress?.percent || 0, page: 1, total: 1, chapterIndex: 0, progressInChapter: 0 })
  const [ready, setReady] = useState(false)

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
      setReady(true)
      b.locations.generate(1600).catch(() => {})
    })

    rendition.on('relocated', (loc) => {
      const chapterIndex = loc.start.index || 0
      const page = loc.start.displayed?.page || 1
      const total = loc.start.displayed?.total || 1
      const progressInChapter = total > 1 ? (page - 1) / (total - 1) : 0
      let percent
      if (b.locations && b.locations.length && b.locations.length()) {
        percent = (b.locations.percentageFromCfi(loc.start.cfi) || 0) * 100
      } else {
        percent = ((chapterIndex + progressInChapter) / spineLen.current) * 100
      }
      const p = { chapterIndex, progressInChapter, percent, page, total }
      lastPos.current = p; setPos(p); scheduleSave(p)
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

  useEffect(() => {
    saveSettings(settings)
    if (rendRef.current) applySettings(rendRef.current, settings)
  }, [settings])

  useEffect(() => {
    const onResize = () => { try { rendRef.current?.resize() } catch {} }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    async function lock() {
      try { if ('wakeLock' in navigator) wakeLock.current = await navigator.wakeLock.request('screen') } catch {}
    }
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

  function scheduleSave(p) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => flushSave(p), 700)
  }
  function flushSave(p) {
    const cur = p || lastPos.current
    if (!cur) return
    onSaveProgress(bookId, {
      chapterIndex: cur.chapterIndex, progressInChapter: cur.progressInChapter, percent: cur.percent
    })
  }

  function addBookmark() {
    const cur = lastPos.current || pos
    onAddBookmark(bookId, {
      id: uuid(), bookId, chapterIndex: cur.chapterIndex, progressInChapter: cur.progressInChapter,
      percent: cur.percent, snippet: `Capítulo ${cur.chapterIndex + 1} · ${Math.round(cur.percent)}%`, createdAt: Date.now()
    })
  }
  async function goToBookmark(bm) { setPanel(null); await restore(rendRef.current, bookRef.current, bm) }

  return (
    <div className="reader">
      <div className="rbar">
        <button className="icon" onClick={() => { flushSave(); onBack() }} title="Volver">←</button>
        <h2 style={{ flex: 1 }}>{cleanTitle(book.title)}</h2>
        <button className="icon" onClick={addBookmark} title="Marcar página">🔖</button>
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
        <div className="nav left" onClick={() => rendRef.current?.prev()}><span>‹</span></div>
        <div className="nav right" onClick={() => rendRef.current?.next()}><span>›</span></div>
      </div>

      <div className="rfoot">
        <span>{Math.round(pos.percent)}%</span>
        <input type="range" min="0" max="100" value={Math.round(pos.percent)}
          onChange={(e) => seekPercent(rendRef.current, bookRef.current, Number(e.target.value))} />
        <span>{pos.total > 1 ? `${pos.total - pos.page} pág. rest.` : ''}</span>
      </div>

      {panel && <div className="overlay" onClick={() => setPanel(null)} />}
      {panel === 'settings' && <SettingsPanel settings={settings} setSettings={setSettings} onClose={() => setPanel(null)} />}
      {panel === 'bookmarks' && (
        <BookmarksPanel bookmarks={bookmarks} onGo={goToBookmark}
          onRemove={(id) => onRemoveBookmark(bookId, id)} onClose={() => setPanel(null)} />
      )}
    </div>
  )
}

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
      while ((rendition.currentLocation()?.start?.displayed?.page || 1) < target && guard < total + 3) {
        await rendition.next(); guard++
      }
    }
  } catch { try { await rendition.display() } catch {} }
}
async function seekPercent(rendition, book, pct) {
  if (!rendition || !book) return
  try { if (book.locations?.length?.()) await rendition.display(book.locations.cfiFromPercentage(pct / 100)) } catch {}
}

function SettingsPanel({ settings, setSettings, onClose }) {
  const set = (patch) => setSettings({ ...settings, ...patch })
  return (
    <div className="panel">
      <h3>Ajustes de lectura</h3>
      <Row label="Tema" items={[['light','Claro'],['sepia','Sepia'],['dark','Oscuro'],['night','Noche']]} val={settings.theme} on={(v)=>set({theme:v})} />
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
      <div className="chips">
        {items.map(([v, l]) => (
          <button key={v} className={`chip ${val === v ? 'active' : ''}`} onClick={() => on(v)}>{l}</button>
        ))}
      </div>
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
