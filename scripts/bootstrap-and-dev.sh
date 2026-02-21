#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Instalando dependências do frontend..."
npm --prefix "$ROOT_DIR" install

echo "Instalando dependências do backend..."
npm --prefix "$ROOT_DIR/backend" install

echo "Iniciando frontend + backend..."
npm --prefix "$ROOT_DIR" run dev:all
