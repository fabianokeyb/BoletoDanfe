import test from 'node:test'
import assert from 'node:assert/strict'
import {RECEITAS, slug} from '../src/lib/fichas/receitas.ts'
import {
  producaoVazia, cozinheiroAtual, escolherCozinheiro, escolherLoja, andamentoDaLoja, alternarFicha, definirUsado, definirRendimento, fatorDe, fatorTexto, definirObs, descartarAberto, loteAberto,
  finalizadosDe, finalizar, reabrir, pendentesEnvio, marcarEnviado, pacote, podar, faltaParaFinalizar,
  situacao, diferencas, relatorio, linkWhatsApp, revisar, formatar, lerCampo, textoCampo, digitarTresCasas, referencia, rendimentoFicha, pct
} from '../src/lib/fichas/estado.ts'
import {enviarLote, verificarToken} from '../src/lib/fichas/enviar.ts'
import {FUNCIONARIOS} from '../src/lib/fichas/funcionarios.ts'

const DIA = '2026-11-16'
const LUCAS = 'Lucas Dodaro'
/**
 * Os testes de lógica usam a Calabrese como estava na ficha de 2026-11-16 (maionese 3 kg,
 * rendimento 4,198 kg), para não mudarem quando a ficha muda. A ficha atual é conferida à parte.
 */
const CALABRESE_FIXA = {...RECEITAS.find(r => r.id === 'calabrese'), rendimento: {qtd: 4.198, unidade: 'kg'},
  ingredientes: [['calabresa', 'Calabresa', 1.234, 'kg', '3 unidades'], ['cebola-roxa', 'Cebola Roxa', 564, 'g'], ['maionese', 'Maionese', 3, 'kg'], ['molho-ingles', 'Molho Inglês', 250, 'ml'], ['oregano', 'Orégano', 10, 'g']]
    .map(([id, nome, qtd, unidade]) => ({id, nome, qtd, unidade}))}
const RT = RECEITAS.map(r => r.id === 'calabrese' ? CALABRESE_FIXA : r)
const receita = nome => RT.find(r => r.nome === nome)
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

test('Calabrese confere com a ficha atual (maionese reduzida em 22/11/2026)', () => {
  const r = RECEITAS.find(x => x.id === 'calabrese')
  assert.deepEqual(r.ingredientes.map(i => formatar(i.qtd, i.unidade)), ['1,234 kg', '564 g', '2,800 kg', '250 ml', '10 g'])
  assert.equal(formatar(r.rendimento.qtd, r.rendimento.unidade), '4,763 kg')
  // o lote de 22/11 (2 receitas, 5,6 kg de maionese, 9,525 kg) fica dentro da ficha nova
  const l = {modo: 'alterada', usados: {calabresa: 2.468, 'cebola-roxa': 1128, maionese: 5.6, 'molho-ingles': 500, oregano: 20}, rendimento: 9.525}
  assert.equal(fatorDe(r, l), 2)
  assert.equal(diferencas(r, l).length, 0)
  assert.equal(rendimentoFicha(r, 2), 9.526)
})

test('Formatação e leitura de campos', () => {
  assert.equal(formatar(2.47, 'l'), '2,470 L')
  assert.equal(formatar(1503, 'g'), '1.503 g')
  assert.equal(lerCampo('1.2345', 'kg'), 1.235)
  assert.equal(lerCampo('600,4', 'g'), 600)
  assert.equal(lerCampo('abc', 'g'), undefined)
  assert.equal(pct(-0.08), '−8,0%')
})

