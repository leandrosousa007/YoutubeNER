import csv
import io
import json
from datetime import date
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Path, Query
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from .security import usuario
from .pg_storage import enabled

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
    ajuste: str | None = Field(default=None, max_length=1000)


def decodificar(valor, padrao):
    return json.loads(valor) if isinstance(valor, str) else valor if valor is not None else padrao


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
    if enabled():
        raise HTTPException(405, "Use a fila de trabalho para reservar o próximo comentário.")
    return proximo(colecao, depois, False)


@router.post("/colecoes/{colecao}/proximo")
def reservar_proximo(colecao: ColecaoId, depois: int = Query(0, ge=0), revisao: bool = False):
    return proximo(colecao, depois, revisao)


def proximo(colecao, depois, revisao):
    with banco() as db:
        obter_colecao(db, colecao)
        pessoa = usuario.get()
        if pessoa:
            db.execute("BEGIN IMMEDIATE")
            if revisao:
                if pessoa["papel"] == "anotador":
                    raise HTTPException(403)
                item = db.execute("""SELECT pos FROM tarefas WHERE colecao=? AND estado='enviado'
                    ORDER BY (pos <= ?), pos LIMIT 1""", (colecao,depois)).fetchone()
                return {"pos": item["pos"] if item else None}
            item = db.execute("""SELECT c.pos FROM comentarios c LEFT JOIN tarefas t USING(colecao,pos)
                WHERE c.colecao=? AND c.revisado=0 AND
                (t.pos IS NULL OR (t.estado IN ('rascunho','ajuste') AND t.autor=?) OR
                 (t.estado='rascunho' AND c.versao=0 AND t.expira<now()))
                ORDER BY CASE WHEN ?=0 AND t.autor=? THEN 0 ELSE 1 END, (c.pos <= ?), c.pos LIMIT 1""",
                (colecao,pessoa["login"],depois,pessoa["login"],depois)).fetchone()
            if item:
                db.execute("""DELETE FROM tarefas t USING comentarios c WHERE t.colecao=c.colecao AND t.pos=c.pos
                    AND t.colecao=? AND t.autor=? AND t.pos<>? AND t.estado='rascunho' AND c.versao=0""",
                    (colecao,pessoa["login"],item["pos"]))
                db.execute("""INSERT INTO tarefas VALUES (?,?,?,'rascunho',now()+interval '30 minutes')
                    ON CONFLICT(colecao,pos) DO UPDATE SET autor=excluded.autor,expira=excluded.expira""",
                    (colecao,item["pos"],pessoa["login"]))
            return {"pos": item["pos"] if item else None}
        item = db.execute("SELECT pos FROM comentarios WHERE colecao = ? AND revisado = 0 AND pos > ? ORDER BY pos LIMIT 1",
                          (colecao, depois)).fetchone()
        if item is None and depois:
            item = db.execute("SELECT pos FROM comentarios WHERE colecao = ? AND revisado = 0 ORDER BY pos LIMIT 1",
                              (colecao,)).fetchone()
        return {"pos": item["pos"] if item else None}


def consultar_comentarios(db, colecao, inicio, tamanho):
    colunas = "c.*"
    tarefas = ""
    if enabled():
        colunas += """, t.autor, t.estado,
            CASE WHEN t.estado = 'ajuste' THEN (
                SELECT h.anterior->>'feedback' FROM historico h
                WHERE h.colecao=c.colecao AND h.pos=c.pos
                    AND h.acao='ajuste' AND h.conjunto IS NULL
                ORDER BY h.id DESC LIMIT 1
            ) END AS feedback"""
        tarefas = "LEFT JOIN tarefas t USING (colecao,pos)"
    return db.execute(f"""SELECT {colunas} FROM comentarios c {tarefas}
        WHERE c.colecao = ? AND c.pos >= ? ORDER BY c.pos LIMIT ?""",
        (colecao, inicio, tamanho))


