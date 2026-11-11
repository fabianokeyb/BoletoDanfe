import test from 'node:test'
import assert from 'node:assert/strict'
import bwip from 'bwip-js'
import {interpretar,interpretarChaveNFe,formatarCnpj,textoParaColar,vencimentoDoFator,modulo10,crc16,valorParaColar} from '../src/lib/linha-digitavel.ts'
import {criarConfirmador} from '../src/lib/scanner.ts'
import {decode} from './decode.mjs'

// Mesmo vetor de backend/src/capture.rs (known_line)
const BOLETO_BARRAS='00193373700000001000500940144816060680935031'
const BOLETO_PONTUADA='00190.50095 40144.816069 06809.350314 3 37370000000100'
// Vetor gerado e conferido contra capture::validate do backend (oráculo Rust, 1200/1200)
const ARREC_BARRAS='83703017111121631116596876883394441843058905'
const ARREC_PONTUADA='83703017111-5 12163111659-1 68768833944-3 41843058905-5'
const HOJE=Date.UTC(2026,9,21)

test('Boleto: 44 dígitos geram a linha pontuada impressa no documento',()=>{
 const r=interpretar(BOLETO_BARRAS,HOJE)
 assert.equal(r.ok,true)
 assert.equal(r.codigo.tipo,'boleto')
 assert.equal(r.codigo.pontuada,BOLETO_PONTUADA)
 assert.equal(r.codigo.linha,BOLETO_PONTUADA.replace(/\D/g,''))
 assert.equal(r.codigo.valorCentavos,100)
})

test('Boleto: três formatos de colagem',()=>{
 const {codigo}=interpretar(BOLETO_BARRAS,HOJE)
 assert.equal(textoParaColar(codigo,'pontuada'),BOLETO_PONTUADA)
 assert.equal(textoParaColar(codigo,'digitos').length,47)
 assert.equal(textoParaColar(codigo,'barras'),BOLETO_BARRAS)
})

test('Arrecadação: blocos de 11 + DV com hífen e espaço',()=>{
 const r=interpretar(ARREC_BARRAS)
 assert.equal(r.ok,true)
 assert.equal(r.codigo.tipo,'arrecadacao')
 assert.equal(r.codigo.pontuada,ARREC_PONTUADA)
 assert.equal(r.codigo.linha.length,48)
})

test('Linha colada (47/48, com ou sem pontuação) volta ao mesmo código',()=>{
 for(const [barras,pontuada] of [[BOLETO_BARRAS,BOLETO_PONTUADA],[ARREC_BARRAS,ARREC_PONTUADA]]){
  assert.equal(interpretar(pontuada).codigo.barras,barras)
  assert.equal(interpretar(pontuada.replace(/\D/g,'')).codigo.barras,barras)
 }
})

test('DV geral errado é bloqueado, nunca autocorrigido',()=>{
 const trocar=(s,i)=>s.slice(0,i)+String((Number(s[i])+1)%10)+s.slice(i+1)
 assert.equal(interpretar(trocar(BOLETO_BARRAS,4)).ok,false)
 assert.equal(interpretar(trocar(ARREC_BARRAS,3)).ok,false)
 const linhaRuim=BOLETO_PONTUADA.replace('40144','40145')
 assert.equal(interpretar(linhaRuim).ok,false)
})

test('Entradas inválidas',()=>{
 for(const s of ['','123','abc',BOLETO_BARRAS+'1','0019337370000000100050094014481606068093503X'])assert.equal(interpretar(s).ok,false)
})

// Monta payload Pix válido (mesma estrutura de backend/src/pix.rs::build)
const tlv=(t,v)=>t+String(v.length).padStart(2,'0')+v
const pix=({conta,valor,nome='EMPRESA TESTE'})=>{const base=tlv('00','01')+tlv('26',conta)+tlv('52','0000')+tlv('53','986')+(valor?tlv('54',valor):'')+tlv('58','BR')+tlv('59',nome)+tlv('60','RIO DE JANEIRO')+tlv('62',tlv('05','***'))+'6304';return base+crc16(base)}
const ESTATICO=pix({conta:tlv('00','BR.GOV.BCB.PIX')+tlv('01','+5521999999999'),valor:'1234.56'})
const DINAMICO=pix({conta:tlv('00','br.gov.bcb.pix')+tlv('25','qr.banco.exemplo/cobv/abc')})

