export async function api(path:string,body:unknown){
 const response=await fetch(`/api${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
 const result=await response.json().catch(()=>({message:'Resposta inválida do servidor.'}));
 if(!response.ok)throw new Error(result.message??'Não foi possível validar.');
 return result;
}
