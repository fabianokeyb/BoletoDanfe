/**
 * Funcionários autorizados a registrar produção. Lista fixa até existir a tela de cadastro;
 * em ordem alfabética para o seletor.
 */
export const FUNCIONARIOS: readonly string[] = [
  'Jessica Ferreira',
  'Larissa Raiane',
  'Lucas Dodaro',
  'Rita de Cássia',
  'Wagner Moreira'
]

/**
 * Indica se o nome é de um funcionário autorizado.
 * @param nome nome escolhido
 */
export function autorizado(nome: string): boolean {
  return FUNCIONARIOS.includes(nome)
}
