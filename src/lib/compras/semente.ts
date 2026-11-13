import {
  atualizarLista, criarItem, criarLista, normalizar, separarUnidade, atualizarItem,
  type EstadoCompras, type Secao
} from './estado.ts'
import type {Vinculo} from './precos.ts'

const i = (...ids: number[]): Vinculo[] => ids.map(id => ({tipo: 'insumo', id}))
const p = (chave: string): Vinculo[] => [{tipo: 'produto', chave}]

/** [nome como na planilha, qtd Tijuca, qtd Freguesia, vínculos conferidos] */
type LinhaProducao = [string, string, string, Vinculo[]?]
/** [nome como na planilha, origem, vínculos conferidos] */
type LinhaBebidas = [string, string, Vinculo[]?]

/**
 * Modelo da planilha "Lista de compras Insumos/Bebidas", aba Insumos. As quantidades
 * da planilha entram como "última quantidade" (sugestão), não como lista pronta.
 * Vínculos só onde o insumo do Saipos / produto de NF-e é inequívoco; o resto é
 * sugerido automaticamente quando houver compra com NF-e.
 */
const PRODUCAO: Record<string, LinhaProducao[]> = {
  'Embalagens': [
    ['Bobina 80X40 (cx)', '', '3'], ['Bobina de Alimentos (un)', '4 (M) / 1 (G)', '', i(4567065)],
    ['Copinho de café 50ml (fd)', '', '', p('06057223:1071154')], ['Copo Plástico 200ml (fd)', '', ''],
    ['Etiqueta de Validade (rolo)', '', ''], ['Grampo 26/6 (cx)', '', ''], ['Hamburgueira Batata TH03 (fd)', '', '100'],
    ['Hamburgueira H02 (fd)', '', '300', i(4632956)], ['Kraft P / G', '', '700 (G)'], ['Pote de Molho C695 (cx)', '', ''],
    ['Papel Toalha', '1', '', i(4567013)]
  ],
  'Limpeza': [
    ['Água Sanitária / Cloro (un)', '', '2', i(6171844, 4615269)], ['Desinfetante (5L)', '1 (veja)', ''],
    ['Detergente (cx)', '', '', i(4591819)], ['Esponja Aço/Fibraço (un)', '', '2', i(4615258)],
    ['Esponja Louça (un)', '1', '2', i(4614983)], ['Luva Reforçada (pct)', '1', ''], ['Pano de Cozinha (un)', '', '', i(4567058)],
    ['Saco de Lixo 100L (fd)', '', ''], ['Saco de Lixo 200L (fd)', '1', '']
  ],
  'Rancho': [
    ['Açúcar Refinado (kg)', '', '2', i(4614970)], ['Arroz (5 kg)', '', '1'], ['Batata Inglesa (kg)', '', '1,5'],
    ['Café (kg)', '1', '2', i(4566972)], ['Carne Rancho (kg)', '', ''], ['Carré Rancho (kg)', '', '3'],
    ['Extrato de Tomate (kg)', '', '1'], ['Farinha de Mandioca (kg)', '', '1', p('06057223:69788')], ['Feijão (kg)', '', '1'],
    ['Frango Rancho (kg)', '', '3'], ['Linguiça Toscana (kg)', '', '1'], ['Macarrão (kg)', '', '1 (parafuso)', p('06057223:1179650')],
    ['Salsicha (kg)', '', '1']
  ],
  'Insumos': [
    ['Alho (kg)', '', '4', i(6710838)], ['Bacon Cubos (kg)', '', '', i(4615828)], ['Bacon Fatiado (kg)', '', '', i(4615830)],
    ['Batata Crinkle (kg)', '', '', i(4615831)], ['Caldo de Carne (kg)', '', '1', i(6997378)], ['Caldo de Galinha (kg)', '', '1', i(6997381)],
    ['Carne Moída (kg)', '', '', i(4591835)], ['Cerveja lata (fd)', '', ''], ['Chocolate forneável (kg)', '', '', i(6774679)],
    ['Creme de Leite (cx)', '', '1', i(6314843)], ['Doce de Leite (kg)', '', '', i(4615263)], ['Extrato de Tomate (kg)', '', ''],
    ['Farinha de Trigo (kg)', '3', '1', i(4615261)], ['Farinha Panko (kg)', '1', '4', i(4614974)], ['Frango Peito (kg)', '', '8', i(4591809)],
    ['Goiabada Pastosa (2,5 kg)', '', '2'], ['Ketchup (3 kg)', '', '', i(4591825)], ['Leite em Pó (360g /400g)', '1', '7', i(4614981)],
    ['Linguiça Calabresa (2,5 kg)', '', '1', i(5233036)], ['Maionese (kg)', '', '15', i(4615267)], ['Massa de Pastel (400 g)', '15', '6', i(4591839)],
    ['Mel (L)', '', '', i(4614972)], ['Molho Inglês (L)', '', '', i(4614978)], ['Molho Shoyu (L)', '', '', i(4614969)],
    ['Mostarda (3 kg)', '', '', i(4591820)], ['Óleo Garrafa (900 ml)', '40', '40', i(5882787)], ['Onion Rings (kg)', '', '', i(4631343)],
    ['Polpa de Acerola (kg)', '', '20', p('06057223:73415')], ['Sal (fd)', '', '1', i(4591810)], ['Vinagre Balsâmico (L)', '', '4'],
    ['Vinagre de Maçã (L)', '', '', i(4591821)], ['Vinagre de Álcool (L)', '', '', i(4591811)]
  ],
  'Hortifruti': [
    ['Alface Americana (un)', '2', '', i(5567069)], ['Alface Crespa (un)', '3', '3', i(5567071)], ['Cebola Branca (kg)', '3', '', i(5882788)],
    ['Cebola Roxa (kg)', '1', '4', i(6171843)], ['Cebolinha Industrial (un)', '', '6', i(6997349)], ['Cenoura (un)', '', '4', i(5882789)],
    ['Couve (un)', '', '1', p('06057223:3372')], ['Couve-flor (un)', '', '1 (grande)'], ['Limão (un)', '', '', i(6774660)],
    ['Ovo (un)', '', '30', i(5882790)], ['Pepino Japonês (kg)', '', '3,5', i(4591833)], ['Pimentão Amarelo (un)', '', ''],
    ['Pimentão Vermelho (un)', '', ''], ['Rúcula (un)', '3', '3', i(5567072)], ['Salsa Industrial (un)', '', '4', i(6997350)],
    ['Tomate Italiano (kg)', '', '6'], ['Tomate Salada (kg)', '1,5', '3', i(4614982)]
  ]
}

