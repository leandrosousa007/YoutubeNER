import { Home } from './pages/Home/Home'
import { Portal } from './pages/Home/Portal'
import { useEffect, useState } from 'react'
import { api, mensagem, type Usuario } from './features/anotacao/api'


export default function App() {
  const [sessao, setSessao] = useState<{ protegido: boolean; usuario: Usuario | null } | null>(null)
  const [erro, setErro] = useState('')
  useEffect(() => {
    const ac = new AbortController()
    api<{ protegido: boolean; usuario: Usuario | null }>('/api/auth/me', { signal: ac.signal })
      .then(setSessao).catch(e => { if (!ac.signal.aborted) setErro(mensagem(e)) })
    return () => ac.abort()
  }, [])
  if (erro) return <main style={{ padding: '2rem' }} role="alert">{erro} <button onClick={() => location.reload()}>Tentar novamente</button></main>
  if (!sessao) return <p style={{ padding: '2rem' }} role="status">Abrindo YouTubeNER…</p>
  const publico = ['/extrair', '/demo', '/login'].includes(location.pathname)
  if (publico || (sessao.protegido && !sessao.usuario)) return <Portal usuario={sessao.usuario} entrar={usuario => {
    history.replaceState(null, '', '/anotacoes')
    setSessao({ protegido: true, usuario })
  }} />
  return <Home usuario={sessao.usuario} sair={sessao.protegido ? async () => {
    await api('/api/auth/logout', { method: 'POST' })
    location.assign('/')
  } : undefined} />
}
