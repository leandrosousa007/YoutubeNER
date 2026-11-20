import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { Button } from '../../components/Button/Button'
import { Dialog } from '../../components/Dialog/Dialog'
import { Icon } from '../../components/Icon/Icon'
import {
  api, apiColecao, chaveMarcacao, json, mensagem, sobrepoe,
  type Colecao, type Comentario, type ComentarioResumo, type Entidade, type ItemAnotacao, type Marcacao, type NovaRelacao, type Pagina, type Tipo, type Usuario,
} from '../../features/anotacao/api'
import { PageCache, PAGE_SIZE, inicioDaPagina } from '../../features/anotacao/pageCache'
import { GruposAnotacao } from './GruposAnotacao'
import { EntityPicker } from './EntityPicker'
import { Inspetor, type Trecho } from './Inspetor'
import s from './Workbench.module.css'

type Props = {
  colecoes: Colecao[]
  colecao?: Colecao
  tipos: Tipo[]
  removidos: Tipo[]
  usuario: Usuario | null
  selecionar: (id: string) => void
  atualizar: (item: Colecao) => void
  irParaColecoes: () => void
  aoSalvar: (ocupado: boolean) => void
}

type Edicao = {
  aviso: string
  entidades?: Marcacao[]
  manter?: Marcacao
  revisado?: boolean
  relacoes?: NovaRelacao[]
  avancar?: boolean
  ajuste?: string
}

const TAMANHO = PAGE_SIZE
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

