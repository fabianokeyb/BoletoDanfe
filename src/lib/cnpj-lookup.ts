/**
 * Consulta do nome da empresa pelo CNPJ na base pública da Receita Federal,
 * via BrasilAPI (grátis, sem chave, CORS liberado — funciona direto do navegador).
 * É a única chamada de rede do app; tudo mais é local. Envia só o CNPJ (dado público).
 * Falha silenciosa (offline, rate limit, CNPJ não encontrado) → undefined, e o usuário
 * digita o favorecido como antes.
 */

const ENDPOINT = (cnpj: string) => `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`
const CONECTORES = new Set(['de', 'da', 'do', 'dos', 'das', 'e'])

/** Resposta parcial da BrasilAPI (só os campos usados). */
interface RespostaCnpj {
  nome_fantasia?: string
  razao_social?: string
}

/**
 * Title-case amigável: a Receita devolve tudo em maiúsculas. Mantém conectores
 * ('de', 'da'…) minúsculos no meio do nome.
 * @param s texto cru
 */
function capitalizar(s: string): string {
  return s.toLowerCase().split(/\s+/).filter(Boolean)
    .map((w, i) => i > 0 && CONECTORES.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * Busca o nome do fornecedor pelo CNPJ. Prefere o nome fantasia (mais curto, próximo
 * do rótulo da planilha) e cai para a razão social. Não lança: devolve undefined.
 * @param cnpj CNPJ com ou sem máscara
 * @param fetchFn injeção para teste; padrão é o fetch do navegador
 * @returns nome capitalizado, ou undefined se não deu para resolver
 */
export async function buscarNomePorCnpj(cnpj: string, fetchFn: typeof fetch = fetch): Promise<string | undefined> {
  const limpo = cnpj.replace(/\D/g, '')
  if (limpo.length !== 14) return undefined
  try {
    const resposta = await fetchFn(ENDPOINT(limpo), {headers: {accept: 'application/json'}})
    if (!resposta.ok) return undefined
    const dados = await resposta.json() as RespostaCnpj
    const bruto = (dados.nome_fantasia || dados.razao_social || '').trim()
    return bruto ? capitalizar(bruto) : undefined
  } catch {
    return undefined
  }
}
