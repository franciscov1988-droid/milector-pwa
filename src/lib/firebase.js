// Inicialización de Firebase (solo Auth + Firestore; sin Storage, para no requerir
// facturación). La configuración (firebaseConfig) la pega el usuario una vez.

import { initializeApp } from 'firebase/app'
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut
} from 'firebase/auth'
import {
  getFirestore, doc, setDoc, getDoc, collection, onSnapshot
} from 'firebase/firestore'

const CFG_KEY = 'milector_firebase_config'
const ON_KEY = 'milector_cloud_on'

let app = null
let auth = null
let dbfs = null

// --- Configuración ---
export function getConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || null } catch { return null }
}
export function hasConfig() {
  const c = getConfig()
  return !!(c && c.apiKey && c.projectId && c.appId)
}
export function saveConfig(cfg) { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)) }
export function clearConfig() { localStorage.removeItem(CFG_KEY) }

export function isCloudOn() { return localStorage.getItem(ON_KEY) === '1' }
export function setCloudOn(on) { if (on) localStorage.setItem(ON_KEY, '1'); else localStorage.removeItem(ON_KEY) }

// Extrae el objeto firebaseConfig de lo que el usuario pega (snippet o JSON).
export function parseConfig(text) {
  const t = String(text || '')
  const pick = (k) => {
    const m = t.match(new RegExp(k + '\\s*:\\s*["\'`]([^"\'`]+)["\'`]'))
    return m ? m[1] : ''
  }
  const cfg = {
    apiKey: pick('apiKey'),
    authDomain: pick('authDomain'),
    projectId: pick('projectId'),
    messagingSenderId: pick('messagingSenderId'),
    appId: pick('appId')
  }
  if (!cfg.apiKey || !cfg.projectId || !cfg.appId) {
    throw new Error('No se reconoció la configuración. Pega el bloque firebaseConfig completo de Firebase.')
  }
  if (!cfg.authDomain) cfg.authDomain = `${cfg.projectId}.firebaseapp.com`
  return cfg
}

// --- Inicializar (idempotente) ---
export function initFirebase() {
  if (app) return true
  const cfg = getConfig()
  if (!cfg) return false
  app = initializeApp(cfg)
  auth = getAuth(app)
  dbfs = getFirestore(app)
  return true
}

// --- Auth ---
export function watchAuth(cb) {
  if (!initFirebase()) return () => {}
  return onAuthStateChanged(auth, cb)
}
export async function signUp(email, password) {
  initFirebase()
  const cred = await createUserWithEmailAndPassword(auth, email, password)
  return cred.user
}
export async function signInEmail(email, password) {
  initFirebase()
  const cred = await signInWithEmailAndPassword(auth, email, password)
  return cred.user
}
export async function logout() { if (auth) await signOut(auth) }
export function currentUser() { return auth?.currentUser || null }

// --- Firestore: un documento por libro, bajo users/{uid}/books/{bookId} ---
function bookDoc(uid, bookId) { return doc(dbfs, 'users', uid, 'books', bookId) }

export async function cloudGetBook(uid, bookId) {
  const snap = await getDoc(bookDoc(uid, bookId))
  return snap.exists() ? snap.data() : null
}
export async function cloudSetBookMeta(uid, bookId, data) {
  await setDoc(bookDoc(uid, bookId), data, { merge: true })
}
export function watchLibrary(uid, cb) {
  const col = collection(dbfs, 'users', uid, 'books')
  return onSnapshot(col, (snap) => {
    const items = []
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }))
    cb(items)
  }, () => { /* sin conexión: se ignora */ })
}