def serializar_comentario(comentario, *, resumo=False):
    pos = comentario["pos"]
    documento = decodificar(comentario["anotacao_json"], {"spans": [], "relations": []})
    entidades = [{"id": e["id"], "inicio": e["start"], "fim": e["end"], "tipo": e["label"],
                  "texto": comentario["texto"][e["start"]:e["end"]]} for e in documento["spans"]]
    resultado = {"pos": pos, "id": comentario["id_origem"] or str(pos), "texto": comentario["texto"], "revisado": bool(comentario["revisado"]),
            "versao": comentario["versao"], "entidades": entidades, "relacoes": documento["relations"]}
    if not resumo:
        resultado["rejeitadas"] = decodificar(comentario["rejeitadas"], [])
    if enabled():
        estado = comentario["estado"]
        resultado.update(autor=comentario["autor"], estado=estado or ("revisado" if resultado["revisado"] else "pendente"))
        if resultado["estado"] == "ajuste":
            resultado["feedback"] = comentario["feedback"]
    return resultado


def obter_comentario(db, colecao, pos):
    comentario = consultar_comentarios(db, colecao, pos, 1).fetchone()
    if comentario is None or comentario["pos"] != pos:
        raise HTTPException(404, "Comentário não encontrado.")
    return serializar_comentario(comentario)


@router.get("/colecoes/{colecao}/pagina")
def carregar_pagina(colecao: ColecaoId, inicio: int = Query(1, ge=1), tamanho: int = Query(20, ge=1, le=50)):
    with banco() as db:
        if not enabled():
            db.execute("BEGIN")
        item = obter_colecao(db, colecao)
        dados = [serializar_comentario(r, resumo=True) for r in consultar_comentarios(db, colecao, inicio, tamanho)]
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


@router.get("/colecoes/{colecao}/busca")
def buscar(colecao: ColecaoId, texto: str = Query("", max_length=200), tipo: str = Query("", max_length=24),
           autor: str = Query("", max_length=100), estado: str = Query("", max_length=20), depois: int = Query(0, ge=0),
           video: str = Query("", max_length=11), de: date | None = None, ate: date | None = None):
    condicoes = ["c.colecao=?", "c.pos>?"]
    params = [colecao, depois]
    if texto.strip():
        condicoes.append("instr(lower(c.texto),lower(?))>0" if not enabled() else "strpos(lower(c.texto),lower(?))>0")
        params.append(texto.strip())
    colaborativo = enabled()
    if not colaborativo and (autor or estado):
        raise HTTPException(422, "Os filtros por anotador e etapa exigem o modo colaborativo.")
    principal, independente, valores = [], [], []
    if tipo:
        principal.append("EXISTS (SELECT 1 FROM json_each(c.anotacao_json, '$.spans') e WHERE json_extract(e.value, '$.label')=?)")
        independente.append("EXISTS (SELECT 1 FROM jsonb_array_elements(i.documento->'spans') e WHERE e.value->>'label'=?)")
        valores.append(tipo)
    if autor:
        principal.append("t.autor=?")
        independente.append("i.autor=?")
        valores.append(autor.strip().lower())
    if estado:
        principal.append("COALESCE(t.estado,CASE WHEN c.revisado=1 THEN 'revisado' ELSE 'pendente' END)=?")
        independente.append("i.estado=?")
        valores.append(estado)
    if principal:
        filtro = "(" + " AND ".join(principal) + ")"
        params.extend(valores)
        if colaborativo:
            params.extend(valores)
            pessoa = usuario.get()
            if pessoa and pessoa["papel"] == "anotador":
                independente.append("i.autor=?")
                params.append(pessoa["login"])
            filtro += " OR EXISTS (SELECT 1 FROM conjuntos i WHERE i.colecao=c.colecao AND i.pos=c.pos AND " + " AND ".join(independente) + ")"
        condicoes.append("(" + filtro + ")")
    join = " LEFT JOIN tarefas t USING(colecao,pos)" if colaborativo else ""
    with banco() as db:
        obter_colecao(db, colecao)
        aplicar_metadados(db, condicoes, params, video, de, ate)
        linhas = db.execute("SELECT c.pos,COALESCE(c.id_origem,CAST(c.pos AS TEXT)) AS id,c.texto FROM comentarios c"
                            + join + " WHERE " + " AND ".join(condicoes) + " ORDER BY c.pos LIMIT 21", params).fetchall()
    return {"itens":[dict(r) for r in linhas[:20]], "proximo":linhas[19]["pos"] if len(linhas)>20 else None}


