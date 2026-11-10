import type { CSSProperties } from 'react'
import { Button } from '../../components/Button/Button'
import { Icon } from '../../components/Icon/Icon'
import type { Comentario, Entidade, NovaRelacao, Tipo } from '../../features/anotacao/api'
import { Relacoes } from './Relacoes'
import s from './Workbench.module.css'

export type Trecho = Omit<Entidade, 'tipo' | 'id'>
type Props = {
  item: Comentario | null
  marca: Entidade | null
  trecho: Trecho | null
  tipos: Tipo[]
  sobreposta: boolean
  ocupado: boolean
  aplicarTipo: (tipo: string) => void
  excluir: (span: string) => void
  limpar: () => void
  escolher: (entidade: Entidade) => void
  salvarRelacoes: (relacoes: NovaRelacao[]) => Promise<void>
  revisar: () => void
}

export function Inspetor({ item, marca, trecho, tipos, sobreposta, ocupado, aplicarTipo, excluir, limpar, escolher, salvarRelacoes, revisar }: Props) {
  if (!item) return <p className={s.help}>Selecione um comentário para ver os detalhes.</p>
  const selecao = marca ?? trecho
  return (
    <div className={s.inspectBody}>
      <div className={s.meta}><span>Comentário <strong>{item.id}</strong></span><span className={item.revisado ? s.done : s.pending}>{item.revisado ? 'Revisado' : 'Pendente'}</span></div>
      <div className={s.spanText}>
        {selecao ? <><p>{selecao.texto}</p><small>Início: {selecao.inicio} · Fim exclusivo: {selecao.fim}</small></> :
          <p className={s.help}>Selecione um trecho no texto ou clique em uma marcação.</p>}
      </div>
      {sobreposta && <p className={s.help}>O trecho sobrepõe outra marcação.</p>}
      {selecao && <div className={s.group}>
        {marca && <Button variant="danger" disabled={ocupado} onClick={() => excluir(marca.id)}>Excluir marcação</Button>}
        <Button variant="secondary" onClick={limpar}>Limpar</Button>
      </div>}
      {selecao && <section className={s.inspectorSection} aria-labelledby="tipos-disponiveis">
        <h3 id="tipos-disponiveis">{marca ? 'Alterar tipo' : 'Escolha o tipo para marcar'}</h3>
        {!tipos.length ? <p className={s.help}>Crie ou restaure um tipo na aba Entidades.</p> : <ul className={s.palette}>{tipos.map(t => <li key={t.codigo}>
          <button type="button" aria-pressed={marca?.tipo === t.codigo} title={t.descricao}
            disabled={ocupado || sobreposta} onClick={() => aplicarTipo(t.codigo)}>
            <span className={s.dot} style={{ '--tag': t.cor } as CSSProperties} />
            <strong>{t.codigo}</strong><small>{t.nome}</small>
          </button>
        </li>)}</ul>}
      </section>}
      <section className={s.inspectorSection}>
        <h3>Marcações neste comentário <span>{item.entidades.length}</span></h3>
        {!item.entidades.length ? <p className={s.help}>Ainda não há marcações.</p> : <ul className={s.inspectList}>
          {item.entidades.map(e => <li key={e.id}>
            <button type="button" onClick={() => escolher(e)}><span>{e.texto}</span><small>{e.tipo} · {e.inicio}–{e.fim}</small></button>
          </li>)}
        </ul>}
      </section>
      <Relacoes key={item.id} entidades={item.entidades} relacoes={item.relacoes} origem={marca?.id} ocupado={ocupado} salvar={salvarRelacoes} />
      <div className={s.inspectorSection}>
        <Button variant="secondary" disabled={ocupado} onClick={revisar}><Icon name={item.revisado ? 'refresh' : 'check'} width="16" height="16" />
          {item.revisado ? 'Reabrir revisão' : 'Concluir revisão'}</Button>
      </div>
    </div>
  )
}
