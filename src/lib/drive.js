// Respaldo opcional en Google Drive (la lectura sigue siendo offline).
// Usa Google Identity Services (GIS) en el navegador y el scope drive.file
// (no requiere verificación de Google).

const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const FOLDER_NAME = 'Mi Lector'
const STATE_FILE = 'milector_sync.json'
const EPUB_MIME = 'application/epub+zip'

let accessToken = null

export function getClientId() {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID || localStorage.getItem('milector_client_id') || ''
}
export function setClientId(id) { localStorage.setItem('milector_client_id', (id || '').trim()) }

export function isEnabled() { return localStorage.getItem('milector_drive_on') === '1' }
export function setEnabled(on) {
  if (on) localStorage.setItem('milector_drive_on', '1')
  else { localStorage.removeItem('milector_drive_on'); accessToken = null }
}

function waitForGis() {
  return new Promise((resolve, reject) => {
    let n = 0
    const t = setInterval(() => {
      if (window.google?.accounts?.oauth2) { clearInterval(t); resolve() }
      else if (++n > 100) { clearInterval(t); reject(new Error('No se pudo cargar Google (¿sin conexión?)')) }
    }, 100)
  })
}

export async function signIn() {
  await waitForGis()
  const clientId = getClientId()
  if (!clientId) throw new Error('Falta el Client ID de Google')
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) reject(new Error(resp.error))
        else { accessToken = resp.access_token; resolve(accessToken) }
      }
    })
    client.requestAccessToken({ prompt: '' })
  })
}

async function ensureToken() { return accessToken || signIn() }

async function api(url, opts = {}, retry = true) {
  const token = await ensureToken()
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } })
  if (res.status === 401 && retry) { accessToken = null; await signIn(); return api(url, opts, false) }
  if (!res.ok) throw new Error(`Drive ${res.status}: ${await res.text()}`)
  return res
}

// ---- Carpeta ----
export async function ensureFolder() {
  const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false`)
  const found = await (await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`)).json()
  if (found.files?.[0]) return found.files[0].id
  const meta = { name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }
  const created = await (await api('https://www.googleapis.com/drive/v3/files', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta)
  })).json()
  return created.id
}

export async function listEpubs(folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false and (mimeType='${EPUB_MIME}' or name contains '.epub')`)
  const r = await (await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,size)&spaces=drive`)).json()
  return r.files || []
}

export async function uploadBook(folderId, displayName, arrayBuffer) {
  // No duplicar: si ya existe uno con ese nombre, no subir
  const q = encodeURIComponent(`'${folderId}' in parents and name='${displayName.replace(/'/g, '')}' and trashed=false`)
  const ex = await (await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`)).json()
  if (ex.files?.[0]) return ex.files[0].id

  const boundary = 'ml' + Date.now()
  const meta = { name: displayName, parents: [folderId] }
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${EPUB_MIME}\r\n\r\n`
  const tail = `\r\n--${boundary}--`
  const body = new Blob([head, arrayBuffer, tail])
  const r = await (await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
  })).json()
  return r.id
}

export async function downloadFile(fileId) {
  return (await api(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`)).arrayBuffer()
}

// ---- Estado (progreso/marcadores) ----
export async function findStateId(folderId) {
  const q = encodeURIComponent(`name='${STATE_FILE}' and '${folderId}' in parents and trashed=false`)
  const r = await (await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`)).json()
  return r.files?.[0]?.id || null
}
export async function readState(id) {
  return (await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).text()
}
export async function writeState(folderId, content, existingId) {
  if (existingId) {
    await api(`https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: content
    })
    return existingId
  }
  const boundary = 'ml' + Date.now()
  const meta = { name: STATE_FILE, parents: [folderId] }
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`
  const r = await (await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
  })).json()
  return r.id
}
