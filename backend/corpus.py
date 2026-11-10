import csv
import io
import json
import os
import sqlite3
import unicodedata
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4


PASTA = Path(os.environ.get("YOUTUBENER_DATA_DIR") or Path(__file__).resolve().parents[1] / "comentarios" / "colecoes")
TIPOS_INICIAIS = (
    ("BRAND", "Marca", "#ad3c68", "Nome de marca comercial."),
    ("GROUP", "Grupo", "#4662a9", "Equipes, comunidades e organizações."),
    ("CREATIVE_WORK", "Obra", "#7247a4", "Título de uma obra, vídeo, livro ou música."),
    ("DISEASE", "Doença", "#ad4d40", "Nome de uma doença ou condição."),
    ("EVENT", "Evento", "#ab5c18", "Nome de evento ou encontro."),
    ("PERSON", "Pessoa", "#236e69", "Nome de uma pessoa ou personagem."),
    ("PRICE", "Preço", "#6d6a20", "Valor monetário."),
    ("PRODUCT", "Produto", "#425fa2", "Nome de produto."),
    ("PROFILE", "Perfil", "#765b8c", "Identificador de perfil ou canal."),
    ("PROMOTION", "Promoção", "#aa4360", "Cupom, desconto ou oferta."),
    ("SOFTWARE", "Software", "#4c61a2", "Aplicativo, programa ou plataforma."),
    ("SYMPTOM", "Sintoma", "#ae533f", "Sintoma ou sinal descrito."),
    ("WEIGHT", "Peso", "#1e7269", "Medida de peso."),
    ("LOCATION", "Local", "#397040", "Nome de local geográfico."),
    ("AGE", "Idade", "#886228", "Expressão de idade."),
    ("DURATION", "Duração", "#526e79", "Tempo de duração."),
    ("FREQUENCY", "Frequência", "#24756c", "Repetição ou periodicidade."),
    ("EXERCISE", "Exercício", "#306d4f", "Nome de um exercício físico."),
)


@contextmanager
def banco():
    PASTA.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(PASTA / "anotacoes.sqlite3")
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    try:
        with db:
            yield db
    finally:
        db.close()


def iniciar_banco():
    with banco() as db:
        db.execute("PRAGMA journal_mode = WAL")
        db.executescript("""
        CREATE TABLE IF NOT EXISTS colecoes (
            id TEXT PRIMARY KEY, nome TEXT NOT NULL, video_id TEXT,
            total INTEGER NOT NULL, criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            origem TEXT NOT NULL DEFAULT 'arquivo'
        );
        CREATE TABLE IF NOT EXISTS comentarios (
            colecao TEXT REFERENCES colecoes(id), pos INTEGER, texto TEXT NOT NULL,
            revisado INTEGER NOT NULL DEFAULT 0, rejeitadas TEXT NOT NULL DEFAULT '[]',
            versao INTEGER NOT NULL DEFAULT 0, id_origem TEXT, anotacao_json TEXT,
            anotado INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (colecao, pos)
        );
        CREATE INDEX IF NOT EXISTS progresso ON comentarios(colecao, revisado, pos);
        CREATE TABLE IF NOT EXISTS tipos (
            codigo TEXT PRIMARY KEY, nome TEXT NOT NULL, cor TEXT NOT NULL, descricao TEXT NOT NULL,
            ativo INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS termos (
            id INTEGER PRIMARY KEY, termo TEXT NOT NULL, tipo TEXT REFERENCES tipos(codigo),
            UNIQUE (termo COLLATE NOCASE, tipo)
        );
        CREATE TABLE IF NOT EXISTS entidades (
            colecao TEXT, pos INTEGER, inicio INTEGER, fim INTEGER,
            tipo TEXT NOT NULL REFERENCES tipos(codigo), texto TEXT NOT NULL,
            PRIMARY KEY (colecao, pos, inicio, fim),
            FOREIGN KEY (colecao, pos) REFERENCES comentarios(colecao, pos)
        );
        """)
        db.execute("BEGIN IMMEDIATE")
        if "ativo" not in {c["name"] for c in db.execute("PRAGMA table_info(tipos)")}:
            db.execute("ALTER TABLE tipos ADD COLUMN ativo INTEGER NOT NULL DEFAULT 1")
            codigos = [tipo[0] for tipo in TIPOS_INICIAIS]
            db.execute("UPDATE tipos SET ativo = 0 WHERE codigo NOT IN (" + ",".join("?" for _ in codigos) + ")", codigos)
        if "origem" not in {c["name"] for c in db.execute("PRAGMA table_info(colecoes)")}:
            db.execute("ALTER TABLE colecoes ADD COLUMN origem TEXT NOT NULL DEFAULT 'arquivo'")
        if "id_origem" not in {c["name"] for c in db.execute("PRAGMA table_info(comentarios)")}:
            db.execute("ALTER TABLE comentarios ADD COLUMN id_origem TEXT")
        colunas = {c["name"] for c in db.execute("PRAGMA table_info(comentarios)")}
        if "anotacao_json" not in colunas:
            db.execute("ALTER TABLE comentarios ADD COLUMN anotacao_json TEXT")
        if "anotado" not in colunas:
            db.execute("ALTER TABLE comentarios ADD COLUMN anotado INTEGER NOT NULL DEFAULT 0")
        db.execute("CREATE INDEX IF NOT EXISTS comentarios_anotados ON comentarios(colecao, pos) WHERE anotado = 1")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS origem_comentario ON comentarios(colecao, id_origem) WHERE id_origem IS NOT NULL")
        migrar_anotacoes(db)
        db.executemany("INSERT OR IGNORE INTO tipos (codigo, nome, cor, descricao) VALUES (?, ?, ?, ?)", TIPOS_INICIAIS)


