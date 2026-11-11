import {textoParaColar, valorParaColar, type CodigoLido, type Formato, type NotaChave} from './linha-digitavel.ts'

/**
 * Boleto híbrido: barras e QR Pix estão no mesmo quadro e chegam com menos de ~0,5 s de diferença.
 * Documentos distintos exigem trocar o papel (>1,5 s na prática). Janela maior gera falso alerta no lote.
 */
export const JANELA_HIBRIDO_MS = 1200

/** Boleto, arrecadação ou Pix lido na sessão. */
export interface Documento {
  /** Identificador estável: o próprio código de barras ou payload Pix. */
  id: string
  codigo: CodigoLido
  lidoEm: number
  /** Nota fiscal vinculada (id da nota), quando houver. */
  notaId?: string
  /** Alerta exibido na linha; não bloqueia nada, a decisão é do usuário. */
  alerta?: string
}

/** Nota fiscal (NF-e) lida pela DANFE ou cadastrada manualmente. */
export interface Nota {
  /** Chave de acesso (44) quando lida, ou 'm:numero:cnpj' quando manual. */
  id: string
  /** Número da NF (nNF) sem zeros à esquerda — coluna Competência. */
  numero: string
  /** Nome do fornecedor (dropdown Favorecidos da planilha). */
  favorecido: string
  cnpj?: string
  serie?: string
  chave?: string
  /** Valor total da nota, quando informado — usado para conferir e cruzar. */
  valorTotalCentavos?: number
  lidoEm: number
  origem: 'barras' | 'manual'
}

/** Estado completo da sessão: documentos e notas, com os vínculos entre eles. */
export interface Estado {
  /** Mais recente primeiro. */
  documentos: Documento[]
  /** Mais recente primeiro. */
  notas: Nota[]
}

export const ESTADO_VAZIO: Estado = {documentos: [], notas: []}

export type Inclusao<T> = {estado: Estado, novo: boolean, item: T}

/**
 * Monta uma Nota a partir da chave lida da DANFE.
 * @param nota dados extraídos da chave
 * @param favorecido nome do fornecedor (registro local ou digitado)
 * @param agora instante da leitura
 */
export function notaDaChave(nota: NotaChave, favorecido: string, agora = Date.now()): Nota {
  return {id: nota.chave, numero: nota.numero, favorecido, cnpj: nota.cnpj, serie: nota.serie, chave: nota.chave, lidoEm: agora, origem: 'barras'}
}

/**
 * Monta uma Nota cadastrada manualmente (DANFE ilegível).
 * @param numero número da NF (obrigatório)
 * @param favorecido nome do fornecedor
 * @param extra cnpj, série e valor total opcionais
 * @param agora instante do cadastro
 */
export function notaManual(numero: string, favorecido: string,
                           extra: {cnpj?: string, serie?: string, valorTotalCentavos?: number} = {}, agora = Date.now()): Nota {
  const numeroLimpo = String(Number(numero.replace(/\D/g, '')) || numero.trim())
  return {
    id: `m:${numeroLimpo}:${extra.cnpj ?? ''}`,
    numero: numeroLimpo,
    favorecido,
    cnpj: extra.cnpj,
    serie: extra.serie,
    valorTotalCentavos: extra.valorTotalCentavos,
    lidoEm: agora,
    origem: 'manual'
  }
}

/**
 * Inclui um documento na sessão (mais recente primeiro), sem duplicar.
 * Vincula à nota ativa, quando informada. Marca possível boleto híbrido (barras + Pix).
 * @param estado estado atual (não é alterado)
 * @param codigo documento validado
 * @param notaAtivaId nota à qual vincular (modo sincronizado), ou undefined
 * @param agora instante da leitura
 */
export function incluirDocumento(estado: Estado, codigo: CodigoLido, notaAtivaId?: string, agora = Date.now()): Inclusao<Documento> {
  const existente = estado.documentos.find(d => d.id === codigo.barras)
  if (existente) return {estado, novo: false, item: existente}
  const anterior = estado.documentos[0]
  const hibrido = anterior && anterior.codigo.tipo !== codigo.tipo
    && (anterior.codigo.tipo === 'pix' || codigo.tipo === 'pix')
    && agora - anterior.lidoEm <= JANELA_HIBRIDO_MS
  const item: Documento = {
    id: codigo.barras,
    codigo,
    lidoEm: agora,
    notaId: notaAtivaId && estado.notas.some(n => n.id === notaAtivaId) ? notaAtivaId : undefined,
    alerta: hibrido ? 'Lido junto com o anterior: pode ser o mesmo boleto (barras + Pix). Mantenha só um.' : undefined
  }
  return {estado: {...estado, documentos: [item, ...estado.documentos]}, novo: true, item}
}

