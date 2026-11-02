function hash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

const PALETTE = [
  ['#5b21b6', '#2563eb'], ['#0f766e', '#22c55e'], ['#9d174d', '#f43f5e'],
  ['#b45309', '#f59e0b'], ['#1e3a8a', '#6366f1'], ['#065f46', '#10b981'],
  ['#7c2d12', '#ea580c'], ['#4c1d95', '#8b5cf6'], ['#155e75', '#06b6d4'],
  ['#831843', '#db2777']
]

export function coverGradient(key) {
  const [a, b] = PALETTE[hash(key || 'x') % PALETTE.length]
  return `linear-gradient(145deg, ${a}, ${b})`
}

export function cleanTitle(name) {
  return (name || '').replace(/\.epub$/i, '').replace(/_/g, ' ').trim()
}