def aplicar_metadados(db, condicoes, params, video, de, ate):
    if de and ate and de > ate:
        raise HTTPException(422, "A data inicial deve ser anterior à final.")
    if not (video or de or ate):
        return
    if not enabled():
        raise HTTPException(422, "Os filtros de vídeo e data exigem PostgreSQL.")
    if video:
        if not db.execute("SELECT to_regclass('dataset.youtubener_origem') AS tabela").fetchone()["tabela"]:
            condicoes.append("FALSE")
        else:
            condicoes.append("EXISTS (SELECT 1 FROM dataset.youtubener_origem v WHERE v.comentario_id::text=c.id_origem AND v.video_id=?)")
            params.append(video)
    if de or ate:
        partes = ["m.id::text=c.id_origem"]
        if de:
            partes.append("m.dia_hora>=?")
            params.append(de)
        if ate:
            partes.append("m.dia_hora<?::date+1")
            params.append(ate)
        condicoes.append("EXISTS (SELECT 1 FROM dataset.comentario m WHERE " + " AND ".join(partes) + ")")


@router.get("/colecoes/{colecao}/comentarios/{pos}/historico")
def historico(colecao: ColecaoId, pos: int):
    pessoa = usuario.get()
    if not pessoa or pessoa["papel"] == "anotador":
        raise HTTPException(403, "O histórico está disponível para revisores e administradores.")
    with banco() as db:
        return [dict(r) for r in db.execute("""SELECT ator,acao,criado_em::text,conjunto,anterior FROM historico
            WHERE colecao=? AND pos=? ORDER BY id DESC LIMIT 30""", (colecao,pos))]


@router.get("/colecoes/{colecao}/comentarios/{pos}")
def abrir_comentario(colecao: ColecaoId, pos: int, conjunto: str = Query("", max_length=100)):
    with banco() as db:
        return obter_conjunto(db, colecao, pos, conjunto) if conjunto else obter_comentario(db, colecao, pos)


def obter_conjunto(db, colecao, pos, conjunto):
    pessoa = usuario.get()
    if not pessoa or (pessoa["papel"] == "anotador" and pessoa["login"] != conjunto):
        raise HTTPException(403, "Você só pode abrir sua anotação independente.")
    base = obter_comentario(db, colecao, pos)
    row = db.execute("SELECT estado,versao,documento FROM conjuntos WHERE colecao=? AND pos=? AND autor=?",
                     (colecao,pos,conjunto)).fetchone()
    if not row and pessoa["login"] != conjunto:
        raise HTTPException(404, "Conjunto não encontrado.")
    doc = row["documento"] if row else {}
    estado = row["estado"] if row else "rascunho"
    return {**base, "autor":conjunto,"estado":estado,"versao":row["versao"] if row else 0,
        "revisado":estado=="revisado", "relacoes":doc.get("relations",[]), "rejeitadas":doc.get("rejeitadas",[]),
        "feedback":doc.get("feedback"), "entidades":[{"id":s["id"],"inicio":s["start"],"fim":s["end"],"tipo":s["label"],
        "texto":base["texto"][s["start"]:s["end"]]} for s in doc.get("spans",[])]}


@router.get("/colecoes/{colecao}/comentarios/{pos}/conjuntos")
def listar_conjuntos(colecao: ColecaoId, pos: int):
    pessoa = usuario.get()
    if not pessoa:
        raise HTTPException(403)
    with banco() as db:
        obter_comentario(db,colecao,pos)
        sql = "SELECT autor,estado,versao FROM conjuntos WHERE colecao=? AND pos=?"
        if pessoa["papel"] == "anotador":
            return db.execute(sql+" AND autor=?", (colecao,pos,pessoa["login"])).fetchall()
        return db.execute(sql+" ORDER BY autor", (colecao,pos)).fetchall()


