import test from 'node:test'
import assert from 'node:assert/strict'
import {indexar, resumir, compararGondola, produtoPorGtin} from '../src/lib/compras/precos.ts'
import {buscarCandidatos} from '../src/lib/compras/vinculo.ts'
import {
  ESTADO_INICIAL, criarLista, criarItem, definirQuantidade, alternarStatus, marcarItem, metricas,
  novaRodada, registrarPesquisa, relatorio, removerItem, removerLista, revisar
} from '../src/lib/compras/estado.ts'
import {importarLista2601} from '../src/lib/compras/semente.ts'
import {baixarSnapshot, ErroSincronizacao} from '../src/lib/compras/sincronizar.ts'

/** Snapshot mínimo com a mesma forma do RPC compras_precos. */
const SNAP = {
  geradoEm: '2026-11-12T00:00:00Z',
  insumos: [
    {id: 4615267, descricao: 'Maionese', grupo: 'Molhos', unidade: 'kg', conteudo: null, unidadeConteudo: null},
    {id: 5882787, descricao: 'Óleo 900 ml', grupo: 'Batatas', unidade: 'un', conteudo: 900, unidadeConteudo: 'ml'},
    {id: 5882788, descricao: 'Cebola Branca', grupo: 'Hortifruti', unidade: 'kg', conteudo: null, unidadeConteudo: null}
  ],
  produtos: [
    {chave: '06057223:1092223', fornecedor: 'Assaí', descricao: 'MAIONESE VIGOR 1KG', gtin: '07891999010808', categoria: 'INSUMO', insumo: 4615267, embalagens: {UN1: [1, 'kg']}},
    {chave: '06057223:91932', fornecedor: 'Assaí', descricao: 'OLEO SOJA VILA VELHA PET 900ML', gtin: '7896223709255', categoria: 'INSUMO', insumo: 5882787, embalagens: {UN1: [900, 'ml']}},
    {chave: '06057223:7832', fornecedor: 'Assaí', descricao: 'CEBOLA NACIONAL KG', gtin: null, categoria: 'INSUMO', insumo: 5882788, embalagens: {KG1: [1, 'kg'], SC19: [19, 'kg']}},
    {chave: '06057223:3372', fornecedor: 'Assaí', descricao: 'COUVE MANTEIGA', gtin: null, categoria: 'INSUMO', insumo: null, embalagens: {PC1: [1, 'un']}}
  ],
  obs: [
    ['k1:1', '2026-08-10', 'Assaí', '06057223:1092223', 'UN1', 10, 84.9, 10],
    ['k2:1', '2026-10-20', 'Assaí', '06057223:1092223', 'UN1', 20, 219.8, 20],
    ['k3:1', '2026-10-01', 'Assaí', '06057223:91932', 'UN1', 24, 162, 24],
    ['k4:1', '2026-09-01', 'Assaí', '06057223:7832', 'KG1', 5, 29.75, 5],
    ['k5:1', '2026-10-15', 'Assaí', '06057223:7832', 'SC19', 1, 113.81, 19],
    ['k6:1', '2026-10-15', 'Assaí', '06057223:3372', 'PC1', 3, 10.77, null]
  ]
}
const IDX = indexar(SNAP)

test('Resumo: última compra e média ponderada na janela, na unidade do insumo', () => {
  const r = resumir(IDX, [{tipo: 'insumo', id: 4615267}], 90, '2026-11-12')
  assert.equal(r.unidade, 'kg')
  assert.equal(r.compras.length, 2)
  assert.equal(r.ultima.data, '2026-10-20')
  assert.equal(r.ultima.precoEmbalagem.toFixed(2), '10.99')
  // janela de 90 dias a partir de 12/11 começa em 14/08: só a compra de 20/10 entra
  assert.equal(r.media.toFixed(2), '10.99')
  assert.equal(r.mediaHistorico, false)
  const tudo = resumir(IDX, [{tipo: 'insumo', id: 4615267}], 0, '2026-11-12')
  assert.equal(tudo.media.toFixed(4), ((84.9 + 219.8) / 30).toFixed(4))
})

