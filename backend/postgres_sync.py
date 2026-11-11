import asyncio
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from dotenv import dotenv_values

if __package__:
    from .corpus import banco, espelhar_comentarios
else:
    from corpus import banco, espelhar_comentarios


_lock = Lock()
_estado = {"estado": "aguardando", "colecao": None, "origem": None, "ultima_sync": None, "novos": 0, "mensagem": ""}
_automatico = os.environ.get("YOUTUBENER_PG_AUTO_START", "1").lower() not in {"0", "false"}
_texto_colunas = ("texto", "comment_text", "comentario", "text", "comment", "conteudo", "textdisplay", "text_display", "textoriginal", "content")
_id_colunas = ("id", "id_comentario", "comentario_id", "comment_id", "id_comment", "youtube_comment_id")


class Configuracao(ValueError):
    pass


def _config():
    dados = dotenv_values(Path(__file__).with_name(".env"), interpolate=False)
    def ler(chave):
        nome = f"YOUTUBENER_PG_{chave}"
        return (dados.get(nome) or os.environ.get(nome) or "").strip()
    return {chave: ler(chave) for chave in ("DSN", "SCHEMA", "TABLE", "ID", "TEXT", "INTERVAL")}


def status_postgres():
    if not _config()["DSN"]:
        return {**_estado, "estado": "sem_configuracao", "mensagem": "Configure YOUTUBENER_PG_DSN no backend/.env para conectar."}
    if not _automatico and _estado["estado"] == "aguardando":
        return {**_estado, "mensagem": "A sincronização está pausada. Clique em Sincronizar agora quando as credenciais estiverem prontas."}
    return dict(_estado)


def _origem(con, cfg):
    dados = con.execute("""
        SELECT c.table_schema, c.table_name, c.column_name,
               EXISTS (SELECT 1 FROM information_schema.table_constraints tc
                 JOIN information_schema.key_column_usage k
                 ON k.constraint_catalog = tc.constraint_catalog AND k.constraint_schema = tc.constraint_schema
                 AND k.constraint_name = tc.constraint_name AND k.table_schema = tc.table_schema AND k.table_name = tc.table_name
                 WHERE tc.table_schema = c.table_schema AND tc.table_name = c.table_name
                 AND tc.constraint_type = 'PRIMARY KEY' AND k.column_name = c.column_name) AS pk
        FROM information_schema.columns c
        JOIN information_schema.tables t USING (table_catalog, table_schema, table_name)
        WHERE c.table_schema NOT IN ('information_schema','pg_catalog') AND c.table_schema NOT LIKE 'pg_toast%%'
        AND (%s = '' OR c.table_schema = %s) AND (%s = '' OR c.table_name = %s)
        AND (t.table_type = 'BASE TABLE' OR %s <> '')
    """, (cfg["SCHEMA"], cfg["SCHEMA"], cfg["TABLE"], cfg["TABLE"], cfg["TABLE"])).fetchall()
    tabelas = {}
    for schema, tabela, coluna, pk in dados:
        tabelas.setdefault((schema, tabela), {})[coluna] = pk
    candidatos = []
    for (schema, tabela), colunas in tabelas.items():
        by_lower = {nome.lower(): nome for nome in colunas}
        pk = [nome for nome, chave in colunas.items() if chave]
        id_ = cfg["ID"] or (pk[0] if len(pk) == 1 else next((by_lower[n] for n in _id_colunas if n in by_lower), None))
        texto = cfg["TEXT"] or next((by_lower[n] for n in _texto_colunas if n in by_lower), None)
        if id_ in colunas and texto in colunas and id_ != texto:
            favorita = "coment" in tabela.lower() or "comment" in tabela.lower()
            candidatos.append((favorita, schema, tabela, id_, texto))
    if not candidatos:
        raise Configuracao("Nenhuma tabela com ID e texto identificada. Informe SCHEMA, TABLE, ID e TEXT no backend/.env.")
    do_dataset = [c for c in candidatos if c[1] == "dataset"] if not cfg["SCHEMA"] else []
    candidatos = do_dataset or candidatos
    favoritas = [c for c in candidatos if c[0]] or candidatos
    if len(favoritas) != 1:
        raise Configuracao("Encontrei mais de uma tabela possível. Informe YOUTUBENER_PG_SCHEMA e YOUTUBENER_PG_TABLE.")
    return favoritas[0][1:]


