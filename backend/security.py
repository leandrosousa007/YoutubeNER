import getpass
import hashlib
import hmac
import os
import re
import secrets
import sys
import time
from contextvars import ContextVar

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from .corpus import banco_anotacoes, iniciar_banco
from .config import enabled, production

router = APIRouter(prefix="/api/auth")
usuario = ContextVar("usuario", default=None)
COOKIE = "__Host-ytn" if production() else "ytn-local"
PADRAO_LOGIN = r"[a-z0-9][a-z0-9._-]{0,99}"


def digest(s):
    return hashlib.sha256(s.encode()).hexdigest()


def hash_senha(senha, salt):
    return hashlib.scrypt(senha.encode(), salt=salt, n=2**16, r=8, p=1, maxmem=96*1024*1024).hex()


def senha_codificada(senha):
    salt = secrets.token_bytes(16)
    return salt.hex() + ":" + hash_senha(senha, salt)


def identidade(token):
    if not token or len(token) > 100:
        return None
    with banco_anotacoes() as db:
        row = db.execute("""SELECT u.login,u.papel FROM sessoes s JOIN usuarios u USING(login)
                             WHERE s.token=? AND s.expira>CURRENT_TIMESTAMP AND u.ativo""", (digest(token),)).fetchone()
        return dict(row) if row else None


def limitar(grupo, ip, individual, global_, segundos):
    janela = int(time.time()) // segundos
    with banco_anotacoes() as db:
        for chave, limite in ((grupo+":global", global_), (grupo+":"+digest(ip), individual)):
            row = db.execute("""INSERT INTO limites VALUES (?,?,1)
                ON CONFLICT(chave,janela) DO UPDATE SET total=limites.total+1 RETURNING total""",
                (chave, janela)).fetchone()
            if row["total"] > limite:
                raise HTTPException(429, "Limite de solicitações atingido. Tente novamente mais tarde.")


async def proteger(request, call_next):
    if not enabled():
        return await call_next(request)
    caminho = request.url.path
    if caminho == "/healthz" and request.method == "GET":
        return JSONResponse({"ok": True})
    if not caminho.startswith("/api/"):
        return await call_next(request)
    if request.method not in ("GET", "HEAD"):
        origem = request.headers.get("origin")
        permitida = os.getenv("YOUTUBENER_WEB_ORIGIN") or str(request.base_url).rstrip("/")
        if origem != permitida:
            return JSONResponse({"detail": "Origem da solicitação inválida."}, 403)
    par = (request.method, caminho)
    publicas = {("GET", "/api/auth/me"), ("POST", "/api/auth/login")}
    pessoa = None
    if par not in publicas or caminho == "/api/auth/me":
        pessoa = await run_in_threadpool(identidade, request.cookies.get(COOKIE))
    if par not in publicas and not pessoa:
        return JSONResponse({"detail": "Entre para acessar a coleção."}, 401)
    if pessoa:
        papel = pessoa["papel"]
        admin = (caminho.startswith("/api/entidades") and request.method != "GET")
        exporta = caminho.endswith(("/csv", "/anotacoes.csv", "/anotacoes.jsonl")) and caminho.startswith("/api/colecoes/")
        if (admin and papel != "admin") or (exporta and papel == "anotador"):
            return JSONResponse({"detail": "Seu perfil não tem permissão para essa operação."}, 403)
    marcador = usuario.set(pessoa)
    try:
        resposta = await call_next(request)
        resposta.headers["Cache-Control"] = "no-store"
        return resposta
    finally:
        usuario.reset(marcador)


class Credenciais(BaseModel):
    login: str = Field(max_length=100)
    senha: str = Field(max_length=256)


@router.get("/me")
def me():
    return {"protegido": enabled(), "usuario": usuario.get()}


@router.post("/login")
def login(dados: Credenciais, request: Request):
    if not enabled():
        raise HTTPException(404)
    limitar("login", request.client.host if request.client else "desconhecido", 8, 30, 900)
    with banco_anotacoes() as db:
        pessoa = db.execute("SELECT * FROM usuarios WHERE login=? AND ativo", (dados.login.strip().lower(),)).fetchone()
        salt, _, chave = pessoa["senha"].partition(":") if pessoa else ("00"*16, ":", "0"*128)
        valida = hmac.compare_digest(hash_senha(dados.senha, bytes.fromhex(salt)), chave)
        if not pessoa or not valida:
            raise HTTPException(401, "Usuário ou senha incorretos.")
        token = secrets.token_urlsafe(32)
        db.execute("DELETE FROM sessoes WHERE expira<=CURRENT_TIMESTAMP")
        db.execute("INSERT INTO sessoes VALUES (?, ?, datetime('now','+12 hours'))", (digest(token), pessoa["login"]))
    resposta = JSONResponse({"login": pessoa["login"], "papel": pessoa["papel"]})
    resposta.set_cookie(COOKIE, token, secure=production(), httponly=True, samesite="strict", max_age=43200, path="/")
    return resposta


@router.post("/logout")
def logout(request: Request):
    if enabled():
        with banco_anotacoes() as db:
            db.execute("DELETE FROM sessoes WHERE token=?", (digest(request.cookies.get(COOKIE, "")),))
    resposta = JSONResponse({"ok": True})
    resposta.delete_cookie(COOKIE, path="/", secure=production(), httponly=True, samesite="strict")
    return resposta


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[2] not in {"anotador", "revisor", "admin"}:
        raise SystemExit("Uso: python -m backend.security USUARIO anotador|revisor|admin")
    login_ = sys.argv[1].strip().lower()
    senha = getpass.getpass("Senha (mínimo 12 caracteres): ")
    if not re.fullmatch(PADRAO_LOGIN, login_) or not 12 <= len(senha) <= 256 or senha != getpass.getpass("Repita a senha: "):
        raise SystemExit("Usuário/senha inválidos ou confirmação diferente.")
    iniciar_banco()
    with banco_anotacoes() as db:
        db.execute("""INSERT INTO usuarios (login,senha,papel) VALUES (?,?,?) ON CONFLICT(login)
            DO UPDATE SET senha=excluded.senha,papel=excluded.papel,ativo=true""",
            (login_, senha_codificada(senha), sys.argv[2]))
        db.execute("DELETE FROM sessoes WHERE login=?", (login_,))
