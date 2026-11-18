"""Regressões do armazenamento local e colaboração. Não toca no acervo de trabalho."""
import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
import time
import unittest
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient


class AcervoTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="ytn-test-")
        cls.dir = Path(cls.temp.name)
        fonte = Path(__file__).resolve().parents[1] / "data"
        shutil.copyfile(fonte / "acervo.sqlite3", cls.dir / "acervo.sqlite3")
        with closing(sqlite3.connect(fonte / "anotacoes.sqlite3")) as src, closing(sqlite3.connect(cls.dir / "anotacoes.sqlite3")) as dst:
            src.backup(dst)
        os.environ["YOUTUBENER_AUTH"] = "1"
        from . import corpus
        cls.original_dir, cls.original_corpus = corpus.PASTA, corpus.ACERVO
        corpus.PASTA, corpus.ACERVO = cls.dir, cls.dir / "acervo.sqlite3"
        from . import admin_api
        admin_api.PASTA = cls.dir
        from .main import app
        from .security import senha_codificada
        corpus.iniciar_banco()
        with corpus.banco() as db:
            cls.cid = db.execute("SELECT id FROM colecoes").fetchone()[0]
            senha = senha_codificada("teste-privado-12345")
            for nome, papel in [("testadmin", "admin"), ("testana", "anotador"), ("testbia", "anotador")]:
                db.execute("INSERT INTO usuarios(login,senha,papel) VALUES(?,?,?)", (nome,senha,papel))
        cls.prefix = "/api/colecoes/" + cls.cid
        cls.hash = hashlib.sha256(corpus.ACERVO.read_bytes()).hexdigest()
        cls.clients = {}
        for nome in ("testadmin", "testana", "testbia"):
            c = TestClient(app, headers={"Origin": "http://testserver"})
            r = c.post("/api/auth/login", json={"login":nome,"senha":"teste-privado-12345"})
            assert r.status_code == 200, r.text
            cls.clients[nome] = c
        cls.admin = cls.clients["testadmin"]

    @classmethod
    def tearDownClass(cls):
        from . import corpus, admin_api
        assert hashlib.sha256(corpus.ACERVO.read_bytes()).hexdigest() == cls.hash
        corpus.PASTA, corpus.ACERVO = cls.original_dir, cls.original_corpus
        admin_api.PASTA = cls.original_dir
        for c in cls.clients.values():
            c.close()
        cls.temp.cleanup()
        os.environ.pop("YOUTUBENER_AUTH", None)

    def get_comment(self, pos, client=None):
        r = (client or self.admin).get(f"{self.prefix}/comentarios/{pos}")
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def payload(self, c, revisado=False):
        return dict(versao=c["versao"],entidades=c["entidades"],rejeitadas=c["rejeitadas"],relacoes=c["relacoes"],revisado=revisado)

    def test_auth_and_origin(self):
        from .main import app
        with TestClient(app) as c:
            self.assertEqual(c.get("/api/colecoes").status_code,401)
            self.assertEqual(c.get("/api/auth/me").json()["protegido"],True)
        r = self.admin.post(self.prefix+"/proximo", headers={"Origin":"https://outro.test"})
        self.assertEqual(r.status_code,403)
        self.assertEqual(self.clients["testana"].get("/api/admin/usuarios").status_code,403)
        self.assertEqual(self.admin.post("/api/coleta/postgres",json={"video_id":"abcdefghijk"}).status_code,405)

    def test_pages_and_original_ids(self):
        tempos=[]
        for start in (1,21,41,61,81,101,10001,30001,58001):
            t=time.perf_counter()
            r=self.admin.get(self.prefix+f"/pagina?inicio={start}&tamanho=20")
            tempos.append((time.perf_counter()-t)*1000)
            self.assertEqual(r.status_code,200,r.text)
            self.assertEqual(len(r.json()["comentarios"]),20)
            for c in r.json()["comentarios"]:
                self.assertIn("rejeitadas",c)
                self.assertEqual(self.admin.get(self.prefix+"/por-id",params={"id":c["id"]}).json()["pos"],c["pos"])
        print("Páginas (teste local, autenticação incluída): mediana %.1f ms; máximo %.1f ms" % (sorted(tempos)[len(tempos)//2],max(tempos)))

    def test_two_reservations_and_review(self):
        ana,bia=self.clients["testana"],self.clients["testbia"]
        a=ana.post(self.prefix+"/proximo?depois=50000").json()["pos"]
        b=bia.post(self.prefix+"/proximo?depois=50000").json()["pos"]
        self.assertNotEqual(a,b)
        c=self.get_comment(a,ana)
        self.assertEqual(bia.put(f"{self.prefix}/comentarios/{a}",json=self.payload(c)).status_code,403)
        body=self.payload(c,True)
        body["entidades"]=[dict(id=uuid4().hex,inicio=0,fim=1,tipo="PERSON")]
        r=ana.put(f"{self.prefix}/comentarios/{a}",json=body)
        self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(r.json()["comentario"]["estado"],"enviado")
        self.assertFalse(r.json()["comentario"]["revisado"])
        reviewed=self.admin.put(f"{self.prefix}/comentarios/{a}",json=self.payload(r.json()["comentario"],True))
        self.assertEqual(reviewed.status_code,200,reviewed.text)
        self.assertTrue(reviewed.json()["comentario"]["revisado"])
        self.assertIsInstance(self.admin.get(f"{self.prefix}/comentarios/{a}/historico").json()[0]["anterior"],dict)

    def test_same_version_conflict_and_unicode(self):
        from .corpus import banco
        with banco() as db:
            pos=db.execute("SELECT pos FROM acervo.textos WHERE pos>40000 AND instr(texto,'😀')>0 LIMIT 1").fetchone()
        pos=pos[0] if pos else 40001
        c=self.get_comment(pos)
        body=self.payload(c)
        end=min(len(c["texto"]),4)
        body["entidades"]=[dict(id=uuid4().hex,inicio=0,fim=end,tipo="PERSON")]
        with ThreadPoolExecutor(max_workers=2) as pool:
            res=list(pool.map(lambda _:self.admin.put(f"{self.prefix}/comentarios/{pos}",json=body),range(2)))
        self.assertEqual(sorted(r.status_code for r in res),[200,409])
        saved=self.get_comment(pos)
        self.assertEqual(saved["entidades"][0]["texto"],c["texto"][:end])
        self.assertEqual(saved["id"],c["id"])

    def test_independent_sets_relations_and_exports(self):
        pos=45001
        ana=self.clients["testana"]
        c=ana.get(f"{self.prefix}/comentarios/{pos}?conjunto=testana").json()
        a,b=uuid4().hex,uuid4().hex
        body=self.payload(c)
        body["entidades"]=[dict(id=a,inicio=0,fim=1,tipo="PERSON"),dict(id=b,inicio=2,fim=3,tipo="PERSON")]
        body["relacoes"]=[dict(id=uuid4().hex,source=a,target=b,label="relacionado")]
        r=ana.put(f"{self.prefix}/comentarios/{pos}?conjunto=testana",json=body)
        self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(len(r.json()["comentario"]["relacoes"]),1)
        self.assertEqual(len(self.admin.get(f"{self.prefix}/comentarios/{pos}/conjuntos").json()),1)
        for suffix in ("/anotacoes/grupos","/anotacoes/itens?tipo=PERSON","/anotacoes.csv","/anotacoes.jsonl","/exportar?formato=jsonl&autor=testana&tipo=PERSON","/exportar?formato=csv&texto=a","/busca?tipo=PERSON&autor=testana"):
            r=self.admin.get(self.prefix+suffix)
            self.assertEqual(r.status_code,200,r.text[:300])
        out=self.admin.get(self.prefix+"/exportar?autor=testana").text
        docs=[json.loads(line) for line in out.splitlines()]
        self.assertTrue(any(d["pos"]==pos and d["relacoes"][0]["source"]==a for d in docs))

    def test_backup_and_immutable_corpus(self):
        from .corpus import banco
        with banco() as db:
            with self.assertRaises(sqlite3.OperationalError):
                db.execute("DELETE FROM acervo.textos")
        r=self.admin.post("/api/admin/backup")
        self.assertEqual(r.status_code,200,r.text[:100] if r.status_code!=200 else "")
        path=self.dir/"download.sqlite3"
        path.write_bytes(r.content)
        with closing(sqlite3.connect(path)) as db:
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0],"ok")
            self.assertEqual(db.execute("SELECT COUNT(*) FROM sessoes").fetchone()[0],0)
            self.assertGreater(db.execute("SELECT COUNT(*) FROM anotacoes").fetchone()[0],0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
