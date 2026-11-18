"""Converte uma cópia SQLite legada em acervo fixo e anotações separadas.

Nunca modifica a origem. Interrompa a anotação durante a troca de versão.
"""
import argparse
import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path


def preparar(origem: Path, destino: Path):
    destino.mkdir(parents=True, exist_ok=True)
    acervo = destino / "acervo.sqlite3"
    anotacoes = destino / "anotacoes.sqlite3"
    if acervo.exists() or anotacoes.exists():
        raise SystemExit("Destino já contém dados. Use uma pasta nova para não sobrescrever anotações.")
    if not origem.is_file():
        raise SystemExit("Arquivo de origem não encontrado.")
    # backup() inclui as transações confirmadas no WAL da origem.
    with closing(sqlite3.connect(origem.as_uri() + "?mode=ro", uri=True)) as src, closing(sqlite3.connect(anotacoes)) as ann:
        src.backup(ann)
    sha = hashlib.sha256()
    with closing(sqlite3.connect(anotacoes)) as ann, closing(sqlite3.connect(acervo)) as corpus:
        corpus.execute("CREATE TABLE textos (colecao TEXT NOT NULL, pos INTEGER NOT NULL, id_origem TEXT, texto TEXT NOT NULL, PRIMARY KEY(colecao,pos))")
        total = 0
        for linha in ann.execute("SELECT colecao,pos,id_origem,texto FROM comentarios ORDER BY colecao,pos"):
            corpus.execute("INSERT INTO textos VALUES (?,?,?,?)", linha)
            sha.update((json.dumps(linha, ensure_ascii=False, separators=(',', ':')) + '\n').encode())
            total += 1
        corpus.execute("CREATE UNIQUE INDEX ids ON textos(colecao,id_origem) WHERE id_origem IS NOT NULL")
        corpus.commit()
        # A cópia integral original continua intacta. O arquivo mutável fica só com as marcações.
        ann.execute("PRAGMA foreign_keys=OFF")
        ann.execute("DROP TABLE IF EXISTS entidades")
        ann.execute("DROP TABLE IF EXISTS termos")
        ann.execute("DELETE FROM comentarios WHERE versao=0 AND revisado=0 AND anotado=0 AND rejeitadas='[]'")
        ann.execute("ALTER TABLE comentarios RENAME TO anotacoes")
        ann.execute("ALTER TABLE anotacoes DROP COLUMN texto")
        ann.execute("UPDATE colecoes SET origem='acervo'")
        ann.execute("UPDATE colecoes SET nome='Comentários do YouTube' WHERE nome LIKE 'PostgreSQL%'")
        ann.commit()
        ann.execute("VACUUM")
        resumo = dict(total=total, revisados=ann.execute("SELECT COUNT(*) FROM anotacoes WHERE revisado=1").fetchone()[0],
                      anotados=ann.execute("SELECT COUNT(*) FROM anotacoes WHERE anotado=1").fetchone()[0],
                      sha256_textos=sha.hexdigest(), offsets="Unicode code points; start inclusivo, end exclusivo")
    (destino / "acervo.manifest.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(resumo, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origem", type=Path, required=True)
    parser.add_argument("--destino", type=Path, default=Path(__file__).resolve().parents[1] / "data")
    args = parser.parse_args()
    preparar(args.origem.resolve(), args.destino.resolve())
