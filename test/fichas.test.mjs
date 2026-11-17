import test from 'node:test'
import assert from 'node:assert/strict'
import {RECEITAS, slug} from '../src/lib/fichas/receitas.ts'
import {
  producaoVazia, alternarFicha, definirUsado, definirRendimento, definirFator, definirObs, removerLote, loteDe,
  situacao, diferencas, contar, relatorio, linkWhatsApp, revisar, formatar, lerCampo, referencia, rendimentoFicha, pct
} from '../src/lib/fichas/estado.ts'

const DIA = '2026-11-16'
const receita = nome => RECEITAS.find(r => r.nome === nome)

test('Cadastro: 27 fichas, ids únicos, quantidades positivas', () => {
  assert.equal(RECEITAS.length, 27)
  assert.equal(new Set(RECEITAS.map(r => r.id)).size, 27)
  assert.deepEqual(RECEITAS.map(r => r.numero), Array.from({length: 27}, (_, i) => i + 1))
  for (const r of RECEITAS) {
    assert.ok(r.rendimento.qtd > 0, r.nome)
    assert.ok(r.ingredientes.length >= 2, r.nome)
    assert.equal(new Set(r.ingredientes.map(i => i.id)).size, r.ingredientes.length, r.nome)
    for (const i of r.ingredientes) assert.ok(i.qtd > 0, `${r.nome} · ${i.nome}`)
  }
  assert.equal(slug('Açúcar Mascavo'), 'acucar-mascavo')
})

test('Calabrese confere com a ficha', () => {
  const r = receita('Calabrese')
  assert.deepEqual(r.ingredientes.map(i => formatar(i.qtd, i.unidade)), ['1,234 kg', '564 g', '3,000 kg', '250 ml', '10 g'])
  assert.equal(formatar(r.rendimento.qtd, r.rendimento.unidade), '4,198 kg')
  assert.equal(r.ingredientes[1].obs, '3 unidades')
  assert.equal(r.validadeDias, 7)
})

test('Formatação e leitura de campos', () => {
  assert.equal(formatar(2.47, 'l'), '2,470 L')
  assert.equal(formatar(1503, 'g'), '1.503 g')
  assert.equal(formatar(0.5, 'un'), '0,5 un')
  assert.equal(lerCampo('1,5', 'kg'), 1.5)
  assert.equal(lerCampo('1.2345', 'kg'), 1.235)
  assert.equal(lerCampo('600,4', 'g'), 600)
  assert.equal(lerCampo('', 'g'), undefined)
  assert.equal(lerCampo('abc', 'g'), undefined)
  assert.equal(pct(0.2156), '+21,6%')
  assert.equal(pct(-0.08), '−8,0%')
})

test('Seguiu a ficha: uma linha com o rendimento da ficha', () => {
  const r = receita('Barbecue')
  let p = alternarFicha(producaoVazia(DIA, 'THBF', 'João'), r.id)
  assert.equal(situacao(r, loteDe(p, r.id)), 'conforme')
  const txt = relatorio(p, RECEITAS)
  assert.match(txt, /^🧑‍🍳 \*THB · PRODUÇÃO\* · THBF · 16\/11\/2026\nCozinheiro: João\n✅ 1 conforme a ficha · ✏️ 0 com alteração/)
  assert.match(txt, /✅ \*Barbecue\* · conforme a ficha\nRendimento: 12,000 kg/)
  p = alternarFicha(p, r.id)
  assert.equal(p.lotes.length, 0, 'tocar de novo desmarca')
})

test('Alterada: lista só o que mudou, com ficha e variação, e exige rendimento', () => {
  const r = receita('Calabrese')
  let p = definirUsado(producaoVazia(DIA), r.id, 'calabresa', 1.5)
  assert.equal(situacao(r, loteDe(p, r.id)), 'incompleta')
  assert.match(relatorio(p, RECEITAS), /⚠️ \*Calabrese\* · ALTERADA[\s\S]*Rendimento: _não informado_ \(ficha 4,198 kg\)/)
  p = definirRendimento(p, r.id, 4.5)
  assert.equal(situacao(r, loteDe(p, r.id)), 'alterada')
  const txt = relatorio(p, RECEITAS)
  assert.match(txt, /✏️ \*Calabrese\* · ALTERADA\n• Calabresa: \*1,500 kg\* \(ficha 1,234 kg · \+21,6%\)\n• Demais ingredientes: conforme a ficha\nRendimento: \*4,500 kg\* \(ficha 4,198 kg · \+7,2%\)/)
  assert.deepEqual(contar(p, RECEITAS), {conforme: 0, alterada: 1, incompleta: 0})
})

