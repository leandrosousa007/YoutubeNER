import { useEffect, useState, type CSSProperties } from 'react'
import { api, apiColecao, mensagem, type Grupo, type ItemAnotacao, type Tipo } from '../../features/anotacao/api'
import s from './Workbench.module.css'

type Props = {
  colecao: string
  tipos: Tipo[]
  revisao: number
  selecionada?: string
  ocupado: boolean
  embutido?: boolean
  localizar: (item: ItemAnotacao) => void
  excluir: (item: ItemAnotacao) => void
}

const TAMANHO = 20

export function GruposAnotacao({ colecao, tipos, revisao, selecionada, ocupado, embutido, localizar, excluir }: Props) {
  const [grupos, setGrupos] = useState<Grupo[]>([])
  const [escolha, setEscolha] = useState<{ tipo: string; pagina: number } | null>(null)
  const [resultado, setResultado] = useState<{ tipo: string; pagina: number; itens: ItemAnotacao[] } | null>(null)
  const [erro, setErro] = useState('')
  const [filtro, setFiltro] = useState('')
  const aberto = escolha?.tipo ?? ''
  const pagina = escolha?.pagina ?? 1
  const contagens = new Map(grupos.map(g => [g.tipo, g.total]))
  const known = new Set(tipos.map(tipo => tipo.codigo))
  const anteriores = grupos.filter(g => !known.has(g.tipo)).map(g => ({ codigo: g.tipo, nome: 'Marcação anterior', cor: '#70798a' }))
  const entradas = [...tipos, ...anteriores].filter(t => (t.codigo + ' ' + t.nome).toLowerCase().includes(filtro.trim().toLowerCase()))

  useEffect(() => {
    const controller = new AbortController()
    api<Grupo[]>(apiColecao(colecao) + '/anotacoes/grupos', { signal: controller.signal })
      .then(dados => {
        if (controller.signal.aborted) return
        setGrupos(dados)
        if (dados[0]) setEscolha(atual => atual ?? { tipo: dados[0].tipo, pagina: 1 })
      })
      .catch(erro => { if (!controller.signal.aborted) setErro(mensagem(erro)) })
    return () => controller.abort()
  }, [colecao, revisao])

  useEffect(() => {
    if (!aberto) return
    const controller = new AbortController()
    const query = new URLSearchParams({ tipo: aberto, pagina: String(pagina), tamanho: String(TAMANHO) })
    api<ItemAnotacao[]>(apiColecao(colecao) + '/anotacoes/itens?' + query, { signal: controller.signal })
      .then(itens => {
        if (controller.signal.aborted) return
        if (!itens.length && pagina > 1) setEscolha({ tipo: aberto, pagina: pagina - 1 })
        else { setResultado({ tipo: aberto, pagina, itens }); setErro('') }
      })
      .catch(erro => { if (!controller.signal.aborted) setErro(mensagem(erro)) })
    return () => controller.abort()
  }, [colecao, aberto, pagina, revisao])

  return (
    <aside className={embutido ? s.embeddedLayers : s.layers} aria-label="Marcações">
      {!embutido && <h2>Marcações</h2>}
      <div className={s.layerName}>Agrupadas por entidade <span>{grupos.reduce((n, g) => n + g.total, 0).toLocaleString('pt-BR')}</span></div>
      <div className={s.groupSearch}><input aria-label="Filtrar tipos marcados" placeholder="Buscar tipo" value={filtro} onChange={e => setFiltro(e.target.value)} /></div>
      {erro && <p className={s.help} role="alert">{erro}</p>}
      <ul className={s.typeList}>{entradas.map(t => {
        const total = contagens.get(t.codigo) ?? 0
        const abertoAqui = aberto === t.codigo
        const itens = resultado?.tipo === aberto && resultado.pagina === pagina ? resultado.itens : null
        return <li key={t.codigo}>
          <button type="button" className={s.groupLabel} aria-expanded={abertoAqui}
            onClick={() => setEscolha({ tipo: abertoAqui ? '' : t.codigo, pagina: 1 })}>
            <span className={s.disclosure} aria-hidden="true">{abertoAqui ? '⌄' : '›'}</span>
            <span className={s.dot} style={{ '--tag': t.cor } as CSSProperties} />
            <span>{t.codigo}</span><span className={s.badge}>{total.toLocaleString('pt-BR')}</span>
          </button>
          {abertoAqui && <div className={s.groupItems}>
            {total === 0 ? <p className={s.help}>Nenhum trecho marcado.</p> : itens === null ? <p className={s.help}>Carregando…</p> : (
              <ul className={s.groupEntries}>{itens.map(item => (
                <li key={item.id} className={item.id === selecionada ? s.entryActive : undefined}>
                  <button type="button" className={s.entryText} disabled={ocupado} onClick={() => localizar(item)}>
                    <strong title={item.texto}>{item.texto}</strong><small>ID {item.comentario_id}</small>
                  </button>
                  <button type="button" className={s.entryRemove} aria-label={'Excluir marcação ' + item.texto + ' do comentário ' + item.comentario_id}
                    title="Excluir marcação" disabled={ocupado} onClick={() => excluir(item)}>×</button>
                </li>
              ))}</ul>
            )}
            {total > TAMANHO && <div className={s.groupPages}>
              <button type="button" aria-label="Página anterior do grupo" disabled={pagina <= 1} onClick={() => setEscolha({ tipo: aberto, pagina: pagina - 1 })}>‹</button>
              <span>{pagina} / {Math.ceil(total / TAMANHO)}</span>
              <button type="button" aria-label="Próxima página do grupo" disabled={pagina * TAMANHO >= total} onClick={() => setEscolha({ tipo: aberto, pagina: pagina + 1 })}>›</button>
            </div>}
          </div>}
        </li>
      })}</ul>
      {entradas.length === 0 && <p className={s.help}>Nenhum tipo encontrado.</p>}
    </aside>
  )
}
