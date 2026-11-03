import { useEffect, useRef, useState } from 'react'
import * as DB from './lib/db.js'
import * as D from './lib/drive.js'
import * as DBK from './lib/driveBackup.js'
import { importEpubFile } from './lib/epubImport.js'
import { downloadBackup, importBackupFile } from './lib/backup.js'
import Library from './components/Library.jsx'
import Reader from './components/Reader.jsx'

const hiddenInput = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', border: 0, opacity: 0 }

function orderBooks(list) {
  return [...list].sort((a, b) => {
    const ta = Math.max(a.lastOpenedAt || 0, a.progress?.updatedAt || 0)
    const tb = Math.max(b.lastOpenedAt || 0, b.progress?.updatedAt || 0)
    if (tb !== ta) return tb - ta
    return (a.title || '').localeCompare(b.title || '')
  })
}

export default function App() {
  const [books, setBooks] = useState([])
  const [current, setCurrent] = useState(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [toast, setToast] = useState('')
  const [menu, setMenu] = useState(false)
  const [backupModal, setBackupModal] = useState(false)
  const [driveOn, setDriveOn] = useState(D.isEnabled())
  const [clientModal, setClientModal] = useState(false)
  const [clientId, setClientIdInput] = useState(D.getClientId())

  const fileInput = useRef(null)
  const importInput = useRef(null)
  const installEvt = useRef(null)
  const driveFolder = useRef(null)
  const drivePushTimer = useRef(null)
  const [canInstall, setCanInstall] = useState(false)

  async function reload() { setBooks(orderBooks(await DB.getAllBooks())) }
  useEffect(() => { reload() }, [])

  // Arranque: retoma la sesión de Drive en silencio y trae las posiciones recientes.
  useEffect(() => {
    if (!D.isEnabled()) return
    let alive = true
    ;(async () => {
      try {
        await D.signIn(false) // silencioso: si no hay sesión, falla sin molestar
        const folderId = await getFolder()
        await DBK.pullState(folderId)
        if (alive) await reload()
      } catch { /* sin conexión o sin sesión: seguimos offline */ }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onBip = (e) => { e.preventDefault(); installEvt.current = e; setCanInstall(true) }
    window.addEventListener('beforeinstallprompt', onBip)
    return () => window.removeEventListener('beforeinstallprompt', onBip)
  }, [])

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 2800) }

  // ---- Drive ----
  async function getFolder() {
    if (!driveFolder.current) driveFolder.current = await D.ensureFolder()
    return driveFolder.current
  }
  function scheduleDrivePush() {
    if (!D.isEnabled()) return
    if (drivePushTimer.current) clearTimeout(drivePushTimer.current)
    drivePushTimer.current = setTimeout(() => flushDrivePush(), 3500)
  }
  async function flushDrivePush() {
    if (!D.isEnabled()) return
    if (drivePushTimer.current) { clearTimeout(drivePushTimer.current); drivePushTimer.current = null }
    try { await DBK.pushState(await getFolder()) } catch { /* reintenta luego */ }
  }

  function connectDrive() { setMenu(false); setClientIdInput(D.getClientId()); setClientModal(true) }
  async function doConnect() {
    setBusy(true); setStatus('Conectando con Drive…')
    try {
      const r = await DBK.connectAndSync((fase, i, t) => setStatus(`${fase} ${i}/${t}…`))
      D.setEnabled(true); setDriveOn(true)
      await reload()
      showToast(`Drive conectado · ${r.downloaded} bajados, ${r.uploaded} respaldados`)
    } catch (e) { showToast('Error: ' + e.message) }
    finally { setBusy(false); setStatus('') }
  }
  function saveClientId() { D.setClientId(clientId); setClientModal(false); if (clientId.trim()) doConnect() }

  async function syncNow() {
    setMenu(false); setBusy(true); setStatus('Sincronizando…')
    try {
      const r = await DBK.syncNow((fase, i, t) => setStatus(`${fase} ${i}/${t}…`))
      await reload()
      showToast(r.changed > 0 ? `Sincronizado · ${r.changed} libro(s) actualizado(s)` : 'Sincronizado · todo al día')
    } catch (e) { showToast('Error: ' + e.message) }
    finally { setBusy(false); setStatus('') }
  }
  async function downloadFromDrive() {
    setMenu(false); setBusy(true); setStatus('Descargando de Drive…')
    try {
      const folderId = await getFolder()
      const n = await DBK.restoreFromDrive(folderId, (i, t) => setStatus(`Descargando ${i}/${t}…`))
      await reload()
      showToast(`Descargados de Drive: ${n} libros`)
    } catch (e) { showToast('Error: ' + e.message) }
    finally { setBusy(false); setStatus('') }
  }
  function disconnectDrive() { setMenu(false); D.setEnabled(false); setDriveOn(false); driveFolder.current = null; showToast('Drive desconectado (la lectura sigue funcionando)') }

  // ---- Importar ----
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
      if (D.isEnabled()) {
        try {
          const folderId = await getFolder()
          for (const bk of added) if (bk) await DBK.uploadOneBook(folderId, bk)
          scheduleDrivePush()
        } catch { /* se reintenta al sincronizar */ }
      }
    } catch (e) { showToast('Error al importar: ' + e.message) }
    finally { setBusy(false); setStatus('') }
  }

  // ---- Abrir libro (Whispersync: trae la última página de Drive) ----
  async function openBook(book) {
    setBusy(true); setStatus('Abriendo…')
    try {
      if (D.isEnabled()) {
        try {
          setStatus('Buscando tu última página…')
          await D.signIn(true)                 // asegura sesión (puede pedir confirmación una vez)
          await DBK.pullState(await getFolder())
        } catch { /* sin conexión: usamos lo local */ }
      }
      const fresh = (await DB.getBook(book.id)) || book
      const ab = await DB.getEpub(book.id)
      if (!ab) { showToast('No se encontró el archivo del libro'); return }
      const updated = { ...fresh, lastOpenedAt: Date.now() }
      await DB.putBook(updated)
      setCurrent({ buffer: ab.slice(0), book: updated })
      reload()
    } catch (e) { showToast('Error: ' + e.message) }
    finally { setBusy(false); setStatus('') }
  }

  async function deleteBook(book) {
    if (!window.confirm(`¿Eliminar “${book.title}”? Se borra el libro y tu progreso en este dispositivo.`)) return
    await DB.deleteBookAll(book.id); await reload(); showToast('Libro eliminado')
  }

  // ---- Progreso / marcadores ----
  async function saveProgress(bookId, prog) {
    const b = await DB.getBook(bookId); if (!b) return
    b.progress = { ...prog, updatedAt: Date.now() }
    await DB.putBook(b)
    setBooks((prev) => orderBooks(prev.map((x) => (x.id === bookId ? b : x))))
    scheduleDrivePush()
  }
  async function addBookmark(bookId, bm) {
    const b = await DB.getBook(bookId); if (!b) return
    b.bookmarks = [...(b.bookmarks || []).filter((x) => x.id !== bm.id), bm]
    await DB.putBook(b)
    if (current?.book.id === bookId) setCurrent((c) => ({ ...c, book: b }))
    showToast('Marcador guardado'); scheduleDrivePush()
  }
  async function removeBookmark(bookId, id) {
    const b = await DB.getBook(bookId); if (!b) return
    b.bookmarks = (b.bookmarks || []).filter((x) => x.id !== id)
    await DB.putBook(b)
    if (current?.book.id === bookId) setCurrent((c) => ({ ...c, book: b }))
    scheduleDrivePush()
  }

  // ---- Respaldo JSON ----
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

  // ---- Lector ----
  if (current) {
    return (
      <Reader
        buffer={current.buffer}
        book={current.book}
        onSaveProgress={saveProgress}
        onAddBookmark={addBookmark}
        onRemoveBookmark={removeBookmark}
        onBack={() => { setCurrent(null); reload(); flushDrivePush() }}
      />
    )
  }

  return (
    <div className="app" onClick={() => menu && setMenu(false)}>
      <div className="topbar">
        <div className="brand"><div className="mark">📖</div><h1>Mi Lector</h1></div>
        <div className="spacer" />
        {busy && <span className="status"><span className="spinner" /> {status}</span>}
        {!busy && driveOn && <span className="status" title="Sincronización con Drive activa">☁️</span>}
        <div className="menuwrap" onClick={(e) => e.stopPropagation()}>
          <button className="icon" onClick={() => setMenu((m) => !m)} title="Menú" style={{ fontSize: 22 }}>⋯</button>
          {menu && (
            <div className="menu">
              {canInstall && <><button onClick={doInstall}>⬇️ Instalar app</button><div className="sep" /></>}
              {!driveOn
                ? <button onClick={connectDrive}>☁️ Conectar Google Drive</button>
                : <>
                    <button onClick={syncNow}>🔄 Sincronizar ahora</button>
                    <button onClick={downloadFromDrive}>⬇️ Descargar libros de Drive</button>
                    <button onClick={disconnectDrive}>🔌 Desconectar Drive</button>
                  </>}
              <div className="sep" />
              <button onClick={() => { setMenu(false); setBackupModal(true) }}>💾 Exportar respaldo (JSON)</button>
              <button onClick={() => { setMenu(false); importInput.current?.click() }}>📥 Restaurar respaldo (JSON)</button>
            </div>
          )}
        </div>
      </div>

      <div className="content"><Library books={books} onOpen={openBook} onDelete={deleteBook} /></div>

      <button className="fab" onClick={() => fileInput.current?.click()}>＋ Agregar EPUB</button>

      <input ref={fileInput} type="file" accept=".epub,application/epub+zip" multiple style={hiddenInput} onChange={onPickEpubs} />
      <input ref={importInput} type="file" accept="application/json,.json" style={hiddenInput} onChange={onPickBackup} />

      {backupModal && (
        <div className="modal-bg" onClick={() => setBackupModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Exportar respaldo</h3>
            <p>Guarda un archivo <b>.json</b> que puedes llevar a otro dispositivo y restaurar desde el menú. Elige qué incluir:</p>
            <div className="opt">
              <button onClick={() => exportAll(true)}>📚 Todo (libros + progreso + datos)</button>
              <button className="ghost" onClick={() => exportAll(false)}>⚡ Solo datos (progreso y marcadores)</button>
            </div>
            <button className="ghost close btn-full" onClick={() => setBackupModal(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {clientModal && (
        <div className="modal-bg" onClick={() => setClientModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Conectar Google Drive</h3>
            <p>Pega tu <b>Client ID de OAuth (tipo Aplicación web)</b>. No uses el de Android.
              Tus libros se sincronizarán con la carpeta “Mi Lector” de tu Drive.</p>
            <input placeholder="xxxx.apps.googleusercontent.com" value={clientId} onChange={(e) => setClientIdInput(e.target.value)} />
            <div style={{ height: 12 }} />
            <button className="btn-full" onClick={saveClientId} disabled={!clientId}>Guardar y conectar</button>
            <button className="ghost close btn-full" onClick={() => setClientModal(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
