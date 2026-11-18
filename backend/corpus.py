"""Acervo imutável + arquivo transacional de anotações (SQLite/WAL)."""
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

PASTA = Path(os.environ.get("YOUTUBENER_DATA_DIR") or Path(__file__).resolve().parents[1] / "data")
ACERVO = PASTA / "acervo.sqlite3"

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
def banco_anotacoes():
    db = sqlite3.connect(PASTA / "anotacoes.sqlite3", timeout=15, uri=True)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA synchronous=NORMAL")
    try:
        with db:
            yield db
    finally:
        db.close()


@contextmanager
def banco():
    if not ACERVO.is_file():
        raise RuntimeError("Prepare o acervo com python -m backend.preparar_acervo --origem CAMINHO_DO_SQLITE_ANTIGO")
    with banco_anotacoes() as db:
        db.execute("ATTACH DATABASE ? AS acervo", (ACERVO.resolve().as_uri() + "?mode=ro&immutable=1",))
        db.executescript("""
            CREATE TEMP VIEW comentarios AS
            SELECT t.colecao,t.pos,t.id_origem,t.texto,COALESCE(a.revisado,0) AS revisado,
              COALESCE(a.rejeitadas,'[]') AS rejeitadas,COALESCE(a.versao,0) AS versao,
              a.anotacao_json,COALESCE(a.anotado,0) AS anotado
            FROM acervo.textos t LEFT JOIN main.anotacoes a USING(colecao,pos);
            CREATE TEMP TRIGGER salvar_comentario INSTEAD OF UPDATE ON comentarios BEGIN
              INSERT INTO anotacoes(colecao,pos,id_origem,revisado,rejeitadas,versao,anotacao_json,anotado)
              VALUES(NEW.colecao,NEW.pos,NEW.id_origem,NEW.revisado,NEW.rejeitadas,NEW.versao,NEW.anotacao_json,NEW.anotado)
              ON CONFLICT(colecao,pos) DO UPDATE SET revisado=excluded.revisado,rejeitadas=excluded.rejeitadas,
                versao=excluded.versao,anotacao_json=excluded.anotacao_json,anotado=excluded.anotado;
            END;
        """)
        yield db


def iniciar_banco():
    PASTA.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(PASTA / "anotacoes.sqlite3")
    try:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""
        CREATE TABLE IF NOT EXISTS colecoes (
          id TEXT PRIMARY KEY,nome TEXT NOT NULL,video_id TEXT,total INTEGER NOT NULL,
          criado_em TEXT DEFAULT CURRENT_TIMESTAMP,origem TEXT DEFAULT 'acervo');
        CREATE TABLE IF NOT EXISTS anotacoes (
          colecao TEXT NOT NULL,pos INTEGER NOT NULL,id_origem TEXT,revisado INTEGER DEFAULT 0,
          rejeitadas TEXT DEFAULT '[]',versao INTEGER DEFAULT 0,anotacao_json TEXT,anotado INTEGER DEFAULT 0,
          PRIMARY KEY(colecao,pos));
        CREATE INDEX IF NOT EXISTS progresso_anotacoes ON anotacoes(colecao,revisado,pos);
        CREATE TABLE IF NOT EXISTS tipos (
          codigo TEXT PRIMARY KEY,nome TEXT NOT NULL,cor TEXT NOT NULL,descricao TEXT NOT NULL,ativo INTEGER DEFAULT 1);
        CREATE TABLE IF NOT EXISTS usuarios (
          login TEXT PRIMARY KEY,senha TEXT NOT NULL,papel TEXT NOT NULL CHECK(papel IN ('anotador','revisor','admin')),
          ativo INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS sessoes (
          token TEXT PRIMARY KEY,login TEXT REFERENCES usuarios(login),expira TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS limites (
          chave TEXT,janela INTEGER,total INTEGER,PRIMARY KEY(chave,janela));
        CREATE TABLE IF NOT EXISTS tarefas (
          colecao TEXT,pos INTEGER,autor TEXT REFERENCES usuarios(login),estado TEXT NOT NULL,expira TEXT,
          PRIMARY KEY(colecao,pos));
        CREATE INDEX IF NOT EXISTS tarefas_estado_autor ON tarefas(colecao,estado,autor,pos);
        CREATE TABLE IF NOT EXISTS historico (
          id INTEGER PRIMARY KEY,colecao TEXT,pos INTEGER,ator TEXT NOT NULL,acao TEXT NOT NULL,
          anterior TEXT NOT NULL,criado_em TEXT DEFAULT CURRENT_TIMESTAMP,conjunto TEXT);
        CREATE INDEX IF NOT EXISTS historico_ajuste_principal ON historico(colecao,pos,id DESC) WHERE acao='ajuste' AND conjunto IS NULL;
        CREATE TABLE IF NOT EXISTS conjuntos (
          colecao TEXT,pos INTEGER,autor TEXT REFERENCES usuarios(login),estado TEXT NOT NULL,
          versao INTEGER NOT NULL,documento TEXT NOT NULL,PRIMARY KEY(colecao,pos,autor));
        CREATE INDEX IF NOT EXISTS conjuntos_estado ON conjuntos(colecao,estado,pos);
        """)
        db.executemany("INSERT OR IGNORE INTO tipos(codigo,nome,cor,descricao) VALUES(?,?,?,?)", TIPOS_INICIAIS)
        db.commit()
    finally:
        db.close()
    with banco():
        pass
