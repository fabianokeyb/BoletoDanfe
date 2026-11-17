/**
 * Registro de produção contra a ficha técnica: funções puras, sem DOM.
 *
 * Cada receita feita vira um lote, que pertence a uma loja e a um cozinheiro desde o primeiro número
 * digitado. Enquanto é preenchido, o lote está aberto (no máximo um aberto por receita em cada loja).
 * Cada loja tem o próprio cozinheiro e o próprio andamento. Ao tocar "Finalizar receita" ele grava o dia, entra na
 * fila de envio e sai para o Supabase assim que houver sinal. O id do lote nasce no aparelho, então
 * reenviar (sinal caiu no meio, correção depois) atualiza o mesmo registro em vez de duplicar.
 *
 * O peso final (rendimento) é obrigatório para finalizar: é o único número que dá para conferir.
 *
 * Quantas receitas foram feitas não é perguntado: é calculado pelos ingredientes (ver fatorDe).
 */
import {rotulo, type Unidade} from '../compras/unidades.ts'
import type {Receita, Ingrediente} from './receitas.ts'
import {autorizado} from './funcionarios.ts'

export type Modo = 'ficha' | 'alterada'

export interface Lote {
  /** UUID gerado no aparelho; chave primária no Supabase. */
  id: string
  receitaId: string
  /** 'ficha' = exatamente 1 receita da ficha (o rendimento continua sendo pesado). */
  modo: Modo
  /** Quantidade total realmente usada, por id do ingrediente; ausente = a da ficha (1 receita). */
  usados: Record<string, number>
  /** Peso/volume final obtido, na unidade da ficha. */
  rendimento?: number
  obs?: string
  iniciadoEm: number
  /** Loja e cozinheiro de quem começou o lote. */
  loja: string
  cozinheiro: string
  /** Preenchidos ao finalizar. */
  finalizadoEm?: number
  data?: string
  /** Quando o servidor confirmou o recebimento desta versão do lote. */
  enviadoEm?: number
}

export interface Producao {
  versao: 3
  /** Loja na tela. */
  loja: string
  /** Cozinheiro trabalhando em cada loja (código da loja → nome). */
  cozinheiros: Record<string, string>
  /** Dia da produção, AAAA-MM-DD. */
  data: string
  lotes: Lote[]
}

export type Situacao = 'conforme' | 'alterada' | 'incompleta'

export interface Diferenca {
  ingrediente: Ingrediente
  /** Ficha × receitas feitas. */
  esperado: number
  usado: number
  /** Variação relativa ao esperado: 0,1 = 10% a mais. */
  variacao: number
}

/** Corpo enviado para public.fichas_registrar. */
export interface Pacote {
  id: string
  loja: string
  data: string
  cozinheiro: string
  receitaId: string
  receitaNome: string
  /** Receitas feitas, calculado. */
  fator: number
  seguiuFicha: boolean
  /** Rendimento da ficha para 1 receita. */
  rendimentoFicha: number
  rendimento: number
  unidade: Unidade
  obs: string
  iniciadoEm: number
  finalizadoEm: number
  /** ficha = quantidade para 1 receita. */
  ingredientes: {id: string, nome: string, unidade: Unidade, ficha: number, usado: number}[]
}

/** Código da loja (gravado) e nome exibido. */
export const LOJAS = ['THBF', 'THBT'] as const
export const NOME_LOJA: Record<string, string> = {THBF: 'Freguesia', THBT: 'Tijuca'}

/** Desvio tolerado entre usado e esperado antes de contar como fora da proporção. */
export const TOLERANCIA = 0.03

/** Gerador de ids; trocado nos testes. */
export type GeradorId = () => string
const uuid: GeradorId = () => crypto.randomUUID()

/**
 * Produção vazia para um dia.
 * @param data dia no formato AAAA-MM-DD
 * @param loja sigla da loja
 * @param cozinheiro nome de quem produziu
 */
export function producaoVazia(data: string, loja: string = LOJAS[0], cozinheiro = ''): Producao {
  return {versao: 3, loja, cozinheiros: cozinheiro ? {[loja]: cozinheiro} : {}, data, lotes: []}
}

