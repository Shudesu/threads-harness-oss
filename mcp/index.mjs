#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, readConfig } from './server.mjs';
try {
  const { server, verify } = createServer(readConfig());
  await verify();
  await server.connect(new StdioServerTransport());
  console.error('Threads Harness MCP ready (stdio).');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
