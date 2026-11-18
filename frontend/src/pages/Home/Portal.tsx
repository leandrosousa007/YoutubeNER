import { useState, type FormEvent } from 'react'
import { Button } from '../../components/Button/Button'
import { Icon } from '../../components/Icon/Icon'
import { Layout } from '../../components/Layout/Layout'
import { api, json, mensagem, type Usuario } from '../../features/anotacao/api'
import s from './Dashboard.module.css'

export function Portal({ usuario, entrar }: { usuario: Usuario | null; entrar: (u: Usuario) => void }) {
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setOcupado(true); setErro('')
    try { entrar(await api<Usuario>('/api/auth/login', json('POST', { login:form.get('login'), senha:form.get('senha') }))) }
    catch (e) { setErro(mensagem(e)) }
    finally { setOcupado(false) }
  }
  return <Layout home={() => location.assign('/')} navigation={<span className={s.navCaption}>ESTÚDIO DE ANOTAÇÃO</span>}>
    <section className={s.loginLayout}>
      <div className={s.loginIntro}><span className={s.projectBadge}><span />YOUTUBENER</span><h1>Grandes descobertas<br />começam nos<br /><span>pequenos detalhes.</span></h1><p>Um espaço tranquilo para anotar entidades,<br />revisar comentários e construir conhecimento em conjunto.</p><span className={s.loginNote}><Icon name="check" width="17" height="17" />Seu trabalho continua de onde você parou.</span></div>
      <form className={s.loginCard} onSubmit={enviar}><span className={s.sectionIcon}><Icon name="annotate" width="25" height="25" /></span><p className={s.eyebrow}>BEM-VINDO AO SEU ESPAÇO</p><h2>Vamos continuar?</h2><p>Entre com sua conta de pesquisa.</p>
        {usuario ? <a href="/anotacoes">Abrir meu acervo →</a> : <><label htmlFor="login">Usuário</label><input id="login" name="login" autoComplete="username" placeholder="Seu usuário" maxLength={100} required disabled={ocupado} /><label htmlFor="senha">Senha</label><input id="senha" name="senha" type="password" autoComplete="current-password" placeholder="Sua senha" maxLength={256} required disabled={ocupado} />{erro && <p role="alert" className={s.loginError}>{erro}</p>}<Button type="submit" disabled={ocupado}>{ocupado ? 'Entrando…' : 'Entrar no projeto'}<Icon name="right" width="17" height="17" /></Button></>}
        <small>O administrador do projeto gerencia seu acesso.</small>
      </form>
    </section>
  </Layout>
}
