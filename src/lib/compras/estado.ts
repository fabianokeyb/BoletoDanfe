import type {Vinculo} from './precos.ts'
import {ehUnidade, type Unidade} from './unidades.ts'

/**
 * Compras em duas seções independentes, como as duas abas da planilha:
 * produção (insumos, embalagens, limpeza, rancho, hortifruti) e bebidas/salão.
 * Cada seção tem o próprio ciclo: montar a lista → comprar → fechar.
 */
export type Secao = 'producao' | 'bebidas'
export const SECOES: {id: Secao, nome: string, emoji: string}[] = [
  {id: 'producao', nome: 'Produção', emoji: '🍔'},
  {id: 'bebidas', nome: 'Bebidas e salão', emoji: '🥤'}
]

export const GRUPOS: Record<Secao, string[]> = {
  producao: ['Embalagens', 'Limpeza', 'Rancho', 'Insumos', 'Hortifruti', 'Outros'],
  bebidas: ['Salão', 'Refrigerantes', 'Litros', 'Cervejas', 'Outros']
}
export const EMOJI_GRUPO: Record<string, string> = {
  'Embalagens': '📦', 'Limpeza': '🧹', 'Rancho': '🍲', 'Insumos': '🥫', 'Hortifruti': '🥬', 'Outros': '📌',
  'Salão': '🍽️', 'Refrigerantes': '🥤', 'Litros': '🧃', 'Cervejas': '🍺'
}
export const ORIGENS = ['Mercado', 'Açougue', 'Casas Pedro', 'SuperPreço', 'Kalunga', 'Byll', 'Stone']
export const CORES = ['#1f6a43', '#2f6f9f', '#a35d1f', '#7b3fa0', '#a3324a', '#4d6b2b']

/** Loja/lista de destino (Tijuca, Freguesia, Casa…) e as seções em que aparece. */
export interface Lista {
  id: string
  nome: string
  sigla: string
  tipo: 'loja' | 'pessoal'
  cor: string
  ordem: number
  secoes: Secao[]
}

/** Item do catálogo do que se compra com frequência. */
export interface Item {
  id: string
  nome: string
  /** Unidade como a loja usa: "un", "kg", "2,8 kg", "900 ml", "fd", "cx". */
  unidade: string
  secao: Secao
  grupo: string
  origem: string
  /** Conteúdo numérico da embalagem, para comparar preço na gôndola (derivado da unidade quando dá). */
  embalagem?: {qtd: number, unidade: Unidade}
  vinculos: Vinculo[]
  /** Vínculo criado automaticamente na sincronização, aguardando confirmação. */
  vinculoAuto?: boolean
  /** Última quantidade comprada por lista (de compras encerradas): ponto de partida do +. */
  ultimaQtd: Record<string, number>
  criadoEm: number
}

export type Status = 'pendente' | 'comprado' | 'indisponivel'

/** Item escolhido para a lista da semana, numa loja. */
export interface Entrada {
  listaId: string
  itemId: string
  quantidade: number
  status: Status
  atualizadoEm: number
  /** Veio da lista de faltantes de uma compra anterior (rótulo dela). */
  herdada?: string
}

/** Item que faltou numa compra e ainda precisa ser comprado. */
export interface Faltante {
  itemId: string
  listaId: string
  quantidade: number
  desde: string
}

export interface Pesquisa {
  preco: number
  qtd: number
  unidade: Unidade
  em: number
}

export type Etapa = 'montar' | 'comprar' | 'fechar'

export interface Ciclo {
  etapa: Etapa
  /** Rótulo da compra (data em que foi para o mercado). */
  nome: string
  desde: number
}

/** Compra encerrada, guardada para consulta. */
export interface CompraFechada {
  id: string
  secao: Secao
  nome: string
  fechadaEm: number
  itens: {itemId: string, nome: string, unidade: string, listaId: string, quantidade: number, status: Status}[]
}

export interface EstadoCompras {
  versao: 3
  listas: Lista[]
  itens: Item[]
  entradas: Entrada[]
  faltantes: Faltante[]
  pesquisa: Record<string, Pesquisa>
  ciclos: Record<Secao, Ciclo>
  historico: CompraFechada[]
}

