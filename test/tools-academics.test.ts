import assert from 'node:assert/strict';
import { test } from 'node:test';
import { courseGetTool } from '../src/tools/course-get.js';
import { courseSearchTool } from '../src/tools/course-search.js';
import { professorGetTool } from '../src/tools/professor-get.js';
import { professorSearchTool } from '../src/tools/professor-search.js';
import { sectionGetTool } from '../src/tools/section-get.js';
import { sectionSearchTool } from '../src/tools/section-search.js';
import { course, professor, section, ID_A, ID_B, ID_C } from './fixtures.js';
import { envelope, fakeFetch } from './helpers.js';
import { invoke, itemsOf, queryOf } from './toolkit.js';

test('course_search sends one exact-filter request and never a limit', async () => {
  const upstream = fakeFetch(async () => envelope([course(), course({ _id: ID_B, course_number: '1337' })]));
  const run = await invoke(courseSearchTool, { subject_prefix: 'cs' }, upstream.fetch);

  assert.equal(run.payload.ok, true);
  assert.equal(upstream.calls.length, 1);
  const url = new URL(upstream.calls[0]!.url);
  assert.equal(url.origin, 'https://api.utdnebula.com');
  assert.equal(url.pathname, '/course');
  assert.equal(url.searchParams.get('subject_prefix'), 'CS');
  assert.equal(url.searchParams.get('offset'), '0');
  assert.equal(url.searchParams.has('limit'), false);

  const items = itemsOf(run);
  assert.equal(items.length, 2);
  assert.equal(items[0]!['code'], 'CS 1336');
  assert.equal(run.payload.data!['returned'], 2);
  assert.equal(run.payload.data!['has_more'], null);
  assert.equal(typeof run.payload.data!['next_cursor'], 'string');
  assert.equal(run.payload.meta!['requests'], 1);
  assert.equal(run.payload.meta!['source'], 'api.utdnebula.com');
  assert.equal(run.payload.meta!['fetched_at'], '2026-11-16T12:00:00.000Z');
});

test('course_search pages with an opaque cursor that rebinds the exact filter', async () => {
  const upstream = fakeFetch(async () => envelope([course(), course({ _id: ID_B })]));
  const first = await invoke(courseSearchTool, { subject_prefix: 'CS', limit: 1 }, upstream.fetch);
  assert.equal(first.payload.data!['has_more'], true);
  assert.equal(first.payload.data!['returned'], 1);

  const cursor = first.payload.data!['next_cursor'];
  assert.equal(typeof cursor, 'string');

  const second = await invoke(
    courseSearchTool,
    { subject_prefix: 'CS', limit: 1, cursor },
    upstream.fetch,
  );
  assert.equal(queryOf(upstream.calls[1]!.url).get('offset'), '1');
  assert.equal(second.payload.ok, true);

  const rebound = await invoke(
    courseSearchTool,
    { subject_prefix: 'CS', course_number: '1336', limit: 1, cursor },
    upstream.fetch,
  );
  assert.equal(rebound.payload.ok, false);
  assert.equal(rebound.payload.code, 'INVALID_ARGUMENT');
  assert.equal(upstream.calls.length, 2, 'a rejected cursor must not reach the network');
});

test('course_search reports exact exhaustion only after an empty page', async () => {
  const upstream = fakeFetch(async () => envelope([]));
  const run = await invoke(courseSearchTool, { subject_prefix: 'CS' }, upstream.fetch);
  assert.equal(run.payload.data!['returned'], 0);
  assert.equal(run.payload.data!['has_more'], false);
  assert.equal(run.payload.data!['next_cursor'], undefined);
});

test('course_search rejects bounded-argument violations before the network', async () => {
  const upstream = fakeFetch(async () => envelope([course()]));
  const cases: unknown[] = [
    {},
    { subject_prefix: 'C*S' },
    { subject_prefix: 'CS', extra: 1 },
    { subject_prefix: 'CS', limit: 26 },
    { subject_prefix: 'CS', limit: 0 },
    { subject_prefix: 'X'.repeat(40) },
    { subject_prefix: 'CS', cursor: 'not-a-cursor' },
  ];
  for (const args of cases) {
    const run = await invoke(courseSearchTool, args, upstream.fetch);
    assert.equal(run.payload.ok, false, JSON.stringify(args));
    assert.equal(run.result.isError, true);
    assert.equal(run.payload.code, 'INVALID_ARGUMENT', JSON.stringify(args));
    assert.ok(run.text.length < 600, 'error envelopes stay small');
  }
  assert.equal(upstream.calls.length, 0);
});

