import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildApiUrl,
  DEFAULT_MAX_RESPONSE_BYTES,
  NebulaClient,
  type NebulaClientOptions,
} from '../src/client/http.js';
import { ToolError } from '../src/errors.js';
import { API_ORIGIN } from '../src/version.js';
import {
  emptyResponse,
  envelope,
  fakeFetch,
  hangingResponse,
  jsonResponse,
  streamingResponse,
} from './helpers.js';

const KEY = 'test-key-value';

function makeClient(handler: Parameters<typeof fakeFetch>[0], options: Partial<NebulaClientOptions> = {}) {
  const fake = fakeFetch(handler);
  const client = new NebulaClient({ apiKey: KEY, fetch: fake.fetch, ...options });
  return { client, fake };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<ToolError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ToolError, `expected ToolError, got ${String(error)}`);
    assert.equal(error.code, code);
    return error;
  }
  throw new Error(`expected rejection with ${code}`);
}

test('sends one GET to the fixed origin with the key in a header only', async () => {
  const { client, fake } = makeClient(async () => envelope({ ok: true }));
  const result = await client.get('/course', { subject_prefix: 'CS', course_number: '1336', _page: '1' });

  assert.deepEqual(result, { data: { ok: true }, requests: 1 });
  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0]!;
  const url = new URL(call.url);
  assert.equal(url.origin, API_ORIGIN);
  assert.equal(url.pathname, '/course');
  assert.equal(url.searchParams.get('subject_prefix'), 'CS');
  assert.equal(url.searchParams.get('course_number'), '1336');
  assert.equal(url.searchParams.get('_page'), '1');
  assert.equal(call.init.method, 'GET');
  assert.equal(call.init.redirect, 'manual');
  assert.equal(call.init.headers['x-api-key'], KEY);
  assert.ok(!call.url.includes(KEY), 'the key must never appear in the URL');
});

test('refuses to call upstream when the key is missing', async () => {
  const fake = fakeFetch(async () => envelope({ ok: true }));
  const client = new NebulaClient({ apiKey: undefined, fetch: fake.fetch });
  const error = await expectCode(client.get('/course'), 'AUTH_MISSING');
  assert.equal(fake.calls.length, 0);
  assert.match(String(error.hint), /NEBULA_API_KEY/);
});

test('maps 401/403 to AUTH_REJECTED without retrying or echoing the key', async () => {
  const { client, fake } = makeClient(async () => emptyResponse(401));
  const error = await expectCode(client.get('/course'), 'AUTH_REJECTED');
  assert.equal(fake.calls.length, 1);
  assert.ok(!JSON.stringify(error.toEnvelope()).includes(KEY));
});

test('maps 404 to NOT_FOUND', async () => {
  const { client } = makeClient(async () => emptyResponse(404));
  await expectCode(client.get('/course'), 'NOT_FOUND');
});

test('does not follow redirects and never requests the target', async () => {
  const { client, fake } = makeClient(async () =>
    emptyResponse(302, { location: 'https://example.invalid/steal' }),
  );
  const error = await expectCode(client.get('/course'), 'UPSTREAM_ERROR');
  assert.equal(fake.calls.length, 1);
  assert.equal(error.upstreamStatus, 302);
});

test('retries one time on 429 and honors a short Retry-After', async () => {
  let attempts = 0;
  const { client, fake } = makeClient(async () => {
    attempts++;
    if (attempts === 1) return emptyResponse(429, { 'retry-after': '0' });
    return envelope({ ok: true });
  });
  const result = await client.get('/course');
  assert.equal(result.requests, 2);
  assert.equal(fake.calls.length, 2);
  assert.deepEqual(result.data, { ok: true });
});

test('gives up after a single retry on 503', async () => {
  const { client, fake } = makeClient(async () => emptyResponse(503));
  const error = await expectCode(client.get('/course'), 'UPSTREAM_ERROR');
  assert.equal(error.retryable, true);
  assert.equal(fake.calls.length, 2);
});

test('does not hold the request open for a long Retry-After', async () => {
  const { client, fake } = makeClient(async () => emptyResponse(429, { 'retry-after': '120' }));
  await expectCode(client.get('/course'), 'RATE_LIMITED');
  assert.equal(fake.calls.length, 1);
});

