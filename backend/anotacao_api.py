import csv
import io
import json
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Path, Query
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

if __package__:
    from .corpus import PASTA, banco
    from .postgres_sync import status_postgres, sincronizar_postgres
else:
    from corpus import PASTA, banco
    from recomendacoes import modelo_local, sugerir
    from postgres_sync import status_postgres, sincronizar_postgres


router = APIRouter(prefix="/api")
ColecaoId = Annotated[str, Path(pattern=r"^[0-9a-f]{32}$")]
Codigo = Annotated[str, Field(pattern=r"^[A-Z][A-Z0-9_]{0,23}$")]
IdAnotacao = Annotated[str, Field(pattern=r"^[a-f0-9]{32}$")]


class NovoTipo(BaseModel):
    codigo: Codigo
    nome: str = Field(min_length=1, max_length=60)
    cor: str = Field(pattern=r"^#[a-fA-F0-9]{6}$")
    descricao: str = Field(default="", max_length=200)


class Marcacao(BaseModel):
    id: IdAnotacao | None = None
    inicio: int = Field(ge=0)
    fim: int = Field(gt=0)
    tipo: Codigo


class Relacao(BaseModel):
    id: IdAnotacao | None = None
    source: IdAnotacao
    target: IdAnotacao
    label: str = Field(min_length=1, max_length=70)


class Revisao(BaseModel):
    versao: int = Field(ge=0)
    revisado: bool
    entidades: list[Marcacao] = Field(max_length=500)
    rejeitadas: list[Marcacao] = Field(max_length=500)
    relacoes: list[Relacao] | None = Field(default=None, max_length=500)


def obter_colecao(db, colecao):
    item = db.execute("""SELECT c.*, (SELECT COUNT(*) FROM comentarios
                      WHERE colecao = c.id AND revisado = 1) AS revisados
                      FROM colecoes c WHERE c.id = ?""", (colecao,)).fetchone()
    if item is None:
        raise HTTPException(404, "Conjunto não encontrado.")
    return dict(item)


@router.get("/colecoes")
def listar_colecoes():
    with banco() as db:
        return [dict(r) for r in db.execute("""SELECT c.*, (SELECT COUNT(*) FROM comentarios
                WHERE colecao = c.id AND revisado = 1) AS revisados
                FROM colecoes c ORDER BY c.criado_em DESC, c.rowid DESC""")]


@router.get("/postgres")
def consultar_postgres():
    return status_postgres()


@router.post("/postgres/sincronizar")
def buscar_postgres():
    return sincronizar_postgres()


@router.get("/colecoes/{colecao}/csv")
def baixar_csv(colecao: ColecaoId):
    with banco() as db:
        item = obter_colecao(db, colecao)
    if item["origem"] == "postgres":
        return resposta_csv(
            colecao, "comentarios.csv", ("id", "texto"),
            "SELECT id_origem, texto FROM comentarios WHERE colecao = ? ORDER BY pos",
        )
    return FileResponse(PASTA / colecao / "comentarios.csv", filename="comentarios.csv", media_type="text/csv")


@router.get("/colecoes/{colecao}/pendente")
def localizar_pendente(colecao: ColecaoId, depois: int = Query(0, ge=0)):
    with banco() as db:
        obter_colecao(db, colecao)
        item = db.execute("SELECT pos FROM comentarios WHERE colecao = ? AND revisado = 0 AND pos > ? ORDER BY pos LIMIT 1",
                          (colecao, depois)).fetchone()
        if item is None and depois:
            item = db.execute("SELECT pos FROM comentarios WHERE colecao = ? AND revisado = 0 ORDER BY pos LIMIT 1",
                              (colecao,)).fetchone()
        return {"pos": item["pos"] if item else None}


def obter_comentario(db, colecao, pos):
    comentario = db.execute("SELECT * FROM comentarios WHERE colecao = ? AND pos = ?", (colecao, pos)).fetchone()
    if comentario is None:
        raise HTTPException(404, "Comentário não encontrado.")
    documento = json.loads(comentario["anotacao_json"] or '{"spans":[],"relations":[]}')
    entidades = [{"id": e["id"], "inicio": e["start"], "fim": e["end"], "tipo": e["label"],
                  "texto": comentario["texto"][e["start"]:e["end"]]} for e in documento["spans"]]
    return {"pos": pos, "id": comentario["id_origem"] or str(pos), "texto": comentario["texto"], "revisado": bool(comentario["revisado"]),
            "versao": comentario["versao"], "entidades": entidades, "relacoes": documento["relations"],
            "rejeitadas": json.loads(comentario["rejeitadas"])}


