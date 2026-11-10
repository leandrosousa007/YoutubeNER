import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { Button } from '../../components/Button/Button'
import { Dialog } from '../../components/Dialog/Dialog'
import { Icon } from '../../components/Icon/Icon'
import {
  api, apiColecao, chaveMarcacao, json, mensagem, sobrepoe,
  type Colecao, type Comentario, type ComentarioResumo, type Entidade, type ItemAnotacao, type Marcacao, type NovaRelacao, type Pagina, type Tipo,
} from '../../features/anotacao/api'
import { GruposAnotacao } from './GruposAnotacao'
import { Inspetor, type Trecho } from './Inspetor'
import s from './Workbench.module.css'

type Props = {
  colecoes: Colecao[]
  colecao?: Colecao
  tipos: Tipo[]
  removidos: Tipo[]
  selecionar: (id: string) => void
  atualizar: (item: Colecao) => void
  irParaColecoes: () => void
}

const TAMANHO = 10
const MEDIA_COMPACTA = '(max-width: 55rem)'
const numero = (n: number) => n.toLocaleString('pt-BR')

function lerTrecho(elemento: HTMLElement): Trecho | null {
  const selecao = window.getSelection()
  if (!selecao?.rangeCount || selecao.isCollapsed) return null
  const intervalo = selecao.getRangeAt(0)
  if (!elemento.contains(intervalo.startContainer) || !elemento.contains(intervalo.endContainer)) return null
  const anterior = document.createRange()
  anterior.selectNodeContents(elemento)
  anterior.setEnd(intervalo.startContainer, intervalo.startOffset)
  const bruto = intervalo.toString()
  const selecionado = bruto.trim()
  if (!selecionado) return null
  const inicio = Array.from(anterior.toString() + bruto.slice(0, bruto.length - bruto.trimStart().length)).length
  return { inicio, fim: inicio + Array.from(selecionado).length, texto: selecionado }
}

