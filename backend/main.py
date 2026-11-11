import asyncio
from contextlib import asynccontextmanager, suppress
import re
import os
from urllib.parse import urlsplit, parse_qs

import uvicorn
import requests
import psycopg
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from .security import proteger, router as auth_router, limitar
from .admin_api import router as admin_router
from .pg_storage import enabled

if __package__:
    from .comentarios import buscar_comentarios, ConfiguracaoYouTubeError
    from .anotacao_api import router
    from .corpus import gerar_csv, iniciar_banco
    from .postgres_sync import sincronizacao_continua, sincronizar_postgres, status_postgres
    from .coleta_postgres import gravar_coleta
else:
    from comentarios import buscar_comentarios, ConfiguracaoYouTubeError
    from anotacao_api import router
    from corpus import gerar_csv, iniciar_banco
    from postgres_sync import sincronizacao_continua, sincronizar_postgres, status_postgres
    from coleta_postgres import gravar_coleta


@asynccontextmanager
async def lifespan(_app):
    if os.getenv("YOUTUBENER_PRODUCTION") == "1" and (not enabled() or
        len(os.getenv("YOUTUBENER_EDGE_SECRET", "")) < 32 or not os.getenv("YOUTUBENER_WEB_ORIGIN", "").startswith("https://")):
        raise RuntimeError("Produção exige PostgreSQL, segredo de proxy e origem HTTPS.")
    iniciar_banco()
    tarefa = asyncio.create_task(sincronizacao_continua())
    try:
        yield
    finally:
        tarefa.cancel()
        with suppress(asyncio.CancelledError):
            await tarefa


app = FastAPI(lifespan=lifespan)
app.include_router(router)
app.include_router(auth_router)
app.include_router(admin_router)
app.middleware("http")(proteger)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000",
                    "http://localhost:3000",
                    "http://localhost:5173",
                    "http://127.0.0.1:5173"
                    ],
    allow_methods=["POST", "GET", "PUT", "DELETE"],
    allow_headers=["Content-Type"],
)

class VideoRequest(BaseModel):
    video_id: str

@app.post("/comentarios")
def coleta_local(video: VideoRequest):
    return buscar_snippets(VideoRequest(video_id=validar_video(video)))

def buscar_snippets(video: VideoRequest, limite=None):
    # busca os comentarios do video
    try:
        comentarios = buscar_comentarios(video.video_id, limite) if limite else buscar_comentarios(video.video_id)
    except ConfiguracaoYouTubeError as erro:
        raise HTTPException(status_code=503, detail=str(erro)) from erro
    except requests.exceptions.Timeout as erro:
        raise HTTPException(status_code=504, detail="O YouTube demorou para responder. Tente novamente.") from erro
    except requests.exceptions.HTTPError as erro:
        motivo = None
        if erro.response is not None:
            try:
                erros = erro.response.json().get("error", {}).get("errors", [])
                motivo = erros[0].get("reason") if erros else None
            except (ValueError, AttributeError, TypeError):
                pass
        if motivo == "commentsDisabled":
            raise HTTPException(status_code=403, detail="Os comentários deste vídeo estão desativados.") from erro
        if motivo == "videoNotFound":
            raise HTTPException(status_code=404, detail="Vídeo não encontrado.") from erro
        raise HTTPException(status_code=502, detail="Não foi possível buscar os comentários no YouTube.") from erro
    except (requests.exceptions.RequestException, ValueError, KeyError, TypeError) as erro:
        raise HTTPException(status_code=502, detail="Resposta inválida ou falha de conexão com o YouTube.") from erro

    return {
        "total" : len(comentarios),
        "comentarios": comentarios
        }


def validar_video(video: VideoRequest):
    video_id = video.video_id.strip()
    try:
        uri = urlsplit(video_id)
        if uri.scheme in ("http", "https") and not uri.username and not uri.password:
            if uri.hostname == "youtu.be":
                video_id = uri.path.strip("/")
            elif uri.hostname in {"youtube.com", "www.youtube.com", "m.youtube.com"}:
                video_id = parse_qs(uri.query).get("v", [""])[0] if uri.path == "/watch" else (
                    uri.path.split("/")[-1] if uri.path.startswith(("/shorts/", "/live/")) else "")
    except ValueError:
        raise HTTPException(422, "URL de vídeo inválida.")
    if not re.fullmatch(r"[a-zA-Z0-9_-]{11}", video_id):
        raise HTTPException(422, "Informe o ID do vídeo do YouTube (11 caracteres).")
    return video_id


@app.post("/api/coleta/csv")
def coletar_csv(video: VideoRequest, request: Request):
    video_id = validar_video(video)
    if enabled():
        limitar("csv", request.headers.get("x-ytn-client", "desconhecido"), 4, 30, 3600)
    comentarios = buscar_snippets(VideoRequest(video_id=video_id), 5 if enabled() else None)["comentarios"]
    return Response(gerar_csv(comentarios), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="comentarios-{video_id}.csv"'})


@app.post("/api/coleta/postgres", status_code=201)
def coletar_e_gravar(video: VideoRequest):
    video_id = validar_video(video)
    if status_postgres()["estado"] == "sem_configuracao":
        raise HTTPException(409, "Configure a conexão com o PostgreSQL antes da coleta.")
    comentarios = buscar_snippets(VideoRequest(video_id=video_id))["comentarios"]
    try:
        resultado = gravar_coleta(video_id, comentarios)
    except (psycopg.errors.LockNotAvailable, psycopg.errors.QueryCanceled) as erro:
        raise HTTPException(503, "O PostgreSQL está ocupado. Tente de novo em instantes.") from erro
    except psycopg.Error as erro:
        raise HTTPException(502, "Não foi possível gravar no PostgreSQL. Confira a conexão e as permissões.") from erro
    except ValueError as erro:
        raise HTTPException(422, "A coleta não pôde ser preparada para gravação.") from erro
    return {**resultado, "sincronizacao": sincronizar_postgres()}

@app.get("/")
def inicio():
    return {"mensagem": "API funcionando!"}

if __name__ == "__main__":
    modulo = "backend.main:app" if __package__ else "main:app"
    uvicorn.run(modulo, host="127.0.0.1", port=8000, reload=True)
