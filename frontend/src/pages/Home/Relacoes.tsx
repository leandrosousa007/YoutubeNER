import { useState, type FormEvent } from 'react'
import { Button } from '../../components/Button/Button'
import type { Entidade, NovaRelacao, Relacao } from '../../features/anotacao/api'
import s from './Workbench.module.css'

type Props = {
  entidades: Entidade[]
  relacoes: Relacao[]
  origem?: string
  ocupado: boolean
  salvar: (itens: NovaRelacao[]) => Promise<void>
}

export function Relacoes({ entidades, relacoes, origem, ocupado, salvar }: Props) {
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const [label, setLabel] = useState('')
  const [aberto, setAberto] = useState(false)
  const textos = new Map(entidades.map(e => [e.id, e.texto]))
  const origemAtual = textos.has(source) ? source : origem ?? ''
  const destinoAtual = textos.has(target) && target !== origemAtual ? target : ''

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (!origemAtual || !destinoAtual || !label.trim()) return
    void salvar([...relacoes, { source: origemAtual, target: destinoAtual, label: label.trim() }])
  }

  return (
    <section className={s.inspectorSection}>
      <h3>Relações ({relacoes.length})</h3>
      {relacoes.length > 0 && <ul className={s.inspectList}>{relacoes.map(r => (
        <li key={r.id}>
          <strong>{r.label}</strong><small>{textos.get(r.source)} → {textos.get(r.target)}</small>
          <button type="button" disabled={ocupado} aria-label={'Remover relação ' + r.label}
            onClick={() => void salvar(relacoes.filter(item => item.id !== r.id))}>Remover relação</button>
        </li>
      ))}</ul>}
      {entidades.length < 2 ? <p className={s.help}>Marque dois trechos para criar uma relação.</p> : (
        <details open={aberto} onToggle={e => setAberto(e.currentTarget.open)}>
          <summary>Nova relação</summary>
          <form className={s.relationForm} onSubmit={enviar}>
            <label htmlFor="relacao-origem">Origem</label>
            <select id="relacao-origem" value={origemAtual} required onChange={e => setSource(e.target.value)}>
              <option value="">Selecione o trecho</option>
              {entidades.map(e => <option key={e.id} value={e.id}>{e.texto} ({e.tipo}, {e.inicio})</option>)}
            </select>
            <label htmlFor="relacao-destino">Destino</label>
            <select id="relacao-destino" value={destinoAtual} required onChange={e => setTarget(e.target.value)}>
              <option value="">Selecione o trecho</option>
              {entidades.filter(e => e.id !== origemAtual).map(e => <option key={e.id} value={e.id}>{e.texto} ({e.tipo}, {e.inicio})</option>)}
            </select>
            <label htmlFor="relacao-tipo">Tipo da relação</label>
            <input id="relacao-tipo" value={label} maxLength={70} required placeholder="Ex.: PRATICA" onChange={e => setLabel(e.target.value)} />
            <Button type="submit" disabled={ocupado || !origemAtual || !destinoAtual || !label.trim()}>Vincular trechos</Button>
          </form>
        </details>
      )}
    </section>
  )
}
