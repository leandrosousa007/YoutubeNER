import os
from pathlib import Path

import requests
from dotenv import load_dotenv


# carrega a chave do arquivo .env
load_dotenv(Path(__file__).with_name(".env"))


class ConfiguracaoYouTubeError(Exception):
    pass


def pegar_chave():
    chave = os.getenv("YOUTUBE_API_KEY", "").strip()
    if not chave:
        raise ConfiguracaoYouTubeError("Configure YOUTUBE_API_KEY no backend/.env.")
    return chave


def buscar_comentarios(video_id, limite_paginas=None):
    url = "https://www.googleapis.com/youtube/v3/commentThreads"
    params = {
        "part": "snippet",
        "videoId": video_id,
        "key": pegar_chave(),
        "maxResults": 100,
        "textFormat": "plainText",
        "order": "time",
    }
    lista_comentarios = []

    # busca uma pagina de cada vez
    paginas = 0
    while limite_paginas is None or paginas < limite_paginas:
        resposta = requests.get(url, params=params, timeout=12 if limite_paginas else 30)
        resposta.raise_for_status()
        dados = resposta.json()
        paginas += 1

        # guarda os dados de cada comentario
        for item in dados.get("items", []):
            comentario = item["snippet"]["topLevelComment"]
            snippet = comentario["snippet"]
            lista_comentarios.append({
                "youtube_id": comentario["id"],
                "autor": snippet.get("authorDisplayName"),
                "texto": snippet.get("textDisplay"),
                "likes": snippet.get("likeCount"),
                "timestamp": snippet.get("publishedAt"),
            })

        next_page = dados.get("nextPageToken")
        if not next_page:
            break
        params["pageToken"] = next_page

    return lista_comentarios
