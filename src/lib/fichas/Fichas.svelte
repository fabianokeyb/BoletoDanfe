<script lang="ts">
 import {onDestroy, onMount, tick} from 'svelte'
 import {RECEITAS, type Receita, type Ingrediente} from './receitas.ts'
 import {buscarCatalogo, converterCatalogo} from './catalogo.ts'
 import {
  LOJAS, NOME_LOJA, cozinheiroAtual, escolherCozinheiro, escolherLoja, andamentoDaLoja, producaoVazia, revisar, loteAberto, finalizadosDe, alternarFicha, definirUsado, definirRendimento,
  fatorDe, fatorTexto, definirObs, descartarAberto, faltaParaFinalizar, finalizar, reabrir, pendentesEnvio, marcarEnviado, pacote,
  situacao, diferencas, finalizadosDoDia, relatorio, linkWhatsApp, podar, referencia, rendimentoFicha, formatar, lerCampo,
  textoCampo, casas, casasAutomaticas, digitarTresCasas, pct, type Producao, type Lote
 } from './estado.ts'
 import {enviarLote, TOKEN_COZINHA} from './enviar.ts'
 import {FUNCIONARIOS, autorizado} from './funcionarios.ts'
 import {ErroSincronizacao} from '../compras/sincronizar.ts'
 import {ler, gravar, pedirPersistencia} from '../compras/armazenamento.ts'
 import {rotulo, type Unidade} from '../compras/unidades.ts'
 import {normalizar} from '../compras/estado.ts'
 import {copiarTexto} from '../clipboard'
 import {temaInicial, aplicarTema, lembrarTema, entrarModoApp} from '../tema.ts'

 const CHAVE_ESTADO = 'fichas'
 const CHAVE_CATALOGO = 'fichas.catalogo'
 const CHAVE_WHATS = 'thb.fichas.whats'
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
 let tokenRecusado = $state(false)
 let enviando = $state(false)
 let erroEnvio = $state('')
 let escuro = $state(false)
 let digitando = $state(false)
 let sairModoApp: (() => void) | undefined
 let relogio: ReturnType<typeof setInterval> | undefined

 /** Fichas vigentes: começa com a cópia embutida e troca pela do servidor (editada no manual). */
 let receitas = $state<Receita[]>(RECEITAS)
 const porId = $derived(new Map(receitas.map(r => [r.id, r])))
 const pendentes = $derived(pendentesEnvio(producao))
 const finalizadas = $derived(finalizadosDoDia(producao, receitas).length)
 const emAndamento = $derived(receitas.filter(r => loteAberto(producao, r.id)).length)
 const visiveis = $derived.by(() => {
  const q = normalizar(busca)
  return receitas.filter(r => (!q || normalizar(r.nome).includes(q)) && (!soFeitas || loteAberto(producao, r.id) || finalizadosDe(producao, r.id).length))
 })
 const mensagem = $derived(relatorio(producao, receitas))
 const quem = $derived(cozinheiroAtual(producao))
 const nuvem = $derived(tokenRecusado ? 'recusado' : enviando ? 'enviando' : pendentes.length ? 'pendente' : 'ok')

 onMount(async () => {
  sairModoApp = entrarModoApp()
  escuro = temaInicial(); aplicarTema(escuro)
  try {whats = localStorage.getItem(CHAVE_WHATS) ?? ''} catch {/* sem localStorage */}
  receitas = converterCatalogo(await ler<unknown>(CHAVE_CATALOGO)) ?? RECEITAS
  const salvo = revisar(await ler<unknown>(CHAVE_ESTADO), receitas, hoje())
  // O dia é sempre hoje ao abrir; lotes abertos de ontem continuam e recebem o dia ao finalizar.
  producao = podar({...salvo, data: hoje()}, hoje())
  carregado = true
  void pedirPersistencia()
  window.addEventListener('online', aoVoltarSinal)
  document.addEventListener('visibilitychange', aoVoltarSinal)
  relogio = setInterval(() => {if (pendentes.length) void sincronizar()}, INTERVALO_ENVIO)
  void sincronizar()
  void atualizarCatalogo()
 })

 /** Baixa as fichas vigentes e guarda no aparelho; sem sinal, segue com a última cópia. */
 async function atualizarCatalogo() {
  const novas = await buscarCatalogo()
  if (!novas) return
  receitas = novas
  await gravar(CHAVE_CATALOGO, novas.map(r => ({...r, rendimentoKg: r.rendimento.qtd, validadeDias: r.validadeDias ?? null})))
 }
 onDestroy(() => {
  sairModoApp?.()
  if (relogio) clearInterval(relogio)
  if (typeof window === 'undefined') return
  window.removeEventListener('online', aoVoltarSinal)
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

 // ---------- envio para o servidor ----------
 function aoVoltarSinal() {if (document.visibilityState !== 'hidden') void sincronizar()}

 /** Envia a fila, um lote por vez; o que falhar fica para a próxima tentativa. */
 async function sincronizar() {
  if (enviando || tokenRecusado || !carregado) return
  const fila = pendentesEnvio(producao)
  if (!fila.length) {erroEnvio = ''; return}
  enviando = true
  let erro = ''
  try {
   for (const l of fila) {
    const r = porId.get(l.receitaId)
    if (!r || !l.finalizadoEm) continue
    try {
     await enviarLote(TOKEN_COZINHA, pacote(r, l))
     producao = marcarEnviado(producao, l.id, l.finalizadoEm)
    } catch (e) {
     erro = e instanceof Error ? e.message : 'Falha ao enviar.'
     // Sem sinal ou app recusado: os próximos também falhariam. Lote recusado: segue para o próximo.
     if (e instanceof ErroSincronizacao && e.tipo === 'token') tokenRecusado = true
     if (!(e instanceof ErroSincronizacao) || e.tipo !== 'servidor') break
    }
   }
  } finally {enviando = false; erroEnvio = erro}
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

 /**
  * Filtra a digitação. kg e L: calculadora de 3 casas (só números, vírgula automática).
  * Unidade, g e ml: aceita uma vírgula e 1 casa, que fica visível (assim "600,5" nunca vira 6005);
  * g e ml são arredondados para inteiro ao gravar.
  * @param el campo
  * @param u unidade do campo
  */
 function filtrar(el: HTMLInputElement, u: Unidade) {
  let v: string
  if (casasAutomaticas(u)) v = digitarTresCasas(el.value)
  else {
   v = el.value.replace('.', ',').replace(/[^\d,]/g, '')
   const [int, ...dec] = v.split(',')
   v = (dec.length ? `${int},${dec.join('').slice(0, 1)}` : int).slice(0, 7)
  }
  if (v === el.value) return
  el.value = v
  // O cursor fica sempre no fim, como numa calculadora.
  try {el.setSelectionRange(v.length, v.length)} catch {/* inputmode numérico em alguns navegadores */}
 }
 function digitarUsado(r: Receita, i: Ingrediente, el: HTMLInputElement) {
  filtrar(el, i.unidade)
  producao = definirUsado(producao, r.id, i.id, lerCampo(el.value, i.unidade))
 }
 function digitarRendimento(r: Receita, el: HTMLInputElement) {
  filtrar(el, r.rendimento.unidade)
  producao = definirRendimento(producao, r.id, lerCampo(el.value, r.rendimento.unidade))
 }
 function modoTeclado(u: Unidade) {return casas(u) && !casasAutomaticas(u) ? 'decimal' : 'numeric'}

 /** Desvio acima do qual o app pede um segundo toque antes de finalizar (provável erro de digitação). */
 const DESVIO_SUSPEITO = 0.5
 let confirmarDesvio = $state('')

 /** Ingredientes e rendimento com desvio suspeito no lote aberto, em texto para o aviso. */
 function suspeitos(r: Receita): string[] {
  const l = loteAberto(producao, r.id)
  if (!l) return []
  const lista = diferencas(r, l).filter(d => Math.abs(d.variacao) > DESVIO_SUSPEITO).map(d => `${d.ingrediente.nome} ${pct(d.variacao)}`)
  const esperado = rendimentoFicha(r, fatorDe(r, l))
  if (l.rendimento && esperado && Math.abs(l.rendimento / esperado - 1) > DESVIO_SUSPEITO) lista.push(`Rendimento ${pct(l.rendimento / esperado - 1)}`)
  return lista
 }

 async function finalizarReceita(r: Receita) {
  const s = suspeitos(r)
  if (s.length && confirmarDesvio !== r.id) {
   confirmarDesvio = r.id
   setTimeout(() => {if (confirmarDesvio === r.id) confirmarDesvio = ''}, 6000)
   vibrar([60, 40, 60])
   return
  }
  confirmarDesvio = ''
  const res = finalizar(producao, r)
  if (!res.producao) {
   avisar(res.erro)
   await tick()
   if (res.erro.startsWith('Escolha seu nome')) irParaNome()
   else if (loteAberto(producao, r.id)) document.getElementById(`rend-${r.id}`)?.focus()
   return
  }
  producao = res.producao
  outroLote = ''; vibrar([30, 60, 30])
  avisar(`${r.nome} finalizada.`)
  void sincronizar()
 }
 function corrigir(l: Lote) {
  if (loteAberto(producao, l.receitaId)) {avisar('Finalize ou descarte o lote em andamento antes.'); return}
  producao = reabrir(producao, l.id); outroLote = ''
 }
 function irParaNome() {window.scrollTo({top: 0, behavior: 'smooth'}); document.getElementById('quem')?.focus()}
 function trocarLoja(l: string) {
  if (l === producao.loja) return
  producao = escolherLoja(producao, l); aberta = ''; outroLote = ''; vibrar(20)
  window.scrollTo({top: 0, behavior: 'smooth'})
 }
 function andamentoTexto(l: string) {
  const a = andamentoDaLoja(producao, l)
  if (!a.abertos && !a.finalizados) return 'nada hoje'
  return [a.abertos ? `${a.abertos} aberta${a.abertos > 1 ? 's' : ''}` : '', a.finalizados ? `${a.finalizados} finalizada${a.finalizados > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')
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
<div class="fichas loja-{producao.loja}" class:digitando onfocusin={aoFocar} onfocusout={aoDesfocar}>
 <div class="topo">
  <div class="cabeca">
   <div class="titulo"><p class="eyebrow">PRODUÇÃO · FICHAS TÉCNICAS · <a class="manual" href="manual/" target="_blank" rel="noopener">MANUAL ↗</a></p><h1>Produção de hoje · <span class="nome-loja">{NOME_LOJA[producao.loja]}</span></h1></div>
   <button class="nuvem n-{nuvem}" onclick={() => {tokenRecusado = false; void sincronizar()}} aria-label="Situação do envio para o servidor">
    {#if nuvem === 'ok'}☁︎ salvo{:else if nuvem === 'enviando'}↑ enviando{:else if nuvem === 'pendente'}⏳ {pendentes.length}{:else}⚠︎ recusado{/if}
   </button>
   <button class="tema" aria-label={escuro ? 'Usar tema claro' : 'Usar tema escuro'} onclick={alternarTema}>{escuro ? '☀' : '☾'}</button>
  </div>
  <div class="lojas" role="tablist" aria-label="Loja">
   {#each LOJAS as l (l)}
    <button role="tab" class="aba-{l}" class:on={producao.loja === l} aria-selected={producao.loja === l} onclick={() => trocarLoja(l)}>
     <b>{NOME_LOJA[l]}</b>
     <small>{producao.cozinheiros[l] || 'sem cozinheiro'}</small>
     <small>{andamentoTexto(l)}</small>
    </button>
   {/each}
  </div>
  <div class="dados">
   <input type="date" aria-label="Dia da produção" value={producao.data} max={hoje()} onchange={(e) => {if (e.currentTarget.value) producao = {...producao, data: e.currentTarget.value}}}/>
   <select id="quem" class="quem" class:vazio={!quem} aria-label="Cozinheiro em {NOME_LOJA[producao.loja]}" value={quem} onchange={(e) => {producao = escolherCozinheiro(producao, e.currentTarget.value)}}>
    <option value="" disabled>Quem está na cozinha?</option>
    {#each FUNCIONARIOS as f (f)}<option value={f}>{f}</option>{/each}
   </select>
  </div>
 </div>
 <div class="fixo">
  <div class="busca">
   <input type="search" placeholder="Buscar receita" aria-label="Buscar receita" bind:value={busca}/>
   <button class="filtro" class:on={soFeitas} aria-pressed={soFeitas} onclick={() => {soFeitas = !soFeitas}}>Feitas{#if finalizadas + emAndamento}<span class="badge">{finalizadas + emAndamento}</span>{/if}</button>
  </div>
 </div>

 {#if !emDisco}<p class="alerta">Este navegador não está guardando os dados. Não feche a página antes de enviar.</p>{/if}
 {#if tokenRecusado}<p class="alerta erro">O sistema recusou o envio. As receitas continuam guardadas neste celular; avise o Fabiano.</p>
 {:else if pendentes.length && erroEnvio}<p class="alerta">{pendentes.length} {pendentes.length === 1 ? 'receita finalizada está' : 'receitas finalizadas estão'} só no celular. {erroEnvio}</p>{/if}
 <p class="lead">Abra a receita, marque <b>Segui a ficha</b> ou digite o que foi diferente, <b>pese o que rendeu</b> e toque em <b>Finalizar receita</b>.</p>

 {#each visiveis as r (r.id)}
  {@const lote = loteAberto(producao, r.id)}
  {@const feitos = finalizadosDe(producao, r.id)}
  {@const fator = lote ? fatorDe(r, lote) : 1}
  {@const difs = lote ? new Map(diferencas(r, lote).map(d => [d.ingrediente.id, d])) : new Map()}
  {@const rendRef = rendimentoFicha(r, fator)}
  {@const mostrarForm = !!lote || !feitos.length || outroLote === r.id}
  <article class="ficha" class:aberta={aberta === r.id} class:st-andamento={!!lote} class:st-feita={!lote && feitos.length > 0} id="ficha-{r.id}">
   <button class="cab" aria-expanded={aberta === r.id} onclick={() => abrir(r.id)}>
    <span class="num">{r.numero}</span>
    <span class="nome">{r.nome}</span>
    {#if lote}<span class="selo s-andamento">em andamento<small>{lote.cozinheiro}</small></span>
    {:else if feitos.length}<span class="selo s-feita">✓ finalizada{#if feitos.length > 1}{` ×${feitos.length}`}{/if}</span>
    {:else}<span class="rend-ficha">{r.rendimento.qtd ? formatar(r.rendimento.qtd, r.rendimento.unidade) : 'a pesar'}</span>{/if}
   </button>
   {#if aberta === r.id}
    <div class="corpo">
     {#each feitos as f, k (f.id)}
      {@const rf = rendimentoFicha(r, fatorDe(r, f))}
      <div class="feito">
       <span class="ft-info">
        <b>✓ {feitos.length > 1 ? `Lote ${k + 1} · ` : ''}{hora(f.finalizadoEm ?? 0)} · {f.cozinheiro}</b>
        <small>{formatar(f.rendimento ?? 0, r.rendimento.unidade)}{#if rf && f.rendimento !== rf}{` (${pct(((f.rendimento ?? 0) - rf) / rf)})`}{/if}{` · ${fatorTexto(fatorDe(r, f))} · ${situacao(r, f) === 'alterada' ? 'alterada' : 'na proporção'} · ${situacaoNuvem(f)}`}</small>
       </span>
       <button class="link" onclick={() => corrigir(f)}>corrigir</button>
      </div>
     {/each}
     {#if !mostrarForm}
      <button class="secondary" onclick={() => {outroLote = r.id}}>+ Fazer outro lote desta receita</button>
     {:else if !lote && !autorizado(quem)}
      <div class="pede-nome">
       <p>Para começar esta receita em <b>{NOME_LOJA[producao.loja]}</b>, escolha quem está na cozinha.</p>
       <button class="primary" onclick={irParaNome}>Escolher meu nome</button>
      </div>
     {:else}
      {#if lote}<p class="quem-faz">Em andamento por <b>{lote.cozinheiro}</b> · começou às {hora(lote.iniciadoEm)}</p>{/if}
      <button class="seguiu" class:on={lote?.modo === 'ficha'} aria-pressed={lote?.modo === 'ficha'} onclick={() => seguiu(r)}>
       {lote?.modo === 'ficha' ? '✓ Segui a ficha' : 'Segui a ficha'}
       <small>1 receita, com as quantidades da ficha</small>
      </button>
      <p class="rotulo">{lote?.modo === 'ficha' ? 'Ingredientes da ficha' : 'Ou digite o que usou'} <small>· em branco = igual à ficha</small></p>
      {#if lote?.modo !== 'ficha'}<p class="dica">Fez mais ou menos de uma receita? Digite o que usou de cada ingrediente: o app calcula quantas receitas foram.</p>{/if}
      <p class="dica">Em kg e L digite só os números, a vírgula entra sozinha: <b>1200</b> vira <b>1,200</b>.</p>
      <div class="tabela">
       {#each r.ingredientes as i (i.id)}
        {@const ref = referencia(i, fator)}
        {@const d = difs.get(i.id)}
        <label class="linha" class:mudou={!!d}>
         <span class="ing">
          <span class="t">{i.nome}</span>
          <small>ficha {formatar(i.qtd, i.unidade)}{#if i.obs}{` · ${i.obs}`}{/if}{#if fator !== 1}{` · esperado ${formatar(ref, i.unidade)}`}{/if}{#if d}{' · '}<b class:mais={d.variacao > 0} class:menos={d.variacao < 0}>{pct(d.variacao)}</b>{/if}</small>
         </span>
         <span class="campo">
          <input inputmode={modoTeclado(i.unidade)} enterkeyhint="next" autocomplete="off" aria-label="{i.nome}, quantidade usada em {rotulo(i.unidade)}"
           placeholder={textoCampo(i.qtd, i.unidade)} value={textoCampo(lote?.usados[i.id], i.unidade)} oninput={(e) => digitarUsado(r, i, e.currentTarget)}/>
          <span class="un">{rotulo(i.unidade)}</span>
         </span>
        </label>
       {/each}
       <div class="linha calc">
        <span class="ing"><span class="t">Quanto fez</span><small>calculado pelos ingredientes</small></span>
        <b class="calc-v">{fatorTexto(fator)}</b>
       </div>
       <label class="linha rend" class:falta={!!lote && !lote.rendimento} class:mudou={!!rendRef && !!lote?.rendimento && lote.rendimento !== rendRef}>
        <span class="ing">
         <span class="t">Rendimento pesado *</span>
         <small>{#if rendRef}{fator === 1 ? 'ficha' : 'esperado'} {formatar(rendRef, r.rendimento.unidade)}{:else}ficha sem rendimento: esta pesagem define{/if}{#if rendRef && lote?.rendimento && lote.rendimento !== rendRef}{' · '}<b class="var">{pct((lote.rendimento - rendRef) / rendRef)}</b>{:else if lote && !lote.rendimento}{' · '}<b class="var">pese e digite</b>{/if}</small>
        </span>
        <span class="campo">
         <input id="rend-{r.id}" inputmode={modoTeclado(r.rendimento.unidade)} enterkeyhint="done" autocomplete="off" placeholder="peso" aria-label="Rendimento pesado em {rotulo(r.rendimento.unidade)}"
          value={textoCampo(lote?.rendimento, r.rendimento.unidade)} oninput={(e) => digitarRendimento(r, e.currentTarget)}/>
         <span class="un">{rotulo(r.rendimento.unidade)}</span>
        </span>
       </label>
      </div>
      <input class="obs" placeholder="Observação (opcional): por que mudou?" maxlength="200" aria-label="Observação" value={lote?.obs ?? ''} onchange={(e) => {producao = definirObs(producao, r.id, e.currentTarget.value)}}/>
      {#if confirmarDesvio === r.id}<p class="alerta erro">Confira antes de finalizar: <b>{suspeitos(r).join(' · ')}</b>. Se estiver certo, toque de novo.</p>{/if}
      <button class="primary finalizar" class:pronto={!faltaParaFinalizar(r, lote)} onclick={() => finalizarReceita(r)}>{confirmarDesvio === r.id ? 'Está certo, finalizar' : 'Finalizar receita'}</button>
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
 <details class="bloco">
  <summary>Ajustes</summary>
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
 .manual{color:inherit;text-decoration:underline;text-underline-offset:2px}
 .fixo{position:sticky;top:0;z-index:6;background:var(--fundo);margin:0 -2px;padding:8px 2px;padding-top:calc(8px + env(safe-area-inset-top));border-bottom:1px solid var(--bd2)}
 .cabeca{display:flex;gap:8px;align-items:center}
 .titulo{flex:1;min-width:0}
 .nuvem{flex:0 0 auto;height:46px;border:1px solid var(--bd);background:var(--sup);border-radius:12px;padding:0 10px;font-size:14px;font-weight:700;white-space:nowrap}
 .n-ok{color:var(--v);border-color:var(--ok-b)} .n-pendente,.n-enviando{color:var(--av-t);border-color:var(--av-b);background:var(--av-f)} .n-recusado{color:var(--er-t);border-color:var(--er-b);background:var(--er-f)}
 .tema{flex:0 0 46px;height:46px;border:1px solid var(--bd);background:var(--sup);border-radius:12px;font-size:21px;color:var(--tx2);padding:0}
 .dados{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:8px;margin-top:8px}
 .dados input{padding:9px 10px;font-size:16px}
 .fichas.loja-THBT{--pri:#1d5fa8;--loja-f:#e8f0fa;--loja-b:#9dbde4}
 .fichas.loja-THBF{--loja-f:#e7f3ea;--loja-b:#9fc7ad}
 :global(html[data-tema='escuro']) .fichas.loja-THBT{--pri:#3b82d0;--loja-f:#132233;--loja-b:#2c5480}
 :global(html[data-tema='escuro']) .fichas.loja-THBF{--loja-f:#173326;--loja-b:#2f6b4b}
 .nome-loja{color:var(--pri)}
 .lojas{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
 .lojas button{display:grid;gap:2px;text-align:left;border:2px solid var(--bd);background:var(--sup);border-radius:12px;padding:9px 12px;color:var(--tx2);min-width:0}
 .lojas button b{font-size:17px}
 .lojas button small{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.85}
 .lojas .aba-THBF{--c:#1f6a43} .lojas .aba-THBT{--c:#1d5fa8}
 :global(html[data-tema='escuro']) .lojas .aba-THBF{--c:#2f8462} :global(html[data-tema='escuro']) .lojas .aba-THBT{--c:#3b82d0}
 .lojas button b{color:var(--c)}
 .lojas button.on{background:var(--c);border-color:var(--c);color:#fff}
 .lojas button.on b{color:#fff}
 .fichas{border-top:5px solid var(--pri);transition:border-color .2s}
 .pede-nome{margin-top:12px;padding:12px;border:1px dashed var(--loja-b);background:var(--loja-f);border-radius:10px}
 .pede-nome p{margin:0;font-size:15px;line-height:1.45;color:var(--tx2)}
 .pede-nome .primary{margin-top:10px}
 .quem-faz{font-size:14px;color:var(--tx2);margin:12px 0 0}
 .s-andamento small{display:block;font-size:12px;font-weight:600;opacity:.85;text-align:right}
 .busca{display:flex;gap:8px}
 .busca input{flex:1}
 .filtro{position:relative;flex:0 0 auto;border:1px solid var(--bd);background:var(--sup);border-radius:8px;padding:0 14px;font-size:15px;font-weight:600}
 .filtro.on{background:var(--pri);color:#fff;border-color:var(--pri)}
 .badge{position:absolute;top:-8px;right:-7px;display:grid;place-items:center;min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:#ff3b30;color:#fff;font-size:13px;font-weight:700;line-height:1;border:2px solid var(--fundo);pointer-events:none}
 .ficha{background:var(--sup);border:1px solid var(--bd);border-radius:12px;margin-bottom:8px;scroll-margin-top:76px;transition:border-color .2s,background .2s}
 .ficha.aberta{box-shadow:0 2px 10px #0001}
 .ficha.st-feita{border-color:var(--loja-b);background:var(--loja-f)}
 .ficha.st-andamento{border-color:var(--av-b);background:var(--av-f)}
 .cab{display:flex;align-items:center;gap:10px;width:100%;min-height:56px;border:0;background:transparent;text-align:left;padding:8px 12px}
 .num{flex:0 0 30px;height:30px;display:grid;place-items:center;border-radius:50%;background:var(--f1);font-size:13px;font-weight:700;color:var(--tx2);font-variant-numeric:tabular-nums}
 .nome{flex:1;min-width:0;font-size:17px;font-weight:650;line-height:1.25}
 .rend-ficha{font-size:13px;color:var(--tx3);white-space:nowrap;font-variant-numeric:tabular-nums}
 .selo{font-size:13px;font-weight:800;border-radius:99px;padding:3px 9px;white-space:nowrap}
 .s-feita{color:var(--pri)} .s-andamento{color:var(--av-t)}
 .feito{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--bd2)}
 .ft-info{flex:1;min-width:0;display:grid;gap:2px}
 .ft-info b{font-size:15px;color:var(--pri)}
 .ft-info small{font-size:13px;color:var(--tx3);font-variant-numeric:tabular-nums}
 .feito .link{padding:6px 0}
 .corpo{padding:2px 12px 12px;border-top:1px solid var(--bd2)}
 .dica{font-size:13px;line-height:1.45;color:var(--tx3);margin:-2px 0 8px}
 .linha.calc{border-top:2px solid var(--bd);background:var(--f1);min-height:48px}
 .calc-v{font-size:17px;font-variant-numeric:tabular-nums;padding-right:6px}
 select.quem{width:100%;min-width:0;border:1px solid var(--bd);border-radius:8px;padding:9px 10px;background:var(--sup);color:var(--tx);font-size:16px;font-weight:600}
 select.quem.vazio{color:var(--tx3);font-weight:400;border-color:var(--av-b);background:var(--av-f)}
 .seguiu{display:grid;gap:2px;width:100%;margin-top:12px;padding:12px 14px;border-radius:10px;border:1px solid var(--pri);background:var(--sup);color:var(--pri);font-size:17px;font-weight:700}
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
 @media(max-width:420px){.campo{flex-basis:118px}}
</style>
