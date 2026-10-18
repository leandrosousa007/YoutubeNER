import uvicorn
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

if __package__:
    from .comentarios import buscar_comentarios, ConfiguracaoYouTubeError
else:
    from comentarios import buscar_comentarios, ConfiguracaoYouTubeError

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000",
                    "http://localhost:3000",
                    "http://localhost:5173",
                    "http://127.0.0.1:5173"
                    ],
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type"],
)

class VideoRequest(BaseModel):
    video_id: str

@app.post("/comentarios")
def buscar_snippets(video: VideoRequest):
    # busca os comentarios do video
    try:
        comentarios = buscar_comentarios(video.video_id)
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
    except (requests.exceptions.RequestException, ValueError) as erro:
        raise HTTPException(status_code=502, detail="Resposta inválida ou falha de conexão com o YouTube.") from erro

    return {
        "total" : len(comentarios),
        "comentarios": comentarios
        }

@app.get("/")
def inicio():
    return {"mensagem": "API funcionando!"}

if __name__ == "__main__":
    modulo = "backend.main:app" if __package__ else "main:app"
    uvicorn.run(modulo, host="127.0.0.1", port=8000, reload=True)
