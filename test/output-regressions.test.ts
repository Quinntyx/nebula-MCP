import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitList, HARD_RESULT_BYTES, jsonBytes } from '../src/domain/budget.js';
import { renderRequirement } from '../src/domain/requirements.js';
import { ToolError } from '../src/errors.js';
import { professorSearchTool } from '../src/tools/professor-search.js';
import { clubGetTool } from '../src/tools/club-get.js';
import { gradesGetTool } from '../src/tools/grades-get.js';
import { academicCalendarGetTool } from '../src/tools/academic-calendar-get.js';
import { sectionSearchTool } from '../src/tools/section-search.js';
import { sectionGetTool } from '../src/tools/section-get.js';
import { academicCalendar, club, distribution, ID_C, professor, section } from './fixtures.js';
import { envelope } from './helpers.js';
import { invoke, itemsOf } from './toolkit.js';

test('an oversized first row is an explicit error, never a zero-row page with no cursor', () => {
  assert.throws(() => fitList({
    rows: [{ name: 'x'.repeat(7000) }], limit: 10, offset: 0, totalRows: null,
    cursor: String, build: (state) => ({ ...state }),
  }), (error) => error instanceof ToolError && error.code === 'RESPONSE_TOO_LARGE');
});

test('oversized professor names are bounded with visible truncation and usable pagination', async () => {
  const result = await invoke(professorSearchTool, { last_name: 'Synthetic' }, async () => envelope([
    professor({ first_name: '界'.repeat(7000) }),
  ]));
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data?.['returned'], 1);
  assert.equal(result.payload.data?.['has_more'], null);
  assert.equal(typeof result.payload.data?.['next_cursor'], 'string');
  assert.equal(itemsOf(result)[0]?.['truncated'], true);
  assert.ok(jsonBytes(result.result) <= HARD_RESULT_BYTES);
});

test('large club tags are bounded and both data and metadata disclose truncation', async () => {
  const result = await invoke(clubGetTool, { club_id: '4242' }, async () => envelope(club({ tags: ['界'.repeat(11400)] })));
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data?.['truncated'], true);
  assert.equal(result.payload.meta?.['truncated'], true);
  assert.ok(jsonBytes(result.result) <= HARD_RESULT_BYTES);
});

test('unrecognized huge term IDs cannot overflow available-term metadata', async () => {
  const result = await invoke(gradesGetTool, { subject_prefix: 'CS', by: 'term', terms: ['26F'] }, async () => envelope([
    { _id: '界'.repeat(20000), grade_distribution: distribution() },
  ]));
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data?.['returned'], 0);
  assert.ok(jsonBytes(result.result) <= HARD_RESULT_BYTES);
});

for (const count of [5, 15, 20]) {
  test(`section-type grade groups preserve all supported groups (${count})`, async () => {
    const result = await invoke(gradesGetTool, { subject_prefix: 'CS', by: 'term_section_type' }, async () => envelope([
      { _id: '26F', data: Array.from({ length: count }, (_, index) => ({ type: `type-${index}`, grade_distribution: distribution() })) },
    ]));
    assert.equal(result.payload.ok, true);
    const rows = result.payload.data?.['terms'] as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    assert.equal((rows[0]?.['groups'] as unknown[]).length, Math.min(count, 15));
    assert.equal(rows[0]?.['group_count'], count);
    assert.equal(rows[0]?.['truncated'], count > 15 ? true : undefined);
    assert.equal(result.payload.data?.['has_more'], false);
    assert.ok(jsonBytes(result.result) <= HARD_RESULT_BYTES);
  });
}

test('academic calendar session reductions are disclosed instead of implying completeness', async () => {
  const base = academicCalendar();
  const session = (base['sessions'] as unknown[])[0];
  const result = await invoke(academicCalendarGetTool, {}, async () => envelope(academicCalendar({ sessions: Array(11).fill(session) })));
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data?.['session_count'], 11);
  assert.equal(result.payload.data?.['truncated'], true);
  assert.equal(result.payload.meta?.['truncated'], true);
  assert.ok((result.payload.data?.['sessions'] as unknown[]).length < 11);
  assert.ok(jsonBytes(result.result) <= HARD_RESULT_BYTES);
});

test('requirement node budget reports omitted siblings, including exact budget exhaustion', () => {
  const option = { type: 'course', class_reference: 'CS 1336', minimum_grade: 'C' };
  const exact = renderRequirement({ type: 'collection', required: 59, options: Array(59).fill(option) });
  assert.equal(exact.truncated, false);
  const omitted = renderRequirement({ type: 'collection', required: 60, options: Array(60).fill(option) });
  assert.equal(omitted.truncated, true);
  assert.equal((omitted.value as { options: unknown[] }).options.length, 59);
  assert.equal(renderRequirement({ ...option, class_reference: 'X'.repeat(1000) }).truncated, true);
});

test('sections with no published grade buckets still support schedule discovery and details', async () => {
  const search = await invoke(sectionSearchTool, { subject_prefix: 'CS', course_number: '1336' }, async () => envelope([
    section({ grade_distribution: [] }),
  ]));
  assert.equal(search.payload.ok, true);
  assert.equal(itemsOf(search).length, 1);
  const detail = await invoke(sectionGetTool, { section_id: ID_C }, async (url) => envelope(
    url.endsWith('/professors') ? null : section({ grade_distribution: [] }),
  ));
  assert.equal(detail.payload.ok, true);
  assert.ok((detail.payload.meta?.['notes'] as string[]).some((note) => note.includes('no professor records')));
});
