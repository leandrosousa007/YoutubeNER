# Ambiente de desenvolvimento local: sem login, apenas no computador.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) { py -3 -m venv .venv }
& .\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar o backend.' }
Push-Location frontend
try {
    if (-not (Test-Path -LiteralPath 'node_modules')) { npm ci }
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar o frontend.' }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o frontend.' }
} finally { Pop-Location }
Write-Host 'Abra http://127.0.0.1:8000. Para encerrar, Ctrl+C.'
& .\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
