#!/bin/sh
# Execute no servidor; o backup no navegador também produz um snapshot consistente.
set -eu
stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p backups
chmod 700 backups
docker compose exec -T app python -c 'import sqlite3,sys; from contextlib import closing; from backend.corpus import PASTA; from pathlib import Path; p=PASTA / ("backup-"+sys.argv[1]+".sqlite3"); src=sqlite3.connect(PASTA / "anotacoes.sqlite3"); dst=sqlite3.connect(p); src.backup(dst); dst.execute("DELETE FROM sessoes"); dst.execute("DELETE FROM limites"); dst.commit(); dst.close(); src.close()' "$stamp"
mv "data/backup-$stamp.sqlite3" "backups/anotacoes-$stamp.sqlite3"
chmod 600 "backups/anotacoes-$stamp.sqlite3"
printf 'Backup: %s\n' "backups/anotacoes-$stamp.sqlite3"
