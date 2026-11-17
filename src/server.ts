import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { NebulaClient, type FetchLike } from './client/http.js';
import { API_KEY_ENV, TOOLSETS_ENV, type ServerConfig } from './config.js';
import { invalidArgument } from './errors.js';
import { NebulaRepository } from './upstream/repository.js';
import { failure, protectResult } from './tools/result.js';
import { toolCatalog, toolsFor } from './tools/registry.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

export interface ServerDeps {
  /** Injected fetch for offline tests; production uses the global implementation. */
  fetch?: FetchLike;
  now?: () => Date;
}

const SERVER_INSTRUCTIONS = [
  'Read-only UT Dallas courses, sections, professors, grades, academic calendars, clubs, and optional campus events.',
  `${API_KEY_ENV} is required for calls, not discovery. ${TOOLSETS_ENV} selects toolsets.`,
  'Academic filters are exact-match; clubs support keyword search. Use returned cursors and heed provenance/freshness notes.',
].join(' ');

/**
 * Use the SDK's low-level server so published schemas are strict and useful for
 * discovery, while validation happens inside our bounded/redacted tool boundary.
 * The high-level registerTool validator otherwise echoes invalid enum values
 * before the handler can apply the error contract.
 */
export function createServer(config: ServerConfig, deps: ServerDeps = {}): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );
  const repo = new NebulaRepository(new NebulaClient({ apiKey: config.apiKey, fetch: deps.fetch }));
  const now = deps.now ?? (() => new Date());
  const tools = toolsFor(config.toolsets);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const secrets = config.apiKey === undefined ? [] : [config.apiKey];
  const catalog = toolCatalog(tools);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool): Tool => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: z.toJSONSchema(z.object(tool.inputShape).strict(), { io: 'input', target: 'draft-7' }) as Tool['inputSchema'],
      annotations: tool.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      const tool = byName.get(request.params.name);
      if (!tool) throw invalidArgument('The requested tool is not enabled on this server.');
      const result = await tool.handler(request.params.arguments ?? {}, { repo, now, signal: extra.signal });
      return protectResult(result, secrets);
    } catch (error) {
      return protectResult(failure(error), secrets);
    }
  });

  server.oninitialized = () => {
    process.stderr.write(
      `nebula-mcp ${SERVER_VERSION}: toolsets=${config.toolsets.join(',')} tools=${tools.length} (academics=${catalog.academics.length}, clubs=${catalog.clubs.length}, events=${catalog.events.length}) key=${config.apiKey === undefined ? 'missing' : 'present'}\n`,
    );
  };
  return server;
}