test('maps 500 to a non-retryable upstream error', async () => {
  const { client, fake } = makeClient(async () => emptyResponse(500));
  const error = await expectCode(client.get('/course'), 'UPSTREAM_ERROR');
  assert.equal(error.retryable, false);
  assert.equal(fake.calls.length, 1);
});

test('rejects declared bodies larger than the limit', async () => {
  const { client } = makeClient(
    async () => jsonResponse({ status: 200, data: {} }, { headers: { 'content-length': '99999999' } }),
    { maxResponseBytes: 256 },
  );
  await expectCode(client.get('/course'), 'RESPONSE_TOO_LARGE');
});

test('aborts streaming bodies that exceed the byte limit', async () => {
  const chunks = Array.from({ length: 64 }, () => 'x'.repeat(1024));
  const { client } = makeClient(async () => streamingResponse(chunks), { maxResponseBytes: 4096 });
  await expectCode(client.get('/course'), 'RESPONSE_TOO_LARGE');
});

test('accepts a streamed body under the limit', async () => {
  const body = JSON.stringify({ status: 200, message: 'success', data: { streamed: true } });
  const half = Math.floor(body.length / 2);
  const { client } = makeClient(async () => streamingResponse([body.slice(0, half), body.slice(half)]));
  const result = await client.get('/course');
  assert.deepEqual(result.data, { streamed: true });
});

test('reports malformed JSON as an upstream schema error', async () => {
  const { client } = makeClient(async () => jsonResponse('not json at all'));
  await expectCode(client.get('/course'), 'UPSTREAM_SCHEMA');
});

test('reports an envelope without data as an upstream schema error', async () => {
  const { client } = makeClient(async () => jsonResponse({ status: 200, message: 'success' }));
  await expectCode(client.get('/course'), 'UPSTREAM_SCHEMA');
});

test('fails a 2xx transport whose envelope status is an error', async () => {
  const { client, fake } = makeClient(async () => jsonResponse({ status: 500, message: 'boom', data: null }));
  const error = await expectCode(client.get('/course'), 'UPSTREAM_ERROR');
  assert.equal(error.upstreamStatus, 500);
  assert.equal(fake.calls.length, 1);
});

test('times out a hanging request and reports UPSTREAM_TIMEOUT', async () => {
  const { client } = makeClient(async (_url, init) => hangingResponse(init), { attemptTimeoutMs: 25 });
  const error = await expectCode(client.get('/course'), 'UPSTREAM_TIMEOUT');
  assert.equal(error.retryable, true);
});

test('honors caller cancellation', async () => {
  const controller = new AbortController();
  const { client } = makeClient(async (_url, init) => {
    setTimeout(() => controller.abort(), 10);
    return hangingResponse(init);
  });
  await expectCode(client.get('/course', undefined, { signal: controller.signal }), 'CANCELLED');
});

test('does not start a retry after the total budget is exhausted', async () => {
  const { client } = makeClient(async () => emptyResponse(429, { 'retry-after': '1' }), {
    totalTimeoutMs: 100,
  });
  const error = await expectCode(client.get('/course'), 'UPSTREAM_TIMEOUT');
  assert.equal(error.retryable, true);
});

test('caps request work at two attempts inside the total budget', async () => {
  let attempts = 0;
  const { client, fake } = makeClient(async () => {
    attempts++;
    return emptyResponse(502);
  });
  await expectCode(client.get('/course'), 'UPSTREAM_ERROR');
  assert.equal(attempts, 2);
  assert.equal(fake.calls.length, 2);
});

test('rejects paths that could leave the fixed API surface', () => {
  assert.throws(() => buildApiUrl('https://evil.example/course'));
  assert.throws(() => buildApiUrl('//evil.example/course'));
  assert.throws(() => buildApiUrl('/course/../students'));
  assert.throws(() => buildApiUrl('/course?x=1'));
  assert.throws(() => buildApiUrl('/course#frag'));
  assert.throws(() => buildApiUrl('/course%2F..%2Fstudents'));
  assert.throws(() => buildApiUrl('/course%2e%2e/students'));
  assert.throws(() => buildApiUrl('/course\u0000'));
  assert.throws(() => buildApiUrl('/course\\..\\students'));
});

test('exposes a sane default byte ceiling', () => {
  assert.equal(DEFAULT_MAX_RESPONSE_BYTES, 2 * 1024 * 1024);
});
