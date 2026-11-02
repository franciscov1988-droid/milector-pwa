import ePub from 'epubjs'
import * as DB from './db.js'

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
  ])
}

// Importa un EPUB (ArrayBuffer): guarda el archivo y el registro de inmediato,
// y luego intenta enriquecer título/autor/portada (con límite de tiempo para no
// quedarse colgado en EPUB problemáticos). Devuelve el registro del libro.
export async function importEpubBuffer(arrayBuffer, fallbackName = 'Libro') {
  const id = await DB.sha1Hex(arrayBuffer)
  if (!(await DB.getEpub(id))) await DB.putEpub(id, arrayBuffer.slice(0))

  let record = await DB.getBook(id)
  if (!record) {
    record = {
      id,
      title: fallbackName.replace(/\.epub$/i, '').replace(/_/g, ' '),
      author: '',
      addedAt: Date.now(),
      lastOpenedAt: 0,
      progress: null,
      bookmarks: []
    }
    await DB.putBook(record) // aparece de inmediato en la biblioteca
  }

  // Enriquecer metadatos + portada (sin bloquear la importación)
  try {
    const book = ePub(arrayBuffer.slice(0), { openAs: 'binary' })
    await withTimeout(book.ready, 8000)

    const meta = await withTimeout(book.loaded.metadata, 5000).catch(() => null)
    let changed = false
    if (meta?.title && (!record.title || /^Libro$/i.test(record.title))) { record.title = meta.title; changed = true }
    else if (meta?.title && !(await DB.getBook(id))?.author) { record.title = meta.title; changed = true }
    if (meta?.creator && !record.author) { record.author = meta.creator; changed = true }

    if (!(await DB.getCover(id))) {
      try {
        const url = await withTimeout(book.coverUrl(), 5000)
        if (url) {
          const blob = await (await fetch(url)).blob()
          if (blob && blob.size > 0) await DB.putCover(id, blob)
        }
      } catch { /* sin portada */ }
    }

    if (changed) { await DB.putBook(record) }
    try { book.destroy() } catch {}
  } catch { /* nos quedamos con el nombre del archivo */ }

  return DB.getBook(id)
}

export async function importEpubFile(file) {
  const buf = await file.arrayBuffer()
  return importEpubBuffer(buf, file.name)
}
