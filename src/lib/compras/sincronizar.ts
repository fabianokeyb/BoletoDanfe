import type {Snapshot} from './precos.ts'

/**
 * Projeto Supabase "THBT". URL e chave publicável são públicas por desenho (vão no bundle);
 * o acesso aos dados é barrado pela função `public.compras_precos`, que exige o token do
 * aparelho — guardado só no localStorage, nunca no repositório.
 */
export const SUPABASE_URL = 'https://mfjwuudznpcuqoqkdvjc.supabase.co'
export const SUPABASE_CHAVE_PUBLICA = 'sb_publishable_7Zgy4xolexHS9N_0_reV1A_m9GqKcr_'

export class ErroSincronizacao extends Error {
  readonly tipo: 'token' | 'rede' | 'servidor'

  /**
   * @param tipo causa: token recusado, sem rede ou erro do servidor
   * @param mensagem texto para o usuário
   */
  constructor(tipo: 'token' | 'rede' | 'servidor', mensagem: string) {
    super(mensagem)
    this.tipo = tipo
  }
}

/**
 * Baixa o snapshot de preços (todas as compras com NF-e processadas no Supabase).
 * Uma chamada só, ~160 KB: mais simples e correto que sincronização incremental, já que
 * reprocessar uma nota ou corrigir um vínculo no banco muda compras antigas.
 * @param token token do aparelho
 * @param fetchFn injeção para teste
 * @throws ErroSincronizacao
 */
export async function baixarSnapshot(token: string, fetchFn: typeof fetch = fetch): Promise<Snapshot> {
  let resposta: Response
  try {
    resposta = await fetchFn(`${SUPABASE_URL}/rest/v1/rpc/compras_precos`, {
      method: 'POST',
      headers: {apikey: SUPABASE_CHAVE_PUBLICA, 'Content-Type': 'application/json', Accept: 'application/json'},
      body: JSON.stringify({p_token: token.trim()}),
      cache: 'no-store'
    })
  } catch {
    throw new ErroSincronizacao('rede', 'Sem conexão. Os preços salvos no aparelho continuam valendo.')
  }
  const corpo = await resposta.json().catch(() => null) as unknown
  if (!resposta.ok) {
    const msg = (corpo as {message?: string} | null)?.message ?? ''
    if (/token/i.test(msg)) throw new ErroSincronizacao('token', 'Token recusado. Confira o token de sincronização.')
    throw new ErroSincronizacao('servidor', `O servidor respondeu ${resposta.status}. Tente de novo em instantes.`)
  }
  if (!validarSnapshot(corpo)) throw new ErroSincronizacao('servidor', 'Resposta inesperada do servidor.')
  return corpo
}

/**
 * Confere a forma do snapshot antes de gravar (o armazenamento e a rede não são confiáveis).
 * @param x objeto recebido
 */
export function validarSnapshot(x: unknown): x is Snapshot {
  const s = x as Snapshot | null
  return !!s && typeof s.geradoEm === 'string' && Array.isArray(s.insumos) && Array.isArray(s.produtos) && Array.isArray(s.obs)
    && s.obs.every(o => Array.isArray(o) && o.length === 8 && typeof o[1] === 'string' && typeof o[6] === 'number')
}
