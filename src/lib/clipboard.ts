/**
 * Copia texto para a área de transferência.
 *
 * A Clipboard API exige contexto seguro (HTTPS/localhost). No Safari/iOS também exige
 * gesto do usuário: a cópia automática disparada pela câmera falha ali, e a interface
 * oferece o botão "Copiar" como caminho garantido.
 * @param texto conteúdo a copiar
 * @returns true se o navegador confirmou a cópia
 */
export async function copiarTexto(texto:string):Promise<boolean>{
 try{
  await navigator.clipboard.writeText(texto)
  return true
 }catch{
  return copiarLegado(texto)
 }
}

/**
 * Fallback via seleção + execCommand, para navegadores sem Clipboard API utilizável.
 * @param texto conteúdo a copiar
 */
function copiarLegado(texto:string):boolean{
 const area=document.createElement('textarea')
 area.value=texto
 area.setAttribute('readonly','')
 area.style.position='fixed'
 area.style.opacity='0'
 document.body.append(area)
 area.select()
 let ok=false
 try{ok=document.execCommand('copy')}catch{ok=false}
 area.remove()
 return ok
}
