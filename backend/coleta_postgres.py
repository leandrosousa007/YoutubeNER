from datetime import datetime, timezone

import psycopg

if __package__:
    from .postgres_sync import _config
else:
    from postgres_sync import _config


def _data_utc(valor):
    if not valor:
        return None
    data = datetime.fromisoformat(valor)
    if data.tzinfo is not None:
        return data.astimezone(timezone.utc).replace(tzinfo=None)
    return data


def gravar_coleta(video_id, comentarios):
    dsn = _config()["DSN"]
    if not dsn:
        raise ValueError("Configure a conexão com o PostgreSQL antes de adicionar comentários.")
    vistos = set()
    registros = []
    for item in comentarios:
        id_ = item.get("youtube_id")
        texto = item.get("texto")
        if not id_ or id_ in vistos or not texto or not texto.strip():
            continue
        vistos.add(id_)
        registros.append((len(registros), id_, item.get("autor"), texto, item.get("likes"), _data_utc(item.get("timestamp"))))
    if not registros:
        return {"inseridos": 0, "ja_existiam": 0, "coletados": 0}

    with psycopg.connect(dsn, connect_timeout=5) as con:
        con.execute("SET LOCAL lock_timeout = '12s'")
        con.execute("SET LOCAL statement_timeout = '90s'")
        # Serializa a alocação de IDs e o vínculo com comentários históricos.
        con.execute("LOCK TABLE dataset.comentario IN SHARE ROW EXCLUSIVE MODE")
        if not con.execute("SELECT to_regclass('dataset.youtubener_origem')").fetchone()[0]:
            con.execute("""
            CREATE TABLE IF NOT EXISTS dataset.youtubener_origem (
                youtube_comment_id text PRIMARY KEY,
                video_id text NOT NULL,
                comentario_id integer NOT NULL UNIQUE
                    REFERENCES dataset.comentario(id) ON DELETE CASCADE
            )
        """)
        con.execute("""CREATE TEMP TABLE coleta_ytn (
            ordem integer, youtube_id text PRIMARY KEY, autor text, texto text NOT NULL,
            likes integer, dia_hora timestamp
        ) ON COMMIT DROP""")
        with con.cursor().copy("COPY coleta_ytn FROM STDIN") as entrada:
            for registro in registros:
                entrada.write_row(registro)
        con.execute("ANALYZE coleta_ytn")
        # Registros antigos não têm ID do YouTube. Vincula os que coincidirem
        # exatamente por autor, texto e data UTC, um para um.
        con.execute("""
            WITH pendentes AS (
                SELECT i.*, row_number() OVER
                    (PARTITION BY i.autor, i.texto, i.dia_hora ORDER BY i.ordem) AS ocorrencia
                FROM coleta_ytn i
                WHERE NOT EXISTS (SELECT FROM dataset.youtubener_origem o WHERE o.youtube_comment_id=i.youtube_id)
                AND i.autor IS NOT NULL AND i.dia_hora IS NOT NULL
            ), chaves AS (
                SELECT DISTINCT autor, texto, dia_hora FROM pendentes
            ), antigos AS (
                SELECT c.id, c.autor, c.texto, c.dia_hora, row_number() OVER
                    (PARTITION BY c.autor, c.texto, c.dia_hora ORDER BY c.id) AS ocorrencia
                FROM dataset.comentario c JOIN chaves k USING (autor, texto, dia_hora)
                WHERE NOT EXISTS (SELECT FROM dataset.youtubener_origem o WHERE o.comentario_id=c.id)
            )
            INSERT INTO dataset.youtubener_origem (youtube_comment_id, video_id, comentario_id)
                SELECT p.youtube_id, %s, a.id
                FROM pendentes p JOIN antigos a USING (autor, texto, dia_hora, ocorrencia)
        """, (video_id,))

        maior = con.execute("SELECT max(id) FROM dataset.comentario").fetchone()[0]
        ultimo, usado = con.execute("SELECT last_value, is_called FROM dataset.comentario_id_seq").fetchone()
        if maior is not None and (maior > ultimo or (maior == ultimo and not usado)):
            con.execute("SELECT setval('dataset.comentario_id_seq', %s, true)", (maior,))
        inseridos = con.execute("""
            WITH novos AS MATERIALIZED (
                SELECT i.*, nextval('dataset.comentario_id_seq')::integer AS id_pg
                FROM coleta_ytn i
                WHERE NOT EXISTS (SELECT FROM dataset.youtubener_origem o WHERE o.youtube_comment_id=i.youtube_id)
                ORDER BY i.ordem
            ), gravados AS (
                INSERT INTO dataset.comentario (id, autor, texto, likes, dia_hora)
                    SELECT id_pg, autor, texto, likes, dia_hora FROM novos RETURNING id
            )
            INSERT INTO dataset.youtubener_origem (youtube_comment_id, video_id, comentario_id)
                SELECT n.youtube_id, %s, n.id_pg FROM novos n JOIN gravados g ON g.id=n.id_pg
        """, (video_id,)).rowcount
    return {"inseridos": inseridos, "ja_existiam": len(registros) - inseridos, "coletados": len(registros)}
