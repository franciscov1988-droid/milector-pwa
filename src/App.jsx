import { useEffect, useMemo, useRef, useState } from 'react'
import * as DB from './lib/db.js'
import * as FB from './lib/firebase.js'
import * as CLOUD from './lib/cloud.js'
import { importEpubFile } from './lib/epubImport.js'
import { downloadBackup, importBackupFile } from './lib/backup.js'
import { makeThumbDataUrl, dataUrlToBlob } from './lib/coverUtil.js'
import Library from './components/Library.jsx'
import Reader from './components/Reader.jsx'

const hiddenInput = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', border: 0, opacity: 0 }

function activity(b) { return Math.max(b.lastOpenedAt || 0, b.progress?.updatedAt || 0) }

export default function App() {
  const [localBooks, setLocalBooks] = useState([])
  const [cloudMeta, setCloudMeta] = useState({})   // id -> remote
  const [current, setCurrent] = useState(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [toast, setToast] = useState('')
  const [menu, setMenu] = useState(false)
  const [backupModal, setBackupModal] = useState(false)

  // Firebase / sesión
  const [user, setUser] = useState(null)
  const [configModal, setConfigModal] = useState(false)
  const [authModal, setAuthModal] = useState(false)
  const [cfgText, setCfgText] = useState('')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')

  const fileInput = useRef(null)
  const importInput = useRef(null)
  const coverInput = useRef(null)
  const pendingCoverBook = useRef(null)
  const installEvt = useRef(null)
  const unsubLib = useRef(null)
  const firstSnap = useRef(true)
  const [canInstall, setCanInstall] = useState(false)
  const [coverVer, setCoverVer] = useState(0)   // fuerza refrescar portadas

  async function reload() { setLocalBooks(await DB.getAllBooks()) }
  useEffect(() => { reload() }, [])

  // Lista mostrada: une libros locales + los que solo están en la nube.
  // El progreso mostrado es el MÁS AVANZADO entre lo local y lo de la nube,
  // para que el % aparezca al instante aunque no hayas reabierto el libro.
  const books = useMemo(() => {
    const byId = new Map()
    for (const b of localBooks) {
      const r = cloudMeta[b.id]
      byId.set(b.id, { ...b, cloudOnly: false, progress: CLOUD.bestProgress(b.progress, r?.progress), coverThumb: r?.coverThumb || null })
    }
    for (const id of Object.keys(cloudMeta)) {
      if (!byId.has(id)) {
        const r = cloudMeta[id]
        byId.set(id, { id, title: r.title || 'Libro', author: r.author || '', progress: r.progress || null, bookmarks: r.bookmarks || [], lastOpenedAt: 0, cloudOnly: true, coverThumb: r.coverThumb || null })
      }
    }
    return [...byId.values()].sort((a, b) => {
      const d = activity(b) - activity(a)
      return d !== 0 ? d : (a.title || '').localeCompare(b.title || '')
    })
  }, [localBooks, cloudMeta])

  // --- Firebase: observar sesión ---
  useEffect(() => {
    if (!FB.hasConfig()) return
    FB.initFirebase()
    const unsub = FB.watchAuth((u) => {
      setUser(u || null)
      if (u && FB.isCloudOn()) startLibraryListener(u.uid)
      else stopLibraryListener()
    })
    return () => { unsub && unsub(); stopLibraryListener() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stopLibraryListener() {
    if (unsubLib.current) { unsubLib.current(); unsubLib.current = null }
    firstSnap.current = true
  }
  function startLibraryListener(uid) {
    stopLibraryListener()
    unsubLib.current = FB.watchLibrary(uid, async (items) => {
      // Aplica progreso remoto al local y refresca
      for (const r of items) { try { await CLOUD.applyRemoteBook(r) } catch {} }
      const map = {}
      for (const r of items) map[r.id] = r
      setCloudMeta(map)
      await reload()
      // Primera vez: sube los libros locales que falten en la nube
      if (firstSnap.current) {
        firstSnap.current = false
        const ids = new Set(items.map((x) => x.id))
        try { await CLOUD.uploadMissing(uid, ids, (i, t, n) => setStatus(`Respaldando ${i}/${t}…`)) } catch {}
        setStatus('')
      }
    })
  }

  useEffect(() => {
    const onBip = (e) => { e.preventDefault(); installEvt.current = e; setCanInstall(true) }
    window.addEventListener('beforeinstallprompt', onBip)
    return () => window.removeEventListener('beforeinstallprompt', onBip)
  }, [])

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 2800) }

  // --- Activar sincronización ---
  function enableSync() {
    setMenu(false)
    if (!FB.hasConfig()) { setCfgText(''); setConfigModal(true); return }
    setAuthModal(true)
  }
  function saveConfig() {
    try {
      const cfg = FB.parseConfig(cfgText)
      FB.saveConfig(cfg)
      FB.initFirebase()
      setConfigModal(false)
      setAuthModal(true)
    } catch (e) { showToast(e.message) }
  }
  async function doAuth(create) {
    if (!email.trim() || !pass) { showToast('Escribe tu correo y contraseña'); return }
    setBusy(true); setStatus(create ? 'Creando cuenta…' : 'Entrando…')
    try {
      const u = create ? await FB.signUp(email.trim(), pass) : await FB.signInEmail(email.trim(), pass)
      FB.setCloudOn(true)
      setUser(u); setAuthModal(false); setPass('')
      startLibraryListener(u.uid)
      showToast('Sincronización activada')
    } catch (e) {
      showToast(traducirError(e.message))
    } finally { setBusy(false); setStatus('') }
  }
  async function disableSync() {
    setMenu(false)
    stopLibraryListener()
    FB.setCloudOn(false)
    await FB.logout()
    setUser(null); setCloudMeta({})
    showToast('Sincronización desactivada (la lectura sigue funcionando)')
  }

  // --- Importar ---
  async function onPickEpubs(ev) {
    const files = [...(ev.target.files || [])]
    ev.target.value = ''
    if (!files.length) return
    setBusy(true)
    try {
      let n = 0; const added = []
      for (const f of files) { setStatus(`Importando ${++n}/${files.length}…`); added.push(await importEpubFile(f)) }
      await reload()
      showToast(files.length > 1 ? `${files.length} libros agregados` : 'Libro agregado')
      if (user && FB.isCloudOn()) {
        setStatus('Respaldando en la nube…')
        for (const bk of added) if (bk) { try { await CLOUD.uploadBook(user.uid, bk) } catch {} }
      }
    } catch (e) { showToast('Error al importar: ' + e.message) }
    finally { setBusy(false); setStatus('') }
  }

  // --- Abrir libro (trae la última página de la nube) ---
  async function openBook(book) {
    // Libro que está en tu nube pero sin el archivo en este dispositivo
    if (book.cloudOnly || !(await DB.getEpub(book.id))) {
      showToast('Este libro está en tu nube. Agrégalo aquí con “＋ Agregar EPUB” (el mismo archivo); tu última página ya está guardada.')
      return
    }
    setBusy(true); setStatus('Abriendo…')
    try {
      // Traer el progreso más reciente desde Firestore (la última página de otro equipo)
      if (user && FB.isCloudOn()) {
        try {
          setStatus('Buscando tu última página…')
          const remote = await FB.cloudGetBook(user.uid, book.id)
          if (remote) await CLOUD.applyRemoteBook({ id: book.id, ...remote })
        } catch { /* sin conexión: usamos lo local */ }
      }
      const fresh = await DB.getBook(book.id)
      const ab = await DB.getEpub(book.id)
      if (!fresh || !ab) { showToast('No se pudo abrir el libro'); return }
      const updated = { ...fresh, lastOpenedAt: Date.now() }
      await DB.putBook(updated)
      setCurrent({ buffer: ab.slice(0), book: updated })
      reload()
    } catch (e) { showToast('Error: ' + e.message) }
    finally { setBusy(false); setStatus('') }
  }

  async function deleteBook(book) {
    if (!window.confirm(`¿Eliminar “${book.title}” de este dispositivo? (No se borra de la nube.)`)) return
    await DB.deleteBookAll(book.id); await reload(); showToast('Libro eliminado de este dispositivo')
  }

  // --- Portadas ---
  function changeCover(book) { pendingCoverBook.current = book; coverInput.current?.click() }
  async function onPickCover(ev) {
    const f = ev.target.files?.[0]; ev.target.value = ''
    const book = pendingCoverBook.current; pendingCoverBook.current = null
    if (!f || !book) return
    setBusy(true); setStatus('Guardando portada…')
    try {
      const dataUrl = await makeThumbDataUrl(f, 600)        // miniatura local nítida
      await DB.putCover(book.id, await dataUrlToBlob(dataUrl))
      // Asegurar que el libro exista localmente (si era solo de la nube, igual guardamos la portada)
      if (!(await DB.getBook(book.id)) && book.cloudOnly) {
        await DB.putBook({ id: book.id, title: book.title, author: book.author || '', addedAt: Date.now(), lastOpenedAt: 0, progress: book.progress || null, bookmarks: [], highlights: [], markers: [] })
      }
      setCoverVer((v) => v + 1)
      await reload()
      if (user && FB.isCloudOn()) { try { await CLOUD.pushCover(user.uid, book.id, await makeThumbDataUrl(f, 420)) } catch {} }
      showToast('Portada actualizada')
    } catch (e) { showToast('No se pudo cambiar la portada: ' + e.message) }
    finally { setBusy(false); setStatus('') }
  }

  // --- Progreso / marcadores ---
  async function saveProgress(bookId, prog) {
    const b = await DB.getBook(bookId); if (!b) return
    b.progress = { ...prog, updatedAt: Date.now() }
    await DB.putBook(b)
    setLocalBooks((prev) => prev.map((x) => (x.id === bookId ? b : x)))
    if (user && FB.isCloudOn()) { try { await CLOUD.pushProgress(user.uid, b) } catch {} }
  }
  async function addBookmark(bookId, bm) {
    const b = await DB.getBook(bookId); if (!b) return
    b.bookmarks = [...(b.bookmarks || []).filter((x) => x.id !== bm.id), bm]
    await DB.putBook(b)
    if (current?.book.id === bookId) setCurrent((c) => ({ ...c, book: b }))
    showToast('Marcador guardado')
    if (user && FB.isCloudOn()) { try { await CLOUD.pushBookmarks(user.uid, b) } catch {} }
  }
  async function removeBookmark(bookId, id) {
    const b = await DB.getBook(bookId); if (!b) return
    b.bookmarks = (b.bookmarks || []).filter((x) => x.id !== id)
    await DB.putBook(b)
    if (current?.book.id === bookId) setCurrent((c) => ({ ...c, book: b }))
    if (user && FB.isCloudOn()) { try { await CLOUD.pushBookmarks(user.uid, b) } catch {} }
  }

  // --- Subrayados y notas ---
  async function saveHighlight(bookId, hl) {
    const b = await DB.getBook(bookId); if (!b) return
    b.highlights = [...(b.highlights || []).filter((x) => x.id !== hl.id), hl]
    await DB.putBook(b)
    if (current?.book.id === bookId) setCurrent((c) => ({ ...c, book: b }))
    if (user && FB.isCloudOn()) { try { await CLOUD.pushHighlights(user.uid, b) } catch {} }
  }
  async function removeHighlight(bookId, id) {
    const b = await DB.getBook(bookId); if (!b) return
    b.highlights = (b.highlights || []).filter((x) => x.id !== id)
    await DB.putBook(b)
    if (current?.book.id === bookId) setCurrent((c) => ({ ...c, book: b }))
    if (user && FB.isCloudOn()) { try { await CLOUD.pushHighlights(user.uid, b) } catch {} }
  }

  // --- Señaladores (marca de lectura en una palabra) ---
  async function saveMarker(bookId, m) {
    const b = await DB.getBook(bookId); if (!b) return
    b.markers = [...(b.markers || []).filter((x) => x.id !== m.id), m]
    await DB.putBook(b)
    if (current?.book.id === bookId) setCurrent((c) => ({ ...c, book: b }))
    showToast('Señal colocada')
    if (user && FB.isCloudOn()) { try { await CLOUD.pushMarkers(user.uid, b) } catch {} }
  }
  async function removeMarker(bookId, id) {
    const b = await DB.getBook(bookId); if (!b) return
    b.markers = (b.markers || []).filter((x) => x.id !== id)
    await DB.putBook(b)
    if (current?.book.id === bookId) setCurrent((c) => ({ ...c, book: b }))
    if (user && FB.isCloudOn()) { try { await CLOUD.pushMarkers(user.uid, b) } catch {} }
  }

  // --- Respaldo JSON ---
  async function exportAll(includeEpubs) {
    setBackupModal(false); setBusy(true)
    try {
      setStatus('Generando respaldo…')
      const count = await downloadBackup(includeEpubs, (i, t) => setStatus(`Respaldando ${i}/${t}…`))
      showToast(`Respaldo listo (${count} libros)`)
    } catch (e) { showToast('Error: ' + e.message) }
    finally { setBusy(false); setStatus('') }
  }
  async function onPickBackup(ev) {
    const f = ev.target.files?.[0]; ev.target.value = ''
    if (!f) return
    setBusy(true)
    try {
      setStatus('Restaurando respaldo…')
      const r = await importBackupFile(f, (i, t) => setStatus(`Restaurando ${i}/${t}…`))
      await reload()
      showToast(`Restaurado: ${r.imported} nuevos, ${r.updated} actualizados`)
    } catch (e) { showToast('Error: ' + e.message) }
    finally { setBusy(false); setStatus('') }
  }

  async function doInstall() {
    setMenu(false)
    const e = installEvt.current
    if (!e) { showToast('Usa el menú del navegador → “Instalar app”'); return }
    e.prompt(); await e.userChoice; installEvt.current = null; setCanInstall(false)
  }

  // --- Lector ---
  if (current) {
    return (
      <Reader
        buffer={current.buffer}
        book={current.book}
        onSaveProgress={saveProgress}
        onAddBookmark={addBookmark}
        onRemoveBookmark={removeBookmark}
        onSaveHighlight={saveHighlight}
        onRemoveHighlight={removeHighlight}
        onSaveMarker={saveMarker}
        onRemoveMarker={removeMarker}
        onBack={() => { setCurrent(null); reload() }}
      />
    )
  }

  const synced = !!user && FB.isCloudOn()

  return (
    <div className="app" onClick={() => menu && setMenu(false)}>
      <div className="topbar">
        <div className="brand"><div className="mark">📖</div><h1>Mi Lector</h1></div>
        <div className="spacer" />
        {busy && <span className="status"><span className="spinner" /> {status}</span>}
        {!busy && synced && <span className="status" title={`Sincronizado · ${user.email}`}>☁️</span>}
        <div className="menuwrap" onClick={(e) => e.stopPropagation()}>
          <button className="icon" onClick={() => setMenu((m) => !m)} title="Menú" style={{ fontSize: 22 }}>⋯</button>
          {menu && (
            <div className="menu">
              {canInstall && <><button onClick={doInstall}>⬇️ Instalar app</button><div className="sep" /></>}
              {!synced
                ? <button onClick={enableSync}>☁️ Activar sincronización</button>
                : <button onClick={disableSync}>🔌 Desactivar sincronización</button>}
              <div className="sep" />
              <button onClick={() => { setMenu(false); setBackupModal(true) }}>💾 Exportar respaldo (JSON)</button>
              <button onClick={() => { setMenu(false); importInput.current?.click() }}>📥 Restaurar respaldo (JSON)</button>
            </div>
          )}
        </div>
      </div>

      <div className="content"><Library books={books} coverVer={coverVer} onOpen={openBook} onDelete={deleteBook} onChangeCover={changeCover} /></div>

      <button className="fab" onClick={() => fileInput.current?.click()}>＋ Agregar EPUB</button>

      <input ref={fileInput} type="file" accept=".epub,application/epub+zip" multiple style={hiddenInput} onChange={onPickEpubs} />
      <input ref={importInput} type="file" accept="application/json,.json" style={hiddenInput} onChange={onPickBackup} />
      <input ref={coverInput} type="file" accept="image/*" style={hiddenInput} onChange={onPickCover} />

      {backupModal && (
        <div className="modal-bg" onClick={() => setBackupModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Exportar respaldo</h3>
            <p>Guarda un archivo <b>.json</b> con tus libros, progreso y marcadores. Elige qué incluir:</p>
            <div className="opt">
              <button onClick={() => exportAll(true)}>📚 Todo (libros + progreso)</button>
              <button className="ghost" onClick={() => exportAll(false)}>⚡ Solo datos (progreso y marcadores)</button>
            </div>
            <button className="ghost close btn-full" onClick={() => setBackupModal(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {configModal && (
        <div className="modal-bg" onClick={() => setConfigModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Configurar Firebase</h3>
            <p>Pega aquí el bloque <b>firebaseConfig</b> que te da Firebase (Configuración del
              proyecto → Tus apps → SDK). Se guarda solo en este navegador.</p>
            <textarea className="ta" placeholder={'const firebaseConfig = {\n  apiKey: "...",\n  projectId: "...",\n  appId: "..."\n};'}
              value={cfgText} onChange={(e) => setCfgText(e.target.value)} />
            <div style={{ height: 12 }} />
            <button className="btn-full" onClick={saveConfig} disabled={!cfgText.trim()}>Guardar</button>
            <button className="ghost close btn-full" onClick={() => setConfigModal(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {authModal && (
        <div className="modal-bg" onClick={() => setAuthModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Entrar a la sincronización</h3>
            <p>Usa el mismo correo y contraseña en todos tus dispositivos para compartir tu
              biblioteca y tu última página leída.</p>
            <input type="email" placeholder="correo@ejemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <div style={{ height: 10 }} />
            <input type="password" placeholder="contraseña (mín. 6 caracteres)" value={pass} onChange={(e) => setPass(e.target.value)} />
            <div style={{ height: 14 }} />
            <button className="btn-full" onClick={() => doAuth(false)} disabled={busy}>Entrar</button>
            <button className="ghost btn-full" onClick={() => doAuth(true)} disabled={busy} style={{ marginTop: 8 }}>Crear cuenta nueva</button>
            <button className="ghost close btn-full" onClick={() => setAuthModal(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function traducirError(msg) {
  const m = String(msg)
  if (m.includes('auth/invalid-email')) return 'El correo no es válido'
  if (m.includes('auth/invalid-credential') || m.includes('wrong-password') || m.includes('user-not-found')) return 'Correo o contraseña incorrectos'
  if (m.includes('auth/email-already-in-use')) return 'Ese correo ya tiene cuenta; usa “Entrar”'
  if (m.includes('auth/weak-password')) return 'La contraseña debe tener al menos 6 caracteres'
  if (m.includes('auth/network-request-failed')) return 'Sin conexión a internet'
  if (m.includes('auth/unauthorized-domain') || m.includes('unauthorized-domain')) return 'Agrega este dominio en Firebase → Authentication → Dominios autorizados'
  if (m.includes('configuration-not-found') || m.includes('operation-not-allowed')) return 'Habilita Correo/contraseña en Firebase → Authentication'
  return 'Error: ' + m
}