test('Só o rendimento diferente também conta como alteração', () => {
  const r = receita('Ketchup Picante')
  const p = definirRendimento(producaoVazia(DIA), r.id, 1.9)
  assert.equal(situacao(r, loteDe(p, r.id)), 'alterada')
  assert.match(relatorio(p, RECEITAS), /• Ingredientes: conforme a ficha\nRendimento: \*1,900 kg\* \(ficha 2,000 kg · −5,0%\)/)
})

test('Digitar o mesmo valor da ficha não vira alteração; apagar tudo remove o lote', () => {
  const r = receita('Calabrese')
  let p = definirUsado(producaoVazia(DIA), r.id, 'oregano', 10)
  assert.equal(diferencas(r, loteDe(p, r.id)).length, 0)
  assert.equal(situacao(r, loteDe(p, r.id)), 'conforme')
  p = definirUsado(p, r.id, 'oregano', undefined)
  assert.equal(p.lotes.length, 0)
})

test('Receita em dobro: a referência escala com o fator', () => {
  const r = receita('Calabrese')
  let p = definirFator(alternarFicha(producaoVazia(DIA), r.id), r.id, 2)
  assert.equal(referencia(r.ingredientes[0], 2), 2.468)
  assert.equal(rendimentoFicha(r, 2), 8.396)
  assert.match(relatorio(p, RECEITAS), /✅ \*Calabrese\* ×2 · conforme a ficha\nRendimento: 8,396 kg/)
  p = definirRendimento(definirUsado(p, r.id, 'maionese', 5.5), r.id, 8)
  assert.match(relatorio(p, RECEITAS), /• Maionese: \*5,500 kg\* \(ficha 6,000 kg · −8,3%\)/)
  assert.equal(loteDe(definirFator(p, r.id, 0.2), r.id).fator, 0.5, 'mínimo de meia receita')
})

test('Relatório segue a ordem das fichas e leva a observação', () => {
  let p = producaoVazia(DIA)
  p = alternarFicha(p, receita('Sal da Batata').id)
  p = alternarFicha(p, receita('Barbecue').id)
  p = definirObs(p, receita('Barbecue').id, '  faltou goiabada da marca de sempre ')
  const txt = relatorio(p, RECEITAS)
  assert.ok(txt.indexOf('Barbecue') < txt.indexOf('Sal da Batata'))
  assert.match(txt, /_Obs\.: faltou goiabada da marca de sempre_/)
  assert.equal(removerLote(p, receita('Barbecue').id).lotes.length, 1)
  assert.match(relatorio(producaoVazia(DIA), RECEITAS), /_Nenhuma receita registrada\._/)
})

test('Link do WhatsApp: texto codificado e número só com dígitos', () => {
  assert.equal(linkWhatsApp('a b\n*c*'), 'https://wa.me/?text=a%20b%0A*c*')
  assert.equal(linkWhatsApp('oi', '+55 (21) 99999-0000'), 'https://wa.me/5521999990000?text=oi')
})

test('Leitura do armazenamento: descarta receita e ingrediente desconhecidos e valores inválidos', () => {
  const r = receita('Calabrese')
  const p = revisar({
    loja: 'THBT', cozinheiro: 'Ana', data: '2026-11-15',
    lotes: [
      {receitaId: r.id, modo: 'alterada', fator: 2, usados: {calabresa: 1.23456, inexistente: 9, oregano: -1}, rendimento: 4, obs: ' ok '},
      {receitaId: 'nao-existe', modo: 'ficha'},
      {receitaId: receita('Barbecue').id, modo: 'ficha', usados: {sal: 1}, rendimento: 3}
    ]
  }, RECEITAS, DIA)
  assert.equal(p.loja, 'THBT')
  assert.equal(p.lotes.length, 2)
  assert.deepEqual(loteDe(p, r.id), {receitaId: r.id, modo: 'alterada', fator: 2, usados: {calabresa: 1.235}, rendimento: 4, obs: 'ok'})
  assert.deepEqual(loteDe(p, receita('Barbecue').id), {receitaId: 'barbecue', modo: 'ficha', fator: 1, usados: {}})
  assert.deepEqual(revisar(null, RECEITAS, DIA), producaoVazia(DIA))
})