@router.get("/colecoes/{colecao}/proximo-conjunto")
def proximo_conjunto(colecao: ColecaoId):
    pessoa = usuario.get()
    if not pessoa or pessoa["papel"] == "anotador":
        raise HTTPException(403, "A fila está disponível para revisores e administradores.")
    with banco() as db:
        obter_colecao(db, colecao)
        return db.execute("""SELECT pos,autor FROM conjuntos WHERE colecao=? AND estado='enviado'
                          ORDER BY pos,autor LIMIT 1""", (colecao,)).fetchone()


@router.put("/colecoes/{colecao}/comentarios/{pos}")
def salvar_revisao(colecao: ColecaoId, pos: int, revisao: Revisao, conjunto: str = ""):
    with banco() as db:
        db.execute("BEGIN IMMEDIATE")
        atual = obter_conjunto(db, colecao, pos, conjunto) if conjunto else obter_comentario(db, colecao, pos)
        if atual["versao"] != revisao.versao:
            raise HTTPException(409, "Este comentário mudou em outra janela. Reabra o comentário antes de salvar.")
        pessoa = usuario.get()
        final = revisao.revisado
        if pessoa:
            anotador = pessoa["papel"] == "anotador"
            autor = atual["autor"] or pessoa["login"]
            if anotador and (autor != pessoa["login"] or atual["estado"] in {"enviado","revisado"} or revisao.ajuste is not None):
                raise HTTPException(403, "Este comentário está reservado ou já foi enviado para revisão.")
            if pessoa["papel"] == "revisor" and autor != pessoa["login"] and atual["estado"] not in {"enviado","revisado"}:
                raise HTTPException(403, "A anotação precisa ser enviada antes de ser revisada por outra pessoa.")
            if revisao.ajuste is not None and (not revisao.ajuste.strip() or atual["estado"] != "enviado"):
                raise HTTPException(422, "Informe o ajuste em uma anotação enviada.")
            final = revisao.revisado and not anotador and revisao.ajuste is None
            estado = "ajuste" if revisao.ajuste is not None else "revisado" if final else "enviado" if revisao.revisado else (
                "enviado" if atual["estado"] == "enviado" else "ajuste" if atual["estado"] == "ajuste" else "rascunho")
            if not conjunto:
                db.execute("""INSERT INTO tarefas VALUES (?,?,?,?,now()+interval '30 minutes')
                ON CONFLICT(colecao,pos) DO UPDATE SET estado=excluded.estado,expira=excluded.expira""",
                (colecao,pos,autor,estado))
            db.execute("INSERT INTO historico (colecao,pos,ator,acao,anterior,conjunto) VALUES (?,?,?,?,?,?)",
                       (colecao,pos,pessoa["login"],estado,json.dumps({**atual,"feedback":revisao.ajuste},ensure_ascii=False),conjunto or None))
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
        if conjunto:
            independente = json.dumps({"spans":spans,"relations":relacoes,"rejeitadas":rejeitadas,
                "feedback":revisao.ajuste or (atual.get("feedback") if estado=="ajuste" else None)},ensure_ascii=False)
            db.execute("""INSERT INTO conjuntos VALUES (?,?,?,?,1,?) ON CONFLICT(colecao,pos,autor)
                DO UPDATE SET estado=excluded.estado,versao=conjuntos.versao+1,documento=excluded.documento""",
                (colecao,pos,conjunto,estado,independente))
        else:
            db.execute("""UPDATE comentarios SET revisado = ?, rejeitadas = ?, anotacao_json = ?, anotado = ?, versao = versao + 1
                   WHERE colecao = ? AND pos = ?""",
                   (final, json.dumps(rejeitadas), doc, bool(spans), colecao, pos))
        comentario = obter_conjunto(db, colecao, pos, conjunto) if conjunto else obter_comentario(db, colecao, pos)
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
                documento = decodificar(item.pop("anotacao_json"), {"spans": [], "relations": []})
                item["entidades"] = documento["spans"]
                item["relacoes"] = documento["relations"]
                yield json.dumps({"colecao": colecao, **item}, ensure_ascii=False) + "\n"

    return StreamingResponse(linhas(), media_type="application/x-ndjson",
                             headers={"Content-Disposition": "attachment; filename=anotacoes.jsonl"})


