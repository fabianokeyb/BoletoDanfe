/**
 * Envio dos lotes finalizados para o Supabase (projeto THBT), pelas funções
 * public.fichas_verificar e public.fichas_registrar.
 */
import {SUPABASE_URL, SUPABASE_CHAVE_PUBLICA, ErroSincronizacao} from '../compras/sincronizar.ts'
import type {Pacote} from './estado.ts'

/**
 * Código da cozinha, embutido para os celulares não precisarem de configuração. É público por
 * desenho (vai no site), por isso tem poder mínimo: escopo 'fichas' só grava produção, e o
 * servidor só aceita lote com cozinheiro ativo em producao.funcionario. Para trocar, gere outro
 * token em integracao.app_token, revogue este e publique o app de novo.
 */
export const TOKEN_COZINHA = 'thbc_U_QwF_fgCzpjS_I-Yx7xs8z948xP_vpp'

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
    if (/token/i.test(msg)) throw new ErroSincronizacao('token', 'O sistema recusou este app. Avise o Fabiano.')
    if (/cozinheiro/i.test(msg)) throw new ErroSincronizacao('servidor', 'Este nome não está cadastrado no sistema. Avise o Fabiano.')
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
