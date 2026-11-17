import test from 'node:test'
import assert from 'node:assert/strict'
import {RECEITAS, slug} from '../src/lib/fichas/receitas.ts'
import {
  producaoVazia, alternarFicha, definirUsado, definirRendimento, definirFator, definirObs, descartarAberto, loteAberto,
  finalizadosDe, finalizar, reabrir, pendentesEnvio, marcarEnviado, pacote, podar, faltaParaFinalizar,
  situacao, diferencas, relatorio, linkWhatsApp, revisar, formatar, lerCampo, referencia, rendimentoFicha, pct
} from '../src/lib/fichas/estado.ts'
import {enviarLote, verificarToken} from '../src/lib/fichas/enviar.ts'

const DIA = '2026-11-16'
const receita = nome => RECEITAS.find(r => r.nome === nome)
/** Gerador de ids previsível. */
const ids = () => {let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`}

test('Cadastro: 27 fichas, ids únicos, quantidades positivas', () => {
  assert.equal(RECEITAS.length, 27)
  assert.equal(new Set(RECEITAS.map(r => r.id)).size, 27)
  assert.deepEqual(RECEITAS.map(r => r.numero), Array.from({length: 27}, (_, i) => i + 1))
  for (const r of RECEITAS) {
    assert.ok(r.rendimento.qtd > 0, r.nome)
    assert.equal(new Set(r.ingredientes.map(i => i.id)).size, r.ingredientes.length, r.nome)
    for (const i of r.ingredientes) assert.ok(i.qtd > 0, `${r.nome} · ${i.nome}`)
  }
  assert.equal(slug('Açúcar Mascavo'), 'acucar-mascavo')
})

test('Calabrese confere com a ficha', () => {
  const r = receita('Calabrese')
  assert.deepEqual(r.ingredientes.map(i => formatar(i.qtd, i.unidade)), ['1,234 kg', '564 g', '3,000 kg', '250 ml', '10 g'])
  assert.equal(formatar(r.rendimento.qtd, r.rendimento.unidade), '4,198 kg')
})

test('Formatação e leitura de campos', () => {
  assert.equal(formatar(2.47, 'l'), '2,470 L')
  assert.equal(formatar(1503, 'g'), '1.503 g')
  assert.equal(lerCampo('1.2345', 'kg'), 1.235)
  assert.equal(lerCampo('600,4', 'g'), 600)
  assert.equal(lerCampo('abc', 'g'), undefined)
  assert.equal(pct(-0.08), '−8,0%')
})

test('Finalizar exige rendimento, mesmo seguindo a ficha', () => {
  const r = receita('Barbecue'), novoId = ids()
  let p = producaoVazia(DIA, 'THBF', 'João')
  assert.match(finalizar(p, r).erro, /Segui a ficha/)
  p = alternarFicha(p, r.id, novoId)
  assert.match(finalizar(p, r).erro, /rendimento de Barbecue/)
  assert.equal(faltaParaFinalizar(r, loteAberto(p, r.id)), 'Pese e informe o rendimento de Barbecue.')
  p = definirRendimento(p, r.id, 11.8, novoId)
  p = finalizar(p, r, 1000).producao
  const [l] = finalizadosDe(p, r.id)
  assert.deepEqual({loja: l.loja, data: l.data, cozinheiro: l.cozinheiro, finalizadoEm: l.finalizadoEm}, {loja: 'THBF', data: DIA, cozinheiro: 'João', finalizadoEm: 1000})
  assert.equal(loteAberto(p, r.id), undefined)
  assert.equal(situacao(r, l), 'conforme')
  assert.match(relatorio(p, RECEITAS), /✅ \*Barbecue\* · ingredientes da ficha\nRendimento: \*11,800 kg\* \(ficha 12,000 kg · −1,7%\)/)
})

test('Alterada: relatório lista só o que mudou; lote aberto aparece como em andamento', () => {
  const r = receita('Calabrese'), novoId = ids()
  let p = definirUsado(producaoVazia(DIA), r.id, 'calabresa', 1.5, novoId)
  p = definirRendimento(p, r.id, 4.5, novoId)
  p = definirObs(p, r.id, ' peça maior ', novoId)
  p = finalizar(p, r).producao
  p = alternarFicha(p, receita('Barbecue').id, novoId)
  const txt = relatorio(p, RECEITAS)
  assert.match(txt, /✅ 0 conforme a ficha · ✏️ 1 com alteração/)
  assert.match(txt, /✏️ \*Calabrese\* · ALTERADA\n• Calabresa: \*1,500 kg\* \(ficha 1,234 kg · \+21,6%\)\n• Demais ingredientes: conforme a ficha\nRendimento: \*4,500 kg\* \(ficha 4,198 kg · \+7,2%\)\n_Obs\.: peça maior_/)
  assert.match(txt, /⏳ _Em andamento, não finalizadas: Barbecue_/)
})

test('Segui a ficha apaga as quantidades digitadas; digitar sai do modo ficha', () => {
  const r = receita('Calabrese'), novoId = ids()
  let p = definirUsado(producaoVazia(DIA), r.id, 'oregano', 12, novoId)
  p = alternarFicha(p, r.id, novoId)
  assert.deepEqual(loteAberto(p, r.id).usados, {})
  p = definirUsado(p, r.id, 'maionese', 2.8, novoId)
  assert.equal(loteAberto(p, r.id).modo, 'alterada')
  assert.equal(diferencas(r, loteAberto(p, r.id)).length, 1)
  p = descartarAberto(p, r.id)
  assert.equal(p.lotes.length, 0)
})

test('Fazer outro lote e corrigir um finalizado (mesmo id, volta para a fila)', () => {
  const r = receita('Ketchup Picante'), novoId = ids()
  let p = definirRendimento(alternarFicha(producaoVazia(DIA), r.id, novoId), r.id, 2, novoId)
  p = finalizar(p, r, 10).producao
  p = marcarEnviado(p, finalizadosDe(p, r.id)[0].id, 10, 11)
  assert.equal(pendentesEnvio(p).length, 0)
  p = definirRendimento(alternarFicha(p, r.id, novoId), r.id, 1.9, novoId)
  p = finalizar(p, r, 20).producao
  assert.equal(finalizadosDe(p, r.id).length, 2)
  const primeiro = finalizadosDe(p, r.id)[0]
  p = reabrir(p, primeiro.id)
  assert.equal(loteAberto(p, r.id).id, primeiro.id)
  assert.equal(reabrir(p, finalizadosDe(p, r.id)[0].id), p, 'só um aberto por receita')
  p = finalizar(definirRendimento(p, r.id, 2.1, novoId), r, 30).producao
  const [segundo, corrigido] = finalizadosDe(p, r.id)
  assert.equal(corrigido.id, primeiro.id)
  assert.equal(corrigido.rendimento, 2.1)
  assert.deepEqual(pendentesEnvio(p).map(l => l.id), [segundo.id, primeiro.id], 'o corrigido volta para a fila')
})

test('Confirmação do servidor só vale para a versão enviada', () => {
  const r = receita('Sal da Carne'), novoId = ids()
  let p = finalizar(definirRendimento(alternarFicha(producaoVazia(DIA), r.id, novoId), r.id, 1.5, novoId), r, 100).producao
  const id = pendentesEnvio(p)[0].id
  p = finalizar(definirRendimento(reabrir(p, id), r.id, 1.48, novoId), r, 200).producao
  p = marcarEnviado(p, id, 100)
  assert.equal(pendentesEnvio(p).length, 1, 'resposta atrasada da versão antiga não confirma a nova')
  p = marcarEnviado(p, id, 200)
  assert.equal(pendentesEnvio(p).length, 0)
})

test('Pacote para o servidor: ficha congelada e escalada pelo fator', () => {
  const r = receita('Calabrese'), novoId = ids()
  let p = definirFator(producaoVazia(DIA, 'THBT', 'Ana'), r.id, 2, novoId)
  p = definirUsado(p, r.id, 'calabresa', 2.6, novoId)
  p = finalizar(definirRendimento(p, r.id, 8.2, novoId), r, 5000).producao
  const pk = pacote(r, finalizadosDe(p, r.id)[0])
  assert.equal(pk.loja, 'THBT')
  assert.equal(pk.rendimentoFicha, 8.396)
  assert.equal(pk.seguiuFicha, false)
  assert.deepEqual(pk.ingredientes[0], {id: 'calabresa', nome: 'Calabresa', unidade: 'kg', ficha: 2.468, usado: 2.6})
  assert.deepEqual(pk.ingredientes[4], {id: 'oregano', nome: 'Orégano', unidade: 'g', ficha: 20, usado: 20})
  assert.equal(referencia(r.ingredientes[0], 0.5), 0.617)
  assert.equal(rendimentoFicha(r, 0.5), 2.099)
})

test('Podar: só some o que já subiu e é de dia anterior', () => {
  const r = receita('Sal da Batata'), novoId = ids()
  let p = producaoVazia('2026-11-15')
  p = finalizar(definirRendimento(alternarFicha(p, r.id, novoId), r.id, 1.5, novoId), r, 1).producao
  p = finalizar(definirRendimento(alternarFicha(p, r.id, novoId), r.id, 1.4, novoId), r, 2).producao
  p = alternarFicha(p, receita('Barbecue').id, novoId)
  p = marcarEnviado(p, finalizadosDe(p, r.id)[0].id, 1)
  const q = podar({...p, data: DIA}, DIA)
  assert.equal(q.lotes.length, 2, 'fica o não enviado e o aberto')
  assert.equal(pendentesEnvio(q).length, 1)
})

test('Link do WhatsApp', () => {
  assert.equal(linkWhatsApp('a b\n*c*'), 'https://wa.me/?text=a%20b%0A*c*')
  assert.equal(linkWhatsApp('oi', '+55 (21) 99999-0000'), 'https://wa.me/5521999990000?text=oi')
})

test('Leitura do armazenamento: migra a versão 1 e descarta lixo', () => {
  const novoId = ids()
  const p = revisar({
    versao: 1, loja: 'THBT', cozinheiro: 'Ana', data: '2026-11-15',
    lotes: [
      {receitaId: 'calabrese', modo: 'alterada', fator: 2, usados: {calabresa: 1.23456, inexistente: 9, oregano: -1}, rendimento: 4},
      {receitaId: 'nao-existe', modo: 'ficha'},
      {receitaId: 'barbecue', modo: 'ficha'},
      {receitaId: 'barbecue', modo: 'ficha', rendimento: 12},
      {id: '00000000-0000-4000-8000-0000000000aa', receitaId: 'sal-da-carne', modo: 'ficha', fator: 1, usados: {}, rendimento: 1.5, finalizadoEm: 9, loja: 'THBF', data: '2026-11-15', enviadoEm: 10}
    ]
  }, RECEITAS, DIA, novoId)
  assert.equal(p.versao, 2)
  assert.equal(p.lotes.length, 3, 'um aberto por receita')
  const cal = loteAberto(p, 'calabrese')
  assert.deepEqual({usados: cal.usados, fator: cal.fator, rend: cal.rendimento}, {usados: {calabresa: 1.235}, fator: 2, rend: 4})
  assert.equal(loteAberto(p, 'barbecue').rendimento, 12)
  const sal = p.lotes.find(l => l.receitaId === 'sal-da-carne')
  assert.deepEqual({id: sal.id, enviadoEm: sal.enviadoEm, data: sal.data}, {id: '00000000-0000-4000-8000-0000000000aa', enviadoEm: 10, data: '2026-11-15'})
  assert.deepEqual(revisar(null, RECEITAS, DIA), producaoVazia(DIA))
})

test('Envio: corpo da chamada e tratamento de erros', async () => {
  const chamadas = []
  const ok = async (url, init) => {chamadas.push([url, JSON.parse(init.body)]); return new Response(JSON.stringify({id: 'abc', recebidoEm: 'x'}), {status: 200})}
  await enviarLote(' tk ', {id: 'abc'}, ok)
  assert.match(chamadas[0][0], /\/rest\/v1\/rpc\/fichas_registrar$/)
  assert.deepEqual(chamadas[0][1], {p_token: 'tk', p_lote: {id: 'abc'}})
  const recusa = async () => new Response(JSON.stringify({message: 'token inválido'}), {status: 401})
  await assert.rejects(enviarLote('x', {id: 'abc'}, recusa), e => e.tipo === 'token')
  await assert.rejects(enviarLote('x', {id: 'abc'}, async () => {throw new TypeError('offline')}), e => e.tipo === 'rede')
  await assert.rejects(enviarLote('x', {id: 'abc'}, async () => new Response('{"id":"outro"}')), e => e.tipo === 'servidor')
  assert.equal(await verificarToken('x', async () => new Response('{"ok":true,"nome":"Cozinha"}')), 'Cozinha')
})
