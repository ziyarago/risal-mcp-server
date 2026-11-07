/**
 * Risal MCP server — remote (Streamable HTTP) entry, stateless.
 *
 *   POST /mcp   Authorization: Bearer risal_pat_…   (JSON-RPC)
 *   GET  /healthz
 *
 * Nothing is installed on the client: point an MCP client at the URL with the
 * token header. Every request builds its own server and carries the caller's token
 * to the Risal API (AsyncLocalStorage), so Risal's own scope checks apply and this
 * process holds no credentials and no sessions.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { API_BASE, buildServer, keyStore } from './server.js'

const PORT = Number(process.env.PORT || 8787)
const MAX_BODY = 1024 * 1024
const BEARER = /^Bearer (risal_pat_[A-Za-z0-9_-]{20,})$/

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}
const rpcError = (code: number, message: string) => ({ jsonrpc: '2.0', error: { code, message }, id: null })

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > MAX_BODY) throw new Error('body too large')
    chunks.push(c as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')
}

createServer(async (req, res) => {
  try {
    const path = (req.url || '/').split('?')[0]
    if (path === '/healthz') return send(res, 200, { ok: true })
    if (path !== '/mcp') return send(res, 404, { error: 'not found' })

    const m = BEARER.exec(String(req.headers.authorization || ''))
    if (!m) {
      return send(res, 401, rpcError(-32001, 'Send Authorization: Bearer risal_pat_… (Risal → Profile → API tokens)'),
        { 'WWW-Authenticate': 'Bearer realm="risal"' })
    }
    if (req.method !== 'POST') {
      // Stateless server: no standalone SSE stream and no sessions to terminate.
      return send(res, 405, rpcError(-32000, 'Method not allowed'), { Allow: 'POST' })
    }

    let body: unknown
    try { body = await readBody(req) } catch { return send(res, 400, rpcError(-32700, 'Invalid or oversized JSON body')) }

    const server = buildServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => { void transport.close(); void server.close() })
    await keyStore.run(m[1], async () => {
      await server.connect(transport)
      await transport.handleRequest(req, res, body)
    })
  } catch (e) {
    console.error('mcp request failed:', e instanceof Error ? e.message : e)
    if (!res.headersSent) send(res, 500, rpcError(-32603, 'Internal server error'))
  }
}).listen(PORT, '0.0.0.0', () => console.error(`risal-mcp-server (http) listening on :${PORT} → ${API_BASE}`))
