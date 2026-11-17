/**
 * Registro de produção contra a ficha técnica: funções puras, sem DOM.
 *
 * Uma produção é o conjunto de receitas feitas num dia por um cozinheiro. Cada receita feita vira
 * um lote, que ou segue a ficha (consumo e rendimento valem os da ficha) ou traz o que foi
 * diferente: as quantidades realmente usadas e o rendimento realmente obtido.
 */
import {rotulo, type Unidade} from '../compras/unidades.ts'
import type {Receita, Ingrediente} from './receitas.ts'

export type Modo = 'ficha' | 'alterada'

export interface Lote {
  receitaId: string
  modo: Modo
  /** Quantas receitas foram feitas de uma vez (0,5 = meia receita). Escala a referência da ficha. */
  fator: number
  /** Quantidade total realmente usada, por id do ingrediente; ausente = igual à ficha. */
  usados: Record<string, number>
  /** Rendimento total realmente obtido, na unidade da ficha; ausente = igual à ficha. */
  rendimento?: number
  obs?: string
}

export interface Producao {
  versao: 1
  loja: string
  cozinheiro: string
  /** Dia da produção, AAAA-MM-DD. */
  data: string
  lotes: Lote[]
}

export type Situacao = 'conforme' | 'alterada' | 'incompleta'

export interface Diferenca {
  ingrediente: Ingrediente
  ficha: number
  usado: number
  /** Variação relativa à ficha: 0,1 = 10% a mais. */
  variacao: number
}

export const LOJAS = ['THBF', 'THBT'] as const
export const FATOR_MIN = 0.5
export const FATOR_MAX = 20

/**
 * Produção vazia para um dia.
 * @param data dia no formato AAAA-MM-DD
 * @param loja sigla da loja
 * @param cozinheiro nome de quem produziu
 */
export function producaoVazia(data: string, loja: string = LOJAS[0], cozinheiro = ''): Producao {
  return {versao: 1, loja, cozinheiro, data, lotes: []}
}

/**
 * Casas decimais aceitas por unidade: kg e L com 3, unidade com 1 (meio limão), g e ml inteiros.
 * @param u unidade
 */
export function casas(u: Unidade): number {
  return u === 'kg' || u === 'l' ? 3 : u === 'un' ? 1 : 0
}

/**
 * Arredonda uma quantidade para as casas da unidade; nunca negativa.
 * @param n quantidade
 * @param u unidade
 */
export function arredondar(n: number, u: Unidade): number {
  const p = 10 ** casas(u)
  return Math.max(0, Math.round(n * p) / p)
}

/**
 * Quantidade com unidade no padrão da ficha: "1,234 kg", "564 g", "2,470 L", "3 un".
 * @param n quantidade
 * @param u unidade
 */
export function formatar(n: number, u: Unidade): string {
  const fixas = u === 'kg' || u === 'l' ? 3 : 0
  return `${n.toLocaleString('pt-BR', {minimumFractionDigits: fixas, maximumFractionDigits: Math.max(fixas, casas(u))})} ${rotulo(u)}`
}

/**
 * Lê o que foi digitado ("1,5", "1.5", "40"); vazio ou inválido = undefined.
 * @param texto texto do campo
 * @param u unidade do campo
 */
export function lerCampo(texto: string, u: Unidade): number | undefined {
  const t = texto.trim().replace(',', '.')
  if (t === '' || t === '.' || !/^\d*\.?\d*$/.test(t)) return undefined
  return arredondar(Number(t), u)
}

/**
 * Texto de um número para o campo de digitação (vírgula decimal, sem unidade).
 * @param n quantidade ou undefined
 */
export function textoCampo(n: number | undefined): string {
  return n == null ? '' : String(n).replace('.', ',')
}

/**
 * Lote de uma receita, se houver.
 * @param p produção
 * @param receitaId id da receita
 */
export function loteDe(p: Producao, receitaId: string): Lote | undefined {
  return p.lotes.find(l => l.receitaId === receitaId)
}

