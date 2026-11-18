import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

function fixture() {
  const requests = []
  const api = url => new Promise(resolve => requests.push({ url, resolve }))
  const code = ts.transpileModule(fs.readFileSync(new URL('../src/features/anotacao/pageCache.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const result = {}
  new Function('require', 'exports', code)(() => ({ api, apiColecao: id => '/api/colecoes/' + id }), result)
  return { cache: new result.PageCache('teste'), requests }
}
const page = (start, version = 0) => ({ colecao: { id: 'teste', total: 1000 }, comentarios: [{ pos: start, versao: version, entidades: [] }] })

test('reutiliza solicitações em andamento e páginas já carregadas', async () => {
  const { cache, requests } = fixture()
  const a = cache.load(21)
  const b = cache.load(21)
  assert.equal(a, b)
  assert.equal(requests.length, 1)
  assert.match(requests[0].url, /inicio=21&tamanho=20/)
  requests[0].resolve(page(21))
  await a
  await cache.load(21)
  assert.equal(requests.length, 1)
  assert.equal(cache.peek(21).comentarios[0].pos, 21)
})

test('mostra cache antigo imediatamente e impede que uma resposta atrasada apague uma marcação', async () => {
  const originalNow = Date.now
  let now = 1000
  Date.now = () => now
  try {
    const { cache, requests } = fixture()
    const a = cache.load(1)
    requests[0].resolve(page(1))
    await a
    now += 31_000
    assert.ok(cache.peek(1))
    const refresh = cache.load(1)
    const edited = { pos: 1, versao: 1, entidades: [{ id: 'span-novo' }] }
    cache.update(edited)
    requests[1].resolve(page(1, 0))
    assert.deepEqual((await refresh).comentarios[0], edited)
    assert.deepEqual(cache.peek(1).comentarios[0], edited)
  } finally { Date.now = originalNow }
})

test('limita o cache e permite invalidar os dados depois de um conflito', async () => {
  const { cache, requests } = fixture()
  for (let i = 0; i < 13; i++) {
    const start = i * 20 + 1
    const p = cache.load(start)
    requests.at(-1).resolve(page(start))
    await p
  }
  assert.equal(cache.peek(1), null)
  assert.ok(cache.peek(241))
  cache.clear()
  assert.equal(cache.peek(241), null)
})

test('salvar na atual conserva a próxima página em trânsito e mescla edições de dois usuários', async () => {
  const { cache, requests } = fixture()
  const atual = cache.load(1)
  const proxima = cache.load(21)
  const local = { pos: 1, versao: 3, entidades: [{ id: 'local' }] }
  const remoto = { pos: 2, versao: 4, entidades: [{ id: 'remoto' }] }
  cache.update(local)
  assert.equal(cache.load(21), proxima)
  requests[0].resolve({ ...page(1), comentarios: [page(1, 2).comentarios[0], remoto] })
  requests[1].resolve(page(21))
  assert.deepEqual((await atual).comentarios, [local, remoto])
  await proxima
  assert.equal(cache.peek(21).comentarios[0].pos, 21)
  assert.equal(requests.length, 2)
})

test('descarta leituras anteriores a uma limpeza, mesmo que terminem depois', async () => {
  const { cache, requests } = fixture()
  const antiga = cache.load(1)
  cache.clear()
  const nova = cache.load(1)
  requests[1].resolve(page(1, 2))
  await nova
  requests[0].resolve(page(1, 1))
  await assert.rejects(antiga, { name: 'AbortError' })
  assert.equal(cache.peek(1).comentarios[0].versao, 2)
})
