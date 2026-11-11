/**
 * Registro local CNPJ → nome do fornecedor (coluna Favorecidos da planilha).
 *
 * A chave da NF-e traz o CNPJ do emitente, não o nome. Este registro guarda, por CNPJ,
 * o nome exato do dropdown da planilha, aprendido na primeira leitura e reutilizado
 * depois. Fica só no navegador deste aparelho (localStorage).
 */
const CHAVE = 'thb.fornecedores.v1'

/** Mapeamentos conhecidos (CNPJ de 14 dígitos → nome do dropdown), sobrescrevíveis pelo usuário. */
const SEEDS: Record<string, string> = {
  '10915021000190': 'Top Alto',
  '07454402000458': 'PorteFrio',
  '07454402000377': 'PorteFrio'
}

/**
 * Lê o registro combinado (sementes + ajustes do usuário).
 * @returns mapa CNPJ → nome
 */
export function carregarFornecedores(): Record<string, string> {
  try {
    return {...SEEDS, ...JSON.parse(localStorage.getItem(CHAVE) ?? '{}')}
  } catch {
    return {...SEEDS}
  }
}

/**
 * Nome gravado para um CNPJ, ou string vazia se desconhecido.
 * @param cnpj 14 dígitos
 */
export function nomeDoCnpj(cnpj?: string): string {
  return cnpj ? carregarFornecedores()[cnpj] ?? '' : ''
}

/**
 * Grava (ou apaga, se nome vazio) o nome de um CNPJ no registro do usuário.
 * @param cnpj 14 dígitos
 * @param nome nome do fornecedor como no dropdown da planilha
 */
export function salvarFornecedor(cnpj: string, nome: string) {
  if (!cnpj) return
  try {
    const user = JSON.parse(localStorage.getItem(CHAVE) ?? '{}')
    if (nome.trim()) user[cnpj] = nome.trim()
    else delete user[cnpj]
    localStorage.setItem(CHAVE, JSON.stringify(user))
  } catch {
    /* registro só não persiste */
  }
}

/** Nomes distintos já conhecidos, para sugerir no cadastro. Ordenados em pt-BR. */
export function listaFornecedores(): string[] {
  return [...new Set(Object.values(carregarFornecedores()))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}
