<script lang="ts">
 import {onDestroy, onMount, tick} from 'svelte'
 import {
  ESTADO_INICIAL, SECOES, GRUPOS, EMOJI_GRUPO, CORES, revisar, criarLista, atualizarLista, removerLista, criarItem,
  atualizarItem, removerItem, definirQuantidade, alternarStatus, marcarItem, registrarPesquisa, contar, relatorio,
  relatorioFechamento, normalizar, ordemGrupo, listasDaSecao, entradasDaSecao, faltantesAbertos, incluirFaltantes,
  descartarFaltante, irPara, fecharCompra, embalagemDaUnidade, rotuloItem, qtdDecimal, lerQtd, formatarQtd,
  type EstadoCompras, type Item, type Lista, type Status, type ModoRelatorio, type Entrada, type Secao, type Faltante
 } from './estado.ts'
 import {indexar, resumir, compararGondola, produtoPorGtin, produtosDosVinculos, reais,
  type Snapshot, type Resumo, type Vinculo, type ProdutoInfo} from './precos.ts'
 import {buscarCandidatos, rotuloVinculo, mesmoVinculo, vinculosAutomaticos} from './vinculo.ts'
 import {importarPlanilha, TAMANHO_PLANILHA} from './semente.ts'
 import {baixarSnapshot, ErroSincronizacao, validarSnapshot} from './sincronizar.ts'
 import {ler, gravar, pedirPersistencia} from './armazenamento.ts'
 import {rotulo, UNIDADES, type Unidade} from './unidades.ts'
 import {copiarTexto} from '../clipboard'

 type Tela = 'montar' | 'comprar' | 'fechar' | 'catalogo' | 'lojas' | 'precos'
 const CHAVE_TOKEN = 'thb.compras.token'
 const CHAVE_JANELA = 'thb.compras.janela'
 const CHAVE_SECAO = 'thb.compras.secao'
 const CHAVE_TEMA = 'thb.compras.tema'
 const JANELAS = [{d: 30, r: '30 dias'}, {d: 90, r: '90 dias'}, {d: 180, r: '180 dias'}, {d: 0, r: 'Tudo'}]

 let estado = $state<EstadoCompras>(ESTADO_INICIAL)
 let snapshot = $state<Snapshot | undefined>(undefined)
 let carregado = $state(false)
 let emDisco = $state(true)
 let secao = $state<Secao>('producao')
 let tela = $state<Tela>('montar')
 let busca = $state('')
 let soEscolhidos = $state(false)
 let filtroLista = $state('todas')
 let filtroStatus = $state<'todos' | Status>('todos')
 let aberto = $state('')
 let destaque = $state('')
 let aviso = $state('')
 let copiado = $state('')
 let confirmar = $state('')
 let token = $state('')
 let janela = $state(90)
 let sincronizando = $state(false)
 let erroSync = $state('')
 // editor de item
 let editId = $state<string | undefined>(undefined)
 let eNome = $state(''); let eUnidade = $state(''); let eGrupo = $state('Outros')
 let eVinculos = $state<Vinculo[]>([]); let eBusca = $state(''); let eAuto = $state<boolean | undefined>(undefined)
 // novo item rápido (montar)
 let nNome = $state(''); let nUnidade = $state(''); let nGrupo = $state('Outros')
 // gôndola
 let gPreco = $state(''); let gQtd = $state(''); let gUnid = $state<Unidade>('un')
 // fechamento: quais não comprados vão para a próxima lista
 let levar = $state<Record<string, boolean>>({})
 // lojas
 let novaListaNome = $state('')
 // EAN
 let lendo = $state(false); let video = $state<HTMLVideoElement>(); let pararLeitura: (() => void) | undefined
 let lidoProduto = $state<ProdutoInfo | undefined>(undefined); let lidoCodigo = $state('')
 let arquivoBackup = $state<HTMLInputElement>()
 let escuro = $state(false)
 let teclado = $state(0)

 const indice = $derived(snapshot ? indexar(snapshot) : undefined)
 const lojas = $derived(listasDaSecao(estado, secao))
 const listaPorId = $derived(new Map(estado.listas.map(l => [l.id, l])))
 const itemPorId = $derived(new Map(estado.itens.map(i => [i.id, i])))
 const itensSecao = $derived(estado.itens.filter(i => i.secao === secao))
 const entradas = $derived(entradasDaSecao(estado, secao))
 const ciclo = $derived(estado.ciclos[secao])
 const abertos = $derived(faltantesAbertos(estado, secao))
 const resumos = $derived.by(() => {
  const m = new Map<string, Resumo>()
  if (!indice) return m
  for (const i of estado.itens) {const r = resumir(indice, i.vinculos, janela); if (r) m.set(i.id, r)}
  return m
 })
 const qtdPorItem = $derived.by(() => {
  const m = new Map<string, Map<string, Entrada>>()
  for (const x of entradas) {if (!m.has(x.itemId)) m.set(x.itemId, new Map()); m.get(x.itemId)!.set(x.listaId, x)}
  return m
 })
 const escolhidos = $derived(qtdPorItem.size)
 /** Grupos do catálogo da seção (tela Montar). */
 const montagem = $derived.by(() => {
  const q = normalizar(busca)
  const lista = itensSecao.filter(i => (!q || normalizar(i.nome).includes(q)) && (!soEscolhidos || qtdPorItem.has(i.id)))
  return agrupar(lista)
 })
 const lojasVisiveis = $derived(filtroLista === 'todas' ? lojas.map(l => l.id) : [filtroLista])
 const entradasVisiveis = $derived(entradas.filter(x => lojasVisiveis.includes(x.listaId)))
 const contagem = $derived(contar(entradasVisiveis))
 /** Grupos da lista da semana (tela Comprar). */
 const compra = $derived.by(() => {
  const q = normalizar(busca)
  const ids = [...new Set(entradasVisiveis.map(x => x.itemId))]
  const lista = ids.map(id => itemPorId.get(id)!).filter(i => i
   && (!q || normalizar(i.nome).includes(q))
   && (filtroStatus === 'todos' || entradasVisiveis.some(x => x.itemId === i.id && x.status === filtroStatus)))
  return agrupar(lista)
 })
 const naoComprados = $derived(entradas.filter(x => x.status !== 'comprado'))
 const levarLista = $derived(naoComprados.filter(x => levar[chave(x)] !== false).map(x => ({itemId: x.itemId, listaId: x.listaId})))
 const semVinculo = $derived(itensSecao.filter(i => !i.vinculos.length).length)
 const autoPendentes = $derived(itensSecao.filter(i => i.vinculoAuto).length)
 const catalogo = $derived(agrupar(itensSecao.filter(i => !busca || normalizar(i.nome).includes(normalizar(busca)))))
 const candidatosEditor = $derived(indice && editId !== undefined ? buscarCandidatos(indice, eBusca || eNome).filter(c => !eVinculos.some(v => mesmoVinculo(v, c.vinculo))) : [])
 const resumoEditor = $derived(indice && editId !== undefined && eVinculos.length ? resumir(indice, eVinculos, janela) : undefined)
 const periodo = $derived(snapshot?.obs.length ? `${dataCurta(snapshot.obs[0][1], true)} a ${dataCurta(snapshot.obs.at(-1)![1], true)}` : '')

 function agrupar(lista: Item[]) {
  const g = new Map<string, Item[]>()
  for (const i of lista) g.set(i.grupo, [...(g.get(i.grupo) ?? []), i])
  return [...g.entries()].sort((a, b) => ordemGrupo(secao, a[0]) - ordemGrupo(secao, b[0]) || a[0].localeCompare(b[0]))
   .map(([grupo, itens]) => ({grupo, itens: itens.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.unidade.localeCompare(b.unidade))}))
 }
 function chave(x: {itemId: string, listaId: string}) {return `${x.itemId}|${x.listaId}`}

 onMount(async () => {
  try {
   token = localStorage.getItem(CHAVE_TOKEN) ?? ''
   const salvo = localStorage.getItem(CHAVE_JANELA); const j = Number(salvo)
   if (salvo !== null && JANELAS.some(x => x.d === j)) janela = j
   const s = localStorage.getItem(CHAVE_SECAO); if (s === 'producao' || s === 'bebidas') secao = s
  } catch {/* sem localStorage */}
  document.documentElement.classList.add('modo-app')
  temaInicial()
  lerEndereco()
  window.addEventListener('hashchange', lerEndereco)
  window.visualViewport?.addEventListener('resize', aoMudarViewport)
  window.visualViewport?.addEventListener('scroll', aoMudarViewport)
  const [bruto, snap] = await Promise.all([ler<unknown>('estado'), ler<unknown>('snapshot')])
  estado = revisar(bruto)
  if (validarSnapshot(snap)) snapshot = snap
  carregado = true
  void pedirPersistencia()
  if (token && (!snapshot || Date.now() - Date.parse(snapshot.geradoEm) > 6 * 3600e3)) void sincronizar(true)
 })
 onDestroy(() => {
  pararCamera()
  if (typeof document === 'undefined') return
  document.documentElement.classList.remove('modo-app')
  delete document.documentElement.dataset.tema
  window.removeEventListener('hashchange', lerEndereco)
  window.visualViewport?.removeEventListener('resize', aoMudarViewport)
  window.visualViewport?.removeEventListener('scroll', aoMudarViewport)
 })

 // ---------- tema ----------
 /** Ao abrir: escuro das 18h às 6h. O botão ☾/☀ troca na hora e vale até fechar a aba. */
 function temaInicial() {
  let manual: string | null = null
  try {manual = sessionStorage.getItem(CHAVE_TEMA)} catch {/* sem sessionStorage */}
  const h = new Date().getHours()
  escuro = manual ? manual === 'escuro' : h >= 18 || h < 6
  aplicarTema()
 }
 /** Aplica o tema só enquanto a seção de compras está aberta (as outras telas são só claras). */
 function aplicarTema() {
  document.documentElement.dataset.tema = escuro ? 'escuro' : 'claro'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', escuro ? '#0e1512' : '#153c35')
 }
 function alternarTema() {
  escuro = !escuro; aplicarTema()
  try {sessionStorage.setItem(CHAVE_TEMA, escuro ? 'escuro' : 'claro')} catch {/* não persiste */}
 }

 // ---------- endereço ----------
 // #/compras/<seção>/<tela>: cada seção e etapa tem link próprio para compartilhar.
 const SLUG_TELA: Record<Tela, string> = {montar: 'montar', comprar: 'comprar', fechar: 'fechar', catalogo: 'catalogo', lojas: 'lojas', precos: 'ajustes'}
 /** Lê seção e tela do endereço (link compartilhado ou voltar do navegador). */
 function lerEndereco() {
  const [modulo, s, t] = location.hash.replace(/^#\/?/, '').split('/')
  if (modulo !== 'compras') return
  if (s === 'producao' || s === 'bebidas') secao = s
  const tl = (Object.keys(SLUG_TELA) as Tela[]).find(k => SLUG_TELA[k] === t)
  if (tl) tela = tl
 }
 $effect(() => {
  const alvo = `#/compras/${secao}/${SLUG_TELA[tela]}`
  if (location.hash !== alvo) history.replaceState(null, '', location.pathname + location.search + alvo)
 })

 // ---------- teclado virtual ----------
 // O iOS não encolhe a página quando o teclado abre: só o visualViewport. Medimos a área coberta,
 // rolamos o campo para a parte visível e, quando o teclado fecha, voltamos para onde estava.
 let campoAtivo: HTMLElement | null = null
 let rolagemAntes: number | null = null
 function aoMudarViewport() {
  const vv = window.visualViewport
  if (!vv) return
  const coberto = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
  teclado = coberto > 120 ? coberto : 0
  if (teclado && campoAtivo) mostrarCampo()
  if (!teclado && !campoAtivo && rolagemAntes != null) {window.scrollTo({top: rolagemAntes, behavior: 'smooth'}); rolagemAntes = null}
 }
 function mostrarCampo() {
  const vv = window.visualViewport, el = campoAtivo
  if (!vv || !el) return
  const r = el.getBoundingClientRect()
  const topo = vv.offsetTop + 96, base = vv.offsetTop + vv.height - 12
  if (r.bottom > base || r.top < topo) window.scrollBy({top: r.top - (vv.offsetTop + vv.height * 0.4), behavior: 'smooth'})
 }
 function aoFocar(e: FocusEvent) {
  const el = e.target as HTMLElement
  if (!el.matches('input:not([type=checkbox]):not([type=file]),select')) return
  if (rolagemAntes == null) rolagemAntes = window.scrollY
  campoAtivo = el
  setTimeout(mostrarCampo, 320)
 }
 function aoDesfocar() {
  campoAtivo = null
  setTimeout(() => {
   if (campoAtivo || teclado) return
   if (rolagemAntes != null) {window.scrollTo({top: rolagemAntes, behavior: 'smooth'}); rolagemAntes = null}
  }, 350)
 }

 $effect(() => {
  const copia = $state.snapshot(estado)
  if (!carregado) return
  void gravar('estado', copia).then(ok => {emDisco = ok})
 })

 // ---------- utilidades ----------
 function avisar(t: string) {aviso = t; setTimeout(() => {if (aviso === t) aviso = ''}, 2600)}
 function confirmarDuasVezes(k: string, acao: () => void) {
  if (confirmar !== k) {confirmar = k; setTimeout(() => {if (confirmar === k) confirmar = ''}, 3000); return}
  confirmar = ''; acao()
 }
 function dataCurta(iso: string, ano = false) {const [y, m, d] = iso.split('-'); return ano ? `${d}/${m}/${y.slice(2)}` : `${d}/${m}`}
 function porUnid(r: Resumo) {return `/${rotulo(r.unidade)}`}
 function vibrar(p: number | number[]) {try {navigator.vibrate?.(p)} catch {/* sem haptics */}}
 function hoje() {return new Date().toLocaleDateString('pt-BR')}
 function num(t: string) {const n = Number(t.trim().replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN}
 function numDec(t: string) {const n = Number(t.trim().replace(',', '.')); return Number.isFinite(n) ? n : NaN}
 function pct(v?: number) {return v == null ? '' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`}
 function trocarSecao(s: Secao) {
  secao = s; busca = ''; filtroLista = 'todas'; filtroStatus = 'todos'; aberto = ''; editId = undefined
  try {localStorage.setItem(CHAVE_SECAO, s)} catch {/* não persiste */}
 }
 function irTela(t: Tela) {tela = t; busca = ''; editId = undefined; aberto = ''; if (t === 'fechar') levar = {}; window.scrollTo({top: 0})}

 // ---------- sincronização ----------
 async function sincronizar(silencioso = false) {
  if (!token.trim()) {erroSync = 'Informe o token de sincronização.'; irTela('precos'); return}
  sincronizando = true; erroSync = ''
  try {
   const s = await baixarSnapshot(token)
   snapshot = s
   await gravar('snapshot', s)
   try {localStorage.setItem(CHAVE_TOKEN, token.trim())} catch {/* não persiste */}
   const novos = vinculosAutomaticos(indexar(s), estado.itens)
   for (const n of novos) estado = atualizarItem(estado, n.itemId, {vinculos: [n.vinculo], vinculoAuto: true})
   if (!silencioso || novos.length) avisar(`Preços atualizados: ${s.obs.length} compras${novos.length ? ` · ${novos.length} vínculos sugeridos` : ''}.`)
  } catch (e) {
   const msg = e instanceof ErroSincronizacao ? e.message : 'Falha ao sincronizar.'
   if (!silencioso || (e instanceof ErroSincronizacao && e.tipo === 'token')) erroSync = msg
  } finally {sincronizando = false}
 }
 function escolherJanela(d: number) {janela = d; try {localStorage.setItem(CHAVE_JANELA, String(d))} catch {/* não persiste */}}

 // ---------- montar ----------
 function qtdAtual(item: Item, l: Lista) {return qtdPorItem.get(item.id)?.get(l.id)?.quantidade ?? 0}
 /** − e +: passo de 1; o primeiro + usa a última quantidade comprada, se houver. */
 function passoQtd(item: Item, l: Lista, d: 1 | -1) {
  const atual = qtdAtual(item, l)
  const nova = !atual && d > 0 ? (item.ultimaQtd[l.id] || 1) : Math.max(0, atual + d)
  estado = definirQuantidade(estado, l.id, item.id, nova); vibrar(10)
 }
 function digitarQtd(item: Item, l: Lista, v: string) {estado = definirQuantidade(estado, l.id, item.id, lerQtd(v))}
 /** Filtra a digitação: kg/L aceitam uma vírgula e até 3 casas; o resto só dígitos. */
 function filtrarDigitacao(item: Item, el: HTMLInputElement) {
  let v = el.value.replace('.', ',')
  if (qtdDecimal(item)) {
   v = v.replace(/[^\d,]/g, '')
   const [int, ...dec] = v.split(',')
   v = dec.length ? `${int},${dec.join('').slice(0, 3)}` : int
  } else v = v.replace(/\D/g, '')
  if (v !== el.value) el.value = v.slice(0, 7)
 }
 function campoQtd(n: number) {return n ? String(n).replace('.', ',') : ''}
 function criarNovo() {
  const nome = nNome.trim()
  if (!nome) return
  const r = criarItem(estado, {nome, unidade: nUnidade, secao, grupo: nGrupo})
  estado = r.estado
  if (lojas.length === 1) estado = definirQuantidade(estado, lojas[0].id, r.item.id, 1)
  nNome = ''; nUnidade = ''; destacar(r.item.id)
  avisar('Item criado. Ele ganha preço quando aparecer numa NF-e sincronizada.')
 }
 function incluirTodosFaltantes() {estado = incluirFaltantes(estado, abertos); vibrar(30)}
 function irComprar() {
  if (!escolhidos) {avisar('Escolha pelo menos um item.'); return}
  estado = irPara(estado, secao, 'comprar', hoje()); irTela('comprar')
 }
 function destacar(id: string) {destaque = id; setTimeout(() => {if (destaque === id) destaque = ''}, 1600)}

 // ---------- comprar ----------
 function tocar(listaId: string, itemId: string, s: Exclude<Status, 'pendente'>) {estado = alternarStatus(estado, listaId, itemId, s); vibrar(s === 'comprado' ? 30 : [20, 40, 20])}
 function tocarTudo(itemId: string, es: Entrada[], s: Exclude<Status, 'pendente'>) {
  estado = marcarItem(estado, itemId, es.every(x => x.status === s) ? 'pendente' : s); vibrar(30)
 }
 function abrir(item: Item) {
  if (aberto === item.id) {aberto = ''; return}
  aberto = item.id
  const p = estado.pesquisa[item.id]
  gPreco = p ? String(p.preco).replace('.', ',') : ''
  const emb = p ? {qtd: p.qtd, unidade: p.unidade} : item.embalagem
  gQtd = emb ? String(emb.qtd).replace('.', ',') : '1'
  gUnid = emb?.unidade ?? resumos.get(item.id)?.unidade ?? 'un'
 }
 function salvarGondola(item: Item) {
  const preco = num(gPreco), qtd = numDec(gQtd)
  estado = registrarPesquisa(estado, item.id, preco > 0 && qtd > 0 ? {preco, qtd, unidade: gUnid, em: Date.now()} : undefined)
 }
 function comparacao(item: Item) {
  const p = estado.pesquisa[item.id], r = resumos.get(item.id)
  return p && r ? compararGondola(r, p.preco, p.qtd, p.unidade) : undefined
 }
 async function copiar(id: string, texto: string) {
  if (await copiarTexto(texto)) {copiado = id; vibrar(40); setTimeout(() => {if (copiado === id) copiado = ''}, 1800)}
 }
 function copiarRelatorio(modo: ModoRelatorio) {void copiar(modo, relatorio(estado, secao, modo))}

 // ---------- fechar ----------
 function encerrar() {
  confirmarDuasVezes('encerrar', () => {
   const n = levarLista.length
   estado = fecharCompra(estado, secao, levarLista)
   irTela('montar')
   avisar(n ? `Compra encerrada. ${n} ${n === 1 ? 'item ficou' : 'itens ficaram'} para a próxima lista.` : 'Compra encerrada.')
  })
 }

 // ---------- catálogo ----------
 function editar(item?: Item) {
  editId = item?.id ?? ''
  eNome = item?.nome ?? ''; eUnidade = item?.unidade ?? ''; eGrupo = item?.grupo ?? GRUPOS[secao][0]
  eVinculos = item ? [...item.vinculos] : []; eBusca = ''; eAuto = item?.vinculoAuto
  if (tela !== 'catalogo') tela = 'catalogo'
  void tick().then(() => document.getElementById('editor-item')?.scrollIntoView({behavior: 'smooth', block: 'start'}))
 }
 function salvarItem() {
  const nome = eNome.trim()
  if (!nome) {avisar('Dê um nome ao item.'); return}
  const vinculos = $state.snapshot(eVinculos)
  // vínculo automático confirmado ao salvar; vínculos apagados à mão não voltam sozinhos
  const vinculoAuto = vinculos.length ? undefined : (eAuto !== undefined ? false : undefined)
  const campos = {nome, unidade: eUnidade.trim(), grupo: eGrupo, embalagem: embalagemDaUnidade(eUnidade), vinculos, vinculoAuto}
  let id = editId
  if (id) estado = atualizarItem(estado, id, campos)
  else {const r = criarItem(estado, {...campos, secao}); estado = r.estado; id = r.item.id}
  editId = undefined; destacar(id!); avisar('Item salvo.')
 }
 function confirmarAuto(item: Item) {estado = atualizarItem(estado, item.id, {vinculoAuto: undefined}); vibrar(20)}
 function excluirItem() {
  const id = editId
  if (!id) {editId = undefined; return}
  confirmarDuasVezes('excluir-item', () => {estado = removerItem(estado, id); editId = undefined; avisar('Item excluído.')})
 }

 // ---------- lojas ----------
 function novaLista() {const r = criarLista(estado, novaListaNome, 'pessoal', [secao]); estado = r.estado; novaListaNome = ''; avisar(`Lista ${r.lista.nome} criada.`)}
 function alternarSecaoLista(l: Lista, s: Secao) {
  const secoes = l.secoes.includes(s) ? l.secoes.filter(x => x !== s) : [...l.secoes, s]
  estado = atualizarLista(estado, l.id, {secoes})
 }
 function moverLista(l: Lista, d: -1 | 1) {
  const ord = [...estado.listas].sort((a, b) => a.ordem - b.ordem)
  const i = ord.findIndex(x => x.id === l.id), j = i + d
  if (j < 0 || j >= ord.length) return
  estado = atualizarLista(atualizarLista(estado, l.id, {ordem: ord[j].ordem}), ord[j].id, {ordem: l.ordem})
 }
 function importar() {estado = importarPlanilha(estado); avisar('Modelo da planilha carregado.'); irTela('montar')}
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
   estado = e; tela = e.ciclos[secao].etapa; avisar(`Backup restaurado: ${e.listas.length} listas, ${e.itens.length} itens.`)
  } catch {avisar('Arquivo de backup inválido.')}
 }

 // ---------- EAN ----------
 async function lerCodigo() {
  lidoProduto = undefined; lidoCodigo = ''; lendo = true
  try {
   const [{iniciarLeitura}, {readerOptionsProduto, criarConfirmador}] = await Promise.all([import('../camera-scanner'), import('../scanner')])
   await tick()
   const confirma = criarConfirmador(2)
   const r = await iniciarLeitura(video!, texto => {if (confirma(texto)) {pararCamera(); tratarCodigo(texto)}}, {opcoes: readerOptionsProduto()})
   if (!lendo) r.parar(); else pararLeitura = r.parar
  } catch {pararCamera(); avisar('Não foi possível abrir a câmera.')}
 }
 function pararCamera() {pararLeitura?.(); pararLeitura = undefined; lendo = false}
 function itemDoProduto(p: ProdutoInfo) {return itensSecao.find(i => indice && produtosDosVinculos(indice, i.vinculos).has(p.chave))}
 function tratarCodigo(codigo: string) {
  vibrar(60); lidoCodigo = codigo
  const p = indice ? produtoPorGtin(indice, codigo) : undefined
  lidoProduto = p
  const item = p && itemDoProduto(p)
  if (item && qtdPorItem.has(item.id)) {
   busca = ''; filtroStatus = 'todos'; aberto = ''; abrir(item); destacar(item.id); lidoProduto = undefined; lidoCodigo = ''
   void tick().then(() => document.getElementById(`item-${item.id}`)?.scrollIntoView({behavior: 'smooth', block: 'center'}))
  }
 }
 function incluirLido(p: ProdutoInfo, l: Lista) {
  let item = itemDoProduto(p)
  if (!item) {
   const r = criarItem(estado, {nome: p.insumo != null ? (indice?.insumos.get(p.insumo)?.descricao ?? p.descricao) : p.descricao, secao, grupo: 'Outros',
    vinculos: [p.insumo != null ? {tipo: 'insumo', id: p.insumo} : {tipo: 'produto', chave: p.chave}]})
   estado = r.estado; item = r.item
  }
  estado = definirQuantidade(estado, l.id, item.id, item.ultimaQtd[l.id] || 1)
  lidoProduto = undefined; lidoCodigo = ''; destacar(item.id)
 }
</script>

{#snippet selo(n: number, rotulo: string)}{#if n}<span class="badge" aria-label="{n} {rotulo}">{n > 99 ? '99+' : n}</span>{/if}{/snippet}
{#snippet unid(item: Item)}{#if item.unidade}<span class="un">{item.unidade}</span>{/if}{/snippet}

{#snippet precos(item: Item, r: Resumo | undefined)}
 {#if r}
  {@const c = comparacao(item)}
  <div class="precos">
   <div class="caixa">
    <span class="rot">Último · {dataCurta(r.ultima!.data)}</span>
    <strong>{reais(r.ultima!.precoUnit)}<small>{porUnid(r)}</small></strong>
    <span class="det">{r.ultima!.fornecedor}{#if r.ultima!.embalagem && r.ultima!.embalagem !== `1 ${r.unidade}`}{' · '}{reais(r.ultima!.precoEmbalagem)} por {r.ultima!.embalagem}{/if}</span>
   </div>
   <div class="caixa media">
    <span class="rot">Média {r.mediaHistorico || r.janelaDias === 0 ? 'histórico' : `${r.janelaDias}d`}</span>
    <strong>{r.media ? reais(r.media) : '—'}<small>{porUnid(r)}</small></strong>
    <span class="det">{r.min != null && r.max != null && r.max - r.min > 0.005 ? `${reais(r.min)} – ${reais(r.max)}` : 'estável'} · {r.compras.length} NF</span>
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
  <p class="sem-hist">Sem histórico: ganha preço quando aparecer numa NF-e.</p>
 {/if}
{/snippet}

<section class="compras" class:com-teclado={teclado > 0} style="--teclado:{teclado}px" onfocusin={aoFocar} onfocusout={aoDesfocar}>
 <div class="fixo">
  <nav class="passos" aria-label="Etapas">
   <button class:on={tela === 'montar'} onclick={() => irTela('montar')}><b>1</b>Montar{@render selo(escolhidos, 'itens escolhidos')}</button>
   <button class:on={tela === 'comprar'} disabled={!escolhidos} onclick={() => irTela('comprar')}><b>2</b>Comprar{@render selo(contar(entradas).pendente, 'pendentes')}</button>
   <button class:on={tela === 'fechar'} disabled={!escolhidos} onclick={() => irTela('fechar')}><b>3</b>Fechar</button>
   <button class="mais" class:on={tela === 'catalogo' || tela === 'lojas' || tela === 'precos'} onclick={() => irTela(tela === 'catalogo' || tela === 'lojas' || tela === 'precos' ? 'montar' : 'catalogo')} aria-label="Catálogo, lojas e ajustes">⚙︎{@render selo(autoPendentes, 'vínculos automáticos para conferir')}</button>
  </nav>
  <div class="cabeca">
   <div class="secoes" role="tablist" aria-label="Seção de compras">
    {#each SECOES as s (s.id)}
     {@const n = new Set(entradasDaSecao(estado, s.id).map(x => x.itemId)).size}
     <button role="tab" aria-selected={secao === s.id} class:on={secao === s.id} onclick={() => trocarSecao(s.id)} title={s.nome}><span class="rot-sec">{s.emoji} {s.curto}</span>{@render selo(n, 'itens na lista')}</button>
    {/each}
   </div>
   <button class="tema" onclick={alternarTema} aria-label={escuro ? 'Usar tema claro' : 'Usar tema escuro'} title={escuro ? 'Tema claro' : 'Tema escuro'}>{escuro ? '☀' : '☾'}</button>
   <button class="sync" class:girando={sincronizando} onclick={() => sincronizar()} disabled={sincronizando} aria-label="Sincronizar preços">⟳<span>{snapshot ? dataCurta(snapshot.geradoEm.slice(0, 10)) : 'preços'}</span></button>
  </div>
  {#if tela === 'catalogo' || tela === 'lojas' || tela === 'precos'}
   <nav class="sub" aria-label="Configuração">
    <button class:on={tela === 'catalogo'} onclick={() => irTela('catalogo')}>Catálogo</button>
    <button class:on={tela === 'lojas'} onclick={() => irTela('lojas')}>Lojas e histórico</button>
    <button class:on={tela === 'precos'} onclick={() => irTela('precos')}>Ajustes</button>
   </nav>
  {/if}
 </div>
 {#if !emDisco}<p class="alerta">Este navegador não está guardando os dados (aba privada?). Baixe um backup em Lojas.</p>{/if}
 {#if erroSync}<p class="alerta">{erroSync}</p>{/if}

 {#if !estado.itens.length && tela !== 'precos' && tela !== 'lojas'}
  <div class="vazio">
   <h2>Comece pelo modelo da planilha</h2>
   <p class="small">Carrega os {TAMANHO_PLANILHA.producao} itens de produção e os {TAMANHO_PLANILHA.bebidas} de bebidas e salão, com a unidade de cada um e as lojas Tijuca e Freguesia. Nada fica marcado: você escolhe o que vai comprar.</p>
   <button class="primary" onclick={importar}>Carregar modelo da planilha</button>
   <button class="secondary" onclick={() => irTela('lojas')}>Restaurar backup</button>
  </div>

 {:else if tela === 'montar'}
  <p class="lead">Marque o que precisa e a quantidade por loja. {#if lojas.length}Toque em <b>+</b> para usar a última quantidade.{/if}</p>
  {#if !lojas.length}<p class="alerta">Nenhuma loja participa desta seção. Ajuste em ⚙︎ → Lojas.</p>{/if}
  {#if abertos.length}
   <div class="faltantes">
    <div class="ft-cab"><strong>🔁 Ficaram faltando ({abertos.length})</strong><button class="link" onclick={incluirTodosFaltantes}>incluir todos</button></div>
    {#each abertos as f (chave(f))}
     {@const i = itemPorId.get(f.itemId)!}{@const l = listaPorId.get(f.listaId)}
     <div class="ft">
      <span class="sigla" style="--cor:{l?.cor}">{l?.sigla}</span>
      <span class="ft-nome">{formatarQtd(f.quantidade)} · {i.nome} {@render unid(i)}<small>faltou em {f.desde}</small></span>
      <button class="mini-ok" aria-label="Incluir na lista" onclick={() => estado = incluirFaltantes(estado, [f])}>+</button>
      <button class="mini-x" aria-label="Não precisa mais" onclick={() => estado = descartarFaltante(estado, f)}>×</button>
     </div>
    {/each}
   </div>
  {/if}
  <div class="busca">
   <input type="search" bind:value={busca} placeholder="Buscar item…" aria-label="Buscar item"/>
   <button class="filtro" class:on={soEscolhidos} onclick={() => soEscolhidos = !soEscolhidos}>{soEscolhidos ? 'Escolhidos' : 'Todos'}</button>
  </div>
  {#each montagem as g (g.grupo)}
   <h2 class="grupo">{EMOJI_GRUPO[g.grupo] ?? '📌'} {g.grupo}</h2>
   <div class="tabela">
    {#each g.itens as item (item.id)}
     {@const qs = qtdPorItem.get(item.id)}
     {@const r = resumos.get(item.id)}
     <div class="linha ln-m" class:sel={!!qs} class:destaque={destaque === item.id}>
      <div class="ln-nome">
       <span class="t">{item.nome}</span>{@render unid(item)}
       {#if r}<small class="px">méd {reais(r.media ?? r.ultima!.precoUnit)}{porUnid(r)}</small>{/if}
      </div>
      <div class="stps" style="--n:{lojas.length}">
       {#each lojas as l (l.id)}
        {@const x = qs?.get(l.id)}
        <div class="stp" class:on={!!x} style="--cor:{l.cor}">
         <span class="stp-loja">{l.sigla}</span>
         <button class="stp-b" disabled={!x} aria-label="Diminuir {item.nome} em {l.nome}" onclick={() => passoQtd(item, l, -1)}>−</button>
         <input id="q-{item.id}-{l.id}" value={campoQtd(x?.quantidade ?? 0)} placeholder={item.ultimaQtd[l.id] ? campoQtd(item.ultimaQtd[l.id]) : '0'}
          inputmode={qtdDecimal(item) ? 'decimal' : 'numeric'} enterkeyhint="done" autocomplete="off"
          aria-label="Quantidade de {item.nome} em {l.nome}{qtdDecimal(item) ? ` (${item.unidade})` : ''}"
          oninput={(e) => filtrarDigitacao(item, e.currentTarget)} onchange={(e) => digitarQtd(item, l, e.currentTarget.value)}
          onkeydown={(e) => {if (e.key === 'Enter') e.currentTarget.blur()}}/>
         <button class="stp-b" aria-label="Aumentar {item.nome} em {l.nome}" onclick={() => passoQtd(item, l, 1)}>+</button>
        </div>
       {/each}
      </div>
     </div>
    {/each}
   </div>
  {:else}
   <p class="vazio-curto">Nada com esse filtro.</p>
  {/each}
  <form class="novo" onsubmit={(e) => {e.preventDefault(); criarNovo()}}>
   <p class="rotulo">Item novo</p>
   <div class="linha-acoes">
    <input bind:value={nNome} placeholder="Nome (ex.: Páprica defumada)" aria-label="Nome do item novo"/>
    <input class="qtd" bind:value={nUnidade} placeholder="un/kg" aria-label="Unidade"/>
   </div>
   <div class="linha-acoes"><select bind:value={nGrupo} aria-label="Grupo">{#each GRUPOS[secao] as gr (gr)}<option value={gr}>{EMOJI_GRUPO[gr]} {gr}</option>{/each}</select><button class="primary">Criar</button></div>
   <p class="small">Sem histórico por enquanto: o vínculo com a compra é sugerido depois da primeira NF-e dele.</p>
  </form>
  <div class="barra">
   <button class="secondary" onclick={() => copiarRelatorio('tudo')} disabled={!escolhidos}>{copiado === 'tudo' ? 'Copiado ✓' : '📋 Copiar'}</button>
   <button class="primary" onclick={irComprar} disabled={!escolhidos}>Ir às compras · {escolhidos} {escolhidos === 1 ? 'item' : 'itens'} →</button>
  </div>

 {:else if tela === 'comprar'}
  <div class="metricas">
   {#each [['comprado', 'Comprados', '✓'], ['indisponivel', 'Em falta', '✕'], ['pendente', 'Pendentes', '◷']] as [s, r, ic] (s)}
    <button class="metrica m-{s}" class:on={filtroStatus === s} onclick={() => filtroStatus = filtroStatus === s ? 'todos' : s as Status}><strong>{contagem[s as Status]}</strong><span>{ic} {r}</span></button>
   {/each}
  </div>
  {#if lojas.length > 1}
   <div class="chips-filtro">
    <button class:on={filtroLista === 'todas'} onclick={() => filtroLista = 'todas'}>Todas</button>
    {#each lojas as l (l.id)}<button class:on={filtroLista === l.id} style="--cor:{l.cor}" onclick={() => filtroLista = l.id}><b class="sigla">{l.sigla}</b>{l.nome}</button>{/each}
   </div>
  {/if}
  <div class="busca">
   <input type="search" bind:value={busca} placeholder="Buscar na lista…" aria-label="Buscar na lista"/>
   <button class="ean" onclick={lendo ? pararCamera : lerCodigo} aria-label="Ler código de barras">{lendo ? '✕' : '▥'}<span>{lendo ? 'Fechar' : 'EAN'}</span></button>
  </div>
  {#if lendo}<div class="camera"><video bind:this={video} autoplay muted playsinline aria-label="Câmera lendo código de barras"></video><span class="mira" aria-hidden="true"></span></div>{/if}
  {#if lidoCodigo && !lendo}
   <div class="lido">
    {#if lidoProduto}
     {@const r = indice ? resumir(indice, [lidoProduto.insumo != null ? {tipo: 'insumo', id: lidoProduto.insumo} : {tipo: 'produto', chave: lidoProduto.chave}], janela) : undefined}
     <p class="eyebrow">EAN {lidoCodigo} · {lidoProduto.fornecedor}</p>
     <h3>{lidoProduto.descricao}</h3>
     {#if r}<p class="small">Último {reais(r.ultima!.precoUnit)}{porUnid(r)} em {dataCurta(r.ultima!.data)} · média {reais(r.media ?? 0)}{porUnid(r)}</p>{/if}
     <p class="small">Não está na lista desta compra. Incluir em:</p>
     <div class="linha-acoes">{#each lojas as l (l.id)}<button class="secondary curto" onclick={() => incluirLido(lidoProduto!, l)}>{l.nome}</button>{/each}</div>
    {:else}<p class="small">EAN {lidoCodigo} não aparece nas NF-e sincronizadas.</p>{/if}
    <button class="link" onclick={() => {lidoCodigo = ''; lidoProduto = undefined}}>fechar</button>
   </div>
  {/if}
  {#each compra as g (g.grupo)}
   <h2 class="grupo">{EMOJI_GRUPO[g.grupo] ?? '📌'} {g.grupo}</h2>
   {#each g.itens as item (item.id)}
    {@const es = lojasVisiveis.map(id => qtdPorItem.get(item.id)?.get(id)).filter((x): x is Entrada => !!x)}
    {@const feito = es.every(x => x.status === 'comprado')}
    {@const faltou = es.every(x => x.status === 'indisponivel')}
    {@const c = comparacao(item)}
    <article class="item" id="item-{item.id}" class:feito class:faltou class:destaque={destaque === item.id} class:aberto={aberto === item.id}>
     <div class="cab">
      <button class="nome" onclick={() => abrir(item)} aria-expanded={aberto === item.id}>
       <span class="t">{item.nome}</span>{@render unid(item)}
       {#if es.length === 1}<span class="q">{formatarQtd(es[0].quantidade)}</span>{/if}
       {#if c}<span class="selo v-{c.veredito}">{pct(c.vsMedia ?? c.vsUltima)}</span>{/if}
       {#if es.some(x => x.herdada)}<span class="herd">faltou antes</span>{/if}
      </button>
      {#if es.length === 1}
       {@const x = es[0]}
       <div class="acoes">
        <button class="ac buy" class:on={x.status === 'comprado'} aria-pressed={x.status === 'comprado'} aria-label="Comprado: {item.nome}" onclick={() => tocar(x.listaId, item.id, 'comprado')}>✓</button>
        <button class="ac miss" class:on={x.status === 'indisponivel'} aria-pressed={x.status === 'indisponivel'} aria-label="Em falta: {item.nome}" onclick={() => tocar(x.listaId, item.id, 'indisponivel')}>✕</button>
       </div>
      {:else}
       <div class="acoes"><button class="ac buy" class:on={feito} aria-label="Comprado em todas as lojas: {item.nome}" onclick={() => tocarTudo(item.id, es, 'comprado')}>✓✓</button></div>
      {/if}
     </div>
     {#if es.length > 1}
      <div class="porlista">
       {#each es as x (x.listaId)}{@const l = listaPorId.get(x.listaId)}
        <div class="pl st-{x.status}" style="--cor:{l?.cor}">
         <b class="sigla">{l?.sigla}</b><span class="q">{formatarQtd(x.quantidade)}</span>
         <button class="mini buy" class:on={x.status === 'comprado'} aria-label="Comprado em {l?.nome}" onclick={() => tocar(x.listaId, item.id, 'comprado')}>✓</button>
         <button class="mini miss" class:on={x.status === 'indisponivel'} aria-label="Em falta em {l?.nome}" onclick={() => tocar(x.listaId, item.id, 'indisponivel')}>✕</button>
        </div>
       {/each}
      </div>
     {/if}
     {@render precos(item, resumos.get(item.id))}
     {#if aberto === item.id}
      {@const r = resumos.get(item.id)}
      <div class="detalhe">
       <form class="gondola" onsubmit={(e) => {e.preventDefault(); salvarGondola(item)}}>
        <label for="gp-{item.id}">Preço na gôndola</label>
        <div class="linha-acoes">
         <input id="gp-{item.id}" class="preco" bind:value={gPreco} inputmode="decimal" placeholder="R$ 0,00"/>
         <span class="por">por</span>
         <input class="qtd" bind:value={gQtd} inputmode="decimal" aria-label="Conteúdo da embalagem"/>
         <select bind:value={gUnid} aria-label="Unidade">{#each UNIDADES as u (u)}<option value={u}>{rotulo(u)}</option>{/each}</select>
         <button class="primary curto">Comparar</button>
        </div>
        {#if estado.pesquisa[item.id]}<button type="button" class="link" onclick={() => {estado = registrarPesquisa(estado, item.id); gPreco = ''}}>apagar preço da gôndola</button>{/if}
       </form>
       {#if r}
        <table class="hist"><thead><tr><th>Data</th><th>Onde / produto</th><th>Emb.</th><th>{porUnid(r)}</th></tr></thead><tbody>
         {#each r.compras.slice(-8).reverse() as cp, k (k)}
          <tr><td>{dataCurta(cp.data, true)}</td><td><b>{cp.fornecedor}</b> {cp.descricao}</td><td>{reais(cp.precoEmbalagem)}{#if cp.embalagem}<small class="emb">{cp.embalagem}</small>{/if}</td><td class="u">{reais(cp.precoUnit)}</td></tr>
         {/each}
        </tbody></table>
       {/if}
       <button class="link" onclick={() => editar(item)}>editar item e vínculo</button>
      </div>
     {/if}
    </article>
   {/each}
  {:else}
   <p class="vazio-curto">{#if !entradas.length}Nenhum item escolhido em {SECOES.find(x => x.id === secao)?.nome}. <button class="link" onclick={() => irTela('montar')}>Montar a lista</button>{:else}Nada com esse filtro.{/if}{#if entradas.length && (filtroStatus !== 'todos' || busca)} <button class="link" onclick={() => {filtroStatus = 'todos'; busca = ''}}>mostrar tudo</button>{/if}</p>
  {/each}
  <div class="exportar">
   <p class="rotulo">Enviar no WhatsApp</p>
   <div class="dois">
    <button class="secondary" onclick={() => copiarRelatorio('tudo')}>{copiado === 'tudo' ? 'Copiado ✓' : '📋 Lista completa'}</button>
    <button class="secondary" onclick={() => copiarRelatorio('abertos')}>{copiado === 'abertos' ? 'Copiado ✓' : '⏳ Falta comprar'}</button>
    <button class="secondary" onclick={() => copiarRelatorio('pendentes')}>{copiado === 'pendentes' ? 'Copiado ✓' : '⬜ Só pendentes'}</button>
    <button class="secondary" onclick={() => copiarRelatorio('faltou')}>{copiado === 'faltou' ? 'Copiado ✓' : '❌ Em falta'}</button>
   </div>
  </div>
  <div class="barra">
   <button class="secondary" onclick={() => irTela('montar')}>← Lista</button>
   <button class="primary" onclick={() => irTela('fechar')}>Finalizar compra →</button>
  </div>

 {:else if tela === 'fechar'}
  {@const c = contar(entradas)}
  <div class="resumo-fim">
   <p class="eyebrow">{SECOES.find(s => s.id === secao)?.nome.toUpperCase()} · {ciclo.nome || hoje()}</p>
   <h2>Esta lista termina com {c.comprado} {c.comprado === 1 ? 'item comprado' : 'itens comprados'} e {c.indisponivel} em falta.</h2>
   <div class="metricas fixas">
    <div class="metrica m-comprado"><strong>{c.comprado}</strong><span>✓ Comprados</span></div>
    <div class="metrica m-indisponivel"><strong>{c.indisponivel}</strong><span>✕ Em falta</span></div>
    <div class="metrica m-pendente"><strong>{c.pendente}</strong><span>◷ Sem marcar</span></div>
   </div>
  </div>
  {#if naoComprados.length}
   <p class="rotulo">Faltantes para a próxima lista <small>(desmarque o que não precisa mais)</small></p>
   <div class="tabela">
    {#each naoComprados as x (chave(x))}
     {@const i = itemPorId.get(x.itemId)!}{@const l = listaPorId.get(x.listaId)}
     <label class="linha fim">
      <input type="checkbox" checked={levar[chave(x)] !== false} onchange={(e) => levar = {...levar, [chave(x)]: e.currentTarget.checked}}/>
      <span class="sigla" style="--cor:{l?.cor}">{l?.sigla}</span>
      <span class="ln-nome"><span class="t">{formatarQtd(x.quantidade)} · {i.nome}</span>{@render unid(i)}</span>
      <span class="st">{x.status === 'indisponivel' ? '❌ em falta' : '⬜ sem marcar'}</span>
     </label>
    {/each}
   </div>
   <p class="small">Os marcados aparecem no topo da próxima lista desta seção, em “Ficaram faltando”, até serem comprados ou descartados.</p>
  {:else}
   <p class="vazio-curto">🎉 Tudo comprado.</p>
  {/if}
  <button class="secondary" onclick={() => copiar('fim', relatorioFechamento(estado, secao, levarLista))}>{copiado === 'fim' ? 'Copiado ✓' : '📋 Copiar resumo para o WhatsApp'}</button>
  <div class="barra">
   <button class="secondary" onclick={() => irTela('comprar')}>← Compras</button>
   <button class="primary" onclick={encerrar}>{confirmar === 'encerrar' ? 'Toque de novo para encerrar' : `Encerrar lista${levarLista.length ? ` · ${levarLista.length} ficam` : ''}`}</button>
  </div>

 {:else if tela === 'catalogo'}
  {#if editId !== undefined}
   <form id="editor-item" class="editor" onsubmit={(e) => {e.preventDefault(); salvarItem()}}>
    <p class="eyebrow">{editId ? 'EDITAR ITEM' : 'NOVO ITEM'} · {SECOES.find(s => s.id === secao)?.nome.toUpperCase()}</p>
    <label for="e-nome">Nome</label><input id="e-nome" bind:value={eNome} placeholder="Maionese" required/>
    <div class="row">
     <div><label for="e-un">Unidade na loja</label><input id="e-un" bind:value={eUnidade} placeholder="kg, 2,8 kg, 900 ml, fd"/></div>
     <div><label for="e-grupo">Grupo</label><select id="e-grupo" bind:value={eGrupo}>{#each [...new Set([...GRUPOS[secao], eGrupo])] as gr (gr)}<option value={gr}>{EMOJI_GRUPO[gr] ?? '📌'} {gr}</option>{/each}</select></div>
    </div>
    {#if embalagemDaUnidade(eUnidade)}{@const em = embalagemDaUnidade(eUnidade)!}<p class="small">Comparação na gôndola usa {String(em.qtd).replace('.', ',')} {rotulo(em.unidade)} por embalagem.</p>{/if}
    <p class="rotulo">Vínculo com compras (NF-e / Saipos)</p>
    {#if eVinculos.length}
     <div class="chips">{#each eVinculos as v, k (k)}<span class="chip">{rotuloVinculo(indice, v)}<button type="button" aria-label="Remover vínculo" onclick={() => eVinculos = eVinculos.filter((_, j) => j !== k)}>×</button></span>{/each}</div>
     {#if eAuto}<p class="small">Sugerido automaticamente. Salvar confirma.</p>{/if}
    {:else}<p class="small">Sem vínculo. Item novo fica assim até a primeira NF-e; depois escolha abaixo.</p>{/if}
    {#if indice}
     <input bind:value={eBusca} placeholder="Buscar insumo ou produto da nota" aria-label="Buscar vínculo"/>
     <div class="candidatos">
      {#each candidatosEditor as cd (JSON.stringify(cd.vinculo))}
       <button type="button" onclick={() => eVinculos = [...eVinculos, cd.vinculo]}><span>{cd.rotulo}</span><small>{cd.detalhe} · {cd.compras} NF</small></button>
      {:else}<p class="small">Nenhum candidato para “{eBusca || eNome}”.</p>{/each}
     </div>
    {:else}<p class="small">Sincronize os preços para buscar vínculos.</p>{/if}
    {#if resumoEditor}
     <p class="small">Prévia: último {reais(resumoEditor.ultima!.precoUnit)}{porUnid(resumoEditor)} · média {reais(resumoEditor.media ?? 0)}{porUnid(resumoEditor)} · {resumoEditor.compras.length} NF</p>
    {/if}
    <div class="dois"><button class="primary">Salvar</button><button type="button" class="secondary" onclick={() => editId = undefined}>Cancelar</button></div>
    {#if editId}<button type="button" class="secondary perigo" onclick={excluirItem}>{confirmar === 'excluir-item' ? 'Toque de novo para excluir' : 'Excluir do catálogo'}</button>{/if}
   </form>
  {:else}
   <div class="busca"><input type="search" bind:value={busca} placeholder="Buscar no catálogo…" aria-label="Buscar no catálogo"/><button class="filtro on" onclick={() => editar()}>+ Item</button></div>
   <p class="small">{itensSecao.length} itens · {semVinculo} sem vínculo{#if autoPendentes} · <b>{autoPendentes} vínculos automáticos para confirmar</b>{/if}</p>
   {#each catalogo as g (g.grupo)}
    <h2 class="grupo">{EMOJI_GRUPO[g.grupo] ?? '📌'} {g.grupo}</h2>
    <div class="tabela">
     {#each g.itens as item (item.id)}
      <div class="linha cat" class:destaque={destaque === item.id}>
       <button class="cat-nome" onclick={() => editar(item)}>
        <span><span class="t">{item.nome}</span>{@render unid(item)}</span>
        <small class:auto={item.vinculoAuto}>{item.vinculos.length ? item.vinculos.map(v => rotuloVinculo(indice, v)).join(' + ') : 'sem vínculo'}</small>
       </button>
       {#if item.vinculoAuto}<button class="mini-ok" aria-label="Confirmar vínculo automático" onclick={() => confirmarAuto(item)}>✓</button>{/if}
      </div>
     {/each}
    </div>
   {/each}
  {/if}

 {:else if tela === 'lojas'}
  <div class="bloco">
   <p class="rotulo">Lojas e listas</p>
   {#each [...estado.listas].sort((a, b) => a.ordem - b.ordem) as l, k (l.id)}
    <div class="lista-edit" style="--cor:{l.cor}">
     <input class="sig" value={l.sigla} maxlength="4" aria-label="Sigla" onchange={(e) => estado = atualizarLista(estado, l.id, {sigla: e.currentTarget.value.toUpperCase() || l.sigla})}/>
     <input value={l.nome} aria-label="Nome" onchange={(e) => estado = atualizarLista(estado, l.id, {nome: e.currentTarget.value.trim() || l.nome})}/>
     <div class="secs">{#each SECOES as s (s.id)}<label><input type="checkbox" checked={l.secoes.includes(s.id)} onchange={() => alternarSecaoLista(l, s.id)}/> {s.emoji} {s.nome}</label>{/each}</div>
     <div class="cores">{#each CORES as cor (cor)}<button aria-label="Cor" class:on={l.cor === cor} style="background:{cor}" onclick={() => estado = atualizarLista(estado, l.id, {cor})}></button>{/each}</div>
     <div class="ord"><button aria-label="Subir" disabled={k === 0} onclick={() => moverLista(l, -1)}>↑</button><button aria-label="Descer" disabled={k === estado.listas.length - 1} onclick={() => moverLista(l, 1)}>↓</button>
      <button class="perigo" onclick={() => confirmarDuasVezes(`lista-${l.id}`, () => {estado = removerLista(estado, l.id); filtroLista = 'todas'})}>{confirmar === `lista-${l.id}` ? 'confirmar' : 'excluir'}</button></div>
    </div>
   {/each}
   <form class="linha-acoes" onsubmit={(e) => {e.preventDefault(); novaLista()}}>
    <input bind:value={novaListaNome} placeholder="Nova lista (ex.: Casa)" aria-label="Nome da nova lista"/>
    <button class="primary curto">Criar</button>
   </form>
   <p class="small">Cada lista aparece só nas seções marcadas.</p>
  </div>
  <div class="bloco">
   <p class="rotulo">Histórico de compras</p>
   {#each estado.historico.slice(0, 12) as h (h.id)}
    {@const c = contar(h.itens.map(x => ({status: x.status}) as Entrada))}
    <div class="hist-linha"><span>{SECOES.find(s => s.id === h.secao)?.emoji} {h.nome}</span><span>✅ {c.comprado} · ❌ {c.indisponivel} · ⬜ {c.pendente}</span></div>
   {:else}<p class="small">Nenhuma compra encerrada ainda.</p>{/each}
  </div>
  <div class="bloco">
   <p class="rotulo">Modelo e backup</p>
   <button class="secondary" onclick={importar}>Recarregar modelo da planilha (completa sem duplicar)</button>
   <div class="dois"><button class="secondary" onclick={baixarBackup}>Baixar backup</button><button class="secondary" onclick={() => arquivoBackup?.click()}>Restaurar backup</button></div>
   <input type="file" accept="application/json,.json" hidden bind:this={arquivoBackup} onchange={(e) => restaurarBackup(e.currentTarget.files?.[0])}/>
   <p class="small">Listas e itens ficam só neste aparelho. Use o backup para passar para outro.</p>
  </div>

 {:else}
  <div class="bloco">
   <p class="rotulo">Aparência</p>
   <div class="janelas"><button class:on={!escuro} onclick={() => escuro && alternarTema()}>☀ Claro</button><button class:on={escuro} onclick={() => !escuro && alternarTema()}>☾ Escuro</button></div>
   <p class="small">Ao abrir a página o tema segue o horário: escuro das 18h às 6h. O botão ☾/☀ no topo troca a qualquer momento e a escolha vale até fechar a aba.</p>
  </div>
  <div class="bloco">
   <p class="rotulo">Preços das NF-e (Supabase)</p>
   <p class="small">O app baixa as compras com NF-e já processadas e guarda no aparelho: na gôndola funciona sem sinal. Atualiza sozinho ao abrir, se os preços tiverem mais de 6 h. Itens sem vínculo recebem sugestão automática quando o nome bate sem ambiguidade.</p>
   <form onsubmit={(e) => {e.preventDefault(); void sincronizar()}}>
    <label for="tok">Token deste aparelho</label>
    <input id="tok" type="password" bind:value={token} autocomplete="off" placeholder="thb_…"/>
    <button class="primary" disabled={sincronizando}>{sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}</button>
   </form>
   {#if snapshot}
    <div class="stats"><div><strong>{snapshot.obs.length}</strong><span>compras</span></div><div><strong>{snapshot.produtos.length}</strong><span>produtos</span></div><div><strong>{snapshot.produtos.filter(p => p.gtin).length}</strong><span>com EAN</span></div></div>
    <p class="small">Período {periodo} · baixado em {new Date(snapshot.geradoEm).toLocaleString('pt-BR')}.</p>
   {/if}
  </div>
  <div class="bloco">
   <p class="rotulo">Média de preço</p>
   <div class="janelas">{#each JANELAS as j (j.d)}<button class:on={janela === j.d} onclick={() => escolherJanela(j.d)}>{j.r}</button>{/each}</div>
   <p class="small">Ponderada pela quantidade comprada, na unidade do insumo (R$/kg, R$/L, R$/un). Inclui frete, desconto, IPI e ST da nota.</p>
  </div>
 {/if}

 {#if aviso}<p class="toast" role="status">{aviso}</p>{/if}
</section>

<style>
 .compras{--sup:#fff;--fundo:#f5f4ef;--fundo-t:#f5f4efee;--pri:#193f35;--tx:#10251f;--tx2:#45594f;--tx3:#65766f;--bd:#c7d2c8;--bd2:#eef1ec;--f1:#eef2ec;--ok-f:#e7f3ea;--ok-b:#9fc7ad;--er-f:#f8e5e0;--er-b:#e3b9ae;--er-t:#8f3e2c;--av-f:#fcf3dc;--av-b:#e7c98e;--av-t:#7a5a1d;--rx-f:#f1e8f6;--rx-t:#7b3fa0;--az-f:#eef3f8;--az-t:#2f6f9f;--v:#1f6a43;--r:#b83d3d;--a:#9a6b16;max-width:760px;padding-bottom:calc(84px + var(--teclado,0px));color:var(--tx)}
 :global(html[data-tema='escuro']) .compras{--sup:#17211d;--fundo:#0e1512;--fundo-t:#0e1512ee;--pri:#2f8462;--tx:#e6eee9;--tx2:#bccbc2;--tx3:#8fa198;--bd:#33443c;--bd2:#222e29;--f1:#1f2b26;--ok-f:#173326;--ok-b:#2f6b4b;--er-f:#3a1f1b;--er-b:#7a3a2f;--er-t:#f0a493;--av-f:#33280f;--av-b:#7a6127;--av-t:#e8c57c;--rx-f:#2d2236;--rx-t:#cfa2ea;--az-f:#18242f;--az-t:#8cc0ea;--v:#4cb57d;--r:#e0706a;--a:#d6a845;color-scheme:dark}
 :global(html.modo-app),:global(html.modo-app body){overflow-x:clip;overscroll-behavior-x:none;max-width:100%;-webkit-text-size-adjust:100%}
 :global(html[data-tema='escuro']),:global(html[data-tema='escuro'] body),:global(html[data-tema='escuro'] .app),:global(html[data-tema='escuro'] main){background:#0e1512!important;color:#e6eee9}
 :global(html[data-tema='escuro'] aside){background:#0b110f!important;border-color:#222e29!important}
 :global(html.modo-app) .compras :is(button,input){-webkit-tap-highlight-color:transparent}
 .com-teclado .barra{display:none}
 :global(html[data-tema='escuro']) .toast{background:#e6eee9;color:#0e1512}
 .eyebrow{font-size:12px;font-weight:700;letter-spacing:2px;color:var(--tx3);margin:0}
 .small{font-size:14px;line-height:1.55;color:var(--tx3);margin:10px 0 0}
 .lead{font-size:15px;color:var(--tx2);margin:14px 0 4px}
 label{display:block;margin:14px 0 6px;font-size:14px;font-weight:600}
 input,select{width:100%;border:1px solid var(--bd);border-radius:8px;padding:11px 12px;background:var(--sup);color:var(--tx);font-size:17px}
 input[type=checkbox]{width:20px;height:20px;padding:0;accent-color:var(--pri);flex:0 0 auto}
 select{padding:10px 8px}
 button{font:inherit;cursor:pointer;color:inherit}
 button:disabled{opacity:.45;cursor:default}
 .primary,.secondary{padding:13px 16px;border-radius:9px;font-size:16px;font-weight:600;margin-top:10px;width:100%}
 .primary{background:var(--pri);color:#fff;border:1px solid var(--pri)}
 .secondary{background:var(--sup);color:var(--pri);border:1px solid var(--bd)}
 .curto{width:auto;margin-top:0;padding:10px 14px}
 .perigo{color:var(--er-t)!important}
 .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
 .fixo{position:sticky;top:0;z-index:6;background:var(--fundo);margin:0 -2px;padding:12px 2px 6px;padding-top:calc(12px + env(safe-area-inset-top))}
 .cabeca{display:flex;gap:8px;align-items:stretch;margin-top:12px}
 .secoes{flex:1;display:flex;overflow:visible;background:var(--f1);border-radius:12px;padding:4px;gap:4px;min-width:0}
 .secoes button{position:relative;flex:1;min-width:0;border:0;background:transparent;border-radius:9px;padding:10px 6px;font-size:15px;font-weight:700;color:var(--tx2);white-space:nowrap}
 .rot-sec{display:block;overflow:hidden;text-overflow:ellipsis}
 .passos button,.secoes button{position:relative}
 .badge{position:absolute;top:-8px;right:-7px;z-index:1;display:grid;place-items:center;min-width:22px;height:22px;padding:0 6px;border-radius:11px;background:#ff3b30;color:#fff;font-size:13px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums;border:2px solid var(--fundo);box-shadow:0 1px 3px #0003;pointer-events:none}
 .secoes button.on{background:var(--pri);color:#fff}
 .sync{display:grid;justify-items:center;align-content:center;border:1px solid var(--bd);background:var(--sup);border-radius:12px;padding:4px 10px;font-size:20px;color:var(--pri);min-width:58px}
 .tema{flex:0 0 48px;border:1px solid var(--bd);background:var(--sup);border-radius:12px;font-size:21px;color:var(--tx2);padding:0}
 .sync span{font-size:12px;color:var(--tx3)}
 .sync.girando{animation:gira 1s linear infinite}
 @keyframes gira{to{transform:rotate(360deg)}}
 .passos{display:flex;gap:6px}
 .passos button{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--bd);background:var(--sup);border-radius:10px;padding:9px 4px;font-size:15px;font-weight:700;color:var(--tx2)}
 .passos button b{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--f1);font-size:13px}
 .passos button.on:disabled{opacity:1}
 .passos button.on{border-color:var(--pri);background:var(--pri);color:#fff}
 .passos button.on b{background:var(--sup);color:var(--pri)}
 .passos .mais{flex:0 0 46px;font-size:19px}
 .sub{display:flex;gap:6px;margin-top:4px}
 .sub button{flex:1;border:0;border-bottom:2px solid transparent;background:transparent;padding:8px 2px;font-size:14px;font-weight:700;color:var(--tx3)}
 .sub button.on{border-color:var(--pri);color:var(--tx)}
 .alerta{font-size:14px;color:var(--av-t);background:var(--av-f);border-radius:8px;padding:9px 12px;margin:10px 0}
 .vazio{display:grid;gap:4px;margin-top:18px;padding:20px;border:1px dashed var(--bd);border-radius:12px;background:var(--f1)}
 .vazio h2{font-size:20px;margin:0}
 .vazio-curto{font-size:15px;color:var(--tx3);text-align:center;padding:18px 0}
 .faltantes{border:1px solid var(--av-b);background:var(--av-f);border-radius:12px;padding:10px 12px;margin-top:12px}
 .ft-cab{display:flex;justify-content:space-between;align-items:center;font-size:15px}
 .ft{display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid var(--bd2)}
 .ft-nome{flex:1;min-width:0;font-size:15px;font-weight:600}
 .ft-nome small{display:block;font-weight:400;color:var(--av-t);font-size:13px}
 .mini-ok,.mini-x{width:36px;height:34px;border-radius:8px;border:1px solid var(--bd);background:var(--sup);font-size:19px;flex:0 0 auto}
 .mini-ok{color:#1f6a43;border-color:var(--ok-b)}
 .mini-x{color:var(--er-t)}
 .busca{display:flex;gap:8px;margin-top:12px}
 .busca input{flex:1}
 .filtro{flex:0 0 auto;border:1px solid var(--bd);background:var(--sup);border-radius:8px;padding:0 14px;font-size:15px;font-weight:600}
 .filtro.on{background:var(--pri);color:#fff;border-color:var(--pri)}
 .grupo{font-size:16px;margin:18px 0 6px;letter-spacing:0}
 .tabela{background:var(--sup);border:1px solid var(--bd);border-radius:12px;overflow:hidden}
 .linha{display:flex;align-items:center;gap:8px;padding:8px 10px;border-top:1px solid var(--bd2);min-height:52px;transition:background .3s}
 .linha:first-child{border-top:0}
 .linha.sel{background:var(--ok-f)}
 .linha.destaque{background:var(--ok-f)}
 .ln-nome{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px}
 .t{font-size:16px;font-weight:600;color:var(--tx)}
 .un{font-size:13px;font-weight:700;color:var(--tx2);background:var(--f1);border-radius:6px;padding:2px 6px;white-space:nowrap}
 .orig{font-size:12px;font-weight:700;color:var(--rx-t);background:var(--rx-f);border-radius:6px;padding:2px 6px}
 .px{flex-basis:100%;font-size:13px;color:var(--tx3)}
 .ln-m{flex-wrap:wrap;row-gap:6px;padding:9px 10px 10px}
 .ln-m .ln-nome{flex:1 1 100%}
 .stps{flex:1 1 100%;display:grid;grid-template-columns:repeat(var(--n,1),minmax(0,1fr));gap:8px}
 .stp{display:grid;grid-template-columns:auto 44px minmax(36px,1fr) 44px;align-items:center;gap:0;border:1px solid var(--bd);border-radius:10px;background:var(--sup);overflow:hidden;height:46px}
 .stp.on{border-color:var(--cor);box-shadow:0 0 0 1px var(--cor) inset}
 .stp-loja{align-self:stretch;display:grid;place-items:center;padding:0 7px;font-size:12px;font-weight:800;letter-spacing:.3px;color:var(--cor);background:var(--f1);border-right:1px solid var(--bd)}
 .stp.on .stp-loja{background:var(--cor);color:#fff;border-color:var(--cor)}
 .stp-b{height:100%;border:0;background:transparent;font-size:22px;font-weight:600;line-height:1;color:var(--tx2);padding:0;touch-action:manipulation}
 .stp-b:active:not(:disabled){background:var(--f1)}
 .stp-b:disabled{opacity:.25}
 .stp input{height:100%;width:100%;min-width:0;border:0;border-radius:0;padding:0 2px;text-align:center;font-size:17px;font-weight:700;background:transparent;font-variant-numeric:tabular-nums}
 .stp input::placeholder{color:var(--tx3);font-weight:500;opacity:.6}
 .stp input:focus{outline:none;background:var(--ok-f)}
 .novo{background:var(--sup);border:1px dashed var(--bd);border-radius:12px;padding:4px 12px 12px;margin-top:18px}
 .rotulo{font-size:14px;font-weight:700;margin:18px 0 8px;color:var(--pri)}
 .rotulo small{font-weight:400;color:var(--tx3)}
 .linha-acoes{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px}
 .linha-acoes input{flex:1;min-width:90px}
 .linha-acoes .qtd,.qtd{flex:0 0 74px;width:74px;min-width:0}
 .linha-acoes .preco{flex:1 1 90px}
 .linha-acoes select{width:auto;flex:1 1 auto}
 .linha-acoes .primary{width:auto;margin-top:0;flex:0 0 auto}
 .barra{position:fixed;left:0;right:0;bottom:0;z-index:15;display:flex;gap:8px;padding:10px 14px calc(10px + env(safe-area-inset-bottom));background:var(--fundo-t);backdrop-filter:blur(6px);border-top:1px solid var(--bd)}
 .barra button{margin-top:0}
 .barra .secondary{flex:0 0 auto;width:auto}
 .barra .primary{flex:1}
 @media(min-width:901px){.barra{left:250px}}
 .metricas{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0 10px}
 .metrica{border:0;border-radius:11px;background:var(--sup);padding:10px 4px;display:grid;gap:2px;text-align:center;box-shadow:0 0 0 1px var(--bd) inset}
 .metrica strong{font-size:24px;font-variant-numeric:tabular-nums}
 .metrica span{font-size:13px;color:var(--tx3)}
 .m-comprado strong{color:var(--v)} .m-indisponivel strong{color:var(--r)}
 .metrica.on{box-shadow:0 0 0 2px var(--pri) inset}
 .chips-filtro{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none;align-items:center}
 .chips-filtro button{flex:0 0 auto;border:1px solid var(--bd);background:var(--sup);border-radius:99px;padding:7px 12px;font-size:14px;font-weight:600;color:var(--tx2);display:flex;align-items:center;gap:6px}
 .chips-filtro button.on{background:var(--pri);color:#fff;border-color:var(--pri)}
 .sigla{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 4px;border-radius:6px;background:var(--cor,var(--tx3));color:#fff;font-size:13px;font-weight:800;flex:0 0 auto}
 .ean{border:1px solid var(--pri);background:var(--pri);color:#fff;border-radius:8px;padding:0 12px;font-size:20px;display:flex;align-items:center;gap:6px}
 .ean span{font-size:14px;font-weight:700}
 .camera{position:relative;margin-top:10px;border-radius:12px;overflow:hidden;background:#0b1a15}
 .camera video{display:block;width:100%;max-height:42vh;object-fit:cover}
 .mira{position:absolute;left:12%;right:12%;top:50%;height:2px;background:#ff4d4d;box-shadow:0 0 12px #ff4d4d}
 .lido{margin-top:12px;border:1px solid var(--ok-b);background:var(--ok-f);border-radius:12px;padding:14px}
 .lido h3{margin:4px 0 4px;font-size:17px}
 .item{background:var(--sup);border:1px solid var(--bd);border-radius:12px;padding:10px 12px;margin-bottom:8px;transition:background .3s,border-color .3s}
 .item.destaque{background:var(--ok-f);border-color:var(--ok-b)}
 .item.aberto{border-color:var(--ok-b);box-shadow:0 2px 10px #0001}
 .item.feito{background:var(--f1)}
 .item.feito .t{text-decoration:line-through;color:var(--tx3)}
 .item.faltou .t{color:var(--r)}
 .cab{display:flex;align-items:center;gap:10px}
 .nome{flex:1;min-width:0;border:0;background:transparent;text-align:left;padding:4px 0;display:flex;align-items:center;gap:5px 7px;flex-wrap:wrap}
 .nome .q,.pl .q{font-size:15px;font-weight:800;color:var(--tx);background:var(--f1);border-radius:6px;padding:2px 7px;font-variant-numeric:tabular-nums}
 .herd{font-size:12px;font-weight:700;color:var(--av-t);background:var(--av-f);border-radius:6px;padding:2px 6px}
 .acoes{display:flex;gap:6px}
 .ac{width:46px;height:44px;border-radius:10px;border:1px solid var(--bd);background:var(--sup);font-size:20px;color:var(--tx3)}
 .ac.buy.on,.mini.buy.on{background:var(--v);border-color:var(--v);color:#fff}
 .ac.miss.on,.mini.miss.on{background:var(--r);border-color:var(--r);color:#fff}
 .porlista{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 2px}
 .pl{display:flex;align-items:center;gap:6px;border:1px solid var(--bd);border-radius:10px;padding:4px 4px 4px 6px;background:var(--f1)}
 .pl.st-comprado{background:var(--ok-f);border-color:var(--ok-b)}
 .pl.st-indisponivel{background:var(--er-f);border-color:var(--er-b)}
 .mini{width:36px;height:34px;border-radius:8px;border:1px solid var(--bd);background:var(--sup);font-size:17px;color:var(--tx3)}
 .precos{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin-top:8px}
 .caixa{border-radius:9px;background:var(--f1);padding:7px 9px;display:grid;gap:1px;min-width:0}
 .caixa.media{background:var(--az-f)}
 .caixa .rot{font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:var(--tx3)}
 .caixa strong{font-size:19px;font-variant-numeric:tabular-nums;color:var(--tx);line-height:1.25}
 .caixa strong small{font-size:13px;font-weight:600;color:var(--tx3);margin-left:1px}
 .caixa .det{font-size:13px;color:var(--tx3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .spark{width:64px;height:100%;min-height:40px;color:var(--az-t);align-self:center}
 .sem-hist{font-size:14px;color:var(--tx3);margin:6px 0 0}
 .selo{font-size:13px;font-weight:800;border-radius:99px;padding:2px 8px}
 .v-barato{color:var(--v);background:var(--ok-f)} .v-caro{color:var(--r);background:var(--er-f)} .v-na-media{color:var(--a);background:var(--av-f)}
 .veredito{font-size:14px;border-radius:8px;padding:6px 9px;margin:8px 0 0;line-height:1.45}
 .detalhe{margin-top:10px;border-top:1px solid var(--bd2);padding-top:4px}
 .por{font-size:14px;color:var(--tx3)}
 .hist{width:100%;border-collapse:collapse;margin-top:12px;font-size:14px}
 .hist th{text-align:left;font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:var(--tx3);padding:4px;border-bottom:1px solid var(--bd2)}
 .hist td{padding:6px 4px;border-bottom:1px solid var(--bd2);vertical-align:top;font-variant-numeric:tabular-nums}
 .hist .emb{display:block;font-size:12px;color:var(--tx3)}
 .hist .u{font-weight:700;white-space:nowrap}
 .link{border:0;background:transparent;color:var(--az-t);text-decoration:underline;font-size:14px;padding:6px 0}
 .exportar{margin-top:18px}
 .dois{display:grid;grid-template-columns:1fr 1fr;gap:0 8px}
 .resumo-fim{background:var(--sup);border:1px solid var(--bd);border-radius:12px;padding:14px;margin-top:14px}
 .resumo-fim h2{font-size:21px;line-height:1.3;margin:6px 0 0}
 .metricas.fixas{margin-bottom:0}
 .linha.fim{margin:0;font-weight:500;cursor:pointer}
 .linha.fim .st{font-size:13px;color:var(--tx3);white-space:nowrap}
 .editor{background:var(--sup);border:1px solid var(--ok-b);border-radius:12px;padding:14px;margin-top:14px}
 .chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
 .chip{display:flex;align-items:center;gap:4px;background:var(--f1);color:var(--tx);border-radius:99px;padding:5px 6px 5px 11px;font-size:14px;font-weight:600}
 .chip button{border:0;background:transparent;font-size:17px;line-height:1;color:var(--tx2);padding:0 4px}
 .candidatos{display:grid;gap:6px;margin-top:8px;max-height:300px;overflow:auto}
 .candidatos button{display:grid;text-align:left;gap:2px;border:1px solid var(--bd);background:var(--f1);border-radius:8px;padding:9px 10px;font-size:15px}
 .candidatos small{font-size:13px;color:var(--tx3)}
 .cat-nome{flex:1;min-width:0;border:0;background:transparent;text-align:left;display:grid;gap:3px;padding:2px 0}
 .cat-nome > span{display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center}
 .cat-nome small{font-size:13px;color:var(--tx3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .cat-nome small.auto{color:#9a6b16;font-weight:600}
 .cat-nome small.auto::before{content:'auto · '}
 .bloco{background:var(--sup);border:1px solid var(--bd);border-radius:12px;padding:2px 14px 14px;margin-top:14px}
 .lista-edit{display:grid;grid-template-columns:56px 1fr;gap:8px;align-items:center;border-bottom:1px solid var(--bd2);padding:12px 0}
 .lista-edit .sig{text-align:center;font-weight:800;color:#fff;background:var(--cor);border-color:var(--cor)}
 .lista-edit .secs,.lista-edit .cores,.lista-edit .ord{grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap}
 .secs label{display:flex;align-items:center;gap:6px;margin:0;font-weight:500;font-size:15px;border:1px solid var(--bd);border-radius:8px;padding:6px 10px}
 .cores button{width:26px;height:26px;border-radius:50%;border:2px solid transparent}
 .cores button.on{border-color:var(--tx);box-shadow:0 0 0 2px #fff inset}
 .ord button{border:1px solid var(--bd);background:var(--sup);border-radius:7px;padding:6px 12px;font-size:14px}
 .ord .perigo{margin-left:auto}
 .hist-linha{display:flex;justify-content:space-between;gap:8px;font-size:15px;padding:8px 0;border-bottom:1px solid var(--bd2)}
 .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}
 .stats div{background:var(--f1);border-radius:9px;padding:10px;display:grid;text-align:center}
 .stats strong{font-size:20px}
 .stats span{font-size:13px;color:var(--tx3)}
 .janelas{display:flex;gap:6px;flex-wrap:wrap}
 .janelas button{border:1px solid var(--bd);background:var(--sup);border-radius:99px;padding:8px 14px;font-size:14px}
 .janelas button.on{background:var(--pri);color:#fff;border-color:var(--pri)}
 .toast{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);background:#0b1a15;color:#fff;border-radius:99px;padding:10px 18px;font-size:15px;z-index:20;box-shadow:0 6px 20px #0003;max-width:90vw;text-align:center}
 @media(max-width:520px){.precos{grid-template-columns:1fr 1fr}.spark{display:none}.caixa strong{font-size:17px}.secoes button{font-size:14px}}
 @media print{
  :global(aside),:global(header),:global(.notice),:global(footer),.cabeca,.passos,.sub,.metricas,.chips-filtro,.busca,.novo,.barra,.exportar,.acoes,.mini,.detalhe,.spark,.faltantes{display:none!important}
  .item{break-inside:avoid;border-color:#ccc}
 }
</style>
