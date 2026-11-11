import test from 'node:test'
import assert from 'node:assert/strict'
import {buscarNomePorCnpj} from '../src/lib/cnpj-lookup.ts'

/** fetch falso que responde com um JSON e status controlados. */
function fetchFake(json, ok = true) {
  return async () => ({ok, json: async () => json})
}

test('Prefere nome_fantasia e capitaliza mantendo conectores', async () => {
  const f = fetchFake({nome_fantasia: 'PORTEFRIO DISTRIBUICAO DE ALIMENTOS', razao_social: 'PORTEFRIO COMERCIO LTDA'})
  assert.equal(await buscarNomePorCnpj('07.454.402/0003-77', f), 'Portefrio Distribuicao de Alimentos')
})

test('Cai para razão social quando não há nome fantasia', async () => {
  const f = fetchFake({nome_fantasia: '', razao_social: 'TOP ALTO ALIMENTOS E BEBIDAS'})
  assert.equal(await buscarNomePorCnpj('10915021000190', f), 'Top Alto Alimentos e Bebidas')
})

test('CNPJ inválido não chega a consultar', async () => {
  let chamou = false
  const f = async () => { chamou = true; return {ok: true, json: async () => ({})} }
  assert.equal(await buscarNomePorCnpj('123', f), undefined)
  assert.equal(chamou, false)
})

test('Resposta não-ok ou sem nome devolve undefined', async () => {
  assert.equal(await buscarNomePorCnpj('10915021000190', fetchFake({razao_social: 'X'}, false)), undefined)
  assert.equal(await buscarNomePorCnpj('10915021000190', fetchFake({})), undefined)
})

test('Erro de rede não propaga (offline, CORS, rate limit)', async () => {
  const f = async () => { throw new Error('network') }
  assert.equal(await buscarNomePorCnpj('10915021000190', f), undefined)
})
