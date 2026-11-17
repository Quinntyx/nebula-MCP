import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolError } from '../errors.js';
import { compact, isoNow } from '../format.js';
import { API_SOURCE } from '../version.js';

export interface MetaOptions {
  source?: string;
  notes: readonly string[];
  requests: number;
  truncated?: boolean;
  extra?: Record<string, unknown>;
}

/** Wrap compact JSON in a single text content block. */
export function success(
  data: Record<string, unknown>,
  meta: MetaOptions,
  now: () => Date,
): CallToolResult {
  const payload = {
    ok: true as const,
    data,
    meta: compact({
      source: meta.source ?? API_SOURCE,
      fetched_at: isoNow(now),
      requests: meta.requests,
      ...meta.extra,
      truncated: meta.truncated === true ? true : undefined,
      notes: meta.notes,
    }),
  };
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

/** Turn any thrown value into a bounded, key-free error envelope. */
export function failure(error: unknown): CallToolResult {
  const toolError =
    error instanceof ToolError
      ? error
      : new ToolError('UPSTREAM_ERROR', 'The Nebula API request could not be completed.', {
          hint: 'Retry once; if the failure persists the upstream service or the network path is unavailable.',
        });
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(toolError.toEnvelope()) }],
  };
}
