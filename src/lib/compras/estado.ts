import type {Vinculo} from './precos.ts'
import type {Unidade} from './unidades.ts'

/** Lista de compras: uma por loja (Freguesia, Tijuca) ou pessoal. */
export interface Lista {
  id: string
  nome: string
  /** Sigla de 1–3 letras exibida nos chips da visão "Todas". */
  sigla: string
  tipo: 'loja' | 'pessoal'
  cor: string
  ordem: number
}

/** Item do catálogo do que costumo comprar. Compartilhado por todas as listas. */
export interface Item {
  id: string
  nome: string
  grupo: string
  /** Embalagem típica na gôndola, para comparar preço (ex.: 2,8 kg de maionese). */
  embalagem?: {qtd: number, unidade: Unidade}
  vinculos: Vinculo[]
  criadoEm: number
}

export type Status = 'pendente' | 'comprado' | 'indisponivel'

/** Item colocado numa lista nesta rodada, com quantidade e situação. */
export interface Entrada {
  listaId: string
  itemId: string
  quantidade: string
  status: Status
  atualizadoEm: number
}

/** Preço visto na gôndola nesta rodada (um por item, vale para todas as listas). */
export interface Pesquisa {
  preco: number
  qtd: number
  unidade: Unidade
  em: number
}

export interface EstadoCompras {
  versao: 1
  listas: Lista[]
  itens: Item[]
  entradas: Entrada[]
  pesquisa: Record<string, Pesquisa>
  /** Início da rodada atual (semana de compras). */
  rodadaDesde: number
  rodadaNome: string
}

export const GRUPOS = ['Embalagens', 'Limpeza', 'Rancho', 'Insumos / Mercado', 'Hortifruti', 'Bebidas', 'Pessoal', 'Outros'] as const
export const EMOJI_GRUPO: Record<string, string> = {
  'Embalagens': '📦', 'Limpeza': '🧹', 'Rancho': '🛒', 'Insumos / Mercado': '🥫', 'Hortifruti': '🥬', 'Bebidas': '🥤', 'Pessoal': '🏠', 'Outros': '📌'
}
export const CORES = ['#1f6a43', '#2f6f9f', '#a35d1f', '#7b3fa0', '#a3324a', '#4d6b2b']

export const ESTADO_INICIAL: EstadoCompras = {versao: 1, listas: [], itens: [], entradas: [], pesquisa: {}, rodadaDesde: 0, rodadaNome: ''}

/** Id curto e único (randomUUID quando disponível). */
export function novoId(): string {
  const c = globalThis.crypto as Crypto | undefined
  return c?.randomUUID ? c.randomUUID().slice(0, 13) : Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/**
 * Normaliza texto para busca: minúsculas, sem acento, espaços simples.
 * @param s texto
 */
export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Ordem de exibição do grupo (grupos fora da lista vão para o fim, em ordem alfabética).
 * @param g nome do grupo
 */
export function ordemGrupo(g: string): number {
  const i = (GRUPOS as readonly string[]).indexOf(g)
  return i < 0 ? 100 : i
}

/**
 * Cria uma lista.
 * @param e estado atual
 * @param nome nome da lista
 * @param tipo loja ou pessoal
 */
export function criarLista(e: EstadoCompras, nome: string, tipo: Lista['tipo'] = 'loja'): {estado: EstadoCompras, lista: Lista} {
  const limpo = nome.trim() || 'Nova lista'
  const lista: Lista = {
    id: novoId(), nome: limpo, tipo,
    sigla: limpo.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1).toUpperCase() || 'L',
    cor: CORES[e.listas.length % CORES.length],
    ordem: Math.max(0, ...e.listas.map(l => l.ordem + 1))
  }
  return {estado: {...e, listas: [...e.listas, lista]}, lista}
}

/**
 * Altera campos de uma lista.
 * @param e estado
 * @param id lista
 * @param campos campos a trocar
 */
export function atualizarLista(e: EstadoCompras, id: string, campos: Partial<Omit<Lista, 'id'>>): EstadoCompras {
  return {...e, listas: e.listas.map(l => l.id === id ? {...l, ...campos} : l)}
}

/**
 * Remove a lista e as entradas dela (os itens do catálogo continuam).
 * @param e estado
 * @param id lista
 */
