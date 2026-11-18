"""Um único serviço para o frontend React e a API de anotação."""
import os
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from .admin_api import router as admin_router
from .anotacao_api import router
from .config import production
from .corpus import iniciar_banco
from .security import proteger, router as auth_router

@asynccontextmanager
async def lifespan(_app):
    if production() and not os.getenv("YOUTUBENER_WEB_ORIGIN", "").startswith("https://"):
        raise RuntimeError("Configure YOUTUBENER_WEB_ORIGIN com o endereço HTTPS do site.")
    iniciar_banco()
    yield

app = FastAPI(lifespan=lifespan, docs_url=None if production() else "/docs", redoc_url=None)
app.include_router(router)
app.include_router(auth_router)
app.include_router(admin_router)
app.middleware("http")(proteger)
if not production():
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["Content-Type"], allow_credentials=True)

@app.get("/healthz")
def health():
    return {"ok": True}

DIST = Path(__file__).resolve().parents[1] / "frontend" / "dist"
if (DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

@app.get("/{caminho:path}")
def frontend(caminho: str):
    if caminho.startswith(("api/", "healthz/")):
        raise HTTPException(404, "Não encontrado.")
    if not (DIST / "index.html").is_file():
        raise HTTPException(503, "Compile o frontend com npm run build ou abra o Vite em http://localhost:5173.")
    if caminho in {"youtubener.svg", "youtube.svg"} and (DIST / caminho).is_file():
        return FileResponse(DIST / caminho, headers={"Cache-Control": "public, max-age=3600"})
    return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})
