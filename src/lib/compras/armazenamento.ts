/**
 * Armazenamento local (IndexedDB) do app de compras: um registro por chave
 * (`estado` = listas e itens, `snapshot` = preços). Sem IndexedDB (aba privada antiga),
 * cai para memória — o app funciona, só não guarda entre aberturas.
 */
const BANCO = 'thb-compras'
const LOJA = 'kv'

let conexao: Promise<IDBDatabase | null> | undefined
const memoria = new Map<string, unknown>()

/** Abre (uma vez) o banco; null quando IndexedDB não está disponível. */
function abrir(): Promise<IDBDatabase | null> {
  conexao ??= new Promise(resolve => {
    try {
      const req = indexedDB.open(BANCO, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(LOJA)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return conexao
}

/**
 * Lê um valor.
 * @param chave chave do registro
 */
export async function ler<T>(chave: string): Promise<T | undefined> {
  const db = await abrir()
  if (!db) return memoria.get(chave) as T | undefined
  return new Promise(resolve => {
    const req = db.transaction(LOJA, 'readonly').objectStore(LOJA).get(chave)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => resolve(undefined)
  })
}

/**
 * Grava um valor (clonado estruturalmente pelo IndexedDB).
 * @param chave chave do registro
 * @param valor valor serializável
 * @returns true se gravou no disco, false se ficou só em memória
 */
export async function gravar(chave: string, valor: unknown): Promise<boolean> {
  const db = await abrir()
  if (!db) {
    memoria.set(chave, valor)
    return false
  }
  return new Promise(resolve => {
    const tx = db.transaction(LOJA, 'readwrite')
    tx.objectStore(LOJA).put(valor, chave)
    tx.oncomplete = () => resolve(true)
    tx.onerror = () => resolve(false)
  })
}

/** Pede ao navegador para não apagar os dados sob pressão de espaço (melhor esforço). */
export async function pedirPersistencia(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
