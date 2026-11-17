import assert from 'node:assert/strict';
import { test } from 'node:test';
import { academicCalendarGetTool } from '../src/tools/academic-calendar-get.js';
import { campusEventsTool } from '../src/tools/campus-events.js';
import { clubGetTool } from '../src/tools/club-get.js';
import { clubSearchTool } from '../src/tools/club-search.js';
import { gradesGetTool } from '../src/tools/grades-get.js';
import { ALL_TOOLS, toolsFor } from '../src/tools/registry.js';
import {
  academicCalendar,
  calendarDateEnvelope,
  calendarEvent,
  club,
  distribution,
  ID_A,
  ID_B,
  ID_C,
} from './fixtures.js';
import { envelope, fakeFetch } from './helpers.js';
import { invoke, itemsOf, queryOf } from './toolkit.js';

test('grades_get maps overall course grades to labelled buckets without GPA', async () => {
  const upstream = fakeFetch(async () => envelope(distribution()));
  const run = await invoke(gradesGetTool, { course_id: ID_A }, upstream.fetch);

  assert.equal(run.payload.ok, true);
  assert.equal(new URL(upstream.calls[0]!.url).pathname, `/course/${ID_A}/grades`);
  const data = run.payload.data!;
  assert.equal(data['by'], 'overall');
  assert.deepEqual(data['scope'], { course_id: ID_A });
  const buckets = data['buckets'] as Record<string, number>;
  assert.equal(Object.keys(buckets).length, 14);
  assert.equal(buckets['A+'], 1);
  assert.equal(buckets['W'], 5);
  assert.equal(data['total'], 60);
  assert.equal(data['gpa'], undefined);

  const notes = run.payload.meta!['notes'] as string[];
  assert.ok(notes.some((note) => note.includes('No GPA')));
});

test('grades_get routes professor and section ids to their own grade routes', async () => {
  const upstream = fakeFetch(async () => envelope(distribution()));
  await invoke(gradesGetTool, { professor_id: ID_B }, upstream.fetch);
  assert.equal(new URL(upstream.calls[0]!.url).pathname, `/professor/${ID_B}/grades`);

  await invoke(gradesGetTool, { section_id: ID_C }, upstream.fetch);
  assert.equal(new URL(upstream.calls[1]!.url).pathname, `/section/${ID_C}/grades`);
});

test('grades_get forwards exact filters to the aggregate route', async () => {
  const upstream = fakeFetch(async () => envelope(distribution()));
  const run = await invoke(
    gradesGetTool,
    { subject_prefix: 'cs', course_number: '1336', section_number: '001' },
    upstream.fetch,
  );

  const url = new URL(upstream.calls[0]!.url);
  assert.equal(url.pathname, '/grades/overall');
  assert.equal(url.searchParams.get('prefix'), 'CS');
  assert.equal(url.searchParams.get('number'), '1336');
  assert.equal(url.searchParams.get('section_number'), '001');
  assert.equal(run.payload.ok, true);
});

test('grades_get rejects mixed scopes and missing scope', async () => {
  const upstream = fakeFetch(async () => envelope(distribution()));
  const cases: unknown[] = [
    {},
    { course_id: ID_A, professor_id: ID_B },
    { course_id: ID_A, subject_prefix: 'CS' },
    { section_number: '001' },
    { subject_prefix: 'CS', course_number: '1336', by: 'term', terms: [] },
    { course_id: 'not-an-id' },
    { course_id: ID_A, by: 'semester' },
    { course_id: ID_A, by: 'term' },
  ];
  for (const args of cases) {
    const run = await invoke(gradesGetTool, args, upstream.fetch);
    assert.equal(run.payload.code, 'INVALID_ARGUMENT', JSON.stringify(args));
  }
  assert.equal(upstream.calls.length, 0);
});

