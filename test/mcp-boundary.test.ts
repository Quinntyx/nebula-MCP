import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from '../src/server.js';
import { protectResult, success, failure } from '../src/tools/result.js';
import { HARD_RESULT_BYTES, jsonBytes } from '../src/domain/budget.js';
import { ToolError } from '../src/errors.js';
import { course, ID_A } from './fixtures.js';
import { envelope, fakeFetch } from './helpers.js';

function payload(result: CallToolResult): Record<string, unknown> {
  assert.equal(result.content.length, 1);
  const text = result.content[0];
  assert.ok(text?.type === 'text');
  assert.ok(jsonBytes(result) <= HARD_RESULT_BYTES, 'complete MCP result stays bounded');
  return JSON.parse(text.text) as Record<string, unknown>;
}

test('official MCP client sees strict compact schemas and bounded invalid-argument errors', async () => {
  const transport = fakeFetch(async () => envelope(null));
  const server = createServer({ apiKey: undefined, toolsets: ['academics', 'clubs', 'events'] }, { fetch: transport.fetch });
  const client = new Client({ name: 'boundary-test', version: '0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 11);
    for (const tool of listed.tools) {
      assert.equal(tool.inputSchema.additionalProperties, false);
      assert.ok(tool.description && tool.description.length <= 160, tool.name);
    }
    assert.ok(jsonBytes(listed) < 18_000, 'entire optional tool catalog remains compact');
    const gradeSchema = listed.tools.find((tool) => tool.name === 'grades_get')!;
    assert.deepEqual((gradeSchema.inputSchema.properties?.['by'] as { enum: string[] }).enum, ['overall', 'term', 'term_section_type']);
    for (const [name, args] of [
      ['grades_get', { subject_prefix: 'CS', by: 'sensitive'.repeat(3000) }],
      ['course_search', { subject_prefix: { secret: 'sensitive'.repeat(3000) } }],
      ['course_search', { subject_prefix: 'CS', 'x-api-key: sensitive': 'sensitive' }],
      ['course_search', { subject_prefix: 'CS', limit: -1 }],
    ] as const) {
      const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));
      assert.equal(result.isError, true);
      const body = payload(result);
      assert.equal((body['error'] as { code: string }).code, 'INVALID_ARGUMENT');
      assert.equal(JSON.stringify(result).includes('sensitive'), false);
    }
    assert.equal(transport.calls.length, 0);
  } finally {
    await client.close();
    await server.close();
  }
});

test('runtime key and reflected credentials are redacted at the MCP response boundary', async () => {
  const key = 'synthetic-runtime-secret';
  const server = createServer({ apiKey: key, toolsets: ['academics'] }, {
    fetch: async () => envelope(course({ title: `${key} x-api-key: header-secret Authorization: Bearer bearer-secret https://user:password@example.edu` })),
  });
  const client = new Client({ name: 'redaction-test', version: '0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = CallToolResultSchema.parse(await client.callTool({ name: 'course_get', arguments: { course_id: ID_A } }));
    assert.equal(result.isError, undefined);
    assert.equal(payload(result)['ok'], true);
    const text = JSON.stringify(result);
    for (const secret of [key, 'header-secret', 'bearer-secret', 'user:password']) assert.equal(text.includes(secret), false, secret);
    assert.ok(text.includes('[redacted]'));
  } finally {
    await client.close();
    await server.close();
  }
});

test('redaction preserves JSON when runtime secrets contain quotes and backslashes', () => {
  const secret = 'synthetic-"key\\with-quotes';
  const result = protectResult(success({ title: secret }, { requests: 1, notes: [] }, () => new Date(0)), [secret]);
  assert.deepEqual(payload(result)['data'], { title: '[redacted]' });
});

test('complete success metadata and error messages obey the UTF-8 hard limit', () => {
  const oversizedMeta = success({ items: [] }, { requests: 1, notes: ['界'.repeat(8000)] }, () => new Date(0));
  assert.equal(oversizedMeta.isError, true);
  assert.equal((payload(oversizedMeta)['error'] as { code: string }).code, 'RESPONSE_TOO_LARGE');
  const oversizedError = failure(new ToolError('INVALID_ARGUMENT', '界'.repeat(8000)));
  assert.equal((payload(oversizedError)['error'] as { code: string }).code, 'RESPONSE_TOO_LARGE');
});
