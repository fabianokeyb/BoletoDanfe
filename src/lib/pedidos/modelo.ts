import type {EstadoCompras, Secao} from '../compras/estado.ts'
import {listasDaSecao, entradasDaSecao, normalizar} from '../compras/estado.ts'

/**
 * Pedido de compra como card (ocorrência): quem pediu, quando, para quais lojas e os itens com a
 * quantidade de cada loja. O card vive no Supabase (schema `compras`) e é editado por várias pessoas;
 * toda gravação passa por `public.pedido_salvar`, que grava o registro de alterações e recusa
 * a gravação quando outra pessoa salvou antes (versão diferente).
 */

export type Situacao = 'rascunho' | 'enviado' | 'em_andamento' | 'fechado' | 'cancelado'
export const SITUACOES: {id: Situacao, nome: string}[] = [
  {id: 'rascunho', nome: 'Rascunho'},
  {id: 'enviado', nome: 'Enviado'},
  {id: 'em_andamento', nome: 'Em andamento'},
  {id: 'fechado', nome: 'Fechado'},
  {id: 'cancelado', nome: 'Cancelado'}
]
/** Situações que o app deixa escolher na fase 1 (as outras vêm das etapas seguintes). */
export const SITUACOES_EDITAVEIS: Situacao[] = ['rascunho', 'enviado', 'cancelado']

export interface Pessoa {id: number, nome: string}
export interface Loja {id: number, sigla: string, nome: string}

/** Uma linha da lista: um item, com a quantidade pedida em cada loja do card. */
export interface ItemPedido {
  /** Id estável da linha (nasce no aparelho). */
  id: string
  /** Item do catálogo do módulo Compras, quando veio de lá. */
  catalogoId?: string
  descricao: string
  unidade: string
  grupo?: string
  /** Fornecedor deste item, quando diferente do card (um item pode faltar num e ter no outro). */
  fornecedor?: string
  /** Quantidade por loja (id de cadastro.empresa). */
  qtd: Record<number, number>
}

export interface Pedido {
  id: string
  /** Número sequencial, dado pelo servidor na primeira gravação. */
  numero?: number
  solicitanteId?: number
  solicitante?: string
  criadoEm?: string
  lojas: number[]
  situacao: Situacao
  fornecedor: string
  vendedor: string
  observacao: string
  /** Versão no servidor; 0 = ainda não gravado. */
  versao: number
  atualizadoPor?: string
  atualizadoEm?: string
  itens: ItemPedido[]
}

/** Resumo do card na lista de cards. */
export interface Card {
  id: string
  numero: number
  solicitante: string
  criadoEm: string
  lojas: number[]
  situacao: Situacao
  itens: number
  fornecedores: number
  atualizadoPor: string
  atualizadoEm: string
}

export interface Alteracao {
  versao: number
  autor: string
  em: string
  acao: string
  campo?: string
  linha?: string
  lojaId?: number
  antes?: unknown
  depois?: unknown
}

