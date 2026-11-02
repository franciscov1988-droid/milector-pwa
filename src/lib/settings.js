// Ajustes de lectura (en localStorage).
const KEY = 'milector_reader_settings'

export const DEFAULTS = {
  theme: 'sepia',
  fontSize: 105,
  fontFamily: 'original',
  lineHeight: 1.6,
  textAlign: 'justify',
  margin: 40
}

export function loadSettings() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) } } catch { return { ...DEFAULTS } }
}
export function saveSettings(s) {
  localStorage.setItem(KEY, JSON.stringify(s))
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
