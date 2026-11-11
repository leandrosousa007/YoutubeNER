import os
import re
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from psycopg.conninfo import conninfo_to_dict
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from .corpus import banco
from .pg_storage import enabled
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
        return db.execute("SELECT login,papel,ativo FROM usuarios ORDER BY login").fetchall()


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
        return criado


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
        return conta


@router.post("/backup")
def baixar_backup(request: Request):
    limitar("backup", request.headers.get("x-ytn-client", "desconhecido"), 2, 4, 3600)
    pasta = tempfile.TemporaryDirectory(prefix="youtubener-backup-")
    arquivo = Path(pasta.name) / "backup.dump"
    config = Path(pasta.name) / "pg_service.conf"
    try:
        conexao = conninfo_to_dict(os.environ["YOUTUBENER_APP_DSN"])
        if any("\n" in valor or "\r" in valor for valor in conexao.values()):
            raise ValueError("Configuração inválida para o serviço de backup.")
        config.write_text("[youtubener_backup]\n" + "".join(f"{chave}={valor}\n" for chave, valor in conexao.items()),
                          encoding="utf-8")
        env = {**os.environ, "PGSERVICEFILE": str(config), "PGSERVICE": "youtubener_backup"}
        subprocess.run(["pg_dump", "--no-password", "--format=custom", "--no-owner", "--no-privileges",
                        "--schema=ytn_app", "--exclude-table-data=ytn_app.sessoes",
                        "--exclude-table-data=ytn_app.limites", "--file", str(arquivo)],
                       env=env, check=True, timeout=70, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        config.unlink()
    except (OSError, ValueError, subprocess.SubprocessError):
        pasta.cleanup()
        raise HTTPException(503, "O backup pelo navegador falhou. Use o script de backup no servidor.")
    data = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return FileResponse(arquivo, filename=f"youtubener-{data}.dump", media_type="application/octet-stream",
                        background=BackgroundTask(pasta.cleanup))
