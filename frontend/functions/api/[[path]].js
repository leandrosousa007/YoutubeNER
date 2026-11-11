// A sessão fica no mesmo domínio do frontend. Só o proxy conhece o segredo.
export async function onRequest({ request, env }) {
  const origem = new URL(request.url)
  if (!env.YTN_ORIGIN || !env.YTN_EDGE_SECRET || origem.origin !== env.YTN_WEB_ORIGIN) {
    return Response.json({ detail: 'API ainda não configurada neste endereço.' }, { status: 503 })
  }
  const destino = new URL(env.YTN_ORIGIN)
  if (destino.protocol !== 'https:') return new Response(null, { status: 503 })
  destino.pathname = origem.pathname
  destino.search = origem.search
  const headers = new Headers()
  for (const nome of ['content-type', 'origin', 'cookie', 'accept']) {
    const valor = request.headers.get(nome)
    if (valor) headers.set(nome, valor)
  }
  headers.set('x-ytn-edge', env.YTN_EDGE_SECRET)
  headers.set('x-ytn-client', request.headers.get('CF-Connecting-IP') || 'desconhecido')
  try {
    const r = await fetch(destino, { method: request.method, headers, body: request.body, redirect: 'manual' })
    if (r.status >= 300 && r.status < 400) return new Response(null, { status: 502 })
    const resposta = new Response(r.body, r)
    resposta.headers.set('Cache-Control', 'no-store')
    return resposta
  } catch { return Response.json({ detail: 'O servidor da API não respondeu. Tente novamente em instantes.' }, { status: 502 }) }
}
