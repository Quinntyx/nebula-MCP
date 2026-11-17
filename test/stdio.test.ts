import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const ENTRY = fileURLToPath(new URL('../src/index.js', import.meta.url));

interface Pending {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

/** Minimal newline-delimited JSON-RPC client over a real stdio subprocess. */
class StdioClient {
  #child: ChildProcessWithoutNullStreams;
  #buffer = '';
  #pending = new Map<number, Pending>();
  #nextId = 1;
  stderr = '';

  constructor(env: Record<string, string | undefined>) {
    const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
    if (env['NEBULA_API_KEY'] === undefined) delete childEnv['NEBULA_API_KEY'];
    if (env['NEBULA_MCP_TOOLSETS'] === undefined) delete childEnv['NEBULA_MCP_TOOLSETS'];
    this.#child = spawn(process.execPath, [ENTRY], { env: childEnv, stdio: 'pipe' });
    this.#child.stdout.setEncoding('utf8');
    this.#child.stdout.on('data', (chunk: string) => this.#onData(chunk));
    this.#child.stderr.setEncoding('utf8');
    this.#child.stderr.on('data', (chunk: string) => {
      this.stderr += chunk;
    });
  }

  #onData(chunk: string): void {
    this.#buffer += chunk;
    let index = this.#buffer.indexOf('\n');
    while (index !== -1) {
      const line = this.#buffer.slice(0, index).trim();
      this.#buffer = this.#buffer.slice(index + 1);
      if (line.length > 0) this.#handle(line);
      index = this.#buffer.indexOf('\n');
    }
  }

  #handle(line: string): void {
    const message = JSON.parse(line) as { id?: number; result?: Record<string, unknown>; error?: { message: string } };
    if (message.id === undefined) return; // server-initiated notification
    const pending = this.#pending.get(message.id);
    if (pending === undefined) return;
    this.#pending.delete(message.id);
    if (message.error !== undefined) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result ?? {});
  }

  request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = this.#nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 10_000).unref();
    });
    this.#child.stdin.write(`${payload}\n`);
    return promise;
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.#child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async initialize(): Promise<Record<string, unknown>> {
    const result = await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'stdio-test', version: '0.0.0' },
    });
    this.notify('notifications/initialized', {});
    return result;
  }

  close(): void {
    this.#child.stdin.end();
    this.#child.kill('SIGTERM');
  }
}

const clients: StdioClient[] = [];
function startClient(env: Record<string, string | undefined>): StdioClient {
  const client = new StdioClient(env);
  clients.push(client);
  return client;
}

after(() => {
  for (const client of clients) client.close();
});

interface ToolList {
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
}

test('stdio server initializes, lists the default catalog, and rejects calls without a key', async () => {
  const client = startClient({});
  const init = await client.initialize();

  assert.equal((init['serverInfo'] as Record<string, unknown>)['name'], 'utd-nebula');
  assert.equal((init['protocolVersion'] as string).length > 0, true);
  assert.ok(String(init['instructions']).includes('NEBULA_API_KEY'));

  const listed = (await client.request('tools/list', {})) as unknown as ToolList;
  const names = listed.tools.map((tool) => tool.name).sort();
  assert.equal(names.length, 10);
  assert.deepEqual(names, [
    'academic_calendar_get',
    'club_get',
    'club_search',
    'course_get',
    'course_search',
    'grades_get',
    'professor_get',
    'professor_search',
    'section_get',
    'section_search',
  ]);
  for (const tool of listed.tools) {
    assert.equal((tool.inputSchema as Record<string, unknown>)['type'], 'object');
    assert.ok(tool.description.length > 0);
  }

  const called = (await client.request('tools/call', {
    name: 'course_search',
    arguments: { subject_prefix: 'CS' },
  })) as unknown as { isError?: boolean; content: Array<{ type: string; text: string }> };
  assert.equal(called.isError, true);
  assert.equal(called.content.length, 1);
  const envelope = JSON.parse(called.content[0]!.text) as {
    ok: boolean;
    error: { code: string; message: string };
  };
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, 'AUTH_MISSING');

  // Startup diagnostics go to stderr and must never leak a key value.
  assert.ok(client.stderr.includes('NEBULA_API_KEY is not set'));
  assert.equal(client.stderr.includes('x-api-key'), false);
});

test('stdio server honours the toolset environment variable', async () => {
  const client = startClient({ NEBULA_MCP_TOOLSETS: 'events' });
  await client.initialize();

  const listed = (await client.request('tools/list', {})) as unknown as ToolList;
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    ['campus_events_on_date'],
  );
});

test('stdio server reports invalid toolset configuration on stderr and exits', async () => {
  const child = spawn(process.execPath, [ENTRY], {
    env: { ...process.env, NEBULA_MCP_TOOLSETS: 'academics,bogus' },
    stdio: 'pipe',
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
  assert.equal(code, 2);
  assert.ok(stderr.includes('NEBULA_MCP_TOOLSETS'));
  assert.ok(stderr.includes('academics'));
});