const CICLO_NOVO: Ciclo = {etapa: 'montar', nome: '', desde: 0}
export const ESTADO_INICIAL: EstadoCompras = {
  versao: 3, listas: [], itens: [], entradas: [], faltantes: [], pesquisa: {},
  ciclos: {producao: {...CICLO_NOVO}, bebidas: {...CICLO_NOVO}}, historico: []
}
const MAX_HISTORICO = 40

/** Id curto e único. */
export function novoId(): string {
  const c = globalThis.crypto as Crypto | undefined
  return c?.randomUUID ? c.randomUUID().slice(0, 13) : Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/**
 * Normaliza texto para comparar e buscar: minúsculas, sem acento, espaços simples.
 * @param s texto
 */
export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Separa "Óleo Garrafa (900 ml)" em nome e unidade. Vários parênteses viram "350 ml · c/6".
 * @param texto nome como na planilha
 */
export function separarUnidade(texto: string): {nome: string, unidade: string} {
  const partes: string[] = []
  let nome = texto.trim()
  for (let m = nome.match(/\s*\(([^()]*)\)\s*$/); m; m = nome.match(/\s*\(([^()]*)\)\s*$/)) {
    partes.unshift(m[1].trim())
    nome = nome.slice(0, m.index).trim()
  }
  return {nome: nome.replace(/\s+/g, ' '), unidade: partes.join(' · ')}
}

/**
 * Conteúdo numérico de uma unidade de loja: "2,8 kg" → 2,8 kg; "kg" → 1 kg; "L" → 1 l;
 * "un" → 1 un; "900 ml" → 900 ml. Unidades de embalagem (fd, cx, pct) não têm conteúdo conhecido.
 * @param unidade texto da unidade
 */
export function embalagemDaUnidade(unidade: string): {qtd: number, unidade: Unidade} | undefined {
  const u = normalizar(unidade).split('·')[0].replace(/\s/g, '')
  const m = u.match(/^(\d+(?:[.,]\d+)?)?(kg|g|ml|l|un)$/)
  if (!m) return undefined
  const qtd = m[1] ? Number(m[1].replace(',', '.')) : 1
  return qtd > 0 && ehUnidade(m[2]) ? {qtd, unidade: m[2]} : undefined
}

/**
 * Ordem do grupo dentro da seção (desconhecidos no fim).
 * @param secao seção
 * @param g grupo
 */
export function ordemGrupo(secao: Secao, g: string): number {
  const i = GRUPOS[secao].indexOf(g)
  return i < 0 ? 99 : i
}

/** Nome do item com a unidade, como vai no relatório e na tela: "Óleo Garrafa (900 ml)". */
export function rotuloItem(i: Pick<Item, 'nome' | 'unidade'>): string {
  return i.unidade ? `${i.nome} (${i.unidade})` : i.nome
}

/**
 * Item vendido a granel por peso ou volume (unidade "kg" ou "L" sem tamanho de embalagem):
 * quantidade com até 3 casas decimais. Os demais (un, fd, cx, 900 ml, 2,8 kg…) contam embalagens: inteiro.
 * @param i item
 */
export function qtdDecimal(i: Pick<Item, 'unidade'>): boolean {
  const u = normalizar(i.unidade).replace(/\s/g, '')
  return u === 'kg' || u === 'l'
}

/**
 * Ajusta uma quantidade à regra do item: 3 casas para kg/L, inteiro para o resto; nunca negativa.
 * @param i item
 * @param n quantidade
 */
export function ajustarQtd(i: Pick<Item, 'unidade'>, n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0
  return qtdDecimal(i) ? Math.round(n * 1000) / 1000 : Math.round(n)
}

/**
 * Lê o que foi digitado ("1,5", "1.5", "40") como número; vazio ou inválido = 0.
 * @param texto texto do campo
 */
export function lerQtd(texto: string): number {
  const t = texto.trim().replace(',', '.')
  return /^\d*\.?\d*$/.test(t) && t !== '' && t !== '.' ? Number(t) : 0
}

/**
 * Quantidade no padrão brasileiro: 1,5 · 0,125 · 40.
 * @param n quantidade
 */
export function formatarQtd(n: number): string {
  return n.toLocaleString('pt-BR', {maximumFractionDigits: 3})
}

/**
 * Listas que participam de uma seção, na ordem.
 * @param e estado
 * @param secao seção
 */
export function listasDaSecao(e: EstadoCompras, secao: Secao): Lista[] {
  return e.listas.filter(l => l.secoes.includes(secao)).sort((a, b) => a.ordem - b.ordem)
}

// ------------------------------------------------------------------ listas

/**
 * Cria uma lista (loja ou pessoal).
 * @param e estado
 * @param nome nome
 * @param tipo loja ou pessoal
 * @param secoes seções em que aparece
 */
export function criarLista(e: EstadoCompras, nome: string, tipo: Lista['tipo'] = 'loja', secoes: Secao[] = ['producao', 'bebidas']): {estado: EstadoCompras, lista: Lista} {
  const limpo = nome.trim() || 'Nova lista'
  const lista: Lista = {
    id: novoId(), nome: limpo, tipo, secoes,
    sigla: limpo.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1).toUpperCase() || 'L',
    cor: CORES[e.listas.length % CORES.length],
    ordem: Math.max(0, ...e.listas.map(l => l.ordem + 1))
  }
  return {estado: {...e, listas: [...e.listas, lista]}, lista}
}

