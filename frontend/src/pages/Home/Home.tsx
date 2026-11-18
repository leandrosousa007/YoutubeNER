import { useEffect, useState } from 'react'
import { Button } from '../../components/Button/Button'
import { Icon, type IconName } from '../../components/Icon/Icon'
import { Layout } from '../../components/Layout/Layout'
import { api, mensagem, type Catalogo, type Colecao, type Usuario } from '../../features/anotacao/api'
import { Anotacao } from './Anotacao'
import { Admin } from './Admin'
import { Biblioteca } from './Biblioteca'
import { Entidades } from './Entidades'
import s from './Pesquisa.module.css'

type Aba = 'colecoes' | 'anotacao' | 'entidades' | 'admin'
const abas: [Aba, string, IconName][] = [['colecoes', 'Visão geral', 'folder'], ['anotacao', 'Anotação', 'annotate'], ['entidades', 'Entidades', 'tag'], ['admin', 'Administração', 'database']]

export function Home({ usuario, sair }: { usuario: Usuario | null; sair?: () => Promise<void> }) {
  const [aba, setAba] = useState<Aba>(() => usuario?.papel === 'admin' && location.pathname === '/admin' ? 'admin' :
    /^\/(anotacoes|revisao)(\/|$)/.test(location.pathname) ? 'anotacao' : 'colecoes')
  const [colecoes, setColecoes] = useState<Colecao[]>([])
  const [ativa, setAtiva] = useState('')
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [tentativa, setTentativa] = useState(0)
  const [salvando, setSalvando] = useState(false)
  const colecao = colecoes.find(item => item.id === ativa)

  useEffect(() => {
    const controller = new AbortController()
    const init = { signal: controller.signal }
    Promise.all([api<Colecao[]>('/api/colecoes', init), api<Catalogo>('/api/entidades', init)])
      .then(([itens, dados]) => {
        if (controller.signal.aborted) return
        setColecoes(itens)
        setCatalogo(dados)
        setAtiva(anterior => anterior || itens[0]?.id || '')
      })
      .catch(erro => { if (!controller.signal.aborted) setErro(mensagem(erro)) })
      .finally(() => { if (!controller.signal.aborted) setCarregando(false) })
    return () => controller.abort()
  }, [tentativa])

  useEffect(() => {
    if (carregando || erro) return
    const controller = new AbortController()
    let executando = false
    const timer = window.setInterval(async () => {
      if (executando || document.visibilityState !== 'visible' || salvando) return
      executando = true
      try {
        const init = { signal: controller.signal }
        const itens = await api<Colecao[]>('/api/colecoes', init)
        if (controller.signal.aborted) return
        setColecoes(itens)
        setAtiva(anterior => anterior || itens[0]?.id || '')
      } catch { /* mantém a coleção visível durante uma interrupção da conexão */ }
      finally { executando = false }
    }, 30_000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [carregando, erro, salvando])

  function abrir(item: Colecao) {
    setAtiva(item.id)
    setAba('anotacao')
  }

  const navigation = <nav className={s.tabs} aria-label="Seções da ferramenta">
    {abas.filter(([id]) => id !== 'admin' || usuario?.papel === 'admin').map(([id, rotulo, icon]) => (
      <button key={id} type="button" disabled={salvando} aria-current={aba === id ? 'page' : undefined} onClick={() => setAba(id)}>
        <Icon name={icon} width="17" height="17" />{rotulo}
      </button>
    ))}
  </nav>
  const accessory = sair ? <Button variant="secondary" disabled={salvando} onClick={() => void sair().catch(e => setErro(mensagem(e)))}>Sair</Button> :
    <span className={s.connection}><span aria-hidden="true" />Acervo local</span>

  return (
    <Layout navigation={navigation} accessory={accessory} wide={aba === 'anotacao'} home={() => { if (!salvando) setAba('colecoes') }}>
      {carregando ? <p className={s.empty} role="status">Carregando a biblioteca…</p> : erro ? (
        <div className={s.alert} role="alert">{erro} Confira se o backend está rodando.{' '}
          <Button variant="secondary" onClick={() => { setCarregando(true); setErro(''); setTentativa(n => n + 1) }}>Tentar de novo</Button>
        </div>
      ) : (
        <>
          {aba === 'colecoes' && <Biblioteca colecoes={colecoes} usuario={usuario} abrir={abrir} />}
          {aba === 'anotacao' && <Anotacao key={ativa} colecoes={colecoes} colecao={colecao} tipos={catalogo?.tipos ?? []} removidos={catalogo?.removidos ?? []} usuario={usuario}
            selecionar={setAtiva} atualizar={item => setColecoes(itens => itens.map(c => c.id === item.id ? item : c))}
            irParaColecoes={() => setAba('colecoes')} aoSalvar={setSalvando} />}
          {aba === 'entidades' && catalogo && (usuario && usuario.papel !== 'admin' ?
            <ul>{catalogo.tipos.map(t => <li key={t.codigo}>{t.codigo} · {t.nome}</li>)}</ul> :
            <Entidades catalogo={catalogo} atualizar={setCatalogo} />)}
          {aba === 'admin' && usuario?.papel === 'admin' && <Admin usuario={usuario} />}
        </>
      )}
    </Layout>
  )
}
