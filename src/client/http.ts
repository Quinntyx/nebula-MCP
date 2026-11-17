import { ToolError, upstreamSchema } from '../errors.js';
import { API_ORIGIN } from '../version.js';

/** Minimal structural view of an HTTP response, so tests inject a fake fetch. */
export interface FetchHeadersLike {
  get(name: string): string | null;
}

export interface FetchReaderLike {
  read(): Promise<{ done: boolean; value?: Uint8Array | undefined }>;
  cancel(reason?: unknown): Promise<void>;
}

export interface FetchBodyLike {
  getReader(): FetchReaderLike;
}

export interface FetchResponseLike {
  status: number;
  headers: FetchHeadersLike;
  body: FetchBodyLike | null;
}

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    redirect: 'manual';
    signal: AbortSignal;
  },
) => Promise<FetchResponseLike>;

export interface NebulaClientOptions {
  apiKey: string | undefined;
  fetch?: FetchLike;
  /** Per-attempt ceiling. Default 10s. */
  attemptTimeoutMs?: number;
  /** Whole-call ceiling across attempts. Default 20s. */
  totalTimeoutMs?: number;
  /** Hard byte ceiling for a response body. Default 2 MiB. */
  maxResponseBytes?: number;
  /** Longest Retry-After wait we are willing to honor. Default 2s. */
  retryAfterCapMs?: number;
}

export interface GetResult {
  data: unknown;
  /** Number of HTTP attempts to the upstream API (0 when the key is missing). */
  requests: number;
}

export const DEFAULT_ATTEMPT_TIMEOUT_MS = 10_000;
export const DEFAULT_TOTAL_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_RETRY_AFTER_CAP_MS = 2_000;

const PATH_RE = /^\/[A-Za-z0-9\-.~%/:]*$/;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

/**
 * Reject anything that could escape or confuse the allowlisted route surface:
 * absolute URLs, relative segments, query strings, fragments, backslashes, and
 * malformed percent escapes.
 */
export function assertApiPath(path: string): void {
  const safe =
    PATH_RE.test(path) &&
    !path.includes('//') &&
    !path.split('/').some((segment) => segment === '..' || segment === '.') &&
    !/%(?![0-9A-Fa-f]{2})/.test(path) &&
    // Escaped separators, dots, and NULs would only ever come from an argument
    // that tried to smuggle a path segment through our builders.
    !/%(2f|5c|2e|00)/i.test(path);
  if (!safe) {
    throw new ToolError('UPSTREAM_ERROR', 'Refused to build an unsafe upstream request path.');
  }
}

/** Build a URL on the fixed API origin. No caller-supplied base URL exists. */
export function buildApiUrl(path: string, query?: Record<string, string>): URL {
  assertApiPath(path);
  const url = new URL(path, API_ORIGIN);
  if (url.origin !== API_ORIGIN) {
    throw new ToolError('UPSTREAM_ERROR', 'Refused to build an upstream request outside the Nebula API origin.');
  }
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  if (url.origin !== API_ORIGIN) {
    throw new ToolError('UPSTREAM_ERROR', 'Refused to build an upstream request outside the Nebula API origin.');
  }
  return url;
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) return undefined;
  return Math.max(0, timestamp - Date.now());
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new Error('aborted'));
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

interface BudgetSignals {
  external: AbortSignal | undefined;
  total: AbortSignal;
  attempt: AbortSignal;
}

function abortedError(signals: BudgetSignals): ToolError {
  if (signals.external?.aborted === true) {
    return new ToolError('CANCELLED', 'The request was cancelled before it completed.');
  }
  if (signals.total.aborted || signals.attempt.aborted) {
    return new ToolError('UPSTREAM_TIMEOUT', 'The Nebula API did not respond within the time budget.', {
      retryable: true,
    });
  }
  return new ToolError('UPSTREAM_ERROR', 'The Nebula API request failed before a response was received.', {
    retryable: true,
  });
}

export class NebulaClient {
  readonly #apiKey: string | undefined;
  readonly #fetch: FetchLike;
  readonly #attemptTimeoutMs: number;
  readonly #totalTimeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #retryAfterCapMs: number;

  constructor(options: NebulaClientOptions) {
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.#attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
    this.#totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
    this.#maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.#retryAfterCapMs = options.retryAfterCapMs ?? DEFAULT_RETRY_AFTER_CAP_MS;
  }

  get hasKey(): boolean {
    return this.#apiKey !== undefined;
  }

