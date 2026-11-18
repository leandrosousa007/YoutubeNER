import re
import tempfile
from datetime import datetime, timezone
from contextlib import closing
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
import sqlite3
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from .corpus import banco, PASTA
from .config import enabled
from .security import PADRAO_LOGIN, limitar, senha_codificada, usuario


def administrador():
    if not enabled():
        raise HTTPException(404)
    pessoa = usuario.get()
    if not pessoa or pessoa["papel"] != "admin":
        raise HTTPException(403, "Esta área é exclusiva para administradores.")
    return pessoa["login"]


router = APIRouter(prefix="/api/admin", dependencies=[Depends(administrador)])


class Conta(BaseModel):
    login: str = Field(max_length=100)
    senha: str = Field(min_length=12, max_length=256)
    papel: Literal["anotador", "revisor", "admin"]


class Acesso(BaseModel):
    ativo: bool


@router.get("/usuarios")
def listar_usuarios():
    with banco() as db:
        return [dict(r) for r in db.execute("SELECT login,papel,ativo FROM usuarios ORDER BY login")]


@router.post("/usuarios", status_code=201)
def criar_usuario(conta: Conta):
    login = conta.login.strip().lower()
    if not re.fullmatch(PADRAO_LOGIN, login):
        raise HTTPException(422, "Use letras sem acentos, números, pontos, hífens ou sublinhados no login.")
    senha = senha_codificada(conta.senha)
    with banco() as db:
        criado = db.execute("""INSERT INTO usuarios (login,senha,papel) VALUES (?,?,?)
            ON CONFLICT DO NOTHING RETURNING login,papel,ativo""", (login, senha, conta.papel)).fetchone()
        if not criado:
            raise HTTPException(409, "Esse login já existe.")
        return dict(criado)


@router.put("/usuarios/{login}")
def alterar_acesso(login: str, acesso: Acesso, operador: str = Depends(administrador)):
    if not acesso.ativo and login == operador:
        raise HTTPException(409, "Você não pode desativar a própria conta.")
    with banco() as db:
        conta = db.execute("UPDATE usuarios SET ativo=(?=1) WHERE login=? RETURNING login,papel,ativo",
                           (acesso.ativo, login)).fetchone()
        if not conta:
            raise HTTPException(404, "Conta não encontrada.")
        if not acesso.ativo:
            db.execute("DELETE FROM sessoes WHERE login=?", (login,))
        return dict(conta)


@router.post("/backup")
def baixar_backup(request: Request):
    limitar("backup", request.headers.get("x-ytn-client", "desconhecido"), 2, 4, 3600)
    pasta = tempfile.TemporaryDirectory(prefix="youtubener-backup-")
    arquivo = Path(pasta.name) / "anotacoes.sqlite3"
    try:
        with closing(sqlite3.connect(PASTA / "anotacoes.sqlite3")) as origem, closing(sqlite3.connect(arquivo)) as copia:
            origem.backup(copia)
            copia.execute("DELETE FROM sessoes")
            copia.execute("DELETE FROM limites")
            copia.commit()
    except sqlite3.Error:
        pasta.cleanup()
        raise HTTPException(503, "Não foi possível gerar o backup. Tente novamente.")
    data = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return FileResponse(arquivo, filename=f"youtubener-anotacoes-{data}.sqlite3", media_type="application/octet-stream",
                        background=BackgroundTask(pasta.cleanup))
