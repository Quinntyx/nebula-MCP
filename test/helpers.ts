import type { FetchLike, FetchResponseLike } from '../src/client/http.js';

export interface FetchCall {
  url: string;
  init: Parameters<FetchLike>[1];
}

export interface FakeFetch {
  fetch: FetchLike;
  calls: FetchCall[];
}

/** Wrap a handler so tests can inspect every upstream call that was made. */
export function fakeFetch(handler: (url: string, init: Parameters<FetchLike>[1]) => Promise<FetchResponseLike>): FakeFetch {
  const calls: FetchCall[] = [];
  return {
    calls,
    fetch: (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    },
  };
}

export interface EnvelopeOptions {
  status?: number | string;
  message?: string;
  headers?: Record<string, string>;
  /** HTTP transport status; defaults to 200. */
  httpStatus?: number;
}

/** A successful Nebula envelope response. */
export function envelope(data: unknown, options: EnvelopeOptions = {}): FetchResponseLike {
  return jsonResponse({ status: options.status ?? 200, message: options.message ?? 'success', data }, options);
}

export function jsonResponse(body: unknown, options: EnvelopeOptions = {}): FetchResponseLike {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const response = new Response(text, {
    status: options.httpStatus ?? 200,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  return response as unknown as FetchResponseLike;
}

export function emptyResponse(httpStatus: number, headers: Record<string, string> = {}): FetchResponseLike {
  return {
    status: httpStatus,
    headers: new Headers(headers),
    body: null,
  };
}

/** A streaming body that emits the given chunks, used to test byte bounds. */
export function streamingResponse(
  chunks: string[],
  options: { httpStatus?: number; headers?: Record<string, string> } = {},
): FetchResponseLike {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  const response = new Response(stream, {
    status: options.httpStatus ?? 200,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  return response as unknown as FetchResponseLike;
}

/** A response whose body hangs until the request signal aborts. */
export function hangingResponse(init: Parameters<FetchLike>[1]): Promise<FetchResponseLike> {
  return new Promise((_resolve, reject) => {
    init.signal.addEventListener(
      'abort',
      () => reject(new DOMException('aborted', 'AbortError')),
      { once: true },
    );
  });
}

/** Parse a ToolError-shaped result body from a tool handler. */
export function errorOf(result: { isError?: boolean; content: Array<{ text: string }> }): {
  code: string;
  message: string;
  details?: Record<string, unknown>;
} {
  if (result.isError !== true) throw new Error('expected an error result');
  const text = result.content[0]?.text;
  if (text === undefined) throw new Error('expected error content');
  return JSON.parse(text) as { code: string; message: string; details?: Record<string, unknown> };
}