test('kg e L como calculadora: vírgula automática a 3 casas', () => {
  // digitando 1, 2, 0, 0
  const passos = []
  let campo = ''
  for (const tecla of '1200') {campo = digitarTresCasas(campo + tecla); passos.push(campo)}
  assert.deepEqual(passos, ['0,001', '0,012', '0,120', '1,200'])
  assert.equal(lerCampo(campo, 'kg'), 1.2)
  // apagar o último dígito volta uma casa
  assert.equal(digitarTresCasas('1,20'), '0,120')
  assert.equal(digitarTresCasas('0,00'), '')
  // vírgula ou letra digitadas são ignoradas; zeros à esquerda somem
  assert.equal(digitarTresCasas('1,2'), '0,012')
  assert.equal(digitarTresCasas('0012345'), '12,345')
  assert.equal(digitarTresCasas('12345678'), '1.234,567', 'no máximo 7 dígitos')
  assert.equal(lerCampo('1.234,567', 'kg'), 1234.567)
  assert.equal(textoCampo(3, 'kg'), '3,000')
  assert.equal(textoCampo(2.47, 'l'), '2,470')
  assert.equal(textoCampo(564, 'g'), '564')
})

test('Finalizar exige rendimento, mesmo seguindo a ficha', () => {
  const r = receita('Barbecue'), novoId = ids()
  let p = producaoVazia(DIA, 'THBF', LUCAS)
  assert.match(finalizar(p, r).erro, /Segui a ficha/)
  p = alternarFicha(p, r.id, novoId)
  assert.match(finalizar(p, r).erro, /rendimento de Barbecue/)
  assert.equal(faltaParaFinalizar(r, loteAberto(p, r.id)), 'Pese e informe o rendimento de Barbecue.')
  p = definirRendimento(p, r.id, 11.8, novoId)
  p = finalizar(p, r, 1000).producao
  const [l] = finalizadosDe(p, r.id)
  assert.deepEqual({loja: l.loja, data: l.data, cozinheiro: l.cozinheiro, finalizadoEm: l.finalizadoEm}, {loja: 'THBF', data: DIA, cozinheiro: LUCAS, finalizadoEm: 1000})
  assert.equal(loteAberto(p, r.id), undefined)
  assert.equal(situacao(r, l), 'conforme')
  const txt = relatorio(p, RT)
  assert.match(txt, /^🧑‍🍳 \*THB · PRODUÇÃO\* · Freguesia · 16\/11\/2026\nCozinheiro: Lucas Dodaro/)
  assert.match(txt, /✅ \*Barbecue\* · na proporção da ficha\nRendimento: \*11,800 kg\* \(ficha 12,000 kg · −1,7%\)/)
})

test('Alterada: relatório lista só o que mudou; lote aberto aparece como em andamento', () => {
  const r = receita('Calabrese'), novoId = ids()
  let p = definirUsado(producaoVazia(DIA, 'THBF', LUCAS), r.id, 'calabresa', 1.5, novoId)
  p = definirRendimento(p, r.id, 4.5, novoId)
  p = definirObs(p, r.id, ' peça maior ', novoId)
  p = finalizar(p, r).producao
  p = alternarFicha(p, receita('Barbecue').id, novoId)
  const txt = relatorio(p, RT)
  assert.match(txt, /✅ 0 conforme a ficha · ✏️ 1 com alteração/)
  assert.match(txt, /✏️ \*Calabrese\* · ALTERADA\n• Calabresa: \*1,500 kg\* \(ficha 1,234 kg · \+21,6%\)\n• Demais ingredientes: na proporção da ficha\nRendimento: \*4,500 kg\* \(ficha 4,198 kg · \+7,2%\)\n_Obs\.: peça maior_/)
  assert.match(txt, /⏳ _Em andamento, não finalizadas: Barbecue \(Lucas Dodaro\)_/)
})

