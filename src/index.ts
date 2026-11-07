#!/usr/bin/env node
/**
 * Risal MCP server — stdio entry (npx / docker run -i).
 * The token comes from RISAL_API_KEY (Risal web app → Profile → API tokens).
 * For the hosted, no-install variant see http.ts.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { API_BASE, buildServer } from './server.js'

if (!process.env.RISAL_API_KEY) {
  console.error('RISAL_API_KEY is required (Risal web app → Profile → API tokens).')
  process.exit(1)
}

await buildServer().connect(new StdioServerTransport())
console.error('risal-mcp-server ready →', API_BASE)
