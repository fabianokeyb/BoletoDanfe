import {normalizar} from './estado.ts'
import type {Indice, Vinculo} from './precos.ts'

/** Candidato a vínculo para um item da lista. */
export interface Candidato {
  vinculo: Vinculo
  rotulo: string
  detalhe: string
  compras: number
  pontos: number
  /** Fração das palavras buscadas encontradas no candidato (1 = todas). */
  cobertura: number
}

const VAZIAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'para', 'p', 'kg', 'g', 'gr', 'ml', 'l', 'lt', 'lts', 'un', 'und', 'c', 'cx', 'pct', 'pc', 'tp', 'bj', 'pet', 'cong', 'kg1', 'un1'])

/** Palavras significativas: sem acento, sem números, sem unidades, raiz simples de plural. */
export function palavras(s: string): string[] {
  return normalizar(s).replace(/[^a-z\s]/g, ' ').split(' ')
    .filter(w => w.length > 1 && !VAZIAS.has(w))
    .map(w => w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w)
}

/**
 * Similaridade simples: fração das palavras do item encontradas no candidato,
 * aceitando prefixo de 4+ letras (molho ↔ molhos, refinado ↔ ref).
 */
function pontuar(item: string[], alvo: string[]): number {
  if (!item.length || !alvo.length) return 0
  let acertos = 0
  for (const w of item) {
    if (alvo.some(a => a === w || (w.length >= 3 && a.length >= 3 && (a.startsWith(w.slice(0, 4)) || w.startsWith(a.slice(0, 4)))))) acertos++
  }
  return acertos / item.length
}

/**
 * Busca insumos e produtos que correspondem a um texto (nome do item ou o que o usuário digitar).
 * Insumos primeiro, depois produtos sem insumo. Produtos já cobertos por um insumo não repetem.
 * @param indice índices do snapshot
 * @param texto texto de busca
 * @param limite máximo de candidatos
 */
export function buscarCandidatos(indice: Indice, texto: string, limite = 8): Candidato[] {
  const q = palavras(texto)
  if (!q.length) return []
  const out: Candidato[] = []
  for (const ins of indice.insumos.values()) {
    const pts = pontuar(q, palavras(ins.descricao))
    if (pts < 0.5) continue
    const produtos = indice.produtosPorInsumo.get(ins.id) ?? []
    const compras = produtos.reduce((s, p) => s + (indice.obsPorProduto.get(p.chave)?.length ?? 0), 0)
    out.push({vinculo: {tipo: 'insumo', id: ins.id}, rotulo: ins.descricao, detalhe: `Insumo Saipos · ${ins.unidade}${ins.grupo ? ' · ' + ins.grupo : ''}`, compras, cobertura: pts, pontos: pts + (compras ? 0.2 : 0) + 0.1})
  }
  for (const p of indice.produtos.values()) {
    if (p.insumo != null) continue
    const pts = pontuar(q, palavras(p.descricao))
    if (pts < 0.5) continue
    const compras = indice.obsPorProduto.get(p.chave)?.length ?? 0
    out.push({vinculo: {tipo: 'produto', chave: p.chave}, rotulo: p.descricao, detalhe: `Produto ${p.fornecedor} · sem insumo`, compras, cobertura: pts, pontos: pts + (compras ? 0.2 : 0)})
  }
  return out.sort((a, b) => b.pontos - a.pontos || b.compras - a.compras || a.rotulo.localeCompare(b.rotulo)).slice(0, limite)
}

/**
 * Rótulo legível de um vínculo.
 * @param indice índices (opcional: sem snapshot mostra o id)
 * @param v vínculo
 */
export function rotuloVinculo(indice: Indice | undefined, v: Vinculo): string {
  if (v.tipo === 'insumo') return indice?.insumos.get(v.id)?.descricao ?? `Insumo #${v.id}`
  return indice?.produtos.get(v.chave)?.descricao ?? `Produto ${v.chave}`
}

/**
 * Igualdade de vínculos.
 * @param a vínculo
 * @param b vínculo
 */
export function mesmoVinculo(a: Vinculo, b: Vinculo): boolean {
  return a.tipo === b.tipo && (a.tipo === 'insumo' ? a.id === (b as typeof a).id : a.chave === (b as typeof a).chave)
}

/**
 * Vínculo automático para itens sem vínculo, só quando a escolha é inequívoca:
 * o melhor candidato cobre todas as palavras do nome, já tem compra com NF-e e nenhum
 * outro candidato cobre todas. O app marca o vínculo como automático até o usuário confirmar.
 * @param indice índices do snapshot
 * @param itens itens a avaliar (só os sem vínculo e não recusados)
 * @returns pares item → vínculo sugerido
 */
export function vinculosAutomaticos(indice: Indice, itens: {id: string, nome: string, vinculos: Vinculo[], vinculoAuto?: boolean}[]): {itemId: string, vinculo: Vinculo}[] {
  const out: {itemId: string, vinculo: Vinculo}[] = []
  for (const item of itens) {
    // vinculoAuto === false: o usuário já recusou/limpou o vínculo; não insistir
    if (item.vinculos.length || item.vinculoAuto === false) continue
    const [a, b] = buscarCandidatos(indice, item.nome, 2)
    if (a && a.cobertura === 1 && a.compras > 0 && !(b && b.cobertura === 1)) out.push({itemId: item.id, vinculo: a.vinculo})
  }
  return out
}
