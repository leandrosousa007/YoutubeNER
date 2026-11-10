import logging
import os
import re
from functools import lru_cache

_rotulos_modelo = {"PER": "PERSON", "ORG": "GROUP", "LOC": "LOCATION"}
_legado = {"PER": "PERSON", "ORG": "GROUP", "LOC": "LOCATION"}
_medidas = {
    "WEIGHT": r"(?<!\w)\d+(?:[.,]\d+)?\s*(?:kg|quilos?|quilogramas?)(?!\w)",
    "AGE": r"(?<!\w)\d{1,3}\s*anos\s+de\s+idade(?!\w)",
    "DURATION": r"(?<!\w)\d+(?:[.,]\d+)?\s*(?:minutos?|horas?|segundos?)(?!\w)",
    "FREQUENCY": r"(?<!\w)(?:(?:\d+|uma|duas|três|quatro|cinco)\s+vez(?:es)?(?:\s+(?:por|na|ao)\s+(?:dia|semana|mês))?|todos os dias|todo dia|diariamente|semanalmente)(?!\w)",
    "PRICE": r"(?<!\w)(?:R\$\s*\d+(?:[.,]\d+)*|\d+(?:[.,]\d+)*\s*reais)(?!\w)",
    "PROFILE": r"(?<![\w@.])@[\w.-]*[\w-]",
}
_padroes_medidas = [(tipo, re.compile(padrao, re.IGNORECASE)) for tipo, padrao in _medidas.items()]

@lru_cache(maxsize=1)
def modelo_local():
    nome = os.getenv("YOUTUBENER_NER_MODEL", "pt_core_news_sm").strip()
    if not nome:
        return None
    try:
        import spacy

        return spacy.load(nome, enable=["tok2vec", "ner"])
    except (ImportError, OSError, ValueError):
        logging.getLogger(__name__).info("Modelo NER local indisponível; usando o vocabulário.")
        return None


@lru_cache(maxsize=4096)
def _padrao(termo):
    return re.compile(r"(?<!\w)" + re.escape(termo) + r"(?!\w)", re.IGNORECASE)


def sugerir(texto, vocabulario, entidades, rejeitadas):
    existentes = {(r["inicio"], r["fim"], r["tipo"]) for r in rejeitadas}
    candidatas = []

    def adicionar(inicio, fim, tipo, origem):
        chave = (inicio, fim, tipo)
        if chave not in existentes and not any(inicio < e["fim"] and fim > e["inicio"] for e in entidades):
            existentes.add(chave)
            candidatas.append({"inicio": inicio, "fim": fim, "tipo": tipo, "texto": texto[inicio:fim], "origem": origem})

    for termo, tipo, origem in vocabulario:
        for match in _padrao(termo).finditer(texto):
            adicionar(*match.span(), _legado.get(tipo, tipo), origem)

    for tipo, padrao in _padroes_medidas:
        for match in padrao.finditer(texto):
            adicionar(*match.span(), tipo, "Padrão de texto")

    modelo = modelo_local()
    if modelo is not None and len(texto) < modelo.max_length:
        try:
            entidades_modelo = modelo(texto).ents
        except Exception:
            logging.getLogger(__name__).warning("O modelo NER não processou este comentário.")
        else:
            for entidade in entidades_modelo:
                if entidade.label_ in _rotulos_modelo:
                    adicionar(entidade.start_char, entidade.end_char, _rotulos_modelo[entidade.label_], "Modelo de português")

    return sorted(candidatas, key=lambda e: (e["inicio"], -e["fim"], e["tipo"]))[:50]
