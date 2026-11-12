import {criarItem, criarLista, definirQuantidade, atualizarLista, type EstadoCompras} from './estado.ts'
import type {Vinculo} from './precos.ts'
import type {Unidade} from './unidades.ts'

type Linha = [nome: string, freguesia: string, tijuca: string, vinculos: Vinculo[], embalagem?: [number, Unidade]]

const ins = (id: number): Vinculo => ({tipo: 'insumo', id})
const prod = (chave: string): Vinculo => ({tipo: 'produto', chave})

/**
 * Lista de 26/01/2026 (exportada do HTML usado no ChatGPT), com os vínculos aos insumos do
 * Saipos / produtos de NF-e já conferidos. Itens sem histórico (feijão, goiabada, tomate
 * italiano, frango do rancho) ficam sem vínculo até haver compra com nota.
 */
const LISTA_26_01: Record<string, Linha[]> = {
  'Embalagens': [
    ['Bobina Plástica (Porcionamento)', '03', '', [ins(4567065)], [1, 'un']]
  ],
  'Limpeza': [
    ['Água Sanitária / Cloro', '01', '', [ins(6171844), ins(4615269)], [5, 'l']],
    ['Detergente', '01', '', [ins(4591819)], [500, 'ml']],
    ['Esponja', '01', '', [ins(4614983)], [1, 'un']],
    ['Pano de Cozinha', '01', '', [ins(4567058)], [1, 'un']]
  ],
  'Rancho': [
    ['Açúcar Refinado', '02 kg', '', [ins(4614970)], [1, 'kg']],
    ['Café', '01 kg', '', [ins(4566972)], [500, 'g']],
    ['Farinha de Mandioca', '01 kg', '', [prod('06057223:69788')], [1, 'kg']],
    ['Feijão', '02 kg', '', [], [1, 'kg']],
    ['Frango Rancho', '04 kg', '', [], [1, 'kg']],
    ['Macarrão', '01 kg', '', [prod('06057223:1179650')], [500, 'g']]
  ],
  'Insumos / Mercado': [
    ['Farinha Panko', '01 kg', '', [ins(4614974)], [1, 'kg']],
    ['Frango Peito', '04 kg', '', [ins(4591809)], [1, 'kg']],
    ['Goiabada Pastosa (2,5 kg)', '04', '', [], [2.5, 'kg']],
    ['Leite em Pó (400 g)', '08', '', [ins(4614981)], [400, 'g']],
    ['Maionese (2,8 kg)', '06', '', [ins(4615267)], [2.8, 'kg']],
    ['Massa de Pastel (400 g)', '04', '', [ins(4591839)], [400, 'g']],
    ['Molho Inglês', '03 L', '', [ins(4614978)], [1.01, 'l']],
    ['Óleo (900 ml)', '60', '', [ins(5882787)], [1, 'un']],
    ['Polpa de Acerola', '20', '', [prod('06057223:73415')], [100, 'g']],
    ['Sal', '03', '', [ins(4591810)], [1, 'kg']]
  ],
  'Hortifruti': [
    ['Alface Americana', '03', '03', [ins(5567069)], [1, 'un']],
    ['Alface Crespa', '04', '04', [ins(5567071)], [1, 'un']],
    ['Cebola Branca', '03 kg', '', [ins(5882788)], [1, 'kg']],
    ['Cebola Roxa', '01 kg', '03 kg', [ins(6171843)], [1, 'kg']],
    ['Cenoura', '04', '', [ins(5882789)], [1, 'kg']],
    ['Couve', '01', '', [prod('06057223:3372')], [1, 'un']],
    ['Limão', '30', '', [ins(6774660)], [1, 'kg']],
    ['Rúcula', '04', '04', [ins(5567072)], [1, 'un']],
    ['Tomate Italiano', '09 kg', '', [], [1, 'kg']],
    ['Tomate Salada', '06 kg', '', [ins(4614982)], [1, 'kg']]
  ]
}

/**
 * Importa a lista de 26/01/2026 no estado: cria as listas Freguesia e Tijuca (se faltarem),
 * os itens do catálogo (sem duplicar pelo nome) e as quantidades de cada loja.
 * @param e estado atual
 */
export function importarLista2601(e: EstadoCompras): EstadoCompras {
  let s = e
  const lista = (nome: string, sigla: string) => {
    const existente = s.listas.find(l => l.nome.toLowerCase() === nome.toLowerCase())
    if (existente) return existente
    const r = criarLista(s, nome, 'loja')
    s = atualizarLista(r.estado, r.lista.id, {sigla})
    return s.listas.find(l => l.id === r.lista.id)!
  }
  const freguesia = lista('Freguesia', 'F')
  const tijuca = lista('Tijuca', 'T')
  for (const [grupo, linhas] of Object.entries(LISTA_26_01)) {
    for (const [nome, f, t, vinculos, emb] of linhas) {
      let item = s.itens.find(i => i.nome.toLowerCase() === nome.toLowerCase())
      if (!item) {
        const r = criarItem(s, {nome, grupo, vinculos, embalagem: emb ? {qtd: emb[0], unidade: emb[1]} : undefined})
        s = r.estado
        item = r.item
      }
      if (f) s = definirQuantidade(s, freguesia.id, item.id, f)
      if (t) s = definirQuantidade(s, tijuca.id, item.id, t)
    }
  }
  return {...s, rodadaNome: s.rodadaNome || '26/01/2026', rodadaDesde: s.rodadaDesde || Date.now()}
}
