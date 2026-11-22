/**
 * Fichas técnicas da produção (molhos, maioneses, temperos), transcritas do documento
 * "[THBF] Fichas Técnicas - 2026". As quantidades ficam na unidade em que a ficha foi escrita,
 * para o cozinheiro digitar exatamente o que lê na balança ou no medidor.
 */
import type {Unidade} from '../compras/unidades.ts'

export interface Ingrediente {
  /** Identificador estável dentro da receita (usado como chave do que foi digitado). */
  id: string
  nome: string
  qtd: number
  unidade: Unidade
  /** Referência prática da ficha, ex.: "3 unidades". */
  obs?: string
}

export interface Receita {
  id: string
  numero: number
  nome: string
  ingredientes: Ingrediente[]
  rendimento: {qtd: number, unidade: Unidade}
  /** Validade do cabeçalho da ficha, em dias; ausente quando a ficha não informa. */
  validadeDias?: number
}

type Linha = [nome: string, qtd: number, unidade: Unidade, obs?: string]

/**
 * Gera um identificador a partir do nome: minúsculas, sem acento, com hífens.
 * @param texto nome da receita ou do ingrediente
 */
export function slug(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/**
 * Monta uma receita a partir das linhas da ficha.
 * @param numero número da ficha no documento
 * @param nome nome da receita
 * @param rendimento rendimento [quantidade, unidade]
 * @param validadeDias validade em dias (undefined se a ficha não traz)
 * @param linhas ingredientes
 */
function ficha(numero: number, nome: string, rendimento: [number, Unidade], validadeDias: number | undefined, linhas: Linha[]): Receita {
  const usados = new Set<string>()
  const ingredientes = linhas.map(([n, qtd, unidade, obs]) => {
    let id = slug(n)
    while (usados.has(id)) id += '-2'
    usados.add(id)
    return {id, nome: n, qtd, unidade, ...(obs ? {obs} : {})}
  })
  return {id: slug(nome), numero, nome, ingredientes, rendimento: {qtd: rendimento[0], unidade: rendimento[1]}, ...(validadeDias ? {validadeDias} : {})}
}

export const RECEITAS: Receita[] = [
  ficha(1, 'Barbecue', [12, 'kg'], 5, [
    ['Açafrão em Pó', 211, 'g'], ['Água', 100, 'ml'], ['Amido de Milho', 100, 'g'], ['Caldo de Carne', 302, 'g'],
    ['Chilli em Pó', 137, 'g'], ['Fumaça Líquida', 300, 'ml'], ['Goiabada Pastosa', 5, 'kg'], ['Molho Inglês', 300, 'ml'],
    ['Mostarda', 3, 'kg'], ['Sal', 150, 'g'], ['Tomate Pelati', 2.59, 'kg'], ['Vinagre de Maçã', 2.47, 'l']
  ]),
  ficha(2, 'Base Vegana', [1.1, 'kg'], 12, [
    ['Alho Batido', 50, 'g'], ['Capim Limão', 100, 'g'], ['Limão', 1, 'un'], ['Molho Inglês', 500, 'ml'], ['Shoyu', 250, 'ml']
  ]),
  ficha(3, 'Calabrese', [4.763, 'kg'], 7, [
    ['Calabresa', 1.234, 'kg'], ['Cebola Roxa', 564, 'g', '3 unidades'], ['Maionese', 2.8, 'kg'], ['Molho Inglês', 250, 'ml'], ['Orégano', 10, 'g']
  ]),
  ficha(4, 'Cebola Caramelizada na Cerveja', [2.055, 'kg'], 5, [
    ['Açúcar Mascavo', 350, 'g'], ['Cebola Branca', 1.89, 'kg'], ['Cerveja', 946, 'ml'], ['Molho Inglês', 300, 'ml'], ['Molho Shoyu', 200, 'ml']
  ]),
  ficha(5, 'Cheddar Cremoso', [10.967, 'kg'], 12, [
    ['Água', 5, 'l'], ['Cheddar Fatiado', 6.081, 'kg', '3 peças'], ['Creme de Leite', 800, 'g'], ['Leite em Pó', 400, 'g']
  ]),
  ficha(6, 'Compota de Bacon', [7.532, 'kg'], 12, [
    ['Açúcar Mascavo', 651, 'g'], ['Alho Batido', 100, 'g'], ['Bacon em Cubos', 5, 'kg'], ['Chilli em Pó', 100, 'g'],
    ['Ketchup', 2, 'kg'], ['Tomate Pelati', 2.033, 'kg'], ['Vinagre Balsâmico', 1.5, 'l']
  ]),
  ficha(7, 'Creme de Gorgonzola', [3, 'kg'], undefined, [
    ['Água', 1, 'l'], ['Amido de Milho', 100, 'g'], ['Creme de Leite', 400, 'g'], ['Gorgonzola', 1.5, 'kg'], ['Leite em Pó', 200, 'g']
  ]),
  ficha(8, 'Ketchup Picante', [2, 'kg'], 12, [
    ['Chilli em Pó', 80, 'g'], ['Ketchup', 2, 'kg'], ['Páprica Picante', 80, 'g']
  ]),
  ficha(9, 'Ketstarda', [2.453, 'kg'], 5, [
    ['Açúcar Cristal', 100, 'g'], ['Ketchup', 1, 'kg'], ['Mostarda', 1.5, 'kg'], ['Páprica Defumada', 100, 'g'], ['Páprica Picante', 100, 'g']
  ]),
  ficha(10, 'Maionese de Alho com Lemon Pepper', [2.615, 'kg'], 3, [
    ['Água', 500, 'ml'], ['Leite em Pó', 100, 'g'], ['Lemon Pepper', 100, 'g'], ['Óleo', 1.8, 'l']
  ]),
  ficha(11, 'Maionese de Cebola Roxa', [2.49, 'kg'], 3, [
    ['Cebola Roxa', 860, 'g', '± 3 unidades'], ['Maionese', 1.58, 'kg'], ['Pimenta Verde em Conserva', 50, 'g']
  ]),
  ficha(12, 'Maionese Clássica', [2.69, 'kg'], 5, [
    ['Alho', 100, 'g'], ['Cream Cheese', 400, 'g'], ['Ketchup', 400, 'g'], ['Mix de Legumes em Conserva', 600, 'g'], ['Maionese', 1.2, 'kg']
  ]),
  ficha(13, 'Maionese de Bacon', [4.296, 'kg'], 5, [
    ['Bacon Cubo ou Fatiado', 1, 'kg'], ['Cebola Roxa', 880, 'g', 'aprox. 3 unidades'], ['Maionese', 3, 'kg']
  ]),
  ficha(14, 'Maionese de Cebolinha', [3.78, 'kg'], 5, [
    ['Alcaparras (sem água)', 150, 'g'], ['Maionese', 3, 'kg'], ['Pasta de Alho', 80, 'g'], ['Salsa e Cebolinha', 647, 'g', '2 salsas / 3 cebolinhas']
  ]),
  ficha(15, 'Maionese de Leite', [1.314, 'kg'], 5, [
    ['Água', 400, 'ml'], ['Leite em Pó', 100, 'g'], ['Óleo', 900, 'ml']
  ]),
  ficha(16, 'Maionese de Tomate Seco', [2, 'kg'], 5, [
    ['Caldo de Galinha', 50, 'g'], ['Maionese', 1.5, 'kg'], ['Tomate Seco', 200, 'g']
  ]),
  ficha(17, 'Maionese Defumada', [2.085, 'kg'], 5, [
    ['Alho', 200, 'g'], ['Caldo de Galinha', 55, 'g'], ['Fumaça Líquida', 300, 'g'], ['Maionese', 1.5, 'kg'], ['Pimenta Preta Moída', 30, 'g']
  ]),
  ficha(18, 'Maionese Vegana', [500, 'g'], 5, [
    ['Base Vegana', 250, 'ml'], ['Leite de Soja', 80, 'g'], ['Óleo', 500, 'ml']
  ]),
  ficha(19, 'Maionese Verde', [670, 'g'], 3, [
    ['Alho', 30, 'g'], ['Caldo de Carne', 2, 'g'], ['Cebola Roxa', 25, 'g'], ['Óleo', 900, 'ml'], ['Orégano', 1, 'g'],
    ['Ovos', 3, 'un'], ['Sal', 7, 'g'], ['Salsa', 24, 'g']
  ]),
  ficha(20, 'Mostarda e Mel', [1.523, 'kg'], 12, [
    ['Mel', 530, 'g'], ['Mostarda Amarela', 1, 'kg']
  ]),
  ficha(21, 'Picles de Pepino em Conserva', [4.828, 'kg'], 30, [
    ['Água', 600, 'ml'], ['Coentro em Grãos', 100, 'g'], ['Pepino Japonês', 2.918, 'kg'], ['Sal', 280, 'g', '6 colheres rasas'], ['Vinagre de Maçã', 1.5, 'l']
  ]),
  ficha(22, 'Sal da Batata', [1.5, 'kg'], 30, [
    ['Páprica Defumada', 250, 'g'], ['Páprica Picante', 250, 'g'], ['Sal', 1, 'kg']
  ]),
  ficha(23, 'Sal da Carne', [1.5, 'kg'], 30, [
    ['Coentro em Pó', 250, 'g'], ['Pimenta do Reino Moída', 250, 'g'], ['Sal', 1, 'kg']
  ]),
  ficha(24, 'Tempero do Bogwing', [843, 'g'], 10, [
    ['Água', 300, 'ml'], ['Alho Batido', 50, 'g'], ['Caldo de Galinha', 65, 'g'], ['Cerveja', 473, 'ml']
  ]),
  ficha(25, 'Maionese de Cerveja', [1503, 'g'], 10, [
    ['Cerveja', 473, 'ml'], ['Caldo de Carne', 30, 'g'], ['Maionese', 1, 'kg'], ['Cebola Roxa', 1, 'un']
  ]),
  ficha(26, 'Farofa de Bacon', [2520, 'g'], 10, [
    ['Farinha Panko', 500, 'g'], ['Caldo de Carne', 20, 'g'], ['Bacon Cubo', 1, 'kg'], ['Cebola Roxa', 1, 'un']
  ]),
  ficha(27, 'Ketchup de Acerola', [1825, 'g'], 10, [
    ['Polpa de Acerola', 800, 'g'], ['Tomate', 1, 'un'], ['Pasta de Alho', 100, 'g'], ['Cebola Roxa', 1, 'un'], ['Água', 100, 'ml'],
    ['Páprica Picante', 15, 'g'], ['Açúcar Mascavo', 350, 'g'], ['Vinagre de Maçã', 300, 'ml'], ['Amido de Milho', 60, 'g']
  ])
]
