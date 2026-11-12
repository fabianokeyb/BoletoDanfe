/// <reference lib="webworker" />
import {assets, immutable} from '$app/manifest'
import {version} from '$app/env'

const worker = self as unknown as ServiceWorkerGlobalScope
const CACHE = `thb-shell-${version}`
// Os caminhos do manifest são relativos ao base path; o SW está em <base>/service-worker.js,
// então resolver contra a própria URL dá o pathname absoluto (/BoletoDanfe/_app/...).
// Antes a comparação usava o caminho relativo e nunca casava: nada era servido do cache.
const ASSETS = [...immutable, ...assets].map(a => a.path)
const CAMINHOS = new Set(ASSETS.map(p => new URL(p, worker.location.href).pathname))
/** HTML do app (fallback do SPA). Sem ele a PWA não abre sem rede — caso da gôndola. */
const SHELL = new URL('./', worker.location.href).href
const ESPERA_REDE_MS = 3500

// Instala assumindo o controle imediato (skipWaiting): sem isso, após um deploy o SW
// antigo seguiria no comando até todas as abas fecharem — no iOS isso prende o app
// num shell velho cujos chunks já foram removidos do Pages (sintoma: erro ao recarregar).
// Promise.allSettled tolera 404 de um asset isolado, então o install nunca falha inteiro.
worker.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    await Promise.allSettled([...ASSETS.map(a => cache.add(a)), cache.add(new Request(SHELL, {cache: 'reload'}))])
    await worker.skipWaiting()
  })())
})

// Ativa, apaga caches de versões anteriores e passa a controlar as abas já abertas.
worker.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(k => k.startsWith('thb-shell-') && k !== CACHE).map(k => caches.delete(k)))
    await worker.clients.claim()
  })())
})

/**
 * Navegação: rede primeiro (deploy novo chega logo), com limite de espera; sem rede ou
 * lenta demais, abre o shell guardado. O shell não carrega dado nenhum — listas e preços
 * vivem no IndexedDB do aparelho.
 */
async function navegar(req: Request): Promise<Response> {
  const cache = await caches.open(CACHE)
  try {
    const resposta = await Promise.race([
      fetch(req),
      new Promise<never>((_, rejeita) => setTimeout(() => rejeita(new Error('lento')), ESPERA_REDE_MS))
    ])
    if (resposta.ok) await cache.put(SHELL, resposta.clone())
    return resposta
  } catch {
    return (await cache.match(SHELL)) ?? Response.error()
  }
}

// Assets imutáveis (com hash no nome): cache-first com preenchimento preguiçoso.
// Nunca cacheia API, Supabase (outra origem), imagens capturadas ou dados financeiros.
worker.addEventListener('fetch', event => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== worker.location.origin) return
  if (req.mode === 'navigate') {
    event.respondWith(navegar(req))
    return
  }
  if (!CAMINHOS.has(url.pathname)) return
  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const emCache = await cache.match(req)
    if (emCache) return emCache
    const resposta = await fetch(req)
    if (resposta.ok) cache.put(req, resposta.clone())
    return resposta
  })())
})
