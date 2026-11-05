#!/usr/bin/env bash
# Gera as capturas PROVISÓRIAS da landing (site/src/assets/app/*.png) a partir dos HTML desta pasta,
# com o Chrome em modo headless, em 2x (560×1160). O Astro converte para WebP no build.
# Quando houver capturas do aplicativo real, substitua os PNG e apague esta pasta.
set -euo pipefail
cd "$(dirname "$0")"
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
out="../src/assets/app"
mkdir -p "$out"
for tela in conversas conversa agenda; do
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --window-size=280,580 --screenshot="$out/$tela.png" "file://$PWD/$tela.html" >/dev/null 2>&1
  echo "gerada: $out/$tela.png"
done
