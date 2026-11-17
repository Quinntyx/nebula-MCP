import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CURSOR_MAX_OFFSET,
  decodeCursor,
  encodeCursor,
  filterFingerprint,
} from '../src/domain/cursor.js';
import { GRADE_BUCKETS, GRADE_BUCKET_COUNT, toGradeCounts } from '../src/domain/grades.js';
import { jsonBytes, fitList, fitDetail, localPage, TARGET_RESULT_BYTES } from '../src/domain/budget.js';
import { renderRequirement } from '../src/domain/requirements.js';
import {
  canonicalSessionName,
  canonicalTerm,
  compareTermsDescending,
  parseTerm,
  termSeasonRank,
  termYear,
} from '../src/domain/terms.js';
import { ToolError } from '../src/errors.js';

test('grade buckets are the 14 verified Trends buckets in order', () => {
  assert.equal(GRADE_BUCKET_COUNT, 14);
  assert.deepEqual([...GRADE_BUCKETS], [
    'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F', 'W',
  ]);
});

test('toGradeCounts labels buckets and totals observations', () => {
  const counts = toGradeCounts([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.equal(counts.buckets['A+'], 0);
  assert.equal(counts.buckets['W'], 13);
  assert.equal(counts.observations, 91);
  assert.deepEqual(Object.keys(counts.buckets), [...GRADE_BUCKETS]);
});

test('parseTerm canonicalises short, long, and four-digit forms', () => {
  assert.deepEqual(parseTerm('26F'), { id: '26F', season: 'fall', year: 2026 });
  assert.deepEqual(parseTerm('2026f'), { id: '26F', season: 'fall', year: 2026 });
  assert.deepEqual(parseTerm('Fall 2026'), { id: '26F', season: 'fall', year: 2026 });
  assert.deepEqual(parseTerm('fall26'), { id: '26F', season: 'fall', year: 2026 });
  assert.deepEqual(parseTerm('25U'), { id: '25U', season: 'summer', year: 2025 });
});

test('parseTerm refuses to guess unsupported formats', () => {
  for (const raw of ['', '   ', 'F26', '2026', 'Winter 2026', 'Fall', '26X', '1899S', 'Fall 2026 extra']) {
    assert.equal(parseTerm(raw), undefined, raw);
  }
});

test('canonicalTerm throws a bounded INVALID_ARGUMENT', () => {
  assert.equal(canonicalTerm('spring 2027'), '27S');
  assert.throws(
    () => canonicalTerm('winter 2027'),
    (error: unknown) => error instanceof ToolError && error.code === 'INVALID_ARGUMENT',
  );
});

test('canonicalSessionName maps upstream session names and skips unknown ones', () => {
  assert.equal(canonicalSessionName('Fall 2026'), '26F');
  assert.equal(canonicalSessionName('Summer 2026'), '26U');
  assert.equal(canonicalSessionName('Intersession'), undefined);
});

test('terms sort newest first with summer between spring and fall', () => {
  const terms = ['25S', '26F', '25U', '26S', '25F'];
  assert.deepEqual([...terms].sort(compareTermsDescending), ['26F', '26S', '25F', '25U', '25S']);
  assert.equal(termYear('26F'), 2026);
  assert.ok(termSeasonRank('26F') > termSeasonRank('26U'));
});

test('cursor round-trips and is bound to tool plus filter fingerprint', () => {
  const fingerprint = filterFingerprint({ subject_prefix: 'CS', course_number: '1336' });
  const cursor = encodeCursor('course_search', fingerprint, 20);
  assert.equal(decodeCursor(cursor, 'course_search', fingerprint), 20);

  assert.throws(
    () => decodeCursor(cursor, 'professor_search', fingerprint),
    (error: unknown) => error instanceof ToolError && error.code === 'INVALID_ARGUMENT',
  );
  const other = filterFingerprint({ subject_prefix: 'CS' });
  assert.throws(() => decodeCursor(cursor, 'course_search', other), ToolError);
});

test('filter fingerprints ignore key order and undefined members', () => {
  assert.equal(
    filterFingerprint({ subject_prefix: 'CS', course_number: '1336', title: undefined }),
    filterFingerprint({ course_number: '1336', subject_prefix: 'CS' }),
  );
  assert.notEqual(filterFingerprint({ subject_prefix: 'CS' }), filterFingerprint({ subject_prefix: 'EE' }));
});

test('cursor decoding rejects malformed, oversized, and out-of-range payloads', () => {
  const fingerprint = 'abc';
  const malformed = [
    '',
    'x'.repeat(600),
    Buffer.from('not json', 'utf8').toString('base64url'),
    Buffer.from(JSON.stringify({ v: 99, t: 'course_search', f: fingerprint, o: 0 })).toString('base64url'),
    Buffer.from(JSON.stringify({ v: 1, t: 'course_search', f: fingerprint, o: -1 })).toString('base64url'),
    Buffer.from(
      JSON.stringify({ v: 1, t: 'course_search', f: fingerprint, o: CURSOR_MAX_OFFSET + 1 }),
    ).toString('base64url'),
    Buffer.from(JSON.stringify({ v: 1, t: 'course_search', f: fingerprint, o: 1.5 })).toString('base64url'),
  ];
  for (const cursor of malformed) {
    assert.throws(
      () => decodeCursor(cursor, 'course_search', fingerprint),
      (error: unknown) => error instanceof ToolError && error.code === 'INVALID_ARGUMENT',
      cursor.slice(0, 24),
    );
  }
});

test('fitList reports unknown exhaustion for a fully consumed upstream page', () => {
  const rows = [{ id: 1 }, { id: 2 }];
  const result = fitList({
    rows,
    limit: 10,
    offset: 0,
    totalRows: null,
    cursor: (next) => `c${next}`,
    build: (state) => ({
      items: state.items,
      returned: state.returned,
      has_more: state.has_more,
      next_cursor: state.next_cursor,
    }),
  });
  assert.equal(result.returned, 2);
  assert.equal(result.has_more, null);
  assert.equal(result.data['next_cursor'], 'c2');
});

test('fitList reports more rows and offsets by rows actually emitted', () => {
  const rows = Array.from({ length: 5 }, (_value, index) => ({ id: index }));
  const result = fitList({
    rows,
    limit: 2,
    offset: 10,
    totalRows: null,
    cursor: (next) => `c${next}`,
    build: (state) => ({
      items: state.items,
      returned: state.returned,
      has_more: state.has_more,
      next_cursor: state.next_cursor,
    }),
  });
  assert.equal(result.returned, 2);
  assert.equal(result.has_more, true);
  assert.equal(result.data['next_cursor'], 'c12');
});

test('fitList reports exact exhaustion for complete local result sets', () => {
  const page = [{ id: 3 }];
  const more = fitList({
    rows: [{ id: 1 }, { id: 2 }],
    limit: 2,
    offset: 0,
    totalRows: 3,
    cursor: (next) => `c${next}`,
    build: (state) => ({
      items: state.items,
      returned: state.returned,
      has_more: state.has_more,
      next_cursor: state.next_cursor,
    }),
  });
  assert.equal(more.has_more, true);
  assert.equal(more.data['next_cursor'], 'c2');

  const last = fitList({
    rows: page,
    limit: 2,
    offset: 2,
    totalRows: 3,
    cursor: (next) => `c${next}`,
    build: (state) => ({
      items: state.items,
      returned: state.returned,
      has_more: state.has_more,
      next_cursor: state.next_cursor,
    }),
  });
  assert.equal(last.returned, 1);
  assert.equal(last.has_more, false);
  assert.equal(last.data['next_cursor'], undefined);
});

test('fitList shrinks rows to stay inside the byte target', () => {
  const rows = Array.from({ length: 20 }, () => ({ text: 'x'.repeat(400) }));
  const result = fitList({
    rows,
    limit: 20,
    offset: 0,
    totalRows: 20,
    cursor: (next) => `c${next}`,
    build: (state) => ({
      items: state.items,
      returned: state.returned,
      has_more: state.has_more,
      next_cursor: state.next_cursor,
    }),
  });
  assert.ok(result.returned < 20);
  assert.ok(jsonBytes(result.data) <= TARGET_RESULT_BYTES);
  assert.equal(result.data['next_cursor'], `c${result.returned}`);
});

test('localPage slices from the cursor offset and reports the total', () => {
  const { page, totalRows } = localPage([1, 2, 3, 4], 3);
  assert.deepEqual(page, [4]);
  assert.equal(totalRows, 4);
});

test('fitDetail tightens the payload instead of overflowing', () => {
  const data = fitDetail((scale) => ({ text: 'y'.repeat(Math.round(20_000 * scale)) }));
  assert.ok(jsonBytes(data) <= 12_000);
});

test('requirement trees render as bounded explicit nodes', () => {
  const rendered = renderRequirement({
    type: 'collection',
    name: 'Lower division',
    required: 2,
    options: [
      { type: 'course', class_reference: 'CS 1336', minimum_grade: 'C' },
      { type: 'hours', required: 6, options: [] },
    ],
  });
  assert.equal(rendered.truncated, false);
  assert.deepEqual(rendered.value, {
    type: 'collection',
    name: 'Lower division',
    required: 2,
    options: [
      { type: 'course', course: 'CS 1336', minimum_grade: 'C' },
      { type: 'hours', hours: 6, options: [] },
    ],
  });
});

test('requirement rendering truncates deep or oversized trees', () => {
  let node: Record<string, unknown> = { type: 'course', class_reference: 'CS 1', minimum_grade: 'C' };
  for (let depth = 0; depth < 12; depth += 1) {
    node = { type: 'collection', name: `level ${depth}`, required: 1, options: [node] };
  }
  const rendered = renderRequirement(node);
  assert.equal(rendered.truncated, true);
});

test('requirement rendering tolerates unknown and empty input', () => {
  assert.deepEqual(renderRequirement(null), { value: null, truncated: false });
  assert.deepEqual(renderRequirement('CS 1336'), { value: null, truncated: false });
  assert.deepEqual(renderRequirement({ type: 'weird' }), {
    value: {
      type: 'unsupported',
      upstream_type: 'weird',
      note: 'unrecognised requirement type; see the upstream course catalog',
    },
    truncated: false,
  });
});