@router.get("/colecoes/{colecao}/exportar")
def exportar_filtrado(colecao: ColecaoId, formato: str = Query("jsonl", pattern="^(jsonl|csv)$"),
                      autor: str = Query("", max_length=100), estado: str = Query("", max_length=20),
                      video: str = Query("", max_length=11), de: date | None = None, ate: date | None = None,
                      tipo: str = Query("", max_length=24), texto: str = Query("", max_length=200)):
    pessoa = usuario.get()
    if not pessoa or pessoa["papel"] == "anotador":
        raise HTTPException(403, "As exportações filtradas são restritas a revisores e administradores.")
    condicoes, params = ["c.colecao=?"], [colecao]
    with banco() as db:
        obter_colecao(db,colecao)
        aplicar_metadados(db,condicoes,params,video,de,ate)
    for campo, valor in (("autor",autor.strip().lower()),("estado",estado)):
        if valor:
            condicoes.append("a."+campo+"=?")
            params.append(valor)
    if texto.strip():
        condicoes.append("strpos(lower(c.texto),lower(?))>0")
        params.append(texto.strip())
    if tipo:
        condicoes.append("EXISTS (SELECT 1 FROM jsonb_array_elements(a.doc->'spans') e WHERE e.value->>'label'=?)")
        params.append(tipo)
    consulta = """WITH a AS (
       SELECT c.colecao,c.pos,t.autor,COALESCE(t.estado,CASE WHEN c.revisado=1 THEN 'revisado' ELSE 'rascunho' END) AS estado,
          c.versao,c.anotacao_json AS doc,'principal' AS conjunto
       FROM comentarios c LEFT JOIN tarefas t USING(colecao,pos)
       WHERE c.colecao=? AND (c.anotado=1 OR c.revisado=1 OR t.estado IN ('enviado','ajuste'))
       UNION ALL
       SELECT colecao,pos,autor,estado,versao,documento,'independente' FROM conjuntos WHERE colecao=?
    )
    SELECT c.pos,COALESCE(c.id_origem,c.pos::text) AS id,c.texto,a.autor,a.estado,a.versao,a.doc,a.conjunto
    FROM a JOIN comentarios c USING(colecao,pos) WHERE """+" AND ".join(condicoes)+" ORDER BY c.pos,a.conjunto,a.autor"

    def linhas():
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        if formato == "csv":
            writer.writerow(("id","autor","estado","versao","conjunto","id_span","tipo","inicio","fim","trecho"))
            yield buffer.getvalue()
        with banco() as db:
            for r in db.execute(consulta,(colecao,colecao,*params)):
                item = dict(r)
                doc = item.pop("doc") or {}
                spans = doc.get("spans",[])
                if formato == "jsonl":
                    yield json.dumps({**item,"colecao":colecao,"entidades":spans,"relacoes":doc.get("relations",[])}, ensure_ascii=False)+"\n"
                    continue
                buffer.seek(0)
                buffer.truncate()
                prefixo = (item["id"],item["autor"],item["estado"],item["versao"],item["conjunto"])
                for s in spans or [None]:
                    writer.writerow((*prefixo,s["id"],s["label"],s["start"],s["end"],item["texto"][s["start"]:s["end"]]) if s else (*prefixo,"","","","",""))
                yield buffer.getvalue()
    return StreamingResponse(linhas(),media_type="text/csv" if formato=="csv" else "application/x-ndjson",
                             headers={"Content-Disposition":f"attachment; filename=anotacoes-filtradas.{formato}"})


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
                escritor.writerow(linha.values() if isinstance(linha, dict) else linha)
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


