import { useEffect, useState, type CSSProperties } from 'react'
import type { Tipo } from '../../features/anotacao/api'
import { Icon } from '../../components/Icon/Icon'
import s from './EntityPicker.module.css'

type Props = { tipos: Tipo[]; ativo?: string; bloqueado: boolean; escolher: (codigo: string) => void }

function capacidade() {
  if (window.innerHeight < 520) return 6
  if (window.innerWidth <= 880 || window.innerHeight < 760) return 9
  return window.innerHeight < 900 ? 18 : 27
}

export function EntityPicker({ tipos, ativo, bloqueado, escolher }: Props) {
  const [busca, setBusca] = useState('')
  const [pagina, setPagina] = useState(0)
  const [limite, setLimite] = useState(capacidade)
  useEffect(() => {
    const ajustar = () => setLimite(capacidade())
    window.addEventListener('resize', ajustar)
    return () => window.removeEventListener('resize', ajustar)
  }, [])
  const normalizar = (texto: string) => texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const termo = normalizar(busca.trim())
  const opcoes = tipos.filter(t => normalizar(t.codigo + ' ' + t.nome).includes(termo))
  const paginas = Math.ceil(opcoes.length / limite)
  const atual = Math.min(pagina, Math.max(0, paginas - 1))
  return <div className={s.picker}>
    <div className={s.controls}>
      <label className={s.search}><Icon name="search" width="14" height="14" />
        <input aria-label="Buscar entidade por código ou nome" placeholder="Buscar entidade" type="search" value={busca}
          onChange={e => { setBusca(e.target.value); setPagina(0) }} /></label>
      {paginas > 1 && <div className={s.pages}>
        <button type="button" aria-label="Tipos anteriores" disabled={!atual} onClick={() => setPagina(atual - 1)}>‹</button>
        <small aria-live="polite">{atual + 1}/{paginas}</small>
        <button type="button" aria-label="Próximos tipos" disabled={atual + 1 >= paginas} onClick={() => setPagina(atual + 1)}>›</button>
      </div>}
    </div>
    {!opcoes.length && <p role="status">Nenhuma entidade encontrada.</p>}
    <div className={s.grid}>{opcoes.slice(atual * limite, (atual + 1) * limite).map(t =>
      <button type="button" className={s.chip} key={t.codigo} aria-label={t.codigo + ' · ' + t.nome}
        title={t.nome + (t.descricao ? ' — ' + t.descricao : '')} style={{ '--swatch': t.cor } as CSSProperties}
        aria-pressed={ativo === t.codigo} disabled={bloqueado} onClick={() => escolher(t.codigo)}>
        {t.codigo}
      </button>)}</div>
  </div>
}
