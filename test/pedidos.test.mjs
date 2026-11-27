import test from 'node:test'
import assert from 'node:assert/strict'
import {
  novoPedido, pedidoDaLista, validar, linhasParaServidor, paraServidor, doServidor, mudou, atendeu, descreverAlteracao, dataHora
} from '../src/lib/pedidos/modelo.ts'
import {salvar, abrir, listar, ErroConflito} from '../src/lib/pedidos/servidor.ts'
import {ESTADO_INICIAL, criarLista, atualizarLista, criarItem, definirQuantidade} from '../src/lib/compras/estado.ts'

const LOJAS = [{id: 1, sigla: 'THBT', nome: 'Tijuca'}, {id: 3, sigla: 'THBF', nome: 'Freguesia'}]

/** Estado do módulo Compras com Tijuca, Freguesia e uma lista pessoal (sem loja no sistema). */
function estadoCompras() {
  let e = ESTADO_INICIAL
  let r = criarLista(e, 'Tijuca'); e = atualizarLista(r.estado, r.lista.id, {sigla: 'THBT'}); const tij = r.lista.id
  r = criarLista(e, 'Freguesia'); e = atualizarLista(r.estado, r.lista.id, {sigla: 'THBF'}); const freg = r.lista.id
  r = criarLista(e, 'Casa', 'pessoal'); e = r.estado; const casa = r.lista.id
  let i = criarItem(e, {nome: 'Cheddar', unidade: 'kg', secao: 'producao', grupo: 'Insumos'}); e = i.estado; const ched = i.item.id
  i = criarItem(e, {nome: 'Brioche', unidade: 'un', secao: 'producao', grupo: 'Insumos'}); e = i.estado; const bri = i.item.id
  i = criarItem(e, {nome: 'Coca', unidade: 'un', secao: 'bebidas', grupo: 'Refrigerantes'}); e = i.estado; const coca = i.item.id
  e = definirQuantidade(e, tij, ched, 10)
  e = definirQuantidade(e, freg, ched, 4.5)
  e = definirQuantidade(e, freg, bri, 200)
  e = definirQuantidade(e, casa, bri, 2)
  e = definirQuantidade(e, tij, coca, 12)
  return {e, ched, bri}
}

test('Pedido da lista Montar: itens com quantidade por loja, lojas casadas pela sigla, seção respeitada', () => {
  const {e, ched, bri} = estadoCompras()
  const {pedido, semLoja} = pedidoDaLista(e, 'producao', LOJAS)
  assert.deepEqual(pedido.lojas, [1, 3])
  assert.deepEqual(semLoja, ['Casa'])
  assert.equal(pedido.itens.length, 2)
  const c = pedido.itens.find(i => i.catalogoId === ched)
  assert.deepEqual(c.qtd, {1: 10, 3: 4.5})
  assert.deepEqual(pedido.itens.find(i => i.catalogoId === bri).qtd, {3: 200})
  assert.equal(pedido.versao, 0)
  assert.equal(pedido.situacao, 'rascunho')
})

test('Linhas para o servidor: uma por item × loja marcada, sem zeros', () => {
  const p = novoPedido([1])
  p.itens.push({id: 'a', descricao: ' Cheddar ', unidade: 'kg', qtd: {1: 10, 3: 4}})
  p.itens.push({id: 'b', descricao: 'Brioche', unidade: 'un', qtd: {1: 0}})
  const l = linhasParaServidor(p)
  assert.equal(l.length, 1)
  assert.deepEqual(l[0], {linha: 'a', loja_id: 1, catalogo_id: null, descricao: 'Cheddar', unidade: 'kg', grupo: null, fornecedor: null, qtd: 10})
})

test('Validação: exige loja, item com quantidade e nome', () => {
  const p = novoPedido()
  assert.deepEqual(validar(p), ['Marque pelo menos uma loja.', 'Inclua pelo menos um item com quantidade.'])
  p.lojas = [1]
  p.itens.push({id: 'a', descricao: '', unidade: 'un', qtd: {1: 2}})
  assert.deepEqual(validar(p), ['Um item está sem nome.'])
  p.itens[0].descricao = 'Guardanapo'
  assert.deepEqual(validar(p), [])
})

test('Volta do servidor: linhas item × loja viram itens com qtd por loja; ida e volta não muda nada', () => {
  const r = {
    pedido: {id: 'p-123456789', numero: 42, solicitante_id: 1, solicitante: 'Fabiano', criado_em: '2026-11-27T00:37:00Z', lojas: [1, 3],
      situacao: 'rascunho', fornecedor: 'Assaí', vendedor: 'João', observacao: '', versao: 3, atualizado_por: 'Maria', atualizado_em: '2026-11-28T12:10:00Z'},
    itens: [
      {linha: 'a', loja_id: 1, catalogo_id: 'x', descricao: 'Cheddar', unidade: 'kg', grupo: 'Insumos', fornecedor: null, qtd: 10},
      {linha: 'a', loja_id: 3, catalogo_id: 'x', descricao: 'Cheddar', unidade: 'kg', grupo: 'Insumos', fornecedor: null, qtd: '4.500'}
    ]
  }
  const p = doServidor(r)
  assert.equal(p.numero, 42)
  assert.deepEqual(p.itens[0].qtd, {1: 10, 3: 4.5})
  const copia = structuredClone(p)
  assert.equal(mudou(p, copia), false)
  copia.itens[0].qtd[3] = 5
  assert.equal(mudou(p, copia), true)
  assert.equal(paraServidor(copia).itens.length, 2)
})