test('course_get returns a mapped detail with a bounded requirement tree', async () => {
  const upstream = fakeFetch(async () =>
    envelope(
      course({
        prerequisites: {
          type: 'collection',
          name: 'Prerequisite courses',
          required: 1,
          options: [{ type: 'course', class_reference: 'CS 1335', minimum_grade: 'C' }],
        },
        sections: [ID_B, ID_C],
        description: 'd'.repeat(4000),
      }),
    ),
  );
  const run = await invoke(courseGetTool, { course_id: ID_A }, upstream.fetch);

  assert.equal(run.payload.ok, true);
  assert.equal(new URL(upstream.calls[0]!.url).pathname, `/course/${ID_A}`);
  const data = run.payload.data!;
  assert.equal(data['id'], ID_A);
  assert.equal(data['code'], 'CS 1336');
  assert.equal(data['section_count'], 2);
  assert.deepEqual(data['prerequisites'], {
    type: 'collection',
    name: 'Prerequisite courses',
    required: 1,
    options: [{ type: 'course', course: 'CS 1335', minimum_grade: 'C' }],
  });
  assert.ok(run.text.length <= 12_000);
});

test('course_get rejects ids that are not upstream ObjectIDs', async () => {
  const upstream = fakeFetch(async () => envelope(course()));
  for (const args of [{}, { course_id: 'CS 1336' }, { course_id: ID_A, extra: true }]) {
    const run = await invoke(courseGetTool, args, upstream.fetch);
    assert.equal(run.payload.code, 'INVALID_ARGUMENT');
  }
  assert.equal(upstream.calls.length, 0);
});

test('course_get maps an upstream 404 to a bounded NOT_FOUND', async () => {
  const upstream = fakeFetch(async () =>
    envelope(null, { status: 'error', message: 'course not found', httpStatus: 404 }),
  );
  const run = await invoke(courseGetTool, { course_id: ID_A }, upstream.fetch);
  assert.equal(run.payload.ok, false);
  assert.equal(run.payload.code, 'NOT_FOUND');
  assert.equal(run.result.isError, true);
});

test('professor_search requires a name and sends exact filters', async () => {
  const upstream = fakeFetch(async () => envelope([professor()]));
  const run = await invoke(professorSearchTool, { last_name: 'Lovelace' }, upstream.fetch);

  assert.equal(run.payload.ok, true);
  const url = new URL(upstream.calls[0]!.url);
  assert.equal(url.pathname, '/professor');
  assert.equal(url.searchParams.get('last_name'), 'Lovelace');
  assert.equal(url.searchParams.has('first_name'), false);
  assert.equal(url.searchParams.get('offset'), '0');
  const items = itemsOf(run);
  assert.equal(items[0]!['name'], 'Ada Lovelace');
  assert.equal(items[0]!['office'] !== undefined, true);

  const empty = await invoke(professorSearchTool, {}, upstream.fetch);
  assert.equal(empty.payload.code, 'INVALID_ARGUMENT');
});

test('professor_search does not title-case or retry with altered names', async () => {
  const upstream = fakeFetch(async () => envelope([]));
  await invoke(professorSearchTool, { first_name: 'ada', last_name: 'lovelace' }, upstream.fetch);
  assert.equal(upstream.calls.length, 1, 'exactly one attempt, no case retry');
  assert.equal(queryOf(upstream.calls[0]!.url).get('first_name'), 'ada');
});

test('professor_get returns contact details and bounded section references', async () => {
  const upstream = fakeFetch(async () => envelope(professor({ sections: Array.from({ length: 20 }, () => ID_C) })));
  const run = await invoke(professorGetTool, { professor_id: ID_B }, upstream.fetch);

  assert.equal(run.payload.ok, true);
  const data = run.payload.data!;
  assert.equal(data['name'], 'Ada Lovelace');
  assert.equal(data['section_count'], 20);
  assert.equal((data['section_ids'] as unknown[]).length, 8);
  assert.equal(data['email'], 'ada.lovelace@example.edu');
  assert.equal((data['office'] as Record<string, unknown>)['building'], 'ECSS');
});

test('section_search uses the course Trends route for an exact course pair', async () => {
  const upstream = fakeFetch(async () =>
    envelope([
      section(),
      section({ _id: ID_A, section_number: '002', course_details: [{ subject_prefix: 'CS', course_number: '1336' }] }),
    ]),
  );
  const run = await invoke(
    sectionSearchTool,
    { subject_prefix: 'cs', course_number: '1336' },
    upstream.fetch,
  );

  assert.equal(upstream.calls.length, 1);
  const url = new URL(upstream.calls[0]!.url);
  assert.equal(url.pathname, '/course/sections/trends');
  assert.equal(url.searchParams.get('subject_prefix'), 'CS');
  assert.equal(url.searchParams.get('course_number'), '1336');
  assert.equal(url.searchParams.has('offset'), false, 'Trends is not an offset route');

  const items = itemsOf(run);
  assert.equal(items.length, 2);
  assert.equal(items[0]!['course'], 'CS 1336');
  assert.equal(items[0]!['term'], '26F');
  assert.equal(run.payload.data!['has_more'], false);
  assert.deepEqual(run.payload.meta!['available_terms'], ['26F']);
});

