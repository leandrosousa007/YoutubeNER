import { useEffect, useState } from 'react'
import { Button } from '../../components/Button/Button'
import { Icon, type IconName } from '../../components/Icon/Icon'
import { Layout } from '../../components/Layout/Layout'
import { api, mensagem, type Catalogo, type Colecao, type Postgres } from '../../features/anotacao/api'
import { Anotacao } from './Anotacao'
import { Biblioteca } from './Biblioteca'
import { Entidades } from './Entidades'
import s from './Pesquisa.module.css'

type Aba = 'colecoes' | 'anotacao' | 'entidades'
const abas: [Aba, string, IconName][] = [['colecoes', 'Coleções', 'folder'], ['anotacao', 'Anotação', 'annotate'], ['entidades', 'Entidades', 'tag']]

export function Home() {
  const [aba, setAba] = useState<Aba>('colecoes')
  const [colecoes, setColecoes] = useState<Colecao[]>([])
  const [ativa, setAtiva] = useState('')
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [tentativa, setTentativa] = useState(0)
  const [postgres, setPostgres] = useState<Postgres | null>(null)
  const colecao = colecoes.find(item => item.id === ativa)

  useEffect(() => {
    const controller = new AbortController()
    const init = { signal: controller.signal }
    Promise.all([api<Colecao[]>('/api/colecoes', init), api<Catalogo>('/api/entidades', init), api<Postgres>('/api/postgres', init)])
      .then(([itens, dados, estado]) => {
        if (controller.signal.aborted) return
        setColecoes(itens)
        setCatalogo(dados)
        setPostgres(estado)
        setAtiva(anterior => anterior || estado.colecao || itens[0]?.id || '')
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
      if (executando) return
      executando = true
      try {
        const init = { signal: controller.signal }
        const [itens, estado] = await Promise.all([api<Colecao[]>('/api/colecoes', init), api<Postgres>('/api/postgres', init)])
        if (controller.signal.aborted) return
        setColecoes(itens)
        setPostgres(estado)
        setAtiva(anterior => anterior || estado.colecao || itens[0]?.id || '')
      } catch { /* mantém a coleção visível durante uma interrupção da conexão */ }
      finally { executando = false }
    }, 5000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [carregando, erro])

  function abrir(item: Colecao) {
    setAtiva(item.id)
    setAba('anotacao')
  }

  async function atualizarColecoes() {
    const [itens, estado] = await Promise.all([api<Colecao[]>('/api/colecoes'), api<Postgres>('/api/postgres')])
    setPostgres(estado)
    setColecoes(itens)
    setAtiva(anterior => anterior || estado.colecao || itens[0]?.id || '')
  }

  async function sincronizar() {
    await api<Postgres>('/api/postgres/sincronizar', { method: 'POST' })
    await atualizarColecoes()
  }

  const navigation = <nav className={s.tabs} aria-label="Seções da ferramenta">
    {abas.map(([id, rotulo, icon]) => (
      <button key={id} type="button" aria-current={aba === id ? 'page' : undefined} onClick={() => setAba(id)}>
        <Icon name={icon} width="17" height="17" />{rotulo}
      </button>
    ))}
  </nav>
  const accessory = postgres?.estado === 'ativo'
    ? <span className={s.connection}><span aria-hidden="true" />PostgreSQL conectado</span>
    : undefined

  return (
    <Layout navigation={navigation} accessory={accessory} wide={aba === 'anotacao'} home={() => setAba('colecoes')}>
      {carregando ? <p className={s.empty} role="status">Carregando a biblioteca…</p> : erro ? (
        <div className={s.alert} role="alert">{erro} Confira se o backend está rodando.{' '}
          <Button variant="secondary" onClick={() => { setCarregando(true); setErro(''); setTentativa(n => n + 1) }}>Tentar de novo</Button>
        </div>
      ) : (
        <>
          {aba === 'colecoes' && <Biblioteca colecoes={colecoes} postgres={postgres} sincronizar={sincronizar}
            abrir={abrir} atualizarColecoes={atualizarColecoes} />}
          {aba === 'anotacao' && <Anotacao key={ativa} colecoes={colecoes} colecao={colecao} tipos={catalogo?.tipos ?? []} removidos={catalogo?.removidos ?? []}
            selecionar={setAtiva} atualizar={item => setColecoes(itens => itens.map(c => c.id === item.id ? item : c))}
            irParaColecoes={() => setAba('colecoes')} />}
          {aba === 'entidades' && catalogo && <Entidades catalogo={catalogo} atualizar={setCatalogo} />}
        </>
      )}
    </Layout>
  )
}