/** Aba Bebidas da planilha: quantidade única e origem de compra. */
const BEBIDAS: Record<string, LinhaBebidas[]> = {
  'Salão': [
    ['Bobina 80X40 (cx)', 'Kalunga'], ['Grampo 26/6 (cx)', 'Kalunga'], ['Álcool 70 (1L)', 'Mercado', i(4591831)], ['Bobina Stone', 'Stone'],
    ['Canudo (c/ 1000)', 'SuperPreço'], ['Copinho de café 50ml (fd)', 'Mercado', p('06057223:1071154')], ['Desinfetante (5L)', 'Mercado'],
    ['Guardanapo (fd)', 'Mercado'], ['Ketchup Sachet (cx)', 'Mercado', i(4568062)], ['Maionese Sachet (cx)', 'Mercado'],
    ['Mostarda Sachet (cx)', 'Mercado'], ['Pano de Mesa (fd)', 'Mercado'], ['Papel Higiênico (30m)', 'Mercado'],
    ['Papel Toalha Lavabo', 'Mercado'], ['Pedra Sanitária / Bom Ar', 'Mercado'], ['Sabonete Líquido (5L)', 'Mercado'],
    ['Saco de Lixo (30L)', 'Mercado'], ['Sacola de Bebida (fd)', 'SuperPreço', i(4632955)], ['Sal Sachet (cx)', 'Mercado']
  ],
  'Refrigerantes': [
    ['Água com Gás (500 ml)', 'Mercado', i(4566955)], ['Água sem Gás (500 ml)', 'Mercado', i(4566957)],
    ['Coca-Cola (310 ml)', 'Mercado', i(4566961)], ['Coca-Cola Zero (310 ml)', 'Mercado', i(4566956)],
    ['Del Valle Manga (310 ml)', 'Mercado'], ['Del Valle Maracujá (310 ml)', 'Mercado'], ['Del Valle Pêssego (310 ml)', 'Mercado'],
    ['Del Valle Uva (310 ml)', 'Mercado'], ['Fanta Laranja (350 ml) (c/6)', 'Mercado', i(5817666)], ['Fanta Uva (350 ml) (c/6)', 'Mercado'],
    ['Guaraná Antarctica (350 ml)', 'Mercado', i(4566966)], ['Guaraná Antarctica Zero (350 ml)', 'Mercado', i(4567005)],
    ['Guaraviton (500 ml)', 'Mercado', i(4566999)], ['H2Oh! Limão (500 ml)', 'Mercado'], ['H2Oh! Limoneto (500 ml)', 'Mercado'],
    ['Lipton Limão (500 ml)', 'Mercado'], ['Lipton Pêssego (500 ml)', 'Mercado'], ['Leão Limão (300 ml)', 'Mercado', i(5381863)],
    ['Leão Pêssego (300 ml)', 'Mercado', i(6997299)], ['Matte Limão (300 ml)', 'Mercado', i(4566959)], ['Matte Natural (300 ml)', 'Mercado'],
    ['Pepsi (310 ml)', 'Mercado'], ['Schweppes Citrus (350 ml)', 'Mercado'], ['Schweppes Tônica (350 ml)', 'Mercado'],
    ['Sprite (350 ml) (c/6)', 'Mercado'], ['Tônica Antarctica (350 ml)', 'Mercado']
  ],
  'Litros': [
    ['Coca 1,5 L', 'Mercado', i(4566973)], ['Coca Zero 1,5 L', 'Mercado', i(5425335)], ['Pepsi 1,5 L', 'Mercado'],
    ['Guaraná 1,5 L', 'Mercado', i(4566969)], ['Lipton Limão 1,5 L', 'Mercado'], ['Lipton Pêssego 1,5 L', 'Mercado'],
    ['Leão Ice Tea Limão 1,5 L', 'Mercado'], ['Leão Ice Tea Pêssego 1,5 L', 'Mercado', i(5992594)]
  ],
  'Cervejas': [
    ['Brahma Chopp (473 ml)', 'Byll'], ['Brahma Duplo Malte (350 ml)', 'Byll'], ['Budweiser (330 ml)', 'Byll'],
    ['Corona Extra (330 ml)', 'Byll'], ['Eisenbahn (330 ml)', 'Byll'], ['Heineken (330 ml)', 'Byll'], ['Heineken (600 ml)', 'Byll'],
    ['Stella Artois (330 ml)', 'Byll']
  ]
}