def sincronizar_postgres():
    global _estado, _automatico
    cfg = _config()
    if not cfg["DSN"] or not _lock.acquire(blocking=False):
        return status_postgres()
    try:
        _estado = {**_estado, "estado": "sincronizando", "mensagem": ""}
        try:
            import psycopg
            from psycopg import IsolationLevel, sql
        except ImportError as erro:
            raise Configuracao("Instale as dependências atualizadas do backend para usar o PostgreSQL.") from erro
        try:
            with psycopg.connect(cfg["DSN"], connect_timeout=5) as con:
                con.read_only = True
                con.isolation_level = IsolationLevel.REPEATABLE_READ
                con.execute("SET LOCAL statement_timeout = '20s'")
                schema, tabela, id_, texto = _origem(con, cfg)
                identidade = [con.info.host, con.info.port, con.info.dbname, schema, tabela, id_, texto]
                colecao = hashlib.sha256(json.dumps(identidade).encode()).hexdigest()[:32]
                with banco() as db:
                    anterior = db.execute("SELECT id FROM colecoes WHERE origem = 'postgres' AND nome = ?",
                                          (f"PostgreSQL · {schema}.{tabela}",)).fetchall()
                    if len(anterior) == 1:
                        colecao = anterior[0]["id"]
                    conhecidos = {r[0] for r in db.execute("SELECT id_origem FROM comentarios WHERE colecao = ?", (colecao,))}
                campo_id = sql.Identifier(id_)
                tabela_sql = sql.Identifier(schema, tabela)
                ids_novos = []
                vistos = set()
                with con.cursor(name="youtubener_ids") as cursor:
                    cursor.execute(sql.SQL("SELECT {id} FROM {tabela} ORDER BY {id}").format(id=campo_id, tabela=tabela_sql))
                    for (chave,) in cursor:
                        id_texto = str(chave)
                        if chave is None or id_texto in vistos:
                            raise Configuracao("A coluna de ID deve ter valores únicos e não nulos.")
                        vistos.add(id_texto)
                        if id_texto not in conhecidos:
                            ids_novos.append(chave)
                consulta = sql.SQL("SELECT {id}, {texto}::text FROM {tabela} WHERE {id} = ANY(%s) ORDER BY {id}").format(
                    id=campo_id, texto=sql.Identifier(texto), tabela=tabela_sql)
                registros = []
                for i in range(0, len(ids_novos), 1000):
                    registros.extend((str(chave), valor) for chave, valor in con.execute(consulta, (ids_novos[i:i + 1000],)))
        except psycopg.errors.InsufficientPrivilege as erro:
            raise Configuracao("O usuário do PostgreSQL precisa de permissão de leitura (SELECT) na tabela.") from erro
        except psycopg.Error as erro:
            mensagem = str(erro).lower()
            if erro.sqlstate == "28P01" or "password authentication failed" in mensagem or ("autentica" in mensagem and "senha" in mensagem):
                raise Configuracao("O PostgreSQL rejeitou a senha. Confira o usuário e a senha no backend/.env.") from erro
            raise Configuracao("Não foi possível ler o PostgreSQL. Confira a conexão, a tabela e as colunas configuradas.") from erro
        nome = f"{schema}.{tabela}"
        novos = espelhar_comentarios(colecao, f"PostgreSQL · {nome}", registros)
        _estado = {"estado": "ativo", "colecao": colecao, "origem": nome, "ultima_sync": datetime.now(timezone.utc).isoformat(),
                   "novos": novos, "mensagem": ""}
        _automatico = True
    except Configuracao as erro:
        _estado = {**_estado, "estado": "erro", "mensagem": str(erro)}
    except Exception:
        _estado = {**_estado, "estado": "erro", "mensagem": "Falha ao salvar a sincronização local."}
    finally:
        _lock.release()
    return status_postgres()


async def sincronizacao_continua():
    while True:
        if _automatico:
            await asyncio.to_thread(sincronizar_postgres)
        try:
            intervalo = int(_config()["INTERVAL"] or 30)
        except ValueError:
            intervalo = 30
        await asyncio.sleep(max(10, min(intervalo, 3600)))
