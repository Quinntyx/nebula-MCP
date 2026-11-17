#!/usr/bin/env node
/** Opt-in authenticated checks. No credentials or response bodies are printed/saved. */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const key = process.env.NEBULA_API_KEY?.trim();
if (!key) {
  console.error('NEBULA_API_KEY is required for live tests; no network calls were made.');
  process.exit(2);
}
const prefix = (process.env.NEBULA_LIVE_PREFIX ?? 'CS').trim().toUpperCase();
const number = (process.env.NEBULA_LIVE_COURSE ?? '1337').trim();
const clubQuery = process.env.NEBULA_LIVE_CLUB_QUERY ?? 'robotics';
const date = process.env.NEBULA_LIVE_DATE ?? new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const client = new Client({ name: 'nebula-mcp-live-smoke', version: '0.1.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../dist/src/index.js', import.meta.url))],
  env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)),
    NEBULA_API_KEY: key,
    NEBULA_MCP_TOOLSETS: 'academics,clubs,events',
  },
  stderr: 'pipe',
});
// Never echo subprocess diagnostics: an unexpected crash can contain input data.
transport.stderr?.on('data', () => {});
const checks = [];
const successfulTools = new Set();
let totalRequests = 0;
let totalCalls = 0;
let maxBytes = 0;

class LiveError extends Error {
  constructor(code) { super('Live tool returned an unexpected error'); this.code = code; }
}
class Skip extends Error {}
function need(value) {
  if (value === undefined || value === null) throw new Skip('required earlier data unavailable');
  return value;
}
function items(payload) { assert.ok(Array.isArray(payload.data.items)); return payload.data.items; }
function grades(distribution, total) {
  const labels = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F', 'W'];
  assert.deepEqual(Object.keys(distribution), labels);
  const values = Object.values(distribution);
  for (const value of values) assert.ok(Number.isSafeInteger(value) && value >= 0);
  assert.equal(values.reduce((sum, value) => sum + value, 0), total);
}
async function call(tool, args, expectedError) {
  totalCalls++;
  const result = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 45_000 });
  const serialized = JSON.stringify(result);
  const bytes = Buffer.byteLength(serialized, 'utf8');
  maxBytes = Math.max(maxBytes, bytes);
  assert.ok(bytes <= 12_000);
  assert.equal(serialized.includes(key), false);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'text');
  const payload = JSON.parse(result.content[0].text);
  if (expectedError) {
    assert.equal(result.isError, true);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, expectedError);
  } else {
    if (!payload.ok) throw new LiveError(payload.error?.code ?? 'UNEXPECTED_ERROR');
    assert.notEqual(result.isError, true);
    assert.equal(typeof payload.meta.fetched_at, 'string');
    assert.ok(Array.isArray(payload.meta.notes));
    successfulTools.add(tool);
    totalRequests += payload.meta.requests ?? 0;
    if ('returned' in payload.data) {
      const rows = payload.data.items ?? payload.data.terms;
      assert.ok(Array.isArray(rows));
      assert.equal(payload.data.returned, rows.length);
      assert.ok([true, false, null].includes(payload.data.has_more));
      if (payload.data.has_more !== false && rows.length > 0) assert.equal(typeof payload.data.next_cursor, 'string');
    }
  }
  return payload;
}
async function check(name, fn) {
  const start = Date.now();
  try {
    const value = await fn();
    const record = { check: name, status: 'pass', duration_ms: Date.now() - start };
    checks.push(record); console.log(JSON.stringify(record));
    return value;
  } catch (error) {
    const record = {
      check: name,
      status: error instanceof Skip ? 'skip' : 'fail',
      code: error instanceof LiveError ? error.code : error instanceof Skip ? 'DEPENDENCY_UNAVAILABLE' : 'ASSERTION_OR_TRANSPORT',
      duration_ms: Date.now() - start,
    };
    checks.push(record); console.log(JSON.stringify(record));
    return undefined;
  }
}

