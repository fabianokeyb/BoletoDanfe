<script lang="ts">
 import {onDestroy,onMount,tick} from 'svelte';
 import {api} from '../lib/api';
 import {interpretar,interpretarChaveNFe,formatarCnpj,textoParaColar,formatarValor,valorParaColar,type Formato,type CodigoLido,type NotaChave} from '../lib/linha-digitavel';
 import {ESTADO_VAZIO,notaDaChave,notaManual,incluirDocumento,incluirNota,vincular,reassociar,atualizarFavorecido,atualizarTotalNota,removerDocumento,removerNota,reconciliacao,boletosDaNota,parcelasDaNota,sugestoes,planilhaTsv,totais,type Estado,type Documento,type Nota} from '../lib/sessao';
 import {nomeDoCnpj,salvarFornecedor,listaFornecedores} from '../lib/fornecedores';
 import {buscarNomePorCnpj} from '../lib/cnpj-lookup';
 import {copiarTexto} from '../lib/clipboard';
 import Compras from '../lib/compras/Compras.svelte';
 import Fichas from '../lib/fichas/Fichas.svelte';
 import Pedidos from '../lib/pedidos/Pedidos.svelte';

 const CHAVE_FORMATO='thb.formato-copia'
 const CHAVE_SESSAO='thb.sessao.v2'
 const FORMATOS:{id:Formato,rotulo:string}[]=[
  {id:'pontuada',rotulo:'Com pontuação'},
  {id:'digitos',rotulo:'Só números'},
  {id:'barras',rotulo:'Barras (44)'}
 ]
 const ROTULOS={boleto:'BOLETO · LINHA DIGITÁVEL',arrecadacao:'CONTA OU TRIBUTO · LINHA DIGITÁVEL',pix:'PIX COPIA E COLA'}
 const NOMES={boleto:'Boleto',arrecadacao:'Conta/tributo',pix:'Pix'}
 const STATUS_ROTULO={'sem-total':'sem total informado',confere:'confere ✓',parcial:'falta boleto',excede:'passou do total'}
 type Campo='linha'|'valor'|'vencimento'

 let formato=$state<Formato>('pontuada')
 let copia=$state<'idle'|'ok'|'manual'>('idle')
 let dica=$state('')
 let estado=$state<Estado>(ESTADO_VAZIO)
 let notaAtivaId=$state<string|undefined>(undefined)
 let sincronizado=$state(true)
 let destaque=$state('')
 let copiado=$state('')
 let confirmarLimpeza=$state(false)
 let cadastro=$state(false)
 let focoFavorecido=$state('')
 let fornecedores=$state<string[]>([])
 let buscando=$state<string[]>([])
 let carregado=false
 let audio:AudioContext|undefined
 let mChave=$state('');let mNumero=$state('');let mFavorecido=$state('');let mCnpj=$state('');let mSerie=$state('');let mTotal=$state('');
 let view=$state<'capture'|'compras'|'pedidos'|'fichas'|'pix'|'status'>('capture');
 let raw=$state('');let result=$state('');let error=$state('');let busy=$state(false);
 let key=$state('');let name=$state('');let city=$state('');let amount=$state('');let txid=$state('');
 let payload=$state('');let qr=$state('');let camera=$state(false);let video=$state<HTMLVideoElement>();
 let controls:{stop:()=>void}|undefined; let cameraEpoch=0;
 // Controles de câmera (flash/zoom) e feedback visual de leitura.
 let camTrack:MediaStreamTrack|undefined; let camCaps=$state<{torch:boolean,zoom?:{min:number,max:number,step:number}}>({torch:false});
 let torchOn=$state(false); let zoomAtual=$state<number|undefined>(undefined); let zoomDigital=$state(1); let espelhado=$state(false);
 const CHAVE_ESPELHO='thb.espelho'; let prefEspelhoExplicita=false;
 /** Espelha só a prévia (scaleX -1); o canvas de decodificação continua cru, senão o código lê invertido. */
 function alternarEspelho(){espelhado=!espelhado;prefEspelhoExplicita=true;try{localStorage.setItem(CHAVE_ESPELHO,espelhado?'1':'0')}catch{/* não persiste */}}
 let flashPulse=$state(0); let flashTipo=$state<'nfe'|'doc'>('doc');
 /** Monta níveis discretos de zoom a partir da faixa real do aparelho (0.5x só se min<1). */
 function montarZoom(z?:{min:number,max:number,step:number}):{v:number,rotulo:string}[]{
  if(!z)return[]
  const base=z.min||1;const n:{v:number,rotulo:string}[]=[]
  if(base<1)n.push({v:Math.max(z.min,0.5),rotulo:'0.5x'})
  n.push({v:base,rotulo:'1x'})
  for(const m of [2,3,5]){const v=base*m;if(v<=z.max)n.push({v,rotulo:`${m}x`})}
  if(z.max>n[n.length-1].v+0.01)n.push({v:z.max,rotulo:'máx'})
  return n
 }
 // Zoom nativo quando o aparelho expõe; senão, zoom digital (recorte central) — caso do iOS.
 const temZoomNativo=$derived(!!camCaps.zoom);
 const zoomBotoes=$derived(temZoomNativo?montarZoom(camCaps.zoom):[{v:1,rotulo:'1x'},{v:2,rotulo:'2x'},{v:3,rotulo:'3x'}]);
 const zoomSelecionado=$derived(temZoomNativo?zoomAtual:zoomDigital);
 function escolherZoom(v:number){if(temZoomNativo)void setZoom(v);else zoomDigital=v}
 let aplicarTorchFn:((t:MediaStreamTrack,on:boolean)=>Promise<void>)|undefined;
 let aplicarZoomFn:((t:MediaStreamTrack,v:number)=>Promise<void>)|undefined;
 /** Dispara o aviso visual (borda) + vibração a cada leitura nova. */
 function pulso(tipo:'nfe'|'doc'){flashTipo=tipo;flashPulse++;try{navigator.vibrate?.(tipo==='nfe'?[45,45,45]:70)}catch{/* sem haptics */}}
 async function toggleTorch(){if(!camTrack||!aplicarTorchFn)return;try{await aplicarTorchFn(camTrack,!torchOn);torchOn=!torchOn;dica=''}catch{dica='Flash não suportado neste aparelho.'}}
 async function setZoom(v:number){if(!camTrack||!aplicarZoomFn)return;try{await aplicarZoomFn(camTrack,v);zoomAtual=v;dica=''}catch{dica='Zoom não suportado neste aparelho.'}}

 function stopCamera(){cameraEpoch++;controls?.stop();controls=undefined;camera=false;camTrack=undefined;camCaps={torch:false};torchOn=false;zoomAtual=undefined;zoomDigital=1;if(typeof MediaStream!=='undefined' && video?.srcObject instanceof MediaStream){video.srcObject.getTracks().forEach(t=>t.stop());video.srcObject=null;}}
 onDestroy(stopCamera);
 onMount(()=>{
  try{const salvo=localStorage.getItem(CHAVE_FORMATO);if(FORMATOS.some(f=>f.id===salvo))formato=salvo as Formato}catch{/* mantém padrão */}
  try{const e=localStorage.getItem(CHAVE_ESPELHO);if(e!==null){espelhado=e==='1';prefEspelhoExplicita=true}}catch{/* mantém padrão */}
  const doLink=viewDoHash();
  try{const v=doLink??localStorage.getItem('thb.view');if(v==='compras'||v==='pedidos'||v==='fichas'||v==='pix'||v==='status'||v==='capture')view=v}catch{/* mantém padrão */}
  if(!doLink)history.replaceState(null,'',location.pathname+location.search+'#/'+SLUG_VIEW[view]);
  requestAnimationFrame(()=>document.querySelector('nav .active')?.scrollIntoView({inline:'center',block:'nearest'}));
  window.addEventListener('hashchange',()=>{const v=viewDoHash();if(v&&v!==view)change(v,false)});
  const r=restaurar();estado=r.estado;notaAtivaId=r.notaAtivaId;fornecedores=listaFornecedores();carregado=true
 })
 // A sessão dura enquanto a aba estiver aberta (sobrevive a recarregar, não a fechar).
 $effect(()=>{
  const dados=JSON.stringify({documentos:estado.documentos.map(({id,lidoEm,notaId,alerta})=>({id,lidoEm,notaId,alerta})),notas:estado.notas,notaAtivaId})
  if(!carregado)return
  try{sessionStorage.setItem(CHAVE_SESSAO,dados)}catch{/* só não sobrevive a recarregar */}
 })

 /** Relê a sessão revalidando cada boleto: o armazenamento não é fonte confiável. */
 function restaurar():{estado:Estado,notaAtivaId?:string}{
  try{
   const bruto=JSON.parse(sessionStorage.getItem(CHAVE_SESSAO)??'null')
   if(!bruto)return {estado:ESTADO_VAZIO}
   const documentos=(bruto.documentos??[]).flatMap((d:{id:string,lidoEm:number,notaId?:string,alerta?:string})=>{const r=interpretar(d.id);return r.ok?[{id:d.id,codigo:r.codigo,lidoEm:d.lidoEm,notaId:d.notaId,alerta:d.alerta}]:[]})
   return {estado:{documentos,notas:bruto.notas??[]},notaAtivaId:bruto.notaAtivaId}
  }catch{return {estado:ESTADO_VAZIO}}
 }

 const lido=$derived(interpretar(raw))
 const textoCopia=$derived(lido.ok?textoParaColar(lido.codigo,formato):'')
 const soma=$derived(totais(estado))
 const semNota=$derived(estado.documentos.filter(d=>!d.notaId))
 const sugs=$derived(sugestoes(estado))
 const notaAtiva=$derived(estado.notas.find(n=>n.id===notaAtivaId))
 const totalLinhas=$derived(estado.documentos.length)

 async function copiar(){if(!textoCopia)return;const ok=await copiarTexto(textoCopia);copia=ok?'ok':'manual';if(ok)navigator.vibrate?.(60)}
 function escolherFormato(f:Formato){formato=f;try{localStorage.setItem(CHAVE_FORMATO,f)}catch{/* não persiste */};void copiar()}
 function bip(){if(!audio)return;const osc=audio.createOscillator(),g=audio.createGain();osc.frequency.value=1250;g.gain.value=.08;osc.connect(g).connect(audio.destination);osc.start();osc.stop(audio.currentTime+.07)}
 function bipDuplo(){bip();setTimeout(bip,90)}
 function destacar(id:string){destaque=id;setTimeout(()=>{if(destaque===id)destaque=''},1600)}

 /** Converte "1234,56" em centavos; vazio → undefined; inválido → null. */
 function parseCentavos(txt:string):number|undefined|null{
  const t=txt.trim();if(!t)return undefined
  if(!/^\d{1,10}([,.]\d{1,2})?$/.test(t))return null
  const [inteiro,dec='']=t.replace(',','.').split('.');return Number(inteiro)*100+Number(dec.padEnd(2,'0'))
 }

 /**
  * Registra um boleto/Pix na sessão e o copia como "último lido".
  * @param codigo documento já validado
  */
 function registrarDocumento(codigo:CodigoLido){
  const ativa=estado.notas.find(n=>n.id===notaAtivaId)
  // vínculo direto à nota ativa só quando ela está sem total (fallback); com total, quem associa é o valor
  const alvo=sincronizado&&(!ativa||ativa.valorTotalCentavos==null)?notaAtivaId:undefined
  const {estado:ne,novo,item}=incluirDocumento(estado,codigo,alvo)
  destacar(item.id)
  if(!novo)return
  estado=sincronizado?reassociar(ne):ne;raw=codigo.barras;copia='idle';dica='';bip();pulso('doc');void copiar()
 }

 /**
  * Registra uma NF-e (da chave lida) e a torna nota ativa.
  * @param chave dados da chave da NF-e
  */
 function registrarNota(chave:NotaChave){
  const favorecido=nomeDoCnpj(chave.cnpj)
  const {estado:ne,novo,item}=incluirNota(estado,notaDaChave(chave,favorecido))
  estado=sincronizado?reassociar(ne):ne;notaAtivaId=item.id;destacar(item.id)
  if(novo){bipDuplo();pulso('nfe');if(!item.favorecido){focoFavorecido=item.id;if(item.cnpj)void buscarForn(item.id,item.cnpj)}}
 }

 function cadastrarNota(){
  error=''
  const total=parseCentavos(mTotal)
  if(total===null){error='Valor total inválido. Use 1234,56.';return}
  if(mChave.replace(/\D/g,'').length){
   const r=interpretarChaveNFe(mChave)
   if(!r.ok){error=r.erro;return}
   const favorecido=mFavorecido.trim()||nomeDoCnpj(r.nota.cnpj)
   finalizarCadastro({...notaDaChave(r.nota,favorecido),valorTotalCentavos:total??undefined},r.nota.cnpj,favorecido)
   return
  }
  if(!mNumero.trim()){error='Informe o número da NF ou a chave.';return}
  if(!mFavorecido.trim()){error='Informe o fornecedor.';return}
  const cnpj=mCnpj.replace(/\D/g,'')||undefined
  finalizarCadastro(notaManual(mNumero,mFavorecido.trim(),{cnpj,serie:mSerie.trim()||undefined,valorTotalCentavos:total??undefined}),cnpj,mFavorecido.trim())
 }
 function finalizarCadastro(nota:Nota,cnpj:string|undefined,favorecido:string){
  const {estado:ne,item}=incluirNota(estado,nota)
  estado=sincronizado?reassociar(ne):ne;notaAtivaId=item.id;destacar(item.id)
  if(cnpj&&favorecido){salvarFornecedor(cnpj,favorecido);fornecedores=listaFornecedores()}
  else if(cnpj&&!item.favorecido.trim())void buscarForn(item.id,cnpj)
  mChave=mNumero=mFavorecido=mCnpj=mSerie=mTotal='';cadastro=false
 }

 function editarFavorecido(nota:Nota,valor:string){
  estado=atualizarFavorecido(estado,nota.id,valor)
  if(nota.cnpj){salvarFornecedor(nota.cnpj,valor);fornecedores=listaFornecedores()}
  if(focoFavorecido===nota.id&&valor.trim())focoFavorecido=''
 }
 /** Define o valor total da nota e reassocia por valor (o total é a âncora de agrupamento). */
 function editarTotal(nota:Nota,txt:string){
  const c=parseCentavos(txt)
  if(c===null){dica='Valor total inválido. Use 1234,56.';return}
  dica=''
  estado=atualizarTotalNota(estado,nota.id,c??undefined)
  if(sincronizado)estado=reassociar(estado)
 }
 /** Busca o nome do fornecedor online pelo CNPJ e preenche, se o usuário ainda não digitou. */
 async function buscarForn(notaId:string,cnpj?:string){
  if(!cnpj||buscando.includes(notaId))return
  buscando=[...buscando,notaId]
  try{
   const nome=await buscarNomePorCnpj(cnpj)
   const n=estado.notas.find(x=>x.id===notaId)
   if(nome&&n&&!n.favorecido.trim())editarFavorecido(n,nome)
  }finally{buscando=buscando.filter(x=>x!==notaId)}
 }

 /**
  * Copia um campo (linha, valor ou vencimento) de um documento.
  * @param doc documento da sessão
  * @param campo campo a copiar
  */
 async function copiarCampo(doc:Documento,campo:Campo){
  const c=doc.codigo
  const texto=campo==='linha'?(c.tipo==='pix'?c.barras:textoParaColar(c,formato)):campo==='valor'?(c.valorCentavos?valorParaColar(c.valorCentavos):''):(c.vencimento?dataBr(c.vencimento):'')
  if(!texto)return
  const chave=`${doc.id}:${campo}`
  if(await copiarTexto(texto)){copiado=chave;navigator.vibrate?.(40);setTimeout(()=>{if(copiado===chave)copiado=''},1500)}
 }
 async function copiarPlanilha(){
  if(!totalLinhas)return
  if(await copiarTexto(planilhaTsv(estado,formato))){copiado='planilha';setTimeout(()=>{if(copiado==='planilha')copiado=''},1800)}
 }

 function aplicarSugestao(notaId:string,docIds:string[]){for(const id of docIds)estado=vincular(estado,id,notaId)}
 function definirAtiva(id:string|undefined){notaAtivaId=id}
 function removerDoc(id:string){estado=removerDocumento(estado,id)}
 function apagarNota(id:string){if(notaAtivaId===id)notaAtivaId=undefined;estado=removerNota(estado,id)}
 function limpar(){if(!confirmarLimpeza){confirmarLimpeza=true;setTimeout(()=>confirmarLimpeza=false,3000);return}estado=ESTADO_VAZIO;notaAtivaId=undefined;raw='';copia='idle';confirmarLimpeza=false}

 function dataBr(iso:string){return iso.split('-').reverse().join('/')}
 /** Endereço único de cada módulo: #/captura, #/compras, #/fichas, #/pix, #/status (Compras completa com seção e etapa). */
 const SLUG_VIEW={capture:'captura',compras:'compras',pedidos:'pedidos',fichas:'fichas',pix:'pix',status:'status'} as const
 /** Módulo indicado no endereço, ou null se o hash não aponta para nenhum. */
 function viewDoHash():typeof view|null{const slug=location.hash.replace(/^#\/?/,'').split('/')[0];const par=Object.entries(SLUG_VIEW).find(([,v])=>v===slug);return par?par[0] as typeof view:null}
 function change(next:typeof view,gravarHash=true){stopCamera();view=next;try{localStorage.setItem('thb.view',next);if(gravarHash)history.replaceState(null,'',location.pathname+location.search+'#/'+SLUG_VIEW[next])}catch{/* não persiste */};raw='';result='';error='';payload='';qr='';copia='idle';}
 function adicionarManual(){
  if(raw.replace(/\D/g,'').length===44){const n=interpretarChaveNFe(raw);if(n.ok){registrarNota(n.nota);raw='';return}}
  if(lido.ok)registrarDocumento(lido.codigo);else error=lido.erro
 }

 async function scan(){error='';dica='';camera=true;const epoch=++cameraEpoch;
  try{audio??=new AudioContext();void audio.resume()}catch{/* sem áudio */}
  try{
  const [{iniciarLeitura,capacidadesCamera,aplicarTorch,aplicarZoom,zoomAtualDaTrilha},{classificar,criarConfirmador}]=await Promise.all([import('../lib/camera-scanner'),import('../lib/scanner')]);
  await tick();
  if(epoch!==cameraEpoch)return;
  aplicarTorchFn=aplicarTorch;aplicarZoomFn=aplicarZoom;
  // ITF e Code128 não têm checksum: exigem DV válido + 2 aparições. QR já tem correção de erro.
  const confirma=criarConfirmador(2);
  const {parar,track,facing}=await iniciarLeitura(video!,(texto,format)=>{/* callback abaixo */
   if(epoch!==cameraEpoch)return
   const tipo=classificar(texto,format)
   if(!tipo)return
   if(tipo==='nfe'){
    const r=interpretarChaveNFe(texto)
    if(!r.ok){dica=r.erro;return}
    if(!confirma(texto))return
    registrarNota(r.nota);return
   }
   const r=interpretar(texto)
   if(!r.ok){dica='Leitura inconsistente. Segure firme e aproxime até ficar nítido.';return}
   if(tipo==='barras'&&!confirma(texto))return
   registrarDocumento(r.codigo)
  },{zoomDigital:()=>zoomDigital});
  if(epoch!==cameraEpoch){parar();}else{
   controls={stop:parar};camTrack=track;camCaps=capacidadesCamera(track);
   zoomAtual=zoomAtualDaTrilha(track)??camCaps.zoom?.min;
   // Auto-espelho só se o usuário ainda não escolheu: traseira não espelha; selfie e webcam (facing indefinido) sim.
   if(!prefEspelhoExplicita)espelhado=facing!=='environment';
  }
 }catch{stopCamera();error='Não foi possível abrir a câmera. Verifique a permissão ou cole o código abaixo.';}}

 async function generate(){busy=true;error='';payload='';qr='';try{
  let cents:string|undefined;
  if(amount){if(!/^\d{1,10}([,.]\d{1,2})?$/.test(amount))throw new Error('Informe o valor como 10,50, sem separador de milhar.');const [whole,part='']=amount.replace(',','.').split('.');cents=(BigInt(whole)*100n+BigInt(part.padEnd(2,'0'))).toString();}
  const v=await api('/pix/preview',{key,name,city,...(cents?{amount_cents:cents}:{}),...(txid?{txid}:{} )});
  const QRCode=await import('qrcode');qr=await QRCode.toDataURL(v.payload,{width:288,margin:4,errorCorrectionLevel:'M'});payload=v.payload;
 }catch(e){error=e instanceof Error?e.message:'Falha ao gerar.';}finally{busy=false;}}
</script>
<svelte:head><title>THB Financeiro · Prévia local</title><meta name="description" content="Captura e conferência local de documentos financeiros. Ambiente de desenvolvimento."/></svelte:head>
<div class="app" class:compacto={view==='compras'||view==='fichas'||view==='pedidos'}>
 <aside><div class="brand">THB<span>FINANCEIRO</span></div><div class="workspace">Ambiente local<span>Sem conexão bancária</span></div>
 <nav aria-label="Módulos"><button class:active={view==='capture'} onclick={()=>change('capture')}>01 <span>Capturar documento</span></button><button class:active={view==='compras'} onclick={()=>change('compras')}>02 <span>Compras da semana</span></button><button class:active={view==='pedidos'} onclick={()=>change('pedidos')}>06 <span>Pedidos de compra</span></button><button class:active={view==='fichas'} onclick={()=>change('fichas')}>03 <span>Fichas técnicas</span></button><button class:active={view==='pix'} onclick={()=>change('pix')}>04 <span>QR Code Pix</span></button><button class:active={view==='status'} onclick={()=>change('status')}>05 <span>Etapas do projeto</span></button></nav>
 <p class="side-note">Boleto e nota fiscal, juntos.<br/>Pronto para colar na planilha.</p></aside>
 <main><header><span>THB / Ferramentas de conferência</span><strong>PRÉVIA · 0.3</strong></header>
 {#if view!=='compras'&&view!=='fichas'&&view!=='pedidos'}<div class="notice">Ambiente de desenvolvimento. Use dados de teste. Pagamentos, remessas e aprovações operacionais estão desabilitados.</div>{/if}
 {#if view==='compras'}
 <Compras/>
 {:else if view==='pedidos'}
 <Pedidos/>
 {:else if view==='fichas'}
 <Fichas/>
 {:else if view==='capture'}
 <section class="intro"><p class="eyebrow">ENTRADA DE DOCUMENTOS</p><h1>Boletos e notas na mesma leitura.</h1><p>Leia a DANFE e os boletos em qualquer ordem. O app associa cada boleto à sua nota e monta as linhas da planilha.</p></section>
 <div class="grid lote"><section class="card"><div class="card-heading"><span class="step">01</span><h2>Ler documentos</h2></div><p>Boletos (ITF), contas, Pix (QR) e o código da DANFE (Code128) são detectados sozinhos. A câmera fica aberta: passe um documento depois do outro.</p>
 <label class="sincro"><input type="checkbox" bind:checked={sincronizado}/> Vincular boletos lidos à nota ativa{#if notaAtiva} · <strong>NF {notaAtiva.numero}{#if notaAtiva.favorecido} · {notaAtiva.favorecido}{/if}</strong>{/if}</label>
 {#if camera}
 <div class="cam-hud top" aria-live="polite">
  <span class="hud-label">{estado.notas.length} {estado.notas.length===1?'nota':'notas'} · {totalLinhas} {totalLinhas===1?'boleto':'boletos'}</span>
  <div class="hud-grupos">
   {#each estado.notas as n (n.id)}{@const bs=boletosDaNota(estado,n.id)}
   <div class="hud-nota" class:on={destaque===n.id} class:ativa={notaAtivaId===n.id}>
    <div class="hud-cat"><span class="hud-nf">NF {n.numero}</span>{#if n.favorecido}<span class="hud-forn">{n.favorecido}</span>{/if}{#if n.valorTotalCentavos!=null}<span class="hud-total">{formatarValor(n.valorTotalCentavos)}</span>{/if}<span class="hud-cont">{bs.length} {bs.length===1?'boleto':'boletos'}</span></div>
    <div class="hud-bols">{#if bs.length}{#each bs as d,i (d.id)}<span class="hud-bol" class:on={destaque===d.id}>{i+1}/{bs.length}{#if d.codigo.valorCentavos} · {formatarValor(d.codigo.valorCentavos)}{/if}</span>{/each}{:else}<span class="hud-vazio">aguardando boletos…</span>{/if}</div>
   </div>
   {/each}
   {#if semNota.length}
   <div class="hud-nota solta">
    <div class="hud-cat"><span class="hud-nf solta">Sem nota</span><span class="hud-cont">{semNota.length} {semNota.length===1?'boleto':'boletos'}</span></div>
    <div class="hud-bols">{#each semNota as d (d.id)}<span class="hud-bol solto" class:on={destaque===d.id}>{NOMES[d.codigo.tipo]}{#if d.codigo.valorCentavos} · {formatarValor(d.codigo.valorCentavos)}{/if}</span>{/each}</div>
   </div>
   {/if}
   {#if !estado.notas.length && !totalLinhas}<span class="hud-vazio">aponte para a DANFE e os boletos…</span>{/if}
  </div>
 </div>
 {/if}
 <div class="cam-wrap" class:on={camera}>
  <video bind:this={video} class:visible={camera} style="transform:scale({(temZoomNativo?1:zoomDigital)*(espelhado?-1:1)}, {temZoomNativo?1:zoomDigital})" autoplay muted playsinline aria-label="Prévia da câmera"></video>
  {#if camera}
   {#key flashPulse}{#if flashPulse>0}<div class="cam-flash {flashTipo}" aria-hidden="true"></div>{/if}{/key}
   <div class="cam-ctrls">
    <button type="button" class="cc" class:on={espelhado} aria-pressed={espelhado} aria-label="Espelhar prévia (não afeta a leitura)" onclick={alternarEspelho}>⇋</button>
    {#if camCaps.torch}<button type="button" class="cc torch" class:on={torchOn} aria-pressed={torchOn} aria-label="Lanterna" onclick={toggleTorch}>⚡</button>{/if}
    {#if zoomBotoes.length>1}<div class="cc-zoom" role="group" aria-label="Zoom">{#each zoomBotoes as z (z.v)}<button type="button" class:on={zoomSelecionado===z.v} onclick={()=>escolherZoom(z.v)}>{z.rotulo}</button>{/each}</div>{/if}
   </div>
  {/if}
 </div>
 {#if camera&&dica}<p class="scan-tip dica" role="status">{dica}</p>{/if}
 <button class="secondary" onclick={camera?stopCamera:scan}>{camera?'Fechar câmera':'Abrir câmera'}</button>
 {#if lido.ok}
 <div class="colar" aria-live="polite">
  <div class="colar-topo"><span class="eyebrow">ÚLTIMO BOLETO · {ROTULOS[lido.codigo.tipo]}</span>{#if copia==='ok'}<span class="selo">Copiado ✓</span>{/if}</div>
  <output class="linha" class:pix={lido.codigo.tipo==='pix'}>{#if lido.codigo.tipo==='pix'}{textoCopia}{:else}{#each textoCopia.split(' ') as grupo, i (i)}{#if i>0}{' '}{/if}<span class="grupo">{grupo}</span>{/each}{/if}</output>
  {#if lido.codigo.tipo!=='pix'}<div class="formatos" role="group" aria-label="Formato da cópia">{#each FORMATOS as f (f.id)}<button type="button" class:ativo={formato===f.id} aria-pressed={formato===f.id} onclick={()=>escolherFormato(f.id)}>{f.rotulo}</button>{/each}</div>{/if}
  <button class="primary" onclick={copiar}>{copia==='ok'?'Copiar de novo':'Copiar'}</button>
  {#if copia==='manual'}<p class="small aviso">O navegador bloqueou a cópia automática. Toque em Copiar.</p>{/if}
 </div>
 {/if}
 <div class="manual-nf">
  <button class="secondary" onclick={()=>{cadastro=!cadastro;error=''}}>{cadastro?'Fechar cadastro':'Cadastrar nota manualmente (DANFE ilegível)'}</button>
  {#if cadastro}
  <form class="cadastro" onsubmit={(e)=>{e.preventDefault();cadastrarNota();}}>
   <p class="small">Se conseguir ler a chave de 44 dígitos, cole abaixo e o resto é preenchido. Senão, informe número e fornecedor.</p>
   <label for="mchave">Chave de acesso (44 dígitos, opcional)</label><input id="mchave" bind:value={mChave} inputmode="numeric" placeholder="só se estiver legível"/>
   <div class="row"><div><label for="mnum">Número da NF</label><input id="mnum" bind:value={mNumero} inputmode="numeric" placeholder="8272229"/></div><div><label for="mserie">Série</label><input id="mserie" bind:value={mSerie} inputmode="numeric" placeholder="1"/></div></div>
   <label for="mforn">Fornecedor (como na planilha)</label><input id="mforn" bind:value={mFavorecido} list="lista-fornecedores" placeholder="Top Alto"/>
   <div class="row"><div><label for="mcnpj">CNPJ (opcional)</label><input id="mcnpj" bind:value={mCnpj} inputmode="numeric" placeholder="só dígitos"/></div><div><label for="mtotal">Valor total (opcional)</label><input id="mtotal" bind:value={mTotal} inputmode="decimal" placeholder="1329,33"/></div></div>
   <button class="primary">Adicionar nota</button>
  </form>
  {/if}
 </div>
 <form onsubmit={(e)=>{e.preventDefault();adicionarManual();}}><label for="raw">Ou cole um boleto, linha digitável ou chave da NF-e</label><textarea id="raw" bind:value={raw} oninput={()=>{copia='idle';error=''}} rows="3" placeholder="Cole aqui o conteúdo do documento" maxlength="2048"></textarea><button class="primary" disabled={!raw}>Adicionar</button></form></section>

 <section class="card sessao" aria-labelledby="titulo-sessao">
  <div class="sessao-topo"><div><p class="eyebrow">ESTA SESSÃO</p><h2 id="titulo-sessao">{estado.notas.length} {estado.notas.length===1?'nota':'notas'} · {totalLinhas} {totalLinhas===1?'boleto':'boletos'}</h2></div>
   {#if soma.centavos}<div class="soma"><span>Total dos boletos</span><strong>{formatarValor(soma.centavos)}</strong>{#if soma.semValor}<small>+ {soma.semValor} sem valor</small>{/if}</div>{/if}</div>

  {#if sugs.length}<div class="sugestoes">{#each sugs as s (s.notaId)}{@const n=estado.notas.find(x=>x.id===s.notaId)}<button class="sug" onclick={()=>aplicarSugestao(s.notaId,s.docIds)}>NF {n?.numero} {#if n?.favorecido}({n.favorecido}){/if} combina com {s.docIds.length} {s.docIds.length===1?'boleto':'boletos'} sem nota · <strong>vincular</strong></button>{/each}</div>{/if}

  {#if !estado.notas.length && !totalLinhas}
  <div class="empty">Notas e boletos lidos<br/>aparecem aqui</div>
  {:else}
  {#each estado.notas as nota (nota.id)}
   {@const rec=reconciliacao(estado,nota.id)}
   {@const parc=parcelasDaNota(estado,nota.id)}
   <div class="nota" class:destaque={destaque===nota.id} class:ativa={notaAtivaId===nota.id}>
    <div class="nota-head">
     <span class="badge">NF {nota.numero}{#if nota.serie} · s{nota.serie}{/if}</span>
     {#if notaAtivaId===nota.id}<span class="tag-ativa">ativa</span>{:else}<button class="mini" onclick={()=>definirAtiva(nota.id)}>tornar ativa</button>{/if}
     <button class="remover" aria-label="Remover nota {nota.numero}" onclick={()=>apagarNota(nota.id)}>×</button>
    </div>
    <input class="forn-input" class:faltando={!nota.favorecido} list="lista-fornecedores" placeholder="Fornecedor (toque para definir)" value={nota.favorecido} onchange={(e)=>editarFavorecido(nota,e.currentTarget.value)}/>
    {#if buscando.includes(nota.id)}<p class="cnpj buscando">buscando nome pelo CNPJ…</p>{:else if nota.cnpj}<p class="cnpj">{formatarCnpj(nota.cnpj)}</p>{/if}
    <input class="total-input" class:faltando={nota.valorTotalCentavos==null} inputmode="decimal" placeholder="Valor total da nota — agrupa as parcelas" value={nota.valorTotalCentavos!=null?valorParaColar(nota.valorTotalCentavos):''} onchange={(e)=>editarTotal(nota,e.currentTarget.value)}/>
    <p class="recon recon-{rec.status}">Boletos: {rec.boletos.length} · soma {formatarValor(rec.somaCentavos)}{#if rec.totalCentavos!=null} de {formatarValor(rec.totalCentavos)} — {STATUS_ROTULO[rec.status]}{/if}</p>
    {#if rec.boletos.length}
    <ol class="docs compact">
     {#each rec.boletos as doc (doc.id)}{@const c=doc.codigo}{@const p=parc.get(doc.id)}
     <li class="doc" class:destaque={destaque===doc.id}>
      <div class="doc-topo"><span class="num">{p?`${p.n}/${p.total}`:'•'}</span><span class="tipo">{NOMES[c.tipo]}</span><button class="desvinc" onclick={()=>{estado=vincular(estado,doc.id,undefined)}}>desvincular</button><button class="remover" aria-label="Remover boleto" onclick={()=>removerDoc(doc.id)}>×</button></div>
      <button class="cel cel-linha" class:ok={copiado===`${doc.id}:linha`} onclick={()=>copiarCampo(doc,'linha')}><span class="rot">{c.tipo==='pix'?'Pix Copia e Cola':'Linha digitável'}</span><span class="val mono" class:corta={c.tipo==='pix'}>{#if c.tipo==='pix'}{c.barras}{:else}{#each textoParaColar(c,formato).split(' ') as g, i (i)}{#if i>0}{' '}{/if}<span class="grupo">{g}</span>{/each}{/if}</span><span class="feito">{copiado===`${doc.id}:linha`?'Copiado ✓':'Copiar'}</span></button>
      <div class="cels">
       <button class="cel" class:ok={copiado===`${doc.id}:valor`} disabled={!c.valorCentavos} onclick={()=>copiarCampo(doc,'valor')}><span class="rot">Valor</span><span class="val">{c.valorCentavos?formatarValor(c.valorCentavos):'—'}</span><span class="feito">{copiado===`${doc.id}:valor`?'Copiado ✓':c.valorCentavos?'Copiar':''}</span></button>
       <button class="cel" class:ok={copiado===`${doc.id}:vencimento`} disabled={!c.vencimento} onclick={()=>copiarCampo(doc,'vencimento')}><span class="rot">Vencimento</span><span class="val">{c.vencimento?dataBr(c.vencimento):'—'}</span><span class="feito">{copiado===`${doc.id}:vencimento`?'Copiado ✓':c.vencimento?'Copiar':''}</span></button>
      </div>
     </li>
     {/each}
    </ol>
    {/if}
   </div>
  {/each}

  {#if semNota.length}
  <div class="grupo-solto">
   <p class="eyebrow">BOLETOS SEM NOTA ({semNota.length})</p>
   <ol class="docs">
    {#each semNota as doc (doc.id)}{@const c=doc.codigo}
    <li class="doc" class:destaque={destaque===doc.id} class:com-alerta={!!doc.alerta}>
     <div class="doc-topo"><span class="num">•</span><span class="tipo">{NOMES[c.tipo]}</span>{#if estado.notas.length}<select class="vinc" onchange={(e)=>{estado=vincular(estado,doc.id,e.currentTarget.value||undefined);e.currentTarget.selectedIndex=0}}><option value="">vincular a…</option>{#each estado.notas as n (n.id)}<option value={n.id}>NF {n.numero}{#if n.favorecido} · {n.favorecido}{/if}</option>{/each}</select>{/if}<button class="remover" aria-label="Remover boleto" onclick={()=>removerDoc(doc.id)}>×</button></div>
     <button class="cel cel-linha" class:ok={copiado===`${doc.id}:linha`} onclick={()=>copiarCampo(doc,'linha')}><span class="rot">{c.tipo==='pix'?'Pix Copia e Cola':'Linha digitável'}</span><span class="val mono" class:corta={c.tipo==='pix'}>{#if c.tipo==='pix'}{c.barras}{:else}{#each textoParaColar(c,formato).split(' ') as g, i (i)}{#if i>0}{' '}{/if}<span class="grupo">{g}</span>{/each}{/if}</span><span class="feito">{copiado===`${doc.id}:linha`?'Copiado ✓':'Copiar'}</span></button>
     <div class="cels">
      <button class="cel" class:ok={copiado===`${doc.id}:valor`} disabled={!c.valorCentavos} onclick={()=>copiarCampo(doc,'valor')}><span class="rot">Valor</span><span class="val">{c.valorCentavos?formatarValor(c.valorCentavos):c.dinamico?'No app':'—'}</span><span class="feito">{copiado===`${doc.id}:valor`?'Copiado ✓':c.valorCentavos?'Copiar':''}</span></button>
      <button class="cel" class:ok={copiado===`${doc.id}:vencimento`} disabled={!c.vencimento} onclick={()=>copiarCampo(doc,'vencimento')}><span class="rot">Vencimento</span><span class="val">{c.vencimento?dataBr(c.vencimento):'—'}</span><span class="feito">{copiado===`${doc.id}:vencimento`?'Copiado ✓':c.vencimento?'Copiar':''}</span></button>
     </div>
     {#if doc.alerta}<p class="alerta">{doc.alerta}</p>{/if}
    </li>
    {/each}
   </ol>
  </div>
  {/if}

  <div class="acoes"><button class="primary" onclick={copiarPlanilha} disabled={!totalLinhas}>{copiado==='planilha'?'Planilha copiada ✓':`Copiar ${totalLinhas} ${totalLinhas===1?'linha':'linhas'} para a planilha`}</button><button class="secondary perigo" onclick={limpar}>{confirmarLimpeza?'Toque de novo para limpar':'Limpar sessão'}</button></div>
  {/if}
  <p class="small">Colunas na ordem da planilha (Favorecidos, Competência, Vencimento, Valor, Variação, Status, Pago em, Descrição, BarCode), só valores. Vencimento e valor vêm do boleto; confira favorecido e valor no app do banco antes de pagar.</p>
 </section></div>
 <datalist id="lista-fornecedores">{#each fornecedores as f (f)}<option value={f}></option>{/each}</datalist>
 {:else if view==='pix'}
 <section class="intro"><p class="eyebrow">RECEBIMENTOS</p><h1>Um Pix, pronto para conferir.</h1><p>Gere uma prévia estática. O QR não confirma a titularidade da chave ou o recebimento de valores.</p></section>
 <div class="grid"><form class="card" onsubmit={(e)=>{e.preventDefault();void generate();}}><h2>Dados do recebedor de teste</h2><label for="pkey">Chave Pix</label><input id="pkey" bind:value={key} required maxlength="77" placeholder="teste@example.com"/><label for="pname">Nome, sem acentos</label><input id="pname" bind:value={name} required maxlength="25"/><label for="pcity">Cidade, sem acentos</label><input id="pcity" bind:value={city} required maxlength="15"/><div class="row"><div><label for="pamount">Valor opcional (R$)</label><input id="pamount" bind:value={amount} inputmode="decimal" placeholder="10,50"/></div><div><label for="ptxid">Identificador opcional</label><input id="ptxid" bind:value={txid} maxlength="25"/></div></div><button class="primary" disabled={busy}>{busy?'Gerando…':'Gerar prévia do QR'}</button></form>
 <section class="card qr"><p class="eyebrow">PIX ESTÁTICO · NÃO HOMOLOGADO</p>{#if qr}<img src={qr} alt="QR Code Pix estático de teste" width="288" height="288"/><label for="ppayload">Pix Copia e Cola</label><textarea id="ppayload" readonly value={payload} rows="5"></textarea>{:else}<div class="empty">Seu QR Code<br/>aparecerá aqui</div>{/if}</section></div>
 {:else}
 <section class="intro"><p class="eyebrow">IMPLEMENTAÇÃO INCREMENTAL</p><h1>O que já está verificável.</h1><p>Etapas explícitas para separar a prévia técnica da operação financeira.</p></section>
 <section class="card"><div class="status"><span>Leitura de boleto, Pix e DANFE</span><b>Prévia implementada</b></div><div class="status"><span>Associação boleto ↔ nota fiscal</span><b>Prévia implementada</b></div><div class="status"><span>Saída para planilha (9 colunas)</span><b>Prévia implementada</b></div><div class="status"><span>Cadastro multiempresa e Auth/MFA</span><b class="pending">Integração pendente</b></div><div class="status"><span>REM / RET operacional</span><b class="pending">Bloqueado por homologação</b></div></section>
 {/if}
 {#if error}<p class="feedback error" role="alert">{error}</p>{/if}{#if result}<p class="feedback" role="status">{result}</p>{/if}
 <footer>THB Financeiro · Nenhum pagamento é executado por esta prévia.</footer>
 </main>
</div>
<style>
:global(:root){--grass:#6f924f;--grass-deep:#53723a;--grass-dark:#3c5530;--parch:#efe7cf;--parch-2:#e6dcbe;--parch-edge:#d8c9a4;--wood:#8a5a3b;--wood-dark:#5e3b26;--bar:#241c16;--ink:#38291d;--ink-soft:#766045;--ink-faint:#9a856a;--gold:#f3c44f;--gold-deep:#d69a2a;--teal:#2a9d9d;--teal-deep:#1d7676;--alert:#e2503c;--line:#2c2017;--ok:#4f8a3d;--warn:#c98a1e;--shadow:0 4px 0 rgba(26,18,12,.24),0 9px 16px rgba(26,18,12,.15);--fd:'Lilita One',system-ui,sans-serif;--fb:'Nunito',system-ui,-apple-system,sans-serif;color-scheme:light}
:global(*){box-sizing:border-box}
:global(body){margin:0;font-family:var(--fb);font-weight:700;color:var(--ink);-webkit-font-smoothing:antialiased;background:radial-gradient(130% 80% at 50% -10%,#86a862 0%,var(--grass) 46%,var(--grass-deep) 100%) fixed}
:global(button),:global(input),:global(textarea),:global(select){font:inherit}
button{cursor:pointer}button:disabled{opacity:.55;cursor:wait}
:global(:focus-visible){outline:3px solid #fff;outline-offset:2px}
.app{display:grid;grid-template-columns:230px 1fr;min-height:100vh}
aside{background:linear-gradient(#2f2419,#1b150f);color:#f3e9d6;padding:24px 18px;display:flex;flex-direction:column;border-right:3px solid var(--line)}
.brand{font-family:var(--fd);font-weight:400;font-size:30px;letter-spacing:.5px;color:var(--gold);line-height:1}
.brand span{display:block;font-size:10px;letter-spacing:4px;margin-top:5px;color:#c9b795;font-weight:800}
.workspace{margin:28px 0 20px;border-top:2px solid #3a2e20;padding-top:16px;font-size:13px;font-weight:800;color:#ecdfc6}
.workspace span{display:block;color:#ad9873;font-size:12px;margin-top:6px;font-weight:700}
nav{display:grid;gap:7px}
nav button{border:2px solid transparent;color:#c9b795;background:rgba(255,255,255,.05);padding:10px 12px;text-align:left;border-radius:11px;font-size:12px;font-weight:800;display:flex;gap:10px;align-items:center}
nav button span{font-size:13px}
nav button.active{background:linear-gradient(var(--gold),var(--gold-deep));border-color:var(--line);color:var(--ink);box-shadow:0 3px 0 var(--wood-dark)}
.side-note{margin-top:auto;padding-top:34px;font-size:12px;line-height:1.7;color:#ad9873;font-weight:700}
main{padding:20px clamp(14px,4vw,44px) 40px;max-width:1500px;width:100%;min-width:0}
header{display:flex;justify-content:space-between;gap:20px;font-size:12px;font-weight:800;color:#edf4e2;padding-bottom:14px;text-shadow:0 1px 2px rgba(0,0,0,.35)}
header strong{font-size:10px;letter-spacing:1px;color:var(--gold)}
.notice{margin:18px 0;padding:11px 14px;border:2px solid var(--line);background:linear-gradient(#fbf1d4,#f6e7b6);border-radius:13px;font-size:12px;font-weight:700;color:#6b531d;box-shadow:var(--shadow)}
.intro{max-width:760px;margin:22px 0 24px}
.intro .eyebrow{color:#dff0cf}
.eyebrow{font-size:10px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;color:var(--grass-deep)}
h1{font-family:var(--fd);font-weight:400;font-size:clamp(25px,3.1vw,40px);letter-spacing:.3px;line-height:1.08;margin:10px 0;color:#fff;text-shadow:0 2px 3px rgba(0,0,0,.3)}
.intro p{color:#eef4e4;text-shadow:0 1px 2px rgba(0,0,0,.3)}
p{line-height:1.5;font-size:14px;font-weight:700;color:var(--ink-soft)}
h2{font-family:var(--fd);font-weight:400;font-size:19px;letter-spacing:.2px;color:var(--ink)}
.grid{display:grid;grid-template-columns:1.15fr 1fr;gap:16px}
.card{background:linear-gradient(var(--parch),var(--parch-2));border:2.5px solid var(--line);border-radius:18px;padding:18px;box-shadow:var(--shadow)}
.card-heading{display:flex;align-items:center;gap:12px}
.step{background:linear-gradient(var(--teal),var(--teal-deep));color:#fff;border:2px solid var(--line);border-radius:12px;font-family:var(--fd);font-weight:400;font-size:13px;width:34px;height:34px;display:grid;place-items:center;box-shadow:inset 0 2px 0 rgba(255,255,255,.25)}
.small{font-size:12px;margin-top:14px;line-height:1.55;font-weight:700;color:var(--ink-soft)}
label{display:block;margin:14px 0 6px;font-size:11px;font-weight:900;letter-spacing:.6px;text-transform:uppercase;color:var(--ink-faint)}
input,textarea,select{width:100%;border:2px solid var(--parch-edge);border-radius:11px;padding:10px 12px;background:#fffdf6;color:var(--ink);font-size:14px;font-weight:700}
input:focus,textarea:focus,select:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px rgba(42,157,157,.2)}
textarea{resize:vertical;overflow-wrap:anywhere}
button.primary,button.secondary{font-family:var(--fd);font-weight:400;font-size:15px;letter-spacing:.3px;padding:12px 16px;border-radius:13px;margin-top:16px;border:2.5px solid var(--line);transition:transform .06s,box-shadow .06s}
.primary{background:linear-gradient(var(--gold),var(--gold-deep));color:var(--ink);width:100%;box-shadow:0 4px 0 var(--wood-dark),0 7px 12px rgba(0,0,0,.2)}
.secondary{background:linear-gradient(#efe6cd,#ddd0ac);color:var(--ink);box-shadow:0 4px 0 #9a875f,0 7px 12px rgba(0,0,0,.18)}
.primary:active,.secondary:active{transform:translateY(3px);box-shadow:0 1px 0 var(--wood-dark),0 3px 7px rgba(0,0,0,.2)}
video{display:none;width:100%;border-radius:12px}video.visible{display:block;max-height:65vh;object-fit:contain;background:#1a2a26}
.scan-tip{font-size:12px;font-weight:700}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.qr{text-align:center}.qr img{max-width:100%;height:auto}
.empty{min-height:180px;display:grid;place-content:center;color:var(--ink-faint);background:#fbf6e7;border:2px dashed var(--parch-edge);border-radius:14px;line-height:1.6;margin-top:16px;text-align:center;font-weight:700}
.qr textarea{font-size:11px}
.status{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid var(--parch-edge);padding:16px 0;font-size:13px;font-weight:700}
.status b{font-weight:800}
.pending{color:var(--warn)}
.feedback{padding:16px;background:linear-gradient(#e7f3df,#d8ecca);border:2px solid #bfe0ae;border-radius:14px;color:#2f6a22;font-weight:800}
.error{background:linear-gradient(#fbe5e0,#f6d2c8);border-color:#f0bdb1;color:#9a3824}
footer{margin-top:34px;color:#dfe9d2;font-size:11px;font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,.3)}
.dica{color:var(--warn)}
.colar{margin-top:16px;padding:16px;border:2.5px solid var(--line);background:linear-gradient(var(--parch),var(--parch-2));border-radius:16px;box-shadow:var(--shadow)}
.colar-topo{display:flex;justify-content:space-between;align-items:center;gap:12px}
.colar .eyebrow{margin:0;color:var(--grass-deep)}
.selo{white-space:nowrap;font-size:11px;font-weight:900;color:#fff;background:linear-gradient(var(--teal),var(--teal-deep));border:2px solid var(--line);padding:3px 10px;border-radius:99px}
.linha{display:block;margin:12px 0 4px;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:clamp(15px,2.1vw,19px);line-height:1.45;color:var(--ink);overflow-wrap:anywhere;user-select:all;-webkit-user-select:all}
.linha.pix{font-size:12px}.grupo{white-space:nowrap}
.formatos{display:flex;gap:6px;margin-top:16px;flex-wrap:wrap}
.formatos button{flex:1 1 auto;padding:8px 12px;border:2px solid var(--line);background:#fffdf6;color:var(--ink);border-radius:99px;font-size:12px;font-weight:800}
.formatos button.ativo{background:linear-gradient(var(--teal),var(--teal-deep));color:#fff}
.colar .small{margin-top:10px}.aviso{color:var(--warn)}
.lote{grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);align-items:start}
.sincro{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:800;margin:14px 0 4px}
.sincro input{width:auto}.sincro strong{color:var(--teal-deep)}
.manual-nf{margin-top:16px}
.cadastro{border:2px solid var(--parch-edge);background:#fbf6e7;border-radius:14px;padding:14px;margin-top:10px}
.cadastro .row{margin-top:0}
.sessao-topo{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap}
.sessao-topo h2{margin:4px 0 0}
.soma{text-align:right;display:grid;gap:2px}
.soma span{font-size:11px;color:var(--ink-soft);font-weight:800}
.soma strong{font-family:var(--fd);font-weight:400;font-size:24px;font-variant-numeric:tabular-nums;color:var(--ink)}
.soma small{font-size:11px;color:var(--warn);font-weight:800}
.sugestoes{display:grid;gap:8px;margin:16px 0}
.sug{text-align:left;border:2px solid #9cc3a8;background:linear-gradient(#eef7ea,#e1f0d8);color:#1d5637;border-radius:12px;padding:10px 12px;font-size:12px;font-weight:700;line-height:1.5;box-shadow:0 3px 0 rgba(26,18,12,.12)}
.sug strong{text-decoration:underline}
.nota{border:2.5px solid var(--line);border-radius:16px;padding:0;margin-top:12px;background:#fbf6e7;overflow:hidden;box-shadow:var(--shadow);transition:box-shadow .3s}
.nota.ativa{box-shadow:0 0 0 2px var(--teal-deep) inset,var(--shadow)}
.nota.destaque{background:#f3ecd6}
.nota-head{display:flex;align-items:center;gap:8px;padding:11px 13px;background:linear-gradient(var(--grass),var(--grass-deep));border-bottom:2px solid var(--line);flex-wrap:wrap}
.badge{font-family:var(--fd);font-weight:400;font-size:14px;color:#fff;background:transparent;padding:0;text-shadow:0 1px 0 rgba(0,0,0,.25)}
.tag-ativa{font-size:10px;font-weight:900;letter-spacing:1px;text-transform:uppercase;color:var(--grass-deep);background:#eaf3df;padding:3px 8px;border-radius:99px;border:1.5px solid rgba(0,0,0,.15)}
.mini{font-size:11px;font-weight:800;border:2px solid var(--line);background:#fffdf6;color:var(--ink);border-radius:99px;padding:3px 10px;margin-left:auto}
.nota>.forn-input,.nota>.cnpj,.nota>.total-input,.nota>.recon,.nota>.docs,.nota>.alerta,.nota>.desvinc{margin-left:13px;margin-right:13px}
.nota>.forn-input{margin-top:12px;width:calc(100% - 26px)}
.nota>.docs{margin-bottom:13px}
.forn-input{font-weight:800;padding:9px 11px}
.forn-input.faltando{border-color:var(--gold-deep);background:#fdf6e4}
.cnpj{font-size:11px;color:var(--ink-soft);font-weight:800;margin:6px 13px 0;font-variant-numeric:tabular-nums}
.total-input{font-weight:800;padding:9px 11px;margin:8px 13px 0;width:calc(100% - 26px);font-variant-numeric:tabular-nums}
.total-input.faltando{border-color:var(--gold-deep);background:#fdf6e4}
.recon{font-size:12px;font-weight:800;margin:10px 13px 2px;font-variant-numeric:tabular-nums}
.recon-confere{color:#2f6a22}.recon-parcial{color:var(--warn)}.recon-excede{color:#9a3824}.recon-sem-total{color:var(--ink-soft)}
.docs{list-style:none;padding:0;margin:0;display:grid;gap:8px}
.docs.compact{margin-top:10px;gap:7px}
.grupo-solto .docs{max-height:min(60vh,760px);overflow:auto}
.doc{border:2px solid var(--parch-edge);border-radius:12px;padding:10px;background:#fffdf6;transition:background .3s,border-color .3s}
.doc.destaque{background:#e7f3df;border-color:#9fcf87}
.doc.com-alerta{border-color:var(--gold-deep)}
.doc-topo{display:flex;align-items:center;gap:8px;margin-bottom:8px;min-width:0}
.num{font-family:var(--fd);font-weight:400;font-size:11px;color:#fff;background:var(--teal);border:1.5px solid var(--line);border-radius:8px;min-width:30px;height:22px;display:grid;place-items:center;padding:0 7px}
.tipo{font-size:12px;font-weight:800}
.remover{margin-left:auto;border:0;background:transparent;color:var(--ink-faint);font-size:20px;line-height:1;padding:2px 6px;border-radius:8px}
.remover:hover{background:#f3ddd3;color:#9a3824}
.desvinc{border:0;background:transparent;color:var(--wood);font-size:11px;font-weight:800;text-decoration:underline;padding:2px 4px}
.vinc{width:auto;flex:1;min-width:0;padding:5px 8px;font-size:12px;border-radius:8px}
.cel{display:grid;grid-template-columns:1fr auto;grid-template-areas:"rot feito" "val val";gap:2px 10px;width:100%;text-align:left;border:2px solid var(--parch-edge);background:#fffdf6;border-radius:11px;padding:9px 11px;color:var(--ink);min-height:42px}
.cel:hover:not(:disabled){border-color:var(--teal)}
.cel:disabled{cursor:default;opacity:1;background:#f4eed9}
.cel .rot{grid-area:rot;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--ink-faint);font-weight:900}
.cel .val{grid-area:val;font-size:14px;font-weight:800;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.cel .feito{grid-area:feito;font-size:11px;color:var(--ink-faint);font-weight:800}
.cel.ok{border-color:#9fcf87;background:#e7f3df}
.cel.ok .feito{color:#2f6a22;font-weight:900}
.mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-weight:600!important;font-size:13px!important}
.corta{display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cels{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
.alerta{margin:8px 0 0;font-size:12px;font-weight:700;line-height:1.5;color:#6b531d;background:#fbf1d4;border:2px solid #ecd59a;border-radius:10px;padding:8px 10px}
.grupo-solto{margin-top:18px;border-top:2px solid rgba(255,255,255,.3);padding-top:14px}
.grupo-solto .eyebrow{margin-bottom:10px;color:#e4f0d6}
.acoes{display:grid;grid-template-columns:1.4fr 1fr;gap:10px;margin-top:16px}
.acoes .primary,.acoes .secondary{margin-top:0}
.perigo{color:#9a3824!important}
.cam-wrap{position:relative;margin-top:14px;overflow:hidden;border-radius:12px;border:2px solid var(--line)}
.cam-wrap:not(.on){margin:0;border:0}
.cam-wrap video{transform-origin:center center;transition:transform .15s ease-out}
.cam-flash{position:absolute;inset:0;border-radius:12px;pointer-events:none;animation:camflash .55s ease-out forwards}
.cam-flash.nfe{--cf:#39d98a}.cam-flash.doc{--cf:#49b7dd}
@keyframes camflash{0%{box-shadow:inset 0 0 0 7px var(--cf),0 0 26px 3px var(--cf);opacity:1}100%{box-shadow:inset 0 0 0 7px transparent,0 0 0 0 transparent;opacity:0}}
@media(prefers-reduced-motion:reduce){.cam-flash{animation-duration:.25s}}
.cam-ctrls{position:absolute;left:0;right:0;bottom:10px;display:flex;justify-content:center;align-items:center;gap:9px;pointer-events:none}
.cam-ctrls>*{pointer-events:auto}
.cc{min-width:44px;height:44px;font-size:19px;display:grid;place-items:center;border:2px solid var(--line);background:rgba(20,30,28,.6);color:#fff;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);border-radius:99px;padding:0 12px}
.cc.on{background:#fff;color:var(--ink)}
.cc.torch{width:44px;height:44px;font-size:20px;display:grid;place-items:center;border:2px solid var(--line);background:rgba(20,30,28,.6);color:#fff;border-radius:99px}
.cc.torch.on{background:var(--gold);color:var(--ink)}
.cc-zoom{display:flex;gap:4px;background:rgba(20,30,28,.6);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);border:2px solid var(--line);border-radius:99px;padding:3px}
.cc-zoom button{border:0;background:transparent;color:#fff;font-weight:800;padding:7px 12px;font-size:13px;min-width:38px;border-radius:99px}
.cc-zoom button.on{background:#fff;color:var(--ink)}
.cam-hud{margin-top:12px}
.hud-label{font-size:10px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;color:#e4f0d6;text-shadow:0 1px 2px rgba(0,0,0,.3)}
.hud-vazio{font-size:12px;color:var(--ink-faint);font-style:italic;font-weight:700}
.cam-hud .hud-grupos{display:flex;flex-direction:column;gap:7px;margin-top:8px;max-height:240px;overflow:auto}
.hud-nota{border:2px solid var(--line);border-radius:12px;background:#fbf6e7;overflow:hidden;box-shadow:0 3px 0 rgba(26,18,12,.16);transition:background .2s}
.hud-nota.ativa{box-shadow:0 0 0 2px var(--teal-deep) inset,0 3px 0 rgba(26,18,12,.16)}
.hud-nota.on{background:#f0e8ce}
.hud-nota.solta{background:#eef3f6}
.hud-cat{display:flex;align-items:center;gap:8px;padding:7px 11px;background:linear-gradient(var(--grass),var(--grass-deep));color:#fff;border-bottom:2px solid var(--line);flex-wrap:wrap}
.hud-nota.solta .hud-cat{background:linear-gradient(#7d8aa0,#5d6b82)}
.hud-nf{font-family:var(--fd);font-weight:400;font-size:14px;letter-spacing:.2px;text-shadow:0 1px 0 rgba(0,0,0,.25)}
.hud-nf.solta{color:#fff}
.hud-forn{font-size:12px;font-weight:800;color:#eaf4df}
.hud-total{font-size:12px;font-weight:900;color:var(--gold);font-variant-numeric:tabular-nums}
.hud-cont{margin-left:auto;font-size:10px;font-weight:900;letter-spacing:.8px;text-transform:uppercase;color:#dcebcf;background:rgba(0,0,0,.18);border-radius:99px;padding:2px 8px}
.hud-bols{display:flex;flex-wrap:wrap;gap:5px;padding:7px 10px}
.hud-bol{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:800;border-radius:99px;padding:4px 9px;background:#fff;color:var(--teal-deep);border:2px solid var(--parch-edge);line-height:1.2;transition:transform .2s,background .2s;font-variant-numeric:tabular-nums}
.hud-bol.solto{color:var(--ink-faint);border-style:dashed}
.hud-bol.on{transform:scale(1.07);background:#c4e6f1}
@media(max-width:900px){.app{grid-template-columns:1fr}.app>aside,.app>main,.app nav{min-width:0}aside{padding:10px 16px;flex-direction:row;align-items:center;gap:12px;border-right:0;border-bottom:3px solid var(--line);flex-wrap:wrap}.brand{font-size:22px}.brand span{display:none}.workspace,.side-note{display:none}nav{display:flex;margin-top:0;margin-left:auto;flex-wrap:wrap;gap:6px}nav button{padding:8px 11px;white-space:nowrap}.app.compacto nav{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}header{display:none}main{padding:12px 14px 30px}.grid{grid-template-columns:1fr}.lote{grid-template-columns:1fr}.acoes{grid-template-columns:1fr}.intro{margin-top:16px}.status{flex-direction:column;gap:8px}}
</style>
