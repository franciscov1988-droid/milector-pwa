// Sincronización con Google Drive (scope drive.file, sin verificación de Google).

const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const FOLDER_NAME = 'Mi Lector'
const STATE_FILE = 'milector_sync.json'
const EPUB_MIME = 'application/epub+zip'

let accessToken = null
let tokenExpiry = 0

export function getClientId() {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID || localStorage.getItem('milector_client_id') || ''
}
export function setClientId(id) { localStorage.setItem('milector_client_id', (id || '').trim()) }
export function isEnabled() { return localStorage.getItem('milector_drive_on') === '1' }
export function setEnabled(on) {
  if (on) localStorage.setItem('milector_drive_on', '1')
  else { localStorage.removeItem('milector_drive_on'); accessToken = null; tokenExpiry = 0 }
}
export function hasToken() { return !!accessToken && Date.now() < tokenExpiry }

function waitForGis() {
  return new Promise((resolve, reject) => {
    let n = 0
    const t = setInterval(() => {
      if (window.google?.accounts?.oauth2) { clearInterval(t); resolve() }
      else if (++n > 100) { clearInterval(t); reject(new Error('No se pudo cargar Google (¿sin conexión?)')) }
    }, 100)
  })
}

// interactive=false → intento silencioso (prompt:'none'); si no hay sesión, falla sin UI.
// interactive=true  → muestra lo necesario (consentimiento/selección de cuenta).
export async function signIn(interactive = true) {
  if (hasToken()) return accessToken
  await waitForGis()
  const clientId = getClientId()
  if (!clientId) throw new Error('Falta el Client ID de Google')
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) reject(new Error(resp.error))
        else {
          accessToken = resp.access_token
          tokenExpiry = Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000
          resolve(accessToken)
        }
      },
      error_callback: (err) => reject(new Error(err?.type || 'auth_error'))
    })
    client.requestAccessToken({ prompt: interactive ? '' : 'none' })
  })
}

async function ensureToken() { return hasToken() ? accessToken : signIn(true) }

async function apiFetch(url, opts = {}, retry = true) {
  const token = await ensureToken()
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } })
  if (res.status === 401 && retry) { accessToken = null; tokenExpiry = 0; await signIn(true); return apiFetch(url, opts, false) }
  if (!res.ok) throw new Error(`Drive ${res.status}: ${await res.text()}`)
  return res
}

export async function ensureFolder() {
  const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false`)
  const found = await (await apiFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`)).json()
  if (found.files?.[0]) return found.files[0].id
  const created = await (await apiFetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
  })).json()
  return created.id
}

export async function listEpubs(folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false and (mimeType='${EPUB_MIME}' or name contains '.epub')`)
  const r = await (await apiFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,size)&spaces=drive`)).json()
  return r.files || []
}

export async function uploadBook(folderId, displayName, arrayBuffer) {
  const q = encodeURIComponent(`'${folderId}' in parents and name='${displayName.replace(/'/g, '')}' and trashed=false`)
  const ex = await (await apiFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`)).json()
  if (ex.files?.[0]) return ex.files[0].id
  const boundary = 'ml' + Date.now()
  const meta = { name: displayName, parents: [folderId] }
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${EPUB_MIME}\r\n\r\n`
  const body = new Blob([head, arrayBuffer, `\r\n--${boundary}--`])
  const r = await (await apiFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
  })).json()
  return r.id
}

export async function downloadFile(fileId) { return (await apiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`)).arrayBuffer() }

export async function findStateId(folderId) {
  const q = encodeURIComponent(`name='${STATE_FILE}' and '${folderId}' in parents and trashed=false`)
  const r = await (await apiFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`)).json()
  return r.files?.[0]?.id || null
}
export async function readState(id) { return (await apiFetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).text() }
export async function writeState(folderId, content, existingId) {
  if (existingId) {
    await apiFetch(`https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: content
    })
    return existingId
  }
  const boundary = 'ml' + Date.now()
  const meta = { name: STATE_FILE, parents: [folderId] }
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`
  const r = await (await apiFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
  })).json()
  return r.id
}