/**
 * Quantidade de referência de um ingrediente: a da ficha vezes o número de receitas feitas.
 * @param i ingrediente
 * @param fator receitas feitas
 */
export function referencia(i: Pick<Ingrediente, 'qtd' | 'unidade'>, fator: number): number {
  return arredondar(i.qtd * fator, i.unidade)
}

/**
 * Rendimento de referência: o da ficha vezes o número de receitas feitas.
 * @param r receita
 * @param fator receitas feitas
 */
export function rendimentoFicha(r: Receita, fator: number): number {
  return arredondar(r.rendimento.qtd * fator, r.rendimento.unidade)
}

function trocarLote(p: Producao, receitaId: string, f: (l: Lote) => Lote | undefined): Producao {
  const atual = loteDe(p, receitaId) ?? {receitaId, modo: 'alterada' as Modo, fator: 1, usados: {}}
  const novo = f(atual)
  const resto = p.lotes.filter(l => l.receitaId !== receitaId)
  return {...p, lotes: novo ? [...resto, novo] : resto}
}

/**
 * Marca (ou desmarca) que a receita seguiu a ficha: apaga o que havia sido digitado.
 * @param p produção
 * @param receitaId id da receita
 */
export function alternarFicha(p: Producao, receitaId: string): Producao {
  const atual = loteDe(p, receitaId)
  if (atual?.modo === 'ficha') return removerLote(p, receitaId)
  return trocarLote(p, receitaId, l => ({receitaId, modo: 'ficha', fator: l.fator, usados: {}, ...(l.obs ? {obs: l.obs} : {})}))
}

/**
 * Registra a quantidade usada de um ingrediente; undefined volta para o valor da ficha.
 * @param p produção
 * @param receitaId id da receita
 * @param ingredienteId id do ingrediente
 * @param qtd quantidade usada
 */
export function definirUsado(p: Producao, receitaId: string, ingredienteId: string, qtd: number | undefined): Producao {
  return trocarLote(p, receitaId, l => {
    const usados = {...l.usados}
    if (qtd == null) delete usados[ingredienteId]
    else usados[ingredienteId] = qtd
    return limpar({...l, modo: 'alterada', usados})
  })
}

/**
 * Registra o rendimento obtido; undefined apaga.
 * @param p produção
 * @param receitaId id da receita
 * @param qtd rendimento na unidade da ficha
 */
export function definirRendimento(p: Producao, receitaId: string, qtd: number | undefined): Producao {
  return trocarLote(p, receitaId, l => {
    const {rendimento: _antigo, ...resto} = l
    return limpar({...resto, modo: 'alterada', ...(qtd ? {rendimento: qtd} : {})})
  })
}

/**
 * Define quantas receitas foram feitas (passos de meia receita).
 * @param p produção
 * @param receitaId id da receita
 * @param fator receitas feitas
 */
export function definirFator(p: Producao, receitaId: string, fator: number): Producao {
  const f = Math.min(FATOR_MAX, Math.max(FATOR_MIN, Math.round(fator * 2) / 2))
  return trocarLote(p, receitaId, l => limpar({...l, fator: f}))
}

/**
 * Observação livre do lote.
 * @param p produção
 * @param receitaId id da receita
 * @param obs texto
 */
export function definirObs(p: Producao, receitaId: string, obs: string): Producao {
  return trocarLote(p, receitaId, l => {
    const {obs: _antiga, ...resto} = l
    const t = obs.trim().slice(0, 200)
    return limpar(t ? {...resto, obs: t} : resto)
  })
}

/**
 * Tira a receita da produção.
 * @param p produção
 * @param receitaId id da receita
 */
export function removerLote(p: Producao, receitaId: string): Producao {
  return {...p, lotes: p.lotes.filter(l => l.receitaId !== receitaId)}
}

/** Um lote "alterada" sem nada digitado não é um registro: some da produção. */
function limpar(l: Lote): Lote | undefined {
  if (l.modo === 'ficha') return l
  return Object.keys(l.usados).length || l.rendimento || l.obs || l.fator !== 1 ? l : undefined
}

