import { useState, type FormEvent } from 'react'
import { Button } from '../../components/Button/Button'
import { Icon } from '../../components/Icon/Icon'
import { api, apiColecao, json, mensagem, requisicao, type Colecao, type Postgres } from '../../features/anotacao/api'
import s from './Pesquisa.module.css'

type Props = {
  colecoes: Colecao[]
  postgres: Postgres | null
  sincronizar: () => Promise<void>
  atualizarColecoes: () => Promise<void>
  abrir: (item: Colecao) => void
}
type Coleta = { inseridos: number; ja_existiam: number; coletados: number; sincronizacao: Postgres }
const numero = (n: number) => n.toLocaleString('pt-BR')

export function Biblioteca({ colecoes, postgres, sincronizar, atualizarColecoes, abrir }: Props) {
  const [video, setVideo] = useState('')
  const [operacao, setOperacao] = useState<'postgres' | 'csv' | 'sync' | null>(null)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const espelho = colecoes.find(item => item.id === postgres?.colecao)
  const bancoDisponivel = postgres?.estado !== 'sem_configuracao'
  const total = colecoes.reduce((soma, item) => soma + item.total, 0)
  const revisados = colecoes.reduce((soma, item) => soma + item.revisados, 0)

  async function atualizarBanco() {
    setOperacao('sync')
    setErro('')
    setAviso('')
    try { await sincronizar() }
    catch (erro) { setErro(mensagem(erro)) }
    finally { setOperacao(null) }
  }

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (operacao) return
    const botao = (evento.nativeEvent as SubmitEvent).submitter
    const acao = botao?.getAttribute('data-acao') === 'csv' ? 'csv' : 'postgres'
    if (acao === 'postgres' && !bancoDisponivel) return
    const videoId = video.trim()
    setOperacao(acao)
    setErro('')
    setAviso('')
    try {
      const init = json('POST', { video_id: videoId })
      if (acao === 'postgres') {
        const dados = await api<Coleta>('/api/coleta/postgres', init)
        setAviso('Novos no PostgreSQL: ' + numero(dados.inseridos) + ' · Já existentes: ' + numero(dados.ja_existiam) + '.'
          + (dados.sincronizacao.estado === 'erro' ? ' A gravação foi concluída. Use Sincronizar agora para atualizar a biblioteca.' : ''))
        try { await atualizarColecoes() }
        catch { setErro('A gravação foi concluída. Atualize a página para ver a coleção.') }
      } else {
        const resposta = await requisicao('/api/coleta/csv', init)
        const url = URL.createObjectURL(await resposta.blob())
        const link = document.createElement('a')
        link.href = url
        link.download = 'comentarios-' + videoId + '.csv'
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        setAviso('CSV do vídeo baixado.')
      }
    } catch (erro) { setErro(mensagem(erro)) }
    finally { setOperacao(null) }
  }

  return (
    <>
      <header className={s.pageHead}>
        <div><p className={s.eyebrow}>Corpus de pesquisa</p><h1>Coleções</h1><p className={s.lead}>Colete, organize e anote comentários do YouTube.</p></div>
        {espelho && <Button onClick={() => abrir(espelho)}><Icon name="annotate" width="17" height="17" />Anotar comentários do banco</Button>}
      </header>
      <dl className={s.metrics}>
        <div><dt>Comentários</dt><dd>{numero(total)}</dd></div>
        <div><dt>Revisados</dt><dd>{numero(revisados)}</dd></div>
        <div><dt>Pendentes</dt><dd>{numero(total - revisados)}</dd></div>
      </dl>
      <div className={s.grid}>
        <section className={s.card} aria-labelledby="postgres-titulo">
          <div className={s.cardHeader}><span className={s.cardIcon}><Icon name="database" /></span><div><p className={s.eyebrow}>Banco de dados</p><h2 id="postgres-titulo">PostgreSQL</h2></div></div>
          <p>{postgres?.origem ? <><code>{postgres.origem}</code> · Sincronização automática</> : 'Os comentários do banco aparecem como uma coleção.'}</p>
          {postgres?.mensagem && <p className={postgres.estado === 'erro' ? s.alert : s.muted}>{postgres.mensagem}</p>}
          {postgres?.ultima_sync && <p className={s.muted}>Última leitura: {new Date(postgres.ultima_sync).toLocaleString('pt-BR')}</p>}
          <div className={s.actions}>
            <Button variant="secondary" disabled={!!operacao || !bancoDisponivel || postgres?.estado === 'sincronizando'}
              onClick={() => void atualizarBanco()}><Icon name="refresh" width="16" height="16" />{operacao === 'sync' || postgres?.estado === 'sincronizando' ? 'Sincronizando…' : 'Sincronizar agora'}</Button>
          </div>
        </section>
        <form className={s.card} onSubmit={evento => void enviar(evento)}>
          <div className={s.cardHeader}><span className={s.cardIcon}><Icon name="play" /></span><div><p className={s.eyebrow}>Nova coleta</p><h2>Comentários do YouTube</h2></div></div>
          <p>Informe o ID do vídeo e escolha onde guardar os comentários.</p>
          <label htmlFor="video-id">ID do vídeo</label>
          <input id="video-id" placeholder="Ex.: 8MK8fBxAHoU" required maxLength={11} pattern="[a-zA-Z0-9_\-]{11}"
            value={video} disabled={!!operacao} onChange={evento => setVideo(evento.target.value)} />
          <div className={s.actions}>
            <Button type="submit" data-acao="postgres" disabled={!!operacao || !bancoDisponivel}>
              {operacao === 'postgres' ? 'Coletando…' : 'Adicionar ao PostgreSQL'}
            </Button>
            <Button variant="secondary" type="submit" data-acao="csv" disabled={!!operacao}>
              <Icon name="download" width="16" height="16" />{operacao === 'csv' ? 'Preparando…' : 'Baixar CSV do vídeo'}
            </Button>
          </div>
        </form>
      </div>
      {(operacao === 'postgres' || operacao === 'csv') && <p className={s.notice} role="status">Buscando as páginas de comentários no YouTube…</p>}
      {aviso && <p className={s.notice} role="status">{aviso}</p>}
      {erro && <p className={s.alert} role="alert">{erro}</p>}
      <section className={s.library} aria-labelledby="biblioteca">
        <h2 id="biblioteca">Coleções salvas</h2>
        {colecoes.length === 0 ? <p className={s.empty}>Sincronize o PostgreSQL para começar.</p> : (
          <ul className={s.list}>{colecoes.map(item => (
            <li key={item.id} className={s.listItem}>
              <div className={s.itemText}>
                <strong>{item.nome}</strong>
                <span>{numero(item.revisados)} de {numero(item.total)} revisados · {item.origem === 'postgres' ? 'PostgreSQL' : 'Arquivo local'}</span>
                <progress value={item.revisados} max={item.total || 1} aria-label={'Progresso de ' + item.nome} />
              </div>
              <div className={s.actions}>
                <a href={apiColecao(item.id) + '/csv'}><Icon name="download" width="16" height="16" />Baixar CSV da coleção</a>
                <Button variant="secondary" onClick={() => abrir(item)}>Anotar</Button>
              </div>
            </li>
          ))}</ul>
        )}
      </section>
    </>
  )
}
