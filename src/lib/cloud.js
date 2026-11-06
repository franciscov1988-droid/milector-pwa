// Sincronización con Firebase usando SOLO Firestore (gratis, sin facturación):
// progreso, marcadores y metadatos (título/autor). Los archivos EPUB se manejan
// localmente / por respaldo JSON, no se suben a la nube.

import * as DB from './db.js'
import * as FB from './firebase.js'
import { makeThumbDataUrl, dataUrlToBlob } from './coverUtil.js'

// Registra/actualiza un libro en la nube (sus datos + miniatura de portada, no el archivo).
export async function uploadBook(uid, book) {
  const data = {
    title: book.title || 'Libro',
    author: book.author || '',
    progress: book.progress || null,
    bookmarks: book.bookmarks || [],
    highlights: book.highlights || [],
    markers: book.markers || [],
    updatedAt: Date.now()
  }
  try {
    const cv = await DB.getCover(book.id)
    if (cv) data.coverThumb = await makeThumbDataUrl(cv)
  } catch {}
  await FB.cloudSetBookMeta(uid, book.id, data)
}

// Sube/actualiza solo la miniatura de portada.
export async function pushCover(uid, bookId, dataUrl) {
  await FB.cloudSetBookMeta(uid, bookId, { coverThumb: dataUrl, updatedAt: Date.now() })
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

// Devuelve el progreso "más avanzado" entre dos (gana mayor % y, si empatan, el más reciente).
export function bestProgress(a, b) {
  if (!a) return b || null
  if (!b) return a
  const pa = a.percent || 0, pb = b.percent || 0
  if (pb > pa) return b
  if (pb < pa) return a
  return (b.updatedAt || 0) >= (a.updatedAt || 0) ? b : a
}

// Aplica un libro remoto (de Firestore) sobre el local: progreso más avanzado gana,
// marcadores por unión. Solo afecta libros que ya existen en este dispositivo.
export async function applyRemoteBook(remote) {
  const local = await DB.getBook(remote.id)
  if (!local) return false
  let changed = false

  const rp = remote.progress, lp = local.progress
  const best = bestProgress(lp, rp)
  if (rp && best === rp && best !== lp) { local.progress = rp; changed = true }

  // Portada: si llegó una miniatura y aquí no hay portada, guardarla.
  if (remote.coverThumb) {
    try { const has = await DB.getCover(remote.id); if (!has) await DB.putCover(remote.id, await dataUrlToBlob(remote.coverThumb)) } catch {}
  }

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
