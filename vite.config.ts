import adapter from '@sveltejs/adapter-static'
import {sveltekit} from '@sveltejs/kit/vite'
import {vitePreprocess} from '@sveltejs/vite-plugin-svelte'
import {defineConfig} from 'vite'

// GitHub Pages de projeto serve em /<repo>/. O base path prefixa todos os
// assets, o service worker e as rotas. Sobrescrevível via BASE_PATH no CI.
const base = (process.env.BASE_PATH ?? '/BoletoDanfe') as '' | `/${string}`

export default defineConfig({
  plugins: [sveltekit({adapter: adapter({fallback: 'index.html'}), paths: {base}, preprocess: vitePreprocess()})],
  server: {proxy: {'/api': {target: 'http://127.0.0.1:3001', rewrite: p => p.replace(/^\/api/, '')}}}
})
