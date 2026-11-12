import {prepareZXingModule, readBarcodes, type ReaderOptions} from 'zxing-wasm/reader'
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
 * @param cfg.zoomDigital fator (≥1) lido a cada quadro; recorta o centro e amplia
 *        antes de decodificar — é o zoom que funciona onde o `zoom` nativo não é exposto (iOS)
 * @param cfg.opcoes opções do leitor; padrão = boleto/Pix/DANFE (`readerOptions`). As compras usam EAN.
 * @returns `parar` encerra a análise e libera a câmera; `track` é a trilha de vídeo
 *          ativa (flash/zoom nativo); `facing` é o `facingMode` reportado —
 *          'user' (selfie), 'environment' (traseira) ou undefined (webcam não informa)
 */
export async function iniciarLeitura(video: HTMLVideoElement, aoLer: (texto: string, format: string) => void, cfg: {zoomDigital?: () => number, opcoes?: ReaderOptions} = {}): Promise<{parar: () => void, track: MediaStreamTrack | undefined, facing: string | undefined}> {
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
  const opcoes = cfg.opcoes ?? readerOptions()

  const analisar = async () => {
    if (!ativo) return
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
      const vw = video.videoWidth, vh = video.videoHeight
      canvas.width = vw
      canvas.height = vh
      // Zoom digital: amostra só o centro (vw/f × vh/f) e amplia para o canvas cheio,
      // elevando a densidade de pixels do código — o único zoom possível no iOS.
      const f = Math.max(1, cfg.zoomDigital?.() ?? 1)
      if (f > 1) {
        const sw = vw / f, sh = vh / f
        ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, vw, vh)
      } else {
        ctx.drawImage(video, 0, 0)
      }
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
  const track = stream.getVideoTracks()[0]
  const facing = (track?.getSettings?.() as MediaTrackSettings | undefined)?.facingMode
  return {parar, track, facing}
}

/** Capacidades de câmera relevantes, extraídas da trilha de vídeo. */
export interface CapacidadesCamera {
  /** Lanterna disponível (Android/Chrome; iOS/Safari não expõe). */
  torch: boolean
  /** Faixa de zoom óptico/sensor, quando o aparelho reporta. */
  zoom?: {min: number, max: number, step: number}
}

/** Tipagem dos campos não-padronizados (torch/zoom) de MediaTrack*. */
type CapsExtras = MediaTrackCapabilities & {torch?: boolean, zoom?: {min: number, max: number, step: number}}
type ConstraintExtra = {advanced: Array<{torch?: boolean, zoom?: number}>}

/**
 * Lê as capacidades de flash e zoom da trilha. Campos ausentes viram
 * indisponíveis — o chamador só deve exibir o controle correspondente quando `true`/presente.
 * @param track trilha de vídeo ativa
 * @returns capacidades detectadas
 */
export function capacidadesCamera(track: MediaStreamTrack | undefined): CapacidadesCamera {
  const c = (track?.getCapabilities?.() ?? {}) as CapsExtras
  const z = c.zoom
  return {
    torch: c.torch === true,
    zoom: z && typeof z.max === 'number' && z.max > (z.min ?? 1) ? {min: z.min ?? 1, max: z.max, step: z.step ?? 0.1} : undefined
  }
}

/** Zoom atual reportado pela trilha, ou undefined se o aparelho não expõe. */
export function zoomAtualDaTrilha(track: MediaStreamTrack | undefined): number | undefined {
  const s = track?.getSettings?.() as (MediaTrackSettings & {zoom?: number}) | undefined
  return s?.zoom
}

/**
 * Liga/desliga a lanterna. Rejeita se o aparelho não suportar torch.
 * @param track trilha de vídeo ativa
 * @param ligado estado desejado
 */
export function aplicarTorch(track: MediaStreamTrack, ligado: boolean): Promise<void> {
  return track.applyConstraints({advanced: [{torch: ligado}]} as unknown as ConstraintExtra as MediaTrackConstraints)
}

/**
 * Ajusta o zoom óptico/sensor para o valor absoluto informado.
 * @param track trilha de vídeo ativa
 * @param valor valor de zoom dentro da faixa reportada por capacidadesCamera
 */
export function aplicarZoom(track: MediaStreamTrack, valor: number): Promise<void> {
  return track.applyConstraints({advanced: [{zoom: valor}]} as unknown as ConstraintExtra as MediaTrackConstraints)
}
