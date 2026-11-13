import {
  atualizarLista, criarItem, criarLista, normalizar, separarUnidade, atualizarItem,
  type EstadoCompras, type Secao
} from './estado.ts'
import type {Vinculo} from './precos.ts'

const i = (...ids: number[]): Vinculo[] => ids.map(id => ({tipo: 'insumo', id}))
const p = (chave: string): Vinculo[] => [{tipo: 'produto', chave}]

/** [nome como na planilha, vínculos conferidos] */
type LinhaProducao = [string, Vinculo[]?]
/** [nome como na planilha, origem, vínculos conferidos] */
type LinhaBebidas = [string, string, Vinculo[]?]

/**
 * Modelo da planilha "Lista de compras Insumos/Bebidas", aba Insumos: só itens, unidades e
 * grupos (as quantidades da planilha não são importadas).
 * Vínculos só onde o insumo do Saipos / produto de NF-e é inequívoco; o resto é
 * sugerido automaticamente quando houver compra com NF-e.
 */
const PRODUCAO: Record<string, LinhaProducao[]> = {
  'Embalagens': [
    ['Bobina 80X40 (cx)'], ['Bobina de Alimentos (un)', i(4567065)],
    ['Copinho de café 50ml (fd)', p('06057223:1071154')], ['Copo Plástico 200ml (fd)'],
    ['Etiqueta de Validade (rolo)'], ['Grampo 26/6 (cx)'], ['Hamburgueira Batata TH03 (fd)'],
    ['Hamburgueira H02 (fd)', i(4632956)], ['Kraft P / G'], ['Pote de Molho C695 (cx)'],
    ['Papel Toalha', i(4567013)]
  ],
  'Limpeza': [
    ['Água Sanitária / Cloro (un)', i(6171844, 4615269)], ['Desinfetante (5L)'],
    ['Detergente (cx)', i(4591819)], ['Esponja Aço/Fibraço (un)', i(4615258)],
    ['Esponja Louça (un)', i(4614983)], ['Luva Reforçada (pct)'], ['Pano de Cozinha (un)', i(4567058)],
    ['Saco de Lixo 100L (fd)'], ['Saco de Lixo 200L (fd)']
  ],
  'Rancho': [
    ['Açúcar Refinado (kg)', i(4614970)], ['Arroz (5 kg)'], ['Batata Inglesa (kg)'],
    ['Café (kg)', i(4566972)], ['Carne Rancho (kg)'], ['Carré Rancho (kg)'],
    ['Extrato de Tomate (kg)'], ['Farinha de Mandioca (kg)', p('06057223:69788')], ['Feijão (kg)'],
    ['Frango Rancho (kg)'], ['Linguiça Toscana (kg)'], ['Macarrão (kg)', p('06057223:1179650')],
    ['Salsicha (kg)']
  ],
  'Insumos': [
    ['Alho (kg)', i(6710838)], ['Bacon Cubos (kg)', i(4615828)], ['Bacon Fatiado (kg)', i(4615830)],
    ['Batata Crinkle (kg)', i(4615831)], ['Caldo de Carne (kg)', i(6997378)], ['Caldo de Galinha (kg)', i(6997381)],
    ['Carne Moída (kg)', i(4591835)], ['Cerveja lata (fd)'], ['Chocolate forneável (kg)', i(6774679)],
    ['Creme de Leite (cx)', i(6314843)], ['Doce de Leite (kg)', i(4615263)], ['Extrato de Tomate (kg)'],
    ['Farinha de Trigo (kg)', i(4615261)], ['Farinha Panko (kg)', i(4614974)], ['Frango Peito (kg)', i(4591809)],
    ['Goiabada Pastosa (2,5 kg)'], ['Ketchup (3 kg)', i(4591825)], ['Leite em Pó (360g /400g)', i(4614981)],
    ['Linguiça Calabresa (2,5 kg)', i(5233036)], ['Maionese (kg)', i(4615267)], ['Massa de Pastel (400 g)', i(4591839)],
    ['Mel (L)', i(4614972)], ['Molho Inglês (L)', i(4614978)], ['Molho Shoyu (L)', i(4614969)],
    ['Mostarda (3 kg)', i(4591820)], ['Óleo Garrafa (900 ml)', i(5882787)], ['Onion Rings (kg)', i(4631343)],
    ['Polpa de Acerola (kg)', p('06057223:73415')], ['Sal (fd)', i(4591810)], ['Vinagre Balsâmico (L)'],
    ['Vinagre de Maçã (L)', i(4591821)], ['Vinagre de Álcool (L)', i(4591811)]
  ],
  'Hortifruti': [
    ['Alface Americana (un)', i(5567069)], ['Alface Crespa (un)', i(5567071)], ['Cebola Branca (kg)', i(5882788)],
    ['Cebola Roxa (kg)', i(6171843)], ['Cebolinha Industrial (un)', i(6997349)], ['Cenoura (un)', i(5882789)],
    ['Couve (un)', p('06057223:3372')], ['Couve-flor (un)'], ['Limão (un)', i(6774660)],
    ['Ovo (un)', i(5882790)], ['Pepino Japonês (kg)', i(4591833)], ['Pimentão Amarelo (un)'],
    ['Pimentão Vermelho (un)'], ['Rúcula (un)', i(5567072)], ['Salsa Industrial (un)', i(6997350)],
    ['Tomate Italiano (kg)'], ['Tomate Salada (kg)', i(4614982)]
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
 * A planilha é só referência de itens, unidades e grupos: nenhuma quantidade é copiada.
 * Cria as lojas THBT (Tijuca) e THBF (Freguesia), ambas nas duas seções.
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
  loja('Tijuca', 'THBT', ['producao', 'bebidas'])
  loja('Freguesia', 'THBF', ['producao', 'bebidas'])

  const garantir = (secao: Secao, grupo: string, texto: string, origem: string, vinculos: Vinculo[] = []) => {
    const {nome, unidade} = nomeEUnidade(texto)
    const ja = s.itens.find(x => x.secao === secao && x.grupo === grupo && normalizar(x.nome) === normalizar(nome) && (!x.unidade || normalizar(x.unidade) === normalizar(unidade)))
    if (ja) {
      s = atualizarItem(s, ja.id, {
        unidade: ja.unidade || unidade, origem: ja.origem || origem,
        vinculos: ja.vinculos.length ? ja.vinculos : vinculos
      })
      return
    }
    s = criarItem(s, {nome, unidade, secao, grupo, origem, vinculos}).estado
  }
  for (const [grupo, linhas] of Object.entries(PRODUCAO))
    for (const [texto, v] of linhas) garantir('producao', grupo, texto, 'Mercado', v)
  for (const [grupo, linhas] of Object.entries(BEBIDAS))
    for (const [texto, origem, v] of linhas) garantir('bebidas', grupo, texto, origem, v)
  return s
}

/** Quantos itens o modelo da planilha tem, por seção (para a tela inicial e os testes). */
export const TAMANHO_PLANILHA = {
  producao: Object.values(PRODUCAO).reduce((n, l) => n + l.length, 0),
  bebidas: Object.values(BEBIDAS).reduce((n, l) => n + l.length, 0)
}
