/**
 * Envio dos lotes finalizados para o Supabase (projeto THBT), pelas funções
 * public.fichas_verificar e public.fichas_registrar. O token da cozinha tem escopo 'fichas':
 * só grava produção, não lê preços nem importa notas.
 */
import {SUPABASE_URL, SUPABASE_CHAVE_PUBLICA, ErroSincronizacao} from '../compras/sincronizar.ts'
import type {Pacote} from './estado.ts'

/**
 * Chama uma função RPC do Supabase.
 * @param funcao nome da função em public
 * @param corpo parâmetros
 * @param fetchFn injeção para teste
 * @throws ErroSincronizacao
 */
async function rpc(funcao: string, corpo: object, fetchFn: typeof fetch): Promise<unknown> {
  let resposta: Response
  try {
    resposta = await fetchFn(`${SUPABASE_URL}/rest/v1/rpc/${funcao}`, {
      method: 'POST',
      headers: {apikey: SUPABASE_CHAVE_PUBLICA, 'Content-Type': 'application/json', Accept: 'application/json'},
      body: JSON.stringify(corpo),
      cache: 'no-store'
    })
  } catch {
    throw new ErroSincronizacao('rede', 'Sem sinal. Fica guardado no celular e sobe quando a internet voltar.')
  }
  const dados = await resposta.json().catch(() => null) as unknown
  if (!resposta.ok) {
    const msg = (dados as {message?: string} | null)?.message ?? ''
    if (/token/i.test(msg)) throw new ErroSincronizacao('token', 'Código da cozinha recusado. Peça o link de novo.')
    throw new ErroSincronizacao('servidor', `O servidor respondeu ${resposta.status}. Tento de novo em instantes.`)
  }
  return dados
}

/**
 * Confere o código da cozinha.
 * @param token código
 * @param fetchFn injeção para teste
 * @returns nome cadastrado do código
 */
export async function verificarToken(token: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const r = await rpc('fichas_verificar', {p_token: token.trim()}, fetchFn) as {nome?: string} | null
  return r?.nome ?? ''
}

/**
 * Grava (ou atualiza, pelo id) um lote finalizado.
 * @param token código da cozinha
 * @param lote corpo do lote
 * @param fetchFn injeção para teste
 */
export async function enviarLote(token: string, lote: Pacote, fetchFn: typeof fetch = fetch): Promise<void> {
  const r = await rpc('fichas_registrar', {p_token: token.trim(), p_lote: lote}, fetchFn) as {id?: string} | null
  if (r?.id !== lote.id) throw new ErroSincronizacao('servidor', 'Resposta inesperada do servidor.')
}
