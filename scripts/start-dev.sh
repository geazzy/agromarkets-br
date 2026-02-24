#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ensure_dependencies() {
  if [[ ! -x "$ROOT_DIR/node_modules/.bin/vite" ]]; then
    echo "Dependências do frontend ausentes. Executando npm install na raiz..."
    npm --prefix "$ROOT_DIR" install
  fi

  if [[ ! -d "$ROOT_DIR/backend/node_modules/express" ]]; then
    echo "Dependências do backend ausentes. Executando npm install no backend..."
    npm --prefix "$ROOT_DIR/backend" install
  fi
}

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ -n "${FRONTEND_PID:-}" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

ensure_dependencies

npm --prefix "$ROOT_DIR/backend" run dev &
BACKEND_PID=$!

npm --prefix "$ROOT_DIR" run dev -- --host &
FRONTEND_PID=$!

wait "$BACKEND_PID" "$FRONTEND_PID"