test('CRC-16 Pix: vetor 123456789 = 29B1 (mesmo do backend)',()=>{assert.equal(crc16('123456789'),'29B1')})

test('Pix estático: valor e favorecido extraídos, copiado íntegro em qualquer formato',()=>{
 const r=interpretar(ESTATICO)
 assert.equal(r.ok,true)
 assert.equal(r.codigo.valorCentavos,123456)
 assert.equal(r.codigo.favorecido,'EMPRESA TESTE')
 assert.equal(r.codigo.dinamico,false)
 for(const f of ['pontuada','digitos','barras'])assert.equal(textoParaColar(r.codigo,f),ESTATICO)
})

test('Pix dinâmico: sem valor, marcado, URL nunca consultada',()=>{
 const r=interpretar(DINAMICO)
 assert.equal(r.ok,true)
 assert.equal(r.codigo.dinamico,true)
 assert.equal(r.codigo.valorCentavos,undefined)
})

test('Pix com CRC errado, truncado ou sem GUI Pix é bloqueado',()=>{
 assert.equal(interpretar(ESTATICO.slice(0,-1)+(ESTATICO.endsWith('0')?'1':'0')).ok,false)
 assert.equal(interpretar(ESTATICO.slice(0,40)).ok,false)
 assert.equal(interpretar(pix({conta:tlv('00','BR.COM.OUTRO')+tlv('01','x')})).ok,false)
})

test('Valor para colar: sem R$ e sem milhar',()=>{
 assert.equal(valorParaColar(123456),'1234,56')
 assert.equal(valorParaColar(5),'0,05')
})

test('Fator de vencimento: ciclo mais próximo de hoje, incluindo o reinício de 2025',()=>{
 assert.equal(vencimentoDoFator('1000',Date.UTC(2000,6,1)),'2000-07-03')
 assert.equal(vencimentoDoFator('9999',Date.UTC(2025,1,1)),'2025-02-21')
 assert.equal(vencimentoDoFator('1000',HOJE),'2025-02-22')
 assert.equal(vencimentoDoFator('0000',HOJE),undefined)
})

test('Módulo 10 FEBRABAN',()=>{assert.equal(modulo10('01230067896'),3)})

test('Confirmação exige duas leituras idênticas seguidas',()=>{
 const confirma=criarConfirmador()
 assert.equal(confirma('A'),false)
 assert.equal(confirma('B'),false)
 assert.equal(confirma('B'),true)
 assert.equal(criarConfirmador(1)('X'),true)
})

for(const [nome,barras,esperado] of [['boleto',BOLETO_BARRAS,BOLETO_PONTUADA],['arrecadação',ARREC_BARRAS,ARREC_PONTUADA]]){
 test(`Imagem ITF de ${nome} → ZXing → texto pronto para colar`,async()=>{
  const lido=await decode(await bwip.toBuffer({bcid:'interleaved2of5',text:barras,scale:2,height:18,padding:15,backgroundcolor:'FFFFFF'}))
  assert.equal(textoParaColar(interpretar(lido,HOJE).codigo,'pontuada'),esperado)
 })
}

test('Chave NF-e: valida DV e extrai CNPJ, número e série', () => {
 const r = interpretarChaveNFe('3326 1010 9150 2100 0190 5500 1008 2722 2911 4110 3184')
 assert.equal(r.ok, true)
 assert.equal(r.nota.numero, '8272229')
 assert.equal(r.nota.serie, '1')
 assert.equal(r.nota.cnpj, '10915021000190')
 assert.equal(formatarCnpj(r.nota.cnpj), '10.915.021/0001-90')
 // DV errado, tamanho errado e boleto não passam como NF-e
 assert.equal(interpretarChaveNFe('33261010915021000190550010082722291141103185').ok, false)
 assert.equal(interpretarChaveNFe('123').ok, false)
 assert.equal(interpretarChaveNFe('00193373700000001000500940144816060680935031').ok, false)
})
