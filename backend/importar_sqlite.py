"""Importação inicial, offline, em uma transação. Nunca sobrescreve trabalho."""
import sqlite3
import sys
from contextlib import closing
from pathlib import Path
import json

from psycopg.types.json import Jsonb
from .corpus import iniciar_banco
from .pg_storage import banco_pg, enabled


def importar(caminho):
    if not enabled():
        raise ValueError("Defina YOUTUBENER_APP_DSN.")
    iniciar_banco()
    with closing(sqlite3.connect(Path(caminho).resolve(strict=True).as_uri()+"?mode=ro", uri=True)) as src, banco_pg() as db:
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM colecoes LIMIT 1").fetchone():
            raise ValueError("Destino já tem coleções; não será sobrescrito. Pare a API e use um destino novo.")
        src.execute("BEGIN")
        if src.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("A cópia SQLite não passou na verificação de integridade.")
        db.execute("DELETE FROM tipos")
        db.executemany("INSERT INTO tipos (codigo,nome,cor,descricao,ativo) VALUES (?,?,?,?,?)",
                       src.execute("SELECT codigo,nome,cor,descricao,ativo FROM tipos ORDER BY rowid"))
        db.executemany("INSERT INTO colecoes (id,nome,video_id,total,criado_em,origem) VALUES (?,?,?,?,?,?)",
                       src.execute("SELECT id,nome,video_id,total,criado_em,origem FROM colecoes"))
        total = revisados = spans = 0
        with db.conn.cursor().copy("""COPY comentarios (colecao,pos,texto,revisado,rejeitadas,versao,
                id_origem,anotacao_json,anotado) FROM STDIN""") as copy:
            for linha in src.execute("""SELECT colecao,pos,texto,revisado,rejeitadas,versao,
                    id_origem,anotacao_json,anotado FROM comentarios ORDER BY colecao,pos"""):
                col, pos, texto, rev, rej, versao, id_, doc, marcado = linha
                anotacao = json.loads(doc) if doc else None
                for span in (anotacao or {}).get("spans", []):
                    if not 0 <= span["start"] < span["end"] <= len(texto):
                        raise ValueError(f"Offset inválido em {col}/{pos}. A importação foi revertida.")
                    spans += 1
                copy.write_row((col,pos,texto,rev,Jsonb(json.loads(rej)),versao,id_,Jsonb(anotacao) if anotacao else None,marcado))
                total += 1
                revisados += rev
        esperado = db.execute("SELECT count(*) AS total, coalesce(sum(revisado),0) AS revisados FROM comentarios").fetchone()
        if (esperado["total"],esperado["revisados"]) != (total,revisados):
            raise ValueError("Contagens divergentes. A importação foi revertida.")
    print(f"{total} comentários; {revisados} revisados; {spans} marcações importadas.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Uso: python -m backend.importar_sqlite COPIA.sqlite3")
    importar(sys.argv[1])
