# YouTubeNER no Render, Neon e Cloudflare Pages

O Render executa a API, o Neon guarda os comentários e as anotações e o Pages publica o frontend. Use um projeto Neon **Free**, um único **Web Service Free** no Render e **Pages Free**. A configuração do repositório cria somente o serviço web. Use a região do Neon mais próxima da região disponível para o backend.

## Preparar o banco no Neon

1. Faça uma cópia do schema `dataset` com `pg_dump -Fc --schema=dataset` e use o recurso de backup do SQLite para copiar `anotacoes.sqlite3`. Mantenha os arquivos em armazenamento privado. Pare as edições locais antes da cópia final.
2. Restaure o dump em um banco vazio no Neon, pela conexão direta com TLS, usando `pg_restore --exit-on-error --no-owner --no-privileges --single-transaction`. Compare a contagem em `dataset.comentario` com a origem.
3. Execute as instruções de permissões e criação da tabela auxiliar da [seção de dados](ORACLE-CLOUDFLARE.md#1-vm-e-dados) no banco do Neon. Substitua `"YoutubeNER"` no comando `GRANT CONNECT` pelo nome real do banco. A conta de aplicação deve ter apenas as permissões necessárias em `dataset` e ser dona de `ytn_app`.
4. Antes de publicar a API, execute `python -m backend.importar_sqlite CAMINHO_DA_COPIA` da raiz do projeto, usando a conexão direta da conta da aplicação em `YOUTUBENER_APP_DSN`. O importador preserva IDs, revisão, entidades e relações. Crie a primeira conta com `python -m backend.security USUARIO admin`. A senha é solicitada no terminal.

## Publicar o site e a API

1. No Pages, conecte o repositório do GitHub e selecione a branch de deploy. Use diretório raiz `frontend`, comando `npm run build`, pasta de saída `dist` e Node.js 24. Confirme o endereço HTTPS atribuído ao Pages.
2. No Render, use o Blueprint `render.yaml` na mesma branch. Revise a proposta e confirme que aparece somente o Web Service com plano **Free**. Configure `YOUTUBENER_APP_DSN` e `YOUTUBENER_PG_DSN` com a conexão direta e restrita do Neon. Use o endereço exato do Pages em `YOUTUBENER_WEB_ORIGIN` e um segredo aleatório longo em `YOUTUBENER_EDGE_SECRET`. A chave `YOUTUBE_API_KEY` habilita a coleta de vídeos.
3. Nas variáveis de produção do Pages, configure `YTN_ORIGIN` com o endereço HTTPS atribuído ao Render e `YTN_WEB_ORIGIN` com o endereço HTTPS do Pages. Defina `YTN_EDGE_SECRET` como segredo, com o mesmo valor do Render. Deixe as credenciais de produção fora dos previews.
4. Verifique `/healthz` na API, abra o site e entre com a conta administrativa. Confira a contagem, abra comentários já revisados e valide a exportação. Teste também a área sem login para confirmar que o acervo exige autenticação.

O Render pode demorar a responder após um período ocioso. A sincronização periódica do corpus roda a cada 15 minutos nessa configuração. Ao coletar um vídeo pelo site, a API solicita uma sincronização imediatamente.
