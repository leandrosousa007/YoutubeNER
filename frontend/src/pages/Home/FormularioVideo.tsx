import { useState, type FormEvent } from 'react'
import { Button } from '../../components/Button/Button'
import styles from './Home.module.css'

type Props = {
  carregando: boolean
  buscar: (videoId: string) => void
}

export function FormularioVideo({ carregando, buscar }: Props) {
  const [videoId, setVideoId] = useState('')

  function enviar(evento: FormEvent<HTMLFormElement>) {
    // evita recarregar a pagina
    evento.preventDefault()
    buscar(videoId.trim())
  }

  return (
    <section className={styles.searchCard} aria-label="Buscar comentários">
      <form onSubmit={enviar}>
        <label htmlFor="video-id">ID do vídeo</label>
        <div className={styles.searchRow}>
          <input
            id="video-id"
            placeholder="Ex.: 8MK8fBxAHoU"
            value={videoId}
            onChange={(evento) => setVideoId(evento.target.value)}
            disabled={carregando}
          />
          <Button type="submit" disabled={carregando}>
            {carregando ? 'Coletando…' : 'Coletar comentários'}
          </Button>
        </div>
        <p className={styles.hint}>O ID é a parte depois de <code>v=</code> no endereço do vídeo.</p>
      </form>
    </section>
  )
}
