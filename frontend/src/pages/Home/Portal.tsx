import { useRef, useState, type FormEvent } from 'react'
import { Button } from '../../components/Button/Button'
import { Layout } from '../../components/Layout/Layout'
import { api, json, mensagem, requisicao, type Usuario } from '../../features/anotacao/api'
import s from './Pesquisa.module.css'

const exemplo = 'Comentário fictício: Ana fez caminhada no parque durante 30 minutos.'
export function Portal({ usuario, entrar }: { usuario: Usuario | null; entrar: (u: Usuario) => void }) {
  const rota = location.pathname
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [marcas, setMarcas] = useState<{ trecho: string; tipo: string; inicio: number }[]>([])
  const campo = useRef<HTMLTextAreaElement>(null)
  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    const form = new FormData(evento.currentTarget)
    setOcupado(true)
    setErro('')
    try {
      if (rota === '/login') {
        entrar(await api<Usuario>('/api/auth/login', json('POST', { login: form.get('login'), senha: form.get('senha') })))
      } else {
        const resposta = await requisicao('/api/coleta/csv', json('POST', { video_id: form.get('video') }))
        const url = URL.createObjectURL(await resposta.blob())
        const a = document.createElement('a')
        a.href = url; a.download = 'comentarios-youtube.csv'; a.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch (e) { setErro(mensagem(e)) }
    finally { setOcupado(false) }
  }
  function marcar(tipo: string) {
    const el = campo.current
    if (!el || el.selectionStart === el.selectionEnd) return setErro('Selecione um trecho do comentário.')
    setErro('')
    const trecho = el.value.slice(el.selectionStart, el.selectionEnd)
    setMarcas(antes => [...antes.filter(m => m.inicio !== el.selectionStart), { trecho, tipo, inicio: el.selectionStart }])
  }
  return <Layout home={() => location.assign('/')} navigation={<nav className={s.actions} aria-label="Área pública">
    <a href="/extrair">Extrair CSV</a><a href="/demo">Demo</a><a href={usuario ? '/anotacoes' : '/login'}>{usuario ? 'Anotações' : 'Entrar'}</a>
  </nav>}>
    <header className={s.pageHead}><div><p className={s.eyebrow}>Pesquisa em NER</p>
      <h1>{rota === '/login' ? 'Entrar' : rota === '/extrair' ? 'Extrair comentários' : rota === '/demo' ? 'Experimentar anotação' : 'YouTubeNER'}</h1>
      <p className={s.lead}>{rota === '/extrair' ? 'Baixe até 500 comentários públicos por solicitação. A extração não grava no acervo.' :
        rota === '/demo' ? 'Use o comentário fictício abaixo. As marcações somem ao sair da página.' : 'Coleta de comentários e anotação de entidades para pesquisa.'}</p></div></header>
    {(rota === '/login' || rota === '/extrair') && <form className={s.card} onSubmit={enviar}>
      {rota === '/login' ? <><label htmlFor="login">Usuário</label><input id="login" name="login" autoComplete="username" required />
        <label htmlFor="senha">Senha</label><input id="senha" name="senha" type="password" autoComplete="current-password" required /></> :
        <><label htmlFor="video">ID ou URL do vídeo</label><input id="video" name="video" maxLength={512} required /></>}
      <div className={s.actions}><Button type="submit" disabled={ocupado}>{ocupado ? 'Aguarde…' : rota === '/login' ? 'Entrar' : 'Baixar CSV'}</Button></div>
    </form>}
    {rota === '/demo' && <section className={s.card}>
      <label htmlFor="demo">Selecione o trecho</label><textarea id="demo" ref={campo} value={exemplo} readOnly rows={3} style={{width:'100%'}} />
      <div className={s.actions}>{['PERSON','EXERCISE','DURATION'].map(t => <Button key={t} onClick={() => marcar(t)}>{t}</Button>)}
        <Button variant="secondary" onClick={() => { setMarcas([]); setErro('') }}>Reiniciar</Button></div>
      <ul>{marcas.map(m => <li key={m.inicio}>{m.tipo}: {m.trecho} <Button variant="secondary" onClick={() => setMarcas(a => a.filter(x => x.inicio !== m.inicio))}>Excluir</Button></li>)}</ul>
    </section>}
    {erro && <p className={s.alert} role="alert">{erro}</p>}
  </Layout>
}
