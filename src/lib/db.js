// Almacenamiento local (offline) en IndexedDB.
//   books: metadatos + progreso + marcadores  (key = id)
//   epub:  ArrayBuffer del .epub                (key = id)
//   cover: Blob de la portada                   (key = id)

const DB = 'milector-pwa'
const VERSION = 1

let dbPromise = null
function getDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION)
      req.onupgradeneeded = () => {
        const d = req.result
        if (!d.objectStoreNames.contains('books')) d.createObjectStore('books', { keyPath: 'id' })
        if (!d.objectStoreNames.contains('epub')) d.createObjectStore('epub')
        if (!d.objectStoreNames.contains('cover')) d.createObjectStore('cover')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

async function run(store, mode, fn) {
  const d = await getDB()
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode)
    const req = fn(t.objectStore(store))
    let out
    if (req) req.onsuccess = () => { out = req.result }
    t.oncomplete = () => resolve(out)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

export async function getAllBooks() { return (await run('books', 'readonly', (s) => s.getAll())) || [] }
export async function getBook(id) { return run('books', 'readonly', (s) => s.get(id)) }
export async function putBook(book) { return run('books', 'readwrite', (s) => s.put(book)) }
export async function deleteBookAll(id) {
  await run('books', 'readwrite', (s) => s.delete(id))
  await run('epub', 'readwrite', (s) => s.delete(id))
  await run('cover', 'readwrite', (s) => s.delete(id))
}
export async function getEpub(id) { return run('epub', 'readonly', (s) => s.get(id)) }
export async function putEpub(id, arrayBuffer) { return run('epub', 'readwrite', (s) => s.put(arrayBuffer, id)) }
export async function getCover(id) { return run('cover', 'readonly', (s) => s.get(id)) }
export async function putCover(id, blob) { return run('cover', 'readwrite', (s) => s.put(blob, id)) }

export async function sha1Hex(arrayBuffer) {
  const hash = await crypto.subtle.digest('SHA-1', arrayBuffer)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