/**
 * Cozinheiro escolhido na loja da tela ('' se ninguém).
 * @param p produção
 */
export function cozinheiroAtual(p: Producao): string {
  return p.cozinheiros[p.loja] ?? ''
}

/**
 * Escolhe o cozinheiro da loja da tela; nome fora da lista de autorizados limpa a escolha.
 * @param p produção
 * @param nome funcionário
 */
export function escolherCozinheiro(p: Producao, nome: string): Producao {
  return {...p, cozinheiros: {...p.cozinheiros, [p.loja]: autorizado(nome) ? nome : ''}}
}

/**
 * Troca a loja da tela.
 * @param p produção
 * @param loja código da loja
 */
export function escolherLoja(p: Producao, loja: string): Producao {
  return loja in NOME_LOJA ? {...p, loja} : p
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
  let t = texto.trim()
  // Com vírgula, pontos são separador de milhar: "1.234,567".
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  if (t === '' || t === '.' || !/^\d*\.?\d*$/.test(t)) return undefined
  return arredondar(Number(t), u)
}

/**
 * Texto de um número para o campo de digitação, sem unidade. kg e L sempre com 3 casas
 * ("1,200"), igual ao que a digitação automática mostra; as demais sem casas fixas.
 * @param n quantidade ou undefined
 * @param u unidade do campo
 */
export function textoCampo(n: number | undefined, u?: Unidade): string {
  if (n == null) return ''
  if (u && casasAutomaticas(u)) return n.toLocaleString('pt-BR', {minimumFractionDigits: 3, maximumFractionDigits: 3})
  return String(n).replace('.', ',')
}

/**
 * Unidades digitadas como calculadora: só números, com a vírgula entrando sozinha a 3 casas da
 * direita (1 → 0,001; 12 → 0,012; 1200 → 1,200). Evita "1,2 kg" virar 12 kg quando a vírgula falha.
 * @param u unidade
 */
export function casasAutomaticas(u: Unidade): boolean {
  return u === 'kg' || u === 'l'
}

/**
 * Aplica a digitação automática de 3 casas ao que está no campo.
 * @param texto conteúdo atual do campo
 * @returns texto formatado ("" se não houver dígitos)
 */
export function digitarTresCasas(texto: string): string {
  const digitos = texto.replace(/\D/g, '').replace(/^0+/, '').slice(0, 7)
  return digitos ? (Number(digitos) / 1000).toLocaleString('pt-BR', {minimumFractionDigits: 3, maximumFractionDigits: 3}) : ''
}

/**
 * Lote aberto (em preenchimento) de uma receita numa loja, se houver.
 * @param p produção
 * @param receitaId id da receita
 * @param loja código da loja (padrão: a da tela)
 */
export function loteAberto(p: Producao, receitaId: string, loja = p.loja): Lote | undefined {
  return p.lotes.find(l => l.receitaId === receitaId && l.loja === loja && !l.finalizadoEm)
}

/**
 * Andamento de uma loja no dia: receitas em preenchimento e lotes finalizados.
 * @param p produção
 * @param loja código da loja
 */
export function andamentoDaLoja(p: Producao, loja: string): {abertos: number, finalizados: number} {
  return {
    abertos: p.lotes.filter(l => l.loja === loja && !l.finalizadoEm).length,
    finalizados: p.lotes.filter(l => l.loja === loja && l.finalizadoEm && l.data === p.data).length
  }
}

/**
 * Lotes finalizados de uma receita no dia e loja da produção, do mais antigo ao mais novo.
 * @param p produção
 * @param receitaId id da receita
 */
export function finalizadosDe(p: Producao, receitaId: string): Lote[] {
  return p.lotes.filter(l => l.receitaId === receitaId && l.finalizadoEm && l.data === p.data && l.loja === p.loja)
    .sort((a, b) => a.finalizadoEm! - b.finalizadoEm!)
}

/**
 * Peso aproximado em gramas, usado só para ponderar a proporção: 1 ml conta como 1 g.
 * Unidades (ovo, limão, cebola) não têm peso conhecido e ficam de fora (peso 0).
 * @param q quantidade
 * @param u unidade
 */