test('grades_get reports per-term rows newest first with exact exhaustion', async () => {
  const upstream = fakeFetch(async () =>
    envelope([
      { _id: '25F', grade_distribution: distribution([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9]) },
      { _id: '26S', grade_distribution: distribution([0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]) },
    ]),
  );
  const run = await invoke(
    gradesGetTool,
    { subject_prefix: 'CS', course_number: '1336', by: 'term', limit: 1 },
    upstream.fetch,
  );

  assert.equal(new URL(upstream.calls[0]!.url).pathname, '/grades/semester');
  const data = run.payload.data!;
  assert.equal(data['by'], 'term');
  const terms = data['terms'] as Array<Record<string, unknown>>;
  assert.equal(terms.length, 1);
  assert.equal(terms[0]!['period'], '26S');
  assert.equal(terms[0]!['term'], '26S');
  assert.equal(data['has_more'], true);
  assert.equal(typeof data['next_cursor'], 'string');
});

test('grades_get filters requested terms and notes unavailable ones', async () => {
  const upstream = fakeFetch(async () =>
    envelope([
      { _id: '25F', grade_distribution: distribution() },
      { _id: '26S', grade_distribution: distribution() },
    ]),
  );
  const run = await invoke(
    gradesGetTool,
    { subject_prefix: 'CS', course_number: '1336', by: 'term', terms: ['26F', 'Fall 2025'] },
    upstream.fetch,
  );

  const data = run.payload.data!;
  const terms = data['terms'] as Array<Record<string, unknown>>;
  assert.equal(terms.length, 1);
  assert.equal(terms[0]!['period'], '25F');
  const notes = run.payload.meta!['notes'] as string[];
  assert.ok(notes.some((note) => note.includes('No rows were returned for requested term(s): 26F')));
});

test('grades_get splits term rows by section type with bounded groups', async () => {
  const upstream = fakeFetch(async () =>
    envelope([
      {
        _id: '26F',
        data: [
          { type: 'Lecture', grade_distribution: distribution() },
          { type: 'Laboratory', grade_distribution: distribution([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3]) },
        ],
      },
    ]),
  );
  const run = await invoke(
    gradesGetTool,
    { subject_prefix: 'CS', course_number: '1336', by: 'term_section_type' },
    upstream.fetch,
  );

  assert.equal(new URL(upstream.calls[0]!.url).pathname, '/grades/semester/sectionType');
  const terms = run.payload.data!['terms'] as Array<Record<string, unknown>>;
  const groups = terms[0]!['groups'] as Array<Record<string, unknown>>;
  assert.equal(groups.length, 2);
  assert.equal(groups[1]!['type'], 'Laboratory');
  assert.equal(groups[1]!['total'], 3);
});

test('grades_get fails closed on a distribution that is not 14 buckets', async () => {
  const upstream = fakeFetch(async () => envelope([1, 2, 3]));
  const run = await invoke(gradesGetTool, { course_id: ID_A }, upstream.fetch);
  assert.equal(run.payload.ok, false);
  assert.equal(run.payload.code, 'UPSTREAM_SCHEMA');
});

test('academic_calendar_get uses the current marker when term is omitted', async () => {
  const upstream = fakeFetch(async () => envelope(academicCalendar()));
  const run = await invoke(academicCalendarGetTool, {}, upstream.fetch);

  assert.equal(new URL(upstream.calls[0]!.url).pathname, '/academicCalendars/current');
  const data = run.payload.data!;
  assert.equal(data['requested_term'], undefined);
  assert.equal(data['id'], '26F');
  const sessions = data['sessions'] as Array<Record<string, unknown>>;
  assert.equal(sessions[0]!['name'], 'Fall 2026 Full Term');
  assert.deepEqual(sessions[0]!['drop_deadlines'], {
    without_w: '2026-09-02',
    undergrad_approval_required: '2026-10-30',
    graduate_withdrawl_ends: '2026-11-20',
  });
  assert.equal(data['upstream_url'], 'https://example.edu/calendar');
  const notes = run.payload.meta!['notes'] as string[];
  assert.ok(notes.some((note) => note.includes('does not infer the current term from the clock')));
});

