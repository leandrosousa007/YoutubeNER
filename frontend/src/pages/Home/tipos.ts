export type Comentario = {
  autor: string | null
  texto: string | null
  likes: number | null
  timestamp: string | null
}

export type Coleta = {
  comentarios: Comentario[]
}