function gramas(q: number, u: Unidade): number {
  return u === 'kg' || u === 'l' ? q * 1000 : u === 'un' ? 0 : q
}

/**
 * Receitas feitas, calculadas pelos ingredientes: a mediana das proporções usado/ficha,
 * ponderada pela raiz quadrada do peso de cada ingrediente na ficha.
 *
 * A mediana ignora o ingrediente que saiu da proporção: na Calabrese com 1,5 kg de calabresa e o
 * resto igual à ficha, dá 1 receita e a calabresa aparece +21,6%. Seguir o ingrediente mais
 * alterado daria 1,22 receita e acusaria todo o resto de faltar 18%; a média ponderada daria 1,05.
 * A raiz do peso evita os dois extremos: com o peso puro, a maionese (59% da Calabrese) decidiria
 * sozinha; com peso igual, 10 g de orégano valeriam o mesmo que 3 kg de maionese.
 * @param r receita
 * @param l lote
 * @returns receitas feitas, 3 casas; 1 quando seguiu a ficha ou não há o que medir
 */
export function fatorDe(r: Receita, l: Pick<Lote, 'modo' | 'usados'>): number {
  if (l.modo === 'ficha') return 1
  const pontos = r.ingredientes.filter(i => i.qtd > 0).map(i => ({razao: (l.usados[i.id] ?? i.qtd) / i.qtd, peso: Math.sqrt(gramas(i.qtd, i.unidade))}))
  const comPeso = pontos.some(x => x.peso > 0) ? pontos.filter(x => x.peso > 0) : pontos.map(x => ({...x, peso: 1}))
  if (!comPeso.length) return 1
  comPeso.sort((a, b) => a.razao - b.razao)
  const metade = comPeso.reduce((s, x) => s + x.peso, 0) / 2
  let acumulado = 0
  for (let k = 0; k < comPeso.length; k++) {
    acumulado += comPeso[k].peso
    if (Math.abs(acumulado - metade) < 1e-9 && k + 1 < comPeso.length) return arredondarFator((comPeso[k].razao + comPeso[k + 1].razao) / 2)
    if (acumulado > metade) return arredondarFator(comPeso[k].razao)
  }
  return arredondarFator(comPeso.at(-1)!.razao)
}

function arredondarFator(f: number): number {
  const r = Math.round(f * 1000) / 1000
  return r > 0 ? r : 1
}

/**
 * Receitas feitas em texto: "1 receita", "1,96 receita", "2 receitas".
 * @param f receitas feitas
 */