/**
 * Inclui uma nota na sessão (mais recente primeiro), sem duplicar pela chave/id.
 * Se já existir, completa favorecido ou valor total que estiverem faltando.
 * @param estado estado atual (não é alterado)
 * @param nota nota a incluir
 */
export function incluirNota(estado: Estado, nota: Nota): Inclusao<Nota> {
  const existente = estado.notas.find(n => n.id === nota.id)
  if (existente) {
    const atualizada = {...existente,
      favorecido: existente.favorecido || nota.favorecido,
      valorTotalCentavos: existente.valorTotalCentavos ?? nota.valorTotalCentavos}
    return {estado: {...estado, notas: estado.notas.map(n => n.id === nota.id ? atualizada : n)}, novo: false, item: atualizada}
  }
  return {estado: {...estado, notas: [nota, ...estado.notas]}, novo: true, item: nota}
}

/**
 * Vincula ou desvincula um documento de uma nota.
 * @param estado estado atual
 * @param docId id do documento
 * @param notaId id da nota, ou undefined para desvincular
 */
export function vincular(estado: Estado, docId: string, notaId?: string): Estado {
  return {...estado, documentos: estado.documentos.map(d => d.id === docId ? {...d, notaId} : d)}
}

/**
 * Caso de uma nota só: todo boleto pertence a ela. Vincula os documentos soltos à
 * única nota da sessão, independentemente da ordem de leitura (boleto lido antes da
 * nota, ou nota lida depois dos boletos). Com zero ou mais de uma nota não faz nada,
 * pois aí a escolha é ambígua e fica a cargo do cruzamento/confirmação do usuário.
 * @param estado estado atual (não é alterado)
 * @returns estado com os soltos adotados pela nota única, ou o próprio estado
 */
export function absorverSoltosSeNotaUnica(estado: Estado): Estado {
  if (estado.notas.length !== 1) return estado
  const notaId = estado.notas[0].id
  if (estado.documentos.every(d => d.notaId === notaId)) return estado
  return {...estado, documentos: estado.documentos.map(d => d.notaId ? d : {...d, notaId})}
}

/**
 * Troca o nome do fornecedor de uma nota.
 * @param estado estado atual
 * @param notaId id da nota
 * @param favorecido novo nome
 */
export function atualizarFavorecido(estado: Estado, notaId: string, favorecido: string): Estado {
  return {...estado, notas: estado.notas.map(n => n.id === notaId ? {...n, favorecido} : n)}
}

/**
 * Remove um documento.
 * @param estado estado atual
 * @param id id do documento
 */
export function removerDocumento(estado: Estado, id: string): Estado {
  return {...estado, documentos: estado.documentos.filter(d => d.id !== id)}
}

/**
 * Remove uma nota e desvincula os documentos que apontavam para ela.
 * @param estado estado atual
 * @param id id da nota
 */
export function removerNota(estado: Estado, id: string): Estado {
  return {
    notas: estado.notas.filter(n => n.id !== id),
    documentos: estado.documentos.map(d => d.notaId === id ? {...d, notaId: undefined} : d)
  }
}

/**
 * Soma dos valores conhecidos dos documentos e quantos ficaram sem valor no código.
 * @param estado estado atual
 */
export function totais(estado: Estado) {
  let centavos = 0
  let semValor = 0
  for (const d of estado.documentos) {
    if (d.codigo.valorCentavos) centavos += d.codigo.valorCentavos
    else semValor++
  }
  return {centavos, semValor}
}

/**
 * Documentos vinculados a uma nota, ordenados por vencimento (parcela 1 = mais cedo).
 * @param estado estado atual
 * @param notaId id da nota
 */
export function boletosDaNota(estado: Estado, notaId: string): Documento[] {
  return estado.documentos.filter(d => d.notaId === notaId)
    .sort((a, b) => (a.codigo.vencimento ?? '9999').localeCompare(b.codigo.vencimento ?? '9999') || a.lidoEm - b.lidoEm)
}

export type StatusConciliacao = 'sem-total' | 'confere' | 'parcial' | 'excede'

/**
 * Confere a soma dos boletos de uma nota contra o valor total informado.
 * Juros de parcelamento podem fazer a soma passar do total: é informação, não erro.
 * @param estado estado atual
 * @param notaId id da nota
 */
export function reconciliacao(estado: Estado, notaId: string) {
  const boletos = boletosDaNota(estado, notaId)
  const somaCentavos = boletos.reduce((s, d) => s + (d.codigo.valorCentavos ?? 0), 0)
  const total = estado.notas.find(n => n.id === notaId)?.valorTotalCentavos
  let status: StatusConciliacao = 'sem-total'
  if (total != null) status = somaCentavos === total ? 'confere' : somaCentavos < total ? 'parcial' : 'excede'
  return {boletos, somaCentavos, totalCentavos: total, status}
}

/**
 * Numeração de parcelas por documento vinculado (n de total), na ordem de vencimento.
 * @param estado estado atual
 * @param notaId id da nota
 */