test('academic_calendar_get canonicalises a requested term', async () => {
  const upstream = fakeFetch(async () => envelope(academicCalendar()));
  const run = await invoke(academicCalendarGetTool, { term: 'Fall 2026' }, upstream.fetch);
  assert.equal(new URL(upstream.calls[0]!.url).pathname, '/academicCalendars/26F');
  assert.equal(run.payload.data!['requested_term'], '26F');

  const rejected = await invoke(academicCalendarGetTool, { term: 'next fall' }, upstream.fetch);
  assert.equal(rejected.payload.code, 'INVALID_ARGUMENT');
  assert.equal(upstream.calls.length, 1);
});

test('club_search strips wildcards, preserves ranking, and pages locally', async () => {
  const clubs = ['Robotics Club', 'Rocketry Club', 'Rubik Club'].map((name, index) =>
    club({ id: String(index + 1), slug: `club-${index + 1}`, name }),
  );
  const upstream = fakeFetch(async () => envelope(clubs));
  const first = await invoke(clubSearchTool, { query: 'rob%otics_', limit: 2 }, upstream.fetch);

  const url = new URL(upstream.calls[0]!.url);
  assert.equal(url.pathname, '/club/search');
  assert.equal(url.searchParams.get('q'), 'rob otics');
  const items = itemsOf(first);
  assert.equal(items.length, 2);
  assert.equal(items[0]!['name'], 'Robotics Club');
  assert.equal(first.payload.data!['has_more'], true);

  const second = await invoke(
    clubSearchTool,
    { query: 'rob%otics_', limit: 2, cursor: first.payload.data!['next_cursor'] as string },
    upstream.fetch,
  );
  assert.equal(itemsOf(second).length, 1);
  assert.equal(second.payload.data!['has_more'], false);
});

test('club_search tolerates a null upstream result and rejects trivial queries', async () => {
  const upstream = fakeFetch(async () => envelope(null));
  const run = await invoke(clubSearchTool, { query: 'robotics' }, upstream.fetch);
  assert.equal(run.payload.ok, true);
  assert.equal(itemsOf(run).length, 0);
  assert.equal(run.payload.data!['has_more'], false);

  for (const query of ['%_', 'a', '  %%  ']) {
    const rejected = await invoke(clubSearchTool, { query }, upstream.fetch);
    assert.equal(rejected.payload.code, 'INVALID_ARGUMENT', query);
  }
});

test('club_get maps one club without opening contact links', async () => {
  const upstream = fakeFetch(async () => envelope(club()));
  const run = await invoke(clubGetTool, { club_id: '4242' }, upstream.fetch);

  assert.equal(new URL(upstream.calls[0]!.url).pathname, '/club/4242');
  const data = run.payload.data!;
  assert.equal(data['id'], '4242');
  assert.equal(data['name'], 'Robotics Club');
  assert.deepEqual(data['contacts'], [{ platform: 'discord', url: 'https://example.edu/discord' }]);
  assert.equal(data['updated_at'], '2026-02-01T00:00:00.000Z');

  const rejected = await invoke(clubGetTool, { club_id: '../etc/passwd' }, upstream.fetch);
  assert.equal(rejected.payload.code, 'INVALID_ARGUMENT');
});

test('campus_events_on_date flattens a date envelope into one request', async () => {
  const upstream = fakeFetch(async () => envelope(calendarDateEnvelope()));
  const run = await invoke(campusEventsTool, { date: '2026-11-18' }, upstream.fetch);

  assert.equal(upstream.calls.length, 1);
  assert.equal(new URL(upstream.calls[0]!.url).pathname, '/calendar/2026-11-18');
  const items = itemsOf(run);
  assert.equal(items.length, 2);
  assert.equal(items[0]!['title'], 'Robotics Club Meetup');
  assert.equal(items[0]!['building'], 'ECSS');
  assert.equal(items[0]!['room'], '2.101');
  assert.equal(items[0]!['url'], 'https://example.edu/events/robotics');
  assert.equal(run.payload.data!['has_more'], false);
});