/** Id curto e único (o servidor aceita qualquer texto até 40 caracteres). */
export function novoId(): string {
  const c = globalThis.crypto as Crypto | undefined
  return c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Card vazio, ainda não gravado.
 * @param lojas lojas marcadas
 */
export function novoPedido(lojas: number[] = []): Pedido {
  return {id: novoId(), lojas: [...lojas], situacao: 'rascunho', fornecedor: '', vendedor: '', observacao: '', versao: 0, itens: []}
}

/**
 * Monta um card a partir da lista Montar de uma seção do módulo Compras. As lojas do aparelho
 * (Tijuca/THBT, Freguesia/THBF) casam com as lojas do servidor pela sigla ou pelo nome.
 * @param e estado do módulo Compras
 * @param secao seção
 * @param lojasServidor lojas de cadastro.empresa
 */
export function pedidoDaLista(e: EstadoCompras, secao: Secao, lojasServidor: Loja[]): {pedido: Pedido, semLoja: string[]} {
  const mapa = new Map<string, number>()
  const semLoja: string[] = []
  for (const l of listasDaSecao(e, secao)) {
    const s = lojasServidor.find(x => normalizar(x.sigla) === normalizar(l.sigla) || normalizar(x.nome) === normalizar(l.nome))
    if (s) mapa.set(l.id, s.id)
  }
  const pedido = novoPedido()
  const porItem = new Map<string, ItemPedido>()
  for (const x of entradasDaSecao(e, secao)) {
    const lojaId = mapa.get(x.listaId)
    if (lojaId === undefined) {
      const nome = e.listas.find(l => l.id === x.listaId)?.nome ?? '?'
      if (!semLoja.includes(nome)) semLoja.push(nome)
      continue
    }
    const item = e.itens.find(i => i.id === x.itemId)
    if (!item || x.quantidade <= 0) continue
    let linha = porItem.get(item.id)
    if (!linha) {
      linha = {id: novoId(), catalogoId: item.id, descricao: item.nome, unidade: item.unidade, grupo: item.grupo, qtd: {}}
      porItem.set(item.id, linha)
    }
    linha.qtd[lojaId] = (linha.qtd[lojaId] ?? 0) + x.quantidade
    if (!pedido.lojas.includes(lojaId)) pedido.lojas.push(lojaId)
  }
  pedido.lojas.sort((a, b) => a - b)
  pedido.itens = [...porItem.values()].sort((a, b) => (a.grupo ?? '').localeCompare(b.grupo ?? '') || a.descricao.localeCompare(b.descricao, 'pt-BR'))
  return {pedido, semLoja}
}

/**
 * Problemas que impedem gravar o card; vazio = pode gravar.
 * @param p card
 */
export function validar(p: Pedido): string[] {
  const erros: string[] = []
  if (!p.lojas.length) erros.push('Marque pelo menos uma loja.')
  const linhas = linhasParaServidor(p)
  if (!linhas.length && p.situacao !== 'cancelado') erros.push('Inclua pelo menos um item com quantidade.')
  const semNome = p.itens.filter(i => !i.descricao.trim()).length
  if (semNome) erros.push(semNome === 1 ? 'Um item está sem nome.' : `${semNome} itens estão sem nome.`)
  return erros
}

/** Linha como o servidor grava: uma por item × loja, só com quantidade maior que zero. */
export interface LinhaServidor {
  linha: string
  loja_id: number
  catalogo_id: string | null
  descricao: string
  unidade: string
  grupo: string | null
  fornecedor: string | null
  qtd: number
}

/**
 * Achata os itens em linhas item × loja, ignorando lojas que não estão marcadas no card.
 * @param p card
 */
export function linhasParaServidor(p: Pedido): LinhaServidor[] {
  const out: LinhaServidor[] = []
  for (const i of p.itens) {
    for (const lojaId of p.lojas) {
      const q = i.qtd[lojaId] ?? 0
      if (!(q > 0)) continue
      out.push({
        linha: i.id, loja_id: lojaId, catalogo_id: i.catalogoId ?? null, descricao: i.descricao.trim(), unidade: i.unidade.trim(),
        grupo: i.grupo ?? null, fornecedor: i.fornecedor?.trim() || null, qtd: q
      })
    }
  }
  return out
}

/**
 * Corpo enviado a `public.pedido_salvar`.
 * @param p card
 */
export function paraServidor(p: Pedido) {
  return {
    id: p.id, versao: p.versao, lojas: [...p.lojas].sort((a, b) => a - b), situacao: p.situacao,
    fornecedor: p.fornecedor.trim(), vendedor: p.vendedor.trim(), observacao: p.observacao.trim(),
    itens: linhasParaServidor(p)
  }
}

/**
 * Reconstrói o card a partir da resposta de `public.pedido_abrir` (linhas item × loja → itens).
 * @param r resposta bruta
 */
export function doServidor(r: unknown): Pedido {
  const x = r as {pedido: Record<string, unknown>, itens: Record<string, unknown>[]}
  if (!x || typeof x !== 'object' || !x.pedido || !Array.isArray(x.itens)) throw new Error('Resposta inesperada do servidor.')
  const p = x.pedido
  const porLinha = new Map<string, ItemPedido>()
  for (const l of x.itens) {
    const id = String(l.linha)
    let it = porLinha.get(id)
    if (!it) {
      it = {
        id, catalogoId: (l.catalogo_id as string | null) ?? undefined, descricao: String(l.descricao ?? ''), unidade: String(l.unidade ?? ''),
        grupo: (l.grupo as string | null) ?? undefined, fornecedor: (l.fornecedor as string | null) ?? undefined, qtd: {}
      }
      porLinha.set(id, it)
    }
    it.qtd[Number(l.loja_id)] = Number(l.qtd)
  }
  return {
    id: String(p.id), numero: Number(p.numero), solicitanteId: Number(p.solicitante_id), solicitante: String(p.solicitante ?? ''),
    criadoEm: String(p.criado_em ?? ''), lojas: ((p.lojas as number[]) ?? []).map(Number), situacao: p.situacao as Situacao,
    fornecedor: String(p.fornecedor ?? ''), vendedor: String(p.vendedor ?? ''), observacao: String(p.observacao ?? ''),
    versao: Number(p.versao), atualizadoPor: String(p.atualizado_por ?? ''), atualizadoEm: String(p.atualizado_em ?? ''),
    itens: [...porLinha.values()]
  }
}

/**
 * O card mudou em relação ao que veio do servidor? (para avisar antes de sair sem salvar)
 * @param a card editado
 * @param b card original
 */
export function mudou(a: Pedido, b: Pedido): boolean {
  return JSON.stringify(paraServidor(a)) !== JSON.stringify(paraServidor(b))
}

/**
 * Tolerância da regra dos 100%: itens a granel (kg, L) aceitam até 3% de diferença,
 * porque a peça raramente sai exata; itens contados (un, cx, fd, 900 ml…) têm de bater.
 * @param unidade unidade do item
 * @param pedida quantidade pedida
 * @param atendida quantidade atendida na etapa
 * @param tolerancia fração aceita (padrão 3%)
 */
export function atendeu(unidade: string, pedida: number, atendida: number, tolerancia = 0.03): boolean {
  const u = normalizar(unidade).replace(/\s/g, '')
  const granel = u === 'kg' || u === 'l' || u === 'g' || u === 'ml'
  if (!granel) return Math.abs(atendida - pedida) < 1e-9
  return Math.abs(atendida - pedida) <= pedida * tolerancia + 1e-9
}

/** Data e hora no padrão brasileiro: "27/11/2026 às 21:37". */
export function dataHora(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const dia = d.toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit', year: 'numeric'})
  const hora = d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})
  return `${dia} às ${hora}`
}

