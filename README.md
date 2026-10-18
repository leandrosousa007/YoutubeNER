# YouTubeNER

Aplicação para coletar comentários de vídeos do YouTube, visualizar os dados e exportá-los em CSV.

O projeto faz parte da minha **Iniciação Científica na área de Inteligência Artificial e Processamento de Linguagem Natural (PLN)**, com foco em **Reconhecimento de Entidades Nomeadas (NER)**.

## 🔎 Sobre a pesquisa

O objetivo é construir um conjunto de dados de comentários do YouTube para, nas próximas etapas, anotar as entidades presentes nos textos e treinar modelos de NER.

Esses modelos serão utilizados para reconhecer entidades como pessoas, organizações e locais.

**Etapa atual:** desenvolvimento da ferramenta de coleta e preparação dos dados. A anotação das entidades e o treinamento dos modelos ainda serão realizados.

## 💬 Funcionalidades

- Coleta de comentários a partir do ID de um vídeo.
- Busca das páginas de comentários disponíveis na API do YouTube.
- Indicador de carregamento durante a coleta.
- Visualização de 10 comentários por página.
- Download de todos os comentários coletados em um arquivo CSV.
- Exibição de mensagens quando ocorre algum erro na busca.

A coleta inclui os comentários principais. As respostas feitas a esses comentários não são incluídas.

## 📊 Dados coletados

Para cada comentário, são preservados os seguintes dados:

| Campo | Descrição |
| --- | --- |
| `autor` | Nome do autor do comentário. |
| `texto` | Texto do comentário. |
| `likes` | Quantidade de curtidas. |
| `timestamp` | Data e hora da publicação do comentário. |

O CSV é gerado no navegador, **sem cabeçalho**, com os dados nessa mesma ordem. Os campos são separados por ponto e vírgula (`;`), com suporte a acentos, aspas e quebras de linha.

Exemplo fictício de uma linha:

```csv
"Ana";"Gostei do vídeo!";"2";"2026-10-17T12:00:00Z"
```

## 💻 Tecnologias

| Parte | Tecnologias |
| --- | --- |
| Frontend | React, TypeScript, Vite e CSS Modules. |
| Backend | Python, FastAPI, Uvicorn e Requests. |
| Coleta | YouTube Data API v3. |
| Configuração do backend | Variáveis de ambiente com python-dotenv. |

## Como funciona

1. O usuário informa o ID do vídeo na interface.
2. O React envia esse ID para a rota `POST /comentarios` do backend.
3. O backend faz requisições à API do YouTube e percorre as páginas disponíveis.
4. Ao terminar a coleta, devolve os comentários em uma resposta JSON.
5. O frontend mostra os dados com paginação e permite gerar o CSV para download.

A troca de página na tela utiliza os comentários já coletados, sem fazer uma nova consulta ao YouTube.

## 🚀 Executando o projeto

Você precisa ter Python, Node.js com npm e uma chave de API com acesso à YouTube Data API v3.

### Backend

Na raiz do projeto, instale as dependências:

```powershell
python -m pip install -r backend/requirements.txt
```

Crie o arquivo `backend/.env` seguindo o modelo de `backend/.env.example`:

```env
YOUTUBE_API_KEY=sua_chave_da_api_do_youtube
```

O arquivo `.env` está no `.gitignore`. A chave fica no backend e não é enviada ao frontend.

Inicie a API a partir da raiz:

```powershell
python -m uvicorn backend.main:app --reload
```

A API fica disponível em [http://127.0.0.1:8000](http://127.0.0.1:8000). A documentação interativa pode ser acessada em [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

### Frontend

Em outro terminal, a partir da raiz:

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Abra o endereço indicado no terminal, normalmente [http://localhost:5173](http://localhost:5173).

O frontend está configurado para acessar a API em `http://127.0.0.1:8000/comentarios`. Mantenha o backend e o frontend em execução para realizar a coleta.

### Usando a aplicação

1. Copie o ID de um vídeo. Em um endereço como `https://www.youtube.com/watch?v=8MK8fBxAHoU`, o ID é `8MK8fBxAHoU`.
2. Informe o ID no campo da página e clique em **Coletar comentários**.
3. Aguarde a coleta terminar.
4. Use **Anterior** e **Próxima** para navegar pelos resultados.
5. Clique em **Baixar CSV** para salvar todos os comentários coletados.

## Estrutura principal

```text
backend/
  main.py              # rotas, respostas e tratamento de erros
  comentarios.py       # requisicoes ao youtube e coleta dos dados
  requirements.txt     # dependencias do backend

frontend/
  public/youtube.svg   # icone usado no cabecalho
  src/
    components/        # estrutura da pagina e botoes
    pages/Home/
      Home.tsx         # busca e estados da tela
      FormularioVideo.tsx
      Comentarios.tsx  # lista e paginacao
      csv.ts           # geracao e download do arquivo
      tipos.ts         # tipos dos dados
    styles/            # estilos globais
```

## Próximas etapas

- [ ] Preparar e organizar o conjunto de dados para anotação.
- [ ] Anotar as entidades nomeadas presentes nos comentários.
- [ ] Treinar modelos de NER a partir dos dados anotados.
- [ ] Avaliar os resultados dos modelos.

Projeto em desenvolvimento para fins de pesquisa acadêmica.
