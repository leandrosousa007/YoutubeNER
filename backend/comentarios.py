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


def buscar_comentarios(video_id):
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
    while True:
        resposta = requests.get(url, params=params, timeout=30)
        resposta.raise_for_status()
        dados = resposta.json()

        # guarda os dados de cada comentario
        for item in dados.get("items", []):
            snippet = item["snippet"]["topLevelComment"]["snippet"]
            lista_comentarios.append({
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
