/**
 * Conversão local entre código de barras (44 dígitos), linha digitável (47/48)
 * e texto pronto para colar em apps e sites bancários.
 *
 * Roda inteiramente no navegador: a câmera do celular não alcança o backend
 * local (127.0.0.1), e a cópia precisa acontecer no mesmo instante da leitura.
 * As regras espelham backend/src/capture.rs; os testes usam os mesmos vetores.
 *
 * Referências: FEBRABAN — Layout padrão de arrecadação/recebimento com código de
 * barras (blocos de 11 + DV, módulo 10/11); Bacen/FEBRABAN — boleto de pagamento
 * (campos livres, DV geral módulo 11, fator de vencimento reiniciado em 22/02/2025).
 */

export type Formato = 'pontuada' | 'digitos' | 'barras'

export type TipoCodigo = 'boleto' | 'arrecadacao' | 'pix'

export interface CodigoLido {
  tipo: TipoCodigo
  /** 44 dígitos do código de barras, ou o payload Pix integral. */
  barras: string
  /** Linha digitável só com dígitos (47 boleto, 48 arrecadação). Vazia no Pix. */
  linha: string
  /** Linha digitável com pontos, hífens e espaços. Vazia no Pix. */
  pontuada: string
  /** Valor em centavos quando o código carrega valor efetivo. */
  valorCentavos?: number
  /** Vencimento ISO (AAAA-MM-DD) inferido do fator, apenas para conferência visual. */
  vencimento?: string
  /** Pix: nome do recebedor (tag 59). */
  favorecido?: string
  /** Pix dinâmico (URL de cobrança): valor e vencimento só aparecem no app do banco. */
  dinamico?: boolean
}

export type Resultado = { ok: true, codigo: CodigoLido } | { ok: false, erro: string }

const DIA_MS = 86_400_000
/** Fator 1000 do primeiro ciclo = 03/07/2000 (base 07/10/1997). */
const BASE_CICLO_1 = Date.UTC(1997, 9, 7)
/** Fator 1000 do segundo ciclo = 22/02/2025, após o fator 9999 em 21/02/2025. */
const BASE_CICLO_2 = Date.UTC(2025, 1, 22) - 1000 * DIA_MS

/**
 * Módulo 10 FEBRABAN: pesos 2,1 da direita para a esquerda, somando os dígitos dos produtos.
 * @param numeros sequência apenas de dígitos
 * @returns dígito verificador 0–9
 */
export function modulo10(numeros: string): number {
  let soma = 0
  let peso = 2
  for (let i = numeros.length - 1; i >= 0; i--) {
    const produto = Number(numeros[i]) * peso
    soma += Math.floor(produto / 10) + (produto % 10)
    peso = 3 - peso
  }
  return (10 - (soma % 10)) % 10
}

/**
 * Resto da soma ponderada módulo 11, pesos 2..9 cíclicos da direita para a esquerda.
 * @param numeros sequência apenas de dígitos
 */
