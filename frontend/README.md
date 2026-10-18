# YouTubeNER

Tela para coletar comentarios do YouTube e baixar os dados em CSV.

Na pasta `frontend`, execute:

```powershell
npm.cmd install
npm.cmd run dev
```

Na raiz do projeto, em outro terminal, inicie a API:

```powershell
python -m uvicorn backend.main:app --reload
```

Configure a chave em `backend/.env`. A tela usa a API em
`http://127.0.0.1:8000`.

## Como usar

1. Informe o ID do video e clique em **Coletar comentarios**.
2. Leia os comentarios, com dez por pagina.
3. Use **Anterior** e **Proxima** para trocar de pagina.
4. Clique em **Baixar CSV** para salvar todos os comentarios coletados.

O CSV e criado no navegador sem cabecalho. Cada linha tem os dados na ordem:
autor, texto, likes e timestamp. O arquivo usa ponto e virgula e suporta acentos, aspas e
quebras de linha. Trocar de pagina nao faz uma nova busca no YouTube.
O campo recebe o ID diretamente, sem validacao de formato ou conversao de link.

## Arquivos principais

- `src/pages/Home/Home.tsx`: busca os dados e organiza a tela.
- `src/pages/Home/FormularioVideo.tsx`: campo do id e botao de coleta.
- `src/pages/Home/Comentarios.tsx`: comentarios e paginacao.
- `src/pages/Home/csv.ts`: gera e baixa o csv sem cabecalho.
- `src/pages/Home/tipos.ts`: tipos dos dados recebidos.
- `src/pages/Home/Home.module.css`: estilo da tela.
- `src/components/Layout`: cabecalho e rodape.
- `src/components/Button`: botoes.

## Verificacoes

```powershell
npm.cmd run build
npm.cmd run lint
```