export function Anotacao({ colecoes, colecao, tipos, removidos, selecionar, atualizar, irParaColecoes, usuario, aoSalvar }: Props) {
  const [pos, setPos] = useState<number | null>(null)
  const [pagina, setPagina] = useState<Pagina | null>(null)
  const cache = useMemo(() => new PageCache(colecao?.id ?? ''), [colecao?.id])
  const fila = useRef<Promise<void>>(Promise.resolve())
  const pendencias = useRef(0)
  const versaoConfirmada = useRef<number | null>(null)
  const [destino, setDestino] = useState<{ pos: number } | null>(null)
  const ultimoDestino = useRef(destino)
  const falhaGravacao = useRef(false)
  const [salvando, setSalvando] = useState(false)
  const [detalhe, setDetalhe] = useState<Comentario | null>(null)
  const [trecho, setTrecho] = useState<Trecho | null>(null)
  const [marcaSelecionada, setMarca] = useState<Entidade | null>(null)
  const [revisaoGrupos, setRevisaoGrupos] = useState(0)
  const [busca, setBusca] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [atualizacao, setAtualizacao] = useState(0)
  const [filaRevisao, setFilaRevisao] = useState(() => location.pathname === '/revisao' && Boolean(usuario && usuario.papel !== 'anotador'))
  const [feedback, setFeedback] = useState('')
  const [resultados, setResultados] = useState<{ itens: { id: string; pos: number; texto: string }[]; proximo: number | null } | null>(null)
  const [filtros, setFiltros] = useState('')
  const [conjunto, setConjunto] = useState('')
  const [listaConjuntos, setListaConjuntos] = useState<{ pos: number; itens: { autor: string; estado: string }[] } | null>(null)
  const [eventos, setEventos] = useState<{ator:string;acao:string;criado_em:string;conjunto?:string;anterior:{feedback?:string;versao:number;entidades:{tipo:string;texto:string}[]}}[] | null>(null)
  const [compacto, setCompacto] = useState(() => window.matchMedia(MEDIA_COMPACTA).matches)
  const [painel, setPainel] = useState<'grupos' | 'detalhes' | null>(null)
  const id = colecao?.id
  const total = colecao?.total ?? 0
  const inicio = pos === null ? null : inicioDaPagina(pos)
  const item = conjunto ? (detalhe?.pos === pos ? detalhe : null) : pagina?.comentarios.find(c => c.pos === pos) ?? null
  const marca = marcaSelecionada ? item?.entidades.find(e => e.id === marcaSelecionada.id) ?? null : null
  const versaoConjunto = conjunto ? detalhe?.versao : undefined
  const opcoesConjuntos = listaConjuntos?.pos === pos ? listaConjuntos.itens : []
  const restricao = motivoSomenteLeitura(item, usuario)
  const pedidoReserva = useMemo(() => ({ id, pos, conjunto, atualizacao }), [id, pos, conjunto, atualizacao])
  const [reservaVerificada, setReservaVerificada] = useState<typeof pedidoReserva | null>(null)
  const verificando = usuario?.papel === 'anotador' && !conjunto && reservaVerificada !== pedidoReserva
  const podeConfirmar = !verificando && !!item && !restricao && !falhaGravacao.current
  const edicaoBloqueada = verificando || ocupado || !!restricao || falhaGravacao.current
  const porCodigo = useMemo(() => new Map([...tipos, ...removidos].map(t => [t.codigo, t])), [tipos, removidos])
  const sobreposta = trecho && item?.entidades.some(e => sobrepoe(e, trecho))
  const inicioCarregado = pagina?.comentarios[0]?.pos
  const linhas = pagina && inicioCarregado === inicio ? pagina.comentarios : []
  const navegacaoOcupada = ocupado || salvando || falhaGravacao.current
  const faltam = total - (colecao?.revisados ?? 0)
  const ativarLinha = useCallback((posicao: number) => {
    if (posicao !== pos) {
      setPos(posicao)
      if (conjunto !== usuario?.login) setConjunto('')
      setEventos(null)
      setFeedback('')
      setErro('')
      setAviso('')
    }
  }, [pos, conjunto, usuario?.login])

  const capturar = useCallback((elemento: HTMLElement, posicao: number) => {
    if (falhaGravacao.current || (navegacaoOcupada && posicao !== pos)) return
    const selecao = lerTrecho(elemento)
    if (!selecao) return
    ativarLinha(posicao)
    setMarca(null)
    setTrecho(atual => atual?.inicio === selecao.inicio && atual.fim === selecao.fim && atual.texto === selecao.texto ? atual : selecao)
    setErro('')
    setAviso('')
  }, [pos, ativarLinha, navegacaoOcupada])

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
    api<{ pos: number | null }>(apiColecao(id) + '/proximo?revisao=' + filaRevisao, { method: 'POST', signal: controller.signal })
      .then(dados => {
        if (controller.signal.aborted) return
        setDestino({ pos: dados.pos ?? 1 })
        setPos(dados.pos ?? 1)
      })
      .catch(erro => { if (!controller.signal.aborted) setErro(mensagem(erro)) })
    return () => controller.abort()
  }, [id, total, pos, atualizacao, filaRevisao])

  useEffect(() => () => cache.clear(), [cache])

  useEffect(() => {
    if (!id || inicio === null) return
    let ativa = true
    const carregar = () => {
      if (document.hidden || falhaGravacao.current) return
      void cache.load(inicio).then(dados => {
        if (ativa && !pendencias.current && !falhaGravacao.current) setPagina(dados)
      }).catch(e => { if (ativa && e.name !== 'AbortError') setErro(mensagem(e)) })
    }
    carregar()
    const timer = window.setInterval(carregar, 30_000)
    document.addEventListener('visibilitychange', carregar)
    return () => {
      ativa = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', carregar)
    }
  }, [id, inicio, cache, atualizacao])

  useEffect(() => {
    if (!id || inicio === null || inicioCarregado !== inicio) return
    // Quatro páginas seguintes e a anterior; apenas 100 comentários antecipados.
    for (const delta of [1, 2, 3, 4, -1]) {
      const alvo = inicio + delta * TAMANHO
      if (alvo > 0 && alvo <= total) void cache.load(alvo).catch(() => {})
    }
  }, [id, inicio, inicioCarregado, total, cache, atualizacao])

  useEffect(() => {
    if (!id || pos === null) return
    if (!conjunto) return // O detalhe completo já vem na página, sem uma segunda espera.
    const controller = new AbortController()
    api<Comentario>(apiColecao(id) + '/comentarios/' + pos + '?conjunto=' + encodeURIComponent(conjunto), { signal: controller.signal })
      .then(dados => { if (!controller.signal.aborted) setDetalhe(dados) })
      .catch(e => { if (!controller.signal.aborted) setErro(mensagem(e)) })
    return () => controller.abort()
  }, [id, pos, atualizacao, conjunto])

  useEffect(() => {
    aoSalvar(salvando)
    if (!salvando) return
    const avisar = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [salvando, aoSalvar])

  useEffect(() => {
    if (!id || !usuario || pos === null) return
    const ac = new AbortController()
    api<{ autor: string; estado: string }[]>(apiColecao(id) + '/comentarios/' + pos + '/conjuntos', { signal: ac.signal })
      .then(itens => { if (!ac.signal.aborted) setListaConjuntos({ pos, itens }) }).catch(() => {})
    return () => ac.abort()
  }, [id, pos, usuario, versaoConjunto])

  useEffect(() => {
    if (!destino || ultimoDestino.current === destino || destino.pos !== pos || !linhas.length) return
    const texto = document.querySelector<HTMLElement>(`[data-comentario-pos="${pos}"]`)
    if (!texto) return
    texto.focus({ preventScroll: true })
    texto.scrollIntoView({ block: 'center', behavior: 'instant' })
    ultimoDestino.current = destino
  }, [destino, pos, linhas.length])

  useEffect(() => {
    if (!id || pos === null || conjunto || usuario?.papel !== 'anotador') return
    const controller = new AbortController()
    api<Comentario>(apiColecao(id) + '/comentarios/' + pos + '/reserva', { method: 'POST', signal: controller.signal })
      .then(comentario => {
        if (controller.signal.aborted) return
        cache.update(comentario)
        setPagina(p => p ? { ...p, comentarios: p.comentarios.map(c => c.pos === pos ? comentario : c) } : p)
        setReservaVerificada(pedidoReserva)
      }).catch(e => { if (!controller.signal.aborted) setErro(mensagem(e)) })
    return () => controller.abort()
  }, [cache, id, pos, conjunto, usuario?.papel, pedidoReserva])

  useEffect(() => {
    if (marca?.id) document.getElementById('span-' + marca.id)?.scrollIntoView({ block: 'nearest' })
  }, [marca?.id])

  function limparSelecao() {
    setTrecho(null)
    setMarca(null)
    window.getSelection()?.removeAllRanges()
  }

  function recarregar() {
    limparSelecao()
    setErro('')
    falhaGravacao.current = false
    cache.clear()
    setPagina(null)
    setDetalhe(null)
    setRevisaoGrupos(n => n + 1)
    setAtualizacao(n => n + 1)
  }

  function ir(pagina: number) {
    if (navegacaoOcupada || pagina < 1 || pagina > total) return
    limparSelecao()
    setConjunto('')
    setEventos(null)
    setFeedback('')
    const pronta = cache.peek(inicioDaPagina(pagina))
    if (pronta) setPagina(pronta)
    setDetalhe(null)
    setDestino({ pos: pagina })
    setPos(pagina)
    setErro('')
    setAviso('')
  }

  function receber(dados: { comentario: Comentario; colecao: Colecao }) {
    if (conjunto) {
      setDetalhe(dados.comentario)
      return
    }
    cache.update(dados.comentario)
    setPagina(anterior => anterior ? { ...anterior,
      comentarios: anterior.comentarios.map(linha => linha.pos === dados.comentario.pos ? dados.comentario : linha),
    } : anterior)
    atualizar(dados.colecao)
    setRevisaoGrupos(n => n + 1)
  }

  async function avancarAposRevisao(anterior: number, aviso: string) {
    if (!id || (conjunto && usuario?.papel === 'anotador')) return
    try {
      if (conjunto) {
        if (!await abrirProximoConjunto()) setAviso(aviso + ' A fila está vazia.')
        return
      }
      const query = new URLSearchParams({ depois: String(anterior), revisao: String(filaRevisao) })
      const proximo = await api<{ pos: number | null }>(apiColecao(id) + '/proximo?' + query, { method: 'POST' })
      if (proximo.pos === null) {
        setAviso(aviso + ' A fila está vazia.')
        return
      }
      limparSelecao()
      setDetalhe(null)
      setEventos(null)
      setFeedback('')
      const pronta = cache.peek(inicioDaPagina(proximo.pos))
      if (pronta) setPagina(pronta)
      setDestino({ pos: proximo.pos })
      setPos(proximo.pos)
    } catch { setAviso(aviso + ' Use o botão da fila para abrir o próximo.') }
  }

  async function salvar(edicao: Edicao) {
    if (!item || !id || edicaoBloqueada) return
    const { entidades = item.entidades, revisado = false, relacoes, avancar, ajuste, aviso, manter } = edicao
    const { rejeitadas, versao } = item
    if (avancar || item.revisado !== revisado) setOcupado(true)
    const chars = Array.from(item.texto)
    const novas = entidades.map(e => ({ ...e, id: e.id ?? crypto.randomUUID().replaceAll('-', ''), texto: chars.slice(e.inicio, e.fim).join('') })).sort((a,b) => a.inicio-b.inicio)
    const ids = new Set(novas.map(e => e.id))
    const otimista: Comentario = { ...item, entidades: novas, revisado, rejeitadas,
      relacoes: (relacoes ?? item.relacoes).filter(r => ids.has(r.source) && ids.has(r.target)).map(r => ({ ...r, id: r.id ?? crypto.randomUUID().replaceAll('-', '') })) }
    // A marcação aparece no mesmo clique. Gravações seguem em ordem, com a versão confirmada pelo servidor.
    if (conjunto) setDetalhe(otimista)
    else {
      cache.update(otimista)
      setPagina(p => p ? { ...p, comentarios:p.comentarios.map(c => c.pos === item.pos ? otimista : c) } : p)
    }
    limparSelecao()
    if (manter) setMarca(novas.find(e => chaveMarcacao(e) === chaveMarcacao(manter)) ?? null)
    setErro('')
    setAviso('Salvando…')
    pendencias.current++
    setSalvando(true)
    const operacao = fila.current.then(async () => {
      if (falhaGravacao.current) return
      try {
        const dados = await api<{ comentario: Comentario; colecao: Colecao }>(
          apiColecao(id) + '/comentarios/' + item.pos + '?conjunto=' + encodeURIComponent(conjunto),
          json('PUT', { versao:versaoConfirmada.current ?? versao, entidades:novas,
            revisado, rejeitadas, relacoes:relacoes ? otimista.relacoes : undefined, ajuste }),
        )
        versaoConfirmada.current = dados.comentario.versao
        if (pendencias.current === 1) {
          receber(dados)
          setAviso(aviso)
        } else atualizar(dados.colecao)
        if (avancar) await avancarAposRevisao(item.pos, aviso)
      } catch (e) {
        falhaGravacao.current = true
        setErro(mensagem(e) + ' As alterações pendentes não foram confirmadas. Recarregue para conferir o que está salvo.')
        setAviso('')
      }
    }).finally(() => {
      pendencias.current--
      if (!pendencias.current) {
        versaoConfirmada.current = null
        setOcupado(false)
        setSalvando(false)
      }
    })
    fila.current = operacao
    await operacao
  }

  function aplicarTipo(tipo: string) {
    if (!item || edicaoBloqueada) return
    if (marca) {
      if (marca.tipo === tipo) return
      const editada = { ...marca, tipo }
      void salvar({ entidades: item.entidades.map(e => e.id === marca.id ? editada : e), aviso: 'Tipo atualizado.', manter: editada })
    } else if (trecho && !sobreposta) {
      const nova = { ...trecho, tipo }
      void salvar({ entidades: [...item.entidades, nova], aviso: 'Entidade salva.', manter: nova })
    }
  }

  async function excluir(posicao: number, span: string) {
    if (!id || navegacaoOcupada) return
    if (conjunto && item) {
      await salvar({ entidades: item.entidades.filter(e => e.id !== span), aviso: 'Marcação excluída.' })
      return
    }
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
    if (!id || navegacaoOcupada || !busca.trim()) return
    try {
      const dados = await api<{ pos: number }>(apiColecao(id) + '/por-id?' + new URLSearchParams({ id: busca.trim() }))
      ir(dados.pos)
    } catch (erro) { setErro(mensagem(erro)) }
  }

  async function pendente(revisao = filaRevisao) {
    if (!id || navegacaoOcupada) return
    setOcupado(true)
    try {
      const dados = await api<{ pos: number | null }>(apiColecao(id) + '/proximo?depois=' + (pos ?? 0) + '&revisao=' + revisao, { method: 'POST' })
      if (dados.pos === null) setAviso('Não há comentários disponíveis nesta fila.')
      else ir(dados.pos)
    } catch (erro) { setErro(mensagem(erro)) }
    finally { setOcupado(false) }
  }

  async function abrirProximoConjunto() {
    if (!id) return false
    const proximo = await api<{ pos: number; autor: string } | null>(apiColecao(id) + '/proximo-conjunto')
    if (!proximo) return false
    limparSelecao()
    setDetalhe(null)
    setEventos(null)
    setFeedback('')
    setDestino({ pos: proximo.pos })
    setConjunto(proximo.autor)
    setPos(proximo.pos)
    setAtualizacao(n => n + 1)
    return true
  }

  function confirmar() {
    if (!item || navegacaoOcupada || !podeConfirmar) return
    const aviso = item.revisado ? 'Comentário reaberto.' : 'Revisão concluída.'
    void salvar({ revisado: !item.revisado, avancar: !item.revisado, aviso })
  }

  async function filtrar(query: string, depois = 0) {
    if (!id) return
    setErro('')
    try { setResultados(await api<NonNullable<typeof resultados>>(apiColecao(id) + '/busca?' + query + '&depois=' + depois)) }
    catch (e) { setErro(mensagem(e)) }
  }

  useEffect(() => {
    function atalho(e: KeyboardEvent) {
      if (e.key === 'Enter' && e.ctrlKey && !e.metaKey && !e.repeat && podeConfirmar && !navegacaoOcupada &&
          !(e.target instanceof HTMLTextAreaElement) && !painel && !item?.revisado) {
        e.preventDefault()
        confirmar()
      }
    }
    window.addEventListener('keydown', atalho)
    return () => window.removeEventListener('keydown', atalho)
  })

  function localizarMarca(entidade: ItemAnotacao) {
    ir(entidade.pos)
    setMarca(entidade)
    setPainel(null)
  }

  function selecionarLinha(posicao: number) {
    if (navegacaoOcupada) return
    ativarLinha(posicao)
    limparSelecao()
  }

  function escolherMarca(e: Entidade, linha: ComentarioResumo) {
    if (ocupado || falhaGravacao.current || (salvando && linha.pos !== pos)) return
    ativarLinha(linha.pos)
    limparSelecao()
    setMarca(e)
  }

  if (!colecao) return <section className={s.panel}><h1>Bancada de anotação</h1><p>Prepare o acervo fixo para começar.</p><Button onClick={irParaColecoes}>Abrir coleções</Button></section>

  const grupos = <GruposAnotacao colecao={colecao.id} tipos={tipos} revisao={revisaoGrupos} selecionada={marca?.id} ocupado={navegacaoOcupada}
    localizar={localizarMarca} excluir={e => void excluir(e.pos, e.id)} embutido={compacto} />
  const rotuloRevisao = salvando ? 'Salvando…' : item?.revisado ? 'Reabrir revisão' :
    usuario?.papel === 'anotador' && conjunto ? 'Concluir conjunto' : 'Concluir e avançar'
  const falhou = falhaGravacao.current
  const acaoRevisao = falhou ? recarregar : confirmar
  const textoAcao = falhou ? 'Recarregar comentário' : rotuloRevisao
  const acaoBloqueada = falhou ? salvando : navegacaoOcupada || !podeConfirmar
  const inspetor = <Inspetor item={item} marca={marca} trecho={trecho} tipos={tipos} ocupado={edicaoBloqueada} salvando={salvando} restricao={restricao} sobreposta={!!sobreposta}
    aplicarTipo={aplicarTipo} excluir={span => { if (item) void excluir(item.pos, span) }}
    limpar={limparSelecao} escolher={e => { limparSelecao(); setMarca(e) }}
    salvarRelacoes={relacoes => salvar({ relacoes, aviso: 'Relações salvas.' })}
    revisar={acaoRevisao} revisaoBloqueada={acaoBloqueada}
    rotuloRevisao={textoAcao} />

  return (
    <div className={s.workbench}>
      <header className={s.benchHead}>
        <div><p>Área de trabalho</p><h1>Bancada de anotação</h1></div>
        <span>Selecione um trecho e escolha o tipo.</span>
      </header>
      <header className={s.toolbar}>
        <div className={s.collectionControl}>
          <label htmlFor="colecao-atual">Coleção</label>
          <select id="colecao-atual" value={colecao.id} disabled={navegacaoOcupada} onChange={evento => selecionar(evento.target.value)}>
            {colecoes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div className={s.progress}>
          <span><strong>{numero(colecao.revisados)}</strong> / {numero(total)} revisados</span>
          <progress value={colecao.revisados} max={total || 1} aria-label="Progresso da revisão" />
          <small>{numero(faltam)} pendentes</small>
        </div>
        {usuario?.papel !== 'anotador' && <div className={s.exportActions}>
          <a href={apiColecao(colecao.id) + '/anotacoes.jsonl'}><Icon name="download" width="16" height="16" /> Exportar JSONL</a>
          <a href={apiColecao(colecao.id) + '/anotacoes.csv'}><Icon name="download" width="16" height="16" /> Exportar CSV</a>
        </div>}
        {usuario?.papel !== 'anotador' && <details className={s.exportMenu}>
          <summary><Icon name="download" width="16" height="16" /> Exportar</summary>
          <div>
            <a href={apiColecao(colecao.id) + '/anotacoes.jsonl'}>Anotações em JSONL</a>
            <a href={apiColecao(colecao.id) + '/anotacoes.csv'}>Anotações em CSV</a>
          </div>
        </details>}
      </header>

      {(erro || (!compacto && aviso)) && <div className={erro ? s.error : s.notice} role={erro ? 'alert' : 'status'}>
        {!erro && <Icon name="check" width="18" height="18" />}{erro || aviso}
        {erro && <button type="button" onClick={recarregar}>Recarregar</button>}
      </div>}

      <div className={s.columns}>
        {!compacto && (conjunto ? <aside className={s.layers}><h2>Anotação independente</h2><p className={s.help}>As marcações deste conjunto não alteram a anotação principal.</p></aside> : grupos)}

        <section className={s.document} aria-label="Comentários da coleção">
          <div className={s.docHeader}>
            <div className={s.group}>
              <button type="button" aria-label="Primeira página" disabled={navegacaoOcupada || inicio === null || inicio <= 1} onClick={() => ir(1)}><Icon name="first" width="17" height="17" /></button>
              <button type="button" aria-label="Página anterior" disabled={navegacaoOcupada || inicio === null || inicio <= 1} onClick={() => ir(Math.max(1, (inicio ?? 1) - TAMANHO))}><Icon name="left" width="17" height="17" /></button>
              <span className={s.counter}>{inicio && total ? numero(inicio) + '–' + numero(Math.min(total, inicio + TAMANHO - 1)) : '0'} / {numero(total)}</span>
              <button type="button" aria-label="Próxima página" disabled={navegacaoOcupada || inicio === null || inicio + TAMANHO > total} onClick={() => ir((inicio ?? 1) + TAMANHO)}><Icon name="right" width="17" height="17" /></button>
              <button type="button" aria-label="Última página" disabled={navegacaoOcupada || inicio === null || inicio + TAMANHO > total} onClick={() => ir(Math.floor((total - 1) / TAMANHO) * TAMANHO + 1)}><Icon name="last" width="17" height="17" /></button>
            </div>
            <form className={s.group} onSubmit={evento => void localizar(evento)}>
              <input aria-label="Buscar ID do comentário" placeholder="Buscar ID" value={busca} onChange={e => setBusca(e.target.value)} />
              <button type="submit" disabled={!busca.trim() || navegacaoOcupada}>Ir ao ID</button>
            </form>
            <button type="button" disabled={!faltam || navegacaoOcupada} onClick={() => void pendente()}>{filaRevisao ? 'Próximo para aprovar' : 'Próximo pendente'}</button>
            {usuario && usuario.papel !== 'anotador' && <button type="button" aria-pressed={filaRevisao} disabled={navegacaoOcupada}
              onClick={() => { setFilaRevisao(!filaRevisao); void pendente(!filaRevisao) }}>{filaRevisao ? 'Voltar à anotação' : 'Fila de revisão'}</button>}
            {usuario && usuario.papel !== 'anotador' && <button type="button" disabled={navegacaoOcupada} onClick={() => {
              setErro('')
              void abrirProximoConjunto().then(abriu => setAviso(abriu ? '' : 'Nenhum conjunto independente aguardando revisão.')).catch(e => setErro(mensagem(e)))
            }}>Revisar conjuntos</button>}
          </div>
          <details className={s.docHeader}>
            <summary>Buscar e filtrar no acervo</summary>
            <form className={s.group} onSubmit={e => {
              e.preventDefault()
              const query = new URLSearchParams()
              new FormData(e.currentTarget).forEach((v, k) => { if (String(v).trim()) query.set(k, String(v).trim()) })
              setFiltros(query.toString()); void filtrar(query.toString())
            }}>
              <input name="texto" aria-label="Texto do comentário" placeholder="Texto" maxLength={200} />
              <select name="tipo" aria-label="Filtrar por rótulo"><option value="">Todos os rótulos</option>{tipos.map(t => <option key={t.codigo}>{t.codigo}</option>)}</select>
              {usuario && <><input name="autor" aria-label="Anotador" placeholder="Login do anotador" maxLength={100} />
                <select name="estado" aria-label="Etapa da anotação"><option value="">Todas as etapas</option>
                  <option value="pendente">Pendente</option><option value="rascunho">Em andamento</option>
                  <option value="enviado">Aguardando revisão</option><option value="ajuste">Precisa de ajuste</option><option value="revisado">Revisado</option></select></>}
              <Button type="submit" variant="secondary">Buscar</Button>
            </form>
            {usuario && usuario.papel !== 'anotador' && <div className={s.group}>
              <a href={apiColecao(colecao.id) + '/exportar?formato=jsonl&' + filtros}>Exportar JSONL com estes filtros</a>
              <a href={apiColecao(colecao.id) + '/exportar?formato=csv&' + filtros}>Exportar CSV com estes filtros</a>
            </div>}
            {resultados && <div><p>{resultados.itens.length ? 'Selecione um resultado para abrir o comentário.' : 'Nenhum resultado.'}</p>
              <ul>{resultados.itens.map(r => <li key={r.pos}><button type="button" disabled={navegacaoOcupada} onClick={() => ir(r.pos)}>{r.id} · {r.texto.slice(0, 130)}</button></li>)}</ul>
              {resultados.proximo !== null && <Button variant="secondary" onClick={() => void filtrar(filtros, resultados.proximo!)}>Mais resultados</Button>}</div>}
          </details>
          {usuario && pos !== null && <div className={s.docHeader}>
            <label htmlFor="conjunto">Conjunto de anotações</label>
            <select id="conjunto" value={conjunto} disabled={navegacaoOcupada} onChange={e => {
              setDetalhe(null); limparSelecao(); setConjunto(e.target.value); setEventos(null); setAviso('')
            }}>
              <option value="">Principal</option><option value={usuario.login}>Minha anotação independente</option>
              {opcoesConjuntos.filter(o => o.autor !== usuario.login).map(o => <option key={o.autor} value={o.autor}>{o.autor} · {o.estado}</option>)}
            </select>
            {usuario.papel !== 'anotador' && <Button variant="secondary" onClick={() => {
              if (eventos) return setEventos(null)
              void api<NonNullable<typeof eventos>>(apiColecao(colecao.id) + '/comentarios/' + pos + '/historico')
                .then(setEventos).catch(e => setErro(mensagem(e)))
            }}>{eventos ? 'Fechar histórico' : 'Histórico'}</Button>}
            {eventos && <ul>{eventos.filter(e => (e.conjunto || '') === conjunto).map((e,i) => <li key={i}>
              {e.ator} · {e.acao} · v{e.anterior.versao} · {new Date(e.criado_em).toLocaleString('pt-BR')}
              {e.anterior.feedback && <p>{e.anterior.feedback}</p>}
              {e.anterior.entidades?.length > 0 && <p>{e.anterior.entidades.map(a => a.tipo + ': ' + a.texto).join(' · ')}</p>}
            </li>)}</ul>}
          </div>}
          {item && (!compacto || usuario) && <div className={s.docHeader}>
            <span className={s.help}>{item.autor ? 'Anotação de ' + item.autor + ' · ' : ''}{item.estado === 'enviado' ? 'Aguardando revisão' : item.feedback || (restricao || aviso || (item.revisado ? 'Revisão concluída' : 'Ctrl + Enter para concluir'))}</span>
            {item.estado === 'enviado' && usuario && usuario.papel !== 'anotador' && <>
              <input aria-label="Ajuste solicitado" placeholder="Descreva o ajuste" maxLength={1000} value={feedback} onChange={e => setFeedback(e.target.value)} />
              <Button variant="secondary" disabled={navegacaoOcupada || !feedback.trim()} onClick={() => {
                void salvar({ ajuste: feedback.trim(), avancar: true, aviso: 'Ajuste solicitado.' })
                setFeedback('')
              }}>Pedir ajuste</Button>
            </>}
          </div>}
          {total === 0 ? <p className={s.help}>Nenhum comentário com texto nesta coleção.</p> : linhas.length === 0 ? <p className={s.help} role="status">Abrindo comentários…</p> : (
            <ol className={s.rows} start={inicio ?? 1} onPointerUp={e => {
              const selecao = window.getSelection()
              if (!selecao?.rangeCount || selecao.isCollapsed) return
              const intervalo = selecao.getRangeAt(0)
              const origem = intervalo.startContainer.parentElement?.closest('li')
              if (origem && e.currentTarget.contains(origem) && !origem.contains(intervalo.endContainer)) limparSelecao()
            }}>
              {linhas.map(linha => {
                const atual = item?.pos === linha.pos ? item : linha
                return <li key={linha.id} className={pos === linha.pos ? s.activeRow : undefined}
                  onClick={evento => {
                    const alvo = evento.target as Element
                    if (alvo.closest('button, mark')) return
                    const texto = alvo.closest<HTMLElement>('[data-comentario-pos]')
                    if (texto && lerTrecho(texto)) return
                    selecionarLinha(linha.pos)
                  }}>
                  <button className={s.rowNumber} type="button" aria-current={pos === linha.pos ? 'true' : undefined} disabled={navegacaoOcupada}
                    title={linha.id} aria-label={'Selecionar comentário ' + linha.id} onClick={() => selecionarLinha(linha.pos)}>
                    {numero(linha.pos)}<span aria-label={atual.revisado ? 'Revisado' : 'Pendente'}>{atual.revisado ? '✓' : '·'}</span>
                  </button>
                  <div className={s.rowContent}>
                    <span className={s.rowId}>ID {linha.id}
                      {atual.autor && ['rascunho', 'ajuste'].includes(atual.estado ?? '') &&
                        <strong> · {atual.autor === usuario?.login ? 'Reservado para você' : 'Reservado para ' + atual.autor}</strong>}
                    </span>
                    <p tabIndex={0} aria-label={'Texto do comentário ' + linha.id} data-comentario-pos={linha.pos}
                      onPointerUp={e => { if (!ocupado) capturar(e.currentTarget, linha.pos) }}
                      onKeyDown={e => {
                        if (e.target !== e.currentTarget || e.ctrlKey || e.metaKey) return
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          selecionarLinha(linha.pos)
                        } else if (e.key === 'Escape') limparSelecao()
                      }}
                      onKeyUp={e => {
                        if (ocupado || e.target !== e.currentTarget) return
                        if (e.shiftKey) capturar(e.currentTarget, linha.pos)
                        if (trecho && linha.pos === pos && /^(Arrow(Left|Right|Up|Down)|Home|End)$/.test(e.key)
                            && (!e.shiftKey || window.getSelection()?.isCollapsed)) limparSelecao()
                      }}>
                      <TextoMarcado texto={linha.texto} entidades={conjunto && item?.pos !== linha.pos ? [] : atual.entidades} porCodigo={porCodigo}
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
          <EntityPicker tipos={tipos} ativo={marca?.tipo} bloqueado={!item || edicaoBloqueada || !!sobreposta} escolher={aplicarTipo} />
        </div>}
        {!marca && !trecho && item && <div className={s.dockContext} role="status">
          <strong>Comentário {numero(item.pos)}</strong><span>{falhou ? 'Falha ao salvar' : restricao || aviso}</span>
        </div>}
        <div className={s.dockActions}>
          <Button disabled={acaoBloqueada} onClick={acaoRevisao}>{textoAcao}</Button>
          {!conjunto && <Button variant="secondary" onClick={() => setPainel('grupos')}><Icon name="list" width="17" height="17" /> Marcações</Button>}
          <Button variant="secondary" aria-label="Detalhes do trecho" disabled={!item} onClick={() => setPainel('detalhes')}><Icon name="more" width="17" height="17" /> Detalhes</Button>
        </div>
      </div>}
      {compacto && painel === 'grupos' && <Dialog title="Marcações da coleção" sheet close={() => setPainel(null)}>{grupos}</Dialog>}
      {compacto && painel === 'detalhes' && <Dialog title="Trecho selecionado" sheet close={() => setPainel(null)}>{inspetor}</Dialog>}
    </div>
  )
}

function motivoSomenteLeitura(item: Comentario | null, usuario: Usuario | null) {
  if (!item || !usuario || usuario.papel === 'admin') return ''
  const deOutro = !!item.autor && item.autor !== usuario.login
  const finalizado = item.estado === 'enviado' || item.revisado
  if (item.revisado) return ''
  if (deOutro && (usuario.papel === 'anotador' || !finalizado)) return 'Somente leitura. Comentário reservado a ' + item.autor + '.'
  return ''
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
          style={{ '--tag': porCodigo.get(e.tipo)?.cor ?? '#537270' } as CSSProperties} onClick={evento => {
            const texto = evento.currentTarget.closest<HTMLElement>('[data-comentario-pos]')
            if (!texto || !lerTrecho(texto)) escolher(e)
          }}
          onKeyDown={evento => {
            if (!evento.ctrlKey && !evento.metaKey && (evento.key === 'Enter' || evento.key === ' ')) {
              evento.preventDefault()
              escolher(e)
            }
          }}>{e.texto}</mark>
    </span>)}
    {caracteres.slice(entidades.at(-1)?.fim ?? 0).join('')}
  </>
}
