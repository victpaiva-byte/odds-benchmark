#!/usr/bin/env bash
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "=== Odds Benchmark — Setup & Run ==="

# Cria .env se não existir
if [ ! -f .env ]; then
  cp .env.example .env
  echo "⚠️  Arquivo .env criado a partir do .env.example — preencha ROAM_WEBHOOK_URL"
fi

# Instala dependências Python
if [ ! -d ".venv" ]; then
  echo "→ Criando virtualenv..."
  python3 -m venv .venv
fi

source .venv/bin/activate
pip install -q -r requirements.txt

# Instala browsers do Playwright (só na primeira vez)
if [ ! -d "$HOME/.cache/ms-playwright" ] && [ ! -d "$HOME/Library/Caches/ms-playwright" ]; then
  echo "→ Instalando Chromium (Playwright)..."
  playwright install chromium --with-deps
fi

mkdir -p data

echo "→ Iniciando servidor na porta ${SERVER_PORT:-8080}..."
echo "   Dashboard: http://localhost:${SERVER_PORT:-8080}"
echo "   Dados:     http://localhost:${SERVER_PORT:-8080}/data"
echo "   Saúde:     http://localhost:${SERVER_PORT:-8080}/health"
echo ""
echo "   Pressione Ctrl+C para parar."
echo ""

python server.py
