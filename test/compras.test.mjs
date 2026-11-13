import test from 'node:test'
import assert from 'node:assert/strict'
import {indexar, resumir, compararGondola, produtoPorGtin} from '../src/lib/compras/precos.ts'
import {buscarCandidatos} from '../src/lib/compras/vinculo.ts'
import {vinculosAutomaticos} from '../src/lib/compras/vinculo.ts'
import {
  ESTADO_INICIAL, criarLista, criarItem, definirQuantidade, alternarStatus, marcarItem, contar, entradasDaSecao,
  registrarPesquisa, relatorio, relatorioFechamento, removerItem, removerLista, revisar, separarUnidade, embalagemDaUnidade,
  fecharCompra, faltantesAbertos, incluirFaltantes, descartarFaltante, irPara, listasDaSecao, rotuloItem,
  qtdDecimal, ajustarQtd, lerQtd, formatarQtd
} from '../src/lib/compras/estado.ts'
import {importarPlanilha, TAMANHO_PLANILHA} from '../src/lib/compras/semente.ts'
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

test('Unidade da loja: separa do nome e vira embalagem quando é numérica', () => {
  assert.deepEqual(separarUnidade('Óleo Garrafa (900 ml)'), {nome: 'Óleo Garrafa', unidade: '900 ml'})
  assert.deepEqual(separarUnidade('Sprite (350 ml) (c/6)'), {nome: 'Sprite', unidade: '350 ml · c/6'})
  assert.deepEqual(separarUnidade('Kraft P / G'), {nome: 'Kraft P / G', unidade: ''})
  assert.deepEqual(embalagemDaUnidade('2,8 kg'), {qtd: 2.8, unidade: 'kg'})
  assert.deepEqual(embalagemDaUnidade('kg'), {qtd: 1, unidade: 'kg'})
  assert.deepEqual(embalagemDaUnidade('1,01L'), {qtd: 1.01, unidade: 'l'})
  assert.deepEqual(embalagemDaUnidade('350 ml · c/6'), {qtd: 350, unidade: 'ml'})
  assert.equal(embalagemDaUnidade('fd'), undefined)
  assert.equal(rotuloItem({nome: 'Sal', unidade: 'fd'}), 'Sal (fd)')
})

test('Planilha: só itens, unidades e grupos; nenhuma quantidade copiada', () => {
  const e = importarPlanilha(ESTADO_INICIAL)
  assert.deepEqual(listasDaSecao(e, 'producao').map(l => [l.nome, l.sigla]), [['Tijuca', 'THBT'], ['Freguesia', 'THBF']])
  assert.deepEqual(listasDaSecao(e, 'bebidas').map(l => l.sigla), ['THBT', 'THBF'])
  assert.equal(e.itens.filter(i => i.secao === 'producao').length, TAMANHO_PLANILHA.producao)
  assert.equal(e.itens.filter(i => i.secao === 'bebidas').length, TAMANHO_PLANILHA.bebidas)
  assert.equal(e.entradas.length, 0)
  assert.ok(e.itens.every(i => Object.keys(i.ultimaQtd).length === 0), 'sem sugestão vinda da planilha')
  assert.equal(e.itens.find(i => i.nome === 'Óleo Garrafa').unidade, '900 ml')
  assert.equal(e.itens.find(i => i.nome === 'Coca').unidade, '1,5 L')
  assert.equal(e.itens.find(i => i.nome === 'Heineken' && i.unidade === '600 ml').origem, 'Byll')
  assert.equal(importarPlanilha(e).itens.length, e.itens.length, 'reimportar não duplica')
})

test('Quantidade: kg e L com 3 casas, demais inteiros; zero tira da lista', () => {
  assert.equal(qtdDecimal({unidade: 'kg'}), true)
  assert.equal(qtdDecimal({unidade: 'L'}), true)
  assert.equal(qtdDecimal({unidade: '2,8 kg'}), false, 'balde de 2,8 kg conta baldes')
  assert.equal(qtdDecimal({unidade: '900 ml'}), false)
  assert.equal(ajustarQtd({unidade: 'kg'}, 1.23456), 1.235)
  assert.equal(ajustarQtd({unidade: 'un'}, 2.6), 3)
  assert.equal(ajustarQtd({unidade: 'fd'}, -1), 0)
  assert.equal(lerQtd('1,5'), 1.5)
  assert.equal(lerQtd('1 (veja)'), 0)
  assert.equal(formatarQtd(1.5), '1,5')
  let e = importarPlanilha(ESTADO_INICIAL)
  const [tij] = listasDaSecao(e, 'producao')
  const cebola = e.itens.find(i => i.nome === 'Cebola Branca').id
  const oleo = e.itens.find(i => i.nome === 'Óleo Garrafa').id
  e = definirQuantidade(e, tij.id, cebola, 2.5)
  e = definirQuantidade(e, tij.id, oleo, 2.5)
  assert.deepEqual(e.entradas.map(x => x.quantidade), [2.5, 3])
  e = definirQuantidade(e, tij.id, oleo, 0)
  assert.equal(e.entradas.length, 1)
})

