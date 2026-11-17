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

## Fichas técnicas (módulo 03)
Registro da produção contra a ficha técnica (`#/fichas`). Por receita, o cozinheiro marca **Segui a
ficha** ou digita só o que foi diferente, **pesa o rendimento** (obrigatório sempre) e toca em
**Finalizar receita**. kg e L são digitados como calculadora (1200 → 1,200); desvio acima de
50% pede um segundo toque antes de finalizar. Só funcionários autorizados (`src/lib/fichas/funcionarios.ts`) finalizam.
Quantas receitas foram feitas é calculado, não perguntado: mediana das proporções usado/ficha,
ponderada pela raiz do peso de cada ingrediente; ingredientes fora dessa proporção (>3%) aparecem
como alteração, e o rendimento é comparado com ficha × receitas feitas. "Fazer outro lote" registra
mais de um lote no dia; "corrigir" reabre um lote finalizado. Lojas: Freguesia (THBF, verde) e
Tijuca (THBT, azul), cada uma com o próprio cozinheiro e as próprias receitas em andamento; cada lote
leva a loja e o cozinheiro de quem o começou.

Dados: cada mudança é gravada na hora no IndexedDB do aparelho (bateria acabando não perde nada).
Lote finalizado entra numa fila e sobe para o Supabase pela função `public.fichas_registrar(token, lote)`
(tabelas `producao.lote` e `producao.lote_ingrediente`, com a ficha da época congelada). O id do
lote nasce no aparelho, então reenvio e correção atualizam em vez de duplicar. A fila tenta de novo
ao voltar o sinal, ao reabrir o app e a cada 45 s. Consulta: views `analise.v_producao_lote` e
`analise.v_producao_ingrediente`.

Sem configuração no celular: o código da cozinha vai embutido (`TOKEN_COZINHA` em
`src/lib/fichas/enviar.ts`). Ele é público por desenho e tem poder mínimo: escopo `fichas` só grava
produção, e o servidor só aceita cozinheiro ativo em `producao.funcionario`. O resumo do dia sai pelo WhatsApp (`wa.me`), só com receitas finalizadas.

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
