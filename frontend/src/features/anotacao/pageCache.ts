import { api, apiColecao, type Comentario, type Pagina } from './api'

export const PAGE_SIZE = 20
const TTL = 30_000
const LIMIT = 12

export function inicioDaPagina(pos: number) {
  return Math.floor((pos - 1) / PAGE_SIZE) * PAGE_SIZE + 1
}

type Leitura = {
  promessa: Promise<Pagina>
  alterados: Map<number, Comentario>
  controller: AbortController
}

export class PageCache {
  private pages = new Map<number, { data: Pagina; at: number }>()
  private requests = new Map<number, Leitura>()
  private id: string
  constructor(id: string) { this.id = id }

  peek(start: number) {
    const page = this.pages.get(start)
    if (!page) return null
    // Uma página aberta pelo usuário tem prioridade sobre antecipações antigas.
    this.pages.delete(start)
    this.pages.set(start, page)
    return page.data
  }

  load(start: number): Promise<Pagina> {
    const cached = this.pages.get(start)
    if (cached && Date.now() - cached.at < TTL) return Promise.resolve(cached.data)
    const pending = this.requests.get(start)
    if (pending) return pending.promessa

    const alterados = new Map<number, Comentario>()
    const controller = new AbortController()
    const query = new URLSearchParams({ inicio: String(start), tamanho: String(PAGE_SIZE) })
    const promessa = api<Pagina>(apiColecao(this.id) + '/pagina?' + query, { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) throw new DOMException('Leitura cancelada', 'AbortError')
      if (alterados.size) {
        data = { ...data, comentarios: data.comentarios.map(c => {
          const editado = alterados.get(c.pos)
          return editado && editado.versao >= c.versao ? editado : c
        }) }
      }
      this.pages.delete(start)
      this.pages.set(start, { data, at: Date.now() })
      if (this.pages.size > LIMIT) this.pages.delete(this.pages.keys().next().value!)
      return data
    }).finally(() => { if (this.requests.get(start)?.promessa === promessa) this.requests.delete(start) })
    this.requests.set(start, { promessa, alterados, controller })
    return promessa
  }

  update(comment: Comentario) {
    const start = inicioDaPagina(comment.pos)
    this.requests.get(start)?.alterados.set(comment.pos, comment)
    const page = this.pages.get(start)
    if (page) page.data = { ...page.data, comentarios: page.data.comentarios.map(c => c.pos === comment.pos ? comment : c) }
  }

  clear() {
    for (const leitura of this.requests.values()) leitura.controller.abort()
    this.requests.clear()
    this.pages.clear()
  }
}
