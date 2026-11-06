import BookCover from './BookCover.jsx'
import { cleanTitle } from '../lib/cover.js'

export default function Library({ books, coverVer, onOpen, onDelete, onChangeCover }) {
  if (!books.length) {
    return (
      <div className="wrap">
        <div className="empty">
          <div className="big">📚</div>
          <p>Tu biblioteca está vacía.</p>
          <p>Pulsa <b>Agregar EPUB</b> para importar un libro, o restaura un respaldo desde el menú <b>⋯</b>.</p>
        </div>
      </div>
    )
  }
  const [current, ...rest] = books
  const pct = current.progress?.percent || 0
  const started = pct > 0
  return (
    <div className="wrap">
      <div className="hero">
        <div onClick={() => onOpen(current)} style={{ cursor: 'pointer', width: 130, minWidth: 130, position: 'relative' }}>
          <BookCover book={current} badge={pct} ver={coverVer} />
          <button className="cover-edit" title="Cambiar portada"
            onClick={(e) => { e.stopPropagation(); onChangeCover(current) }}>🖼️</button>
        </div>
        <div className="info">
          <div className="eyebrow">{started ? 'SEGUIR LEYENDO' : 'EMPEZAR A LEER'}</div>
          <div className="bt">{cleanTitle(current.title)}</div>
          <div className="meta">
            {current.author ? current.author + ' · ' : ''}{started ? `vas por el ${Math.round(pct)}%` : 'sin empezar'}
          </div>
          <div className="track"><div style={{ width: `${Math.min(100, pct)}%` }} /></div>
          <div className="actions"><button onClick={() => onOpen(current)}>{started ? 'Continuar' : 'Abrir'}</button></div>
        </div>
      </div>
      {rest.length > 0 && (
        <>
          <h2 className="section-title">Tu biblioteca</h2>
          <div className="grid">
            {rest.map((b) => (
              <div className="book" key={b.id}>
                <div onClick={() => onOpen(b)}>
                  <BookCover book={b} badge={b.progress?.percent || 0} ver={coverVer} />
                </div>
                <button className="cover-edit" title="Cambiar portada"
                  onClick={(e) => { e.stopPropagation(); onChangeCover(b) }}>🖼️</button>
                <button className="del icon" title="Eliminar" onClick={(e) => { e.stopPropagation(); onDelete(b) }}>🗑</button>
                <div className="title" onClick={() => onOpen(b)}>{cleanTitle(b.title)}</div>
                <div className="bar"><div style={{ width: `${Math.min(100, b.progress?.percent || 0)}%` }} /></div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