/**
 * Altera uma lista.
 * @param e estado
 * @param id lista
 * @param campos campos novos
 */
export function atualizarLista(e: EstadoCompras, id: string, campos: Partial<Omit<Lista, 'id'>>): EstadoCompras {
  return {...e, listas: e.listas.map(l => l.id === id ? {...l, ...campos} : l)}
}

/**
 * Remove a lista, as entradas e os faltantes dela.
 * @param e estado
 * @param id lista
 */
export function removerLista(e: EstadoCompras, id: string): EstadoCompras {
  return {...e, listas: e.listas.filter(l => l.id !== id), entradas: e.entradas.filter(x => x.listaId !== id), faltantes: e.faltantes.filter(f => f.listaId !== id)}
}

// ------------------------------------------------------------------ itens

export type DadosItem = Pick<Item, 'nome' | 'secao' | 'grupo'> & Partial<Pick<Item, 'unidade' | 'origem' | 'embalagem' | 'vinculos'>>

/**
 * Cria um item. Sem embalagem informada, deriva da unidade ("2,8 kg").
 * Item novo não tem vínculo: ele é ligado a uma compra depois da primeira NF-e dele.
 * @param e estado
 * @param d dados
 */
export function criarItem(e: EstadoCompras, d: DadosItem, agora = Date.now()): {estado: EstadoCompras, item: Item} {
  const unidade = (d.unidade ?? '').trim()
  const item: Item = {
    id: novoId(), nome: d.nome.trim(), unidade, secao: d.secao, grupo: d.grupo || 'Outros', origem: d.origem || 'Mercado',
    embalagem: d.embalagem ?? embalagemDaUnidade(unidade), vinculos: d.vinculos ?? [], ultimaQtd: {}, criadoEm: agora
  }
  return {estado: {...e, itens: [...e.itens, item]}, item}
}

/**
 * Altera um item.
 * @param e estado
 * @param id item
 * @param campos campos novos
 */
export function atualizarItem(e: EstadoCompras, id: string, campos: Partial<Omit<Item, 'id' | 'criadoEm'>>): EstadoCompras {
  return {...e, itens: e.itens.map(i => i.id === id ? {...i, ...campos} : i)}
}

/**
 * Remove o item de tudo (catálogo, lista atual, faltantes, preço de gôndola).
 * @param e estado
 * @param id item
 */
export function removerItem(e: EstadoCompras, id: string): EstadoCompras {
  const {[id]: _, ...pesquisa} = e.pesquisa
  return {...e, itens: e.itens.filter(i => i.id !== id), entradas: e.entradas.filter(x => x.itemId !== id), faltantes: e.faltantes.filter(f => f.itemId !== id), pesquisa}
}

// ------------------------------------------------------------------ montar