export function removerLista(e: EstadoCompras, id: string): EstadoCompras {
  return {...e, listas: e.listas.filter(l => l.id !== id), entradas: e.entradas.filter(x => x.listaId !== id)}
}

/**
 * Cria um item no catálogo.
 * @param e estado
 * @param dados nome, grupo, embalagem e vínculos
 */
export function criarItem(e: EstadoCompras, dados: Pick<Item, 'nome' | 'grupo'> & Partial<Pick<Item, 'embalagem' | 'vinculos'>>, agora = Date.now()): {estado: EstadoCompras, item: Item} {
  const item: Item = {id: novoId(), nome: dados.nome.trim(), grupo: dados.grupo || 'Outros', embalagem: dados.embalagem, vinculos: dados.vinculos ?? [], criadoEm: agora}
  return {estado: {...e, itens: [...e.itens, item]}, item}
}

/**
 * Altera um item do catálogo.
 * @param e estado
 * @param id item
 * @param campos campos a trocar
 */
export function atualizarItem(e: EstadoCompras, id: string, campos: Partial<Omit<Item, 'id' | 'criadoEm'>>): EstadoCompras {
  return {...e, itens: e.itens.map(i => i.id === id ? {...i, ...campos} : i)}
}

/**
 * Remove o item do catálogo e de todas as listas.
 * @param e estado
 * @param id item
 */
export function removerItem(e: EstadoCompras, id: string): EstadoCompras {
  const {[id]: _, ...pesquisa} = e.pesquisa
  return {...e, itens: e.itens.filter(i => i.id !== id), entradas: e.entradas.filter(x => x.itemId !== id), pesquisa}
}

/**
 * Coloca, altera ou tira um item de uma lista. Quantidade vazia tira o item da lista.
 * @param e estado
 * @param listaId lista
 * @param itemId item
 * @param quantidade texto livre ("03 kg", "60")
 */
export function definirQuantidade(e: EstadoCompras, listaId: string, itemId: string, quantidade: string, agora = Date.now()): EstadoCompras {
  const q = quantidade.trim()
  const existe = e.entradas.find(x => x.listaId === listaId && x.itemId === itemId)
  if (!q) return existe ? {...e, entradas: e.entradas.filter(x => x !== existe)} : e
  if (existe) return {...e, entradas: e.entradas.map(x => x === existe ? {...x, quantidade: q, atualizadoEm: agora} : x)}
  return {...e, entradas: [...e.entradas, {listaId, itemId, quantidade: q, status: 'pendente', atualizadoEm: agora}]}
}

/**
 * Marca uma entrada. Tocar de novo no mesmo status volta para pendente.
 * @param e estado
 * @param listaId lista
 * @param itemId item
 * @param status status tocado
 */
export function alternarStatus(e: EstadoCompras, listaId: string, itemId: string, status: Exclude<Status, 'pendente'>, agora = Date.now()): EstadoCompras {
  return {...e, entradas: e.entradas.map(x => x.listaId === listaId && x.itemId === itemId
    ? {...x, status: x.status === status ? 'pendente' : status, atualizadoEm: agora} : x)}
}

/**
 * Marca todas as entradas de um item (em todas as listas visíveis) de uma vez.
 * @param e estado
 * @param itemId item
 * @param listaIds listas afetadas
 * @param status status a aplicar
 */
export function marcarItem(e: EstadoCompras, itemId: string, listaIds: string[], status: Status, agora = Date.now()): EstadoCompras {
  return {...e, entradas: e.entradas.map(x => x.itemId === itemId && listaIds.includes(x.listaId) ? {...x, status, atualizadoEm: agora} : x)}
}

/**
 * Guarda (ou apaga, com preço 0) o preço visto na gôndola.
 * @param e estado
 * @param itemId item
 * @param p pesquisa, ou undefined para apagar
 */
export function registrarPesquisa(e: EstadoCompras, itemId: string, p?: Pesquisa): EstadoCompras {
  const {[itemId]: _, ...resto} = e.pesquisa
  return {...e, pesquisa: p && p.preco > 0 ? {...resto, [itemId]: p} : resto}
}