try {
  await client.connect(transport);
  const catalog = await check('MCP discovery: all 11 strict read-only tools', async () => {
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 11);
    for (const tool of listed.tools) {
      assert.equal(tool.inputSchema.additionalProperties, false);
      assert.ok(tool.description.length <= 160);
      assert.equal(tool.annotations.readOnlyHint, true);
      assert.equal(tool.annotations.destructiveHint, false);
    }
    return listed;
  });
  const calendar = await check('academic_calendar_get: current marker', () => call('academic_calendar_get', {}));
  await check('academic_calendar_get: explicit returned term', async () => {
    const result = await call('academic_calendar_get', { term: need(calendar).data.id });
    assert.equal(result.data.id, calendar.data.id);
  });
  const courses = await check('course_search: exact code and bounded first page', async () => {
    const result = await call('course_search', { subject_prefix: prefix.toLowerCase(), course_number: number, limit: 2 });
    assert.ok(items(result).length > 0);
    for (const row of items(result)) assert.equal(row.code, `${prefix.toUpperCase()} ${number}`);
    return result;
  });
  await check('course_search: continuation and changed-filter rejection', async () => {
    const first = need(courses);
    const cursor = need(first.data.next_cursor);
    const result = await call('course_search', { subject_prefix: prefix, course_number: number, limit: 2, cursor });
    const previous = new Set(items(first).map((row) => row.id));
    for (const row of items(result)) assert.equal(previous.has(row.id), false);
    await call('course_search', { subject_prefix: prefix === 'MATH' ? 'CS' : 'MATH', course_number: number, cursor }, 'INVALID_ARGUMENT');
  });
  const course = await check('course_get: discovered ID and detail mapping', async () => {
    const id = need(need(courses).data.items[0]?.id);
    const result = await call('course_get', { course_id: id });
    assert.equal(result.data.id, id);
    assert.equal(result.data.code, `${prefix.toUpperCase()} ${number}`);
    assert.equal(typeof result.data.section_count, 'number');
    return result;
  });
  await check('course_search: returned catalog year/school/class-level filters', async () => {
    const detail = need(course).data;
    const args = { subject_prefix: prefix, course_number: number, limit: 20 };
    for (const field of ['catalog_year', 'school', 'class_level']) if (detail[field]) args[field] = detail[field];
    const result = await call('course_search', args);
    assert.ok(items(result).some((row) => row.id === detail.id));
    if (args.catalog_year) for (const row of items(result)) assert.equal(row.catalog_year, args.catalog_year);
  });
  await check('course_search: genuine empty result', async () => {
    const result = await call('course_search', { subject_prefix: 'ZZZZZZZZ', course_number: '999999999999' });
    assert.equal(items(result).length, 0); assert.equal(result.data.has_more, false);
  });
  const sections = await check('section_search: course Trends results', async () => {
    const result = await call('section_search', { subject_prefix: prefix, course_number: number, limit: 2 });
    assert.ok(items(result).length > 0);
    return result;
  });
  const section = await check('section_get: meetings and separate instructor route', async () => {
    const id = need(need(sections).data.items[0]?.id);
    const result = await call('section_get', { section_id: id });
    assert.equal(result.data.id, id);
    assert.ok(Array.isArray(result.data.meetings));
    assert.ok(Array.isArray(result.data.professors));
    return result;
  });
  await check('section_search: term canonicalization and local continuation', async () => {
    const first = need(sections);
    const term = need(first.data.items[0]?.term);
    const result = await call('section_search', { subject_prefix: prefix, course_number: number, term, limit: 2 });
    assert.ok(items(result).length > 0);
    for (const row of items(result)) assert.equal(row.term, term);
    if (result.data.next_cursor) {
      const next = await call('section_search', { subject_prefix: prefix, course_number: number, term, limit: 2, cursor: result.data.next_cursor });
      const previous = new Set(items(result).map((row) => row.id));
      for (const row of items(next)) assert.equal(previous.has(row.id), false);
    }
  });
  const professor = await check('professor_get: ID from actual section instructor', async () => {
    const id = need(need(section).data.professors[0]?.id);
    const result = await call('professor_get', { professor_id: id });
    assert.equal(result.data.id, id);
    assert.equal(typeof result.data.first_name, 'string');
    assert.equal(typeof result.data.last_name, 'string');
    return result;
  });
  const professorNames = professor ? { first_name: professor.data.first_name, last_name: professor.data.last_name } : undefined;
  await check('professor_search: exact first+last names resolve the known ID', async () => {
    const names = need(professorNames);
    const result = await call('professor_search', { ...names, limit: 20 });
    assert.ok(items(result).some((row) => row.id === professor.data.id));
  });
  const professorPage = await check('professor_search: last-name page', async () => {
    const result = await call('professor_search', { last_name: 'Smith', limit: 1 });
    assert.ok(items(result).length > 0); return result;
  });
  await check('professor_search: continuation is disjoint', async () => {
    const first = need(professorPage);
    const result = await call('professor_search', { last_name: 'Smith', limit: 1, cursor: need(first.data.next_cursor) });
    for (const row of items(result)) assert.notEqual(row.id, first.data.items[0].id);
  });
  await check('professor_search: nonexistent name is an empty page', async () => {
    const result = await call('professor_search', { last_name: 'NebulaMcpNoSuchPersonZzxq' });
    assert.equal(items(result).length, 0); assert.equal(result.data.has_more, false);
  });
  await check('section_search: professor Trends route', async () => {
    const result = await call('section_search', { ...need(professorNames), limit: 2 });
    assert.ok(items(result).length > 0);
  });
  await check('section_search: combined course+professor filtering', async () => {
    const result = await call('section_search', { subject_prefix: prefix, course_number: number, ...need(professorNames), limit: 2 });
    assert.ok(items(result).length > 0);
    const name = `${professorNames.first_name} ${professorNames.last_name}`;
    for (const row of items(result)) assert.ok(row.professors.some((person) => person.name === name));
    assert.ok(result.meta.notes.some((note) => note.includes('exact local instructor filtering')));
  });
  await check('section_search: nonexistent exact course is empty', async () => {
    const result = await call('section_search', { subject_prefix: 'ZZZZZZZZ', course_number: '999999999999' });
    assert.equal(items(result).length, 0); assert.equal(result.data.has_more, false);
  });
  for (const [target, get] of [
    ['course_id', () => need(course).data.id],
    ['section_id', () => need(section).data.id],
    ['professor_id', () => need(professor).data.id],
  ]) {
    await check(`grades_get: ${target} overall counts`, async () => {
      const result = await call('grades_get', { [target]: get() });
      grades(result.data.buckets, result.data.total);
    });
  }
  const overall = await check('grades_get: course-filter overall counts', async () => {
    const result = await call('grades_get', { subject_prefix: prefix, course_number: number });
    grades(result.data.buckets, result.data.total); return result;
  });
  const terms = await check('grades_get: per-term rows and sum consistency', async () => {
    const result = await call('grades_get', { subject_prefix: prefix, course_number: number, by: 'term', limit: 40 });
    assert.ok(result.data.terms.length > 0);
    for (const row of result.data.terms) grades(row.buckets, row.total);
    if (result.data.has_more === false && overall) {
      assert.equal(result.data.terms.reduce((sum, row) => sum + row.total, 0), overall.data.total);
    }
    return result;
  });
  await check('grades_get: requested term filter and cursor', async () => {
    const first = need(terms);
    const term = need(first.data.terms[0]?.term);
    const result = await call('grades_get', { subject_prefix: prefix, course_number: number, by: 'term', terms: [term], limit: 1 });
    assert.equal(result.data.terms.length, 1); assert.equal(result.data.terms[0].term, term);
    const paged = await call('grades_get', { subject_prefix: prefix, course_number: number, by: 'term', limit: 1 });
    if (paged.data.next_cursor) {
      const next = await call('grades_get', { subject_prefix: prefix, course_number: number, by: 'term', limit: 1, cursor: paged.data.next_cursor });
      assert.notEqual(next.data.terms[0]?.period, paged.data.terms[0].period);
    }
  });
  await check('grades_get: term+section-type grouping', async () => {
    const result = await call('grades_get', { subject_prefix: prefix, course_number: number, by: 'term_section_type', limit: 2 });
    assert.ok(result.data.terms.length > 0);
    for (const row of result.data.terms) for (const group of row.groups) grades(group.buckets, group.total);
  });
  await check('grades_get: exact professor-name and combined course filters', async () => {
    const names = need(professorNames);
    const instructor = await call('grades_get', names); grades(instructor.data.buckets, instructor.data.total);
    const combined = await call('grades_get', { subject_prefix: prefix, course_number: number, ...names });
    grades(combined.data.buckets, combined.data.total);
  });
  await check('grades_get: prefix-only, single-name, and combined section scopes', async () => {
    const names = need(professorNames);
    for (const args of [
      { subject_prefix: prefix },
      { first_name: names.first_name },
      { last_name: names.last_name },
      { subject_prefix: prefix, ...names },
      { subject_prefix: prefix, course_number: number, section_number: need(section).data.section_number, ...names },
    ]) {
      const result = await call('grades_get', args); grades(result.data.buckets, result.data.total);
    }
  });
  await check('grades_get: term section-type counts reconcile with unsplit counts', async () => {
    const reference = need(terms).data.terms[0];
    const term = need(reference?.term);
    const result = await call('grades_get', { subject_prefix: prefix, course_number: number, by: 'term_section_type', terms: [term] });
    assert.equal(result.data.terms.length, 1);
    const row = result.data.terms[0];
    assert.equal(row.truncated, undefined);
    assert.equal(row.groups.reduce((sum, group) => sum + group.total, 0), reference.total);
    for (const label of Object.keys(reference.buckets)) {
      assert.equal(row.groups.reduce((sum, group) => sum + group.buckets[label], 0), reference.buckets[label]);
    }
  });
  await check('grades_get: section-number filter', async () => {
    const sectionNumber = need(need(section).data.section_number);
    const result = await call('grades_get', { subject_prefix: prefix, course_number: number, section_number: sectionNumber });
    grades(result.data.buckets, result.data.total);
  });
  const clubs = await check('club_search: actual ranked keyword matches', async () => {
    const result = await call('club_search', { query: clubQuery, limit: 1 });
    assert.ok(items(result).length > 0); return result;
  });
  await check('club_get: discovered club ID, officers and contacts', async () => {
    const id = need(need(clubs).data.items[0]?.id);
    const result = await call('club_get', { club_id: id });
    assert.equal(result.data.id, id);
    assert.ok(Array.isArray(result.data.contacts)); assert.ok(Array.isArray(result.data.officers));
  });
  await check('club_search: local continuation and wildcard removal', async () => {
    const first = need(clubs);
    if (first.data.next_cursor) {
      const next = await call('club_search', { query: clubQuery, limit: 1, cursor: first.data.next_cursor });
      for (const row of items(next)) assert.notEqual(row.id, first.data.items[0].id);
    }
    const stripped = await call('club_search', { query: `%${clubQuery}_`, limit: 1 });
    assert.equal(stripped.data.query, clubQuery);
  });
  await check('club_search: genuine upstream no-match 404 becomes empty', async () => {
    const result = await call('club_search', { query: 'zzxqNebulaMcpNonexistentClub74291' });
    assert.equal(items(result).length, 0); assert.equal(result.data.has_more, false);
  });
  const events = await check('campus_events_on_date: actual indexed date', async () => {
    const result = await call('campus_events_on_date', { date, limit: 2 });
    assert.ok(items(result).length > 0); return result;
  });
  await check('campus_events_on_date: building filter', async () => {
    const building = need(need(events).data.items.find((row) => row.building)?.building);
    const result = await call('campus_events_on_date', { date, building, limit: 2 });
    assert.ok(items(result).length > 0);
    for (const row of items(result)) assert.equal(row.building, building);
  });
  await check('campus_events_on_date: building+room filter preserves location', async () => {
    const row = need(need(events).data.items.find((item) => item.building && item.room));
    const result = await call('campus_events_on_date', { date, building: row.building, room: row.room, limit: 2 });
    assert.ok(items(result).length > 0);
    for (const event of items(result)) {
      assert.equal(event.building, row.building); assert.equal(event.room, row.room);
    }
  });
  await check('campus_events_on_date: local text filter and continuation', async () => {
    const first = need(events);
    const title = need(first.data.items[0]?.title);
    const result = await call('campus_events_on_date', { date, query: title.slice(0, 30), limit: 2 });
    assert.ok(items(result).length > 0);
    if (first.data.next_cursor) {
      const next = await call('campus_events_on_date', { date, limit: 2, cursor: first.data.next_cursor });
      const previous = new Set(items(first).map((row) => JSON.stringify(row)));
      for (const row of items(next)) assert.equal(previous.has(JSON.stringify(row)), false);
    }
  });
  await check('campus_events_on_date: unindexed historical date is empty', async () => {
    const result = await call('campus_events_on_date', { date: '2000-01-01' });
    assert.equal(items(result).length, 0); assert.equal(result.data.has_more, false);
  });
  await check('section_search: repeated combined requests stay consistent', async () => {
    const names = need(professorNames);
    let previous;
    for (let iteration = 0; iteration < 5; iteration++) {
      const result = await call('section_search', { subject_prefix: prefix, course_number: number, ...names, limit: 2 });
      const ids = items(result).map((row) => row.id);
      assert.ok(ids.length > 0);
      if (previous) assert.deepEqual(ids, previous);
      previous = ids;
    }
  });
  await check('course_search: whole selected-code pagination reaches terminal empty page', async () => {
    const ids = new Set();
    let cursor;
    let complete = false;
    for (let page = 0; page < 12; page++) {
      const result = await call('course_search', { subject_prefix: prefix, course_number: number, limit: 20, ...(cursor ? { cursor } : {}) });
      for (const row of items(result)) {
        assert.equal(ids.has(row.id), false); ids.add(row.id);
      }
      if (result.data.has_more === false) { complete = true; break; }
      cursor = need(result.data.next_cursor);
    }
    assert.equal(complete, true);
    assert.ok(ids.size > 0);
  });
  await check('maximum limits: broad course, professor, section, clubs and event results stay bounded', async () => {
    for (const [name, args] of [
      ['course_search', { subject_prefix: prefix, limit: 20 }],
      ['professor_search', { last_name: 'Smith', limit: 20 }],
      ['section_search', { subject_prefix: prefix, course_number: number, limit: 25 }],
      ['club_search', { query: 'computer', limit: 15 }],
      ['campus_events_on_date', { date, limit: 50 }],
    ]) {
      const result = await call(name, args); assert.ok(items(result).length > 0);
    }
  });
  for (const [subject, code] of [['CS', '1336'], ['CS', '2336'], ['CS', '3345'], ['MATH', '2413'], ['PHYS', '2325']]) {
    await check(`representative dataset: ${subject} ${code} course detail, sections and historical grades`, async () => {
      const matches = await call('course_search', { subject_prefix: subject, course_number: code, limit: 1 });
      const first = need(items(matches)[0]);
      const detail = await call('course_get', { course_id: first.id });
      assert.equal(detail.data.id, first.id);
      const schedule = await call('section_search', { subject_prefix: subject, course_number: code, limit: 2 });
      assert.ok(items(schedule).length > 0);
      const aggregate = await call('grades_get', { subject_prefix: subject, course_number: code });
      grades(aggregate.data.buckets, aggregate.data.total);
    });
  }
  for (const [tool, args, expected] of [
    ['course_get', { course_id: '000000000000000000000000' }, 'NOT_FOUND'],
    ['professor_get', { professor_id: '000000000000000000000000' }, 'NOT_FOUND'],
    ['section_get', { section_id: '000000000000000000000000' }, 'NOT_FOUND'],
    ['club_get', { club_id: '00000000-0000-0000-0000-000000000000' }, 'NOT_FOUND'],
    ['course_search', { subject_prefix: prefix, cursor: 'not-a-cursor' }, 'INVALID_ARGUMENT'],
    ['professor_search', { first_name: '  ' }, 'INVALID_ARGUMENT'],
    ['grades_get', { course_id: '000000000000000000000000', by: 'term' }, 'INVALID_ARGUMENT'],
    ['grades_get', { subject_prefix: prefix, by: 'invalid'.repeat(3000) }, 'INVALID_ARGUMENT'],
    ['club_search', { query: '%_' }, 'INVALID_ARGUMENT'],
    ['campus_events_on_date', { date: '2026-02-30' }, 'INVALID_ARGUMENT'],
    ['campus_events_on_date', { date, room: '1' }, 'INVALID_ARGUMENT'],
    ['course_get', { course_id: '../storage' }, 'INVALID_ARGUMENT'],
    ['academic_calendar_get', { term: '../storage' }, 'INVALID_ARGUMENT'],
  ]) {
    await check(`${tool}: expected ${expected} (${checks.length + 1})`, () => call(tool, args, expected));
  }
  await check('authentication: an invalid key discovers tools but real calls are rejected', async () => {
    const invalidClient = new Client({ name: 'nebula-invalid-auth-test', version: '0' });
    const invalidTransport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../dist/src/index.js', import.meta.url))],
      env: { PATH: process.env.PATH ?? '', NEBULA_API_KEY: 'intentionally-invalid-nebula-mcp-smoke-key', NEBULA_MCP_TOOLSETS: 'academics' },
      stderr: 'pipe',
    });
    invalidTransport.stderr?.on('data', () => {});
    try {
      await invalidClient.connect(invalidTransport);
      assert.equal((await invalidClient.listTools()).tools.length, 8);
      totalCalls++;
      const result = await invalidClient.callTool({ name: 'course_search', arguments: { subject_prefix: prefix } }, undefined, { timeout: 45_000 });
      assert.equal(result.isError, true);
      const payload = JSON.parse(result.content[0].text);
      assert.equal(payload.error.code, 'AUTH_REJECTED');
      assert.equal(JSON.stringify(result).includes('intentionally-invalid-nebula-mcp-smoke-key'), false);
    } finally { await invalidClient.close(); }
  });
  await check('coverage: successful real calls for every advertised tool', async () => {
    assert.deepEqual([...successfulTools].sort(), need(catalog).tools.map((tool) => tool.name).sort());
  });
} catch {
  checks.push({ check: 'MCP live transport initialization', status: 'fail', code: 'TRANSPORT' });
} finally {
  await client.close();
}
const passed = checks.filter((item) => item.status === 'pass').length;
const failed = checks.filter((item) => item.status === 'fail').length;
const skipped = checks.filter((item) => item.status === 'skip').length;
console.log(JSON.stringify({ summary: { passed, failed, skipped, successful_tools: successfulTools.size, tool_calls: totalCalls, reported_upstream_attempts: totalRequests, max_result_bytes: maxBytes } }));
if (failed || skipped) process.exitCode = 1;
