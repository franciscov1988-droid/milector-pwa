// Respaldo completo en JSON: libros (EPUB + portada en base64), progreso,
// marcadores y ajustes. Para trasladar todo a otro dispositivo sin cuentas.

import * as DB from './db.js'
import { loadSettings, saveSettings } from './settings.js'

function abToBase64(ab) {
  const bytes = new Uint8Array(ab)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  return btoa(binary)
}
function base64ToAb(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}
async function blobToBase64(blob) { return { data: abToBase64(await blob.arrayBuffer()), type: blob.type || 'image/jpeg' } }

export async function exportBackup(includeEpubs = true, onProgress) {
  const books = await DB.getAllBooks()
  const out = { app: 'Mi Lector', version: 1, exportedAt: Date.now(), includeEpubs, settings: loadSettings(), books: [] }
  let i = 0
  for (const b of books) {
    onProgress?.(++i, books.length, b.title)
    const entry = {
      id: b.id, title: b.title, author: b.author, addedAt: b.addedAt,
      lastOpenedAt: b.lastOpenedAt || 0, progress: b.progress || null, bookmarks: b.bookmarks || []
    }
    const cover = await DB.getCover(b.id)
    if (cover) entry.cover = await blobToBase64(cover)
    if (includeEpubs) { const ab = await DB.getEpub(b.id); if (ab) entry.epub = abToBase64(ab) }
    out.books.push(entry)
  }
  return out
}

export async function downloadBackup(includeEpubs = true, onProgress) {
  const data = await exportBackup(includeEpubs, onProgress)
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `mi-lector-respaldo-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return data.books.length
}

export async function importBackup(json, onProgress) {
  let data
  try { data = typeof json === 'string' ? JSON.parse(json) : json } catch { throw new Error('Archivo de respaldo inválido') }
  if (!data || !Array.isArray(data.books)) throw new Error('El archivo no es un respaldo de Mi Lector')

  let imported = 0, updated = 0, i = 0
  for (const e of data.books) {
    onProgress?.(++i, data.books.length, e.title)
    const existing = await DB.getBook(e.id)
    if (e.epub && !(await DB.getEpub(e.id))) await DB.putEpub(e.id, base64ToAb(e.epub))
    if (e.cover && !(await DB.getCover(e.id))) await DB.putCover(e.id, new Blob([base64ToAb(e.cover.data)], { type: e.cover.type || 'image/jpeg' }))
    if (existing) {
      const ep = e.progress, lp = existing.progress
      if (ep && (!lp || (ep.updatedAt || 0) > (lp.updatedAt || 0))) existing.progress = ep
      const byId = new Map((existing.bookmarks || []).map((b) => [b.id, b]))
      for (const bm of e.bookmarks || []) byId.set(bm.id, bm)
      existing.bookmarks = [...byId.values()]
      await DB.putBook(existing); updated++
    } else {
      await DB.putBook({
        id: e.id, title: e.title || 'Libro', author: e.author || '', addedAt: e.addedAt || Date.now(),
        lastOpenedAt: e.lastOpenedAt || 0, progress: e.progress || null, bookmarks: e.bookmarks || []
      })
      imported++
    }
  }
  if (data.settings) saveSettings(data.settings)
  return { imported, updated }
}

export async function importBackupFile(file, onProgress) { return importBackup(await file.text(), onProgress) }
