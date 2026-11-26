#!/bin/zsh -l
# Abre o THB com 1 clique: atualiza do GitHub (se tiver internet), compila e abre no navegador.
# Funciona offline com a última versão baixada. Feche esta janela para parar.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
PORTA=5175
URL="http://127.0.0.1:$PORTA"

if lsof -nP -iTCP:$PORTA -sTCP:LISTEN >/dev/null 2>&1; then open "$URL"; exit 0; fi
if ! command -v node >/dev/null || ! command -v pnpm >/dev/null; then
  echo "Falta o Node ou o pnpm. Rode no Terminal:  brew install node pnpm"; read -k1; exit 1
fi

ANTES="$(git rev-parse HEAD 2>/dev/null)"
echo "Versão: $(git branch --show-current 2>/dev/null) ${ANTES:0:7}"
if [[ -z "$(git status --porcelain 2>/dev/null)" ]]; then
  echo "Buscando atualizações do GitHub..."
  GIT_TERMINAL_PROMPT=0 git pull --ff-only --quiet 2>/dev/null && echo "  ok" || echo "  sem internet ou sem novidades — usando a versão local"
else
  echo "Há mudanças locais — não vou baixar por cima delas."
fi
DEPOIS="$(git rev-parse HEAD 2>/dev/null)"

if [[ ! -d node_modules ]] || [[ "$ANTES" != "$DEPOIS" && -n "$(git diff --name-only "$ANTES" "$DEPOIS" -- pnpm-lock.yaml package.json)" ]]; then
  echo "Instalando dependências..."; pnpm install --frozen-lockfile --prefer-offline || { read -k1; exit 1; }
fi

if [[ ! -f build/index.html || "$(cat build/.versao 2>/dev/null)" != "$DEPOIS" || -n "$(git status --porcelain -- src static)" ]]; then
  echo "Compilando..."; pnpm build >/dev/null || { echo "Erro na compilação."; read -k1; exit 1; }
  echo "$DEPOIS" > build/.versao
fi

(sleep 1; open "$URL") &
PORTA=$PORTA exec node scripts/servidor-local.mjs
