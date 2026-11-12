import {converter, dimensao, ehUnidade, UNIDADE_EXIBICAO, type Dimensao, type Unidade} from './unidades.ts'

/** Insumo do Saipos como vem do Supabase (`unidade` = unidade de controle do custo). */
export interface InsumoInfo {
  id: number
  descricao: string
  grupo: string | null
  unidade: Unidade
  /** Peso/volume de 1 un para insumos contáveis (ex.: blend 150 g). */
  conteudo: number | null
  unidadeConteudo: Unidade | null
}

/** Produto de fornecedor (cProd por raiz de CNPJ), com o conteúdo físico de cada uCom. */
export interface ProdutoInfo {
  /** `raizCnpj:codigo` */
  chave: string
  fornecedor: string
  descricao: string
  gtin: string | null
  categoria: string
  /** Saipos id do insumo vinculado, quando houver. */
  insumo: number | null
  embalagens: Record<string, [number, Unidade]> | null
}

/** Compra de um item de NF: [chave:nItem, data ISO, fornecedor, produto, uCom, qCom, custo R$, qtd no insumo]. */
export type ObsBruta = [string, string, string, string, string, number, number, number | null]

/** Snapshot devolvido por `public.compras_precos`. */
export interface Snapshot {
  geradoEm: string
  insumos: InsumoInfo[]
  produtos: ProdutoInfo[]
  obs: ObsBruta[]
}

/** O que liga um item da lista ao histórico: um insumo do Saipos ou um produto específico. */
export type Vinculo = {tipo: 'insumo', id: number} | {tipo: 'produto', chave: string}

/** Uma compra já convertida para a unidade de comparação do item. */
export interface Compra {
  data: string
  fornecedor: string
  descricao: string
  uCom: string
  qCom: number
  total: number
  /** Preço por 1 uCom (o que aparece na gôndola/nota). */
  precoEmbalagem: number
  /** Conteúdo de 1 uCom, quando conhecido (ex.: "900 ml"). */
  embalagem?: string
  /** Preço por unidade de comparação (R$/kg, R$/L, R$/un). */
  precoUnit: number
  quantidade: number
}

export interface Resumo {
  unidade: Unidade
  /** Rótulo da unidade de comparação, ex. "un (900 ml)". */
  unidadeDescricao?: string
  /** Conteúdo de 1 un quando a unidade é contável (ex.: óleo = 900 ml): permite comparar por ml. */
  conteudoUnitario?: [number, Unidade]
  compras: Compra[]
  ultima?: Compra
  media?: number
  /** true quando não houve compra na janela e a média cobre todo o histórico. */
  mediaHistorico: boolean
  janelaDias: number
  min?: number
  max?: number
}

/** Índices montados uma vez por snapshot. */
export interface Indice {
  snapshot: Snapshot
  insumos: Map<number, InsumoInfo>
  produtos: Map<string, ProdutoInfo>
  porGtin: Map<string, ProdutoInfo>
  obsPorProduto: Map<string, ObsBruta[]>
  produtosPorInsumo: Map<number, ProdutoInfo[]>
}

/**
 * Monta os índices de consulta de um snapshot.
 * @param snapshot dados do Supabase
 */
export function indexar(snapshot: Snapshot): Indice {
  const insumos = new Map(snapshot.insumos.map(i => [i.id, i]))
  const produtos = new Map(snapshot.produtos.map(p => [p.chave, p]))
  const porGtin = new Map<string, ProdutoInfo>()
  const produtosPorInsumo = new Map<number, ProdutoInfo[]>()
  for (const p of snapshot.produtos) {
    if (p.gtin) porGtin.set(p.gtin.replace(/^0+/, ''), p)
    if (p.insumo != null) produtosPorInsumo.set(p.insumo, [...(produtosPorInsumo.get(p.insumo) ?? []), p])
  }
  const obsPorProduto = new Map<string, ObsBruta[]>()
  for (const o of snapshot.obs) obsPorProduto.set(o[3], [...(obsPorProduto.get(o[3]) ?? []), o])
  return {snapshot, insumos, produtos, porGtin, obsPorProduto, produtosPorInsumo}
}

