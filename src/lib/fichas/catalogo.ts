/**
 * Catálogo de fichas vigente, editado no manual (aba Editar) e guardado em producao.ficha.
 * O app usa a cópia embutida (receitas.ts) até o servidor responder, e guarda a última versão
 * no aparelho para funcionar sem sinal.
 */
import {SUPABASE_URL, SUPABASE_CHAVE_PUBLICA} from '../compras/sincronizar.ts'
import type {Unidade} from '../compras/unidades.ts'
import type {Receita} from './receitas.ts'

const UNIDADES: readonly Unidade[] = ['g', 'kg', 'ml', 'l', 'un']

/** Formato que public.fichas_catalogo devolve para cada ficha. */
export interface FichaServidor {
  id: string
  numero: number
  nome: string
  rendimentoKg: number
  validadeDias: number | null
  ingredientes: {id: string, nome: string, qtd: number, unidade: string, obs?: string}[]
}

/**
 * Converte o retorno do servidor em receitas do app; descarta o que vier malformado.
 * @param dados corpo da resposta de fichas_catalogo
 * @returns receitas válidas, ou null se nenhuma for aproveitável
 */
export function converterCatalogo(dados: unknown): Receita[] | null {
  if (!Array.isArray(dados)) return null
  const receitas: Receita[] = []
  for (const f of dados as FichaServidor[]) {
    const ingredientes = Array.isArray(f?.ingredientes) ? f.ingredientes.filter(i =>
      typeof i?.id === 'string' && typeof i.nome === 'string' && Number(i.qtd) > 0 && UNIDADES.includes(i.unidade as Unidade)) : []
    const rend = Number(f?.rendimentoKg)
    if (typeof f?.id !== 'string' || typeof f.nome !== 'string' || !ingredientes.length || !(rend > 0)) continue
    receitas.push({
      id: f.id, numero: Number(f.numero), nome: f.nome,
      ingredientes: ingredientes.map(i => ({id: i.id, nome: i.nome, qtd: Number(i.qtd), unidade: i.unidade as Unidade, ...(i.obs ? {obs: i.obs} : {})})),
      rendimento: {qtd: rend, unidade: 'kg'},
      ...(f.validadeDias ? {validadeDias: Number(f.validadeDias)} : {})
    })
  }
  return receitas.length ? receitas.sort((a, b) => a.numero - b.numero) : null
}

/**
 * Busca as fichas vigentes no servidor.
 * @param fetchFn injeção para teste
 * @returns receitas, ou null sem sinal ou com resposta inválida
 */
export async function buscarCatalogo(fetchFn: typeof fetch = fetch): Promise<Receita[] | null> {
  try {
    const r = await fetchFn(`${SUPABASE_URL}/rest/v1/rpc/fichas_catalogo`, {
      method: 'POST', cache: 'no-store',
      headers: {apikey: SUPABASE_CHAVE_PUBLICA, 'Content-Type': 'application/json', Accept: 'application/json'},
      body: '{}'
    })
    return r.ok ? converterCatalogo(await r.json()) : null
  } catch {
    return null
  }
}
