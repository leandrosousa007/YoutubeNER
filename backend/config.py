"""Configuração independente de serviços de banco de dados."""
import os


def enabled():
    return os.getenv("YOUTUBENER_AUTH", "0") == "1" or os.getenv("YOUTUBENER_PRODUCTION", "0") == "1"


def production():
    return os.getenv("YOUTUBENER_PRODUCTION", "0") == "1"
