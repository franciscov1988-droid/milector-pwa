import { useEffect, useState } from 'react'
import * as DB from '../lib/db.js'
import { coverGradient, cleanTitle } from '../lib/cover.js'

// Muestra la portada real del EPUB si existe; si no, un degradado con el título.
export default function BookCover({ book, badge }) {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    let revoked = null
    let alive = true
    DB.getCover(book.id).then((blob) => {
      if (alive && blob) {
        const u = URL.createObjectURL(blob)
        revoked = u
        setUrl(u)
      }
    })
    return () => { alive = false; if (revoked) URL.revokeObjectURL(revoked) }
  }, [book.id])

  return (
    <div className="cover" style={!url ? { background: coverGradient(book.id || book.title) } : undefined}>
      {url ? (
        <img src={url} alt={cleanTitle(book.title)} loading="lazy" />
      ) : (
        <>
          <div className="spine" />
          <div className="ct">
            <div className="t">{cleanTitle(book.title)}</div>
            <div className="glyph">📖</div>
          </div>
        </>
      )}
      {badge != null && badge > 0 && <div className="badge">{Math.round(badge)}%</div>}
    </div>
  )
}
