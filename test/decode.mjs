import fs from 'node:fs'
import {createRequire} from 'node:module'
import {PNG} from 'pngjs'
import {prepareZXingModule,readBarcodes} from 'zxing-wasm/reader'
import {readerOptions} from '../src/lib/scanner.ts'

// Mesmo binário que o app serve; nenhum download em teste.
const wasm=fs.readFileSync(createRequire(import.meta.url).resolve('zxing-wasm/reader/zxing_reader.wasm'))
prepareZXingModule({overrides:{wasmBinary:wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength)}})

/**
 * Decodifica um PNG com as mesmas opções usadas pela câmera.
 * @param {Buffer} buffer PNG
 * (detecção automática, mesmas opções da câmera)
 * @returns {Promise<string|undefined>} texto do primeiro símbolo válido
 */
export async function decode(buffer){
 const p=PNG.sync.read(buffer)
 const r=await readBarcodes({data:new Uint8ClampedArray(p.data),width:p.width,height:p.height},readerOptions())
 return r.find(x=>x.isValid)?.text
}