  /**
   * GET an allowlisted API path and return the `data` member of the Nebula
   * envelope. The key is only sent in the `x-api-key` header, redirects are not
   * followed, and only one retry is attempted for 429/502/503/504.
   */
  async get(path: string, query?: Record<string, string>, options: { signal?: AbortSignal } = {}): Promise<GetResult> {
    // A missing key must not touch the network at all.
    if (this.#apiKey === undefined) {
      throw new ToolError('AUTH_MISSING', 'NEBULA_API_KEY is not configured, so Nebula API calls are unavailable.', {
        hint: 'Set NEBULA_API_KEY in the MCP server environment. Tool discovery works without it.',
      });
    }

    const url = buildApiUrl(path, query);
    const deadline = Date.now() + this.#totalTimeoutMs;
    const totalSignal = AbortSignal.timeout(this.#totalTimeoutMs);
    let requests = 0;

    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new ToolError('UPSTREAM_TIMEOUT', 'The Nebula API request exceeded its total time budget.', {
          retryable: true,
        });
      }

      const attemptSignal = AbortSignal.timeout(Math.min(this.#attemptTimeoutMs, remaining));
      const budget: BudgetSignals = { external: options.signal, total: totalSignal, attempt: attemptSignal };
      const signals = options.signal
        ? [options.signal, attemptSignal, totalSignal]
        : [attemptSignal, totalSignal];
      const signal = AbortSignal.any(signals);
      requests++;

      let response: FetchResponseLike;
      try {
        response = await this.#fetch(url.toString(), {
          method: 'GET',
          headers: { accept: 'application/json', 'x-api-key': this.#apiKey },
          redirect: 'manual',
          signal,
        });
      } catch {
        throw abortedError(budget);
      }

      const status = response.status;

      if (status >= 300 && status < 400) {
        await cancelBody(response);
        throw new ToolError('UPSTREAM_ERROR', 'The Nebula API returned a redirect, which this server does not follow.', {
          upstreamStatus: status,
        });
      }

      if (RETRYABLE_STATUSES.has(status)) {
        await cancelBody(response);
        const error = mapStatus(status);
        if (attempt === 0) {
          const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
          if (retryAfterMs !== undefined && retryAfterMs > this.#retryAfterCapMs) {
            throw new ToolError(error.code, error.message, {
              retryable: true,
              upstreamStatus: status,
              hint: 'The upstream service asked for a longer wait than this server will hold a request open; retry later.',
            });
          }
          try {
            await abortableSleep(retryAfterMs ?? 250, signal);
          } catch {
            throw abortedError(budget);
          }
          continue;
        }
        throw new ToolError(error.code, error.message, { retryable: true, upstreamStatus: status });
      }

      if (status < 200 || status >= 300) {
        await cancelBody(response);
        throw mapStatus(status);
      }

      const text = await this.#readBounded(response, budget);
      return { data: this.#parseEnvelope(text), requests };
    }

    throw new ToolError('UPSTREAM_ERROR', 'The Nebula API request failed after a retry.', { retryable: true });
  }

  async #readBounded(response: FetchResponseLike, budget: BudgetSignals): Promise<string> {
    const declared = response.headers.get('content-length');
    if (declared !== null && /^\d+$/.test(declared) && Number(declared) > this.#maxResponseBytes) {
      await cancelBody(response);
      throw responseTooLarge(this.#maxResponseBytes);
    }

    const body = response.body;
    if (body === null) return '';

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = '';

    try {
      for (;;) {
        if (budget.external?.aborted === true || budget.total.aborted || budget.attempt.aborted) {
          await reader.cancel().catch(() => undefined);
          throw abortedError(budget);
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (value === undefined) continue;
        bytes += value.byteLength;
        if (bytes > this.#maxResponseBytes) {
          await reader.cancel().catch(() => undefined);
          throw responseTooLarge(this.#maxResponseBytes);
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      return text;
    } catch (error) {
      if (error instanceof ToolError) throw error;
      await reader.cancel().catch(() => undefined);
      throw abortedError(budget);
    }
  }

  #parseEnvelope(text: string): unknown {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw upstreamSchema('The Nebula API returned a body that is not valid JSON.');
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw upstreamSchema('The Nebula API response envelope was not an object.');
    }

    const envelope = parsed as Record<string, unknown>;
    if (!('data' in envelope) || typeof envelope.status !== 'number') {
      throw upstreamSchema('The Nebula API response envelope was missing its status or data member.');
    }

    if (envelope.status >= 400) {
      // A 2xx transport carrying an error envelope still fails the call.
      throw mapStatus(envelope.status);
    }

    return envelope.data;
  }
}

async function cancelBody(response: FetchResponseLike): Promise<void> {
  const body = response.body;
  if (body === null) return;
  try {
    await body.getReader().cancel();
  } catch {
    // Cancelling a drained stream is not an error worth surfacing.
  }
}

function responseTooLarge(maxBytes: number): ToolError {
  return new ToolError(
    'RESPONSE_TOO_LARGE',
    `The Nebula API response exceeded the ${Math.floor(maxBytes / 1024)} KiB limit for this server.`,
    { hint: 'Narrow the query (for example a shorter term range or a more specific filter) and retry.' },
  );
}

function mapStatus(status: number): ToolError {
  if (status === 401 || status === 403) {
    return new ToolError('AUTH_REJECTED', 'The Nebula API rejected the configured API key.', {
      upstreamStatus: status,
      hint: 'Check that NEBULA_API_KEY is current and authorized for the public Nebula API.',
    });
  }
  if (status === 404) {
    return new ToolError('NOT_FOUND', 'The Nebula API has no record matching this request.', {
      upstreamStatus: status,
    });
  }
  if (status === 429) {
    return new ToolError('RATE_LIMITED', 'The Nebula API rate limit was reached.', {
      upstreamStatus: status,
      retryable: true,
      hint: 'Wait briefly before retrying.',
    });
  }
  if (status === 502 || status === 503 || status === 504) {
    return new ToolError('UPSTREAM_ERROR', 'The Nebula API is temporarily unavailable.', {
      upstreamStatus: status,
      retryable: true,
    });
  }
  return new ToolError('UPSTREAM_ERROR', 'The Nebula API request failed.', {
    upstreamStatus: status,
    retryable: false,
  });
}
