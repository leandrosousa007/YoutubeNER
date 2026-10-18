import type { Comentario } from './tipos'

export function gerarCsv(comentarios: Comentario[]) {
  // usa somente os dados, sem cabecalho
  const linhas = comentarios.map((comentario) => [
    comentario.autor,
    comentario.texto,
    comentario.likes,
    comentario.timestamp,
  ])

  // protege as aspas e as quebras de linha
  return linhas.map((linha) =>
    linha.map((valor) => `"${String(valor ?? '').replaceAll('"', '""')}"`).join(';'),
  ).join('\r\n')
}

export function baixarCsv(comentarios: Comentario[]) {
  // cria o arquivo com todos os comentarios
  const csv = gerarCsv(comentarios)
  const arquivo = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(arquivo)

  // inicia o download
  const link = document.createElement('a')
  link.href = url
  link.download = 'comentarios.csv'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
