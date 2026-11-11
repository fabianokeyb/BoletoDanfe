import {prepareZXingModule, readBarcodes} from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import {cameraConstraints, readerOptions} from './scanner'

/** Intervalo entre quadros analisados; a análise é sequencial, nunca sobreposta. */
const INTERVALO_MS = 120

let moduloPronto: Promise<unknown> | undefined

/**
 * Carrega o WASM servido pelo próprio app. Sem esta sobrescrita o zxing-wasm busca
 * o binário no jsDelivr — quebraria o uso offline da PWA e exporia a origem a terceiros.
 */
function prepararModulo() {
  moduloPronto ??= prepareZXingModule({
    overrides: {locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path)},
    fireImmediately: true
  })
  return moduloPronto
}

/**
 * Abre a câmera e analisa quadros continuamente (boleto e Pix no mesmo modo) até `parar()`.
 * Nenhuma imagem sai do aparelho: os quadros são lidos de um canvas local.
 * @param video elemento que exibe a prévia
 * @param aoLer chamado com cada texto decodificado e seu símbolo (pode repetir entre quadros)
 * @returns função que encerra a análise e libera a câmera
 */
export async function iniciarLeitura(video: HTMLVideoElement, aoLer: (texto: string, format: string) => void) {
  const [stream] = await Promise.all([navigator.mediaDevices.getUserMedia(cameraConstraints()), prepararModulo()])
  let ativo = true
  const parar = () => {
    ativo = false
    stream.getTracks().forEach(t => t.stop())
    if (video.srcObject === stream) video.srcObject = null
  }
  video.srcObject = stream
  await video.play().catch(() => undefined)

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', {willReadFrequently: true})
  if (!ctx) {
    parar()
    throw new Error('Canvas 2D indisponível')
  }
  const opcoes = readerOptions()

  const analisar = async () => {
    if (!ativo) return
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0)
      try {
        const resultados = await readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), opcoes)
        for (const r of resultados) if (ativo && r.isValid) aoLer(r.text, r.format)
      } catch {
        // quadro ilegível: segue para o próximo
      }
    }
    if (ativo) setTimeout(analisar, INTERVALO_MS)
  }
  // Primeira análise só depois do retorno, para o chamador já ter a referência de `parar`.
  setTimeout(analisar, 0)
  return parar
}