test('Segui a ficha apaga as quantidades digitadas; digitar sai do modo ficha', () => {
  const r = receita('Calabrese'), novoId = ids()
  let p = definirUsado(producaoVazia(DIA, 'THBF', LUCAS), r.id, 'oregano', 12, novoId)
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
  let p = definirRendimento(alternarFicha(producaoVazia(DIA, 'THBF', LUCAS), r.id, novoId), r.id, 2, novoId)
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
  let p = finalizar(definirRendimento(alternarFicha(producaoVazia(DIA, 'THBF', LUCAS), r.id, novoId), r.id, 1.5, novoId), r, 100).producao
  const id = pendentesEnvio(p)[0].id
  p = finalizar(definirRendimento(reabrir(p, id), r.id, 1.48, novoId), r, 200).producao
  p = marcarEnviado(p, id, 100)
  assert.equal(pendentesEnvio(p).length, 1, 'resposta atrasada da versão antiga não confirma a nova')
  p = marcarEnviado(p, id, 200)
  assert.equal(pendentesEnvio(p).length, 0)
})

test('Pacote para o servidor: ficha de 1 receita e receitas feitas calculadas', () => {
  const r = receita('Calabrese'), novoId = ids()
  let p = producaoVazia(DIA, 'THBT', LUCAS)
  for (const [id, q] of [['calabresa', 2.6], ['cebola-roxa', 1128], ['maionese', 6], ['molho-ingles', 500], ['oregano', 20]]) p = definirUsado(p, r.id, id, q, novoId)
  p = finalizar(definirRendimento(p, r.id, 8.2, novoId), r, 5000).producao
  const pk = pacote(r, finalizadosDe(p, r.id)[0])
  assert.equal(pk.loja, 'THBT')
  assert.equal(pk.fator, 2)
  assert.equal(pk.rendimentoFicha, 4.198)
  assert.equal(pk.seguiuFicha, false)
  assert.deepEqual(pk.ingredientes[0], {id: 'calabresa', nome: 'Calabresa', unidade: 'kg', ficha: 1.234, usado: 2.6})
  assert.deepEqual(pk.ingredientes[4], {id: 'oregano', nome: 'Orégano', unidade: 'g', ficha: 10, usado: 20})
  const txt = relatorio(p, RT)
  assert.match(txt, /✏️ \*Calabrese\* · 2 receitas · ALTERADA\n• Calabresa: \*2,600 kg\* \(esperado 2,468 kg · \+5,3%\)\n• Demais ingredientes: na proporção da ficha\nRendimento: \*8,200 kg\* \(esperado 8,396 kg · −2,3%\)/)
})

test('Receitas feitas: mediana ponderada pelo peso, não o ingrediente mais alterado', () => {
  const cal = receita('Calabrese')
  const lote = usados => ({modo: 'alterada', usados})
  assert.equal(fatorDe(cal, lote({})), 1)
  assert.equal(fatorDe(cal, {modo: 'ficha', usados: {calabresa: 9}}), 1)
  assert.equal(fatorDe(cal, lote({calabresa: 1.5})), 1, 'mudar só a calabresa não muda as receitas feitas')
  assert.equal(fatorDe(cal, lote({calabresa: 2.4, 'cebola-roxa': 1100, maionese: 5.9, 'molho-ingles': 500, oregano: 20})), 1.967)
  assert.equal(fatorTexto(1.967), '1,97 receita')
  assert.equal(fatorTexto(2), '2 receitas')
  // mudar só a maionese (59% do peso) também não muda as receitas feitas
  assert.equal(fatorDe(cal, lote({maionese: 2.8})), 1)
  // Mostarda e Mel: mostarda é o maior peso e manda
  const mm = receita('Mostarda e Mel')
  assert.equal(fatorDe(mm, lote({'mostarda-amarela': 1.5, mel: 530})), 1.5)
  // Barbecue em dobro, com o sal esquecido em 150 g: continua 2 receitas e o sal aparece
  const bbq = receita('Barbecue')
  const dobro = Object.fromEntries(bbq.ingredientes.map(i => [i.id, i.qtd * 2]))
  const l = lote({...dobro, sal: 150})
  assert.equal(fatorDe(bbq, l), 2)
  assert.deepEqual(diferencas(bbq, l).map(d => [d.ingrediente.nome, d.esperado, Math.round(d.variacao * 100)]), [['Sal', 300, -50]])
  // arredondamento de 1 g não é desvio: Maionese Verde ×1,5 com caldo 3 g
  const mv = receita('Maionese Verde')
  const meia = Object.fromEntries(mv.ingredientes.map(i => [i.id, Math.round(i.qtd * 1.5)]))
  assert.equal(fatorDe(mv, lote(meia)), 1.5)
  assert.equal(diferencas(mv, lote(meia)).length, 0)
})