/**
 * Põe, altera ou tira (quantidade 0) um item da lista atual de uma loja.
 * A quantidade é ajustada à regra do item (kg/L com 3 casas, demais inteiros).
 * @param e estado
 * @param listaId loja
 * @param itemId item
 * @param quantidade quantidade numérica
 */
export function definirQuantidade(e: EstadoCompras, listaId: string, itemId: string, quantidade: number, agora = Date.now(), herdada?: string): EstadoCompras {
  const item = e.itens.find(i => i.id === itemId)
  const q = item ? ajustarQtd(item, quantidade) : 0
  const existe = e.entradas.find(x => x.listaId === listaId && x.itemId === itemId)
  if (!q) return existe ? {...e, entradas: e.entradas.filter(x => x !== existe)} : e
  if (existe) return {...e, entradas: e.entradas.map(x => x === existe ? {...x, quantidade: q, atualizadoEm: agora} : x)}
  return {...e, entradas: [...e.entradas, {listaId, itemId, quantidade: q, status: 'pendente', atualizadoEm: agora, ...(herdada ? {herdada} : {})}]}
}

/**
 * Faltantes de compras anteriores, de uma seção, que ainda não estão na lista atual.
 * @param e estado
 * @param secao seção
 */
export function faltantesAbertos(e: EstadoCompras, secao: Secao): Faltante[] {
  const itens = new Map(e.itens.map(i => [i.id, i]))
  return e.faltantes.filter(f => itens.get(f.itemId)?.secao === secao && !e.entradas.some(x => x.itemId === f.itemId && x.listaId === f.listaId))
}

/**
 * Coloca faltantes na lista atual (com a quantidade que faltou).
 * @param e estado
 * @param quais faltantes escolhidos
 */
export function incluirFaltantes(e: EstadoCompras, quais: Faltante[], agora = Date.now()): EstadoCompras {
  return quais.reduce((s, f) => definirQuantidade(s, f.listaId, f.itemId, f.quantidade, agora, f.desde), e)
}

/**
 * Descarta um faltante (não precisa mais comprar).
 * @param e estado
 * @param f faltante
 */
export function descartarFaltante(e: EstadoCompras, f: Pick<Faltante, 'itemId' | 'listaId'>): EstadoCompras {
  return {...e, faltantes: e.faltantes.filter(x => !(x.itemId === f.itemId && x.listaId === f.listaId))}
}

/**
 * Entradas da lista atual de uma seção.
 * @param e estado
 * @param secao seção
 */
export function entradasDaSecao(e: EstadoCompras, secao: Secao): Entrada[] {
  const itens = new Map(e.itens.map(i => [i.id, i]))
  return e.entradas.filter(x => itens.get(x.itemId)?.secao === secao)
}

/**
 * Avança a etapa da seção. Ao ir para o mercado, a compra ganha o rótulo do dia.
 * @param e estado
 * @param secao seção
 * @param etapa etapa nova
 * @param rotulo rótulo da compra, se ainda não tiver
 */
export function irPara(e: EstadoCompras, secao: Secao, etapa: Etapa, rotulo: string, agora = Date.now()): EstadoCompras {
  const c = e.ciclos[secao]
  return {...e, ciclos: {...e.ciclos, [secao]: {etapa, nome: c.nome || rotulo, desde: c.desde || agora}}}
}

// ------------------------------------------------------------------ comprar

/**
 * Marca uma entrada; tocar de novo no mesmo status volta para pendente.
 * @param e estado
 * @param listaId loja
 * @param itemId item
 * @param status status tocado
 */
export function alternarStatus(e: EstadoCompras, listaId: string, itemId: string, status: Exclude<Status, 'pendente'>, agora = Date.now()): EstadoCompras {
  return {...e, entradas: e.entradas.map(x => x.listaId === listaId && x.itemId === itemId
    ? {...x, status: x.status === status ? 'pendente' : status, atualizadoEm: agora} : x)}
}

/**
 * Marca todas as lojas de um item de uma vez.
 * @param e estado
 * @param itemId item
 * @param status status
 */