export function fatorTexto(f: number): string {
  return `${f.toLocaleString('pt-BR', {maximumFractionDigits: 2})} ${f >= 2 ? 'receitas' : 'receita'}`
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
 * Rendimento esperado: o da ficha vezes o número de receitas feitas.
 * @param r receita
 * @param fator receitas feitas
 */
export function rendimentoFicha(r: Receita, fator: number): number {
  return arredondar(r.rendimento.qtd * fator, r.rendimento.unidade)
}

/**
 * Altera o lote aberto da receita na loja da tela, criando-o se preciso (com a loja e o cozinheiro
 * escolhido); devolver undefined descarta o lote. Sem cozinheiro autorizado não cria nada.
 */
function trocarAberto(p: Producao, receitaId: string, f: (l: Lote) => Lote | undefined, novoId: GeradorId, agora: number): Producao {
  const quem = cozinheiroAtual(p)
  const existente = loteAberto(p, receitaId)
  if (!existente && !autorizado(quem)) return p
  const atual = existente ?? {id: novoId(), receitaId, modo: 'alterada' as Modo, usados: {}, iniciadoEm: agora, loja: p.loja, cozinheiro: quem}
  const novo = f(atual)
  const resto = p.lotes.filter(l => l !== atual && l.id !== atual.id)
  return {...p, lotes: novo ? [...resto, novo] : resto}
}

/** Lote aberto sem nada preenchido não é registro: some. */
function limpar(l: Lote): Lote | undefined {
  if (l.modo === 'ficha') return l
  return Object.keys(l.usados).length || l.rendimento || l.obs ? l : undefined
}

/**
 * Marca (ou desmarca) que fez exatamente 1 receita da ficha: apaga as quantidades digitadas,
 * mantém rendimento e observação.
 * @param p produção
 * @param receitaId id da receita
 * @param novoId gerador de id
 * @param agora relógio
 */
export function alternarFicha(p: Producao, receitaId: string, novoId: GeradorId = uuid, agora = Date.now()): Producao {
  return trocarAberto(p, receitaId, l => limpar({...l, modo: l.modo === 'ficha' ? 'alterada' : 'ficha', usados: {}}), novoId, agora)
}

/**
 * Registra a quantidade usada de um ingrediente; undefined volta para o valor da ficha.
 * Qualquer valor digitado tira o lote do modo "segui a ficha".
 * @param p produção
 * @param receitaId id da receita
 * @param ingredienteId id do ingrediente
 * @param qtd quantidade usada
 * @param novoId gerador de id
 * @param agora relógio
 */
export function definirUsado(p: Producao, receitaId: string, ingredienteId: string, qtd: number | undefined, novoId: GeradorId = uuid, agora = Date.now()): Producao {
  return trocarAberto(p, receitaId, l => {
    const usados = {...l.usados}
    if (qtd == null) delete usados[ingredienteId]
    else usados[ingredienteId] = qtd
    return limpar({...l, modo: qtd == null && l.modo === 'ficha' ? 'ficha' : 'alterada', usados: qtd == null && l.modo === 'ficha' ? {} : usados})
  }, novoId, agora)
}

/**
 * Registra o rendimento obtido; undefined ou zero apaga.
 * @param p produção
 * @param receitaId id da receita
 * @param qtd rendimento na unidade da ficha
 * @param novoId gerador de id
 * @param agora relógio
 */
export function definirRendimento(p: Producao, receitaId: string, qtd: number | undefined, novoId: GeradorId = uuid, agora = Date.now()): Producao {
  return trocarAberto(p, receitaId, l => {
    const {rendimento: _antigo, ...resto} = l
    return limpar(qtd ? {...resto, rendimento: qtd} : resto)
  }, novoId, agora)
}

/**
 * Observação livre do lote aberto.
 * @param p produção
 * @param receitaId id da receita
 * @param obs texto
 * @param novoId gerador de id
 * @param agora relógio
 */
export function definirObs(p: Producao, receitaId: string, obs: string, novoId: GeradorId = uuid, agora = Date.now()): Producao {
  return trocarAberto(p, receitaId, l => {
    const {obs: _antiga, ...resto} = l
    const t = obs.trim().slice(0, 200)
    return limpar(t ? {...resto, obs: t} : resto)
  }, novoId, agora)
}

/**
 * Descarta o lote aberto da receita (o que estava sendo preenchido).
 * @param p produção
 * @param receitaId id da receita
 */
export function descartarAberto(p: Producao, receitaId: string): Producao {
  const a = loteAberto(p, receitaId)
  return a ? {...p, lotes: p.lotes.filter(l => l !== a)} : p
}

/**
 * Por que o lote aberto ainda não pode ser finalizado; undefined = pode.
 * @param r receita
 * @param l lote aberto
 */
export function faltaParaFinalizar(r: Receita, l: Lote | undefined): string | undefined {
  if (!l) return 'Marque “Segui a ficha” ou digite o que foi diferente.'
  if (!l.rendimento) return `Pese e informe o rendimento de ${r.nome}.`
  return undefined
}

/**
 * Finaliza o lote aberto da loja da tela: grava o dia e põe na fila de envio. O cozinheiro é quem
 * começou o lote; se esse nome não for mais autorizado, vale o escolhido agora na loja.
 * @param p produção
 * @param r receita
 * @param agora relógio
 * @returns a produção nova, ou o motivo de não finalizar
 */
export function finalizar(p: Producao, r: Receita, agora = Date.now()): {producao: Producao, erro?: undefined} | {producao?: undefined, erro: string} {
  const l = loteAberto(p, r.id)
  const quem = l && autorizado(l.cozinheiro) ? l.cozinheiro : cozinheiroAtual(p)
  const erro = faltaParaFinalizar(r, l) ?? (autorizado(quem) ? undefined : 'Escolha seu nome no topo da tela.')
  if (erro || !l) return {erro: erro!}
  const fechado: Lote = {...l, finalizadoEm: agora, data: p.data, cozinheiro: quem}
  delete fechado.enviadoEm
  return {producao: {...p, lotes: p.lotes.map(x => x === l ? fechado : x)}}
}

/**
 * Reabre um lote finalizado para correção. Ele volta a ser o lote aberto da receita (o mesmo id:
 * ao finalizar de novo, o servidor atualiza o registro). Recusa se já houver outro aberto.
 * @param p produção
 * @param loteId id do lote
 */
export function reabrir(p: Producao, loteId: string): Producao {
  const l = p.lotes.find(x => x.id === loteId)
  if (!l?.finalizadoEm || loteAberto(p, l.receitaId, l.loja)) return p
  const {finalizadoEm: _f, enviadoEm: _e, ...aberto} = l
  return {...p, lotes: p.lotes.map(x => x === l ? aberto : x)}
}

/**
 * Lotes finalizados que o servidor ainda não confirmou, do mais antigo ao mais novo.
 * @param p produção
 */
export function pendentesEnvio(p: Producao): Lote[] {
  return p.lotes.filter(l => l.finalizadoEm && !l.enviadoEm).sort((a, b) => a.finalizadoEm! - b.finalizadoEm!)
}

/**
 * Registra a confirmação do servidor, só se o lote ainda estiver na mesma versão que foi enviada
 * (se foi reaberto ou refinalizado durante o envio, continua pendente).
 * @param p produção
 * @param loteId id do lote
 * @param finalizadoEm versão enviada
 * @param agora relógio
 */
export function marcarEnviado(p: Producao, loteId: string, finalizadoEm: number, agora = Date.now()): Producao {
  return {...p, lotes: p.lotes.map(l => l.id === loteId && l.finalizadoEm === finalizadoEm ? {...l, enviadoEm: agora} : l)}
}

/**
 * Corpo do envio de um lote finalizado, com a ficha da época (1 receita) congelada em cada ingrediente.
 * @param r receita
 * @param l lote finalizado
 */
export function pacote(r: Receita, l: Lote): Pacote {
  return {
    id: l.id, loja: l.loja, data: l.data ?? '', cozinheiro: l.cozinheiro,
    receitaId: r.id, receitaNome: r.nome, fator: fatorDe(r, l), seguiuFicha: l.modo === 'ficha',
    rendimentoFicha: r.rendimento.qtd, rendimento: l.rendimento ?? 0, unidade: r.rendimento.unidade,
    obs: l.obs ?? '', iniciadoEm: l.iniciadoEm, finalizadoEm: l.finalizadoEm ?? 0,
    ingredientes: r.ingredientes.map(i => ({id: i.id, nome: i.nome, unidade: i.unidade, ficha: i.qtd, usado: l.usados[i.id] ?? i.qtd}))
  }
}

/** Menor diferença que conta, por unidade: 1 g ou ml, meia unidade. */
function passo(u: Unidade): number {
  return u === 'un' ? 0.5 : u === 'kg' || u === 'l' ? 0.001 : 1
}

/**
 * Ingredientes fora da proporção: usado diferente de ficha × receitas feitas por mais de 3%
 * (e mais que o menor passo da unidade, para não acusar arredondamento de 1 g).
 * @param r receita
 * @param l lote
 */
export function diferencas(r: Receita, l: Lote): Diferenca[] {
  const f = fatorDe(r, l)
  return r.ingredientes.flatMap(ingrediente => {
    const usado = l.usados[ingrediente.id] ?? ingrediente.qtd
    const esperado = ingrediente.qtd * f
    const dif = usado - esperado
    if (Math.abs(dif) <= Math.max(TOLERANCIA * esperado, passo(ingrediente.unidade))) return []
    return [{ingrediente, esperado: arredondar(esperado, ingrediente.unidade), usado, variacao: esperado ? dif / esperado : 0}]
  })
}

/**
 * Situação do lote: incompleta (falta o rendimento), alterada (algum ingrediente fora da proporção)
 * ou conforme (ingredientes na proporção da ficha, em qualquer quantidade de receitas).
 * @param r receita
 * @param l lote
 */
export function situacao(r: Receita, l: Lote): Situacao {
  if (!l.rendimento) return 'incompleta'
  return l.modo !== 'ficha' && diferencas(r, l).length ? 'alterada' : 'conforme'
}

/**
 * Lotes finalizados no dia e loja da produção, na ordem das fichas e depois da finalização.
 * @param p produção
 * @param receitas cadastro de receitas
 */
export function finalizadosDoDia(p: Producao, receitas: Receita[]): {receita: Receita, lote: Lote}[] {
  return receitas.flatMap(receita => finalizadosDe(p, receita.id).map(lote => ({receita, lote})))
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

function fatorSufixo(f: number): string {
  return f === 1 ? '' : ` · ${fatorTexto(f)}`
}

/**
 * Relatório do dia para WhatsApp (*negrito*, _itálico_): só receitas finalizadas. Cada uma mostra
 * o rendimento pesado contra o da ficha; as alteradas listam o que mudou, com a ficha e a variação.
 * Receitas ainda abertas aparecem numa linha final, para ninguém achar que foram esquecidas.
 * @param p produção
 * @param receitas cadastro de receitas
 */
export function relatorio(p: Producao, receitas: Receita[]): string {
  const lotes = finalizadosDoDia(p, receitas)
  const alteradas = lotes.filter(x => situacao(x.receita, x.lote) === 'alterada').length
  const linhas = [`🧑‍🍳 *THB · PRODUÇÃO* · ${NOME_LOJA[p.loja] ?? p.loja} · ${dataBr(p.data)}`]
  const quem = [...new Set(lotes.map(x => x.lote.cozinheiro).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  if (quem.length) linhas.push(`${quem.length > 1 ? 'Cozinheiros' : 'Cozinheiro'}: ${quem.join(', ')}`)
  linhas.push(`✅ ${lotes.length - alteradas} conforme a ficha · ✏️ ${alteradas} com alteração`)
  for (const {receita: r, lote: l} of lotes) {
    const u = r.rendimento.unidade
    const f = fatorDe(r, l)
    const esperado = rendimentoFicha(r, f)
    const ref = f === 1 ? 'ficha' : 'esperado'
    const rend = l.rendimento ?? 0
    const difs = diferencas(r, l)
    linhas.push('')
    if (situacao(r, l) === 'conforme') linhas.push(`✅ *${r.nome}*${fatorSufixo(f)} · na proporção da ficha`)
    else {
      linhas.push(`✏️ *${r.nome}*${fatorSufixo(f)} · ALTERADA`)
      for (const d of difs) linhas.push(`• ${d.ingrediente.nome}: *${formatar(d.usado, d.ingrediente.unidade)}* (${ref} ${formatar(d.esperado, d.ingrediente.unidade)} · ${pct(d.variacao)})`)
      if (difs.length < r.ingredientes.length) linhas.push('• Demais ingredientes: na proporção da ficha')
    }
    linhas.push(`Rendimento: *${formatar(rend, u)}* (${ref} ${formatar(esperado, u)}${rend === esperado ? '' : ` · ${pct(esperado ? (rend - esperado) / esperado : 0)}`})`)
    if (quem.length > 1) linhas.push(`_por ${l.cozinheiro}_`)
    if (l.obs) linhas.push(`_Obs.: ${l.obs}_`)
  }
  if (!lotes.length) linhas.push('', '_Nenhuma receita finalizada._')
  const abertas = receitas.flatMap(r => {const a = loteAberto(p, r.id); return a ? [`${r.nome} (${a.cozinheiro})`] : []})
  if (abertas.length) linhas.push('', `⏳ _Em andamento, não finalizadas: ${abertas.join(', ')}_`)
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
 * Tira do aparelho os lotes já confirmados pelo servidor de dias anteriores. Lotes abertos e
 * lotes ainda não enviados nunca são apagados.
 * @param p produção
 * @param hoje dia AAAA-MM-DD
 */
export function podar(p: Producao, hoje: string): Producao {
  const lotes = p.lotes.filter(l => !l.enviadoEm || (l.data ?? hoje) >= hoje)
  return lotes.length === p.lotes.length ? p : {...p, lotes}
}

/**
 * Valida a produção lida do armazenamento (não confiável) contra o cadastro de receitas.
 * Migra a versão 1 (um lote por receita, sem id) e a 2 (um cozinheiro só; lote aberto sem loja).
 * @param bruto objeto lido
 * @param receitas cadastro de receitas
 * @param hoje dia usado quando não há data válida
 * @param novoId gerador de id para lotes antigos
 */
export function revisar(bruto: unknown, receitas: Receita[], hoje: string, novoId: GeradorId = uuid): Producao {
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>
  const porId = new Map(receitas.map(r => [r.id, r]))
  const loja = (x: unknown) => typeof x === 'string' && x in NOME_LOJA ? x : LOJAS[0]
  const dia = (x: unknown) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : undefined
  const tempo = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : undefined
  const lojaPadrao = loja(b.loja)
  const nome = (x: unknown) => typeof x === 'string' && autorizado(x) ? x : ''
  const cozinheiros: Record<string, string> = {}
  const cz = (b.cozinheiros && typeof b.cozinheiros === 'object' ? b.cozinheiros : {}) as Record<string, unknown>
  for (const k of LOJAS) if (nome(cz[k])) cozinheiros[k] = nome(cz[k])
  if (nome(b.cozinheiro) && !cozinheiros[lojaPadrao]) cozinheiros[lojaPadrao] = nome(b.cozinheiro)
  const ids = new Set<string>()
  const lotes = (Array.isArray(b.lotes) ? b.lotes : []).flatMap((x: unknown): Lote[] => {
    const l = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    const r = porId.get(String(l.receitaId))
    if (!r) return []
    const ficha = l.modo === 'ficha'
    const u = (l.usados && typeof l.usados === 'object' ? l.usados : {}) as Record<string, unknown>
    const usados: Record<string, number> = {}
    if (!ficha) for (const i of r.ingredientes) {
      const n = u[i.id]
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) usados[i.id] = arredondar(n, i.unidade)
    }
    let id = typeof l.id === 'string' && /^[0-9a-f-]{36}$/i.test(l.id) ? l.id : novoId()
    if (ids.has(id)) id = novoId()
    ids.add(id)
    const rend = typeof l.rendimento === 'number' && l.rendimento > 0 ? arredondar(l.rendimento, r.rendimento.unidade) : undefined
    const obs = typeof l.obs === 'string' && l.obs.trim() ? l.obs.trim().slice(0, 200) : undefined
    const finalizadoEm = rend ? tempo(l.finalizadoEm) : undefined
    const lojaLote = typeof l.loja === 'string' && l.loja in NOME_LOJA ? l.loja : lojaPadrao
    const base: Lote = {
      id, receitaId: r.id, modo: ficha ? 'ficha' : 'alterada', usados, iniciadoEm: tempo(l.iniciadoEm) ?? Date.now(),
      loja: lojaLote, cozinheiro: nome(l.cozinheiro) || (finalizadoEm ? '' : cozinheiros[lojaLote] ?? ''),
      ...(rend ? {rendimento: rend} : {}), ...(obs ? {obs} : {})
    }
    if (finalizadoEm) {
      const fim: Lote = {...base, finalizadoEm, data: dia(l.data) ?? hoje,
        cozinheiro: typeof l.cozinheiro === 'string' ? l.cozinheiro.slice(0, 40) : ''}
      const enviado = tempo(l.enviadoEm)
      return [enviado ? {...fim, enviadoEm: enviado} : fim]
    }
    const aberto = limpar(base)
    return aberto ? [aberto] : []
  })
  // No máximo um lote aberto por receita em cada loja: o mais recente fica.
  const vistos = new Set<string>()
  const unicos = lotes.reverse().filter(l => {
    if (l.finalizadoEm) return true
    const k = `${l.receitaId}|${l.loja}`
    return vistos.has(k) ? false : (vistos.add(k), true)
  }).reverse()
  return {
    versao: 3,
    loja: lojaPadrao,
    cozinheiros,
    data: dia(b.data) ?? hoje,
    lotes: unicos
  }
}
