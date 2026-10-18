import { useState } from 'react'
import { Button } from '../../components/Button/Button'
import { baixarCsv } from './csv'
import type { Coleta } from './tipos'
import styles from './Home.module.css'

export function Comentarios({ comentarios }: Coleta) {
  const [pagina, setPagina] = useState(1)

  // separa dez comentarios por pagina
  const inicio = (pagina - 1) * 10
  const fim = Math.min(inicio + 10, comentarios.length)
  const comentariosDaPagina = comentarios.slice(inicio, fim)
  const totalPaginas = Math.ceil(comentarios.length / 10)

  return (
    <section className={styles.results} aria-labelledby="resultados-comentarios">
      <div className={styles.resultsHeading}>
        <h2 id="resultados-comentarios">Comentários <span className={styles.total}>{comentarios.length}</span></h2>
        <Button variant="secondary" onClick={() => baixarCsv(comentarios)} disabled={comentarios.length === 0}>
          <span aria-hidden="true">↓ </span>Baixar CSV
        </Button>
      </div>

      {comentarios.length === 0 ? (
        <div className={styles.empty}>
          <h3>Nenhum comentário encontrado</h3>
          <p>Tente coletar os comentários de outro vídeo.</p>
        </div>
      ) : (
        <>
          <p className={styles.status} role="status">{comentarios.length} comentários coletados. O CSV inclui todos eles.</p>

          <ol className={styles.list} start={inicio + 1}>
            {comentariosDaPagina.map((comentario, indice) => (
              <li className={styles.comment} key={inicio + indice}>
                <div className={styles.commentBody}>
                  <div className={styles.commentHeading}>
                    <h3>{comentario.autor || 'Sem nome'}</h3>
                    {comentario.timestamp && (
                      <time dateTime={comentario.timestamp}>{new Date(comentario.timestamp).toLocaleDateString('pt-BR')}</time>
                    )}
                  </div>
                  <p className={styles.text}>{comentario.texto}</p>
                  <span className={styles.likes}>{comentario.likes ?? 0} curtidas</span>
                </div>
              </li>
            ))}
          </ol>

          <nav className={styles.pagination} aria-label="Páginas de comentários">
            <span>{inicio + 1}–{fim} de {comentarios.length} comentários</span>
            <div className={styles.pageButtons}>
              <Button variant="secondary" disabled={pagina === 1} onClick={() => setPagina(pagina - 1)}>← Anterior</Button>
              <span aria-live="polite">Página {pagina} de {totalPaginas}</span>
              <Button variant="secondary" disabled={pagina === totalPaginas} onClick={() => setPagina(pagina + 1)}>Próxima →</Button>
            </div>
          </nav>
        </>
      )}
    </section>
  )
}
