import adapter from '@sveltejs/adapter-static'
import {sveltekit} from '@sveltejs/kit/vite'
import {vitePreprocess} from '@sveltejs/vite-plugin-svelte'
import {defineConfig} from 'vite'

// Base path do site. Raiz ('') por padrão — serve Cloudflare Pages (boletodanfe.pages.dev)
// e qualquer domínio próprio. O GitHub Pages de projeto serve em /<repo>/, então o
// workflow do Actions injeta BASE_PATH=/BoletoDanfe; sem a variável, assume a raiz.
const base = (process.env.BASE_PATH ?? '') as '' | `/${string}`

export default defineConfig({
  plugins: [sveltekit({adapter: adapter({fallback: 'index.html'}), paths: {base}, preprocess: vitePreprocess()})],
  server: {proxy: {'/api': {target: 'http://127.0.0.1:3001', rewrite: p => p.replace(/^\/api/, '')}}}
})
