"""Armazenamento do aplicativo; a tabela dataset.comentario continua sendo a origem."""
import os
import re
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row


class Row(dict):
    def __getitem__(self, key):
        return tuple(self.values())[key] if isinstance(key, int) else super().__getitem__(key)


def row_factory(cursor):
    base = dict_row(cursor)
    return lambda values: Row(base(values))


class Storage:
    def __init__(self, conn):
        self.conn = conn

    @staticmethod
    def query(sql):
        # Compatibilidade apenas com as consultas estáticas do corpus legado.
        sql = sql.replace("c.rowid DESC", "c.id DESC").replace("ORDER BY rowid", "ORDER BY ordem")
        sql = sql.replace("json_each(c.anotacao_json, '$.spans')", "jsonb_array_elements(c.anotacao_json->'spans')")
        sql = re.sub(r"json_extract\(e.value, '\$\.(\w+)'\)",
                     lambda m: "((e.value->>'" + m[1] + "')::integer)" if m[1] in ("start", "end")
                     else "(e.value->>'" + m[1] + "')", sql)
        if sql.startswith("INSERT OR IGNORE"):
            sql = sql.replace("INSERT OR IGNORE", "INSERT", 1) + " ON CONFLICT DO NOTHING"
        return sql.replace("?", "%s")

    def execute(self, sql, params=()):
        if sql == "BEGIN IMMEDIATE":
            return self.conn.execute("SELECT pg_advisory_xact_lock(5277011)")
        if sql == "BEGIN":
            return self.conn.execute("SELECT 1")
        return self.conn.execute(self.query(sql), tuple(int(v) if isinstance(v, bool) else v for v in params))

    def executemany(self, sql, params):
        with self.conn.cursor() as cur:
            cur.executemany(self.query(sql), params)

    def commit(self):
        self.conn.commit()


def enabled():
    return bool(os.getenv("YOUTUBENER_APP_DSN"))


@contextmanager
def banco_pg():
    with psycopg.connect(os.environ["YOUTUBENER_APP_DSN"], row_factory=row_factory,
                         connect_timeout=5, options="-c search_path=ytn_app,pg_catalog") as conn:
        yield Storage(conn)


def iniciar_pg(tipos):
    with banco_pg() as db:
        db.execute("BEGIN IMMEDIATE")
        if not db.conn.execute("SELECT to_regnamespace('ytn_app') AS schema").fetchone()["schema"]:
            db.conn.execute("CREATE SCHEMA ytn_app")
        db.conn.execute("""
        CREATE TABLE IF NOT EXISTS colecoes (
          id text PRIMARY KEY, nome text NOT NULL, video_id text, total integer NOT NULL,
          criado_em text NOT NULL DEFAULT CURRENT_TIMESTAMP::text, origem text NOT NULL DEFAULT 'arquivo'
        );
        CREATE TABLE IF NOT EXISTS comentarios (
          colecao text REFERENCES colecoes(id), pos integer, texto text NOT NULL, revisado integer NOT NULL DEFAULT 0,
          rejeitadas jsonb NOT NULL DEFAULT '[]', versao integer NOT NULL DEFAULT 0, id_origem text,
          anotacao_json jsonb, anotado integer NOT NULL DEFAULT 0, PRIMARY KEY(colecao,pos)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS origem_comentario ON comentarios(colecao,id_origem) WHERE id_origem IS NOT NULL;
        CREATE INDEX IF NOT EXISTS progresso ON comentarios(colecao,revisado,pos);
        CREATE INDEX IF NOT EXISTS comentarios_anotados ON comentarios(colecao,pos) WHERE anotado=1;
        CREATE TABLE IF NOT EXISTS tipos (
          codigo text PRIMARY KEY, nome text NOT NULL, cor text NOT NULL, descricao text NOT NULL,
          ativo integer NOT NULL DEFAULT 1, ordem bigint GENERATED ALWAYS AS IDENTITY
        );
        CREATE TABLE IF NOT EXISTS usuarios (
          login text PRIMARY KEY, senha text NOT NULL, papel text NOT NULL CHECK(papel IN ('anotador','revisor','admin'))
        );
        ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;
        CREATE TABLE IF NOT EXISTS sessoes (
          token text PRIMARY KEY, login text NOT NULL REFERENCES usuarios(login), expira timestamptz NOT NULL
        );
        CREATE TABLE IF NOT EXISTS limites (
          chave text NOT NULL, janela bigint NOT NULL, total integer NOT NULL, PRIMARY KEY(chave,janela)
        );
        CREATE TABLE IF NOT EXISTS tarefas (
          colecao text, pos integer, autor text REFERENCES usuarios(login), estado text NOT NULL,
          expira timestamptz, PRIMARY KEY(colecao,pos), FOREIGN KEY(colecao,pos) REFERENCES comentarios(colecao,pos)
        );
        CREATE TABLE IF NOT EXISTS historico (
          id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, colecao text, pos integer,
          ator text NOT NULL, acao text NOT NULL, anterior jsonb NOT NULL, criado_em timestamptz DEFAULT now()
        );
        ALTER TABLE historico ADD COLUMN IF NOT EXISTS conjunto text;
        CREATE INDEX IF NOT EXISTS historico_ajuste_principal ON historico(colecao,pos,id DESC)
          WHERE acao='ajuste' AND conjunto IS NULL;
        CREATE TABLE IF NOT EXISTS conjuntos (
          colecao text NOT NULL, pos integer NOT NULL, autor text NOT NULL REFERENCES usuarios(login),
          estado text NOT NULL, versao integer NOT NULL, documento jsonb NOT NULL,
          PRIMARY KEY(colecao,pos,autor), FOREIGN KEY(colecao,pos) REFERENCES comentarios(colecao,pos)
        );
        CREATE INDEX IF NOT EXISTS conjuntos_estado ON conjuntos(colecao,estado,pos);
        CREATE INDEX IF NOT EXISTS tarefas_estado_autor ON tarefas(colecao,estado,autor,pos);
        """)
        db.executemany("INSERT OR IGNORE INTO tipos (codigo,nome,cor,descricao) VALUES (?,?,?,?)", tipos)
