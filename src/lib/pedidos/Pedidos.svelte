<script lang="ts">
 import {onDestroy, onMount} from 'svelte'
 import {
  SITUACOES, SITUACOES_EDITAVEIS, novoPedido, pedidoDaLista, validar, mudou, dataHora, descreverAlteracao, novoId,
  type Alteracao, type Card, type ItemPedido, type Loja, type Pedido, type Pessoa, type Situacao
 } from './modelo.ts'
 import {contexto, listar, abrir, salvar, ErroConflito} from './servidor.ts'
 import {ErroSincronizacao} from '../compras/sincronizar.ts'
 import {ler} from '../compras/armazenamento.ts'
 import {revisar, normalizar, rotuloItem, formatarQtd, lerQtd, qtdDecimal, type EstadoCompras, type Secao} from '../compras/estado.ts'

 const CHAVE_TOKEN = 'thb.compras.token'
 const CHAVE_PESSOA = 'thb.pedidos.pessoa'

 let token = $state('')
 let pessoas = $state<Pessoa[]>([])
 let lojas = $state<Loja[]>([])
 let pessoaId = $state<number | undefined>(undefined)
 let cards = $state<Card[]>([])
 let todos = $state(false)
 let tela = $state<'lista' | 'card'>('lista')
 let pedido = $state<Pedido | undefined>(undefined)
 let original = $state<Pedido | undefined>(undefined)
 let alteracoes = $state<Alteracao[]>([])
 let carregando = $state(false)
 let salvando = $state(false)
 let erro = $state('')
 let conflito = $state(false)
 let aviso = $state('')
 let descartar = $state(false)
 let catalogo = $state<EstadoCompras | undefined>(undefined)
 let busca = $state('')
 let mostrarHistorico = $state(false)

 const pessoa = $derived(pessoas.find(p => p.id === pessoaId))
 const lojaPorId = $derived(new Map(lojas.map(l => [l.id, l])))
 const alterado = $derived(!!pedido && !!original && (pedido.versao === 0 || mudou(pedido, original)))
 const erros = $derived(pedido ? validar(pedido) : [])
 const candidatos = $derived.by(() => {
  const q = normalizar(busca)
  if (!catalogo || q.length < 2 || !pedido) return []
  const ja = new Set(pedido.itens.map(i => i.catalogoId).filter(Boolean))
  return catalogo.itens.filter(i => !ja.has(i.id) && normalizar(i.nome).includes(q)).slice(0, 8)
 })

 onMount(async () => {
  try {
   token = localStorage.getItem(CHAVE_TOKEN) ?? ''
   const p = Number(localStorage.getItem(CHAVE_PESSOA)); if (p) pessoaId = p
  } catch {/* sem localStorage */}
  window.addEventListener('hashchange', lerEndereco)
  void ler<unknown>('estado').then(b => {catalogo = revisar(b)}).catch(() => {/* sem catálogo local */})
  if (!token) {erro = 'Este aparelho ainda não tem o token de compras. Configure em Compras → ⚙︎ → Ajustes e volte aqui.'; return}
  await executar(async () => {
   const c = await contexto(token)
   pessoas = c.pessoas; lojas = c.lojas
   if (pessoaId && !pessoas.some(p => p.id === pessoaId)) pessoaId = undefined
  })
  await lerEndereco()
 })
 onDestroy(() => window.removeEventListener('hashchange', lerEndereco))

 /** #/pedidos · #/pedidos/novo[/<seção>] · #/pedidos/<id> */
 async function lerEndereco() {
  const partes = location.hash.replace(/^#\/?/, '').split('/')
  if (partes[0] !== 'pedidos' || !token) return
  const alvo = partes[1]
  if (!alvo) {tela = 'lista'; pedido = undefined; original = undefined; await carregarLista(); return}
  if (alvo === 'novo') {if (!pedido || pedido.versao !== 0) await novo(partes[2] as Secao | undefined); return}
  if (pedido?.id !== alvo) await abrirCard(alvo)
 }
 function ir(caminho: string) {
  const h = `#/pedidos${caminho}`
  if (location.hash !== h) history.pushState(null, '', location.pathname + location.search + h)
  void lerEndereco()
 }

 async function executar(f: () => Promise<void>) {
  carregando = true; erro = ''
  try {await f()} catch (e) {erro = e instanceof Error ? e.message : 'Algo deu errado.'} finally {carregando = false}
 }
 async function carregarLista() {await executar(async () => {cards = await listar(token, todos)})}
 function alternarTodos() {todos = !todos; void carregarLista()}

 async function abrirCard(id: string) {
  await executar(async () => {
   const r = await abrir(token, id)
   pedido = r.pedido; original = structuredClone(r.pedido); alteracoes = r.alteracoes
   tela = 'card'; conflito = false; descartar = false; busca = ''; window.scrollTo({top: 0})
  })
 }
 async function novo(secao?: Secao) {
  let p = novoPedido(lojas.length === 1 ? [lojas[0].id] : [])
  if (secao === 'producao' || secao === 'bebidas') {
   const e = catalogo ?? revisar(await ler<unknown>('estado'))
   const r = pedidoDaLista(e, secao, lojas)
   p = r.pedido
   if (r.semLoja.length) avisar(`Ficaram de fora as listas sem loja no sistema: ${r.semLoja.join(', ')}.`)
   else if (!p.itens.length) avisar('A lista Montar desta seção está vazia: comece incluindo os itens aqui.')
  }
  pedido = p; original = structuredClone(p); alteracoes = []
  tela = 'card'; conflito = false; descartar = false; busca = ''; erro = ''
 }

 function escolherPessoa(v: string) {
  pessoaId = Number(v) || undefined
  try {if (pessoaId) localStorage.setItem(CHAVE_PESSOA, String(pessoaId)); else localStorage.removeItem(CHAVE_PESSOA)} catch {/* não persiste */}
 }
 function avisar(t: string) {aviso = t; setTimeout(() => {if (aviso === t) aviso = ''}, 4000)}

 async function gravar() {
  if (!pedido || erros.length) return
  if (!pessoaId) {erro = 'Escolha quem está fazendo o pedido.'; return}
  salvando = true; erro = ''
  try {
   const r = await salvar(token, pessoaId, $state.snapshot(pedido) as Pedido)
   avisar(r.versao === pedido.versao ? 'Nada mudou.' : `Pedido #${r.numero} salvo.`)
   const id = r.id
   pedido = undefined
   history.replaceState(null, '', location.pathname + location.search + `#/pedidos/${id}`)
   await abrirCard(id)
  } catch (e) {
   if (e instanceof ErroConflito) conflito = true
   erro = e instanceof Error ? e.message : 'Não foi possível salvar.'
  } finally {salvando = false}
 }
 async function recarregar() {if (pedido) {const id = pedido.id; pedido = undefined; await abrirCard(id)}}
 function voltar() {
  if (alterado && !descartar) {descartar = true; return}
  descartar = false; ir('')
 }

 // ------------------------------------------------------------ edição
 function alternarLoja(id: number) {
  if (!pedido) return
  pedido.lojas = pedido.lojas.includes(id) ? pedido.lojas.filter(x => x !== id) : [...pedido.lojas, id].sort((a, b) => a - b)
 }
 function incluirDoCatalogo(id: string) {
  const i = catalogo?.itens.find(x => x.id === id)
  if (!pedido || !i) return
  pedido.itens.push({id: novoId(), catalogoId: i.id, descricao: i.nome, unidade: i.unidade, grupo: i.grupo, qtd: {}})
  busca = ''
 }
 function incluirLivre() {
  if (!pedido || !busca.trim()) return
  pedido.itens.push({id: novoId(), descricao: busca.trim(), unidade: 'un', qtd: {}})
  busca = ''
 }
 function removerItem(id: string) {if (pedido) pedido.itens = pedido.itens.filter(i => i.id !== id)}
 function definirQtd(item: ItemPedido, lojaId: number, texto: string) {
  const n = lerQtd(texto)
  item.qtd[lojaId] = qtdDecimal(item) ? Math.round(n * 1000) / 1000 : Math.round(n)
 }
 function campo(n?: number) {return n ? String(n).replace('.', ',') : ''}
 function nomeSituacao(s: Situacao) {return SITUACOES.find(x => x.id === s)?.nome ?? s}
 function siglas(ids: number[]) {return ids.map(id => lojaPorId.get(id)).filter(Boolean) as Loja[]}
 function corLoja(l: Loja) {return l.sigla === 'THBT' ? 'tij' : l.sigla === 'THBF' ? 'freg' : 'outra'}
</script>

<section class="pedidos">
 <div class="topo">
  <p class="eyebrow">PEDIDOS DE COMPRA</p>
  <div class="quem">
   <label for="pessoa">Quem está usando</label>
   <select id="pessoa" value={pessoaId ?? ''} onchange={(e) => escolherPessoa(e.currentTarget.value)} disabled={!pessoas.length}>
    <option value="">Escolha seu nome…</option>
    {#each pessoas as p (p.id)}<option value={p.id}>{p.nome}</option>{/each}
   </select>
  </div>
 </div>

 {#if erro}<p class="alerta erro">{erro}{#if conflito} <button class="link" onclick={recarregar}>Recarregar a versão nova</button>{/if}</p>{/if}
 {#if aviso}<p class="alerta">{aviso}</p>{/if}

 {#if tela === 'lista'}
  <div class="barra-topo">
   <h1>Pedidos</h1>
   <button class="secondary" onclick={alternarTodos}>{todos ? 'Só abertos' : 'Ver todos'}</button>
   <button class="primary" onclick={() => ir('/novo')} disabled={!token || !lojas.length}>+ Novo pedido</button>
  </div>
  <p class="lead">Cada card é um pedido de compra. Toque para abrir, conferir e editar. Para trazer a lista que você montou em Compras, use <b>Gerar pedido</b> na tela Montar.</p>
  {#if carregando && !cards.length}<p class="vazio">Carregando…</p>{/if}
  <div class="cards">
   {#each cards as c (c.id)}
    <button class="card sit-{c.situacao}" onclick={() => ir(`/${c.id}`)}>
     <span class="c-cab"><strong>#{String(c.numero).padStart(4, '0')} Pedido de compra</strong><span class="badge">{nomeSituacao(c.situacao)}</span></span>
     <span class="c-quem">Pedido por {c.solicitante}</span>
     <span class="c-quando">{dataHora(c.criadoEm)}</span>
     <span class="chips">{#each siglas(c.lojas) as l (l.id)}<span class="chip {corLoja(l)}">{l.nome}</span>{/each}</span>
     <span class="c-info">{c.itens} {c.itens === 1 ? 'item' : 'itens'}{c.fornecedores ? ` · ${c.fornecedores} ${c.fornecedores === 1 ? 'fornecedor' : 'fornecedores'}` : ''}</span>
     <span class="c-info">Última edição: {c.atualizadoPor}, {dataHora(c.atualizadoEm)}</span>
    </button>
   {:else}
    {#if !carregando && token && !erro}<p class="vazio">Nenhum pedido {todos ? '' : 'aberto '}ainda.</p>{/if}
   {/each}
  </div>

 {:else if pedido}
  <div class="barra-topo">
   <button class="secondary" onclick={voltar}>{descartar ? 'Descartar mudanças?' : '← Pedidos'}</button>
   <h1>{pedido.numero ? `#${String(pedido.numero).padStart(4, '0')}` : 'Novo pedido'}</h1>
  </div>
  {#if pedido.versao}
   <p class="meta">Pedido por <b>{pedido.solicitante}</b> em {dataHora(pedido.criadoEm)} · última edição: {pedido.atualizadoPor}, {dataHora(pedido.atualizadoEm)}</p>
  {:else}
   <p class="meta">Será registrado em nome de <b>{pessoa?.nome ?? '(escolha seu nome acima)'}</b>, com data e hora do servidor.</p>
  {/if}

  <div class="bloco">
   <p class="rotulo">Lojas</p>
   <div class="lojas">
    {#each lojas as l (l.id)}
     <button class="loja {corLoja(l)}" class:on={pedido.lojas.includes(l.id)} aria-pressed={pedido.lojas.includes(l.id)} onclick={() => alternarLoja(l.id)}>{pedido.lojas.includes(l.id) ? '✓ ' : ''}{l.nome} <small>{l.sigla}</small></button>
    {/each}
   </div>
   <div class="campos">
    <label>Situação
     <select bind:value={pedido.situacao}>
      {#each SITUACOES.filter(s => SITUACOES_EDITAVEIS.includes(s.id) || s.id === pedido!.situacao) as s (s.id)}<option value={s.id}>{s.nome}</option>{/each}
     </select>
    </label>
    <label>Fornecedor <input bind:value={pedido.fornecedor} placeholder="Um ou vários (opcional)"/></label>
    <label>Vendedor <input bind:value={pedido.vendedor} placeholder="Nome do vendedor"/></label>
   </div>
   <label class="obs">Observação <input bind:value={pedido.observacao} placeholder="Opcional"/></label>
   {#if pedido.situacao === 'enviado' && original?.situacao !== 'enviado'}<p class="small">Ao salvar como enviado, esta versão vira a lista sagrada: as próximas etapas conferem contra ela.</p>{/if}
  </div>

  <div class="bloco">
   <p class="rotulo">Itens ({pedido.itens.length})</p>
   {#if !pedido.lojas.length}<p class="small">Marque as lojas para digitar as quantidades.</p>{/if}
   <div class="itens">
    {#each pedido.itens as item (item.id)}
     <div class="item">
      <div class="i-nome">
       <input class="desc" bind:value={item.descricao} aria-label="Nome do item"/>
       <input class="unid" bind:value={item.unidade} aria-label="Unidade de {item.descricao}"/>
       <button class="x" aria-label="Remover {item.descricao}" onclick={() => removerItem(item.id)}>×</button>
      </div>
      <div class="i-qtd">
       {#each siglas(pedido.lojas) as l (l.id)}
        <label class="q {corLoja(l)}"><span>{l.sigla}</span>
         <input value={campo(item.qtd[l.id])} placeholder="0" inputmode={qtdDecimal(item) ? 'decimal' : 'numeric'}
          aria-label="Quantidade de {item.descricao} em {l.nome}" onchange={(e) => definirQtd(item, l.id, e.currentTarget.value)}/>
        </label>
       {/each}
       <input class="forn" bind:value={item.fornecedor} placeholder="fornecedor deste item" aria-label="Fornecedor de {item.descricao}"/>
      </div>
     </div>
    {/each}
   </div>
   <div class="incluir">
    <input type="search" bind:value={busca} placeholder="Incluir item: digite o nome…" aria-label="Incluir item"
     onkeydown={(e) => {if (e.key === 'Enter') {e.preventDefault(); if (candidatos.length) incluirDoCatalogo(candidatos[0].id); else incluirLivre()}}}/>
    {#if busca.trim()}
     <div class="sugestoes">
      {#each candidatos as c (c.id)}<button onclick={() => incluirDoCatalogo(c.id)}>{rotuloItem(c)}</button>{/each}
      <button class="livre" onclick={incluirLivre}>+ Incluir “{busca.trim()}” como item novo</button>
     </div>
    {/if}
   </div>
  </div>

  {#if erros.length && alterado}<ul class="erros">{#each erros as e (e)}<li>{e}</li>{/each}</ul>{/if}
  <div class="barra">
   <button class="primary" onclick={gravar} disabled={salvando || !alterado || !!erros.length || !pessoaId || conflito}>{salvando ? 'Salvando…' : alterado ? 'Salvar pedido' : 'Salvo ✓'}</button>
  </div>

  {#if alteracoes.length}
   <div class="bloco">
    <button class="link" onclick={() => mostrarHistorico = !mostrarHistorico}>{mostrarHistorico ? '▾' : '▸'} Registro de alterações ({alteracoes.length})</button>
    {#if mostrarHistorico}
     <ol class="historico">
      {#each alteracoes as a, i (i)}
       <li><span class="h-quando">v{a.versao} · {dataHora(a.em)}</span> <b>{a.autor}</b> {descreverAlteracao(a, lojas)}</li>
      {/each}
     </ol>
    {/if}
   </div>
  {/if}
 {/if}
</section>

<style>
 .pedidos{--sup:#fff;--fundo:#f5f4ef;--tx:#10251f;--tx2:#45594f;--tx3:#65766f;--bd:#c7d2c8;--bd2:#eef1ec;--pri:#193f35;--er-f:#f8e5e0;--er-b:#e3b9ae;--er-t:#8f3e2c;--av-f:#fcf3dc;--av-b:#e7c98e;--av-t:#7a5a1d;--tij:#1d5fa8;--tij-f:#e8f0fa;--freg:#1f6a43;--freg-f:#e7f3ea;max-width:860px;padding-bottom:110px;color:var(--tx)}
 button{font:inherit;cursor:pointer;color:inherit}
 button:disabled{opacity:.35;cursor:default}
 input,select{width:100%;min-width:0;border:1px solid var(--bd);border-radius:8px;padding:9px 10px;background:var(--sup);color:var(--tx);font-size:16px;box-sizing:border-box}
 .eyebrow{font-size:12px;font-weight:700;letter-spacing:2px;color:var(--tx3);margin:0}
 h1{font-size:22px;font-weight:650;margin:0;flex:1}
 .lead,.meta{font-size:15px;line-height:1.5;color:var(--tx2);margin:10px 0}
 .small{font-size:13px;color:var(--tx3);margin:8px 0 0}
 .topo{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:end;justify-content:space-between;padding-top:12px}
 .quem{display:flex;gap:8px;align-items:center;font-size:14px;color:var(--tx2)} .quem select{width:auto;min-width:200px}
 .alerta{font-size:14px;line-height:1.45;color:var(--av-t);background:var(--av-f);border:1px solid var(--av-b);border-radius:8px;padding:9px 12px;margin:10px 0 0}
 .alerta.erro{color:var(--er-t);background:var(--er-f);border-color:var(--er-b)}
 .barra-topo{display:flex;gap:8px;align-items:center;margin-top:16px}
 .primary,.secondary{border-radius:10px;padding:10px 14px;font-weight:650;white-space:nowrap}
 .primary{background:var(--pri);color:#fff;border:1px solid var(--pri)}
 .secondary{background:var(--sup);border:1px solid var(--bd)}
 .link{background:none;border:0;padding:0;color:var(--tij);font-weight:600;text-decoration:underline}
 .vazio{color:var(--tx3);padding:24px 0;text-align:center}
 .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;margin-top:12px}
 .card{display:grid;gap:6px;text-align:left;background:var(--sup);border:1px solid var(--bd);border-radius:12px;padding:14px 16px}
 .card.sit-rascunho,.card.sit-enviado,.card.sit-em_andamento{border:2px solid var(--tij)}
 .c-cab{display:flex;gap:8px;align-items:center;justify-content:space-between} .c-cab strong{font-size:17px}
 .badge{font-size:12px;border:1px solid var(--bd);border-radius:999px;padding:3px 10px;color:var(--tx2);white-space:nowrap}
 .sit-em_andamento .badge,.sit-enviado .badge{background:var(--av-f);border-color:var(--av-b);color:var(--av-t)}
 .c-quem{font-size:15px} .c-quando,.c-info{font-size:13px;color:var(--tx3)}
 .chips{display:flex;gap:6px;flex-wrap:wrap}
 .chip{font-size:12px;border-radius:999px;padding:3px 10px;border:1px solid var(--bd)}
 .chip.tij{background:var(--tij-f);border-color:var(--tij);color:var(--tij)} .chip.freg{background:var(--freg-f);border-color:var(--freg);color:var(--freg)}
 .bloco{background:var(--sup);border:1px solid var(--bd);border-radius:12px;padding:12px 14px;margin-top:12px}
 .rotulo{font-size:12px;font-weight:700;letter-spacing:1px;color:var(--tx3);text-transform:uppercase;margin:0 0 8px}
 .lojas{display:flex;gap:8px;flex-wrap:wrap}
 .loja{border:2px solid var(--bd);background:var(--sup);border-radius:10px;padding:8px 14px;font-weight:650}
 .loja small{color:var(--tx3);font-weight:500}
 .loja.on.tij{border-color:var(--tij);background:var(--tij-f);color:var(--tij)} .loja.on.freg{border-color:var(--freg);background:var(--freg-f);color:var(--freg)} .loja.on.outra{border-color:var(--pri)}
 .campos{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-top:12px}
 label{display:grid;gap:4px;font-size:13px;color:var(--tx2)} .obs{margin-top:8px}
 .itens{display:grid;gap:8px}
 .item{border-bottom:1px solid var(--bd2);padding-bottom:8px}
 .i-nome{display:grid;grid-template-columns:1fr 84px 36px;gap:6px}
 .x{border:1px solid var(--bd);background:var(--sup);border-radius:8px;font-size:20px;line-height:1;padding:0}
 .i-qtd{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;align-items:center}
 .q{display:flex;align-items:center;gap:4px;grid-template-columns:none} .q span{font-size:12px;font-weight:700} .q input{width:80px;text-align:right}
 .q.tij span{color:var(--tij)} .q.freg span{color:var(--freg)}
 .forn{flex:1;min-width:150px;font-size:14px}
 .incluir{margin-top:10px;position:relative}
 .sugestoes{display:grid;border:1px solid var(--bd);border-radius:8px;margin-top:4px;overflow:hidden}
 .sugestoes button{background:var(--sup);border:0;border-bottom:1px solid var(--bd2);text-align:left;padding:10px 12px}
 .sugestoes .livre{color:var(--tij);font-weight:600}
 .erros{color:var(--er-t);font-size:14px;margin:10px 0 0;padding-left:20px}
 .barra{position:sticky;bottom:0;display:flex;justify-content:flex-end;padding:12px 0}
 .barra .primary{box-shadow:0 4px 14px #0003}
 .historico{list-style:none;padding:0;margin:8px 0 0;display:grid;gap:6px;font-size:14px}
 .h-quando{color:var(--tx3);font-size:12px}
 @media (max-width:520px){.topo{align-items:stretch}.quem{flex-direction:column;align-items:stretch}.quem select{min-width:0}.barra-topo h1{font-size:19px}}
</style>