/**
 * Ingredientes cuja quantidade usada difere da ficha.
 * @param r receita
 * @param l lote
 */
export function diferencas(r: Receita, l: Lote): Diferenca[] {
  return r.ingredientes.flatMap(ingrediente => {
    const usado = l.usados[ingrediente.id]
    const ficha = referencia(ingrediente, l.fator)
    if (usado == null || usado === ficha) return []
    return [{ingrediente, ficha, usado, variacao: ficha ? (usado - ficha) / ficha : 0}]
  })
}

/**
 * Situação do lote: conforme a ficha, alterada, ou incompleta (mudou ingrediente e não informou
 * o rendimento, que é o dado que permite medir o efeito da mudança).
 * @param r receita
 * @param l lote
 */
export function situacao(r: Receita, l: Lote): Situacao {
  if (l.modo === 'ficha') return 'conforme'
  const mudou = diferencas(r, l).length > 0
  if (!l.rendimento) return mudou ? 'incompleta' : 'conforme'
  return mudou || l.rendimento !== rendimentoFicha(r, l.fator) ? 'alterada' : 'conforme'
}

/**
 * Rendimento que vale para o lote: o informado ou, na falta, o da ficha.
 * @param r receita
 * @param l lote
 */
export function rendimentoDoLote(r: Receita, l: Lote): number {
  return l.rendimento ?? rendimentoFicha(r, l.fator)
}

/**
 * Lotes na ordem das fichas, com a receita de cada um (ignora receitas que saíram do cadastro).
 * @param p produção
 * @param receitas cadastro de receitas
 */
export function lotesOrdenados(p: Producao, receitas: Receita[]): {receita: Receita, lote: Lote}[] {
  return receitas.flatMap(receita => {
    const lote = loteDe(p, receita.id)
    return lote ? [{receita, lote}] : []
  })
}

/**
 * Contagem por situação.
 * @param p produção
 * @param receitas cadastro de receitas
 */
export function contar(p: Producao, receitas: Receita[]): Record<Situacao, number> {
  const c = {conforme: 0, alterada: 0, incompleta: 0}
  for (const {receita, lote} of lotesOrdenados(p, receitas)) c[situacao(receita, lote)]++
  return c
}

/**
 * Variação em texto: "+21,6%", "−8,0%".
 * @param v variação relativa
 */
export function pct(v: number): string {
  const n = (Math.abs(v) * 100).toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1})
  return `${v < 0 ? '−' : '+'}${n}%`
}

/**
 * Dia AAAA-MM-DD como DD/MM/AAAA.
 * @param iso dia
 */
export function dataBr(iso: string): string {
  return iso.split('-').reverse().join('/')
}

function fatorTexto(f: number): string {
  return f === 1 ? '' : ` ×${f.toLocaleString('pt-BR')}`
}

/**
 * Relatório para WhatsApp (*negrito*, _itálico_): cabeçalho, totais e um bloco por receita.
 * Receita conforme a ficha sai em uma linha com o rendimento; receita alterada lista só o que
 * mudou, com o valor da ficha e a variação, e o rendimento obtido contra o da ficha.
 * @param p produção
 * @param receitas cadastro de receitas
 */