export function parcelasDaNota(estado: Estado, notaId: string): Map<string, {n: number, total: number}> {
  const boletos = boletosDaNota(estado, notaId)
  const mapa = new Map<string, {n: number, total: number}>()
  boletos.forEach((d, i) => mapa.set(d.id, {n: i + 1, total: boletos.length}))
  return mapa
}

/**
 * Procura, entre os documentos ainda sem nota, um subconjunto cujo valor some o total da nota.
 * @param valores centavos dos documentos candidatos
 * @param alvo total da nota em centavos
 * @param limite tamanho máximo do subconjunto (parcelas)
 * @returns índices do subconjunto, ou null
 */
function subconjuntoQueSoma(valores: number[], alvo: number, limite = 6): number[] | null {
  const n = valores.length
  const busca = (inicio: number, restante: number, escolhidos: number[]): number[] | null => {
    if (restante === 0 && escolhidos.length) return escolhidos
    if (restante < 0 || escolhidos.length === limite) return null
    for (let i = inicio; i < n; i++) {
      const r = busca(i + 1, restante - valores[i], [...escolhidos, i])
      if (r) return r
    }
    return null
  }
  return alvo > 0 ? busca(0, alvo, []) : null
}

/**
 * Sugestões de cruzamento: para cada nota com total conhecido e ainda sem boletos suficientes,
 * encontra documentos sem nota cujos valores batem com o total. Uma sugestão por nota.
 * @param estado estado atual
 */
export function sugestoes(estado: Estado): Array<{notaId: string, docIds: string[]}> {
  const livres = estado.documentos.filter(d => !d.notaId && d.codigo.valorCentavos)
  const usados = new Set<string>()
  const resultado: Array<{notaId: string, docIds: string[]}> = []
  for (const nota of [...estado.notas].sort((a, b) => a.lidoEm - b.lidoEm)) {
    const r = reconciliacao(estado, nota.id)
    if (nota.valorTotalCentavos == null || r.status === 'confere') continue
    const candidatos = livres.filter(d => !usados.has(d.id))
    const faltante = nota.valorTotalCentavos - r.somaCentavos
    const idx = subconjuntoQueSoma(candidatos.map(d => d.codigo.valorCentavos!), faltante)
    if (idx) {
      const docIds = idx.map(i => candidatos[i].id)
      docIds.forEach(id => usados.add(id))
      resultado.push({notaId: nota.id, docIds})
    }
  }
  return resultado
}

/** Converte AAAA-MM-DD em DD/MM/AAAA sem passar por fuso horário. */
function dataBr(iso: string): string {
  return iso.split('-').reverse().join('/')
}

/**
 * Linha da planilha (9 colunas A–I) para um documento. Só valores simples: a planilha formata.
 * A=Favorecido B=NFnúmero C=Vencimento D=Valor E=Variação(vazio) F=Status G=Pago(vazio) H=Descrição I=BarCode.
 * @param estado estado atual (para achar a nota e a parcela)
 * @param doc documento
 * @param formato formato da linha digitável na coluna BarCode
 */
function linhaPlanilha(estado: Estado, doc: Documento, formato: Formato): string {
  const nota = doc.notaId ? estado.notas.find(n => n.id === doc.notaId) : undefined
  const parcela = nota ? parcelasDaNota(estado, nota.id).get(doc.id) : undefined
  const descricao = parcela && parcela.total > 1 ? `Parcela${parcela.n}de${parcela.total}` : ''
  const barcode = doc.codigo.tipo === 'pix' ? doc.codigo.barras : textoParaColar(doc.codigo, formato)
  return [
    nota?.favorecido ?? '',
    nota?.numero ?? '',
    doc.codigo.vencimento ? dataBr(doc.codigo.vencimento) : '',
    doc.codigo.valorCentavos ? valorParaColar(doc.codigo.valorCentavos) : '',
    '',
    'A Pagar',
    '',
    descricao,
    barcode
  ].join('\t')
}

/**
 * TSV das 9 colunas, pronto para colar na planilha (sem cabeçalho).
 * Ordena por nota (na ordem de leitura) e por parcela; documentos sem nota ao final.
 * @param estado estado atual
 * @param formato formato da linha digitável na coluna BarCode
 */
export function planilhaTsv(estado: Estado, formato: Formato): string {
  const linhas: string[] = []
  const emitidos = new Set<string>()
  for (const nota of [...estado.notas].reverse()) {
    for (const doc of boletosDaNota(estado, nota.id)) {
      linhas.push(linhaPlanilha(estado, doc, formato))
      emitidos.add(doc.id)
    }
  }
  for (const doc of [...estado.documentos].reverse()) {
    if (!emitidos.has(doc.id)) linhas.push(linhaPlanilha(estado, doc, formato))
  }
  return linhas.join('\n')
}
