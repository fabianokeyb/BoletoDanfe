# BoletoDanfe

Leitor de código de barras (boleto, arrecadação, Pix) com associação de DANFE/NF-e,
cadastro manual de nota e exportação em TSV para a planilha. PWA estático (SvelteKit + zxing-wasm).

**App publicado:** https://fabianokeyb.github.io/BoletoDanfe/

## Compras da semana (módulo 02)
Listas por loja (Freguesia, Tijuca) e pessoais, num catálogo único de itens. Cada item se vincula a
um insumo do Saipos ou a um produto de NF-e, e mostra o **último preço** e a **média ponderada**
(30/90/180 dias ou todo o histórico) lado a lado, na unidade do insumo (R$/kg, R$/L, R$/un).
- Preço na gôndola: informe preço e embalagem → % contra a média e contra a última compra.
- Ler EAN: a câmera lê o código do produto e abre o item da lista (ou mostra o histórico e oferece incluir).
- Relatórios para WhatsApp (completo, pendentes + não encontrados, só pendentes, só não encontrados).
- Dados: listas no IndexedDB do aparelho (backup JSON em Listas); preços baixados do Supabase pela
  função `public.compras_precos(token)`, que exige o token do aparelho (só o hash fica no banco).
- Offline: o service worker guarda o app e os assets; listas e preços já baixados funcionam sem sinal.

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