test('Tolerância dos 100%: 3% só para kg e L; itens contados batem exato', () => {
  assert.equal(atendeu('kg', 10, 10.3), true)
  assert.equal(atendeu('kg', 10, 9.7), true)
  assert.equal(atendeu('kg', 10, 9.6), false)
  assert.equal(atendeu('L', 20, 20.5), true)
  assert.equal(atendeu('un', 200, 199), false)
  assert.equal(atendeu('cx', 4, 4), true)
  assert.equal(atendeu('2,8 kg', 3, 3.05), false)
})

test('Histórico em frases, com siglas das lojas e nomes das situações', () => {
  assert.equal(descreverAlteracao({versao: 1, autor: 'F', em: '', acao: 'criou'}, LOJAS), 'criou o pedido')
  assert.equal(descreverAlteracao({versao: 2, autor: 'M', em: '', acao: 'editou item', campo: 'qtd', linha: 'Cheddar', lojaId: 3, antes: 4.5, depois: 6}, LOJAS),
    'mudou quantidade de Cheddar (THBF): 4,5 → 6')
  assert.equal(descreverAlteracao({versao: 2, autor: 'M', em: '', acao: 'editou', campo: 'situacao', antes: 'rascunho', depois: 'enviado'}, LOJAS),
    'mudou a situação: Rascunho → Enviado')
  assert.equal(descreverAlteracao({versao: 2, autor: 'M', em: '', acao: 'editou', campo: 'lojas', antes: [1], depois: [1, 3]}, LOJAS),
    'mudou lojas: THBT → THBT e THBF')
  assert.equal(descreverAlteracao({versao: 2, autor: 'M', em: '', acao: 'removeu', linha: 'Brioche', lojaId: 1, antes: 200}, LOJAS),
    'removeu Brioche (THBT): era 200')
  assert.match(dataHora('2026-11-27T12:00:00Z'), /^\d{2}\/\d{2}\/2026 às \d{2}:\d{2}$/)
})

/** fetch falso que devolve status e corpo fixos e guarda o último corpo enviado. */
function fetchFalso(status, corpo) {
  const f = async (_url, init) => {f.enviado = JSON.parse(init.body); f.url = _url; return new Response(JSON.stringify(corpo), {status})}
  return f
}

test('Servidor: salvar envia pessoa e pedido; conflito de versão vira ErroConflito', async () => {
  const p = novoPedido([1])
  p.itens.push({id: 'a', descricao: 'Cheddar', unidade: 'kg', qtd: {1: 10}})
  const ok = fetchFalso(200, {id: p.id, numero: 7, versao: 1})
  assert.deepEqual(await salvar(' tk ', 5, p, ok), {id: p.id, numero: 7, versao: 1})
  assert.match(ok.url, /rpc\/pedido_salvar$/)
  assert.equal(ok.enviado.p_token, 'tk')
  assert.equal(ok.enviado.p_pessoa, 5)
  assert.equal(ok.enviado.p_pedido.itens[0].qtd, 10)
  await assert.rejects(salvar('tk', 5, p, fetchFalso(400, {message: 'conflito: o pedido está na versão 4, o aparelho editou a 3'})), ErroConflito)
  await assert.rejects(salvar('tk', 5, p, fetchFalso(400, {message: 'pessoa não autorizada a fazer pedidos'})), /não está autorizado/)
})

test('Servidor: listar e abrir convertem a resposta', async () => {
  const cards = await listar('tk', false, fetchFalso(200, [{id: 'p1', numero: 1, solicitante: 'Fabiano', criado_em: 'x', lojas: [1, 3], situacao: 'rascunho', itens: 2, fornecedores: 1, atualizado_por: 'Fabiano', atualizado_em: 'y'}]))
  assert.equal(cards[0].solicitante, 'Fabiano')
  assert.deepEqual(cards[0].lojas, [1, 3])
  const r = await abrir('tk', 'p1', fetchFalso(200, {
    pedido: {id: 'p1', numero: 1, solicitante_id: 1, solicitante: 'Fabiano', lojas: [1], situacao: 'rascunho', versao: 2},
    itens: [{linha: 'a', loja_id: 1, descricao: 'Cheddar', unidade: 'kg', qtd: 10}],
    alteracoes: [{versao: 2, autor: 'Maria', em: 'z', acao: 'editou item', campo: 'qtd', linha: 'Cheddar', loja_id: 1, antes: 8, depois: 10}]
  }))
  assert.equal(r.pedido.versao, 2)
  assert.equal(r.alteracoes[0].lojaId, 1)
})