def migrar_anotacoes(db):
    antigos = db.execute("""SELECT e.colecao, e.pos, e.inicio, e.fim, e.tipo
        FROM entidades e JOIN comentarios c USING (colecao, pos)
        WHERE c.anotacao_json IS NULL ORDER BY e.colecao, e.pos, e.inicio""")
    grupos = {}
    for r in antigos:
        grupos.setdefault((r["colecao"], r["pos"]), []).append(
            {"id": uuid4().hex, "start": r["inicio"], "end": r["fim"], "label": r["tipo"]})
    db.executemany("UPDATE comentarios SET anotacao_json = ?, anotado = 1 WHERE colecao = ? AND pos = ?",
                   ((json.dumps({"spans": spans, "relations": []}, ensure_ascii=False), *chave) for chave, spans in grupos.items()))


def _normalizar(nome):
    return "".join(c for c in unicodedata.normalize("NFD", nome.strip().lower()) if not unicodedata.combining(c))


def ler_csv(conteudo):
    texto = conteudo.decode("utf-8-sig")
    aliases = {"texto", "comentario", "comentarios", "text", "comment", "comment_text", "textdisplay", "textoriginal"}
    candidatos = []
    for sep in (";", ",", "\t"):
        leitor = csv.reader(io.StringIO(texto, newline=""), delimiter=sep, strict=True)
        try:
            primeira = next((linha for linha in leitor if any(c.strip() for c in linha)), None)
        except csv.Error:
            continue
        if not primeira:
            continue
        coluna = next((i for i, nome in enumerate(primeira) if _normalizar(nome) in aliases), None)
        if coluna is not None:
            candidatos.append((2, len(primeira), coluna, primeira, leitor, True))
        elif len(primeira) == 4 and (not primeira[2].strip() or primeira[2].strip().isdigit()):
            candidatos.append((1, 4, 1, primeira, leitor, False))
    if not candidatos:
        raise ValueError("Use o CSV do YouTubeNER ou um CSV com uma coluna texto, comentario ou comment.")
    _, largura, coluna, primeira, leitor, cabecalho = max(candidatos, key=lambda c: c[:2])
    textos = [] if cabecalho or not primeira[coluna].strip() else [primeira[coluna]]
    for linha in leitor:
        if not any(c.strip() for c in linha):
            continue
        if len(linha) != largura:
            raise ValueError(f"O CSV tem um registro com colunas fora do padrão na linha {leitor.line_num}.")
        if linha[coluna].strip():
            textos.append(linha[coluna])
    return textos


def gerar_csv(comentarios):
    arquivo = io.StringIO(newline="")
    escritor = csv.writer(arquivo, delimiter=";", quoting=csv.QUOTE_ALL)
    escritor.writerows((c["autor"], c["texto"], c["likes"], c["timestamp"]) for c in comentarios)
    return arquivo.getvalue().encode("utf-8")


def salvar_colecao(nome, video_id, conteudo, textos):
    if not textos:
        raise ValueError("Não há comentários com texto neste conjunto.")
    colecao = uuid4().hex
    with banco() as db:
        pasta = PASTA / colecao
        pasta.mkdir()
        arquivo = pasta / "comentarios.csv"
        try:
            arquivo.write_bytes(conteudo)
            db.execute("INSERT INTO colecoes (id, nome, video_id, total) VALUES (?, ?, ?, ?)",
                       (colecao, nome, video_id, len(textos)))
            db.executemany("INSERT INTO comentarios (colecao, pos, texto) VALUES (?, ?, ?)",
                           ((colecao, pos, texto) for pos, texto in enumerate(textos, 1)))
            db.commit()
        except BaseException:
            arquivo.unlink(missing_ok=True)
            pasta.rmdir()
            raise
    return {"id": colecao, "nome": nome, "video_id": video_id, "total": len(textos), "revisados": 0, "origem": "arquivo"}


def espelhar_comentarios(colecao, nome, registros):
    """Anexa apenas IDs novos. O texto já importado é a base imutável dos offsets."""
    with banco() as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("INSERT OR IGNORE INTO colecoes (id, nome, total, origem) VALUES (?, ?, 0, 'postgres')", (colecao, nome))
        anterior = db.execute("SELECT total FROM colecoes WHERE id = ?", (colecao,)).fetchone()["total"]
        conhecidos = {r[0] for r in db.execute("SELECT id_origem FROM comentarios WHERE colecao = ?", (colecao,))}
        novos = []
        for id_origem, texto in registros:
            if id_origem not in conhecidos and texto is not None and texto.strip():
                novos.append((colecao, anterior + len(novos) + 1, texto, id_origem))
                conhecidos.add(id_origem)
        db.executemany("INSERT INTO comentarios (colecao, pos, texto, id_origem) VALUES (?, ?, ?, ?)", novos)
        if novos:
            db.execute("UPDATE colecoes SET total = ? WHERE id = ?", (anterior + len(novos), colecao))
        return len(novos)
