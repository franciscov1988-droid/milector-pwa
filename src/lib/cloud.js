// Sincronización con Firebase usando SOLO Firestore (gratis, sin facturación):
// progreso, marcadores y metadatos (título/autor). Los archivos EPUB se manejan
// localmente / por respaldo JSON, no se suben a la nube.

import * as DB from './db.js'
import * as FB from './firebase.js'

// Registra/actualiza un libro en la nube (sus datos, no el archivo).
export async function uploadBook(uid, book) {
  await FB.cloudSetBookMeta(uid, book.id, {
    title: book.title || 'Libro',
    author: book.author || '',
    progress: book.progress || null,
    bookmarks: book.bookmarks || [],
    highlights: book.highlights || [],
    markers: book.markers || [],
    updatedAt: Date.now()
  })
}

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

export async function pushHighlights(uid, book) {
  await FB.cloudSetBookMeta(uid, book.id, { highlights: book.highlights || [], updatedAt: Date.now() })
}

export async function pushMarkers(uid, book) {
  await FB.cloudSetBookMeta(uid, book.id, { markers: book.markers || [], updatedAt: Date.now() })
}

// Aplica un libro remoto (de Firestore) sobre el local: progreso más reciente gana,
// marcadores por unión. Solo afecta libros que ya existen en este dispositivo.
export async function applyRemoteBook(remote) {
  const local = await DB.getBook(remote.id)
  if (!local) return false
  let changed = false

  const rp = remote.progress, lp = local.progress
  if (rp && (!lp || (rp.updatedAt || 0) > (lp.updatedAt || 0))) { local.progress = rp; changed = true }

  const ids = new Map((local.bookmarks || []).map((b) => [b.id, b]))
  for (const bm of remote.bookmarks || []) ids.set(bm.id, bm)
  local.bookmarks = [...ids.values()]

  // Subrayados y notas: unión por id; si ambos tienen el mismo id, gana el más reciente.
  const hid = new Map((local.highlights || []).map((h) => [h.id, h]))
  for (const rh of remote.highlights || []) {
    const ex = hid.get(rh.id)
    if (!ex || (rh.updatedAt || rh.createdAt || 0) >= (ex.updatedAt || ex.createdAt || 0)) hid.set(rh.id, rh)
  }
  local.highlights = [...hid.values()]

  // Señaladores: unión por id
  const mid = new Map((local.markers || []).map((m) => [m.id, m]))
  for (const rm of remote.markers || []) mid.set(rm.id, rm)
  local.markers = [...mid.values()]

  if (changed || (remote.bookmarks || []).length || (remote.highlights || []).length || (remote.markers || []).length) await DB.putBook(local)
  return changed
}

// Al iniciar sesión: registra en la nube los libros locales que falten.
export async function uploadMissing(uid, remoteIds, onProgress) {
  const locals = await DB.getAllBooks()
  let i = 0, uploaded = 0
  for (const b of locals) {
    onProgress?.(++i, locals.length, b.title)
    if (!remoteIds.has(b.id)) { await uploadBook(uid, b); uploaded++ }
  }
  return uploaded
}