const NOME_CAMPO: Record<string, string> = {
  situacao: 'situação', fornecedor: 'fornecedor', vendedor: 'vendedor', observacao: 'observação', lojas: 'lojas',
  qtd: 'quantidade', descricao: 'nome', unidade: 'unidade'
}

/**
 * Frase de uma alteração para o histórico do card.
 * @param a alteração
 * @param lojas lojas, para trocar id por sigla
 */
export function descreverAlteracao(a: Alteracao, lojas: Loja[]): string {
  const sigla = (id?: number) => lojas.find(l => l.id === id)?.sigla ?? (id === undefined ? '' : `loja ${id}`)
  const v = (x: unknown) => Array.isArray(x) ? x.map(n => sigla(Number(n))).join(' e ') || 'nenhuma'
    : x === null || x === undefined || x === '' ? 'vazio' : typeof x === 'number' ? x.toLocaleString('pt-BR') : String(x)
  const situ = (x: unknown) => SITUACOES.find(s => s.id === x)?.nome ?? v(x)
  const onde = a.lojaId !== undefined ? ` (${sigla(a.lojaId)})` : ''
  switch (a.acao) {
    case 'criou': return 'criou o pedido'
    case 'incluiu': return `incluiu ${a.linha ?? 'item'}${onde}: ${v(a.depois)}`
    case 'removeu': return `removeu ${a.linha ?? 'item'}${onde}: era ${v(a.antes)}`
    case 'editou item': return `mudou ${NOME_CAMPO[a.campo ?? ''] ?? a.campo} de ${a.linha ?? 'item'}${onde}: ${v(a.antes)} → ${v(a.depois)}`
    case 'editou': return a.campo === 'situacao'
      ? `mudou a situação: ${situ(a.antes)} → ${situ(a.depois)}`
      : `mudou ${NOME_CAMPO[a.campo ?? ''] ?? a.campo}: ${v(a.antes)} → ${v(a.depois)}`
    default: return a.acao
  }
}
