/// <reference lib="webworker" />
import {assets,immutable} from '$app/manifest';
import {version} from '$app/env';
const worker=self as unknown as ServiceWorkerGlobalScope;
const CACHE=`thb-shell-${version}`;
const ASSETS=[...immutable,...assets].map(a=>a.path);
worker.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));});
worker.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('thb-shell-')&&k!==CACHE).map(k=>caches.delete(k)))));});
worker.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 // Only immutable UI assets. Never cache API, HTML with identity, tokens, images captured or financial data.
 if(event.request.method==='GET'&&url.origin===worker.location.origin&&ASSETS.includes(url.pathname)){
 event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(event.request))??fetch(event.request)));
 }
});