export function marcarItem(e: EstadoCompras, itemId: string, status: Status, agora = Date.now()): EstadoCompras {
  return {...e, entradas: e.entradas.map(x => x.itemId === itemId ? {...x, status, atualizadoEm: agora} : x)}
}

/**
 * Guarda ou apaga o preço visto na gôndola.
 * @param e estado
 * @param itemId item
 * @param p pesquisa (undefined apaga)
 */
export function registrarPesquisa(e: EstadoCompras, itemId: string, p?: Pesquisa): EstadoCompras {
  const {[itemId]: _, ...resto} = e.pesquisa
  return {...e, pesquisa: p && p.preco > 0 ? {...resto, [itemId]: p} : resto}
}

/**
 * Contagem por status.
 * @param entradas entradas consideradas
 */
export function contar(entradas: Entrada[]): Record<Status, number> {
  const m: Record<Status, number> = {pendente: 0, comprado: 0, indisponivel: 0}
  for (const x of entradas) m[x.status]++
  return m
}

// ------------------------------------------------------------------ fechar

/**
 * Encerra a compra de uma seção: guarda no histórico, lembra as quantidades,
 * leva os itens escolhidos para a lista de faltantes e libera a seção para a próxima lista.
 * @param e estado
 * @param secao seção
 * @param levar entradas (não compradas) que continuam precisando ser compradas
 */
export function fecharCompra(e: EstadoCompras, secao: Secao, levar: {itemId: string, listaId: string}[], agora = Date.now()): EstadoCompras {
  const itens = new Map(e.itens.map(i => [i.id, i]))
  const daSecao = entradasDaSecao(e, secao)
  const ciclo = e.ciclos[secao]
  const nome = ciclo.nome || new Date(agora).toLocaleDateString('pt-BR')
  const leva = (x: Entrada) => x.status !== 'comprado' && levar.some(l => l.itemId === x.itemId && l.listaId === x.listaId)
  const fechada: CompraFechada = {
    id: novoId(), secao, nome, fechadaEm: agora,
    itens: daSecao.map(x => {const i = itens.get(x.itemId)!; return {itemId: x.itemId, nome: i.nome, unidade: i.unidade, listaId: x.listaId, quantidade: x.quantidade, status: x.status}})
  }
  const tocados = new Set(daSecao.map(x => `${x.itemId}|${x.listaId}`))
  const faltantes = [
    ...e.faltantes.filter(f => !tocados.has(`${f.itemId}|${f.listaId}`)),
    ...daSecao.filter(leva).map(x => ({itemId: x.itemId, listaId: x.listaId, quantidade: x.quantidade, desde: x.herdada ?? nome}))
  ]
  const ultima = new Map<string, Record<string, number>>()
  for (const x of daSecao) ultima.set(x.itemId, {...(ultima.get(x.itemId) ?? itens.get(x.itemId)!.ultimaQtd), [x.listaId]: x.quantidade})
  const pesquisa = Object.fromEntries(Object.entries(e.pesquisa).filter(([id]) => itens.get(id)?.secao !== secao))
  return {
    ...e,
    itens: e.itens.map(i => ultima.has(i.id) ? {...i, ultimaQtd: ultima.get(i.id)!} : i),
    entradas: e.entradas.filter(x => itens.get(x.itemId)?.secao !== secao),
    faltantes, pesquisa,
    ciclos: {...e.ciclos, [secao]: {...CICLO_NOVO}},
    historico: [fechada, ...e.historico].slice(0, MAX_HISTORICO)
  }
}

// ------------------------------------------------------------------ relatórios

const ICONE: Record<Status, string> = {comprado: '✅', indisponivel: '❌', pendente: '⬜'}
export type ModoRelatorio = 'tudo' | 'abertos' | 'pendentes' | 'faltou'