@router.get("/colecoes/{colecao}/pagina")
def carregar_pagina(colecao: ColecaoId, inicio: int = Query(1, ge=1), tamanho: int = Query(10, ge=1, le=30)):
    with banco() as db:
        db.execute("BEGIN")
        item = obter_colecao(db, colecao)
        dados = []
        for r in db.execute("SELECT pos FROM comentarios WHERE colecao = ? AND pos >= ? ORDER BY pos LIMIT ?",
                            (colecao, inicio, tamanho)):
            comentario = obter_comentario(db, colecao, r["pos"])
            del comentario["rejeitadas"]
            dados.append(comentario)
        return {"colecao": item, "comentarios": dados}


@router.get("/colecoes/{colecao}/por-id")
def localizar_id(colecao: ColecaoId, id: str = Query(min_length=1, max_length=1024)):
    with banco() as db:
        item = obter_colecao(db, colecao)
        if item["origem"] == "postgres":
            r = db.execute("SELECT pos FROM comentarios WHERE colecao = ? AND id_origem = ?", (colecao, id)).fetchone()
        else:
            pos = int(id) if id.isascii() and id.isdecimal() and len(id) <= 15 else 0
            r = db.execute("SELECT pos FROM comentarios WHERE colecao = ? AND pos = ?", (colecao, pos)).fetchone()
        if not r:
            raise HTTPException(404, "ID não encontrado nesta coleção.")
        return {"pos": r["pos"]}


@router.get("/colecoes/{colecao}/comentarios/{pos}")
def abrir_comentario(colecao: ColecaoId, pos: int):
    with banco() as db:
        return obter_comentario(db, colecao, pos)


@router.put("/colecoes/{colecao}/comentarios/{pos}")
def salvar_revisao(colecao: ColecaoId, pos: int, revisao: Revisao):
    with banco() as db:
        db.execute("BEGIN IMMEDIATE")
        atual = obter_comentario(db, colecao, pos)
        if atual["versao"] != revisao.versao:
            raise HTTPException(409, "Este comentário mudou em outra janela. Reabra o comentário antes de salvar.")
        tipos = {r["codigo"]: bool(r["ativo"]) for r in db.execute("SELECT codigo, ativo FROM tipos")}
        texto = atual["texto"]
        for item in revisao.entidades + revisao.rejeitadas:
            if not item.inicio < item.fim <= len(texto) or not texto[item.inicio:item.fim].strip() or item.tipo not in tipos:
                raise HTTPException(422, "A marcação contém um trecho ou tipo inválido.")
        historicas = {(e["id"], e["inicio"], e["fim"], e["tipo"]) for e in atual["entidades"]}
        if any(not tipos[e.tipo] and (e.id, e.inicio, e.fim, e.tipo) not in historicas for e in revisao.entidades):
            raise HTTPException(422, "Esse tipo foi retirado do catálogo. Selecione um tipo ativo.")
        ordenadas = sorted(revisao.entidades, key=lambda e: e.inicio)
        if any(esq.fim > dir.inicio for esq, dir in zip(ordenadas, ordenadas[1:])):
            raise HTTPException(422, "Escolha um trecho que não sobreponha outra marcação.")
        anteriores = {(e["inicio"], e["fim"]): e["id"] for e in atual["entidades"]}
        ids_anteriores = set(anteriores.values())
        spans = []
        ids_spans = set()
        for e in ordenadas:
            if e.id and e.id not in ids_anteriores:
                raise HTTPException(422, "O ID da marcação não pertence a este comentário.")
            id_span = e.id or anteriores.get((e.inicio, e.fim)) or uuid4().hex
            if id_span in ids_spans:
                raise HTTPException(422, "Dois trechos não podem usar o mesmo ID.")
            ids_spans.add(id_span)
            spans.append({"id": id_span, "start": e.inicio, "end": e.fim, "label": e.tipo})
        relacoes = []
        vistas = set()
        ids_relacoes = set()
        solicitadas = revisao.relacoes if revisao.relacoes is not None else [
            Relacao(**r) for r in atual["relacoes"] if r["source"] in ids_spans and r["target"] in ids_spans]
        ids_anteriores_rel = {r["id"] for r in atual["relacoes"]}
        for r in solicitadas:
            chave = (r.source, r.target, r.label.strip())
            if r.source not in ids_spans or r.target not in ids_spans or r.source == r.target:
                raise HTTPException(422, "Uma relação precisa de dois trechos diferentes do mesmo comentário.")
            if not chave[2] or chave in vistas or (r.id and (r.id not in ids_anteriores_rel or r.id in ids_relacoes)):
                raise HTTPException(422, "A relação é inválida ou já existe.")
            vistas.add(chave)
            id_relacao = r.id or uuid4().hex
            ids_relacoes.add(id_relacao)
            relacoes.append({"id": id_relacao, "source": r.source, "target": r.target, "label": chave[2]})
        doc = json.dumps({"spans": spans, "relations": relacoes}, ensure_ascii=False, separators=(",", ":"))
        rejeitadas = [{"inicio": e.inicio, "fim": e.fim, "tipo": e.tipo} for e in revisao.rejeitadas]
        db.execute("""UPDATE comentarios SET revisado = ?, rejeitadas = ?, anotacao_json = ?, anotado = ?, versao = versao + 1
                   WHERE colecao = ? AND pos = ?""",
                   (revisao.revisado, json.dumps(rejeitadas), doc, bool(spans), colecao, pos))
        comentario = obter_comentario(db, colecao, pos)
        progresso = obter_colecao(db, colecao)
    return {"comentario": comentario, "colecao": progresso}