test('Cada loja tem o próprio cozinheiro e o próprio andamento', () => {
  const r = receita('Sal da Carne'), novoId = ids()
  let p = producaoVazia(DIA)
  assert.equal(alternarFicha(p, r.id, novoId), p, 'sem cozinheiro escolhido não começa receita')
  p = escolherCozinheiro(p, 'Fulano')
  assert.equal(cozinheiroAtual(p), '', 'nome fora da lista não vale')
  p = escolherCozinheiro(p, LUCAS)
  p = definirRendimento(alternarFicha(p, r.id, novoId), r.id, 1.5, novoId)
  assert.equal(loteAberto(p, r.id).cozinheiro, LUCAS)
  // Tijuca: outro cozinheiro, a mesma receita começa do zero
  p = escolherCozinheiro(escolherLoja(p, 'THBT'), 'Rita de Cássia')
  assert.equal(loteAberto(p, r.id), undefined)
  p = alternarFicha(p, r.id, novoId)
  assert.equal(loteAberto(p, r.id).cozinheiro, 'Rita de Cássia')
  assert.deepEqual(andamentoDaLoja(p, 'THBF'), {abertos: 1, finalizados: 0})
  assert.deepEqual(andamentoDaLoja(p, 'THBT'), {abertos: 1, finalizados: 0})
  // volta para Freguesia: Lucas continua lá e finaliza o lote dele
  p = escolherLoja(p, 'THBF')
  assert.equal(cozinheiroAtual(p), LUCAS)
  p = finalizar(p, r, 7).producao
  const [l] = finalizadosDe(p, r.id)
  assert.deepEqual([l.loja, l.cozinheiro], ['THBF', LUCAS])
  assert.deepEqual(andamentoDaLoja(p, 'THBF'), {abertos: 0, finalizados: 1})
  assert.match(relatorio(escolherLoja(p, 'THBT'), RT), /Tijuca[\s\S]*Nenhuma receita finalizada[\s\S]*Em andamento, não finalizadas: Sal da Carne \(Rita de Cássia\)/)
})

test('Relatório com dois cozinheiros na mesma loja', () => {
  const novoId = ids()
  let p = producaoVazia(DIA, 'THBF', LUCAS)
  p = finalizar(definirRendimento(alternarFicha(p, 'sal-da-carne', novoId), 'sal-da-carne', 1.5, novoId), receita('Sal da Carne'), 1).producao
  p = escolherCozinheiro(p, 'Wagner Moreira')
  p = finalizar(definirRendimento(alternarFicha(p, 'sal-da-batata', novoId), 'sal-da-batata', 1.5, novoId), receita('Sal da Batata'), 2).producao
  const txt = relatorio(p, RT)
  assert.match(txt, /Cozinheiros: Lucas Dodaro, Wagner Moreira/)
  assert.match(txt, /\*Sal da Batata\*[\s\S]*_por Wagner Moreira_/)
})

test('Podar: só some o que já subiu e é de dia anterior', () => {
  const r = receita('Sal da Batata'), novoId = ids()
  let p = producaoVazia('2026-11-15', 'THBF', LUCAS)
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
  assert.equal(p.versao, 3)
  assert.deepEqual(p.cozinheiros, {})
  assert.equal(p.lotes.length, 3, 'um aberto por receita')
  const cal = loteAberto(p, 'calabrese')
  assert.deepEqual({usados: cal.usados, rend: cal.rendimento}, {usados: {calabresa: 1.235}, rend: 4})
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
