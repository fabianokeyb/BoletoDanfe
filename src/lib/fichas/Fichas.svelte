<script lang="ts">
 import {onDestroy, onMount, tick} from 'svelte'
 import {RECEITAS, type Receita, type Ingrediente} from './receitas.ts'
 import {
  LOJAS, FATOR_MIN, producaoVazia, revisar, loteAberto, finalizadosDe, alternarFicha, definirUsado, definirRendimento,
  definirFator, definirObs, descartarAberto, faltaParaFinalizar, finalizar, reabrir, pendentesEnvio, marcarEnviado, pacote,
  situacao, diferencas, finalizadosDoDia, relatorio, linkWhatsApp, podar, referencia, rendimentoFicha, formatar, lerCampo,
  textoCampo, casas, pct, type Producao, type Lote
 } from './estado.ts'
 import {enviarLote, verificarToken} from './enviar.ts'
 import {ErroSincronizacao} from '../compras/sincronizar.ts'
 import {ler, gravar, pedirPersistencia} from '../compras/armazenamento.ts'
 import {rotulo, type Unidade} from '../compras/unidades.ts'
 import {normalizar} from '../compras/estado.ts'
 import {copiarTexto} from '../clipboard'
 import {temaInicial, aplicarTema, lembrarTema, entrarModoApp} from '../tema.ts'

 const CHAVE_ESTADO = 'fichas'
 const CHAVE_WHATS = 'thb.fichas.whats'
 const CHAVE_TOKEN = 'thb.fichas.token'
 const INTERVALO_ENVIO = 45_000

 let producao = $state<Producao>(producaoVazia(hoje()))
 let carregado = $state(false)
 let emDisco = $state(true)
 let aberta = $state('')
 let outroLote = $state('')
 let busca = $state('')
 let soFeitas = $state(false)
 let aviso = $state('')
 let copiado = $state(false)
 let whats = $state('')
 let token = $state('')
 let tokenRecusado = $state(false)
 let enviando = $state(false)
 let erroEnvio = $state('')
 let escuro = $state(false)
 let digitando = $state(false)
 let tokenDigitado = $state('')
 let sairModoApp: (() => void) | undefined
 let relogio: ReturnType<typeof setInterval> | undefined

 const porId = new Map(RECEITAS.map(r => [r.id, r]))
 const pendentes = $derived(pendentesEnvio(producao))
 const finalizadas = $derived(finalizadosDoDia(producao, RECEITAS).length)
 const emAndamento = $derived(RECEITAS.filter(r => loteAberto(producao, r.id)).length)
 const visiveis = $derived.by(() => {
  const q = normalizar(busca)
  return RECEITAS.filter(r => (!q || normalizar(r.nome).includes(q)) && (!soFeitas || loteAberto(producao, r.id) || finalizadosDe(producao, r.id).length))
 })
 const mensagem = $derived(relatorio(producao, RECEITAS))
 const nuvem = $derived(!token ? 'sem-codigo' : tokenRecusado ? 'recusado' : enviando ? 'enviando' : pendentes.length ? 'pendente' : 'ok')

 onMount(async () => {
  sairModoApp = entrarModoApp()
  escuro = temaInicial(); aplicarTema(escuro)
  try {
   whats = localStorage.getItem(CHAVE_WHATS) ?? ''
   token = localStorage.getItem(CHAVE_TOKEN) ?? ''
  } catch {/* sem localStorage */}
  const doLink = codigoDoEndereco()
  const salvo = revisar(await ler<unknown>(CHAVE_ESTADO), RECEITAS, hoje())
  // O dia é sempre hoje ao abrir; lotes abertos de ontem continuam e recebem o dia ao finalizar.
  producao = podar({...salvo, data: hoje()}, hoje())
  carregado = true
  void pedirPersistencia()
  if (doLink) await conectar(doLink)
  window.addEventListener('online', aoVoltarSinal)
  window.addEventListener('hashchange', aoMudarEndereco)
  document.addEventListener('visibilitychange', aoVoltarSinal)
  relogio = setInterval(() => {if (pendentes.length) void sincronizar()}, INTERVALO_ENVIO)
  void sincronizar()
 })
 onDestroy(() => {
  sairModoApp?.()
  if (relogio) clearInterval(relogio)
  if (typeof window === 'undefined') return
  window.removeEventListener('online', aoVoltarSinal)
  window.removeEventListener('hashchange', aoMudarEndereco)
  document.removeEventListener('visibilitychange', aoVoltarSinal)
 })

 // Grava no aparelho a cada mudança (inclusive a cada dígito): se a bateria acabar, nada se perde.
 $effect(() => {
  const copia = $state.snapshot(producao)
  if (!carregado) return
  void gravar(CHAVE_ESTADO, copia).then(ok => {emDisco = ok})
 })

 /** Dia de hoje no fuso do aparelho, AAAA-MM-DD. */
 function hoje(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
 }
 function hora(t: number) {return new Date(t).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}
 function avisar(t: string) {aviso = t; setTimeout(() => {if (aviso === t) aviso = ''}, 3200)}
 function vibrar(p: number | number[]) {try {navigator.vibrate?.(p)} catch {/* sem haptics */}}
 function alternarTema() {escuro = !escuro; aplicarTema(escuro); lembrarTema(escuro)}

 // ---------- conexão com o servidor ----------
 /** Lê o código de um link #/fichas/conectar/<código> e limpa o endereço (o código não fica no histórico). */
 function codigoDoEndereco(): string {
  const m = location.hash.match(/^#\/?fichas\/conectar\/([\w-]{10,200})/)
  if (!m) return ''
  history.replaceState(null, '', location.pathname + location.search + '#/fichas')
  return m[1]
 }
 /**
  * Guarda o código da cozinha e confere com o servidor. Sem sinal, guarda assim mesmo:
  * a conferência acontece no primeiro envio.
  * @param codigo código recebido no link ou digitado
  */
 async function conectar(codigo: string) {
  const c = codigo.trim()
  if (!c) return
  try {
   const nome = await verificarToken(c)
   salvarToken(c)
   avisar(`Celular conectado${nome ? ` (${nome})` : ''}.`)
  } catch (e) {
   if (e instanceof ErroSincronizacao && e.tipo === 'token') {avisar('Código recusado. Confira o link.'); return}
   salvarToken(c)
   avisar('Código guardado. Confiro quando tiver sinal.')
  }
  void sincronizar()
 }
 function salvarToken(c: string) {
  token = c; tokenRecusado = false; tokenDigitado = ''
  try {localStorage.setItem(CHAVE_TOKEN, c)} catch {/* não persiste */}
 }
 /** Link de conexão aberto com o app já na tela: só o endereço muda. */
 function aoMudarEndereco() {const c = codigoDoEndereco(); if (c) void conectar(c)}
 function aoVoltarSinal() {if (document.visibilityState !== 'hidden') void sincronizar()}

 /** Envia a fila, um lote por vez; o que falhar fica para a próxima tentativa. */
 async function sincronizar() {
  if (enviando || !token || tokenRecusado || !carregado) return
  const fila = pendentesEnvio(producao)
  if (!fila.length) {erroEnvio = ''; return}
  enviando = true
  try {
   for (const l of fila) {
    const r = porId.get(l.receitaId)
    if (!r || !l.finalizadoEm) continue
    await enviarLote(token, pacote(r, l))
    producao = marcarEnviado(producao, l.id, l.finalizadoEm)
   }
   erroEnvio = ''
  } catch (e) {
   erroEnvio = e instanceof Error ? e.message : 'Falha ao enviar.'
   if (e instanceof ErroSincronizacao && e.tipo === 'token') tokenRecusado = true
  } finally {enviando = false}
 }

 // ---------- preenchimento ----------
 async function abrir(id: string) {
  aberta = aberta === id ? '' : id
  outroLote = ''
  if (!aberta) return
  await tick()
  document.getElementById(`ficha-${id}`)?.scrollIntoView({block: 'nearest', behavior: 'smooth'})
 }
 function seguiu(r: Receita) {producao = alternarFicha(producao, r.id); vibrar(30)}
 function passoFator(r: Receita, d: number) {producao = definirFator(producao, r.id, (loteAberto(producao, r.id)?.fator ?? 1) + d); vibrar(10)}
 function fatorTexto(f: number) {return `${f.toLocaleString('pt-BR')} ${f > 1 ? 'receitas' : 'receita'}`}

 /**
  * Filtra a digitação: kg, L e unidade aceitam vírgula e as casas da unidade; g e ml só dígitos.
  * @param el campo
  * @param u unidade do campo
  */
 function filtrar(el: HTMLInputElement, u: Unidade) {
  const n = casas(u)
  let v = el.value.replace('.', ',')
  if (n) {
   v = v.replace(/[^\d,]/g, '')
   const [int, ...dec] = v.split(',')
   v = dec.length ? `${int},${dec.join('').slice(0, n)}` : int
  } else v = v.replace(/\D/g, '')
  v = v.slice(0, 8)
  if (v !== el.value) el.value = v
 }
 function digitarUsado(r: Receita, i: Ingrediente, el: HTMLInputElement) {
  filtrar(el, i.unidade)
  producao = definirUsado(producao, r.id, i.id, lerCampo(el.value, i.unidade))
 }
 function digitarRendimento(r: Receita, el: HTMLInputElement) {
  filtrar(el, r.rendimento.unidade)
  producao = definirRendimento(producao, r.id, lerCampo(el.value, r.rendimento.unidade))
 }
 function modoTeclado(u: Unidade) {return casas(u) ? 'decimal' : 'numeric'}

 async function finalizarReceita(r: Receita) {
  const res = finalizar(producao, r)
  if (!res.producao) {
   avisar(res.erro)
   if (loteAberto(producao, r.id)) {await tick(); document.getElementById(`rend-${r.id}`)?.focus()}
   return
  }
  producao = res.producao
  outroLote = ''; vibrar([30, 60, 30])
  avisar(token ? `${r.nome} finalizada.` : `${r.nome} finalizada e guardada no celular.`)
  void sincronizar()
 }
 function corrigir(l: Lote) {
  if (loteAberto(producao, l.receitaId)) {avisar('Finalize ou descarte o lote em andamento antes.'); return}
  producao = reabrir(producao, l.id); outroLote = ''
 }
 function situacaoNuvem(l: Lote) {return l.enviadoEm ? '☁︎ salvo' : '⏳ no celular'}

 // ---------- relatório ----------
 function validar(): boolean {
  if (finalizadas) return true
  avisar(emAndamento ? 'Finalize as receitas antes de enviar.' : 'Nenhuma receita finalizada hoje.')
  return false
 }
 function enviarWhats() {
  if (!validar()) return
  const url = linkWhatsApp(mensagem, whats)
  if (!window.open(url, '_blank')) location.href = url
 }
 async function copiar() {
  if (!validar()) return
  if (await copiarTexto(mensagem)) {copiado = true; vibrar(40); setTimeout(() => {copiado = false}, 1800)}
  else avisar('O navegador bloqueou a cópia. Use o botão do WhatsApp.')
 }
 function salvarWhats(v: string) {
  whats = v.replace(/[^\d+ ()-]/g, '').slice(0, 20)
  try {localStorage.setItem(CHAVE_WHATS, whats)} catch {/* não persiste */}
 }
 function aoFocar(e: FocusEvent) {if ((e.target as HTMLElement).matches('input:not([type=checkbox])')) digitando = true}
 function aoDesfocar() {setTimeout(() => {if (!document.activeElement?.matches('input:not([type=checkbox])')) digitando = false}, 200)}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fichas" class:digitando onfocusin={aoFocar} onfocusout={aoDesfocar}>
 <div class="topo">
  <div class="cabeca">
   <div class="titulo"><p class="eyebrow">PRODUÇÃO · FICHAS TÉCNICAS</p><h1>O que foi feito hoje</h1></div>
   <button class="nuvem n-{nuvem}" onclick={() => {tokenRecusado = false; void sincronizar()}} aria-label="Situação do envio para o servidor">
    {#if nuvem === 'ok'}☁︎ salvo{:else if nuvem === 'enviando'}↑ enviando{:else if nuvem === 'pendente'}⏳ {pendentes.length}{:else if nuvem === 'recusado'}⚠︎ código{:else}⚠︎ conectar{/if}
   </button>
   <button class="tema" aria-label={escuro ? 'Usar tema claro' : 'Usar tema escuro'} onclick={alternarTema}>{escuro ? '☀' : '☾'}</button>
  </div>
  <div class="dados">
   <div class="lojas" role="group" aria-label="Loja">
    {#each LOJAS as l (l)}<button class:on={producao.loja === l} aria-pressed={producao.loja === l} onclick={() => {producao = {...producao, loja: l}}}>{l}</button>{/each}
   </div>
   <input type="date" aria-label="Dia da produção" value={producao.data} max={hoje()} onchange={(e) => {if (e.currentTarget.value) producao = {...producao, data: e.currentTarget.value}}}/>
   <input class="quem" aria-label="Cozinheiro" placeholder="Seu nome" maxlength="40" autocomplete="name" value={producao.cozinheiro} oninput={(e) => {producao = {...producao, cozinheiro: e.currentTarget.value.trim()}}}/>
  </div>
 </div>
 <div class="fixo">
  <div class="busca">
   <input type="search" placeholder="Buscar receita" aria-label="Buscar receita" bind:value={busca}/>
   <button class="filtro" class:on={soFeitas} aria-pressed={soFeitas} onclick={() => {soFeitas = !soFeitas}}>Feitas{#if finalizadas + emAndamento}<span class="badge">{finalizadas + emAndamento}</span>{/if}</button>
  </div>
 </div>

 {#if !emDisco}<p class="alerta">Este navegador não está guardando os dados. Não feche a página antes de enviar.</p>{/if}
 {#if !token}<p class="alerta">Este celular ainda não está conectado ao sistema. As receitas ficam guardadas aqui até a conexão; abra o link de conexão ou cole o código em Ajustes, no fim da página.</p>
 {:else if tokenRecusado}<p class="alerta erro">O código deste celular foi recusado. As receitas continuam guardadas aqui; peça um link novo.</p>
 {:else if pendentes.length && erroEnvio}<p class="alerta">{pendentes.length} {pendentes.length === 1 ? 'receita finalizada está' : 'receitas finalizadas estão'} só no celular. {erroEnvio}</p>{/if}
 <p class="lead">Abra a receita, marque <b>Segui a ficha</b> ou digite o que foi diferente, <b>pese o que rendeu</b> e toque em <b>Finalizar receita</b>.</p>

 {#each visiveis as r (r.id)}
  {@const lote = loteAberto(producao, r.id)}
  {@const feitos = finalizadosDe(producao, r.id)}
  {@const fator = lote?.fator ?? 1}
  {@const difs = lote ? new Map(diferencas(r, lote).map(d => [d.ingrediente.id, d])) : new Map()}
  {@const rendRef = rendimentoFicha(r, fator)}
  {@const mostrarForm = !!lote || !feitos.length || outroLote === r.id}
  <article class="ficha" class:aberta={aberta === r.id} class:st-andamento={!!lote} class:st-feita={!lote && feitos.length > 0} id="ficha-{r.id}">
   <button class="cab" aria-expanded={aberta === r.id} onclick={() => abrir(r.id)}>
    <span class="num">{r.numero}</span>
    <span class="nome">{r.nome}</span>
    {#if lote}<span class="selo s-andamento">em andamento</span>
    {:else if feitos.length}<span class="selo s-feita">✓ finalizada{#if feitos.length > 1}{` ×${feitos.length}`}{/if}</span>
    {:else}<span class="rend-ficha">{formatar(r.rendimento.qtd, r.rendimento.unidade)}</span>{/if}
   </button>
   {#if aberta === r.id}
    <div class="corpo">
     {#each feitos as f, k (f.id)}
      {@const rf = rendimentoFicha(r, f.fator)}
      <div class="feito">
       <span class="ft-info">
        <b>✓ {feitos.length > 1 ? `Lote ${k + 1} · ` : ''}{hora(f.finalizadoEm ?? 0)}</b>
        <small>{formatar(f.rendimento ?? 0, r.rendimento.unidade)}{#if f.rendimento !== rf}{` (${pct(((f.rendimento ?? 0) - rf) / rf)})`}{/if}{` · ${situacao(r, f) === 'alterada' ? 'alterada' : 'ingredientes da ficha'} · ${situacaoNuvem(f)}`}</small>
       </span>
       <button class="link" onclick={() => corrigir(f)}>corrigir</button>
      </div>
     {/each}
     {#if !mostrarForm}
      <button class="secondary" onclick={() => {outroLote = r.id}}>+ Fazer outro lote desta receita</button>
     {:else}
      <div class="fator">
       <span>Quanto fez</span>
       <div class="stp">
        <button aria-label="Meia receita a menos" disabled={fator <= FATOR_MIN} onclick={() => passoFator(r, -0.5)}>−</button>
        <b>{fatorTexto(fator)}</b>
        <button aria-label="Meia receita a mais" onclick={() => passoFator(r, 0.5)}>+</button>
       </div>
      </div>
      <button class="seguiu" class:on={lote?.modo === 'ficha'} aria-pressed={lote?.modo === 'ficha'} onclick={() => seguiu(r)}>
       {lote?.modo === 'ficha' ? '✓ Segui a ficha' : 'Segui a ficha'}
       <small>mesmos ingredientes e quantidades</small>
      </button>
      <p class="rotulo">{lote?.modo === 'ficha' ? 'Ingredientes da ficha' : 'Ou digite o que foi diferente'} <small>· em branco = igual à ficha</small></p>
      <div class="tabela">
       {#each r.ingredientes as i (i.id)}
        {@const ref = referencia(i, fator)}
        {@const d = difs.get(i.id)}
        <label class="linha" class:mudou={!!d}>
         <span class="ing">
          <span class="t">{i.nome}</span>
          <small>ficha {formatar(ref, i.unidade)}{#if i.obs && fator === 1}{` · ${i.obs}`}{/if}{#if d}{' · '}<b class:mais={d.variacao > 0} class:menos={d.variacao < 0}>{pct(d.variacao)}</b>{/if}</small>
         </span>
         <span class="campo">
          <input inputmode={modoTeclado(i.unidade)} enterkeyhint="next" autocomplete="off" placeholder={textoCampo(ref)} aria-label="{i.nome}, quantidade usada em {rotulo(i.unidade)}"
           value={textoCampo(lote?.usados[i.id])} oninput={(e) => digitarUsado(r, i, e.currentTarget)}/>
          <span class="un">{rotulo(i.unidade)}</span>
         </span>
        </label>
       {/each}
       <label class="linha rend" class:falta={!!lote && !lote.rendimento} class:mudou={!!lote?.rendimento && lote.rendimento !== rendRef}>
        <span class="ing">
         <span class="t">Rendimento pesado *</span>
         <small>ficha {formatar(rendRef, r.rendimento.unidade)}{#if lote?.rendimento && lote.rendimento !== rendRef}{' · '}<b class="var">{pct((lote.rendimento - rendRef) / rendRef)}</b>{:else if lote && !lote.rendimento}{' · '}<b class="var">pese e digite</b>{/if}</small>
        </span>
        <span class="campo">
         <input id="rend-{r.id}" inputmode={modoTeclado(r.rendimento.unidade)} enterkeyhint="done" autocomplete="off" placeholder="peso" aria-label="Rendimento pesado em {rotulo(r.rendimento.unidade)}"
          value={textoCampo(lote?.rendimento)} oninput={(e) => digitarRendimento(r, e.currentTarget)}/>
         <span class="un">{rotulo(r.rendimento.unidade)}</span>
        </span>
       </label>
      </div>
      <input class="obs" placeholder="Observação (opcional): por que mudou?" maxlength="200" aria-label="Observação" value={lote?.obs ?? ''} onchange={(e) => {producao = definirObs(producao, r.id, e.currentTarget.value)}}/>
      <button class="primary finalizar" class:pronto={!faltaParaFinalizar(r, lote)} onclick={() => finalizarReceita(r)}>Finalizar receita</button>
      {#if lote}<button class="link perigo" onclick={() => {producao = descartarAberto(producao, r.id); outroLote = ''}}>descartar o que foi preenchido</button>{/if}
     {/if}
    </div>
   {/if}
  </article>
 {:else}
  <p class="vazio-curto">{soFeitas && !busca ? 'Nenhuma receita feita ainda.' : 'Nenhuma receita com esse nome.'} <button class="link" onclick={() => {busca = ''; soFeitas = false}}>mostrar todas</button></p>
 {/each}

 <details class="bloco">
  <summary>Ver a mensagem do WhatsApp</summary>
  <pre>{mensagem}</pre>
 </details>
 <details class="bloco" open={!token}>
  <summary>Ajustes</summary>
  <label for="codigo">Código da cozinha <small>{token ? '· conectado' : '· não conectado'}</small></label>
  <form class="linha-codigo" onsubmit={(e) => {e.preventDefault(); void conectar(tokenDigitado)}}>
   <input id="codigo" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder={token ? '••••••••' : 'cole o código'} bind:value={tokenDigitado}/>
   <button class="secondary curto" disabled={!tokenDigitado.trim()}>Conectar</button>
  </form>
  <label for="whats">WhatsApp de destino <small>(com 55 e DDD; em branco, você escolhe o contato)</small></label>
  <input id="whats" inputmode="tel" placeholder="55 21 90000-0000" value={whats} onchange={(e) => salvarWhats(e.currentTarget.value)}/>
 </details>

 <div class="barra">
  <button class="secondary" onclick={copiar}>{copiado ? 'Copiado ✓' : '📋 Copiar'}</button>
  <button class="primary" onclick={enviarWhats}>Resumo no WhatsApp{#if finalizadas}{` (${finalizadas})`}{/if}</button>
 </div>
 {#if aviso}<div class="toast" role="status">{aviso}</div>{/if}
</div>

<style>
 .fichas{--sup:#fff;--fundo:#f5f4ef;--fundo-t:#f5f4efee;--pri:#193f35;--tx:#10251f;--tx2:#45594f;--tx3:#65766f;--bd:#c7d2c8;--bd2:#eef1ec;--f1:#eef2ec;--ok-f:#e7f3ea;--ok-b:#9fc7ad;--er-f:#f8e5e0;--er-b:#e3b9ae;--er-t:#8f3e2c;--av-f:#fcf3dc;--av-b:#e7c98e;--av-t:#7a5a1d;--az-t:#2f6f9f;--v:#1f6a43;--r:#b83d3d;max-width:760px;padding-bottom:96px;color:var(--tx)}
 :global(html[data-tema='escuro']) .fichas{--sup:#17211d;--fundo:#0e1512;--fundo-t:#0e1512ee;--pri:#2f8462;--tx:#e6eee9;--tx2:#bccbc2;--tx3:#8fa198;--bd:#33443c;--bd2:#222e29;--f1:#1f2b26;--ok-f:#173326;--ok-b:#2f6b4b;--er-f:#3a1f1b;--er-b:#7a3a2f;--er-t:#f0a493;--av-f:#33280f;--av-b:#7a6127;--av-t:#e8c57c;--az-t:#8cc0ea;--v:#4cb57d;--r:#e0706a;color-scheme:dark}
 :global(html.modo-app),:global(html.modo-app body){overflow-x:clip;overscroll-behavior-x:none;max-width:100%;-webkit-text-size-adjust:100%}
 :global(html[data-tema='escuro']),:global(html[data-tema='escuro'] body),:global(html[data-tema='escuro'] .app),:global(html[data-tema='escuro'] main){background:#0e1512!important;color:#e6eee9}
 :global(html[data-tema='escuro'] aside){background:#0b110f!important;border-color:#222e29!important}
 .fichas :is(button,input){-webkit-tap-highlight-color:transparent}
 button{font:inherit;cursor:pointer;color:inherit}
 button:disabled{opacity:.3;cursor:default}
 input{width:100%;min-width:0;border:1px solid var(--bd);border-radius:8px;padding:10px 12px;background:var(--sup);color:var(--tx);font-size:17px}
 .eyebrow{font-size:12px;font-weight:700;letter-spacing:2px;color:var(--tx3);margin:0}
 h1{font-size:22px;font-weight:650;letter-spacing:-.4px;line-height:1.2;margin:2px 0 0;color:var(--tx)}
 .lead{font-size:15px;line-height:1.5;color:var(--tx2);margin:12px 0}
 .alerta.erro{color:var(--er-t);background:var(--er-f);border-color:var(--er-b)}
 .alerta{font-size:14px;line-height:1.45;color:var(--av-t);background:var(--av-f);border:1px solid var(--av-b);border-radius:8px;padding:9px 12px;margin:10px 0 0}
 .topo{padding-top:12px}
 .fixo{position:sticky;top:0;z-index:6;background:var(--fundo);margin:0 -2px;padding:8px 2px;padding-top:calc(8px + env(safe-area-inset-top));border-bottom:1px solid var(--bd2)}
 .cabeca{display:flex;gap:8px;align-items:center}
 .titulo{flex:1;min-width:0}
 .nuvem{flex:0 0 auto;height:46px;border:1px solid var(--bd);background:var(--sup);border-radius:12px;padding:0 10px;font-size:14px;font-weight:700;white-space:nowrap}
 .n-ok{color:var(--v);border-color:var(--ok-b)} .n-pendente,.n-enviando{color:var(--av-t);border-color:var(--av-b);background:var(--av-f)} .n-sem-codigo,.n-recusado{color:var(--er-t);border-color:var(--er-b);background:var(--er-f)}
 .tema{flex:0 0 46px;height:46px;border:1px solid var(--bd);background:var(--sup);border-radius:12px;font-size:21px;color:var(--tx2);padding:0}
 .dados{display:grid;grid-template-columns:auto minmax(0,1fr) minmax(0,1fr);gap:8px;margin-top:10px}
 .dados input{padding:9px 10px;font-size:16px}
 .lojas{display:flex;background:var(--f1);border-radius:10px;padding:3px;gap:3px}
 .lojas button{border:0;background:transparent;border-radius:8px;padding:8px 10px;font-size:14px;font-weight:800;color:var(--tx2)}
 .lojas button.on{background:var(--pri);color:#fff}
 .busca{display:flex;gap:8px}
 .busca input{flex:1}
 .filtro{position:relative;flex:0 0 auto;border:1px solid var(--bd);background:var(--sup);border-radius:8px;padding:0 14px;font-size:15px;font-weight:600}
 .filtro.on{background:var(--pri);color:#fff;border-color:var(--pri)}
 .badge{position:absolute;top:-8px;right:-7px;display:grid;place-items:center;min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:#ff3b30;color:#fff;font-size:13px;font-weight:700;line-height:1;border:2px solid var(--fundo);pointer-events:none}
 .ficha{background:var(--sup);border:1px solid var(--bd);border-radius:12px;margin-bottom:8px;scroll-margin-top:76px;transition:border-color .2s,background .2s}
 .ficha.aberta{box-shadow:0 2px 10px #0001}
 .ficha.st-feita{border-color:var(--ok-b);background:var(--ok-f)}
 .ficha.st-andamento{border-color:var(--av-b);background:var(--av-f)}
 .cab{display:flex;align-items:center;gap:10px;width:100%;min-height:56px;border:0;background:transparent;text-align:left;padding:8px 12px}
 .num{flex:0 0 30px;height:30px;display:grid;place-items:center;border-radius:50%;background:var(--f1);font-size:13px;font-weight:700;color:var(--tx2);font-variant-numeric:tabular-nums}
 .nome{flex:1;min-width:0;font-size:17px;font-weight:650;line-height:1.25}
 .rend-ficha{font-size:13px;color:var(--tx3);white-space:nowrap;font-variant-numeric:tabular-nums}
 .selo{font-size:13px;font-weight:800;border-radius:99px;padding:3px 9px;white-space:nowrap}
 .s-feita{color:var(--v)} .s-andamento{color:var(--av-t)}
 .feito{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--bd2)}
 .ft-info{flex:1;min-width:0;display:grid;gap:2px}
 .ft-info b{font-size:15px;color:var(--v)}
 .ft-info small{font-size:13px;color:var(--tx3);font-variant-numeric:tabular-nums}
 .feito .link{padding:6px 0}
 .corpo{padding:2px 12px 12px;border-top:1px solid var(--bd2)}
 .fator{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;font-size:15px;font-weight:600;color:var(--tx2)}
 .stp{display:grid;grid-template-columns:46px minmax(104px,auto) 46px;align-items:center;border:1px solid var(--bd);border-radius:10px;background:var(--sup);height:44px;overflow:hidden}
 .stp button{height:100%;border:0;background:transparent;font-size:22px;font-weight:600;line-height:1;color:var(--tx2);touch-action:manipulation}
 .stp button:active:not(:disabled){background:var(--f1)}
 .stp b{text-align:center;font-size:15px;font-variant-numeric:tabular-nums}
 .seguiu{display:grid;gap:2px;width:100%;margin-top:10px;padding:12px 14px;border-radius:10px;border:1px solid var(--pri);background:var(--sup);color:var(--pri);font-size:17px;font-weight:700}
 .seguiu small{font-size:13px;font-weight:500;color:var(--tx3)}
 .seguiu.on{background:var(--pri);color:#fff}
 .seguiu.on small{color:#fffc}
 .rotulo{font-size:14px;font-weight:700;margin:16px 0 8px;color:var(--tx)}
 .rotulo small{font-weight:400;color:var(--tx3)}
 .tabela{background:var(--sup);border:1px solid var(--bd);border-radius:12px;overflow:hidden}
 .linha{display:flex;align-items:center;gap:10px;padding:8px 10px;border-top:1px solid var(--bd2);min-height:56px;margin:0;transition:background .2s}
 .linha:first-child{border-top:0}
 .linha.mudou{background:var(--av-f)}
 .linha.rend{border-top:2px solid var(--bd);background:var(--f1)}
 .linha.rend.mudou{background:var(--av-f)}
 .linha.rend.falta{background:var(--er-f)}
 .ing{flex:1;min-width:0;display:grid;gap:1px}
 .t{font-size:16px;font-weight:600;color:var(--tx);line-height:1.25}
 .rend .t{font-weight:800}
 .ing small{font-size:13px;color:var(--tx3);font-variant-numeric:tabular-nums}
 .mais{color:var(--r)} .menos{color:var(--az-t)}
 .var{color:var(--er-t)}
 .campo{flex:0 0 132px;display:grid;grid-template-columns:minmax(0,1fr) 30px;align-items:center;border:1px solid var(--bd);border-radius:9px;background:var(--sup);height:44px;overflow:hidden}
 .campo:focus-within{border-color:var(--pri);box-shadow:0 0 0 1px var(--pri) inset}
 .campo input{height:100%;border:0;border-radius:0;padding:0 4px 0 8px;text-align:right;font-size:17px;font-weight:700;background:transparent;font-variant-numeric:tabular-nums}
 .campo input::placeholder{color:var(--tx3);font-weight:500;opacity:.55}
 .campo input:focus{outline:none}
 .campo .un{font-size:13px;font-weight:700;color:var(--tx3)}
 .obs{margin-top:10px;font-size:16px}
 .finalizar{margin-top:12px;opacity:.6}
 .finalizar.pronto{opacity:1}
 .corpo > .secondary{margin-top:12px}
 .linha-codigo{display:flex;gap:8px}
 .linha-codigo input{flex:1}
 .curto{width:auto;flex:0 0 auto;margin-top:0!important}
 .link{border:0;background:transparent;color:var(--az-t);text-decoration:underline;font-size:14px;padding:10px 0 0}
 .perigo{color:var(--er-t)!important}
 .vazio-curto{font-size:15px;color:var(--tx3);text-align:center;padding:18px 0}
 .bloco{background:var(--sup);border:1px solid var(--bd);border-radius:12px;padding:12px 14px;margin-top:10px}
 .bloco summary{font-size:15px;font-weight:600;cursor:pointer;color:var(--tx2)}
 .bloco pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.5 ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:var(--tx);margin:10px 0 0}
 .bloco label{display:block;margin:12px 0 6px;font-size:14px;font-weight:600}
 .bloco label small{font-weight:400;color:var(--tx3)}
 .primary,.secondary{padding:13px 16px;border-radius:9px;font-size:16px;font-weight:600;width:100%}
 .primary{background:var(--pri);color:#fff;border:1px solid var(--pri)}
 .secondary{background:var(--sup);color:var(--pri);border:1px solid var(--bd)}
 .bloco .secondary{margin-top:12px}
 .barra{position:fixed;left:0;right:0;bottom:0;z-index:15;display:flex;gap:8px;padding:10px 14px calc(10px + env(safe-area-inset-bottom));background:var(--fundo-t);backdrop-filter:blur(6px);border-top:1px solid var(--bd)}
 .barra .secondary{flex:0 0 auto;width:auto}
 .barra .primary{flex:1}
 .digitando .barra{display:none}
 @media(min-width:901px){.barra{left:250px}}
 .toast{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);background:#0b1a15;color:#fff;border-radius:99px;padding:10px 18px;font-size:15px;z-index:20;box-shadow:0 6px 20px #0003;max-width:90vw;text-align:center}
 :global(html[data-tema='escuro']) .toast{background:#e6eee9;color:#0e1512}
 @media(max-width:420px){.campo{flex-basis:118px}.dados{grid-template-columns:auto minmax(0,1fr)}.dados .quem{grid-column:1/-1}}
</style>
