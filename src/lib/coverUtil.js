// Utilidades de portada: generar una miniatura liviana (JPEG) para mostrar y
// para sincronizar por Firestore (cabe en el documento del libro).

export async function makeThumbDataUrl(blobOrFile, maxW = 420) {
  const url = URL.createObjectURL(blobOrFile)
  try {
    const img = new Image()
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url })
    const iw = img.naturalWidth || img.width || maxW
    const ih = img.naturalHeight || img.height || maxW
    const scale = Math.min(1, maxW / iw)
    const w = Math.max(1, Math.round(iw * scale))
    const h = Math.max(1, Math.round(ih * scale))
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    c.getContext('2d').drawImage(img, 0, 0, w, h)
    return c.toDataURL('image/jpeg', 0.72)
  } finally { URL.revokeObjectURL(url) }
}

export async function dataUrlToBlob(dataUrl) {
  return (await fetch(dataUrl)).blob()
}
