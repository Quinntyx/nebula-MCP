import assert from 'node:assert/strict';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { NebulaClient, type FetchLike } from '../src/client/http.js';
import { failure } from '../src/tools/result.js';
import type { ToolDefinition } from '../src/tools/types.js';
import { NebulaRepository } from '../src/upstream/repository.js';

export interface ToolPayload {
  ok: boolean;
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    hint?: string;
    retryable?: boolean;
    upstream_status?: number;
  };
  /** Convenience mirror of `error.code` for terse assertions. */
  code?: string;
  message?: string;
}

export interface Invocation {
  payload: ToolPayload;
  result: CallToolResult;
  text: string;
  urls: string[];
}

/** Runs one tool exactly as the server does, with a fake upstream transport. */
export async function invoke(
  tool: ToolDefinition,
  args: unknown,
  fetch: FetchLike,
  urls: string[] = [],
): Promise<Invocation> {
  const client = new NebulaClient({ apiKey: 'offline-test-key', fetch });
  const repo = new NebulaRepository(client);
  let result: CallToolResult;
  try {
    result = await tool.handler(args, {
      repo,
      now: () => new Date('2026-11-16T12:00:00.000Z'),
    });
  } catch (error) {
    result = failure(error);
  }
  const text = result.content[0];
  assert.ok(text !== undefined && text.type === 'text', 'tool results are one text block');
  const payload = JSON.parse(text.text) as ToolPayload;
  if (payload.error !== undefined) {
    payload.code = payload.error.code;
    payload.message = payload.error.message;
  }
  return { payload, result, text: text.text, urls };
}

export function itemsOf(invocation: Invocation): Array<Record<string, unknown>> {
  const items = invocation.payload.data?.['items'];
  assert.ok(Array.isArray(items), 'expected an items array');
  return items as Array<Record<string, unknown>>;
}

export function queryOf(url: string): URLSearchParams {
  return new URL(url).searchParams;
}