function resto11(numeros: string): number {
  let soma = 0
  let peso = 2
  for (let i = numeros.length - 1; i >= 0; i--) {
    soma += Number(numeros[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  return soma % 11
}

/**
 * DV geral do boleto (posição 5): 11 − resto; resultados 0, 10 e 11 viram 1.
 * @param semDv os 43 dígitos do código sem a posição 5
 */
function dvGeralBoleto(semDv: string): number {
  const dv = 11 - resto11(semDv)
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv
}

/**
 * DV de arrecadação. Identificador 6/7 usa módulo 10; 8/9 usa módulo 11
 * (resto 0 ou 1 → 0; resto 10 → 1).
 * @param numeros bloco ou código sem o DV
 * @param identificador terceiro dígito do código (6, 7, 8 ou 9)
 */
function dvArrecadacao(numeros: string, identificador: string): number {
  if (identificador === '6' || identificador === '7') return modulo10(numeros)
  const resto = resto11(numeros)
  return resto === 0 || resto === 1 ? 0 : 11 - resto
}

/**
 * Converte o fator de vencimento em data, escolhendo o ciclo mais próximo de `hoje`.
 * Fator 0000 significa boleto sem vencimento.
 * @param fator quatro dígitos
 * @param hoje referência em ms (injetável para teste)
 */
export function vencimentoDoFator(fator: string, hoje = Date.now()): string | undefined {
  const n = Number(fator)
  if (n < 1000) return undefined
  const candidatos = [BASE_CICLO_1 + n * DIA_MS, BASE_CICLO_2 + n * DIA_MS]
  const maisProximo = candidatos.reduce((a, b) => (Math.abs(b - hoje) < Math.abs(a - hoje) ? b : a))
  return new Date(maisProximo).toISOString().slice(0, 10)
}

/**
 * Valida o código de barras de boleto e gera a linha digitável de 47 dígitos.
 * Layout do código: banco(3) moeda(1) DV(1) fator(4) valor(10) campo livre(25).
 * @param barras 44 dígitos, primeiro dígito diferente de 8
 */
function boletoDeBarras(barras: string, hoje: number): Resultado {
  if (barras[3] !== '9') return { ok: false, erro: 'Moeda do boleto não suportada.' }
  if (dvGeralBoleto(barras.slice(0, 4) + barras.slice(5)) !== Number(barras[4])) {
    return { ok: false, erro: 'DV geral do boleto não confere. Leia novamente.' }
  }
  const campo1 = barras.slice(0, 4) + barras.slice(19, 24)
  const campo2 = barras.slice(24, 34)
  const campo3 = barras.slice(34, 44)
  const c1 = campo1 + modulo10(campo1)
  const c2 = campo2 + modulo10(campo2)
  const c3 = campo3 + modulo10(campo3)
  const c4 = barras[4]
  const c5 = barras.slice(5, 19)
  const ponto = (c: string) => `${c.slice(0, 5)}.${c.slice(5)}`
  const valor = Number(barras.slice(9, 19))
  return {
    ok: true,
    codigo: {
      tipo: 'boleto',
      barras,
      linha: c1 + c2 + c3 + c4 + c5,
      pontuada: `${ponto(c1)} ${ponto(c2)} ${ponto(c3)} ${c4} ${c5}`,
      valorCentavos: valor > 0 ? valor : undefined,
      vencimento: vencimentoDoFator(barras.slice(5, 9), hoje)
    }
  }
}

/**
 * Valida o código de arrecadação (concessionárias/tributos) e gera a linha de 48 dígitos.
 * @param barras 44 dígitos começando por 8
 */
function arrecadacaoDeBarras(barras: string): Resultado {
  const identificador = barras[2]
  if (!'6789'.includes(identificador)) return { ok: false, erro: 'Identificador de valor da arrecadação inválido.' }
  if (dvArrecadacao(barras.slice(0, 3) + barras.slice(4), identificador) !== Number(barras[3])) {
    return { ok: false, erro: 'DV geral da arrecadação não confere. Leia novamente.' }
  }
  const blocos = [0, 11, 22, 33].map(i => barras.slice(i, i + 11))
  const dvs = blocos.map(b => dvArrecadacao(b, identificador))
  const efetivo = identificador === '6' || identificador === '8'
  const valor = Number(barras.slice(4, 15))
  return {
    ok: true,
    codigo: {
      tipo: 'arrecadacao',
      barras,
      linha: blocos.map((b, i) => b + dvs[i]).join(''),
      pontuada: blocos.map((b, i) => `${b}-${dvs[i]}`).join(' '),
      valorCentavos: efetivo && valor > 0 ? valor : undefined
    }
  }
}

/**
 * Reconstrói o código de barras a partir da linha digitável, conferindo os DVs de campo.
 * @param d 47 ou 48 dígitos
 */
function barrasDaLinha(d: string): string | { erro: string } {
  if (d.length === 47) {
    const ok = [[0, 9], [10, 20], [21, 31]].every(([a, b]) => modulo10(d.slice(a, b)) === Number(d[b]))
    if (!ok) return { erro: 'DV de campo da linha digitável não confere.' }
    return d.slice(0, 4) + d[32] + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31)
  }
  if (d[0] !== '8') return { erro: 'Linha de 48 dígitos deve começar com 8.' }
  let barras = ''
  for (const i of [0, 12, 24, 36]) {
    const bloco = d.slice(i, i + 11)
    if (dvArrecadacao(bloco, d[2]) !== Number(d[i + 11])) return { erro: 'DV de bloco da arrecadação não confere.' }
    barras += bloco
  }
  return barras
}

/**
 * Interpreta qualquer entrada aceita (câmera ou colagem) e devolve todas as formas de cópia.
 * Aceita 44/47/48 dígitos com ou sem pontuação, e Pix Copia e Cola.
 * @param bruto texto lido ou digitado
 * @param hoje referência para o ciclo do fator de vencimento
 */
export function interpretar(bruto: string, hoje = Date.now()): Resultado {
  const texto = bruto.trim()
  if (texto.startsWith('000201')) return interpretarPix(texto)
  if (!/^[\d.\s-]+$/.test(texto)) return { ok: false, erro: 'Caracteres inválidos no código.' }
  const digitos = texto.replace(/\D/g, '')
  let barras: string
  if (digitos.length === 44) {
    barras = digitos
  } else if (digitos.length === 47 || digitos.length === 48) {
    const convertido = barrasDaLinha(digitos)
    if (typeof convertido !== 'string') return { ok: false, erro: convertido.erro }
    barras = convertido
  } else {
    return { ok: false, erro: 'Esperado código de 44 dígitos ou linha de 47/48.' }
  }
  return barras[0] === '8' ? arrecadacaoDeBarras(barras) : boletoDeBarras(barras, hoje)
}

/**
 * Texto final para a área de transferência no formato escolhido.
 * Pix é sempre copiado íntegro: qualquer alteração invalida o CRC.
 * @param codigo resultado de {@link interpretar}
 * @param formato pontuada (padrão impresso), dígitos (47/48) ou barras (44)
 */
export function textoParaColar(codigo: CodigoLido, formato: Formato): string {
  if (codigo.tipo === 'pix') return codigo.barras
  if (formato === 'pontuada') return codigo.pontuada
  if (formato === 'digitos') return codigo.linha
  return codigo.barras
}

/**
 * Formata centavos como moeda brasileira.
 * @param centavos inteiro positivo
 */
export function formatarValor(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/**
 * CRC-16/CCITT-FALSE do payload Pix (BR Code, Manual do BR Code — Bacen).
 * @param texto payload até "6304", inclusive
 */
export function crc16(texto: string): string {
  let crc = 0xffff
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/**
 * Lê campos TLV (tag 2 dígitos, tamanho 2 dígitos, valor) do EMV/BR Code.
 * @param texto trecho TLV
 * @returns mapa tag→valor, ou null se truncado/malformado
 */
function tlv(texto: string): Map<string, string> | null {
  const campos = new Map<string, string>()
  let i = 0
  while (i < texto.length) {
    const tag = texto.slice(i, i + 2)
    const tam = Number(texto.slice(i + 2, i + 4))
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(texto.slice(i + 2, i + 4)) || i + 4 + tam > texto.length) return null
    campos.set(tag, texto.slice(i + 4, i + 4 + tam))
    i += 4 + tam
  }
  return campos
}

/**
 * Valida o Pix Copia e Cola localmente e extrai valor e recebedor para a sessão.
 * Não consulta URL de Pix dinâmico (risco de SSRF e vazamento; ver ARCHITECTURE.md).
 * @param texto payload completo
 */
function interpretarPix(texto: string): Resultado {
  const campos = tlv(texto)
  if (!campos || texto.slice(-8, -4) !== '6304' || crc16(texto.slice(0, -4)) !== texto.slice(-4).toUpperCase()) {
    return { ok: false, erro: 'Pix inválido: estrutura ou CRC não confere.' }
  }
  let conta: Map<string, string> | null = null
  for (let t = 26; t <= 51; t++) {
    const sub = tlv(campos.get(String(t)) ?? '')
    if (sub?.get('00')?.toLowerCase() === 'br.gov.bcb.pix') conta = sub
  }
  if (!conta) return { ok: false, erro: 'QR não é um Pix.' }
  const valor = campos.get('54')
  const centavos = valor && /^\d+\.\d{2}$/.test(valor) ? Number(valor.replace('.', '')) : undefined
  return {
    ok: true,
    codigo: {
      tipo: 'pix',
      barras: texto,
      linha: '',
      pontuada: '',
      valorCentavos: centavos || undefined,
      favorecido: campos.get('59')?.trim() || undefined,
      dinamico: conta.has('25') && !conta.has('01')
    }
  }
}

/**
 * Valor para colar em campos de app bancário: sem "R$" e sem separador de milhar ("1234,56").
 * @param centavos inteiro positivo
 */
export function valorParaColar(centavos: number): string {
  return `${Math.floor(centavos / 100)},${String(centavos % 100).padStart(2, '0')}`
}

/** Dados extraídos da chave de acesso de uma NF-e/NFC-e (44 dígitos). */
export interface NotaChave {
  /** 44 dígitos da chave. */
  chave: string
  /** CNPJ do emitente (14 dígitos). */
  cnpj: string
  /** Número da NF (nNF) sem zeros à esquerda — vai na coluna Competência. */
  numero: string
  /** Série sem zeros à esquerda. */
  serie: string
  /** Código da UF (cUF). */
  uf: string
}

export type ResultadoNFe = { ok: true, nota: NotaChave } | { ok: false, erro: string }

/**
 * Valida a chave de acesso da NF-e e extrai CNPJ, número e série.
 * Layout (44): cUF(2) AAMM(4) CNPJ(14) mod(2) série(3) nNF(9) tpEmis(1) cNF(8) cDV(1).
 * O DV usa módulo 11, pesos 2..9 cíclicos da direita (mesmo cálculo da arrecadação).
 * @param bruto texto lido do código da DANFE ou digitado (aceita espaços/pontuação)
 */
export function interpretarChaveNFe(bruto: string): ResultadoNFe {
  const d = bruto.replace(/\D/g, '')
  if (d.length !== 44) return { ok: false, erro: 'A chave da NF-e tem 44 dígitos.' }
  const r = resto11(d.slice(0, 43))
  const dv = r === 0 || r === 1 ? 0 : 11 - r
  if (dv !== Number(d[43])) return { ok: false, erro: 'Dígito verificador da chave não confere. Leia ou digite novamente.' }
  if (Number(d.slice(0, 2)) < 11 || Number(d.slice(0, 2)) > 53) return { ok: false, erro: 'UF inválida na chave da NF-e.' }
  const modelo = d.slice(20, 22)
  if (modelo !== '55' && modelo !== '65') return { ok: false, erro: 'A chave não é de NF-e (55) nem NFC-e (65).' }
  return {
    ok: true,
    nota: { chave: d, cnpj: d.slice(6, 20), numero: String(Number(d.slice(25, 34))), serie: String(Number(d.slice(22, 25))), uf: d.slice(0, 2) }
  }
}

/**
 * Formata 14 dígitos como CNPJ (00.000.000/0000-00); devolve o texto original se não tiver 14 dígitos.
 * @param cnpj dígitos do CNPJ
 */
export function formatarCnpj(cnpj: string): string {
  const d = cnpj.replace(/\D/g, '')
  if (d.length !== 14) return cnpj
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}
