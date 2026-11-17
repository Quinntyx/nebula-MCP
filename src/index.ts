#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { API_KEY_ENV, TOOLSETS_ENV, loadConfig, type ServerConfig } from './config.js';
import { ConfigError } from './errors.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  let config: ServerConfig;
  try {
    config = loadConfig();
  } catch (error) {
    const message = error instanceof ConfigError ? error.message : 'invalid server configuration';
    process.stderr.write(`nebula-mcp: ${message}\n`);
    process.exitCode = 2;
    return;
  }

  if (config.apiKey === undefined) {
    // Discovery must still succeed; calls will fail with AUTH_MISSING.
    process.stderr.write(
      `nebula-mcp: ${API_KEY_ENV} is not set; tools are discoverable but calls will return AUTH_MISSING.\n`,
    );
  }

  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = (): void => {
    void server.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  process.stderr.write(
    `nebula-mcp: ready on stdio (toolsets=${config.toolsets.join(',')}; override with ${TOOLSETS_ENV})\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`nebula-mcp: fatal startup error: ${message}\n`);
  process.exitCode = 1;
});
