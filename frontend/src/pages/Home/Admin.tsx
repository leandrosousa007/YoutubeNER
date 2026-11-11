import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '../../components/Button/Button'
import { Icon } from '../../components/Icon/Icon'
import { api, json, mensagem, requisicao, type Usuario } from '../../features/anotacao/api'
import s from './Pesquisa.module.css'

type Conta = Usuario & { ativo: boolean }
const papeis = { anotador: 'Anotador', revisor: 'Revisor', admin: 'Administrador' }
const rota = '/api/admin/usuarios'

export function Admin({ usuario }: { usuario: Usuario }) {
  const [contas, setContas] = useState<Conta[] | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    api<Conta[]>(rota, { signal: controller.signal }).then(setContas).catch(e => {
      if (!controller.signal.aborted) setErro(mensagem(e))
    })
    return () => controller.abort()
  }, [tentativa])

  async function executar(acao: () => Promise<string>) {
    setOcupado(true)
    setErro('')
    setAviso('')
    try { setAviso(await acao()) }
    catch (e) { setErro(mensagem(e)) }
    finally { setOcupado(false) }
  }

  function cadastrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    const form = evento.currentTarget
    const dados = Object.fromEntries(new FormData(form))
    void executar(async () => {
      const conta = await api<Conta>(rota, json('POST', dados))
      setContas(atuais => [...(atuais ?? []), conta].sort((a, b) => a.login.localeCompare(b.login)))
      form.reset()
      return `Conta de ${conta.login} criada.`
    })
  }

  function alterar(conta: Conta) {
    void executar(async () => {
      const atual = await api<Conta>(rota + '/' + encodeURIComponent(conta.login), json('PUT', { ativo: !conta.ativo }))
      setContas(atuais => atuais?.map(item => item.login === atual.login ? atual : item) ?? [])
      return `Acesso de ${atual.login} ${atual.ativo ? 'ativado' : 'desativado'}.`
    })
  }

  function baixar() {
    void executar(async () => {
      const resposta = await requisicao('/api/admin/backup', { method: 'POST' })
      const url = URL.createObjectURL(await resposta.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = resposta.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'youtubener.dump'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      return 'Download do backup iniciado.'
    })
  }

  return <>
    <header className={s.pageHead}><div><h1>Administração</h1><p className={s.lead}>Gerencie o acesso ao projeto e baixe uma cópia das anotações.</p></div></header>
    {erro && <p className={s.alert} role="alert">{erro}{contas === null && <> <Button variant="secondary" onClick={() => { setErro(''); setTentativa(n => n + 1) }}>Tentar novamente</Button></>}</p>}
    {aviso && <p className={s.notice} role="status">{aviso}</p>}
    <div className={s.grid}>
      <form className={s.card} onSubmit={cadastrar} aria-labelledby="titulo-conta">
        <h2 id="titulo-conta">Nova conta</h2>
        <label htmlFor="conta-login">Usuário</label>
        <input id="conta-login" name="login" autoComplete="off" maxLength={100} required />
        <label htmlFor="conta-senha">Senha inicial</label>
        <input id="conta-senha" name="senha" type="password" autoComplete="new-password" minLength={12} maxLength={256} required aria-describedby="conta-dica" />
        <p id="conta-dica" className={s.muted}>Use pelo menos 12 caracteres.</p>
        <label htmlFor="conta-papel">Papel</label>
        <select id="conta-papel" name="papel" defaultValue="anotador">
          {Object.entries(papeis).map(([papel, nome]) => <option key={papel} value={papel}>{nome}</option>)}
        </select>
        <div className={s.actions}><Button type="submit" disabled={ocupado || contas === null}>Criar conta</Button></div>
      </form>
      <section className={s.card} aria-labelledby="titulo-backup">
        <h2 id="titulo-backup">Backup do projeto</h2>
        <p>Inclui comentários sincronizados, anotações, progresso e contas. Guarde o arquivo em um local privado.</p>
        <Button variant="secondary" onClick={baixar} disabled={ocupado}><Icon name="download" /> Baixar backup</Button>
      </section>
    </div>
    <section className={s.library} aria-labelledby="titulo-contas">
      <h2 id="titulo-contas">Contas</h2>
      {contas === null && !erro && <p role="status">Carregando contas…</p>}
      {contas && <ul className={s.list}>{contas.map(conta => <li key={conta.login} className={s.listItem}>
        <div className={s.itemText}><strong>{conta.login}</strong><span>{papeis[conta.papel]} · {conta.ativo ? 'Ativa' : 'Desativada'}</span></div>
        {conta.login !== usuario.login && <Button variant="secondary" disabled={ocupado} onClick={() => alterar(conta)}
          aria-label={`${conta.ativo ? 'Desativar' : 'Ativar'} ${conta.login}`}>{conta.ativo ? 'Desativar' : 'Ativar'}</Button>}
      </li>)}</ul>}
    </section>
  </>
}