test('campus_events supports building and room narrowing and query filtering', async () => {
  const upstream = fakeFetch(async () => envelope(calendarDateEnvelope()));
  await invoke(campusEventsTool, { date: '2026-11-18', building: 'ECSS' }, upstream.fetch);
  assert.equal(new URL(upstream.calls[0]!.url).pathname, '/calendar/2026-11-18/ECSS');

  await invoke(
    campusEventsTool,
    { date: '2026-11-18', building: 'ECSS', room: '2.101' },
    upstream.fetch,
  );
  assert.equal(new URL(upstream.calls[1]!.url).pathname, '/calendar/2026-11-18/ECSS/2.101');

  const filtered = await invoke(
    campusEventsTool,
    { date: '2026-11-18', query: 'guest talk' },
    upstream.fetch,
  );
  assert.equal(itemsOf(filtered).length, 1);
  assert.equal(itemsOf(filtered)[0]!['title'], 'Guest Talk');
});

test('campus_events preserves parent location with actual building-only and room-only envelopes', async () => {
  const wide = calendarDateEnvelope();
  const buildingEnvelope = (wide['buildings'] as Array<Record<string, unknown>>)[0]!;
  const roomEnvelope = (buildingEnvelope['rooms'] as Array<Record<string, unknown>>)[0]!;
  const buildingFetch = fakeFetch(async () => envelope(buildingEnvelope));
  const roomFetch = fakeFetch(async () => envelope(roomEnvelope));
  const building = await invoke(campusEventsTool, { date: '2026-11-18', building: 'ECSS' }, buildingFetch.fetch);
  assert.equal(itemsOf(building)[0]!['building'], 'ECSS');
  assert.equal(itemsOf(building)[0]!['room'], '2.101');
  const room = await invoke(campusEventsTool, { date: '2026-11-18', building: 'ECSS', room: '2.101' }, roomFetch.fetch);
  assert.equal(itemsOf(room)[0]!['building'], 'ECSS');
  assert.equal(itemsOf(room)[0]!['room'], '2.101');
  const localMatch = await invoke(campusEventsTool, { date: '2026-11-18', building: 'ECSS', room: '2.101', query: 'ECSS' }, roomFetch.fetch);
  assert.ok(itemsOf(localMatch).length > 0);
  assert.equal(roomFetch.calls.length, 2);
});

test('campus_events validates dates, rooms, and extra properties', async () => {
  const upstream = fakeFetch(async () => envelope(calendarDateEnvelope()));
  const cases: unknown[] = [
    {},
    { date: '11/18/2026' },
    { date: '2026-02-31' },
    { date: '2026-11-18', room: '2.101' },
    { date: '2026-11-18', extra: 1 },
    { date: '2026-11-18', limit: 51 },
  ];
  for (const args of cases) {
    const run = await invoke(campusEventsTool, args, upstream.fetch);
    assert.equal(run.payload.code, 'INVALID_ARGUMENT', JSON.stringify(args));
  }
  assert.equal(upstream.calls.length, 0);
});

test('the catalog exposes 10 default tools and 11 with events', () => {
  const defaults = toolsFor(['academics', 'clubs']);
  assert.equal(defaults.length, 10);
  assert.equal(defaults.some((tool) => tool.name === 'campus_events_on_date'), false);
  assert.equal(ALL_TOOLS.length, 11);
  assert.equal(toolsFor(['academics', 'clubs', 'events']).length, 11);
  assert.deepEqual(
    defaults.map((tool) => tool.name),
    [
      'course_search',
      'course_get',
      'section_search',
      'section_get',
      'professor_search',
      'professor_get',
      'grades_get',
      'academic_calendar_get',
      'club_search',
      'club_get',
    ],
  );
  for (const tool of ALL_TOOLS) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.ok(tool.description.length < 700);
  }
});