export function relatorio(p: Producao, receitas: Receita[]): string {
  const lotes = lotesOrdenados(p, receitas)
  const c = contar(p, receitas)
  const linhas = [`🧑‍🍳 *THB · PRODUÇÃO* · ${p.loja} · ${dataBr(p.data)}`]
  if (p.cozinheiro.trim()) linhas.push(`Cozinheiro: ${p.cozinheiro.trim()}`)
  linhas.push(`✅ ${c.conforme} conforme a ficha · ✏️ ${c.alterada} com alteração${c.incompleta ? ` · ⚠️ ${c.incompleta} sem rendimento` : ''}`)
  for (const {receita: r, lote: l} of lotes) {
    const s = situacao(r, l)
    const u = r.rendimento.unidade
    const ficha = rendimentoFicha(r, l.fator)
    linhas.push('')
    if (s === 'conforme') {
      linhas.push(`✅ *${r.nome}*${fatorTexto(l.fator)} · conforme a ficha`, `Rendimento: ${formatar(ficha, u)}`)
    } else {
      linhas.push(`${s === 'incompleta' ? '⚠️' : '✏️'} *${r.nome}*${fatorTexto(l.fator)} · ALTERADA`)
      const difs = diferencas(r, l)
      for (const d of difs) linhas.push(`• ${d.ingrediente.nome}: *${formatar(d.usado, d.ingrediente.unidade)}* (ficha ${formatar(d.ficha, d.ingrediente.unidade)} · ${pct(d.variacao)})`)
      if (difs.length && difs.length < r.ingredientes.length) linhas.push('• Demais ingredientes: conforme a ficha')
      if (!difs.length) linhas.push('• Ingredientes: conforme a ficha')
      if (l.rendimento) {
        const v = ficha ? (l.rendimento - ficha) / ficha : 0
        linhas.push(`Rendimento: *${formatar(l.rendimento, u)}* (ficha ${formatar(ficha, u)}${l.rendimento === ficha ? '' : ` · ${pct(v)}`})`)
      } else linhas.push(`Rendimento: _não informado_ (ficha ${formatar(ficha, u)})`)
    }
    if (l.obs) linhas.push(`_Obs.: ${l.obs}_`)
  }
  if (!lotes.length) linhas.push('', '_Nenhuma receita registrada._')
  return linhas.join('\n')
}

/**
 * Endereço que abre o WhatsApp com a mensagem pronta. Sem número, o WhatsApp pede o contato.
 * @param texto mensagem
 * @param numero telefone de destino com DDI e DDD (só dígitos são usados), opcional
 */
export function linkWhatsApp(texto: string, numero = ''): string {
  const n = numero.replace(/\D/g, '')
  return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`
}

/**
 * Valida a produção lida do armazenamento (não confiável) contra o cadastro de receitas.
 * @param bruto objeto lido
 * @param receitas cadastro de receitas
 * @param hoje dia usado quando não há data válida
 */
export function revisar(bruto: unknown, receitas: Receita[], hoje: string): Producao {
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>
  const porId = new Map(receitas.map(r => [r.id, r]))
  const lotes = (Array.isArray(b.lotes) ? b.lotes : []).flatMap((x: unknown): Lote[] => {
    const l = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    const r = porId.get(String(l.receitaId))
    if (!r) return []
    const u = (l.usados && typeof l.usados === 'object' ? l.usados : {}) as Record<string, unknown>
    const usados: Record<string, number> = {}
    for (const i of r.ingredientes) {
      const n = u[i.id]
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) usados[i.id] = arredondar(n, i.unidade)
    }
    const fator = typeof l.fator === 'number' && l.fator >= FATOR_MIN && l.fator <= FATOR_MAX ? Math.round(l.fator * 2) / 2 : 1
    const rend = typeof l.rendimento === 'number' && l.rendimento > 0 ? arredondar(l.rendimento, r.rendimento.unidade) : undefined
    const obs = typeof l.obs === 'string' && l.obs.trim() ? l.obs.trim().slice(0, 200) : undefined
    const lote = limpar({
      receitaId: r.id, modo: l.modo === 'ficha' ? 'ficha' : 'alterada', fator,
      usados: l.modo === 'ficha' ? {} : usados,
      ...(rend && l.modo !== 'ficha' ? {rendimento: rend} : {}), ...(obs ? {obs} : {})
    })
    return lote ? [lote] : []
  })
  return {
    versao: 1,
    loja: typeof b.loja === 'string' && b.loja ? b.loja : LOJAS[0],
    cozinheiro: typeof b.cozinheiro === 'string' ? b.cozinheiro.slice(0, 40) : '',
    data: typeof b.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.data) ? b.data : hoje,
    lotes
  }
}
