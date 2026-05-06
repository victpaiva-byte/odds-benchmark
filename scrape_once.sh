#!/usr/bin/env bash
# Executa uma coleta avulsa (sem subir o servidor).
# Útil para testar scrapers ou forçar atualização manual.
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

source .venv/bin/activate 2>/dev/null || { echo "Rode run.sh primeiro para configurar o ambiente"; exit 1; }

echo "=== Coleta avulsa de Super Odds ==="
python main.py
echo "=== Concluído — verifique data/odds.json ==="
