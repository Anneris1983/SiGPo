#!/usr/bin/env bash
# Instala Playwright (si falta) y corre el smoke-test.
set -e
cd "$(dirname "$0")"

if [ ! -f credenciales.json ]; then
  echo "⚠️  Falta credenciales.json."
  echo "    Copialo y completá las contraseñas:"
  echo "      cp credenciales.example.json credenciales.json"
  exit 2
fi

if [ ! -d node_modules/playwright ]; then
  echo "📦 Instalando Playwright…"
  npm init -y >/dev/null 2>&1 || true
  npm install playwright
  npx playwright install chromium
fi

echo "🚀 Corriendo smoke-test…"
node smoke.js
