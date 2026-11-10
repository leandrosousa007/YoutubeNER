import { useState, type CSSProperties, type FormEvent } from 'react'
import { Button } from '../../components/Button/Button'
import { Dialog } from '../../components/Dialog/Dialog'
import { Icon } from '../../components/Icon/Icon'
import { api, json, mensagem, type Catalogo, type Tipo } from '../../features/anotacao/api'
import s from './Pesquisa.module.css'

type Props = { catalogo: Catalogo; atualizar: (catalogo: Catalogo) => void }
const inicial = { codigo: '', nome: '', cor: '#2866b3', descricao: '' }

export function Entidades({ catalogo, atualizar }: Props) {
  const [filtro, setFiltro] = useState('')
  const [vista, setVista] = useState<'ativos' | 'removidos'>('ativos')
  const [criando, setCriando] = useState(false)
  const [excluindo, setExcluindo] = useState<Tipo | null>(null)
  const [tipo, setTipo] = useState(inicial)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const removidos = catalogo.removidos ?? []
  const pesquisa = filtro.trim().toLocaleLowerCase('pt-BR')
  const lista = (vista === 'ativos' ? catalogo.tipos : removidos)
    .filter(t => (t.codigo + ' ' + t.nome + ' ' + t.descricao).toLocaleLowerCase('pt-BR').includes(pesquisa))

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (ocupado) return
    setOcupado(true)
    setErro('')
    try {
      atualizar(await api<Catalogo>('/api/entidades', json('POST', { ...tipo, nome: tipo.nome.trim() })))
      setAviso(tipo.codigo + ' adicionado ao catálogo.')
      setFiltro('')
      setVista('ativos')
      setCriando(false)
    } catch (erro) { setErro(mensagem(erro)) }
    finally { setOcupado(false) }
  }

  async function mudar(item: Tipo, restaurar: boolean) {
    if (ocupado) return
    setOcupado(true)
    setErro('')
    try {
      const url = '/api/entidades/' + encodeURIComponent(item.codigo)
      atualizar(await api<Catalogo>(restaurar ? url + '/restaurar' : url, { method: restaurar ? 'POST' : 'DELETE' }))
      setAviso(item.codigo + (restaurar ? ' voltou à lista de marcação.' : ' foi retirado da lista de marcação.'))
      setExcluindo(null)
    } catch (erro) { setErro(mensagem(erro)) }
    finally { setOcupado(false) }
  }

  function abrirCriacao() {
    setTipo(inicial)
    setErro('')
    setAviso('')
    setCriando(true)
  }

  return <>
    <header className={s.pageHead}>
      <div><p className={s.eyebrow}>Catálogo de anotação</p><h1>Entidades</h1><p className={s.lead}>Organize os tipos que aparecem quando você seleciona um trecho.</p></div>
      <Button onClick={abrirCriacao}><Icon name="plus" width="17" height="17" />Nova entidade</Button>
    </header>
    <div className={s.catalogBar}>
      <div className={s.segmented} aria-label="Exibir tipos de entidade">
        <button type="button" aria-pressed={vista === 'ativos'} onClick={() => setVista('ativos')}>Ativos <span>{catalogo.tipos.length}</span></button>
        <button type="button" aria-pressed={vista === 'removidos'} onClick={() => setVista('removidos')}>Removidos <span>{removidos.length}</span></button>
      </div>
      <label className={s.search}><Icon name="search" width="17" height="17" />
        <input type="search" aria-label="Buscar entidade" placeholder="Buscar entidade" value={filtro} onChange={e => setFiltro(e.target.value)} />
      </label>
    </div>
    {aviso && <p className={s.notice} role="status">{aviso}</p>}
    {erro && !criando && !excluindo && <p className={s.alert} role="alert">{erro}</p>}
    {lista.length ? <ul className={s.catalogo}>{lista.map(item => <li key={item.codigo} className={s.entityCard}>
      <div className={s.entityIdentity}>
        <span className={s.swatch} style={{ '--entity-color': item.cor } as CSSProperties} />
        <div><h2>{item.nome}</h2><code>{item.codigo}</code></div>
      </div>
      <p>{item.descricao || 'Sem descrição.'}</p>
      <div className={s.entityActions}>
        {vista === 'ativos' ? <Button variant="secondary" aria-label={'Excluir tipo ' + item.codigo} disabled={ocupado}
          onClick={() => { setErro(''); setAviso(''); setExcluindo(item) }}>Excluir</Button>
          : <Button variant="secondary" aria-label={'Restaurar tipo ' + item.codigo} disabled={ocupado}
            onClick={() => void mudar(item, true)}>Restaurar</Button>}
      </div>
    </li>)}</ul> : <div className={s.empty}><Icon name="tag" /><strong>{pesquisa ? 'Nenhuma entidade encontrada' : vista === 'ativos' ? 'Nenhuma entidade ativa' : 'Nenhum tipo removido'}</strong>
      <span>{pesquisa ? 'Tente outro nome ou código.' : vista === 'ativos' ? 'Crie uma entidade para começar a marcar.' : 'Os tipos retirados do catálogo aparecem aqui.'}</span></div>}
    {criando && <Dialog title="Nova entidade" description="O código identifica esse tipo nas anotações e exportações." close={() => setCriando(false)} busy={ocupado}>
      <form className={s.entityForm} onSubmit={evento => void salvar(evento)}>
        <label>Nome<input data-dialog-autofocus required maxLength={60} value={tipo.nome} placeholder="Ex.: Equipamento" onChange={e => setTipo({ ...tipo, nome: e.target.value })} /></label>
        <label>Código<input required pattern="[A-Z][A-Z0-9_]{0,23}" maxLength={24} value={tipo.codigo} placeholder="Ex.: EQUIPAMENTO" spellCheck={false}
          onChange={e => setTipo({ ...tipo, codigo: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} /><small>Use até 24 caracteres: letras, números ou _. Comece com uma letra.</small></label>
        <label>Cor da marcação<span className={s.colorControl}><input type="color" value={tipo.cor} onChange={e => setTipo({ ...tipo, cor: e.target.value })} /><code>{tipo.cor}</code></span></label>
        <label>Descrição <small>(opcional)</small><textarea rows={3} maxLength={200} value={tipo.descricao} placeholder="Quando usar esse tipo?" onChange={e => setTipo({ ...tipo, descricao: e.target.value })} /></label>
        {erro && <p className={s.alert} role="alert">{erro}</p>}
        <div className={s.dialogActions}><Button variant="secondary" disabled={ocupado} onClick={() => setCriando(false)}>Cancelar</Button>
          <Button type="submit" disabled={ocupado || !tipo.codigo || !tipo.nome.trim()}>{ocupado ? 'Salvando…' : 'Adicionar entidade'}</Button></div>
      </form>
    </Dialog>}
    {excluindo && <Dialog title={'Excluir ' + excluindo.codigo + '?'} description="Esse tipo sai da lista de marcação. As anotações existentes continuam disponíveis, e você pode restaurar o tipo em Removidos."
      close={() => setExcluindo(null)} busy={ocupado}>
      {erro && <p className={s.alert} role="alert">{erro}</p>}
      <div className={s.dialogActions}><Button variant="secondary" disabled={ocupado} onClick={() => setExcluindo(null)}>Cancelar</Button>
        <Button variant="danger" disabled={ocupado} onClick={() => void mudar(excluindo, false)}>{ocupado ? 'Excluindo…' : 'Excluir tipo'}</Button></div>
    </Dialog>}
  </>
}
