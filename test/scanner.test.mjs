import test from 'node:test'
import assert from 'node:assert/strict'
import bwip from 'bwip-js'
import QRCode from 'qrcode'
import {PNG} from 'pngjs'
import {execFileSync} from 'node:child_process'
import {readBarcodes} from 'zxing-wasm/reader'
import {classificar,cameraConstraints,readerOptions,criarConfirmador} from '../src/lib/scanner.ts'
import {decode} from './decode.mjs'

const barcode='00193373700000001000500940144816060680935031'
const chaveNFe='33261010915021000190550010082722291141103184'
const itf=scale=>bwip.toBuffer({bcid:'interleaved2of5',text:barcode,scale,height:18,padding:15,backgroundcolor:'FFFFFF'})

for(const scale of [1,2,3])test(`Reads actual 44-digit ITF image at scale ${scale}`,async()=>{
 const result=await decode(await itf(scale))
 assert.equal(result,barcode)
 assert.equal(classificar(result,'ITF'),'barras')
})

test('DANFE barcode (Code128) read and classified as NF-e, not boleto',async()=>{
 const buf=await bwip.toBuffer({bcid:'code128',text:chaveNFe,scale:3,height:26,padding:16,backgroundcolor:'FFFFFF'})
 const p=PNG.sync.read(buf)
 const r=(await readBarcodes({data:new Uint8ClampedArray(p.data),width:p.width,height:p.height},readerOptions())).find(x=>x.isValid)
 assert.equal(r.text,chaveNFe)
 assert.equal(r.format,'Code128')
 assert.equal(classificar(r.text,r.format),'nfe')
 // mesmo sem o símbolo, a estrutura (DV da chave) distingue da ITF
 assert.equal(classificar(chaveNFe),'nfe')
 assert.equal(classificar(barcode),'barras')
})

test('QR Pix detected without choosing a mode',async()=>{
 const payload='000201TEST-DECODER'
 assert.equal(await decode(await QRCode.toBuffer(payload,{width:300})),payload)
 assert.equal(classificar(payload),'pix')
})

test('Boleto with barcode and QR in the same frame yields both symbols',async()=>{
 const b=PNG.sync.read(await itf(2)),q=PNG.sync.read(await QRCode.toBuffer('000201HIBRIDO',{width:260}))
 const w=b.width+q.width+40,h=Math.max(b.height,q.height)
 const img=new PNG({width:w,height:h});img.data.fill(255)
 PNG.bitblt(b,img,0,0,b.width,b.height,0,0);PNG.bitblt(q,img,0,0,q.width,q.height,b.width+40,0)
 const textos=(await readBarcodes({data:new Uint8ClampedArray(img.data),width:w,height:h},readerOptions())).filter(r=>r.isValid).map(r=>r.text).sort()
 assert.deepEqual(textos,['000201HIBRIDO',barcode])
})

test('Classifier rejects partial digits and other content',()=>{
 for(const t of ['12345678901234','https://exemplo.com',barcode+'1'])assert.equal(classificar(t),null)
})

test('Request rear camera and high resolution without making constraints mandatory',()=>{
 const c=cameraConstraints()
 assert.equal(c.audio,false)
 assert.deepEqual(c.video.width,{ideal:1920})
 assert.deepEqual(c.video.facingMode,{ideal:'environment'})
})

test('Linear codes demand agreement across scan lines',()=>{
 assert.deepEqual(readerOptions().formats,['ITF','QRCode','Code128'])
 assert.ok(readerOptions().minLineCount>=2)
})

test('Confirmer: per-code count inside a time window, several codes interleaved',()=>{
 const c=criarConfirmador(2,1500)
 assert.equal(c('A',0),false)
 assert.equal(c('B',100),false)
 assert.equal(c('A',200),true)
 assert.equal(c('B',2000),false,'janela expirada reinicia a contagem')
 assert.equal(c('B',2100),true)
})

let ffmpeg=true
try{execFileSync('ffmpeg',['-version'],{stdio:'ignore'})}catch{ffmpeg=false}
// Barra estreita de 1,3 a 3,2 px. Abaixo de ~1,2 px, minLineCount 3 rejeita (preferimos não ler a ler errado).
test('ITF resampled to camera-like widths (600–1500 px)',{skip:!ffmpeg&&'ffmpeg ausente'},async()=>{
 const png=await itf(3)
 const falhas=[]
 for(let w=600;w<=1500;w+=50){
  const out=execFileSync('ffmpeg',['-loglevel','error','-i','pipe:0','-vf',`scale=${w}:-2:flags=bicubic`,'-f','image2pipe','-vcodec','png','pipe:1'],{input:png})
  if(await decode(out)!==barcode)falhas.push(w)
 }
 assert.deepEqual(falhas,[])
})