/**
 * Começa uma nova rodada de compras: tudo volta para pendente e os preços de gôndola são apagados.
 * @param e estado
 * @param manterQuantidades false tira todos os itens das listas
 * @param nome rótulo da rodada (ex.: data)
 */
export function novaRodada(e: EstadoCompras, manterQuantidades: boolean, nome: string, agora = Date.now()): EstadoCompras {
  return {
    ...e,
    entradas: manterQuantidades ? e.entradas.map(x => ({...x, status: 'pendente' as const, atualizadoEm: agora})) : [],
    pesquisa: {}, rodadaDesde: agora, rodadaNome: nome
  }
}

/**
 * Contagem por status nas listas informadas.
 * @param e estado
 * @param listaIds listas consideradas
 */
export function metricas(e: EstadoCompras, listaIds: string[]): Record<Status, number> {
  const m: Record<Status, number> = {pendente: 0, comprado: 0, indisponivel: 0}
  for (const x of e.entradas) if (listaIds.includes(x.listaId)) m[x.status]++
  return m
}

export type ModoRelatorio = 'tudo' | 'abertos' | 'pendentes' | 'faltou'

const ICONE: Record<Status, string> = {comprado: '✅', indisponivel: '❌', pendente: '⬜'}

/**
 * Relatório em texto para WhatsApp, por lista e grupo (mesmo formato da lista antiga).
 * @param e estado
 * @param listaIds listas incluídas, na ordem
 * @param modo tudo | abertos (pendentes + faltou) | pendentes | faltou
 * @param titulo primeira linha
 */
export function relatorio(e: EstadoCompras, listaIds: string[], modo: ModoRelatorio, titulo: string): string {
  const linhas = [`*${titulo}*`]
  const itens = new Map(e.itens.map(i => [i.id, i]))
  const passa = (s: Status) => modo === 'tudo' || (modo === 'abertos' && s !== 'comprado') || (modo === 'pendentes' && s === 'pendente') || (modo === 'faltou' && s === 'indisponivel')
  for (const lista of e.listas.filter(l => listaIds.includes(l.id)).sort((a, b) => a.ordem - b.ordem)) {
    const entradas = e.entradas.filter(x => x.listaId === lista.id && passa(x.status) && itens.has(x.itemId))
    if (!entradas.length) continue
    linhas.push('', `*${lista.nome.toUpperCase()}*`)
    const grupos = [...new Set(entradas.map(x => itens.get(x.itemId)!.grupo))].sort((a, b) => ordemGrupo(a) - ordemGrupo(b) || a.localeCompare(b))
    for (const g of grupos) {
      linhas.push('', `*${EMOJI_GRUPO[g] ?? '📌'} ${g}*`)
      const doGrupo = entradas.filter(x => itens.get(x.itemId)!.grupo === g)
        .sort((a, b) => itens.get(a.itemId)!.nome.localeCompare(itens.get(b.itemId)!.nome, 'pt-BR'))
      for (const x of doGrupo) linhas.push(`${ICONE[x.status]} ${x.quantidade} ${itens.get(x.itemId)!.nome}`)
    }
  }
  return linhas.join('\n')
}

/**
 * Valida e completa um estado lido do armazenamento (fonte não confiável).
 * @param bruto objeto lido
 */
export function revisar(bruto: unknown): EstadoCompras {
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Partial<EstadoCompras>
  const listas = Array.isArray(b.listas) ? b.listas.filter(l => l && typeof l.id === 'string') : []
  const itens = Array.isArray(b.itens) ? b.itens.filter(i => i && typeof i.id === 'string').map(i => ({...i, vinculos: Array.isArray(i.vinculos) ? i.vinculos : []})) : []
  const ids = new Set(itens.map(i => i.id)), lids = new Set(listas.map(l => l.id))
  const entradas = Array.isArray(b.entradas) ? b.entradas.filter(x => x && ids.has(x.itemId) && lids.has(x.listaId)) : []
  return {versao: 1, listas, itens, entradas, pesquisa: b.pesquisa && typeof b.pesquisa === 'object' ? b.pesquisa : {},
    rodadaDesde: Number(b.rodadaDesde) || 0, rodadaNome: typeof b.rodadaNome === 'string' ? b.rodadaNome : ''}
}
