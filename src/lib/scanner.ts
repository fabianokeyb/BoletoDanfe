import type {ReaderOptions} from 'zxing-wasm/reader'
import {interpretarChaveNFe} from './linha-digitavel.ts'

/** Tipo de documento reconhecido pela câmera. */
export type TipoLeitura = 'barras' | 'pix' | 'nfe'

/**
 * Opções do zxing-cpp (WASM) para detecção automática no mesmo quadro:
 * ITF (boleto/arrecadação), QRCode (Pix) e Code128 (código da DANFE/NF-e).
 * `minLineCount: 3` exige o mesmo resultado em 3 linhas de varredura dos códigos lineares,
 * primeira defesa contra leitura parcial (ITF e Code128 não têm checksum próprio).
 */
export function readerOptions(): ReaderOptions {
  return {formats: ['ITF', 'QRCode', 'Code128'], tryHarder: true, tryRotate: true, minLineCount: 3, maxNumberOfSymbols: 4}
}

/**
 * Classifica o texto decodificado. O símbolo (format) separa boleto (ITF) de DANFE
 * (Code128), que são ambos 44 dígitos; sem símbolo (entrada manual) decide pela estrutura.
 * @param text texto decodificado
 * @param format símbolo do zxing ('ITF', 'Code128', 'QRCode'), quando disponível
 * @returns tipo provável, ou null se não for documento aceito
 */
export function classificar(text: string, format?: string): TipoLeitura | null {
  if (text.startsWith('000201')) return 'pix'
  if (/^\d{44}$/.test(text)) {
    if (format === 'Code128') return 'nfe'
    if (format === 'ITF') return 'barras'
    return interpretarChaveNFe(text).ok ? 'nfe' : 'barras'
  }
  return null
}

/** Câmera traseira em alta resolução, sem tornar nenhuma restrição obrigatória. */
export function cameraConstraints(): MediaStreamConstraints {
  return {audio: false, video: {facingMode: {ideal: 'environment'}, width: {ideal: 1920}, height: {ideal: 1080}}}
}

/**
 * Segunda defesa para leitura contínua com vários símbolos por quadro: um texto só é
 * aceito depois de `necessarias` aparições dentro de `janelaMs`.
 * Medido: ~1,3% das trocas de um dígito passam no DV de boleto/arrecadação.
 * @param necessarias aparições exigidas (QR pode usar 1: tem correção de erro)
 * @param janelaMs intervalo máximo entre aparições consecutivas
 * @returns função (texto, agora?) → confirmado
 */
export function criarConfirmador(necessarias = 2, janelaMs = 1500) {
  const vistos = new Map<string, {n: number, ultimo: number}>()
  return (texto: string, agora = Date.now()) => {
    const v = vistos.get(texto)
    const n = v && agora - v.ultimo <= janelaMs ? v.n + 1 : 1
    vistos.set(texto, {n, ultimo: agora})
    if (vistos.size > 50) for (const [k, x] of vistos) if (agora - x.ultimo > janelaMs) vistos.delete(k)
    return n >= necessarias
  }
}