function blocosPorLista(e: EstadoCompras, secao: Secao, entradas: Entrada[], linha: (x: Entrada, i: Item) => string): string[] {
  const itens = new Map(e.itens.map(i => [i.id, i]))
  const out: string[] = []
  for (const lista of listasDaSecao(e, secao)) {
    const daLista = entradas.filter(x => x.listaId === lista.id && itens.has(x.itemId))
    if (!daLista.length) continue
    out.push('', `🏪 *${lista.nome.toUpperCase()}*`)
    const grupos = [...new Set(daLista.map(x => itens.get(x.itemId)!.grupo))].sort((a, b) => ordemGrupo(secao, a) - ordemGrupo(secao, b) || a.localeCompare(b))
    for (const g of grupos) {
      out.push(`_${EMOJI_GRUPO[g] ?? '📌'} ${g}_`)
      daLista.filter(x => itens.get(x.itemId)!.grupo === g)
        .sort((a, b) => itens.get(a.itemId)!.nome.localeCompare(itens.get(b.itemId)!.nome, 'pt-BR'))
        .forEach(x => out.push(linha(x, itens.get(x.itemId)!)))
    }
  }
  return out
}

function titulo(e: EstadoCompras, secao: Secao, agora: number): string {
  const s = SECOES.find(x => x.id === secao)!
  return `${s.emoji} *THB · COMPRAS ${s.nome.toUpperCase()}* · ${e.ciclos[secao].nome || new Date(agora).toLocaleDateString('pt-BR')}`
}

/**
 * Lista para WhatsApp (markdown do WhatsApp: *negrito*, _itálico_), por loja e grupo.
 * @param e estado
 * @param secao seção
 * @param modo tudo | abertos (pendente + faltou) | pendentes | faltou
 */
export function relatorio(e: EstadoCompras, secao: Secao, modo: ModoRelatorio, agora = Date.now()): string {
  const passa = (s: Status) => modo === 'tudo' || (modo === 'abertos' && s !== 'comprado') || (modo === 'pendentes' && s === 'pendente') || (modo === 'faltou' && s === 'indisponivel')
  const entradas = entradasDaSecao(e, secao).filter(x => passa(x.status))
  const c = contar(entradasDaSecao(e, secao))
  const linhas = [titulo(e, secao, agora), `✅ ${c.comprado} · ❌ ${c.indisponivel} · ⬜ ${c.pendente}`]
  linhas.push(...blocosPorLista(e, secao, entradas, (x, i) => `${ICONE[x.status]} ${formatarQtd(x.quantidade)} · ${rotuloItem(i)}`))
  if (!entradas.length) linhas.push('', '_Nada nesta seleção._')
  return linhas.join('\n')
}

/**
 * Resumo do fechamento para WhatsApp: totais e o que vai para a próxima lista.
 * @param e estado (antes de fechar)
 * @param secao seção
 * @param levar entradas que vão para os faltantes
 */
export function relatorioFechamento(e: EstadoCompras, secao: Secao, levar: {itemId: string, listaId: string}[], agora = Date.now()): string {
  const todas = entradasDaSecao(e, secao)
  const c = contar(todas)
  const vai = todas.filter(x => x.status !== 'comprado' && levar.some(l => l.itemId === x.itemId && l.listaId === x.listaId))
  const linhas = [titulo(e, secao, agora).replace('COMPRAS', 'COMPRA FINALIZADA'),
    `✅ ${c.comprado} comprados · ❌ ${c.indisponivel} em falta · ⬜ ${c.pendente} sem marcar`]
  if (vai.length) {
    linhas.push('', '🔁 *FICA PARA A PRÓXIMA LISTA*')
    linhas.push(...blocosPorLista(e, secao, vai, (x, i) => `${x.status === 'indisponivel' ? '❌' : '⬜'} ${formatarQtd(x.quantidade)} · ${rotuloItem(i)}`))
  } else linhas.push('', '🎉 Nada ficou faltando.')
  return linhas.join('\n')
}

// ------------------------------------------------------------------ leitura

/** Siglas das lojas da rede (a sigla curta T/F das versões anteriores vira o código da loja). */
const SIGLAS_LOJA: Record<string, string> = {tijuca: 'THBT', freguesia: 'THBF'}

/** Número de uma quantidade antiga em texto: só aceita número puro ("3", "1,5"); o resto vira 0. */
function qtdAntiga(x: unknown): number {
  if (typeof x === 'number') return Number.isFinite(x) && x > 0 ? x : 0
  return typeof x === 'string' ? lerQtd(x) : 0
}

