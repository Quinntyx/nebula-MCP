import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NebulaClient } from '../src/client/http.js';
import { NebulaRepository } from '../src/upstream/repository.js';
import { courseGetTool } from '../src/tools/course-get.js';
import { courseSearchTool } from '../src/tools/course-search.js';
import { professorSearchTool } from '../src/tools/professor-search.js';
import { gradesGetTool } from '../src/tools/grades-get.js';
import { sectionSearchTool } from '../src/tools/section-search.js';
import { clubSearchTool } from '../src/tools/club-search.js';
import { clubGetTool } from '../src/tools/club-get.js';
import { ID_A } from './fixtures.js';
import { envelope, emptyResponse, fakeFetch } from './helpers.js';
import { invoke } from './toolkit.js';

for (const [tool, args] of [
  [courseSearchTool, { subject_prefix: 'CS' }],
  [professorSearchTool, { last_name: 'Synthetic' }],
  [sectionSearchTool, { subject_prefix: 'CS', course_number: '1336' }],
  [sectionSearchTool, { first_name: 'Ada', last_name: 'Synthetic' }],
  [sectionSearchTool, { subject_prefix: 'CS', course_number: '1336', first_name: 'Ada', last_name: 'Synthetic' }],
  [gradesGetTool, { subject_prefix: 'CS', by: 'term' }],
  [gradesGetTool, { subject_prefix: 'CS', by: 'term_section_type' }],
] as const) {
  test(`${tool.name} normalizes a documented null list to an exhausted page (${JSON.stringify(args)})`, async () => {
    const transport = fakeFetch(async () => envelope(null));
    const result = await invoke(tool, args, transport.fetch);
    assert.equal(result.payload.ok, true);
    assert.equal(result.payload.data?.['returned'], 0);
    assert.equal(result.payload.data?.['has_more'], false);
    assert.equal(result.payload.data?.['next_cursor'], undefined);
    assert.equal(transport.calls.length, 1);
  });
}

test('section instructor null is an empty list but null course detail stays a schema error', async () => {
  const repo = new NebulaRepository(new NebulaClient({ apiKey: 'synthetic-key', fetch: async () => envelope(null) }));
  assert.deepEqual((await repo.sectionProfessors(ID_A, {})).value, []);
  const detail = await invoke(courseGetTool, { course_id: ID_A }, async () => envelope(null));
  assert.equal(detail.payload.error?.code, 'UPSTREAM_SCHEMA');
});

test('club search 404 is empty while club detail 404 remains NOT_FOUND', async () => {
  const search = await invoke(clubSearchTool, { query: 'nonexistent' }, async () => emptyResponse(404));
  assert.equal(search.payload.ok, true);
  assert.equal(search.payload.data?.['returned'], 0);
  assert.equal(search.payload.data?.['has_more'], false);
  assert.equal(search.payload.meta?.['requests'], 1);
  const detail = await invoke(clubGetTool, { club_id: '4242' }, async () => emptyResponse(404));
  assert.equal(detail.payload.error?.code, 'NOT_FOUND');
  const forbidden = await invoke(clubSearchTool, { query: 'nonexistent' }, async () => emptyResponse(403));
  assert.equal(forbidden.payload.error?.code, 'AUTH_REJECTED');
});

test('whitespace-only exact filters are rejected without an unscoped request', async () => {
  const transport = fakeFetch(async () => envelope([]));
  for (const [tool, args] of [
    [professorSearchTool, { first_name: '  ' }],
    [courseSearchTool, { subject_prefix: '  ' }],
    [gradesGetTool, { first_name: '  ' }],
    [sectionSearchTool, { subject_prefix: 'CS', course_number: '  ' }],
  ] as const) {
    const result = await invoke(tool, args, transport.fetch);
    assert.equal(result.payload.error?.code, 'INVALID_ARGUMENT');
  }
  assert.equal(transport.calls.length, 0);
});

test('validation never echoes unknown argument names or values', async () => {
  const result = await invoke(courseSearchTool, { subject_prefix: 'CS', 'x-api-key: synthetic-reflected-key': 'secret' }, async () => envelope([]));
  assert.equal(result.payload.error?.code, 'INVALID_ARGUMENT');
  assert.equal(result.text.includes('synthetic-reflected-key'), false);
});