/** "Coca 1,5 L" não tem parênteses: a unidade é o volume no fim do nome. */
function nomeEUnidade(texto: string): {nome: string, unidade: string} {
  const s = separarUnidade(texto)
  if (s.unidade) return s
  const m = s.nome.match(/^(.*\S)\s+(\d+(?:,\d+)?\s*(?:L|ml|kg|g))$/i)
  return m ? {nome: m[1], unidade: m[2]} : s
}

/**
 * Importa o modelo da planilha. Mantém listas e itens já existentes (casando por nome,
 * unidade e grupo dentro da seção) e só completa unidade, origem, vínculos e sugestões que faltarem.
 * Cria as lojas Tijuca e Freguesia se não existirem: ambas em produção; bebidas/salão só na
 * Freguesia, que é a loja com salão (a Tijuca é cozinha de delivery) — ajustável em Lojas.
 * @param e estado atual
 */
export function importarPlanilha(e: EstadoCompras): EstadoCompras {
  let s = e
  const loja = (nome: string, sigla: string, secoes: Secao[]) => {
    const ja = s.listas.find(l => normalizar(l.nome) === normalizar(nome))
    if (ja) return ja
    const r = criarLista(s, nome, 'loja', secoes)
    s = atualizarLista(r.estado, r.lista.id, {sigla})
    return s.listas.find(l => l.id === r.lista.id)!
  }
  const tijuca = loja('Tijuca', 'T', ['producao'])
  const freguesia = loja('Freguesia', 'F', ['producao', 'bebidas'])

  const garantir = (secao: Secao, grupo: string, texto: string, origem: string, vinculos: Vinculo[] = [], ultima: Record<string, string> = {}) => {
    const {nome, unidade} = nomeEUnidade(texto)
    const ja = s.itens.find(x => x.secao === secao && x.grupo === grupo && normalizar(x.nome) === normalizar(nome) && (!x.unidade || normalizar(x.unidade) === normalizar(unidade)))
    const sugestao = Object.fromEntries(Object.entries(ultima).filter(([, q]) => q))
    if (ja) {
      s = atualizarItem(s, ja.id, {
        unidade: ja.unidade || unidade, origem: ja.origem || origem,
        vinculos: ja.vinculos.length ? ja.vinculos : vinculos, ultimaQtd: {...sugestao, ...ja.ultimaQtd}
      })
      return
    }
    const r = criarItem(s, {nome, unidade, secao, grupo, origem, vinculos})
    s = atualizarItem(r.estado, r.item.id, {ultimaQtd: sugestao})
  }
  for (const [grupo, linhas] of Object.entries(PRODUCAO))
    for (const [texto, t, f, v] of linhas) garantir('producao', grupo, texto, 'Mercado', v, {[tijuca.id]: t, [freguesia.id]: f})
  for (const [grupo, linhas] of Object.entries(BEBIDAS))
    for (const [texto, origem, v] of linhas) garantir('bebidas', grupo, texto, origem, v)
  return s
}

/** Quantos itens o modelo da planilha tem, por seção (para a tela inicial e os testes). */
export const TAMANHO_PLANILHA = {
  producao: Object.values(PRODUCAO).reduce((n, l) => n + l.length, 0),
  bebidas: Object.values(BEBIDAS).reduce((n, l) => n + l.length, 0)
}
