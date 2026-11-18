# YouTubeNER · Estúdio de anotação

React + TypeScript na interface e Python/FastAPI no servidor. Um único endereço serve o site e a API. Sem PostgreSQL, Neon, coleta de novos vídeos ou sincronização externa.

## Seus dados

- `data/acervo.sqlite3`: acervo fixo, indexado, aberto **somente para leitura**. Cada registro conserva coleção, posição, ID original e texto sem normalização.
- `data/anotacoes.sqlite3`: marcações JSON, relações, versões, revisão, tipos de entidade, contas e histórico. Guarda somente comentários que já tiveram alterações. É um arquivo SQLite, sem um servidor de banco separado.
- `data/acervo.manifest.json`: contagem e SHA-256 dos IDs/textos para conferência.

O acervo entregue tem **59.086 comentários**, **63 revisados** e **37 com entidades**. Os arquivos de origem em `comentarios/colecoes` foram preservados e não são mais lidos pelo aplicativo.

Não coloque 60 mil textos no código TypeScript: isso aumentaria o download inicial e enviaria o acervo inteiro a cada visitante. Aqui o navegador recebe apenas 20 comentários por página e antecipa quatro páginas seguintes e a anterior. O cache mantém no máximo 12 páginas por bancada, com validade de 30 segundos. As entidades aparecem imediatamente; as gravações são enviadas em sequência e confirmadas pelo servidor. Uma gravação recusada aparece como erro, nunca como sucesso.

As coordenadas são medidas em **pontos de código Unicode**: `start` inclusivo, `end` exclusivo. Não altere o texto do acervo, pois isso deslocaria as marcações. Cada entidade tem ID, start, end e label; relações ligam os IDs source e target. Exportações CSV/JSONL mantêm o ID original do comentário.

## Abrir no seu computador

Com Python 3.11+ e Node.js 22.12+ (ou 24 LTS) instalados, na pasta do projeto:

```powershell
.\iniciar.ps1
```

Abra **http://127.0.0.1:8000**. O script compila o React e inicia um único servidor local. O acervo `data` já está pronto nesta instalação. Este modo sem login se limita ao próprio computador; para disponibilizar na internet use o modo protegido abaixo.

Para desenvolver a interface sem recompilar manualmente, use dois terminais:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

```powershell
cd frontend
npm ci
npm run dev
```

Abra http://localhost:5173. O Vite encaminha a API para o Python.

## Preparação única de uma instalação antiga

**Não execute novamente sobre uma pasta com anotações atuais.** Interrompa a anotação durante a migração e use uma pasta de destino nova. O comando usa backup consistente de SQLite (incluindo WAL), conserva os IDs, as versões e as anotações e nunca modifica a origem:

```powershell
.\.venv\Scripts\python.exe -m backend.preparar_acervo --origem comentarios/colecoes/anotacoes.sqlite3 --destino data
```

Se o programa falhar durante uma conversão, conserve a origem e escolha outra pasta de destino vazia. Faça a troca somente após conferir o manifesto. Não combine duas cópias que tenham recebido anotações separadamente.

## Duas pessoas online

As duas pessoas acessam **o mesmo servidor e o mesmo arquivo de anotações**. O arquivo permanece no disco local do servidor; não compartilhe SQLite por OneDrive, Google Drive, SMB ou NFS. Use uma única instância do aplicativo, sem múltiplas réplicas.

O modo protegido mantém contas individuais, senhas com scrypt, sessões, papéis, fila com reserva de comentários, anotações independentes e histórico. Uma revisão usa a versão carregada: se alguém salvar antes, a segunda tentativa recebe conflito, sem sobrescrever silenciosamente.

- **Anotador**: marca e envia para revisão; não altera o trabalho reservado a outra pessoa.
- **Revisor**: revisa anotações enviadas, aprova ou pede ajustes.
- **Administrador**: gerencia contas, entidades, revisão e backups.

A conta inicial é criada pelo terminal do servidor. Depois, o administrador cria a segunda conta pela aba **Administração**. As tabelas necessárias são criadas automaticamente no arquivo; não é preciso criar tabelas manualmente.

## Publicar em um único servidor (Docker + HTTPS)

A opção preparada é uma **VPS Linux com disco persistente** ou uma máquina da universidade. A versão do Docker inclui o React compilado e o Python; Caddy fornece HTTPS. Não precisa de hospedagem de frontend separada.

1. No servidor com Docker Compose, copie o código e a pasta **data** para uma pasta privada do aplicativo. Não coloque os arquivos de dados no GitHub público.
2. Aponte um domínio/subdomínio ao IP do servidor e libere as portas 80/443. Não exponha a porta 8000 diretamente.
3. Copie `deploy/.env.example` para `.env` na raiz e configure `APP_HOST=anotacao.seudominio.com`.
4. Dê acesso ao usuário do contêiner à pasta de dados:

```sh
sudo chown -R 10001:10001 data
chmod 700 data
```

5. Compile e crie a conta administrativa (a senha é solicitada sem aparecer no terminal):

```sh
docker compose build
docker compose run --rm app python -m backend.security leandro admin
docker compose up -d
```

6. Entre em `https://anotacao.seudominio.com`, abra Administração e cadastre a segunda pessoa.

O modo de produção exige origem HTTPS e login. Na execução sem Docker, configure `YOUTUBENER_PRODUCTION=1`, `YOUTUBENER_WEB_ORIGIN=https://SEU_DOMINIO` e `YOUTUBENER_DATA_DIR=/caminho/absoluto/data`. Compile o frontend e inicie `uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1` atrás de um proxy HTTPS. Para teste protegido em localhost, use `YOUTUBENER_AUTH=1`, `YOUTUBENER_WEB_ORIGIN=http://localhost:5173` e mantenha `YOUTUBENER_PRODUCTION` desativado.

**Onde hospedar:** uma VPS Linux da Locaweb (https://www.locaweb.com.br/servidor-vps/) ou outro provedor com armazenamento permanente. Para começar sem contratar, uma máquina da UFU já disponível é compatível com essa mesma instalação. O Render gratuito tem disco efêmero: não o use para guardar estas anotações; discos persistentes exigem serviço pago (https://render.com/docs/disks e https://render.com/docs/free). Cloudflare Pages sozinho hospeda arquivos estáticos, mas não executa este Python nem mantém o arquivo compartilhado de anotações. Nenhum serviço foi contratado ou publicado por esta alteração.

## Backup e restauração

O administrador pode baixar um snapshot consistente de `anotacoes.sqlite3` pela interface. O backup inclui contas e hashes de senha: mantenha privado. Sessões e limites de login ficam de fora. Guarde o `acervo.sqlite3` e o manifesto uma vez e gere backups regulares das anotações fora do servidor.

Para restaurar, pare o aplicativo, guarde a pasta data atual como backup, coloque a cópia escolhida como `data/anotacoes.sqlite3` ao lado do mesmo acervo e só então reinicie. Não substitua um arquivo com o aplicativo aberto nem deixe os arquivos WAL/SHM de outra cópia ao lado dele. Confira o progresso após iniciar. A URL pública sozinha não é uma cópia de segurança.

## Verificação

```sh
cd frontend
npm run build
npm run lint
cd ..
python -m pip install -r backend/requirements-dev.txt
python -m unittest backend.test_acervo -v
```

Os testes usam cópias temporárias e cobrem login/permissões/origem, reserva entre dois anotadores, conflito simultâneo, revisão, conjuntos independentes, relações, exportações, backup, acervo imutável e IDs originais em páginas distantes. Não mudam o acervo de trabalho.
