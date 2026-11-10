export type Colecao = {
  id: string
  nome: string
  video_id: string | null
  total: number
  revisados: number
  origem: 'arquivo' | 'postgres'
}

export type Marcacao = { id?: string; inicio: number; fim: number; tipo: string }
export type Entidade = Marcacao & { id: string; texto: string }
export type NovaRelacao = { source: string; target: string; label: string; id?: string }
export type Relacao = NovaRelacao & { id: string }

export type Comentario = {
  id: string
  pos: number
  texto: string
  versao: number
  revisado: boolean
  entidades: Entidade[]
  relacoes: Relacao[]
  rejeitadas: Marcacao[]
}
export type ComentarioResumo = Omit<Comentario, 'rejeitadas'>
export type Pagina = { colecao: Colecao; comentarios: ComentarioResumo[] }
export type Grupo = { tipo: string; total: number }
export type ItemAnotacao = Entidade & { pos: number; comentario_id: string }
export type Postgres = {
  estado: 'sem_configuracao' | 'aguardando' | 'sincronizando' | 'ativo' | 'erro'
  colecao: string | null
  origem: string | null
  ultima_sync: string | null
  novos: number
  mensagem: string
}

export type Tipo = { codigo: string; nome: string; cor: string; descricao: string }
export type Catalogo = { tipos: Tipo[]; removidos: Tipo[] }

export const apiColecao = (id: string) => `/api/colecoes/${id}`
export const chaveMarcacao = ({ inicio, fim, tipo }: Marcacao) => `${inicio}:${fim}:${tipo}`
type Intervalo = Pick<Marcacao, 'inicio' | 'fim'>
export const sobrepoe = (a: Intervalo, b: Intervalo) => a.inicio < b.fim && b.inicio < a.fim

export async function requisicao(url: string, init?: RequestInit): Promise<Response> {
  const resposta = await fetch(url, init)
  if (!resposta.ok) {
    const dados = await resposta.json().catch(() => null)
    throw new Error(typeof dados?.detail === 'string' ? dados.detail :
      Array.isArray(dados?.detail) ? 'Confira os campos e tente novamente.' : 'Não foi possível conectar ao servidor local.')
  }
  return resposta
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const resposta = await requisicao(url, init)
  return resposta.status === 204 ? undefined as T : resposta.json()
}

export function json(method: 'POST' | 'PUT', dados: object): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) }
}

export const mensagem = (erro: unknown) => erro instanceof Error ? erro.message : 'Ocorreu um erro. Tente novamente.'
