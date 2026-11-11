/// <reference lib="webworker" />
import {assets, immutable} from '$app/manifest'
import {version} from '$app/env'

const worker = self as unknown as ServiceWorkerGlobalScope
const CACHE = `thb-shell-${version}`
const ASSETS = [...immutable, ...assets].map(a => a.path)

// Instala assumindo o controle imediato (skipWaiting): sem isso, após um deploy o SW
// antigo seguiria no comando até todas as abas fecharem — no iOS isso prende o app
// num shell velho cujos chunks já foram removidos do Pages (sintoma: erro ao recarregar).
// Promise.allSettled tolera 404 de um asset isolado, então o install nunca falha inteiro.
worker.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    await Promise.allSettled(ASSETS.map(a => cache.add(a)))
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

// Só assets imutáveis (com hash no nome). Nunca cacheia API, HTML com identidade,
// tokens, imagens capturadas ou dados financeiros. Cache-first com preenchimento
// preguiçoso; se faltar no cache e a rede responder, guarda para o uso offline.
worker.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== worker.location.origin || !ASSETS.includes(url.pathname)) return
  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const emCache = await cache.match(event.request)
    if (emCache) return emCache
    const resposta = await fetch(event.request)
    if (resposta.ok) cache.put(event.request, resposta.clone())
    return resposta
  })())
})