test('Ciclo completo: montar, comprar, fechar levando faltantes para a próxima lista', () => {
  let e = importarPlanilha(ESTADO_INICIAL)
  const [tij, fre] = listasDaSecao(e, 'producao')
  const id = n => e.itens.find(i => i.nome === n && i.secao === 'producao').id
  const rucula = id('Rúcula'), oleo = id('Óleo Garrafa'), sal = id('Sal')
  e = definirQuantidade(e, tij.id, rucula, 3)
  e = definirQuantidade(e, fre.id, rucula, 3)
  e = definirQuantidade(e, fre.id, oleo, 40)
  e = definirQuantidade(e, fre.id, sal, 1)
  e = irPara(e, 'producao', 'comprar', '12/11/2026')
  assert.equal(e.ciclos.producao.nome, '12/11/2026')
  e = alternarStatus(e, fre.id, oleo, 'comprado')
  e = alternarStatus(e, tij.id, rucula, 'indisponivel')
  e = alternarStatus(e, fre.id, rucula, 'indisponivel')
  assert.deepEqual(contar(entradasDaSecao(e, 'producao')), {pendente: 1, comprado: 1, indisponivel: 2})
  const levar = [{itemId: rucula, listaId: tij.id}, {itemId: rucula, listaId: fre.id}]
  const txt = relatorioFechamento(e, 'producao', levar)
  assert.match(txt, /COMPRA FINALIZADA PRODUÇÃO/)
  assert.match(txt, /✅ 1 comprados · ❌ 2 em falta · ⬜ 1 sem marcar/)
  assert.match(txt, /❌ 3 · Rúcula \(un\)/)
  assert.doesNotMatch(txt, /Sal/, 'sal sem marcar não foi levado')
  e = fecharCompra(e, 'producao', levar)
  assert.equal(entradasDaSecao(e, 'producao').length, 0)
  assert.equal(e.ciclos.producao.etapa, 'montar')
  assert.equal(e.historico[0].itens.length, 4)
  assert.equal(e.itens.find(i => i.id === oleo).ultimaQtd[fre.id], 40, 'última quantidade vem da compra real')
  const abertos = faltantesAbertos(e, 'producao')
  assert.deepEqual(abertos.map(f => [f.quantidade, f.desde]), [[3, '12/11/2026'], [3, '12/11/2026']])
  e = incluirFaltantes(e, [abertos[0]])
  assert.equal(e.entradas[0].herdada, '12/11/2026')
  e = descartarFaltante(e, abertos[1])
  assert.equal(faltantesAbertos(e, 'producao').length, 0)
  e = alternarStatus(e, abertos[0].listaId, rucula, 'comprado')
  e = fecharCompra(e, 'producao', [])
  assert.equal(e.faltantes.length, 0, 'comprado sai da lista de faltantes')
})

test('Seções independentes, as duas com THBT e THBF', () => {
  let e = importarPlanilha(ESTADO_INICIAL)
  const [tij, fre] = listasDaSecao(e, 'bebidas')
  const coca = e.itens.find(i => i.nome === 'Coca-Cola').id
  const alho = e.itens.find(i => i.nome === 'Alho').id
  e = definirQuantidade(e, fre.id, coca, 2)
  e = definirQuantidade(e, tij.id, coca, 1)
  e = definirQuantidade(e, fre.id, alho, 4)
  e = irPara(e, 'bebidas', 'comprar', 'x')
  e = fecharCompra(e, 'producao', [])
  assert.equal(entradasDaSecao(e, 'bebidas').length, 2)
  assert.equal(e.ciclos.bebidas.etapa, 'comprar')
  const r = relatorio(e, 'bebidas', 'tudo')
  assert.match(r, /🥤 \*THB · COMPRAS BEBIDAS E SALÃO\* · x/)
  assert.match(r, /⬜ 2 · Coca-Cola \(310 ml\)/)
})

