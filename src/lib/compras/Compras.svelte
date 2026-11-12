<script lang="ts">
 import {onDestroy, onMount, tick} from 'svelte'
 import {
  ESTADO_INICIAL, GRUPOS, EMOJI_GRUPO, CORES, revisar, criarLista, atualizarLista, removerLista, criarItem, atualizarItem,
  removerItem, definirQuantidade, alternarStatus, marcarItem, registrarPesquisa, novaRodada, metricas, relatorio,
  normalizar, ordemGrupo, type EstadoCompras, type Item, type Lista, type Status, type ModoRelatorio, type Entrada
 } from './estado.ts'
 import {indexar, resumir, compararGondola, produtoPorGtin, produtosDosVinculos, reais, formatarConteudo,
  type Snapshot, type Resumo, type Vinculo, type ProdutoInfo} from './precos.ts'
 import {buscarCandidatos, rotuloVinculo, mesmoVinculo} from './vinculo.ts'
 import {importarLista2601} from './semente.ts'
 import {baixarSnapshot, ErroSincronizacao, validarSnapshot} from './sincronizar.ts'
 import {ler, gravar, pedirPersistencia} from './armazenamento.ts'
 import {rotulo, UNIDADES, type Unidade} from './unidades.ts'
 import {copiarTexto} from '../clipboard'

 const CHAVE_TOKEN = 'thb.compras.token'
 const CHAVE_JANELA = 'thb.compras.janela'
 const JANELAS = [{d: 30, r: '30 dias'}, {d: 90, r: '90 dias'}, {d: 180, r: '180 dias'}, {d: 0, r: 'Tudo'}]

 let estado = $state<EstadoCompras>(ESTADO_INICIAL)
 let snapshot = $state<Snapshot | undefined>(undefined)
 let carregado = $state(false)
 let emDisco = $state(true)
 let aba = $state<'semana' | 'itens' | 'listas' | 'precos'>('semana')
 let filtroLista = $state<string>('todas')
 let filtroStatus = $state<'todos' | Status>('todos')
 let busca = $state('')
 let aberto = $state('')
 let destaque = $state('')
 let aviso = $state('')
 let copiado = $state('')
 let confirmar = $state('')
 // sincronização
 let token = $state('')
 let janela = $state(90)
 let sincronizando = $state(false)
 let erroSync = $state('')
 // editor de item
 let editId = $state<string | undefined>(undefined)
 let eNome = $state(''); let eGrupo = $state('Outros'); let eQtd = $state(''); let eUnid = $state<Unidade>('un')
 let eVinculos = $state<Vinculo[]>([]); let eQuant = $state<Record<string, string>>({}); let eBusca = $state('')
 // adicionar à lista
 let addBusca = $state(''); let addLista = $state(''); let addQtd = $state('')
 // gôndola
 let gPreco = $state(''); let gQtd = $state(''); let gUnid = $state<Unidade>('un')
 // nova lista
 let novaListaNome = $state(''); let novaListaTipo = $state<Lista['tipo']>('loja')
 // leitura de EAN
 let lendo = $state(false); let video = $state<HTMLVideoElement>(); let pararLeitura: (() => void) | undefined
 let lidoProduto = $state<ProdutoInfo | undefined>(undefined); let lidoCodigo = $state('')
 let arquivoBackup = $state<HTMLInputElement>()

 const indice = $derived(snapshot ? indexar(snapshot) : undefined)
 const listas = $derived([...estado.listas].sort((a, b) => a.ordem - b.ordem))
 const listaPorId = $derived(new Map(listas.map(l => [l.id, l])))
 const visiveis = $derived(filtroLista === 'todas' ? listas.map(l => l.id) : [filtroLista])
 const itemPorId = $derived(new Map(estado.itens.map(i => [i.id, i])))
 const resumos = $derived.by(() => {
  const m = new Map<string, Resumo>()
  if (!indice) return m
  for (const i of estado.itens) {const r = resumir(indice, i.vinculos, janela); if (r) m.set(i.id, r)}
  return m
 })
 const contagem = $derived(metricas(estado, visiveis))
 /** Itens da semana agrupados, já filtrados por lista, status e busca. */
 const semana = $derived.by(() => {
  const q = normalizar(busca)
  const porItem = new Map<string, Entrada[]>()
  for (const x of estado.entradas) if (visiveis.includes(x.listaId)) porItem.set(x.itemId, [...(porItem.get(x.itemId) ?? []), x])
  const grupos = new Map<string, {item: Item, entradas: Entrada[]}[]>()
  for (const [itemId, entradas] of porItem) {
   const item = itemPorId.get(itemId)
   if (!item) continue
   if (filtroStatus !== 'todos' && !entradas.some(x => x.status === filtroStatus)) continue
   if (q && !normalizar(item.nome).includes(q)) continue
   const ord = entradas.sort((a, b) => (listaPorId.get(a.listaId)?.ordem ?? 0) - (listaPorId.get(b.listaId)?.ordem ?? 0))
   grupos.set(item.grupo, [...(grupos.get(item.grupo) ?? []), {item, entradas: ord}])
  }
  return [...grupos.entries()].sort((a, b) => ordemGrupo(a[0]) - ordemGrupo(b[0]) || a[0].localeCompare(b[0]))
   .map(([g, its]) => ({grupo: g, itens: its.sort((a, b) => a.item.nome.localeCompare(b.item.nome, 'pt-BR'))}))
 })
 const totalVisivel = $derived(semana.reduce((s, g) => s + g.itens.length, 0))
 const catalogo = $derived([...estado.itens].sort((a, b) => ordemGrupo(a.grupo) - ordemGrupo(b.grupo) || a.grupo.localeCompare(b.grupo) || a.nome.localeCompare(b.nome, 'pt-BR')))
 const semVinculo = $derived(estado.itens.filter(i => !i.vinculos.length).length)
 const semHistorico = $derived(indice ? estado.itens.filter(i => i.vinculos.length && !resumos.has(i.id)).length : 0)
 const periodo = $derived(snapshot?.obs.length ? `${dataCurta(snapshot.obs[0][1], true)} a ${dataCurta(snapshot.obs.at(-1)![1], true)}` : '')
 const candidatosEditor = $derived(indice && editId !== undefined ? buscarCandidatos(indice, eBusca || eNome).filter(c => !eVinculos.some(v => mesmoVinculo(v, c.vinculo))) : [])
 const resumoEditor = $derived(indice && editId !== undefined && eVinculos.length ? resumir(indice, eVinculos, janela) : undefined)
 const resultadosAdd = $derived.by(() => {
  const q = normalizar(addBusca)
  if (!q) return []
  return estado.itens.filter(i => normalizar(i.nome).includes(q)).slice(0, 6)
 })

 onMount(async () => {
  try {token = localStorage.getItem(CHAVE_TOKEN) ?? ''; const salvo = localStorage.getItem(CHAVE_JANELA); const j = Number(salvo); if (salvo !== null && JANELAS.some(x => x.d === j)) janela = j} catch {/* sem localStorage */}
  const [bruto, snap] = await Promise.all([ler<unknown>('estado'), ler<unknown>('snapshot')])
  estado = revisar(bruto)
  if (validarSnapshot(snap)) snapshot = snap
  carregado = true
  void pedirPersistencia()
  if (token && (!snapshot || Date.now() - Date.parse(snapshot.geradoEm) > 6 * 3600e3)) void sincronizar(true)
 })
 onDestroy(pararCamera)

 // Grava a cada mudança (o IndexedDB clona estruturalmente; o proxy do $state não é clonável).
 $effect(() => {
  const copia = $state.snapshot(estado)
  if (!carregado) return
  void gravar('estado', copia).then(ok => {emDisco = ok})
 })

 /** Baixa os preços do Supabase e grava no aparelho. */
 async function sincronizar(silencioso = false) {
  if (!token.trim()) {erroSync = 'Informe o token de sincronização.'; aba = 'precos'; return}
  sincronizando = true; erroSync = ''
  try {
   const s = await baixarSnapshot(token)
   snapshot = s
   await gravar('snapshot', s)
   try {localStorage.setItem(CHAVE_TOKEN, token.trim())} catch {/* não persiste */}
   if (!silencioso) avisar(`Preços atualizados: ${s.obs.length} compras.`)
  } catch (e) {
   const msg = e instanceof ErroSincronizacao ? e.message : 'Falha ao sincronizar.'
   if (!silencioso || (e instanceof ErroSincronizacao && e.tipo === 'token')) erroSync = msg
  } finally {sincronizando = false}
 }

 function escolherJanela(d: number) {janela = d; try {localStorage.setItem(CHAVE_JANELA, String(d))} catch {/* não persiste */}}
 function avisar(t: string) {aviso = t; setTimeout(() => {if (aviso === t) aviso = ''}, 2600)}
 function confirmarDuasVezes(chave: string, acao: () => void) {
  if (confirmar !== chave) {confirmar = chave; setTimeout(() => {if (confirmar === chave) confirmar = ''}, 3000); return}
  confirmar = ''; acao()
 }
 function dataCurta(iso: string, ano = false) {const [y, m, d] = iso.split('-'); return ano ? `${d}/${m}/${y.slice(2)}` : `${d}/${m}`}
 function porUnid(r: Resumo) {return `/${rotulo(r.unidade)}`}
 function vibrar(p: number | number[]) {try {navigator.vibrate?.(p)} catch {/* sem haptics */}}

 // ---------- semana ----------
 function tocar(listaId: string, itemId: string, s: Exclude<Status, 'pendente'>) {estado = alternarStatus(estado, listaId, itemId, s); vibrar(s === 'comprado' ? 30 : [20, 40, 20])}
 function tocarTudo(itemId: string, entradas: Entrada[], s: Exclude<Status, 'pendente'>) {
  const todos = entradas.every(x => x.status === s)
  estado = marcarItem(estado, itemId, entradas.map(x => x.listaId), todos ? 'pendente' : s); vibrar(30)
 }
 function abrir(item: Item) {
  if (aberto === item.id) {aberto = ''; return}
  aberto = item.id
  const p = estado.pesquisa[item.id]
  const ultima = resumos.get(item.id)?.ultima
  gPreco = p ? String(p.preco).replace('.', ',') : ''
  if (p) {gQtd = String(p.qtd).replace('.', ','); gUnid = p.unidade}
  else if (item.embalagem) {gQtd = String(item.embalagem.qtd).replace('.', ','); gUnid = item.embalagem.unidade}
  else {gQtd = '1'; gUnid = resumos.get(item.id)?.unidade ?? 'un'}
  void ultima
 }
 function num(t: string): number {const n = Number(t.trim().replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN}
 function numDecimal(t: string): number {const n = Number(t.trim().replace(',', '.')); return Number.isFinite(n) ? n : NaN}
 function salvarGondola(item: Item) {
  const preco = num(gPreco), qtd = numDecimal(gQtd)
  estado = registrarPesquisa(estado, item.id, preco > 0 && qtd > 0 ? {preco, qtd, unidade: gUnid, em: Date.now()} : undefined)
 }
 function comparacao(item: Item) {
  const p = estado.pesquisa[item.id], r = resumos.get(item.id)
  return p && r ? compararGondola(r, p.preco, p.qtd, p.unidade) : undefined
 }
 function pct(v?: number) {return v == null ? '' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`}
 async function copiarRelatorio(modo: ModoRelatorio) {
  const titulo = `THB – COMPRAS ${estado.rodadaNome || new Date().toLocaleDateString('pt-BR')}`
  const txt = relatorio(estado, visiveis, modo, titulo)
  if (await copiarTexto(txt)) {copiado = modo; vibrar(40); setTimeout(() => {if (copiado === modo) copiado = ''}, 1800)}
 }
 function iniciarRodada(manter: boolean) {
  const nome = new Date().toLocaleDateString('pt-BR')
  confirmarDuasVezes(manter ? 'rodada' : 'rodada-zero', () => {estado = novaRodada(estado, manter, nome); aberto = ''; avisar(`Nova semana: ${nome}`)})
 }
 function adicionarNaLista(item: Item) {
  const listaId = filtroLista !== 'todas' ? filtroLista : (addLista || listas[0]?.id)
  if (!listaId) {avisar('Crie uma lista primeiro.'); aba = 'listas'; return}
  estado = definirQuantidade(estado, listaId, item.id, addQtd.trim() || '01')
  addBusca = ''; addQtd = ''; destacar(item.id)
 }
 function criarEAdicionar() {
  const nome = addBusca.trim()
  if (!nome) return
  const r = criarItem(estado, {nome, grupo: 'Outros', vinculos: indice ? sugestaoAutomatica(nome) : []})
  estado = r.estado
  adicionarNaLista(r.item)
 }
 /** Primeiro candidato com boa pontuação vira vínculo inicial; o usuário confere no editor. */
 function sugestaoAutomatica(nome: string): Vinculo[] {
  const c = indice ? buscarCandidatos(indice, nome, 1)[0] : undefined
  return c && c.pontos >= 1 ? [c.vinculo] : []
 }
 function destacar(id: string) {destaque = id; setTimeout(() => {if (destaque === id) destaque = ''}, 1600)}

 // ---------- editor ----------
 function editar(item?: Item, nomeInicial = '') {
  editId = item?.id ?? ''
  eNome = item?.nome ?? nomeInicial; eGrupo = item?.grupo ?? 'Outros'
  eQtd = item?.embalagem ? String(item.embalagem.qtd).replace('.', ',') : ''; eUnid = item?.embalagem?.unidade ?? 'un'
  eVinculos = item ? [...item.vinculos] : []; eBusca = ''
  eQuant = Object.fromEntries(listas.map(l => [l.id, item ? estado.entradas.find(x => x.itemId === item.id && x.listaId === l.id)?.quantidade ?? '' : '']))
  if (aba !== 'itens') aba = 'itens'
  void tick().then(() => document.getElementById('editor-item')?.scrollIntoView({behavior: 'smooth', block: 'start'}))
 }
 function salvarItem() {
  const nome = eNome.trim()
  if (!nome) {avisar('Dê um nome ao item.'); return}
  const q = numDecimal(eQtd)
  const embalagem = q > 0 ? {qtd: q, unidade: eUnid} : undefined
  let id = editId
  if (id) estado = atualizarItem(estado, id, {nome, grupo: eGrupo, embalagem, vinculos: $state.snapshot(eVinculos)})
  else {const r = criarItem(estado, {nome, grupo: eGrupo, embalagem, vinculos: $state.snapshot(eVinculos)}); estado = r.estado; id = r.item.id}
  for (const l of listas) estado = definirQuantidade(estado, l.id, id!, eQuant[l.id] ?? '')
  editId = undefined; destacar(id!); avisar('Item salvo.')
 }
 function excluirItem() {
  const id = editId
  if (!id) {editId = undefined; return}
  confirmarDuasVezes('excluir-item', () => {estado = removerItem(estado, id); editId = undefined; avisar('Item excluído.')})
 }

 // ---------- listas ----------
 function novaLista() {const r = criarLista(estado, novaListaNome, novaListaTipo); estado = r.estado; novaListaNome = ''; avisar(`Lista ${r.lista.nome} criada.`)}
 function moverLista(l: Lista, d: -1 | 1) {
  const i = listas.findIndex(x => x.id === l.id), j = i + d
  if (j < 0 || j >= listas.length) return
  const outra = listas[j]
  estado = atualizarLista(atualizarLista(estado, l.id, {ordem: outra.ordem}), outra.id, {ordem: l.ordem})
 }
 function importar2601() {estado = importarLista2601(estado); avisar('Lista de 26/01 importada (Freguesia e Tijuca).'); aba = 'semana'}
 function baixarBackup() {
  const blob = new Blob([JSON.stringify($state.snapshot(estado), null, 1)], {type: 'application/json'})
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `thb-compras-${new Date().toISOString().slice(0, 10)}.json`
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000)
 }
 async function restaurarBackup(f?: File) {
  if (!f) return
  try {
   const e = revisar(JSON.parse(await f.text()))
   if (!e.listas.length && !e.itens.length) throw new Error()
   estado = e; avisar(`Backup restaurado: ${e.listas.length} listas, ${e.itens.length} itens.`)
  } catch {avisar('Arquivo de backup inválido.')}
 }

 // ---------- leitura de EAN ----------
 async function lerCodigo() {
  lidoProduto = undefined; lidoCodigo = ''; lendo = true
  try {
   const [{iniciarLeitura}, {readerOptionsProduto, criarConfirmador}] = await Promise.all([import('../camera-scanner'), import('../scanner')])
   await tick()
   const confirma = criarConfirmador(2)
   const r = await iniciarLeitura(video!, texto => {
    if (!confirma(texto)) return
    pararCamera(); tratarCodigo(texto)
   }, {opcoes: readerOptionsProduto()})
   if (!lendo) r.parar(); else pararLeitura = r.parar
  } catch {pararCamera(); avisar('Não foi possível abrir a câmera.')}
 }
 function pararCamera() {pararLeitura?.(); pararLeitura = undefined; lendo = false}
 function tratarCodigo(codigo: string) {
  vibrar(60); lidoCodigo = codigo
  const p = indice ? produtoPorGtin(indice, codigo) : undefined
  lidoProduto = p
  if (!p) return
  const item = estado.itens.find(i => indice && produtosDosVinculos(indice, i.vinculos).has(p.chave))
  if (item && estado.entradas.some(x => x.itemId === item.id && visiveis.includes(x.listaId))) {
   busca = ''; filtroStatus = 'todos'; aberto = ''; abrir(item); destacar(item.id); lidoProduto = undefined
   void tick().then(() => document.getElementById(`item-${item.id}`)?.scrollIntoView({behavior: 'smooth', block: 'center'}))
  }
 }
 function vinculoDoProduto(p: ProdutoInfo): Vinculo {return p.insumo != null ? {tipo: 'insumo', id: p.insumo} : {tipo: 'produto', chave: p.chave}}
 function itemDoProduto(p: ProdutoInfo): Item | undefined {return estado.itens.find(i => indice && produtosDosVinculos(indice, i.vinculos).has(p.chave))}
 function adicionarProdutoLido(p: ProdutoInfo) {
  let item = itemDoProduto(p)
  if (!item) {
   const nome = p.insumo != null ? (indice?.insumos.get(p.insumo)?.descricao ?? p.descricao) : p.descricao
   const emb = p.embalagens ? Object.values(p.embalagens)[0] : undefined
   const r = criarItem(estado, {nome, grupo: 'Outros', vinculos: [vinculoDoProduto(p)], embalagem: emb ? {qtd: emb[0], unidade: emb[1]} : undefined})
   estado = r.estado; item = r.item
  }
  adicionarNaLista(item); lidoProduto = undefined; lidoCodigo = ''
 }
</script>

{#snippet precos(item: Item, r: Resumo | undefined, compacto: boolean)}
 {#if r}
  {@const c = comparacao(item)}
  <div class="precos" class:compacto>
   <div class="caixa">
    <span class="rot">Último · {dataCurta(r.ultima!.data)}</span>
    <strong>{reais(r.ultima!.precoUnit)}<small>{porUnid(r)}</small></strong>
    <span class="det">{r.ultima!.fornecedor}{#if r.ultima!.embalagem && r.ultima!.embalagem !== `1 ${r.unidade}`} · {reais(r.ultima!.precoEmbalagem)} por {r.ultima!.embalagem}{/if}</span>
   </div>
   <div class="caixa media">
    <span class="rot">Média {r.mediaHistorico || r.janelaDias === 0 ? 'histórico' : `${r.janelaDias}d`}</span>
    <strong>{r.media ? reais(r.media) : '—'}<small>{porUnid(r)}</small></strong>
    <span class="det">{r.min != null && r.max != null && r.max - r.min > 0.005 ? `${reais(r.min)} – ${reais(r.max)}` : 'estável'} · {r.compras.length} {r.compras.length === 1 ? 'compra' : 'compras'}</span>
   </div>
   {#if r.compras.length > 1}
    {@const serie = r.compras.slice(-12).map(x => x.precoUnit)}
    {@const lo = Math.min(...serie)}{@const hi = Math.max(...serie)}
    <svg class="spark" viewBox="0 0 64 28" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" points={serie.map((v, i) => `${(i / (serie.length - 1)) * 60 + 2},${hi - lo < 1e-9 ? 14 : 24 - ((v - lo) / (hi - lo)) * 20}`).join(' ')}/><circle cx="62" cy={hi - lo < 1e-9 ? 14 : 24 - ((serie.at(-1)! - lo) / (hi - lo)) * 20} r="2.4" fill="currentColor"/></svg>
   {/if}
  </div>
  {#if c}<p class="veredito v-{c.veredito}">Gôndola {reais(c.precoUnit)}{porUnid(r)} · {pct(c.vsMedia)} vs média{#if c.vsUltima != null}{' · '}{pct(c.vsUltima)} vs último{/if}{' · '}<strong>{c.veredito === 'barato' ? 'abaixo da média' : c.veredito === 'caro' ? 'acima da média' : 'na média'}</strong></p>{/if}
 {:else if item.vinculos.length}
  <p class="sem-hist">{indice ? 'Sem compra com NF-e para este vínculo.' : 'Sincronize os preços para ver o histórico.'}</p>
 {:else}
  <p class="sem-hist">Sem vínculo com compras · <button class="link" onclick={() => editar(item)}>vincular</button></p>
 {/if}
{/snippet}

<section class="compras">
 <div class="topo">
  <div><p class="eyebrow">COMPRAS DA SEMANA{#if estado.rodadaNome}{' · '}{estado.rodadaNome}{/if}</p>
   <h1>Lista e preço lado a lado.</h1></div>
  <button class="sync" class:girando={sincronizando} onclick={() => sincronizar()} disabled={sincronizando} title="Sincronizar preços">{sincronizando ? '⟳' : '⟳'}<span>{snapshot ? `preços de ${dataCurta(snapshot.geradoEm.slice(0, 10))}` : 'sem preços'}</span></button>
 </div>
 <nav class="abas" aria-label="Seções de compras">
  {#each [['semana', 'Semana'], ['itens', 'Itens'], ['listas', 'Listas'], ['precos', 'Preços']] as [id, r] (id)}
   <button class:on={aba === id} onclick={() => {aba = id as typeof aba; editId = undefined}}>{r}{#if id === 'itens' && semVinculo}<i>{semVinculo}</i>{/if}</button>
  {/each}
 </nav>
 {#if !emDisco}<p class="alerta">Este navegador não está guardando os dados (aba privada?). Baixe um backup em Listas.</p>{/if}
 {#if erroSync}<p class="alerta">{erroSync}</p>{/if}

 {#if aba === 'semana'}
  {#if !listas.length}
   <div class="vazio"><p>Nenhuma lista ainda.</p><button class="primary" onclick={importar2601}>Importar a lista de 26/01 (Freguesia + Tijuca)</button><button class="secondary" onclick={() => aba = 'listas'}>Criar lista do zero</button></div>
  {:else}
   <div class="metricas">
    {#each [['comprado', 'Comprados', '✓'], ['indisponivel', 'Não tem', '✕'], ['pendente', 'Pendentes', '◷']] as [s, r, ic] (s)}
     <button class="metrica m-{s}" class:on={filtroStatus === s} onclick={() => filtroStatus = filtroStatus === s ? 'todos' : s as Status}><strong>{contagem[s as Status]}</strong><span>{ic} {r}</span></button>
    {/each}
   </div>
   <div class="filtro-listas" role="tablist">
    <button role="tab" aria-selected={filtroLista === 'todas'} class:on={filtroLista === 'todas'} onclick={() => filtroLista = 'todas'}>Todas</button>
    {#each listas as l (l.id)}<button role="tab" aria-selected={filtroLista === l.id} class:on={filtroLista === l.id} style="--cor:{l.cor}" onclick={() => filtroLista = l.id}><b class="sigla">{l.sigla}</b>{l.nome}</button>{/each}
   </div>
   <div class="busca">
    <input type="search" bind:value={busca} placeholder="Buscar na lista…" aria-label="Buscar item na lista"/>
    <button class="ean" onclick={lendo ? pararCamera : lerCodigo} aria-label="Ler código de barras do produto">{lendo ? '✕' : '▥'}<span>{lendo ? 'Fechar' : 'Ler EAN'}</span></button>
   </div>
   {#if lendo}<div class="camera"><video bind:this={video} autoplay muted playsinline aria-label="Câmera lendo código de barras"></video><span class="mira" aria-hidden="true"></span></div>{/if}
   {#if lidoCodigo && !lendo}
    <div class="lido">
     {#if lidoProduto}
      {@const r = indice ? resumir(indice, [vinculoDoProduto(lidoProduto)], janela) : undefined}
      {@const ja = itemDoProduto(lidoProduto)}
      <p class="eyebrow">EAN {lidoCodigo} · {lidoProduto.fornecedor}</p>
      <h3>{lidoProduto.descricao}</h3>
      {#if r}
       <div class="precos"><div class="caixa"><span class="rot">Último · {dataCurta(r.ultima!.data)}</span><strong>{reais(r.ultima!.precoUnit)}<small>/{rotulo(r.unidade)}</small></strong></div><div class="caixa media"><span class="rot">Média</span><strong>{r.media ? reais(r.media) : '—'}<small>/{rotulo(r.unidade)}</small></strong></div></div>
      {/if}
      <p class="small">{ja ? `É o item "${ja.nome}", que não está ${filtroLista === 'todas' ? 'nas listas' : 'nesta lista'}.` : 'Não está no seu catálogo.'}</p>
      <div class="linha-acoes">{#if filtroLista === 'todas' && listas.length > 1}<select bind:value={addLista} aria-label="Lista">{#each listas as l (l.id)}<option value={l.id}>{l.nome}</option>{/each}</select>{/if}<input class="qtd" bind:value={addQtd} placeholder="qtd" aria-label="Quantidade"/><button class="primary" onclick={() => adicionarProdutoLido(lidoProduto!)}>Pôr na lista</button></div>
     {:else}
      <p class="small">EAN {lidoCodigo} não aparece em nenhuma NF-e sincronizada.</p>
     {/if}
     <button class="link" onclick={() => {lidoCodigo = ''; lidoProduto = undefined}}>fechar</button>
    </div>
   {/if}

   <p class="contador">{totalVisivel} {totalVisivel === 1 ? 'item' : 'itens'}{#if filtroStatus !== 'todos' || busca} · <button class="link" onclick={() => {filtroStatus = 'todos'; busca = ''}}>mostrar todos</button>{/if}</p>

   {#each semana as g (g.grupo)}
    <h2 class="grupo">{EMOJI_GRUPO[g.grupo] ?? '📌'} {g.grupo}</h2>
    {#each g.itens as {item, entradas} (item.id)}
     {@const r = resumos.get(item.id)}
     {@const feito = entradas.every(x => x.status === 'comprado')}
     {@const faltou = entradas.every(x => x.status === 'indisponivel')}
     {@const c = comparacao(item)}
     <article class="item" id="item-{item.id}" class:feito class:faltou class:destaque={destaque === item.id} class:aberto={aberto === item.id}>
      <div class="cab">
       <button class="nome" onclick={() => abrir(item)} aria-expanded={aberto === item.id}>
        <span class="t">{item.nome}</span>
        {#if filtroLista !== 'todas'}<span class="q">{entradas[0].quantidade}</span>{/if}
        {#if c}<span class="selo v-{c.veredito}">{pct(c.vsMedia ?? c.vsUltima)}</span>{/if}
       </button>
       {#if filtroLista !== 'todas' || entradas.length === 1}
        {@const x = entradas[0]}
        <div class="acoes">
         <button class="ac buy" class:on={x.status === 'comprado'} aria-pressed={x.status === 'comprado'} aria-label="Comprado: {item.nome}" onclick={() => tocar(x.listaId, item.id, 'comprado')}>✓</button>
         <button class="ac miss" class:on={x.status === 'indisponivel'} aria-pressed={x.status === 'indisponivel'} aria-label="Não encontrado: {item.nome}" onclick={() => tocar(x.listaId, item.id, 'indisponivel')}>✕</button>
        </div>
       {:else}
        <div class="acoes"><button class="ac buy" class:on={feito} aria-label="Comprado em todas as listas: {item.nome}" onclick={() => tocarTudo(item.id, entradas, 'comprado')}>✓✓</button></div>
       {/if}
      </div>
      {#if filtroLista === 'todas' && (entradas.length > 1 || listas.length > 1)}
       <div class="porlista">
        {#each entradas as x (x.listaId)}{@const l = listaPorId.get(x.listaId)}
         <div class="pl st-{x.status}" style="--cor:{l?.cor}">
          <b class="sigla">{l?.sigla}</b><span class="q">{x.quantidade}</span>
          {#if entradas.length > 1}
           <button class="mini buy" class:on={x.status === 'comprado'} aria-label="Comprado em {l?.nome}" onclick={() => tocar(x.listaId, item.id, 'comprado')}>✓</button>
           <button class="mini miss" class:on={x.status === 'indisponivel'} aria-label="Não encontrado em {l?.nome}" onclick={() => tocar(x.listaId, item.id, 'indisponivel')}>✕</button>
          {:else}
           <span class="estado">{x.status === 'comprado' ? 'comprado' : x.status === 'indisponivel' ? 'não tem' : ''}</span>
          {/if}
         </div>
        {/each}
       </div>
      {/if}
      {@render precos(item, r, true)}
      {#if aberto === item.id}
       <div class="detalhe">
        <form class="gondola" onsubmit={(e) => {e.preventDefault(); salvarGondola(item)}}>
         <label for="gp-{item.id}">Preço na gôndola</label>
         <div class="linha-acoes">
          <input id="gp-{item.id}" class="preco" bind:value={gPreco} inputmode="decimal" placeholder="R$ 0,00"/>
          <span class="por">por</span>
          <input class="qtd" bind:value={gQtd} inputmode="decimal" aria-label="Conteúdo da embalagem"/>
          <select bind:value={gUnid} aria-label="Unidade">{#each UNIDADES as u (u)}<option value={u}>{rotulo(u)}</option>{/each}</select>
          <button class="primary">Comparar</button>
         </div>
         {#if estado.pesquisa[item.id]}<button type="button" class="link" onclick={() => {estado = registrarPesquisa(estado, item.id); gPreco = ''}}>apagar preço da gôndola</button>{/if}
        </form>
        {#if r}
         <table class="hist"><thead><tr><th>Data</th><th>Onde / produto</th><th>Emb.</th><th>{porUnid(r)}</th></tr></thead><tbody>
          {#each r.compras.slice(-8).reverse() as cp (cp.data + cp.descricao + cp.total)}
           <tr><td>{dataCurta(cp.data, true)}</td><td><b>{cp.fornecedor}</b> {cp.descricao}</td><td>{reais(cp.precoEmbalagem)}{#if cp.embalagem}<small class="emb">{cp.embalagem}</small>{/if}</td><td class="u">{reais(cp.precoUnit)}</td></tr>
          {/each}
         </tbody></table>
         {#if r.unidadeDescricao}<p class="small">Preço por {r.unidadeDescricao}.</p>{/if}
        {/if}
        <button class="link" onclick={() => editar(item)}>editar item e vínculos</button>
       </div>
      {/if}
     </article>
    {/each}
   {:else}
    <p class="vazio-curto">Nada aqui com esse filtro.</p>
   {/each}

   <div class="adicionar">
    <label for="add-busca">Adicionar à {filtroLista === 'todas' ? 'lista' : `lista ${listaPorId.get(filtroLista)?.nome}`}</label>
    <div class="linha-acoes">
     <input id="add-busca" bind:value={addBusca} placeholder="Nome do item"/>
     {#if filtroLista === 'todas' && listas.length > 1}<select bind:value={addLista} aria-label="Lista">{#each listas as l (l.id)}<option value={l.id}>{l.nome}</option>{/each}</select>{/if}
     <input class="qtd" bind:value={addQtd} placeholder="qtd" aria-label="Quantidade"/>
    </div>
    {#if addBusca.trim()}
     <div class="resultados">
      {#each resultadosAdd as i (i.id)}<button onclick={() => adicionarNaLista(i)}>{i.nome} <small>{i.grupo}</small></button>{/each}
      {#if !resultadosAdd.some(i => normalizar(i.nome) === normalizar(addBusca))}<button class="novo" onclick={criarEAdicionar}>+ Criar “{addBusca.trim()}”</button>{/if}
     </div>
    {/if}
   </div>

   <div class="rodape">
    <button class="primary" onclick={() => copiarRelatorio('tudo')}>{copiado === 'tudo' ? 'Copiado ✓' : '▣ Copiar lista completa'}</button>
    <button class="secondary" onclick={() => copiarRelatorio('abertos')}>{copiado === 'abertos' ? 'Copiado ✓' : '☷ Pendentes e não encontrados'}</button>
    <div class="dois"><button class="secondary" onclick={() => copiarRelatorio('pendentes')}>{copiado === 'pendentes' ? 'Copiado ✓' : '◷ Só pendentes'}</button><button class="secondary" onclick={() => copiarRelatorio('faltou')}>{copiado === 'faltou' ? 'Copiado ✓' : '⊗ Só não encontrados'}</button></div>
    <div class="dois"><button class="secondary" onclick={() => iniciarRodada(true)}>{confirmar === 'rodada' ? 'Toque de novo' : '↻ Nova semana'}</button><button class="secondary" onclick={() => window.print()}>Imprimir / PDF</button></div>
    <p class="small">“Nova semana” mantém as quantidades e volta tudo para pendente. Preços: compras do THBT com NF-e (Supabase), por {janela ? `média de ${janela} dias` : 'todo o histórico'}.</p>
   </div>
  {/if}

 {:else if aba === 'itens'}
  {#if editId !== undefined}
   <form id="editor-item" class="editor" onsubmit={(e) => {e.preventDefault(); salvarItem()}}>
    <p class="eyebrow">{editId ? 'EDITAR ITEM' : 'NOVO ITEM'}</p>
    <label for="e-nome">Nome</label><input id="e-nome" bind:value={eNome} placeholder="Maionese (2,8 kg)" required/>
    <div class="row"><div><label for="e-grupo">Grupo</label><select id="e-grupo" bind:value={eGrupo}>{#each GRUPOS as g (g)}<option value={g}>{EMOJI_GRUPO[g]} {g}</option>{/each}</select></div>
     <div><label for="e-emb">Embalagem na gôndola</label><div class="linha-acoes"><input id="e-emb" class="qtd" bind:value={eQtd} inputmode="decimal" placeholder="2,8"/><select bind:value={eUnid} aria-label="Unidade da embalagem">{#each UNIDADES as u (u)}<option value={u}>{rotulo(u)}</option>{/each}</select></div></div></div>
    {#if listas.length}
     <p class="rotulo">Quantidade nesta semana <small>(vazio = fora da lista)</small></p>
     <div class="quant">{#each listas as l (l.id)}<label style="--cor:{l.cor}"><b class="sigla">{l.sigla}</b>{l.nome}<input bind:value={eQuant[l.id]} placeholder="—"/></label>{/each}</div>
    {/if}
    <p class="rotulo">Vínculo com compras (NF-e → Saipos)</p>
    {#if eVinculos.length}
     <div class="chips">{#each eVinculos as v, i (i)}<span class="chip">{rotuloVinculo(indice, v)}<button type="button" aria-label="Remover vínculo" onclick={() => eVinculos = eVinculos.filter((_, j) => j !== i)}>×</button></span>{/each}</div>
    {:else}<p class="small">Sem vínculo: o item não mostra preço. Escolha abaixo o insumo do Saipos ou o produto da nota.</p>{/if}
    {#if indice}
     <input bind:value={eBusca} placeholder="Buscar insumo ou produto (ex.: maionese, vigor)" aria-label="Buscar vínculo"/>
     <div class="candidatos">
      {#each candidatosEditor as c (JSON.stringify(c.vinculo))}
       <button type="button" onclick={() => eVinculos = [...eVinculos, c.vinculo]}><span>{c.rotulo}</span><small>{c.detalhe} · {c.compras} {c.compras === 1 ? 'compra' : 'compras'}</small></button>
      {:else}<p class="small">Nenhum candidato para “{eBusca || eNome}”.</p>{/each}
     </div>
    {:else}<p class="small">Sincronize os preços (aba Preços) para buscar vínculos.</p>{/if}
    {#if resumoEditor}
     <p class="rotulo">Prévia</p>
     <div class="precos"><div class="caixa"><span class="rot">Último · {dataCurta(resumoEditor.ultima!.data)}</span><strong>{reais(resumoEditor.ultima!.precoUnit)}<small>{porUnid(resumoEditor)}</small></strong><span class="det">{resumoEditor.ultima!.descricao}</span></div><div class="caixa media"><span class="rot">Média</span><strong>{resumoEditor.media ? reais(resumoEditor.media) : '—'}<small>{porUnid(resumoEditor)}</small></strong><span class="det">{resumoEditor.compras.length} compras</span></div></div>
    {/if}
    <div class="dois"><button class="primary">Salvar</button><button type="button" class="secondary" onclick={() => editId = undefined}>Cancelar</button></div>
    {#if editId}<button type="button" class="secondary perigo" onclick={excluirItem}>{confirmar === 'excluir-item' ? 'Toque de novo para excluir' : 'Excluir item do catálogo'}</button>{/if}
   </form>
  {:else}
   <div class="linha-acoes topo-itens"><button class="primary" onclick={() => editar()}>+ Novo item</button></div>
   {#if semVinculo || semHistorico}<p class="small">{semVinculo} sem vínculo · {semHistorico} com vínculo mas sem compra com NF-e.</p>{/if}
   {#each catalogo as item, i (item.id)}
    {#if i === 0 || catalogo[i - 1].grupo !== item.grupo}<h2 class="grupo">{EMOJI_GRUPO[item.grupo] ?? '📌'} {item.grupo}</h2>{/if}
    {@const r = resumos.get(item.id)}
    <div class="cat" class:destaque={destaque === item.id}>
     <button class="cat-nome" onclick={() => editar(item)}><span>{item.nome}</span><small>{item.vinculos.length ? item.vinculos.map(v => rotuloVinculo(indice, v)).join(' + ') : 'sem vínculo'}{#if r} · média {reais(r.media ?? 0)}{porUnid(r)}{/if}</small></button>
     <div class="cat-q">{#each listas as l (l.id)}{@const x = estado.entradas.find(e => e.itemId === item.id && e.listaId === l.id)}
      <label style="--cor:{l.cor}" title={l.nome}><b class="sigla">{l.sigla}</b><input value={x?.quantidade ?? ''} placeholder="—" aria-label="Quantidade em {l.nome}" onchange={(e) => estado = definirQuantidade(estado, l.id, item.id, e.currentTarget.value)}/></label>
     {/each}</div>
    </div>
   {:else}
    <p class="vazio-curto">Catálogo vazio. Crie itens ou importe a lista de 26/01 em Listas.</p>
   {/each}
  {/if}

 {:else if aba === 'listas'}
  <div class="bloco">
   {#each listas as l, i (l.id)}
    <div class="lista-edit" style="--cor:{l.cor}">
     <input class="sig" value={l.sigla} maxlength="3" aria-label="Sigla" onchange={(e) => estado = atualizarLista(estado, l.id, {sigla: e.currentTarget.value.toUpperCase() || l.sigla})}/>
     <input value={l.nome} aria-label="Nome da lista" onchange={(e) => estado = atualizarLista(estado, l.id, {nome: e.currentTarget.value.trim() || l.nome})}/>
     <select value={l.tipo} aria-label="Tipo" onchange={(e) => estado = atualizarLista(estado, l.id, {tipo: e.currentTarget.value as Lista['tipo']})}><option value="loja">Loja</option><option value="pessoal">Pessoal</option></select>
     <div class="cores">{#each CORES as c (c)}<button aria-label="Cor" class:on={l.cor === c} style="background:{c}" onclick={() => estado = atualizarLista(estado, l.id, {cor: c})}></button>{/each}</div>
     <div class="ord"><button aria-label="Subir" disabled={i === 0} onclick={() => moverLista(l, -1)}>↑</button><button aria-label="Descer" disabled={i === listas.length - 1} onclick={() => moverLista(l, 1)}>↓</button>
      <button class="perigo" onclick={() => confirmarDuasVezes(`lista-${l.id}`, () => {estado = removerLista(estado, l.id); if (filtroLista === l.id) filtroLista = 'todas'})}>{confirmar === `lista-${l.id}` ? 'confirmar' : 'excluir'}</button></div>
     <p class="small">{estado.entradas.filter(x => x.listaId === l.id).length} itens nesta semana</p>
    </div>
   {/each}
   <form class="linha-acoes" onsubmit={(e) => {e.preventDefault(); novaLista()}}>
    <input bind:value={novaListaNome} placeholder="Nova lista (ex.: Casa)" aria-label="Nome da nova lista"/>
    <select bind:value={novaListaTipo} aria-label="Tipo"><option value="loja">Loja</option><option value="pessoal">Pessoal</option></select>
    <button class="primary">Criar</button>
   </form>
  </div>
  <div class="bloco">
   <p class="rotulo">Semana</p>
   <div class="dois"><button class="secondary" onclick={() => iniciarRodada(true)}>{confirmar === 'rodada' ? 'Toque de novo' : 'Nova semana (manter qtds)'}</button><button class="secondary" onclick={() => iniciarRodada(false)}>{confirmar === 'rodada-zero' ? 'Toque de novo' : 'Nova semana (zerar)'}</button></div>
   <button class="secondary" onclick={importar2601}>Importar lista de 26/01 (Freguesia + Tijuca)</button>
  </div>
  <div class="bloco">
   <p class="rotulo">Backup</p>
   <p class="small">Listas e itens ficam só neste aparelho. Baixe o backup para passar para outro celular.</p>
   <div class="dois"><button class="secondary" onclick={baixarBackup}>Baixar backup</button><button class="secondary" onclick={() => arquivoBackup?.click()}>Restaurar backup</button></div>
   <input type="file" accept="application/json,.json" hidden bind:this={arquivoBackup} onchange={(e) => restaurarBackup(e.currentTarget.files?.[0])}/>
  </div>

 {:else}
  <div class="bloco">
   <p class="rotulo">Sincronização com o Supabase</p>
   <p class="small">O app baixa as compras com NF-e já processadas e guarda no aparelho: na gôndola funciona sem sinal. Sincroniza sozinho ao abrir, se os preços tiverem mais de 6 h.</p>
   <form onsubmit={(e) => {e.preventDefault(); void sincronizar()}}>
    <label for="tok">Token deste aparelho</label>
    <input id="tok" type="password" bind:value={token} autocomplete="off" placeholder="thb_…"/>
    <button class="primary" disabled={sincronizando}>{sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}</button>
   </form>
   {#if snapshot}
    <div class="stats">
     <div><strong>{snapshot.obs.length}</strong><span>compras</span></div>
     <div><strong>{snapshot.produtos.length}</strong><span>produtos</span></div>
     <div><strong>{snapshot.produtos.filter(p => p.gtin).length}</strong><span>com EAN</span></div>
    </div>
    <p class="small">Período {periodo} · baixado em {new Date(snapshot.geradoEm).toLocaleString('pt-BR')}.</p>
   {/if}
  </div>
  <div class="bloco">
   <p class="rotulo">Média de preço</p>
   <div class="janelas">{#each JANELAS as j (j.d)}<button class:on={janela === j.d} onclick={() => escolherJanela(j.d)}>{j.r}</button>{/each}</div>
   <p class="small">Média ponderada pela quantidade comprada, na unidade do insumo (R$/kg, R$/L, R$/un). Sem compra na janela, usa todo o histórico. O custo inclui frete, desconto, IPI e ST da nota.</p>
  </div>
 {/if}

 {#if aviso}<p class="toast" role="status">{aviso}</p>{/if}
</section>

<style>
 .compras{--v:#1f6a43;--r:#b83d3d;--a:#9a6b16;max-width:760px}
 /* base própria: os estilos de botão/campo da página são escopados a ela */
 .eyebrow{font-size:10px;font-weight:700;letter-spacing:2px;color:#6b8076;margin:0}
 .small{font-size:12px;line-height:1.55;color:#65766f;margin:10px 0 0}
 label{display:block;margin:14px 0 6px;font-size:12px;font-weight:600}
 input,select{width:100%;border:1px solid #c7d2c8;border-radius:8px;padding:11px 12px;background:#fff;color:#203f35;font-size:16px}
 select{padding:10px 8px}
 button{font:inherit;cursor:pointer;color:inherit}
 button:disabled{opacity:.55;cursor:default}
 .primary,.secondary{padding:13px 16px;border-radius:8px;font-size:14px;font-weight:600;margin-top:10px;width:100%}
 .primary{background:#193f35;color:#fff;border:1px solid #193f35}
 .secondary{background:#fff;color:#193f35;border:1px solid #aebfb2}
 .perigo{color:#833c25!important}
 .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
 .topo{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin:18px 0 12px}
 .topo h1{font-size:clamp(20px,4.6vw,32px);font-weight:600;letter-spacing:-.6px;line-height:1.15;margin:6px 0 0}
 .sync{display:grid;justify-items:center;gap:2px;border:1px solid #c7d2c8;background:#fff;border-radius:10px;padding:8px 10px;font-size:20px;color:#193f35;min-width:76px}
 .sync span{font-size:10px;color:#65766f;white-space:nowrap}
 .sync.girando{animation:gira 1s linear infinite}
 @keyframes gira{to{transform:rotate(360deg)}}
 .abas{display:flex;gap:4px;background:#e8ece5;padding:4px;border-radius:11px;position:sticky;top:0;z-index:5}
 .abas button{flex:1;border:0;background:transparent;padding:10px 4px;border-radius:8px;font-size:13px;font-weight:600;color:#45594f;position:relative}
 .abas button.on{background:#fff;color:#10251f;box-shadow:0 1px 4px #0002}
 .abas i{font-style:normal;font-size:10px;background:#d9a43a;color:#fff;border-radius:99px;padding:1px 6px;margin-left:4px}
 .alerta{font-size:12px;color:#7a5a1d;background:#fcf3dc;border-radius:8px;padding:9px 12px;margin:10px 0}
 .vazio{display:grid;gap:4px;margin-top:20px;padding:20px;border:1px dashed #c7d2c8;border-radius:12px;text-align:center;background:#fbfcfa}
 .metricas{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0 12px}
 .metrica{border:0;border-radius:11px;background:#fff;padding:10px 4px;display:grid;gap:2px;box-shadow:0 0 0 1px #dce2d9 inset}
 .metrica strong{font-size:24px;font-variant-numeric:tabular-nums}
 .metrica span{font-size:11px;color:#65766f}
 .metrica.m-comprado strong{color:var(--v)} .metrica.m-indisponivel strong{color:var(--r)}
 .metrica.on{box-shadow:0 0 0 2px #193f35 inset}
 .filtro-listas{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}
 .filtro-listas button{flex:0 0 auto;border:1px solid #c7d2c8;background:#fff;border-radius:99px;padding:8px 14px;font-size:13px;font-weight:600;color:#2d544b;display:flex;align-items:center;gap:6px}
 .filtro-listas button.on{background:#193f35;color:#fff;border-color:#193f35}
 .sigla{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 4px;border-radius:6px;background:var(--cor,#6b8076);color:#fff;font-size:11px;font-weight:800}
 .busca{display:flex;gap:8px;margin-top:12px}
 .busca input{flex:1}
 .ean{border:1px solid #193f35;background:#193f35;color:#fff;border-radius:6px;padding:0 12px;font-size:18px;display:flex;align-items:center;gap:6px}
 .ean span{font-size:12px;font-weight:600}
 .camera{position:relative;margin-top:10px;border-radius:12px;overflow:hidden;background:#10251f}
 .camera video{display:block;width:100%;max-height:42vh;object-fit:cover}
 .mira{position:absolute;left:12%;right:12%;top:50%;height:2px;background:#ff4d4d;box-shadow:0 0 12px #ff4d4d}
 .lido{margin-top:12px;border:1px solid #9fbfae;background:#f2f7f1;border-radius:12px;padding:14px}
 .lido h3{margin:4px 0 8px;font-size:16px}
 .contador{font-size:12px;color:#65766f;margin:14px 0 0}
 .grupo{font-size:14px;margin:20px 0 8px;letter-spacing:0}
 .item{background:#fff;border:1px solid #dce2d9;border-radius:12px;padding:10px 12px;margin-bottom:8px;transition:background .3s,border-color .3s}
 .item.destaque{background:#e3f1e6;border-color:#7fb393}
 .item.aberto{border-color:#9fbfae;box-shadow:0 2px 10px #0001}
 .item.feito .t{text-decoration:line-through;color:#8a948e}
 .item.faltou .t{color:var(--r)}
 .cab{display:flex;align-items:center;gap:10px}
 .nome{flex:1;min-width:0;border:0;background:transparent;text-align:left;padding:4px 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:#10251f}
 .nome .t{font-size:15px;font-weight:600}
 .nome .q,.pl .q{font-size:13px;font-weight:700;color:#2d544b;background:#edf2ec;border-radius:6px;padding:2px 7px;font-variant-numeric:tabular-nums}
 .acoes{display:flex;gap:6px}
 .ac{width:44px;height:42px;border-radius:10px;border:1px solid #c7d2c8;background:#fff;font-size:18px;color:#6b7a72}
 .ac.buy.on{background:var(--v);border-color:var(--v);color:#fff}
 .ac.miss.on{background:var(--r);border-color:var(--r);color:#fff}
 .porlista{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 2px}
 .pl{display:flex;align-items:center;gap:6px;border:1px solid #e1e6de;border-radius:10px;padding:4px 4px 4px 6px;background:#fbfcfa}
 .pl.st-comprado{background:#e7f3ea;border-color:#b6d8c0}
 .pl.st-indisponivel{background:#f8e7e3;border-color:#e3b9ae}
 .pl .estado{font-size:11px;color:#65766f;padding-right:6px}
 .mini{width:34px;height:32px;border-radius:8px;border:1px solid #c7d2c8;background:#fff;font-size:15px;color:#6b7a72}
 .mini.buy.on{background:var(--v);border-color:var(--v);color:#fff}
 .mini.miss.on{background:var(--r);border-color:var(--r);color:#fff}
 .precos{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin-top:8px;align-items:stretch}
 .caixa{border-radius:9px;background:#f4f6f2;padding:7px 9px;display:grid;gap:1px;min-width:0}
 .caixa.media{background:#eef3f8}
 .caixa .rot{font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:#6b8076}
 .caixa strong{font-size:17px;font-variant-numeric:tabular-nums;color:#10251f;line-height:1.25}
 .caixa strong small{font-size:11px;font-weight:600;color:#65766f;margin-left:1px}
 .caixa .det{font-size:11px;color:#65766f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .spark{width:64px;height:100%;min-height:40px;color:#2f6f9f;align-self:center}
 .sem-hist{font-size:12px;color:#91a096;margin:6px 0 0}
 .selo{font-size:11px;font-weight:800;border-radius:99px;padding:2px 8px}
 .v-barato{color:var(--v);background:#dff0e4} .v-caro{color:var(--r);background:#f8e1dc} .v-na-media{color:var(--a);background:#f6eed8}
 .veredito{font-size:12px;border-radius:8px;padding:6px 9px;margin:8px 0 0;line-height:1.45}
 .detalhe{margin-top:10px;border-top:1px solid #e5e9e2;padding-top:6px}
 .gondola label{margin-top:8px}
 .linha-acoes{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
 .linha-acoes input{flex:1;min-width:90px}
 .linha-acoes .qtd,.qtd{flex:0 0 64px;width:64px;min-width:0}
 .linha-acoes .preco{flex:1 1 90px}
 .linha-acoes select{width:auto;flex:0 0 auto}
 .linha-acoes .primary{width:auto;margin-top:0;flex:0 0 auto}
 .por{font-size:12px;color:#65766f}
 .hist{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px}
 .hist th{text-align:left;font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:#6b8076;padding:4px 4px;border-bottom:1px solid #e5e9e2}
 .hist td{padding:6px 4px;border-bottom:1px solid #f0f2ee;vertical-align:top;font-variant-numeric:tabular-nums}
 .hist td small{color:#7b8981}
 .hist .emb{display:block;font-size:10px}
 .hist .u{font-weight:700;white-space:nowrap}
 .link{border:0;background:transparent;color:#2f6f9f;text-decoration:underline;font-size:12px;padding:6px 0}
 .adicionar{margin-top:22px;border:1px solid #dce2d9;background:#fff;border-radius:12px;padding:4px 12px 12px}
 .resultados{display:grid;gap:6px;margin-top:8px}
 .resultados button{text-align:left;border:1px solid #dce2d9;background:#fbfcfa;border-radius:8px;padding:10px;font-size:13px}
 .resultados small{color:#7b8981;margin-left:6px}
 .resultados .novo{border-style:dashed;color:#1f6a43;font-weight:600}
 .rodape{display:grid;gap:0;margin-top:18px}
 .dois{display:grid;grid-template-columns:1fr 1fr;gap:8px}
 .editor{background:#fff;border:1px solid #9fbfae;border-radius:12px;padding:14px;margin-top:14px}
 .rotulo{font-size:12px;font-weight:700;margin:18px 0 8px;color:#193f35}
 .rotulo small{font-weight:400;color:#65766f}
 .quant{display:grid;gap:6px}
 .quant label{display:flex;align-items:center;gap:8px;margin:0;font-weight:500}
 .quant input{flex:0 0 110px;width:110px;margin-left:auto}
 .chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
 .chip{display:flex;align-items:center;gap:4px;background:#e2efe4;color:#10342a;border-radius:99px;padding:5px 6px 5px 11px;font-size:12px;font-weight:600}
 .chip button{border:0;background:transparent;font-size:16px;line-height:1;color:#2d544b;padding:0 4px}
 .candidatos{display:grid;gap:6px;margin-top:8px;max-height:320px;overflow:auto}
 .candidatos button{display:grid;text-align:left;gap:2px;border:1px solid #dce2d9;background:#fbfcfa;border-radius:8px;padding:9px 10px;font-size:13px}
 .candidatos small{font-size:11px;color:#7b8981}
 .topo-itens{margin-top:14px}
 .topo-itens .primary{margin-top:0}
 .cat{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #e1e6de;border-radius:10px;padding:8px 10px;margin-bottom:6px}
 .cat.destaque{background:#e3f1e6}
 .cat-nome{flex:1;min-width:0;border:0;background:transparent;text-align:left;display:grid;gap:2px;padding:2px 0}
 .cat-nome span{font-size:14px;font-weight:600}
 .cat-nome small{font-size:11px;color:#7b8981;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .cat-q{display:flex;gap:4px}
 .cat-q label{display:grid;justify-items:center;gap:2px;margin:0}
 .cat-q input{width:52px;padding:6px 4px;text-align:center;font-size:13px}
 .bloco{background:#fff;border:1px solid #dce2d9;border-radius:12px;padding:6px 14px 14px;margin-top:14px}
 .lista-edit{display:grid;grid-template-columns:56px 1fr auto;gap:8px;align-items:center;border-bottom:1px solid #eef1ec;padding:12px 0}
 .lista-edit .sig{text-align:center;font-weight:800;color:#fff;background:var(--cor);border-color:var(--cor)}
 .lista-edit .cores{grid-column:1/-1;display:flex;gap:6px}
 .cores button{width:26px;height:26px;border-radius:50%;border:2px solid transparent}
 .cores button.on{border-color:#10251f;box-shadow:0 0 0 2px #fff inset}
 .lista-edit .ord{grid-column:1/-1;display:flex;gap:6px}
 .ord button{border:1px solid #c7d2c8;background:#fff;border-radius:7px;padding:6px 12px;font-size:12px}
 .ord .perigo{margin-left:auto;color:#833c25}
 .lista-edit .small{grid-column:1/-1;margin:0}
 .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}
 .stats div{background:#f4f6f2;border-radius:9px;padding:10px;display:grid;text-align:center}
 .stats strong{font-size:20px}
 .stats span{font-size:11px;color:#65766f}
 .janelas{display:flex;gap:6px;flex-wrap:wrap}
 .janelas button{border:1px solid #aebfb2;background:#fff;border-radius:99px;padding:8px 14px;font-size:12px}
 .janelas button.on{background:#193f35;color:#fff;border-color:#193f35}
 .vazio-curto{font-size:13px;color:#91a096;text-align:center;padding:20px 0}
 .toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:#10251f;color:#fff;border-radius:99px;padding:10px 18px;font-size:13px;z-index:20;box-shadow:0 6px 20px #0003;max-width:90vw;text-align:center}
 @media(max-width:520px){.precos{grid-template-columns:1fr 1fr}.spark{display:none}.caixa strong{font-size:16px}}
 @media print{
  :global(aside),:global(header),:global(.notice),:global(footer),.abas,.metricas,.filtro-listas,.busca,.adicionar,.rodape,.acoes,.sync,.mini,.detalhe,.spark{display:none!important}
  :global(.app){display:block!important}.item{break-inside:avoid;border-color:#ccc}
 }
</style>
