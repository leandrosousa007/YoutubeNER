# API do YouTubeNER

Inicie o backend com `python -m uvicorn backend.main:app --reload` na raiz do projeto. A documentação interativa fica em `http://127.0.0.1:8000/docs`.

- `POST /api/coleta/postgres`: recebe `{"video_id":"8MK8fBxAHoU"}`, coleta os comentários principais e grava os novos em `dataset.comentario`.
- `POST /api/coleta/csv`: recebe o mesmo corpo e baixa a coleta em CSV sem gravar no banco.
- `GET /api/postgres` e `POST /api/postgres/sincronizar`: status e sincronização imediata.
- `GET /api/entidades` e `POST /api/entidades`: listar e criar tipos.
- `DELETE /api/entidades/{codigo}` e `POST /api/entidades/{codigo}/restaurar`: retirar e reativar tipos sem apagar anotações existentes.
- `/api/colecoes`: biblioteca, consulta por ID, anotações, grupos, exclusão de marcações e exportações.

Configure `YOUTUBE_API_KEY` e `YOUTUBENER_PG_DSN` no `backend/.env`. A tabela auxiliar `dataset.youtubener_origem` é criada na primeira coleta gravada e vincula IDs do YouTube a IDs do PostgreSQL. A sincronização lê do PostgreSQL; progresso, coordenadas e relações são salvos localmente. 