/**
 * Valida o estado lido do armazenamento (não confiável) e migra versões anteriores:
 * v1 (nome com unidade, sem seções), v2 (quantidade em texto livre e sugestões copiadas da planilha).
 * @param bruto objeto lido
 */
export function revisar(bruto: unknown): EstadoCompras {
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>
  const versao = Number(b.versao) || 1
  const arr = <T>(x: unknown): T[] => Array.isArray(x) ? x.filter(y => y && typeof y === 'object') as T[] : []
  const listas = arr<Lista>(b.listas).filter(l => typeof l.id === 'string').map(l => {
    const loja = SIGLAS_LOJA[normalizar(String(l.nome ?? ''))]
    const secoes: Secao[] = loja && versao < 3 ? ['producao', 'bebidas']
      : Array.isArray(l.secoes) && l.secoes.length ? l.secoes : ['producao', 'bebidas']
    return {...l, secoes, sigla: loja && versao < 3 && String(l.sigla).length <= 1 ? loja : String(l.sigla ?? '').slice(0, 4) || 'L'}
  })
  const itens = arr<Item & {grupo?: string}>(b.itens).filter(i => typeof i.id === 'string').map(i => {
    const sep = versao < 2 && !i.unidade ? separarUnidade(String(i.nome ?? '')) : {nome: String(i.nome ?? ''), unidade: String(i.unidade ?? '')}
    const secao: Secao = i.secao === 'bebidas' ? 'bebidas' : 'producao'
    const grupo = i.grupo === 'Insumos / Mercado' ? 'Insumos' : i.grupo === 'Bebidas' ? 'Refrigerantes' : (i.grupo || 'Outros')
    // até a v2 a "última quantidade" era copiada da planilha, não de compra real: descarta
    const ultimaQtd = versao < 3 ? {} : Object.fromEntries(Object.entries(i.ultimaQtd && typeof i.ultimaQtd === 'object' ? i.ultimaQtd : {})
      .map(([k, v]) => [k, qtdAntiga(v)]).filter(([, v]) => (v as number) > 0))
    return {...i, nome: sep.nome, unidade: sep.unidade, secao, grupo, origem: i.origem || 'Mercado',
      vinculos: Array.isArray(i.vinculos) ? i.vinculos : [], ultimaQtd} as Item
  })
  const porId = new Map(itens.map(i => [i.id, i])), lids = new Set(listas.map(l => l.id))
  const qtd = (itemId: string, q: unknown) => {const i = porId.get(itemId); return i ? ajustarQtd(i, qtdAntiga(q) || 1) : 0}
  const entradas = arr<Entrada>(b.entradas).filter(x => porId.has(x.itemId) && lids.has(x.listaId)).map(x => ({...x, quantidade: qtd(x.itemId, x.quantidade)}))
  const faltantes = arr<Faltante>(b.faltantes).filter(x => porId.has(x.itemId) && lids.has(x.listaId)).map(x => ({...x, quantidade: qtd(x.itemId, x.quantidade)}))
  const c = (b.ciclos ?? {}) as Partial<Record<Secao, Ciclo>>
  const ciclo = (x?: Ciclo): Ciclo => x && ['montar', 'comprar', 'fechar'].includes(x.etapa) ? x : {...CICLO_NOVO}
  // v1 tinha uma rodada única; se havia lista em andamento, ela segue na etapa de compra.
  const producao = versao < 2 && entradas.length ? {etapa: 'comprar' as const, nome: String(b.rodadaNome ?? ''), desde: Number(b.rodadaDesde) || 0} : ciclo(c.producao)
  return {
    versao: 3, listas, itens, entradas, faltantes,
    pesquisa: b.pesquisa && typeof b.pesquisa === 'object' ? b.pesquisa as Record<string, Pesquisa> : {},
    ciclos: {producao, bebidas: ciclo(c.bebidas)},
    historico: arr<CompraFechada>(b.historico).slice(0, MAX_HISTORICO).map(h => ({...h, itens: arr<CompraFechada['itens'][number]>(h.itens).map(x => ({...x, quantidade: qtdAntiga(x.quantidade)}))}))
  }
}
