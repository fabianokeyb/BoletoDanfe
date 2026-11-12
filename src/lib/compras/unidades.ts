/**
 * Unidades físicas usadas no app de compras, iguais às de `ref.unidade_medida` no Supabase.
 * A conversão passa sempre pela unidade base da dimensão (g, ml, un).
 */
export type Unidade = 'g' | 'kg' | 'ml' | 'l' | 'un'
export type Dimensao = 'massa' | 'volume' | 'contagem'

const TABELA: Record<Unidade, {dimensao: Dimensao, fator: number, rotulo: string}> = {
  g: {dimensao: 'massa', fator: 1, rotulo: 'g'},
  kg: {dimensao: 'massa', fator: 1000, rotulo: 'kg'},
  ml: {dimensao: 'volume', fator: 1, rotulo: 'ml'},
  l: {dimensao: 'volume', fator: 1000, rotulo: 'L'},
  un: {dimensao: 'contagem', fator: 1, rotulo: 'un'}
}

/** Unidade de exibição por dimensão: preço por kg, por litro, por unidade. */
export const UNIDADE_EXIBICAO: Record<Dimensao, Unidade> = {massa: 'kg', volume: 'l', contagem: 'un'}

export const UNIDADES: Unidade[] = ['un', 'kg', 'g', 'l', 'ml']

/**
 * Indica se o texto é uma unidade conhecida.
 * @param u texto a validar
 */
export function ehUnidade(u: unknown): u is Unidade {
  return typeof u === 'string' && u in TABELA
}

/**
 * Dimensão física de uma unidade.
 * @param u unidade
 */
export function dimensao(u: Unidade): Dimensao {
  return TABELA[u].dimensao
}

/**
 * Rótulo curto para exibição (L maiúsculo para litro).
 * @param u unidade
 */
export function rotulo(u: Unidade): string {
  return TABELA[u].rotulo
}

/**
 * Converte uma quantidade entre unidades da mesma dimensão.
 * @param qtd quantidade na unidade de origem
 * @param de unidade de origem
 * @param para unidade de destino
 * @returns quantidade convertida, ou null se as dimensões diferem
 */
export function converter(qtd: number, de: Unidade, para: Unidade): number | null {
  if (TABELA[de].dimensao !== TABELA[para].dimensao) return null
  return qtd * TABELA[de].fator / TABELA[para].fator
}
