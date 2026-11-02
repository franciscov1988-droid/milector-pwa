// Operaciones de respaldo/restauración entre la biblioteca local (IndexedDB) y
// Google Drive. La lectura es offline; esto solo mantiene una copia en la nube.

import * as DB from './db.js'
import * as D from './drive.js'
import { importEpubBuffer } from './epubImport.js'

function safeName(title) {
  return (title || 'libro').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 120) + '.epub'
}

// Estado local -> JSON (formato compatible con la app Android)
export async function buildState() {
  const books = await DB.getAllBooks()
  const progress = []
  const bookmarks = []
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

// Fusiona el estado remoto en la biblioteca local
export async function applyState(remoteText) {
  let remote
  try { remote = JSON.parse(remoteText) } catch { return }

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
      await DB.putBook(b)
    }
  }

  // Marcadores: unión por id, agrupados por libro
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
}

// Lee-fusiona-escribe el estado (para no pisar lo de otro dispositivo)
export async function pushState(folderId) {
  const stateId = await D.findStateId(folderId)
  if (stateId) { try { await applyState(await D.readState(stateId)) } catch {} }
  await D.writeState(folderId, await buildState(), stateId)
}

// Sube a Drive los EPUB locales que falten
export async function uploadMissingBooks(folderId, onProgress) {
  const books = await DB.getAllBooks()
  let i = 0, uploaded = 0
  for (const b of books) {
    onProgress?.(++i, books.length, b.title)
    const ab = await DB.getEpub(b.id)
    if (!ab) continue
    const before = await D.uploadBook(folderId, safeName(b.title), ab)
    if (before) uploaded++
  }
  return uploaded
}

// Sube un solo libro (al importarlo con Drive activo)
export async function uploadOneBook(folderId, book) {
  const ab = await DB.getEpub(book.id)
  if (ab) await D.uploadBook(folderId, safeName(book.title), ab)
}

// Descarga de Drive los EPUB que no estén localmente y aplica el estado
export async function restoreFromDrive(folderId, onProgress) {
  const remote = await D.listEpubs(folderId)
  let i = 0, downloaded = 0
  for (const rf of remote) {
    onProgress?.(++i, remote.length, rf.name)
    try {
      const ab = await D.downloadFile(rf.id)
      const id = await DB.sha1Hex(ab)
      if (!(await DB.getBook(id))) { await importEpubBuffer(ab, rf.name); downloaded++ }
    } catch { /* seguir con el resto */ }
  }
  const stateId = await D.findStateId(folderId)
  if (stateId) { try { await applyState(await D.readState(stateId)) } catch {} }
  return downloaded
}

// Conectar por primera vez: trae lo que haya en Drive y sube lo local que falte
export async function connectAndSync(onProgress) {
  await D.signIn()
  const folderId = await D.ensureFolder()
  const downloaded = await restoreFromDrive(folderId, (i, t, n) => onProgress?.('Descargando', i, t, n))
  const uploaded = await uploadMissingBooks(folderId, (i, t, n) => onProgress?.('Subiendo', i, t, n))
  await pushState(folderId)
  return { downloaded, uploaded }
}

// Respaldo manual (ya conectado)
export async function backupNow(onProgress) {
  const folderId = await D.ensureFolder()
  const uploaded = await uploadMissingBooks(folderId, (i, t, n) => onProgress?.('Subiendo', i, t, n))
  await pushState(folderId)
  return { uploaded }
}