export function Anotacao({ colecoes, colecao, tipos, removidos, selecionar, atualizar, irParaColecoes }: Props) {
  const [pos, setPos] = useState<number | null>(null)
  const [pagina, setPagina] = useState<Pagina | null>(null)
  const [detalhe, setDetalhe] = useState<Comentario | null>(null)
  const [trecho, setTrecho] = useState<Trecho | null>(null)
  const [marca, setMarca] = useState<Entidade | null>(null)
  const [revisaoGrupos, setRevisaoGrupos] = useState(0)
  const [busca, setBusca] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [atualizacao, setAtualizacao] = useState(0)
  const [compacto, setCompacto] = useState(() => window.matchMedia(MEDIA_COMPACTA).matches)
  const [painel, setPainel] = useState<'grupos' | 'detalhes' | null>(null)
  const id = colecao?.id
  const total = colecao?.total ?? 0
  const inicio = pos === null ? null : Math.floor((pos - 1) / TAMANHO) * TAMANHO + 1
  const item = detalhe?.pos === pos ? detalhe : null
  const porCodigo = new Map([...tipos, ...removidos].map(t => [t.codigo, t]))
  const sobreposta = trecho && item?.entidades.some(e => sobrepoe(e, trecho))
  const linhas = pagina?.comentarios[0]?.pos === inicio ? pagina.comentarios : []
  const faltam = total - (colecao?.revisados ?? 0)
  const capturar = useCallback((elemento: HTMLElement, posicao: number) => {
    const selecao = lerTrecho(elemento)
    if (!selecao) return
    setPos(posicao)
    setMarca(null)
    setTrecho(atual => atual?.inicio === selecao.inicio && atual.fim === selecao.fim && atual.texto === selecao.texto ? atual : selecao)
    setErro('')
    setAviso('')
  }, [])

  useEffect(() => {
    const media = window.matchMedia(MEDIA_COMPACTA)
    const alterar = (e: MediaQueryListEvent) => setCompacto(e.matches)
    media.addEventListener('change', alterar)
    return () => media.removeEventListener('change', alterar)
  }, [])

  useEffect(() => {
    if (!compacto || ocupado || painel) return
    function detectar() {
      const ancora = window.getSelection()?.anchorNode
      const elemento = (ancora instanceof Element ? ancora : ancora?.parentElement)?.closest<HTMLElement>('[data-comentario-pos]')
      if (elemento) capturar(elemento, Number(elemento.dataset.comentarioPos))
    }
    document.addEventListener('selectionchange', detectar)
    return () => document.removeEventListener('selectionchange', detectar)
  }, [compacto, ocupado, painel, capturar])

  useEffect(() => {
    if (!id || !total || pos !== null) return
    const controller = new AbortController()
    api<{ pos: number | null }>(apiColecao(id) + '/pendente', { signal: controller.signal })
      .then(dados => { if (!controller.signal.aborted) setPos(dados.pos ?? 1) })
      .catch(erro => { if (!controller.signal.aborted) setErro(mensagem(erro)) })
    return () => controller.abort()
  }, [id, total, pos, atualizacao])

  useEffect(() => {
    if (!id || inicio === null) return
    const controller = new AbortController()
    api<Pagina>(apiColecao(id) + '/pagina?inicio=' + inicio + '&tamanho=' + TAMANHO, { signal: controller.signal })
      .then(dados => { if (!controller.signal.aborted) setPagina(dados) })
      .catch(erro => { if (!controller.signal.aborted) setErro(mensagem(erro)) })
    return () => controller.abort()
  }, [id, inicio, total, atualizacao])

  useEffect(() => {
    if (!id || pos === null) return
    const controller = new AbortController()
    api<Comentario>(apiColecao(id) + '/comentarios/' + pos, { signal: controller.signal })
      .then(dados => { if (!controller.signal.aborted) setDetalhe(dados) })
      .catch(erro => { if (!controller.signal.aborted) setErro(mensagem(erro)) })
    return () => controller.abort()
  }, [id, pos, atualizacao])

  useEffect(() => {
    if (marca?.id) document.getElementById('span-' + marca.id)?.scrollIntoView({ block: 'nearest' })
  }, [marca?.id, pagina])

  function limparSelecao() {
    setTrecho(null)
    setMarca(null)
    window.getSelection()?.removeAllRanges()
  }

  function ir(pagina: number) {
    if (ocupado || pagina < 1 || pagina > total) return
    limparSelecao()
    setPos(pagina)
    setErro('')
    setAviso('')
  }

  function receber(dados: { comentario: Comentario; colecao: Colecao }) {
    if (dados.comentario.pos === pos) setDetalhe(dados.comentario)
    setPagina(anterior => anterior ? { ...anterior,
      comentarios: anterior.comentarios.map(linha => linha.pos === dados.comentario.pos ? dados.comentario : linha),
    } : anterior)
    atualizar(dados.colecao)
    setRevisaoGrupos(n => n + 1)
  }

  async function salvar(entidades: Marcacao[], revisado: boolean, rejeitadas: Marcacao[], aviso: string, manter?: Marcacao, relacoes?: NovaRelacao[]) {
    if (!item || !id || ocupado) return
    setOcupado(true)
    setErro('')
    setAviso('')
    try {
      const dados = await api<{ comentario: Comentario; colecao: Colecao }>(
        apiColecao(id) + '/comentarios/' + item.pos,
        json('PUT', { versao: item.versao, entidades, revisado, rejeitadas, relacoes }),
      )
      receber(dados)
      limparSelecao()
      if (manter) setMarca(dados.comentario.entidades.find(e => chaveMarcacao(e) === chaveMarcacao(manter)) ?? null)
      setAviso(aviso)
    } catch (erro) { setErro(mensagem(erro)) }
    finally { setOcupado(false) }
  }

  function aplicarTipo(tipo: string) {
    if (!item || ocupado) return
    if (marca) {
      if (marca.tipo === tipo) return
      const editada = { ...marca, tipo }
      void salvar(item.entidades.map(e => e.id === marca.id ? editada : e), false, item.rejeitadas, 'Tipo atualizado.', editada)
    } else if (trecho && !sobreposta) {
      const nova = { ...trecho, tipo }
      void salvar([...item.entidades, nova], false, item.rejeitadas, 'Entidade salva.', nova)
    }
  }

  async function excluir(posicao: number, span: string) {
    if (!id || ocupado) return
    setOcupado(true)
    setErro('')
    setAviso('')
    try {
      const dados = await api<{ comentario: Comentario; colecao: Colecao }>(
        apiColecao(id) + '/comentarios/' + posicao + '/anotacoes/' + encodeURIComponent(span), { method: 'DELETE' },
      )
      receber(dados)
      if (marca?.id === span) limparSelecao()
      setAviso('Marcação excluída.')
    } catch (erro) { setErro(mensagem(erro)) }
    finally { setOcupado(false) }
  }

  async function localizar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (!id || ocupado || !busca.trim()) return
    try {
      const dados = await api<{ pos: number }>(apiColecao(id) + '/por-id?' + new URLSearchParams({ id: busca.trim() }))
      ir(dados.pos)
    } catch (erro) { setErro(mensagem(erro)) }
  }

  async function pendente() {
    if (!id || ocupado) return
    try {
      const dados = await api<{ pos: number | null }>(apiColecao(id) + '/pendente?depois=' + (pos ?? 0))
      if (dados.pos === null) setAviso('Todos os comentários foram revisados.')
      else ir(dados.pos)
    } catch (erro) { setErro(mensagem(erro)) }
  }

  function localizarMarca(entidade: ItemAnotacao) {
    ir(entidade.pos)
    setMarca(entidade)
    setPainel(null)
  }

  function escolherMarca(e: Entidade, linha: ComentarioResumo) {
    if (ocupado || !window.getSelection()?.isCollapsed) return
    setPos(linha.pos)
    setTrecho(null)
    setMarca(e)
  }

  if (!colecao) return <section className={s.panel}><h1>Bancada de anotação</h1><p>Sincronize os comentários do PostgreSQL para começar.</p><Button onClick={irParaColecoes}>Abrir coleções</Button></section>

  const grupos = <GruposAnotacao colecao={colecao.id} tipos={tipos} revisao={revisaoGrupos} selecionada={marca?.id} ocupado={ocupado}
    localizar={localizarMarca} excluir={e => void excluir(e.pos, e.id)} embutido={compacto} />
  const inspetor = <Inspetor item={item} marca={marca} trecho={trecho} tipos={tipos} ocupado={ocupado} sobreposta={!!sobreposta}
    aplicarTipo={aplicarTipo} excluir={span => { if (item) void excluir(item.pos, span) }}
    limpar={limparSelecao} escolher={e => { limparSelecao(); setMarca(e) }}
    salvarRelacoes={relacoes => item ? salvar(item.entidades, false, item.rejeitadas, 'Relações salvas.', undefined, relacoes) : Promise.resolve()}
    revisar={() => { if (item) void salvar(item.entidades, !item.revisado, item.rejeitadas, item.revisado ? 'Comentário reaberto.' : 'Revisão salva.') }} />

  return (
    <div className={s.workbench}>
      <header className={s.benchHead}>
        <div><p>Área de trabalho</p><h1>Bancada de anotação</h1></div>
        <span>Selecione um trecho e escolha o tipo.</span>
      </header>
      <header className={s.toolbar}>
        <div className={s.collectionControl}>
          <label htmlFor="colecao-atual">Coleção</label>
          <select id="colecao-atual" value={colecao.id} disabled={ocupado} onChange={evento => selecionar(evento.target.value)}>
            {colecoes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div className={s.progress}>
          <span><strong>{numero(colecao.revisados)}</strong> / {numero(total)} revisados</span>
          <progress value={colecao.revisados} max={total || 1} aria-label="Progresso da revisão" />
          <small>{numero(faltam)} pendentes</small>
        </div>
        <div className={s.exportActions}>
          <a href={apiColecao(colecao.id) + '/anotacoes.jsonl'}><Icon name="download" width="16" height="16" /> Exportar JSONL</a>
          <a href={apiColecao(colecao.id) + '/anotacoes.csv'}><Icon name="download" width="16" height="16" /> Exportar CSV</a>
        </div>
        <details className={s.exportMenu}>
          <summary><Icon name="download" width="16" height="16" /> Exportar</summary>
          <div>
            <a href={apiColecao(colecao.id) + '/anotacoes.jsonl'}>Anotações em JSONL</a>
            <a href={apiColecao(colecao.id) + '/anotacoes.csv'}>Anotações em CSV</a>
          </div>
        </details>
      </header>

      {(erro || (!compacto && aviso)) && <div className={erro ? s.error : s.notice} role={erro ? 'alert' : 'status'}>
        {!erro && <Icon name="check" width="18" height="18" />}{erro || aviso}
        {erro && <button type="button" onClick={() => { limparSelecao(); setErro(''); setAtualizacao(n => n + 1) }}>Recarregar</button>}
      </div>}

      <div className={s.columns}>
        {!compacto && grupos}

        <section className={s.document} aria-label="Comentários da coleção">
          <div className={s.docHeader}>
            <div className={s.group}>
              <button type="button" aria-label="Primeira página" disabled={ocupado || inicio === null || inicio <= 1} onClick={() => ir(1)}><Icon name="first" width="17" height="17" /></button>
              <button type="button" aria-label="Página anterior" disabled={ocupado || inicio === null || inicio <= 1} onClick={() => ir(Math.max(1, (inicio ?? 1) - TAMANHO))}><Icon name="left" width="17" height="17" /></button>
              <span className={s.counter}>{inicio && total ? numero(inicio) + '–' + numero(Math.min(total, inicio + TAMANHO - 1)) : '0'} / {numero(total)}</span>
              <button type="button" aria-label="Próxima página" disabled={ocupado || inicio === null || inicio + TAMANHO > total} onClick={() => ir((inicio ?? 1) + TAMANHO)}><Icon name="right" width="17" height="17" /></button>
              <button type="button" aria-label="Última página" disabled={ocupado || inicio === null || inicio + TAMANHO > total} onClick={() => ir(Math.floor((total - 1) / TAMANHO) * TAMANHO + 1)}><Icon name="last" width="17" height="17" /></button>
            </div>
            <form className={s.group} onSubmit={evento => void localizar(evento)}>
              <input aria-label="Buscar ID do comentário" placeholder="Buscar ID" value={busca} onChange={e => setBusca(e.target.value)} />
              <button type="submit" disabled={!busca.trim() || ocupado}>Ir ao ID</button>
            </form>
            <button type="button" disabled={!faltam || ocupado} onClick={() => void pendente()}>Próximo pendente</button>
          </div>
          {total === 0 ? <p className={s.help}>Nenhum comentário com texto nesta coleção.</p> : linhas.length === 0 ? <p className={s.help} role="status">Abrindo comentários…</p> : (
            <ol className={s.rows} start={inicio ?? 1}>
              {linhas.map(linha => {
                const atual = item?.pos === linha.pos ? item : linha
                return <li key={linha.id} className={pos === linha.pos ? s.activeRow : undefined}>
                  <button className={s.rowNumber} type="button" aria-current={pos === linha.pos ? 'true' : undefined} disabled={ocupado}
                    title={linha.id} aria-label={'Selecionar comentário ' + linha.id} onClick={() => ir(linha.pos)}>
                    {numero(linha.pos)}<span aria-label={atual.revisado ? 'Revisado' : 'Pendente'}>{atual.revisado ? '✓' : '·'}</span>
                  </button>
                  <div className={s.rowContent}>
                    <span className={s.rowId}>ID {linha.id}</span>
                    <p tabIndex={0} aria-label={'Texto do comentário ' + linha.id} data-comentario-pos={linha.pos}
                      onPointerUp={e => { if (!ocupado) capturar(e.currentTarget, linha.pos) }}
                      onKeyUp={e => { if (!ocupado) capturar(e.currentTarget, linha.pos) }}>
                      <TextoMarcado texto={linha.texto} entidades={atual.entidades} porCodigo={porCodigo}
                        escolher={e => escolherMarca(e, linha)} selecionada={pos === linha.pos ? marca : null} />
                    </p>
                  </div>
                </li>
              })}
            </ol>
          )}
        </section>

        {!compacto && <aside className={s.inspector} aria-labelledby="inspetor"><h2 id="inspetor">Trecho selecionado</h2>{inspetor}</aside>}
      </div>
      {compacto && <div className={s.mobileDock} aria-label="Controles de anotação">
        {(marca || trecho) && <div className={s.quickTypes}>
          <div className={s.quickContext}><strong>{marca?.texto ?? trecho?.texto}</strong><span role="status">{sobreposta ? 'Trecho sobreposto' : aviso || (marca ? 'Alterar tipo' : 'Toque para marcar')}</span></div>
          {tipos.length > 0 && <ul aria-label="Tipos rápidos">{tipos.map(t => <li key={t.codigo}>
            <button type="button" aria-label={t.codigo + ' · ' + t.nome} aria-pressed={marca?.tipo === t.codigo}
              disabled={!item || ocupado || !!sobreposta} onClick={() => aplicarTipo(t.codigo)}>
              <span className={s.dot} style={{ '--tag': t.cor } as CSSProperties} />{t.codigo}
            </button>
          </li>)}</ul>}
        </div>}
        {!marca && !trecho && aviso && <div className={s.dockStatus} role="status">{aviso}</div>}
        <div className={s.dockActions}>
          <Button variant="secondary" onClick={() => setPainel('grupos')}><Icon name="list" width="17" height="17" /> Marcações</Button>
          <Button variant="secondary" aria-label="Detalhes do trecho" disabled={!item} onClick={() => setPainel('detalhes')}><Icon name="more" width="17" height="17" /> Detalhes</Button>
        </div>
      </div>}
      {compacto && painel === 'grupos' && <Dialog title="Marcações da coleção" sheet close={() => setPainel(null)}>{grupos}</Dialog>}
      {compacto && painel === 'detalhes' && <Dialog title="Trecho selecionado" sheet close={() => setPainel(null)}>{inspetor}</Dialog>}
    </div>
  )
}

type TextoProps = {
  texto: string; entidades: Entidade[]; porCodigo: Map<string, Tipo>
  escolher: (e: Entidade) => void; selecionada: Entidade | null
}

function TextoMarcado({ texto, entidades, porCodigo, escolher, selecionada }: TextoProps) {
  if (!entidades.length) return texto
  const caracteres = Array.from(texto)
  return <>
    {entidades.map((e, i) => <span key={chaveMarcacao(e)}>
      {caracteres.slice(entidades[i - 1]?.fim ?? 0, e.inicio).join('')}
        <mark id={'span-' + e.id} role="button" tabIndex={0} aria-label={e.tipo + ': ' + e.texto} data-tipo={e.tipo}
          data-ativa={selecionada && chaveMarcacao(selecionada) === chaveMarcacao(e) ? '' : undefined}
          style={{ '--tag': porCodigo.get(e.tipo)?.cor ?? '#537270' } as CSSProperties} onClick={() => escolher(e)}
          onKeyDown={evento => { if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); escolher(e) } }}>{e.texto}</mark>
    </span>)}
    {caracteres.slice(entidades.at(-1)?.fim ?? 0).join('')}
  </>
}
