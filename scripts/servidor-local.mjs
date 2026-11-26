// Servidor estático mínimo para rodar o build/ offline em 127.0.0.1.
// Uso: PORTA=5175 node scripts/servidor-local.mjs
import {createServer} from 'node:http'
import {readFile, stat} from 'node:fs/promises'
import {extname, join, normalize} from 'node:path'
import {fileURLToPath} from 'node:url'

const raiz = fileURLToPath(new URL('../build/', import.meta.url))
const porta = Number(process.env.PORTA ?? 5175)
const tipos = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2'
}

/** Resolve um caminho para um arquivo existente, ou null. */
async function arquivo(caminho) {
  try { return (await stat(caminho)).isFile() ? caminho : null } catch { return null }
}

createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const pedido = normalize(join(raiz, url))
  if (!pedido.startsWith(raiz)) { res.writeHead(403).end(); return }
  // arquivo exato → pasta/index.html → fallback SPA
  const achado = (await arquivo(pedido)) ?? (await arquivo(join(pedido, 'index.html'))) ?? join(raiz, 'index.html')
  try {
    const corpo = await readFile(achado)
    res.writeHead(200, {'content-type': tipos[extname(achado)] ?? 'application/octet-stream', 'cache-control': 'no-cache'})
    res.end(corpo)
  } catch {
    res.writeHead(404).end('Não encontrado')
  }
}).listen(porta, '127.0.0.1', () => console.log(`THB em http://127.0.0.1:${porta}  (feche esta janela para parar)`))