@router.get("/colecoes/{colecao}/anotacoes.jsonl")
def exportar(colecao: ColecaoId):
    with banco() as db:
        obter_colecao(db, colecao)

    async def linhas():
        with banco() as db:
            db.execute("BEGIN")
            linhas = db.execute("""SELECT COALESCE(c.id_origem, CAST(c.pos AS TEXT)) AS id, c.pos, c.texto, c.revisado, c.anotacao_json
                      FROM comentarios c WHERE c.colecao = ? AND (c.revisado = 1 OR c.anotado = 1) ORDER BY c.pos""", (colecao,))
            for linha in linhas:
                item = dict(linha)
                item["revisado"] = bool(item["revisado"])
                documento = json.loads(item.pop("anotacao_json") or '{"spans":[],"relations":[]}')
                item["entidades"] = documento["spans"]
                item["relacoes"] = documento["relations"]
                yield json.dumps({"colecao": colecao, **item}, ensure_ascii=False) + "\n"

    return StreamingResponse(linhas(), media_type="application/x-ndjson",
                             headers={"Content-Disposition": "attachment; filename=anotacoes.jsonl"})


def resposta_csv(colecao, arquivo, cabecalho, consulta):
    async def linhas():
        buffer = io.StringIO()
        escritor = csv.writer(buffer)
        escritor.writerow(cabecalho)
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate()
        with banco() as db:
            for linha in db.execute(consulta, (colecao,)):
                escritor.writerow(linha)
                yield buffer.getvalue()
                buffer.seek(0)
                buffer.truncate()
    return StreamingResponse(linhas(), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{arquivo}"'})


@router.get("/colecoes/{colecao}/anotacoes.csv")
def exportar_csv(colecao: ColecaoId):
    with banco() as db:
        obter_colecao(db, colecao)
    return resposta_csv(colecao, "anotacoes.csv",
                        ("id", "id_span", "tipo", "inicio", "fim", "trecho", "revisado"),
                        """SELECT COALESCE(c.id_origem, CAST(c.pos AS TEXT)), json_extract(e.value, '$.id'), json_extract(e.value, '$.label'),
                           json_extract(e.value, '$.start'), json_extract(e.value, '$.end'),
                           substr(c.texto, json_extract(e.value, '$.start') + 1,
                             json_extract(e.value, '$.end') - json_extract(e.value, '$.start')), c.revisado
                           FROM comentarios c, json_each(c.anotacao_json, '$.spans') e
                           WHERE c.colecao = ? AND c.anotado = 1 ORDER BY c.pos, json_extract(e.value, '$.start')""")


@router.get("/colecoes/{colecao}/anotacoes/grupos")
def grupos_anotacoes(colecao: ColecaoId):
    with banco() as db:
        obter_colecao(db, colecao)
        return [dict(r) for r in db.execute("""
            SELECT json_extract(e.value, '$.label') AS tipo, COUNT(*) AS total
            FROM comentarios c, json_each(c.anotacao_json, '$.spans') e
            WHERE c.colecao = ? AND c.anotado = 1 GROUP BY tipo
        """, (colecao,))]


@router.get("/colecoes/{colecao}/anotacoes/itens")
def itens_anotacoes(colecao: ColecaoId, tipo: str = Query(min_length=1, max_length=24),
                    pagina: int = Query(1, ge=1, le=1000000), tamanho: int = Query(20, ge=1, le=50)):
    with banco() as db:
        obter_colecao(db, colecao)
        return [dict(r) for r in db.execute("""
            SELECT c.pos, COALESCE(c.id_origem, CAST(c.pos AS TEXT)) AS comentario_id,
                   json_extract(e.value, '$.id') AS id, json_extract(e.value, '$.label') AS tipo,
                   json_extract(e.value, '$.start') AS inicio, json_extract(e.value, '$.end') AS fim,
                   substr(c.texto, json_extract(e.value, '$.start')+1,
                          json_extract(e.value, '$.end')-json_extract(e.value, '$.start')) AS texto
            FROM comentarios c, json_each(c.anotacao_json, '$.spans') e
            WHERE c.colecao = ? AND c.anotado = 1 AND json_extract(e.value, '$.label') = ?
            ORDER BY c.pos, inicio, id LIMIT ? OFFSET ?
        """, (colecao, tipo, tamanho, (pagina - 1) * tamanho))]


@router.delete("/colecoes/{colecao}/comentarios/{pos}/anotacoes/{span}")
def excluir_anotacao(colecao: ColecaoId, pos: int, span: str):
    with banco() as db:
        item = obter_comentario(db, colecao, pos)
    if not any(e["id"] == span for e in item["entidades"]):
        raise HTTPException(404, "Marcação não encontrada.")
    return salvar_revisao(colecao, pos, Revisao(
        versao=item["versao"], revisado=False,
        entidades=[Marcacao(**e) for e in item["entidades"] if e["id"] != span],
        rejeitadas=[Marcacao(**e) for e in item["rejeitadas"]],
    ))


@router.get("/entidades")
def listar_tipos():
    with banco() as db:
        itens = [dict(r) for r in db.execute("SELECT codigo, nome, cor, descricao, ativo FROM tipos ORDER BY rowid")]
    resultado = {"tipos": [], "removidos": []}
    for item in itens:
        destino = "tipos" if item.pop("ativo") else "removidos"
        resultado[destino].append(item)
    return resultado


@router.post("/entidades", status_code=201)
def adicionar_tipo(tipo: NovoTipo):
    nome = tipo.nome.strip()
    if not nome:
        raise HTTPException(422, "Informe um nome para a entidade.")
    with banco() as db:
        mudanca = db.execute("INSERT OR IGNORE INTO tipos (codigo, nome, cor, descricao) VALUES (?, ?, ?, ?)",
                             (tipo.codigo, nome, tipo.cor, tipo.descricao.strip()))
        if not mudanca.rowcount:
            raise HTTPException(409, "Esse código já existe. Se estiver em Removidos, você pode restaurá-lo.")
    return listar_tipos()


def mudar_disponibilidade(codigo, ativo):
    with banco() as db:
        mudanca = db.execute("UPDATE tipos SET ativo = ? WHERE codigo = ?", (ativo, codigo))
        if not mudanca.rowcount:
            raise HTTPException(404, "Tipo de entidade não encontrado.")
    return listar_tipos()


@router.delete("/entidades/{codigo}")
def remover_tipo(codigo: str):
    return mudar_disponibilidade(codigo, False)


@router.post("/entidades/{codigo}/restaurar")
def restaurar_tipo(codigo: str):
    return mudar_disponibilidade(codigo, True)


