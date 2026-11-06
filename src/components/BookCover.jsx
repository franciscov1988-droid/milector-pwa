import { useEffect, useState } from 'react'
import * as DB from '../lib/db.js'
import { coverGradient, cleanTitle } from '../lib/cover.js'

export default function BookCover({ book, badge, ver }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let revoked = null, alive = true
    DB.getCover(book.id).then((blob) => {
      if (alive && blob) { const u = URL.createObjectURL(blob); revoked = u; setUrl(u) }
      else if (alive) setUrl(null)
    })
    return () => { alive = false; if (revoked) URL.revokeObjectURL(revoked) }
  }, [book.id, ver])

  const src = url || book.coverThumb || null

  return (
    <div className="cover" style={!src ? { background: coverGradient(book.id || book.title) } : undefined}>
      {src ? <img src={src} alt={cleanTitle(book.title)} loading="lazy" /> : (
        <>
          <div className="spine" />
          <div className="ct"><div className="t">{cleanTitle(book.title)}</div><div className="glyph">📖</div></div>
        </>
      )}
      {badge != null && badge > 0 && <div className="badge">{Math.round(badge)}%</div>}
    </div>
  )
}
