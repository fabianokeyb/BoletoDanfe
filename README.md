# BoletoDanfe

Leitor de código de barras (boleto, arrecadação, Pix) com associação de DANFE/NF-e,
cadastro manual de nota e exportação em TSV para a planilha. PWA estático (SvelteKit + zxing-wasm).

**App publicado:** https://fabianokeyb.github.io/BoletoDanfe/

## Desenvolvimento
```
pnpm install
pnpm dev      # http://127.0.0.1:5173
pnpm test     # testes unitários (node --test)
pnpm build    # saída estática em build/
```

## Deploy
Push na branch `main` dispara o workflow `.github/workflows/deploy.yml`, que compila com
`BASE_PATH=/BoletoDanfe` e publica no GitHub Pages. Nada roda no servidor — é 100% client-side.