/**
 * Produto pelo código de barras (EAN/GTIN), ignorando zeros à esquerda (EAN-13 × GTIN-14).
 * @param indice índices do snapshot
 * @param gtin código lido
 */
export function produtoPorGtin(indice: Indice, gtin: string): ProdutoInfo | undefined {
  return indice.porGtin.get(gtin.replace(/\D/g, '').replace(/^0+/, ''))
}

/**
 * Chaves de produto cobertas pelos vínculos (produto direto ou via insumo).
 * @param indice índices
 * @param vinculos vínculos do item
 */
export function produtosDosVinculos(indice: Indice, vinculos: Vinculo[]): Set<string> {
  const chaves = new Set<string>()
  for (const v of vinculos) {
    if (v.tipo === 'produto') chaves.add(v.chave)
    else for (const p of indice.produtosPorInsumo.get(v.id) ?? []) chaves.add(p.chave)
  }
  return chaves
}

/** Quantidade de uma compra numa unidade física, preferindo a do insumo vinculado. */
function quantidadeDaObs(indice: Indice, o: ObsBruta, insumosItem: Set<number>): {qtd: number, unidade: Unidade} | undefined {
  const produto = indice.produtos.get(o[3])
  const insumo = produto?.insumo != null ? indice.insumos.get(produto.insumo) : undefined
  if (insumo && insumosItem.has(insumo.id) && o[7] != null && ehUnidade(insumo.unidade)) return {qtd: o[7], unidade: insumo.unidade}
  const emb = produto?.embalagens?.[o[4]]
  if (emb && ehUnidade(emb[1])) return {qtd: o[5] * emb[0], unidade: emb[1]}
  return undefined
}

/** Formata o conteúdo da embalagem, ex. "900 ml", "2,5 kg", "12 un". */
export function formatarConteudo(qtd: number, u: Unidade): string {
  const n = Number(qtd.toFixed(3)).toLocaleString('pt-BR', {maximumFractionDigits: 3})
  return `${n} ${u === 'l' ? 'L' : u}`
}

/**
 * Resumo de preços de um item: compras convertidas, última, média ponderada na janela, mín e máx.
 * A unidade de comparação é a do insumo quando todos os vínculos de insumo concordam;
 * senão, kg / L / un pela dimensão mais frequente nas compras.
 * @param indice índices do snapshot
 * @param vinculos vínculos do item
 * @param janelaDias janela da média (0 = todo o histórico)
 * @param hoje data de referência ISO (padrão: hoje)
 * @returns resumo, ou undefined se não houver compra comparável
 */