test('Saco de 19 kg e quilo avulso entram na mesma média por kg', () => {
  const r = resumir(IDX, [{tipo: 'insumo', id: 5882788}], 0, '2026-11-12')
  assert.equal(r.unidade, 'kg')
  assert.equal(r.media.toFixed(4), ((29.75 + 113.81) / 24).toFixed(4))
  assert.equal(r.ultima.uCom, 'SC19')
  assert.equal(r.ultima.embalagem, '19 kg')
})

test('Produto sem insumo usa o conteúdo físico da embalagem', () => {
  const r = resumir(IDX, [{tipo: 'produto', chave: '06057223:3372'}], 0, '2026-11-12')
  assert.equal(r.unidade, 'un')
  assert.equal(r.media.toFixed(2), '3.59')
})

test('Sem compras: resumo indefinido', () => {
  assert.equal(resumir(IDX, [], 90), undefined)
  assert.equal(resumir(IDX, [{tipo: 'insumo', id: 999}], 90), undefined)
})

test('Gôndola: compara por kg e por ml quando o insumo é contável', () => {
  const mai = resumir(IDX, [{tipo: 'insumo', id: 4615267}], 90, '2026-11-12')
  // balde de 2,8 kg a R$ 27,90 → 9,96/kg, ~9% abaixo de 10,99
  const c = compararGondola(mai, 27.9, 2.8, 'kg')
  assert.equal(c.veredito, 'barato')
  assert.ok(c.vsMedia < -0.08 && c.vsMedia > -0.1)
  const oleo = resumir(IDX, [{tipo: 'insumo', id: 5882787}], 0, '2026-11-12')
  assert.equal(oleo.unidadeDescricao, 'un de 900 ml')
  // óleo de 900 ml informado em ml: converte pelo conteúdo do insumo
  const o = compararGondola(oleo, 6.75, 900, 'ml')
  assert.equal(o.veredito, 'na-media')
  assert.equal(compararGondola(mai, 10, 1, 'un'), undefined, 'un não converte para kg')
})

test('EAN lido acha o produto mesmo com zero à esquerda do GTIN-14', () => {
  assert.equal(produtoPorGtin(IDX, '7891999010808').chave, '06057223:1092223')
  assert.equal(produtoPorGtin(IDX, '7896223709255').chave, '06057223:91932')
})

test('Sugestão de vínculo: insumo antes de produto, sem acento e sem unidade', () => {
  assert.deepEqual(buscarCandidatos(IDX, 'Maionese (2,8 kg)')[0].vinculo, {tipo: 'insumo', id: 4615267})
  assert.deepEqual(buscarCandidatos(IDX, 'Óleo (900 ml)')[0].vinculo, {tipo: 'insumo', id: 5882787})
  assert.deepEqual(buscarCandidatos(IDX, 'Couve')[0].vinculo, {tipo: 'produto', chave: '06057223:3372'})
  assert.equal(buscarCandidatos(IDX, 'Feijão').length, 0)
})