test('Migração: v1 e v2 viram v3 com quantidades numéricas, siglas THBT/THBF e sem sugestões da planilha', () => {
  const v1 = {versao: 1, listas: [{id: 'a', nome: 'Tijuca', sigla: 'T', ordem: 0}], itens: [{id: 'i', nome: 'Maionese (2,8 kg)', grupo: 'Insumos / Mercado', vinculos: []}],
    entradas: [{listaId: 'a', itemId: 'i', quantidade: '6', status: 'comprado'}, {listaId: 'b', itemId: 'i'}], pesquisa: {}, rodadaNome: '26/01/2026'}
  const e = revisar(v1)
  assert.equal(e.versao, 3)
  assert.deepEqual([e.itens[0].nome, e.itens[0].unidade, e.itens[0].grupo, e.itens[0].secao], ['Maionese', '2,8 kg', 'Insumos', 'producao'])
  assert.deepEqual([e.listas[0].sigla, e.listas[0].secoes], ['THBT', ['producao', 'bebidas']])
  assert.deepEqual(e.entradas.map(x => x.quantidade), [6])
  assert.deepEqual(e.ciclos.producao, {etapa: 'comprar', nome: '26/01/2026', desde: 0})
  const v2 = {versao: 2, listas: [{id: 'f', nome: 'Freguesia', sigla: 'F', secoes: ['producao']}],
    itens: [{id: 'd', nome: 'Desinfetante', unidade: '5L', secao: 'producao', grupo: 'Limpeza', vinculos: [], ultimaQtd: {f: '1 (veja)'}}],
    entradas: [{listaId: 'f', itemId: 'd', quantidade: '1 (veja)', status: 'pendente'}], ciclos: {}}
  const e2 = revisar(v2)
  assert.deepEqual(e2.itens[0].ultimaQtd, {})
  assert.deepEqual(e2.entradas.map(x => x.quantidade), [1], 'texto livre vira 1')
  assert.deepEqual([e2.listas[0].sigla, e2.listas[0].secoes], ['THBF', ['producao', 'bebidas']])
  assert.equal(revisar(e2).listas[0].sigla, 'THBF', 'v3 não é migrada de novo')
  assert.deepEqual(revisar(null).listas, [])
})

test('Remover lista e item limpa entradas e faltantes', () => {
  let {estado: e, lista} = criarLista(ESTADO_INICIAL, 'Casa', 'pessoal', ['producao'])
  const r = criarItem(e, {nome: 'Sabão', secao: 'producao', grupo: 'Limpeza', unidade: 'un'}); e = r.estado
  e = definirQuantidade(e, lista.id, r.item.id, 2)
  e = fecharCompra(e, 'producao', [{itemId: r.item.id, listaId: lista.id}])
  assert.equal(e.faltantes.length, 1)
  assert.equal(removerItem(e, r.item.id).faltantes.length, 0)
  assert.equal(removerLista(e, lista.id).faltantes.length, 0)
  e = registrarPesquisa(e, r.item.id, {preco: 3, qtd: 1, unidade: 'un', em: 1})
  assert.equal(Object.keys(removerItem(e, r.item.id).pesquisa).length, 0)
  assert.equal(marcarItem(definirQuantidade(e, lista.id, r.item.id, 1), r.item.id, 'comprado').entradas[0].status, 'comprado')
})

test('Vínculo automático só quando inequívoco e com compra; respeita recusa', () => {
  const auto = vinculosAutomaticos(IDX, [
    {id: 'a', nome: 'Maionese', vinculos: []},
    {id: 'b', nome: 'Couve', vinculos: []},
    {id: 'c', nome: 'Feijão', vinculos: []},
    {id: 'd', nome: 'Maionese', vinculos: [], vinculoAuto: false},
    {id: 'e', nome: 'Maionese', vinculos: [{tipo: 'insumo', id: 1}]}
  ])
  assert.deepEqual(auto, [
    {itemId: 'a', vinculo: {tipo: 'insumo', id: 4615267}},
    {itemId: 'b', vinculo: {tipo: 'produto', chave: '06057223:3372'}}
  ])
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
