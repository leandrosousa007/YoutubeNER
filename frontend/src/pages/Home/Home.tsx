import { useState } from 'react'
import { FormularioVideo } from './FormularioVideo'
import { Comentarios } from './Comentarios'
import type { Coleta } from './tipos'
import styles from './Home.module.css'

export function Home() {
  const [resultado, setResultado] = useState<Coleta | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')

  async function buscar(videoId: string) {
    // limpa a busca anterior
    setResultado(null)
    setErro('')
    setCarregando(true)

    try {
      // pede os comentarios para a api
      const resposta = await fetch('http://127.0.0.1:8000/comentarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: videoId }),
      })
      const dados = await resposta.json()

      if (!resposta.ok) {
        const mensagem = typeof dados.detail === 'string' ? dados.detail : 'Não foi possível coletar os comentários.'
        throw new Error(mensagem)
      }

      setResultado(dados)
    } catch (erro) {
      setErro(erro instanceof Error ? erro.message : 'Não foi possível conectar à API.')
    } finally {
      setCarregando(false)
    }
  }

  return (
    <>
      <section className={styles.intro} aria-labelledby="introducao">
        <h1 id="introducao">Comentários do YouTube</h1>
        <p>Informe o ID do vídeo para ver os comentários e baixar os dados em CSV.</p>
      </section>

      <FormularioVideo carregando={carregando} buscar={buscar} />

      {erro && <p className={styles.error} role="alert">{erro}</p>}
      {carregando && (
        <div className={styles.loading} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          <div>
            <p>Coletando comentários…</p>
            <span>Aguarde até a coleta de todas as páginas terminar.</span>
          </div>
        </div>
      )}

      {resultado && <Comentarios comentarios={resultado.comentarios} />}

      {!resultado && !carregando && !erro && (
        <div className={`${styles.results} ${styles.empty}`}>
          <h2>Os comentários aparecerão aqui</h2>
          <p>Depois da coleta, você pode navegar pelas páginas ou baixar todos os dados.</p>
        </div>
      )}
    </>
  )
}
