import test from 'node:test'
import assert from 'node:assert/strict'
import {interpretarChaveNFe} from '../src/lib/linha-digitavel.ts'
import {
  ESTADO_VAZIO, notaDaChave, notaManual, incluirDocumento, incluirNota, vincular,
  removerNota, reconciliacao, parcelasDaNota, boletosDaNota, sugestoes, planilhaTsv, totais
} from '../src/lib/sessao.ts'

const CHAVE = '33261010915021000190550010082722291141103184'

/** Cria um documento de boleto mínimo com valor e vencimento controlados. */
function boleto(barras, valorCentavos, vencimento) {
  return {tipo: 'boleto', barras, linha: barras, pontuada: barras, valorCentavos, vencimento}
}

test('Nota da chave: número, CNPJ e série para a planilha', () => {
  const {nota} = interpretarChaveNFe(CHAVE)
  const n = notaDaChave(nota, 'Top Alto', 0)
  assert.equal(n.numero, '8272229')
  assert.equal(n.cnpj, '10915021000190')
  assert.equal(n.favorecido, 'Top Alto')
  assert.equal(n.id, CHAVE)
})

test('Sincronizado: nota ativa, boletos entram vinculados e numerados por vencimento', () => {
  let e = ESTADO_VAZIO
  const nota = notaDaChave(interpretarChaveNFe(CHAVE).nota, 'Top Alto', 0)
  e = incluirNota(e, nota).estado
  // lidos fora de ordem de vencimento; a numeração deve ordenar por data
  e = incluirDocumento(e, boleto('b2', 50000, '2026-11-24'), nota.id, 1).estado
  e = incluirDocumento(e, boleto('b1', 50000, '2026-10-24'), nota.id, 2).estado
  const parc = parcelasDaNota(e, nota.id)
  assert.deepEqual(parc.get('b1'), {n: 1, total: 2})
  assert.deepEqual(parc.get('b2'), {n: 2, total: 2})
  assert.equal(boletosDaNota(e, nota.id).length, 2)
})

test('Reconciliação: confere, parcial e excede conforme o total da nota', () => {
  let e = ESTADO_VAZIO
  const nota = notaManual('999', 'PorteFrio', {valorTotalCentavos: 100000}, 0)
  e = incluirNota(e, nota).estado
  e = incluirDocumento(e, boleto('p1', 40000, '2026-11-01'), nota.id, 1).estado
  assert.equal(reconciliacao(e, nota.id).status, 'parcial')
  e = incluirDocumento(e, boleto('p2', 60000, '2026-11-15'), nota.id, 2).estado
  assert.equal(reconciliacao(e, nota.id).status, 'confere')
  e = incluirDocumento(e, boleto('p3', 5000, '2026-12-01'), nota.id, 3).estado
  assert.equal(reconciliacao(e, nota.id).status, 'excede')
})

test('Dessincronizado: boletos primeiro, nota depois, vínculo manual', () => {
  let e = ESTADO_VAZIO
  e = incluirDocumento(e, boleto('x1', 30000, '2026-11-10'), undefined, 1).estado
  e = incluirDocumento(e, boleto('x2', 30000, '2026-11-20'), undefined, 2).estado
  assert.equal(e.documentos.filter(d => d.notaId).length, 0, 'sem nota ativa, ficam soltos')
  const nota = notaManual('154552', 'Lugabel', {valorTotalCentavos: 60000}, 3)
  e = incluirNota(e, nota).estado
  e = vincular(e, 'x1', nota.id)
  e = vincular(e, 'x2', nota.id)
  assert.equal(reconciliacao(e, nota.id).status, 'confere')
})

test('Cruzamento por valor: sugere boletos sem nota que somam o total', () => {
  let e = ESTADO_VAZIO
  const nota = notaManual('101998', 'Cipar', {valorTotalCentavos: 113575}, 0)
  e = incluirNota(e, nota).estado
  e = incluirDocumento(e, boleto('c1', 100000, '2026-11-18'), undefined, 1).estado  // ruído
  e = incluirDocumento(e, boleto('c2', 56787, '2026-11-18'), undefined, 2).estado
  e = incluirDocumento(e, boleto('c3', 56788, '2026-12-18'), undefined, 3).estado
  const s = sugestoes(e)
  assert.equal(s.length, 1)
  assert.equal(s[0].notaId, nota.id)
  assert.deepEqual(s[0].docIds.sort(), ['c2', 'c3'])
})

test('Remover nota desvincula os boletos, sem apagá-los', () => {
  let e = ESTADO_VAZIO
  const nota = notaManual('1', 'Top Alto', {}, 0)
  e = incluirNota(e, nota).estado
  e = incluirDocumento(e, boleto('d1', 1000, '2026-11-01'), nota.id, 1).estado
  e = removerNota(e, nota.id)
  assert.equal(e.notas.length, 0)
  assert.equal(e.documentos.length, 1)
  assert.equal(e.documentos[0].notaId, undefined)
})

test('Não duplica nota relida; completa favorecido faltante', () => {
  let e = ESTADO_VAZIO
  const semNome = notaDaChave(interpretarChaveNFe(CHAVE).nota, '', 0)
  e = incluirNota(e, semNome).estado
  const comNome = notaDaChave(interpretarChaveNFe(CHAVE).nota, 'Top Alto', 1)
  const r = incluirNota(e, comNome)
  assert.equal(r.novo, false)
  assert.equal(r.estado.notas.length, 1)
  assert.equal(r.estado.notas[0].favorecido, 'Top Alto')
})

test('Planilha: 9 colunas, valores simples, ParcelaXdeY só com mais de um boleto', () => {
  let e = ESTADO_VAZIO
  const nota = notaDaChave(interpretarChaveNFe(CHAVE).nota, 'Top Alto', 0)
  e = incluirNota(e, nota).estado
  e = incluirDocumento(e, boleto('b1', 132933, '2026-11-17'), nota.id, 1).estado
  e = incluirDocumento(e, boleto('b2', 132933, '2026-11-24'), nota.id, 2).estado
  const linhas = planilhaTsv(e, 'digitos').split('\n')
  assert.equal(linhas.length, 2)
  assert.equal(linhas[0], 'Top Alto\t8272229\t17/11/2026\t1329,33\t\tA Pagar\t\tParcela1de2\tb1')
  assert.equal(linhas[1], 'Top Alto\t8272229\t24/11/2026\t1329,33\t\tA Pagar\t\tParcela2de2\tb2')

  // boleto avulso (sem nota): favorecido, NF e descrição vazios; mantém status e valor
  let e2 = incluirDocumento(ESTADO_VAZIO, boleto('z9', 50000, '2026-12-01'), undefined, 0).estado
  assert.equal(planilhaTsv(e2, 'digitos'), '\t\t01/12/2026\t500,00\t\tA Pagar\t\t\tz9')
})

test('Totais somam só valores conhecidos dos documentos', () => {
  let e = ESTADO_VAZIO
  e = incluirDocumento(e, boleto('a', 100, '2026-11-01'), undefined, 0).estado
  e = incluirDocumento(e, {tipo: 'arrecadacao', barras: 'b', linha: '', pontuada: ''}, undefined, 1).estado
  assert.deepEqual(totais(e), {centavos: 100, semValor: 1})
})
