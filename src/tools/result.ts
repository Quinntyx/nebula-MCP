import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolError, redactSecrets } from '../errors.js';
import { HARD_RESULT_BYTES, jsonBytes } from '../domain/budget.js';
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
  return protectResult({ content: [{ type: 'text', text: JSON.stringify(payload) }] }, []);
}

/** Turn any thrown value into a bounded, key-free error envelope. */
export function failure(error: unknown): CallToolResult {
  const toolError =
    error instanceof ToolError
      ? error
      : new ToolError('UPSTREAM_ERROR', 'The Nebula API request could not be completed.', {
          hint: 'Retry once; if the failure persists the upstream service or the network path is unavailable.',
        });
  return protectResult({
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(toolError.toEnvelope()) }],
  }, []);
}

/**
 * Final safety boundary: redact string values before JSON serialization (never
 * regex-rewrite serialized JSON, which could corrupt quotes), then budget the
 * complete MCP result, including metadata, error text, and escaping overhead.
 */
export function protectResult(result: CallToolResult, secrets: readonly string[]): CallToolResult {
  const cleanValue = (value: unknown): unknown => {
    if (typeof value === 'string') return redactSecrets(value, secrets);
    if (Array.isArray(value)) return value.map(cleanValue);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, cleanValue(member)]));
    }
    return value;
  };
  let payload: unknown;
  try {
    const block = result.content[0];
    if (result.content.length !== 1 || block?.type !== 'text') throw new Error('invalid tool output');
    payload = cleanValue(JSON.parse(block.text));
  } catch {
    payload = new ToolError('UPSTREAM_ERROR', 'The tool could not produce a safe JSON response.').toEnvelope();
    result = { isError: true, content: [] };
  }
  const clean: CallToolResult = {
    ...(result.isError === true ? { isError: true } : {}),
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
  if (jsonBytes(clean) <= HARD_RESULT_BYTES) return clean;
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(new ToolError(
      'RESPONSE_TOO_LARGE',
      'The complete response exceeds the output budget; no partial result was returned.',
      { hint: 'Narrow the query or reduce the limit.' },
    ).toEnvelope()) }],
  };
}