test('Listas: quantidade, status alternado, métricas e remoção em cascata', () => {
  let {estado: e, lista: f} = criarLista(ESTADO_INICIAL, 'Freguesia')
  let r = criarLista(e, 'Tijuca'); e = r.estado; const t = r.lista
  const it = criarItem(e, {nome: 'Sal', grupo: 'Insumos / Mercado'}); e = it.estado
  e = definirQuantidade(e, f.id, it.item.id, '03')
  e = definirQuantidade(e, t.id, it.item.id, '01')
  assert.deepEqual(metricas(e, [f.id, t.id]), {pendente: 2, comprado: 0, indisponivel: 0})
  e = alternarStatus(e, f.id, it.item.id, 'comprado')
  assert.equal(metricas(e, [f.id]).comprado, 1)
  e = alternarStatus(e, f.id, it.item.id, 'comprado')
  assert.equal(metricas(e, [f.id]).pendente, 1, 'tocar de novo volta para pendente')
  e = marcarItem(e, it.item.id, [f.id, t.id], 'indisponivel')
  assert.equal(metricas(e, [f.id, t.id]).indisponivel, 2)
  e = definirQuantidade(e, t.id, it.item.id, '  ')
  assert.equal(e.entradas.length, 1, 'quantidade vazia tira da lista')
  e = removerLista(e, f.id)
  assert.equal(e.entradas.length, 0)
  assert.equal(e.itens.length, 1, 'catálogo continua')
  e = removerItem(e, it.item.id)
  assert.equal(e.itens.length, 0)
})

test('Nova rodada: tudo pendente, preços de gôndola apagados', () => {
  let {estado: e, lista: f} = criarLista(ESTADO_INICIAL, 'Freguesia')
  const it = criarItem(e, {nome: 'Sal', grupo: 'Insumos / Mercado'}); e = it.estado
  e = definirQuantidade(e, f.id, it.item.id, '03')
  e = alternarStatus(e, f.id, it.item.id, 'comprado')
  e = registrarPesquisa(e, it.item.id, {preco: 2.39, qtd: 1, unidade: 'kg', em: 1})
  const n = novaRodada(e, true, '02/02/2026')
  assert.equal(n.entradas[0].status, 'pendente')
  assert.deepEqual(n.pesquisa, {})
  assert.equal(novaRodada(e, false, 'x').entradas.length, 0)
})

test('Importar 26/01: duas lojas, 31 itens, 35 entradas e relatório no formato antigo', () => {
  const e = importarLista2601(ESTADO_INICIAL)
  assert.deepEqual(e.listas.map(l => [l.nome, l.sigla]), [['Freguesia', 'F'], ['Tijuca', 'T']])
  assert.equal(e.itens.length, 31)
  assert.equal(e.entradas.length, 35)
  const de2 = importarLista2601(e)
  assert.equal(de2.itens.length, 31, 'reimportar não duplica')
  const tij = e.listas[1].id
  const txt = relatorio(e, [tij], 'tudo', 'THB – COMPRAS 26/01/2026')
  assert.equal(txt, [
    '*THB – COMPRAS 26/01/2026*', '', '*TIJUCA*', '', '*🥬 Hortifruti*',
    '⬜ 03 Alface Americana', '⬜ 04 Alface Crespa', '⬜ 03 kg Cebola Roxa', '⬜ 04 Rúcula'
  ].join('\n'))
})

test('Revisar descarta entradas órfãs do armazenamento', () => {
  const e = revisar({listas: [{id: 'a', nome: 'A'}], itens: [{id: 'i', nome: 'X'}], entradas: [{listaId: 'a', itemId: 'i'}, {listaId: 'b', itemId: 'i'}]})
  assert.equal(e.entradas.length, 1)
  assert.deepEqual(e.itens[0].vinculos, [])
  assert.deepEqual(revisar(null).listas, [])
})

test('Sincronizar: token recusado e resposta válida', async () => {
  const recusa = async () => new Response(JSON.stringify({message: 'token inválido'}), {status: 401})
  await assert.rejects(baixarSnapshot('x', recusa), e => e instanceof ErroSincronizacao && e.tipo === 'token')
  const semRede = async () => { throw new TypeError('offline') }
  await assert.rejects(baixarSnapshot('x', semRede), e => e.tipo === 'rede')
  let corpo
  const ok = async (_url, init) => { corpo = JSON.parse(init.body); return new Response(JSON.stringify(SNAP), {status: 200}) }
  const s = await baixarSnapshot(' tok ', ok)
  assert.equal(corpo.p_token, 'tok')
  assert.equal(s.obs.length, 6)
})
