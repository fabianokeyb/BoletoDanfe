# BoletoDanfe

Leitor de código de barras (boleto, arrecadação, Pix) com associação de DANFE/NF-e,
cadastro manual de nota e exportação em TSV para a planilha. PWA estático (SvelteKit + zxing-wasm).

**App publicado:** https://fabianokeyb.github.io/BoletoDanfe/

## Compras da semana (módulo 02)
Duas seções independentes, como as abas da planilha: **Produção** (embalagens, limpeza, rancho,
insumos, hortifruti; lojas Tijuca e Freguesia) e **Bebidas e salão** (salão, refrigerantes, litros,
cervejas; com origem de compra). Cada seção tem o próprio ciclo em três telas:
1. **Montar** — o catálogo inteiro; toque em + na loja para incluir (usa a última quantidade).
   Item novo entra sem histórico e ganha vínculo com a NF-e depois da primeira compra dele.
   No topo, “Ficaram faltando”: o que não foi comprado em listas anteriores.
2. **Comprar** — ✓ comprado / ✕ em falta por loja, último preço e média lado a lado, preço da
   gôndola contra a média, leitura de EAN e relatórios para WhatsApp.
3. **Fechar** — totais da compra e escolha do que vai para a lista de faltantes; resumo para WhatsApp.

Dados: listas no IndexedDB do aparelho (backup JSON em ⚙︎ → Lojas); preços baixados do Supabase pela
função `public.compras_precos(token)`, que exige o token do aparelho. Na sincronização, itens sem
vínculo recebem sugestão automática quando o nome bate sem ambiguidade (marcada “auto” até confirmar).
O service worker guarda o app: listas e preços já baixados funcionam sem sinal.

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
