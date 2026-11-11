# YouTubeNER

Para publicar o frontend na Cloudflare Pages e o backend e PostgreSQL na Oracle, siga o [guia de implantação](deploy/ORACLE-CLOUDFLARE.md).

Ferramenta local de coleta e anotação de comentários do YouTube para pesquisa em Processamento de Linguagem Natural. O corpus é usado na anotação de entidades nomeadas e poderá servir para treinar modelos de NER.

## Coletar e anotar

1. Em **Coleções**, informe o ID do vídeo. **Adicionar ao PostgreSQL** grava os comentários principais em `dataset.comentario`; **Baixar CSV do vídeo** gera um arquivo sem gravar no banco. As respostas a comentários não são coletadas.
2. Clique em **Anotar comentários do banco**. Selecione um trecho no painel central e clique em um dos 18 tipos à direita. A marcação é salva na hora. Clique em uma marcação existente para mudar o tipo ou excluí-la.
3. À esquerda, abra um grupo para ver os trechos marcados em toda a coleção. Clique em um trecho para localizar seu comentário, ou no **×** para excluir a marcação. O botão exclui a anotação, sem apagar o comentário. Relações que usam aquele trecho são removidas junto com a marcação.
4. Após marcar dois trechos, use **Nova relação** para ligá-los. Use **Concluir revisão** também nos comentários sem entidades e **Próximo pendente** para continuar de onde parou.

A aba **Entidades** permite criar tipos com nome, código, cor e descrição. **Excluir** retira o tipo da lista de marcação e preserva as marcações existentes. Para reativá-lo, abra **Removidos → Restaurar**. O botão **×** nos grupos da bancada exclui só uma marcação específica.

No celular, ao selecionar texto, os tipos aparecem na barra inferior. Deslize a lista para encontrar o tipo e toque nele para marcar. Use **Marcações** e **Detalhes do trecho** para abrir os painéis.

O painel central exibe o ID original e permite saltar para qualquer comentário pelo ID. Os tokens de cor, tipografia, espaço e movimento ficam em `frontend/src/styles/tokens.css`.

## PostgreSQL

Instale as dependências do backend e ajuste o `backend/.env`:

```dotenv
YOUTUBENER_PG_DSN="host=127.0.0.1 port=5432 dbname=YoutubeNER user=seu_usuario password=SUA_SENHA"
YOUTUBENER_PG_SCHEMA=dataset
YOUTUBE_API_KEY=sua_chave_da_api_do_youtube
```

O arquivo `.env` é privado. Use a grafia exata do banco. A chave do YouTube é exigida apenas para novas coletas. Quando necessário, especifique `YOUTUBENER_PG_TABLE=comentario`, `YOUTUBENER_PG_ID=id` e `YOUTUBENER_PG_TEXT=texto` para a leitura.

A sincronização lê IDs novos a cada 30 segundos por padrão (ajustável por `YOUTUBENER_PG_INTERVAL`), ou imediatamente com **Sincronizar agora**. A cópia local preserva o texto usado para os offsets: futuras edições ou exclusões no PostgreSQL não alteram esse texto. A posição na lista é só para navegação.

Somente a ação **Adicionar ao PostgreSQL** grava no banco. Ela usa a tabela `dataset.comentario` com as colunas `id`, `autor`, `texto`, `likes` e `dia_hora`. O horário do YouTube é armazenado em UTC. Na primeira gravação, o backend cria `dataset.youtubener_origem` para relacionar o ID do comentário e do vídeo do YouTube ao ID original no PostgreSQL. A tabela de vínculo evita duplicatas ao repetir uma coleta. Registros históricos sem ID do YouTube são reaproveitados quando autor, texto e horário coincidem exatamente. A conta precisa de leitura e, para coletar no banco, de escrita, uso da sequência e permissão para criar a tabela de vínculo no schema na primeira vez.

## Arquivos e exportação

- **CSV do vídeo:** separado por ponto e vírgula, sem cabeçalho, com autor, texto, curtidas e data de publicação.
- **CSV da coleção:** os comentários da coleção; para PostgreSQL, contém as colunas `id` e `texto`.
- **JSONL de anotações:** um objeto por comentário marcado ou revisado. Inclui ID, texto, revisão, entidades e relações. `revisado: true` com `entidades: []` indica um exemplo negativo revisado.
- **CSV de anotações:** uma linha por entidade, com ID original, ID do trecho, tipo, início, fim, texto do trecho e estado da revisão. As relações estão no JSONL.

As anotações e o progresso são armazenados em `comentarios/colecoes/anotacoes.sqlite3`. Cada documento guarda coordenadas como `{"id":"…","start":42,"end":55,"label":"PERSON"}` e relações como `{"id":"…","source":"…","target":"…","label":"PERTENCE_A"}`. Os offsets contam pontos de código Unicode desde zero; o fim é exclusivo. Em Python, `texto[start:end]` recupera o trecho. Para fazer backup, pare o backend e copie a pasta `comentarios/colecoes/` inteira.

## Executar

Na raiz do projeto, usando o ambiente Python do projeto:

```powershell
python -m pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --reload
```

Em outro terminal:

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

O Vite encaminha as chamadas de `/api` ao backend em `http://127.0.0.1:8000`. Para usar outra porta, defina `YOUTUBENER_API_URL` antes de iniciar o frontend. A API tem documentação em `/docs`.
