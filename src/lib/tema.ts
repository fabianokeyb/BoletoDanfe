/**
 * Tema claro/escuro das telas em modo app (Compras e Fichas técnicas).
 * Ao abrir segue o horário (escuro das 18h às 6h); a troca manual vale até fechar a aba e é
 * compartilhada entre os módulos pela mesma chave do sessionStorage.
 */
const CHAVE_TEMA = 'thb.compras.tema'

/** Tema ao abrir: a escolha manual desta aba ou, na falta, o horário. */
export function temaInicial(): boolean {
  let manual: string | null = null
  try {
    manual = sessionStorage.getItem(CHAVE_TEMA)
  } catch {/* sem sessionStorage */}
  const h = new Date().getHours()
  return manual ? manual === 'escuro' : h >= 18 || h < 6
}

/**
 * Aplica o tema no documento (atributo data-tema e cor da barra do navegador).
 * @param escuro true para o tema escuro
 */
export function aplicarTema(escuro: boolean): void {
  document.documentElement.dataset.tema = escuro ? 'escuro' : 'claro'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', escuro ? '#0e1512' : '#153c35')
}

/**
 * Guarda a escolha manual para esta aba.
 * @param escuro true para o tema escuro
 */
export function lembrarTema(escuro: boolean): void {
  try {
    sessionStorage.setItem(CHAVE_TEMA, escuro ? 'escuro' : 'claro')
  } catch {/* não persiste */}
}

/** Liga o modo app (trava a rolagem lateral) e devolve a função que desfaz tudo ao sair. */
export function entrarModoApp(): () => void {
  document.documentElement.classList.add('modo-app')
  return () => {
    document.documentElement.classList.remove('modo-app')
    delete document.documentElement.dataset.tema
  }
}
