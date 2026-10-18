# API de comentários do YouTube

Na raiz do projeto, instale as dependências e inicie a API:

```powershell
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --reload
```

Configure `YOUTUBE_API_KEY` em `backend/.env` usando `backend/.env.example`
como referência, ou defina essa variável no ambiente. O arquivo `.env` não deve
ser compartilhado. A chave precisa ter acesso à YouTube Data API v3.

Acesse a documentação interativa em <http://127.0.0.1:8000/docs>.

Envie `POST /comentarios` com o ID do vídeo, sem validação de formato:

```json
{"video_id": "8MK8fBxAHoU"}
```

A resposta contém `total` e `comentarios`. Cada comentário contém `autor`,
`texto`, `likes` e `timestamp`. A coleta percorre todas as páginas de comentários
principais; respostas a comentários não são incluídas. Os resultados são
devolvidos na resposta HTTP, sem gravar um arquivo compartilhado entre requisições.

Erros retornam o campo `detail`:

- `422`: campo `video_id` ausente ou com tipo diferente de texto.
- `403`: comentários desativados.
- `404`: vídeo não encontrado.
- `502`: falha no YouTube, inclusive chave recusada ou cota esgotada.
- `503`: chave não configurada.
- `504`: tempo de resposta do YouTube esgotado.

