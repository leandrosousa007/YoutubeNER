# YouTubeNER na Oracle e Cloudflare Pages

O frontend usa `/api` no próprio domínio do Pages. Uma Pages Function encaminha só essas rotas à Oracle por HTTPS, inserindo um segredo que nunca vai para o bundle. O PostgreSQL não publica porta. O backend exige o segredo, verifica a origem em operações de escrita e autoriza os papéis em cada operação. A conta anota e envia; a revisora aprova ou pede ajuste; a administração configura rótulos e importa do YouTube. Visitantes têm apenas demo em memória e CSV público limitado (até 500 comentários por requisição, 4 requisições por IP e 30 globais por hora). A exportação privada integral é para revisores e administradores.

## 1. VM e dados

- Na Oracle, use uma VM Linux com Docker Engine e Compose, com disco persistente. Não abra 5432 nem 8000. Abra 80/443 para o Caddy e restrinja SSH ao seu IP. Configure o DNS de um hostname de API que aponte para a VM; o domínio do frontend pode ser o `pages.dev`. Configure o TLS e valide a renovação do certificado. Não assuma disponibilidade garantida no plano gratuito.
- Pare os editores locais para a migração final. Faça um `pg_dump -Fc` da origem (preserve o schema `dataset`, incluindo vínculos do YouTube) e uma cópia consistente do SQLite com `sqlite3.Connection.backup`, evitando copiar só o arquivo de um banco aberto em WAL. Transfira os dois por SSH, fora do Git, mantendo as cópias locais. A aplicação continua em modo SQLite local enquanto `YOUTUBENER_APP_DSN` estiver ausente.
- Copie `deploy/.env.example` para `deploy/.env` com permissão 600. Ajuste domínio, chave YouTube, senhas e gere um segredo longo aleatório, por exemplo `openssl rand -hex 32`. Em DSNs com URL, codifique caracteres especiais da senha. Não publique esse arquivo.

Na VM, com o banco vazio:

```sh
docker compose --env-file deploy/.env up -d db
docker compose --env-file deploy/.env exec -T db sh -ec 'pg_restore --exit-on-error --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < origem.dump
```

No `psql` do operador, crie o usuário de aplicação com `CREATE ROLE aplicacao LOGIN;` e `\password aplicacao`. Substitua o nome do banco se necessário. Execute:

```sql
CREATE SCHEMA IF NOT EXISTS ytn_app AUTHORIZATION aplicacao;
GRANT CONNECT ON DATABASE "YoutubeNER" TO aplicacao;
GRANT USAGE ON SCHEMA dataset TO aplicacao;
GRANT SELECT, INSERT ON dataset.comentario TO aplicacao;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE dataset.comentario_id_seq TO aplicacao;
CREATE TABLE IF NOT EXISTS dataset.youtubener_origem (
    youtube_comment_id text PRIMARY KEY,
    video_id text NOT NULL,
    comentario_id integer NOT NULL UNIQUE REFERENCES dataset.comentario(id) ON DELETE CASCADE
);
GRANT SELECT, INSERT ON dataset.youtubener_origem TO aplicacao;
```

Para permitir o botão administrativo de coleta, conceda `GRANT UPDATE ON dataset.comentario TO aplicacao;`, necessário para o lock que serializa a gravação. Se só for anotar o acervo existente, omita as permissões de escrita e a coleta para PostgreSQL não estará disponível para essa conexão. Nunca use a conta operadora como DSN da API.

Importe o SQLite **antes** de iniciar a API; a importação é transacional e recusa sobrescrever coleções. Arquivos CSV legados, se houver, ficam em `/data/<colecao>/comentarios.csv`.

```sh
docker compose --env-file deploy/.env build api
docker compose --env-file deploy/.env run --rm -v "$PWD/anotacoes.sqlite3:/tmp/origem.sqlite3:ro" api python -m backend.importar_sqlite /tmp/origem.sqlite3
docker compose --env-file deploy/.env run --rm api python -m backend.security leandro admin
docker compose --env-file deploy/.env up -d
```

O backend cria as tabelas `ytn_app.usuarios` e `ytn_app.sessoes` automaticamente. O comando acima cria a primeira conta de administração e pede uma senha de pelo menos 12 caracteres no terminal. Depois de entrar no site, abra **Administração → Nova conta** para cadastrar outras pessoas. Escolha **Anotador** para quem anota e envia, **Revisor** para quem também aprova e exporta, ou **Administrador** para quem também gerencia acessos. Desativar uma conta encerra suas sessões e preserva as anotações. Para redefinir senha, execute o comando novamente com o login e o papel desejados.

As anotações legadas mantêm status, offsets Unicode e IDs. A autoria histórica permanece vazia quando a origem não informa o autor.

## 2. Cloudflare Pages

Crie o projeto conectado ao Git: diretório raiz `frontend`, comando `npm ci && npm run build`, saída `dist`, Node.js 24. Use deploy por Git ou Wrangler (upload de arquivos pelo painel não é indicado para Pages Functions). Em **Variables and Secrets** de produção, configure:

| Nome | Valor |
| --- | --- |
| `YTN_ORIGIN` | `https://api.seudominio.com` |
| `YTN_WEB_ORIGIN` | origem exata do site Pages, sem barra final |
| `YTN_EDGE_SECRET` | segredo criptografado, igual ao da Oracle |

`YOUTUBENER_WEB_ORIGIN` na Oracle deve ser igual a `YTN_WEB_ORIGIN`. Deixe previews sem segredos de produção. Valide os três papéis e confirme que uma visita anônima não abre a coleção nem grava no banco.

## 3. Atualização e backups

- Envie código novo ao Pages pelo Git e reconstrua a API com `docker compose --env-file deploy/.env up -d --build api`. Preserve os volumes. Nunca use `down -v` em produção.
- Agende `sh deploy/backup.sh /diretorio/protegido` diariamente. Ele cria um `.dump` privado e valida que pode ser listado. Para enviá-lo automaticamente **para fora da VM**, configure um destino criptografado no rclone e passe `YTN_BACKUP_REMOTE=backup-criptografado:youtubener` no agendamento. Uma falha no envio mantém a cópia local e retorna erro. Configure retenção e alerta no serviço escolhido e ensaie `pg_restore --exit-on-error` em uma instância separada.
- Em **Administração → Backup do projeto**, baixe um dump do schema `ytn_app` com comentários sincronizados, anotações, progresso e contas. As tabelas de sessões e limites são exportadas vazias. Use o script do servidor para copiar também o schema de origem e para agendamento.
- No acervo, o seletor **Conjunto de anotações** abre a anotação principal ou uma versão independente. Revisores encontram envios independentes em **Revisar conjuntos**. Os filtros de vídeo e data usam os metadados do PostgreSQL. Comentários sem vínculo conhecido a um vídeo ficam fora do filtro por vídeo.
- Não torne público o corpus por meio de arquivos estáticos ou backups. A chave do YouTube fica no backend; revise as políticas aplicáveis antes de divulgar identificadores e dados do corpus.

Referências: [Cloudflare Pages](https://developers.cloudflare.com/pages/), [Pages Functions](https://developers.cloudflare.com/pages/functions/get-started/), [OCI Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).
