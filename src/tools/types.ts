import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import type { Toolset } from '../config.js';
import type { NebulaRepository } from '../upstream/repository.js';

export interface ToolContext {
  repo: NebulaRepository;
  now: () => Date;
  /** Cancellation signal wired from the MCP request. */
  signal?: AbortSignal;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  toolset: Toolset;
  /** Raw zod shape, also handed to the MCP SDK for schema publication. */
  inputShape: Record<string, z.ZodTypeAny>;
  annotations: ToolAnnotations;
  handler: (args: unknown, ctx: ToolContext) => Promise<CallToolResult>;
}

export const READ_ONLY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: true,
};
