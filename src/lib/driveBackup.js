// Respaldo/sincronización entre la biblioteca local (IndexedDB) y Google Drive.
import * as DB from './db.js'
import * as D from './drive.js'
import { importEpubBuffer } from './epubImport.js'

function safeName(title) {
  return (title || 'libro').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 120) + '.epub'
}

// Estado local -> JSON (formato compatible con la app Android)
export async function buildState() {
  const books = await DB.getAllBooks()
  const progress = [], bookmarks = []
  for (const b of books) {
    if (b.progress) {
      progress.push({
        bookId: b.id,
        chapterIndex: b.progress.chapterIndex || 0,
        progressInChapter: b.progress.progressInChapter || 0,
        percent: b.progress.percent || 0,
        updatedAt: b.progress.updatedAt || 0
      })
    }
    for (const bm of b.bookmarks || []) bookmarks.push({ ...bm, bookId: b.id })
  }
  return JSON.stringify({ version: 1, progress, bookmarks, highlights: [] })
}

// Fusiona el estado remoto en la biblioteca local. Devuelve cuántos progresos cambiaron.
export async function applyState(remoteText) {
  let remote
  try { remote = JSON.parse(remoteText) } catch { return 0 }
  let changed = 0

  for (const rp of remote.progress || []) {
    const b = await DB.getBook(rp.bookId)
    if (!b) continue
    const lp = b.progress
    if (!lp || (rp.updatedAt || 0) > (lp.updatedAt || 0)) {
      b.progress = {
        chapterIndex: rp.chapterIndex || 0,
        progressInChapter: rp.progressInChapter || 0,
        percent: rp.percent || 0,
        updatedAt: rp.updatedAt || Date.now()
      }
      await DB.putBook(b); changed++
    }
  }

  const byBook = new Map()
  for (const bm of remote.bookmarks || []) {
    if (!byBook.has(bm.bookId)) byBook.set(bm.bookId, [])
    byBook.get(bm.bookId).push(bm)
  }
  for (const [bookId, list] of byBook) {
    const b = await DB.getBook(bookId)
    if (!b) continue
    const ids = new Map((b.bookmarks || []).map((x) => [x.id, x]))
    for (const bm of list) ids.set(bm.id, bm)
    b.bookmarks = [...ids.values()]
    await DB.putBook(b)
  }
  return changed
}

// Solo TRAER el estado remoto y fusionarlo (rápido; se usa al abrir un libro).
export async function pullState(folderId) {
  const stateId = await D.findStateId(folderId)
  if (!stateId) return 0
  return applyState(await D.readState(stateId))
}

// Leer-fusionar-escribir (para no pisar lo de otro dispositivo).
export async function pushState(folderId) {
  const stateId = await D.findStateId(folderId)
  if (stateId) { try { await applyState(await D.readState(stateId)) } catch {} }
  await D.writeState(folderId, await buildState(), stateId)
}

export async function uploadMissingBooks(folderId, onProgress) {
  const books = await DB.getAllBooks()
  let i = 0, uploaded = 0
  for (const b of books) {
    onProgress?.(++i, books.length, b.title)
    const ab = await DB.getEpub(b.id)
    if (!ab) continue
    await D.uploadBook(folderId, safeName(b.title), ab); uploaded++
  }
  return uploaded
}

export async function uploadOneBook(folderId, book) {
  const ab = await DB.getEpub(book.id)
  if (ab) await D.uploadBook(folderId, safeName(book.title), ab)
}

export async function restoreFromDrive(folderId, onProgress) {
  const remote = await D.listEpubs(folderId)
  let i = 0, downloaded = 0
  for (const rf of remote) {
    onProgress?.(++i, remote.length, rf.name)
    try {
      const ab = await D.downloadFile(rf.id)
      const id = await DB.sha1Hex(ab)
      if (!(await DB.getBook(id))) { await importEpubBuffer(ab, rf.name); downloaded++ }
    } catch { /* seguir */ }
  }
  const stateId = await D.findStateId(folderId)
  if (stateId) { try { await applyState(await D.readState(stateId)) } catch {} }
  return downloaded
}

// Conectar por primera vez (interactivo): baja lo que falte y sube lo local.
export async function connectAndSync(onProgress) {
  await D.signIn(true)
  const folderId = await D.ensureFolder()
  const downloaded = await restoreFromDrive(folderId, (i, t, n) => onProgress?.('Descargando', i, t, n))
  const uploaded = await uploadMissingBooks(folderId, (i, t, n) => onProgress?.('Subiendo', i, t, n))
  await pushState(folderId)
  return { downloaded, uploaded }
}

// Sincronización en ambos sentidos (botón "Sincronizar ahora").
export async function syncNow(onProgress) {
  await D.signIn(true)
  const folderId = await D.ensureFolder()
  const changed = await pullState(folderId)                          // traer posiciones de otros equipos
  const uploaded = await uploadMissingBooks(folderId, (i, t, n) => onProgress?.('Subiendo', i, t, n))
  await pushState(folderId)                                          // enviar lo de este equipo
  return { changed, uploaded }
}
