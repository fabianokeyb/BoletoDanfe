/**
 * Chamadas ao Supabase (projeto THBT) para os cards de pedido. Usa o mesmo token do aparelho
 * do módulo Compras (escopo `compras`): só aparelhos configurados leem e gravam pedidos, e o
 * servidor só aceita gravação de pessoa ativa e autorizada em `compras.pessoa`.
 */
import {SUPABASE_URL, SUPABASE_CHAVE_PUBLICA, ErroSincronizacao} from '../compras/sincronizar.ts'
import {doServidor, paraServidor, type Alteracao, type Card, type Loja, type Pedido, type Pessoa, type Situacao} from './modelo.ts'

/** Outra pessoa salvou o card depois que ele foi aberto aqui. */
export class ErroConflito extends Error {}

/**
 * Chama uma função RPC.
 * @param funcao nome da função em public
 * @param corpo parâmetros
 * @param fetchFn injeção para teste
 * @throws ErroSincronizacao | ErroConflito
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
    throw new ErroSincronizacao('rede', 'Sem conexão. Os pedidos precisam de internet para abrir e salvar.')
  }
  const dados = await resposta.json().catch(() => null) as unknown
  if (!resposta.ok) {
    const msg = (dados as {message?: string} | null)?.message ?? ''
    if (/conflito/i.test(msg)) throw new ErroConflito('Outra pessoa salvou este pedido enquanto você editava. Recarregue para ver a versão nova; suas mudanças continuam na tela até você recarregar.')
    if (/token/i.test(msg)) throw new ErroSincronizacao('token', 'Este aparelho não tem acesso aos pedidos. Configure o token em Compras → ⚙︎ → Ajustes.')
    if (/pessoa/i.test(msg)) throw new ErroSincronizacao('servidor', 'Seu nome não está autorizado a fazer pedidos. Avise o Fabiano.')
    if (/n[aã]o encontrado/i.test(msg)) throw new ErroSincronizacao('servidor', 'Pedido não encontrado.')
    throw new ErroSincronizacao('servidor', `O servidor respondeu ${resposta.status}. Tente de novo em instantes.`)
  }
  return dados
}

/**
 * Pessoas autorizadas a fazer pedidos e as lojas.
 * @param token token do aparelho
 * @param fetchFn injeção para teste
 */
export async function contexto(token: string, fetchFn: typeof fetch = fetch): Promise<{pessoas: Pessoa[], lojas: Loja[]}> {
  const r = await rpc('pedidos_contexto', {p_token: token.trim()}, fetchFn) as {pessoas?: Pessoa[], lojas?: Loja[]} | null
  if (!r || !Array.isArray(r.pessoas) || !Array.isArray(r.lojas)) throw new ErroSincronizacao('servidor', 'Resposta inesperada do servidor.')
  return {pessoas: r.pessoas, lojas: r.lojas}
}

/**
 * Lista de cards, mais recentes primeiro.
 * @param token token do aparelho
 * @param todos incluir fechados e cancelados
 * @param fetchFn injeção para teste
 */
export async function listar(token: string, todos = false, fetchFn: typeof fetch = fetch): Promise<Card[]> {
  const r = await rpc('pedidos_listar', {p_token: token.trim(), p_todos: todos}, fetchFn)
  if (!Array.isArray(r)) throw new ErroSincronizacao('servidor', 'Resposta inesperada do servidor.')
  return r.map((c: Record<string, unknown>) => ({
    id: String(c.id), numero: Number(c.numero), solicitante: String(c.solicitante ?? ''), criadoEm: String(c.criado_em ?? ''),
    lojas: ((c.lojas as number[]) ?? []).map(Number), situacao: c.situacao as Situacao, itens: Number(c.itens ?? 0),
    fornecedores: Number(c.fornecedores ?? 0), atualizadoPor: String(c.atualizado_por ?? ''), atualizadoEm: String(c.atualizado_em ?? '')
  }))
}

/**
 * Abre um card com os itens e o registro de alterações.
 * @param token token do aparelho
 * @param id id do pedido
 * @param fetchFn injeção para teste
 */
export async function abrir(token: string, id: string, fetchFn: typeof fetch = fetch): Promise<{pedido: Pedido, alteracoes: Alteracao[]}> {
  const r = await rpc('pedido_abrir', {p_token: token.trim(), p_id: id}, fetchFn) as {alteracoes?: Record<string, unknown>[]}
  const pedido = doServidor(r)
  const alteracoes = (r.alteracoes ?? []).map(a => ({
    versao: Number(a.versao), autor: String(a.autor ?? ''), em: String(a.em ?? ''), acao: String(a.acao ?? ''),
    campo: (a.campo as string | null) ?? undefined, linha: (a.linha as string | null) ?? undefined,
    lojaId: a.loja_id == null ? undefined : Number(a.loja_id), antes: a.antes, depois: a.depois
  }))
  return {pedido, alteracoes}
}

/**
 * Grava o card (cria na primeira vez). Recusa com ErroConflito se a versão do servidor mudou.
 * @param token token do aparelho
 * @param pessoaId quem está salvando
 * @param p card
 * @param fetchFn injeção para teste
 * @returns id, número e versão nova
 */
export async function salvar(token: string, pessoaId: number, p: Pedido, fetchFn: typeof fetch = fetch): Promise<{id: string, numero: number, versao: number}> {
  const r = await rpc('pedido_salvar', {p_token: token.trim(), p_pessoa: pessoaId, p_pedido: paraServidor(p)}, fetchFn) as {id?: string, numero?: number, versao?: number} | null
  if (!r || r.id !== p.id || typeof r.versao !== 'number') throw new ErroSincronizacao('servidor', 'Resposta inesperada do servidor.')
  return {id: r.id, numero: Number(r.numero), versao: r.versao}
}