test('section_search routes professor-only and combined queries correctly', async () => {
  const upstream = fakeFetch(async () => envelope([section()]));
  await invoke(sectionSearchTool, { first_name: 'Ada', last_name: 'Lovelace' }, upstream.fetch);
  assert.equal(new URL(upstream.calls[0]!.url).pathname, '/professor/sections/trends');

  await invoke(
    sectionSearchTool,
    { subject_prefix: 'CS', course_number: '1336', first_name: 'Ada', last_name: 'Lovelace' },
    upstream.fetch,
  );
  const combined = new URL(upstream.calls[1]!.url);
  assert.equal(combined.pathname, '/combined/sections/trends');
  assert.equal(combined.searchParams.get('first_name'), 'Ada');
});

test('section_search filters by canonical term and rejects unpaired or incomplete input', async () => {
  const upstream = fakeFetch(async () =>
    envelope([section(), section({ _id: ID_A, academic_session: { name: 'Spring 2026' } })]),
  );
  const run = await invoke(
    sectionSearchTool,
    { subject_prefix: 'CS', course_number: '1336', term: 'fall 2026' },
    upstream.fetch,
  );
  assert.equal(itemsOf(run).length, 1);
  assert.equal(run.payload.data!['has_more'], false);

  const cases: unknown[] = [
    {},
    { subject_prefix: 'CS' },
    { first_name: 'Ada' },
    { subject_prefix: 'CS', course_number: '1336', term: 'winter 2026' },
    { subject_prefix: 'CS', course_number: '1336', limit: 51 },
  ];
  for (const args of cases) {
    const rejected = await invoke(sectionSearchTool, args, upstream.fetch);
    assert.equal(rejected.payload.code, 'INVALID_ARGUMENT', JSON.stringify(args));
  }
  assert.equal(upstream.calls.length, 1);
});

test('section_search pages locally without a second upstream request', async () => {
  const sections = Array.from({ length: 5 }, (_value, index) =>
    section({ _id: `${ID_A.slice(0, 22)}${index.toString(16).padStart(2, '0')}`, section_number: `00${index}` }),
  );
  const upstream = fakeFetch(async () => envelope(sections));
  const first = await invoke(
    sectionSearchTool,
    { subject_prefix: 'CS', course_number: '1336', limit: 2 },
    upstream.fetch,
  );
  assert.equal(itemsOf(first).length, 2);
  assert.equal(first.payload.data!['has_more'], true);

  const cursor = first.payload.data!['next_cursor'] as string;
  const second = await invoke(
    sectionSearchTool,
    { subject_prefix: 'CS', course_number: '1336', limit: 2, cursor },
    upstream.fetch,
  );
  assert.equal(itemsOf(second).length, 2);
  assert.equal(second.payload.data!['has_more'], true);
  assert.equal(upstream.calls.length, 2, 'one request per call, no hidden prefetch');
});

test('section_get merges the section and its instructor records', async () => {
  const upstream = fakeFetch(async (url) =>
    url.endsWith('/professors') ? envelope([professor()]) : envelope(section()),
  );
  const run = await invoke(sectionGetTool, { section_id: ID_C }, upstream.fetch);

  assert.equal(run.payload.ok, true);
  assert.equal(upstream.calls.length, 2);
  const data = run.payload.data!;
  assert.equal(data['id'], ID_C);
  assert.equal(data['term'] !== undefined, true);
  assert.equal((data['term'] as Record<string, unknown>)['id'], '26F');
  assert.equal((data['term'] as Record<string, unknown>)['name'], 'Fall 2026');
  assert.equal(data['section_number'], '001');
  assert.equal((data['professors'] as Array<Record<string, unknown>>)[0]!['name'], 'Ada Lovelace');
  assert.equal(run.payload.data!['grade_distribution'], undefined, 'grades stay in grades_get');
});

test('section_get survives a missing instructor list with an explicit note', async () => {
  const upstream = fakeFetch(async (url) =>
    url.endsWith('/professors')
      ? envelope(null, { status: 'error', message: 'no professors', httpStatus: 404 })
      : envelope(section()),
  );
  const run = await invoke(sectionGetTool, { section_id: ID_C }, upstream.fetch);
  assert.equal(run.payload.ok, true);
  const notes = run.payload.meta!['notes'] as string[];
  assert.ok(notes.some((note) => note.includes('no professor records')));
  // Only successful responses are counted, so the failed instructor lookup is not included.
  assert.equal(run.payload.meta!['requests'], 1);
});