export function resumir(indice: Indice, vinculos: Vinculo[], janelaDias = 90, hoje = new Date().toISOString().slice(0, 10)): Resumo | undefined {
  const insumosItem = new Set(vinculos.flatMap(v => v.tipo === 'insumo' ? [v.id] : []))
  const chaves = produtosDosVinculos(indice, vinculos)
  const brutas = [...chaves].flatMap(k => indice.obsPorProduto.get(k) ?? [])
  if (!brutas.length) return undefined

  const comQtd = brutas.flatMap(o => {const q = quantidadeDaObs(indice, o, insumosItem); return q && q.qtd > 0 ? [{o, q}] : []})
  if (!comQtd.length) return undefined

  const contagem = new Map<Dimensao, number>()
  for (const {q} of comQtd) contagem.set(dimensao(q.unidade), (contagem.get(dimensao(q.unidade)) ?? 0) + 1)
  const dim = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const unidadesInsumo = new Set([...insumosItem].map(id => indice.insumos.get(id)?.unidade).filter((u): u is Unidade => !!u && dimensao(u) === dim))
  const unidade: Unidade = unidadesInsumo.size === 1 ? [...unidadesInsumo][0] : UNIDADE_EXIBICAO[dim]
  let unidadeDescricao: string | undefined
  let conteudoUnitario: [number, Unidade] | undefined
  if (unidade === 'un' && insumosItem.size === 1) {
    const ins = indice.insumos.get([...insumosItem][0])
    if (ins?.conteudo && ins.unidadeConteudo && ehUnidade(ins.unidadeConteudo)) {
      unidadeDescricao = `un de ${formatarConteudo(ins.conteudo, ins.unidadeConteudo)}`
      conteudoUnitario = [ins.conteudo, ins.unidadeConteudo]
    }
  }

  const compras: Compra[] = comQtd.flatMap(({o, q}) => {
    const quantidade = converter(q.qtd, q.unidade, unidade)
    if (quantidade == null || quantidade <= 0) return []
    const produto = indice.produtos.get(o[3])
    const emb = produto?.embalagens?.[o[4]]
    return [{
      data: o[1], fornecedor: o[2], descricao: produto?.descricao ?? o[3], uCom: o[4], qCom: o[5], total: o[6],
      precoEmbalagem: o[6] / o[5],
      embalagem: emb && ehUnidade(emb[1]) ? formatarConteudo(emb[0], emb[1]) : undefined,
      precoUnit: o[6] / quantidade,
      quantidade
    }]
  }).sort((a, b) => a.data.localeCompare(b.data))
  if (!compras.length) return undefined

  const limite = janelaDias > 0 ? new Date(Date.parse(hoje) - janelaDias * 864e5).toISOString().slice(0, 10) : ''
  const janela = compras.filter(c => c.data >= limite)
  const base = janela.length ? janela : compras
  const soma = base.reduce((s, c) => s + c.total, 0)
  const qtd = base.reduce((s, c) => s + c.quantidade, 0)
  const unitarios = base.map(c => c.precoUnit)
  return {
    unidade, unidadeDescricao, conteudoUnitario, compras,
    ultima: compras.at(-1),
    media: qtd > 0 ? soma / qtd : undefined,
    mediaHistorico: !janela.length,
    janelaDias,
    min: Math.min(...unitarios),
    max: Math.max(...unitarios)
  }
}

export type Veredito = 'barato' | 'na-media' | 'caro'

export interface Comparacao {
  precoUnit: number
  vsMedia?: number
  vsUltima?: number
  veredito?: Veredito
}

/**
 * Compara o preço visto na gôndola com o histórico do item.
 * @param resumo resumo do item
 * @param preco preço da embalagem na gôndola (R$)
 * @param qtd conteúdo da embalagem
 * @param unidade unidade do conteúdo
 * @param tolerancia faixa considerada "na média" (fração, padrão 3%)
 * @returns comparação, ou undefined se a unidade não é conversível
 */
export function compararGondola(resumo: Resumo, preco: number, qtd: number, unidade: Unidade, tolerancia = 0.03): Comparacao | undefined {
  if (!(preco > 0) || !(qtd > 0)) return undefined
  let q = converter(qtd, unidade, resumo.unidade)
  if (q == null && resumo.conteudoUnitario) {
    const [c, u] = resumo.conteudoUnitario
    const emConteudo = converter(qtd, unidade, u)
    q = emConteudo == null ? null : emConteudo / c
  }
  if (q == null || q <= 0) return undefined
  const precoUnit = preco / q
  const vsMedia = resumo.media ? precoUnit / resumo.media - 1 : undefined
  const vsUltima = resumo.ultima ? precoUnit / resumo.ultima.precoUnit - 1 : undefined
  const ref = vsMedia ?? vsUltima
  const veredito: Veredito | undefined = ref == null ? undefined : ref <= -tolerancia ? 'barato' : ref >= tolerancia ? 'caro' : 'na-media'
  return {precoUnit, vsMedia, vsUltima, veredito}
}

/**
 * Formata reais no padrão brasileiro.
 * @param v valor em reais
 * @param casas casas decimais (padrão 2)
 */
export function reais(v: number, casas = 2): string {
  return v.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL', minimumFractionDigits: casas, maximumFractionDigits: casas})
}
