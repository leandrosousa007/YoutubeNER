import { EntityPicker } from './EntityPicker'
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
  salvando: boolean
  restricao: string
  sobreposta: boolean
  ocupado: boolean
  aplicarTipo: (tipo: string) => void
  excluir: (span: string) => void
  limpar: () => void
  escolher: (entidade: Entidade) => void
  salvarRelacoes: (relacoes: NovaRelacao[]) => Promise<void>
  revisaoBloqueada: boolean
  rotuloRevisao: string
  revisar: () => void
}

export function Inspetor({ item, marca, trecho, tipos, sobreposta, ocupado, salvando, restricao, aplicarTipo, excluir, limpar, escolher, salvarRelacoes, revisar, revisaoBloqueada, rotuloRevisao }: Props) {
  if (!item) return <p className={s.help}>Selecione um comentário para ver os detalhes.</p>
  const selecao = marca ?? trecho
  return (
    <div className={s.inspectBody}>
      <div className={s.reviewTop}>
        <Button disabled={revisaoBloqueada} onClick={revisar}>
          <Icon name={item.revisado ? 'refresh' : 'check'} width="16" height="16" />{rotuloRevisao}
        </Button>
      </div>
      {restricao && <p className={s.help}>{restricao}</p>}
      {selecao && <section aria-label="Tipos de entidade">
        <EntityPicker tipos={tipos} ativo={marca?.tipo} bloqueado={ocupado || sobreposta} escolher={aplicarTipo} />
      </section>}
      <div className={s.meta}><span>Comentário <strong>{item.id}</strong></span><span className={item.revisado ? s.done : s.pending}>{item.revisado ? 'Revisado' : 'Pendente'}</span></div>
      <div className={s.spanText}>
        {selecao ? <><p>{selecao.texto}</p><small>Início: {selecao.inicio} · Fim exclusivo: {selecao.fim}</small></> :
          <p className={s.help}>Selecione um trecho no texto ou clique em uma marcação.</p>}
      </div>
      {sobreposta && <p className={s.help}>O trecho sobrepõe outra marcação.</p>}
      {selecao && <div className={s.group}>
        {marca && <Button variant="danger" disabled={ocupado || salvando} onClick={() => excluir(marca.id)}>Excluir marcação</Button>}
        <Button variant="secondary" onClick={limpar}>Limpar</Button>
      </div>}

      <section className={s.inspectorSection}>
        <h3>Marcações neste comentário <span>{item.entidades.length}</span></h3>
        {!item.entidades.length ? <p className={s.help}>Ainda não há marcações.</p> : <ul className={s.inspectList}>
          {item.entidades.map(e => <li key={e.id}>
            <button type="button" onClick={() => escolher(e)}><span>{e.texto}</span><small>{e.tipo} · {e.inicio}–{e.fim}</small></button>
          </li>)}
        </ul>}
      </section>
      <Relacoes key={item.id} entidades={item.entidades} relacoes={item.relacoes} origem={marca?.id} ocupado={ocupado} salvar={salvarRelacoes} />

    </div>
  )
}
