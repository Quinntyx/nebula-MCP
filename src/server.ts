import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { NebulaClient, type FetchLike } from './client/http.js';
import { API_KEY_ENV, TOOLSETS_ENV, type ServerConfig } from './config.js';
import { NebulaRepository } from './upstream/repository.js';
import { failure } from './tools/result.js';
import { toolCatalog, toolsFor } from './tools/registry.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

export interface ServerDeps {
  /** Injected fetch for offline tests; production uses the global implementation. */
  fetch?: FetchLike;
  now?: () => Date;
}

const SERVER_INSTRUCTIONS = [
  'Read-only Nebula Labs UT Dallas data (courses, sections, professors, grades, academic calendars, clubs, and optional campus events).',
  `Requires ${API_KEY_ENV} for tool calls; discovery works without it. Academics and clubs are enabled by default, events only via ${TOOLSETS_ENV}.`,
  'Filters are exact and case-sensitive. Results are compact JSON with provenance, notes, and cursors; page with the returned cursor instead of guessing offsets.',
].join(' ');

/**
 * Builds the MCP server with only the toolsets implied by `config.toolsets`.
 *
 * The published input schema is intentionally lenient (unknown keys survive
 * parsing) so each tool's own strict schema can reject extra properties with a
 * bounded `INVALID_ARGUMENT` envelope instead of a protocol-level error.
 */
export function createServer(config: ServerConfig, deps: ServerDeps = {}): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  const repo = new NebulaRepository(
    new NebulaClient({ apiKey: config.apiKey, fetch: deps.fetch }),
  );
  const now = deps.now ?? (() => new Date());
  const tools = toolsFor(config.toolsets);
  const catalog = toolCatalog(tools);

  for (const tool of tools) {
    const inputSchema = z.object(tool.inputShape).passthrough();
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema,
        annotations: tool.annotations,
      },
      async (args, extra): Promise<CallToolResult> => {
        try {
          return await tool.handler(args, { repo, now, signal: extra.signal });
        } catch (error) {
          return failure(error);
        }
      },
    );
  }

  // Keep the enabled catalog reachable for diagnostics without logging to stdout.
  server.server.oninitialized = () => {
    process.stderr.write(
      `nebula-mcp ${SERVER_VERSION}: toolsets=${config.toolsets.join(',')} tools=${tools.length} (academics=${catalog.academics.length}, clubs=${catalog.clubs.length}, events=${catalog.events.length}) key=${config.apiKey === undefined ? 'missing' : 'present'}\n`,
    );
  };

  return server;
}
