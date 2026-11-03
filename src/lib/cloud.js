// Operaciones de sincronización con Firebase, sobre la biblioteca local (IndexedDB).
// Progreso y marcadores: Firestore (tiempo real). EPUB y portada: Storage.

import * as DB from './db.js'
import * as FB from './firebase.js'

// Sube un libro completo a la nube (archivo + portada + metadatos).
export async function uploadBook(uid, book) {
  const ab = await DB.getEpub(book.id)
  if (ab) { try { await FB.cloudUploadEpub(uid, book.id, ab) } catch { /* reintenta luego */ } }
  const cover = await DB.getCover(book.id)
  if (cover) { try { await FB.cloudUploadCover(uid, book.id, cover) } catch {} }
  await FB.cloudSetBookMeta(uid, book.id, {
    title: book.title || 'Libro',
    author: book.author || '',
    progress: book.progress || null,
    bookmarks: book.bookmarks || [],
    hasFile: !!ab,
    updatedAt: Date.now()
  })
}

// Guarda solo el progreso (rápido; se llama al leer).
export async function pushProgress(uid, book) {
  await FB.cloudSetBookMeta(uid, book.id, {
    title: book.title || 'Libro',
    author: book.author || '',
    progress: book.progress || null,
    updatedAt: Date.now()
  })
}

export async function pushBookmarks(uid, book) {
  await FB.cloudSetBookMeta(uid, book.id, { bookmarks: book.bookmarks || [], updatedAt: Date.now() })
}

// Aplica un libro remoto (de Firestore) sobre el local: progreso más reciente gana,
// marcadores por unión. Devuelve true si cambió el progreso local.
export async function applyRemoteBook(remote) {
  const local = await DB.getBook(remote.id)
  if (!local) return false // libro aún no está localmente; se maneja en la lista
  let changed = false

  const rp = remote.progress, lp = local.progress
  if (rp && (!lp || (rp.updatedAt || 0) > (lp.updatedAt || 0))) {
    local.progress = rp
    changed = true
  }
  const ids = new Map((local.bookmarks || []).map((b) => [b.id, b]))
  for (const bm of remote.bookmarks || []) ids.set(bm.id, bm)
  local.bookmarks = [...ids.values()]

  if (changed || (remote.bookmarks || []).length) await DB.putBook(local)
  return changed
}

// Descarga a este dispositivo un libro que está en la nube pero no local.
export async function downloadBook(uid, remote) {
  const ab = await FB.cloudDownloadEpub(uid, remote.id)
  await DB.putEpub(remote.id, ab)
  const cover = await FB.cloudDownloadCover(uid, remote.id)
  if (cover) await DB.putCover(remote.id, cover)
  await DB.putBook({
    id: remote.id,
    title: remote.title || 'Libro',
    author: remote.author || '',
    addedAt: Date.now(),
    lastOpenedAt: 0,
    progress: remote.progress || null,
    bookmarks: remote.bookmarks || []
  })
  return DB.getBook(remote.id)
}

// Al iniciar sesión: sube los libros locales que no estén en la nube.
export async function uploadMissing(uid, remoteIds, onProgress) {
  const locals = await DB.getAllBooks()
  let i = 0, uploaded = 0
  for (const b of locals) {
    onProgress?.(++i, locals.length, b.title)
    if (!remoteIds.has(b.id)) { await uploadBook(uid, b); uploaded++ }
  }
  return uploaded
}
