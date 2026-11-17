import { z } from 'zod';
import { invalidArgument } from '../errors.js';
import { fitList } from '../domain/budget.js';
import { decodeCursor, encodeCursor, filterFingerprint } from '../domain/cursor.js';
import { normalizePrefix, normalizeText, parseArgs } from './args.js';
import type { CourseSearchFilters } from '../upstream/repository.js';
import { courseSummaryRow } from './mappers.js';
import { success } from './result.js';
import { READ_ONLY_ANNOTATIONS, type ToolDefinition } from './types.js';

const TOOL = 'course_search';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const PREFIX_RE = /^[A-Z0-9 &-]{1,8}$/;

const shape = {
  subject_prefix: z.string().min(1).max(8),
  course_number: z.string().min(1).max(12).optional(),
  catalog_year: z.string().min(1).max(24).optional(),
  school: z.string().min(1).max(60).optional(),
  class_level: z.string().min(1).max(40).optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().min(1).max(512).optional(),
};

const schema = z.object(shape).strict();

export const courseSearchTool: ToolDefinition = {
  name: TOOL,
  title: 'Search UT Dallas courses',
  description: 'Find UTD courses by exact subject prefix, number, catalog year, school or class level. Prefix required; one upstream page per call.',
  toolset: 'academics',
  inputShape: shape,
  annotations: READ_ONLY_ANNOTATIONS,
  async handler(raw, ctx) {
    const args = parseArgs(schema, raw);
    const prefix = normalizePrefix(args.subject_prefix);
    if (!PREFIX_RE.test(prefix)) {
      throw invalidArgument('subject_prefix must be a short alphanumeric subject code such as CS', 'Remove punctuation or wildcards.');
    }
    const courseNumber = args.course_number === undefined ? undefined : normalizeText(args.course_number);
    const filters: CourseSearchFilters = { subject_prefix: prefix };
    if (courseNumber !== undefined) filters.course_number = courseNumber;
    for (const key of ['catalog_year', 'school', 'class_level'] as const) {
      const value = args[key];
      if (value !== undefined) filters[key] = normalizeText(value);
    }
    const fingerprint = filterFingerprint(filters);
    const offset = args.cursor === undefined ? 0 : decodeCursor(args.cursor, TOOL, fingerprint);

    const result = await ctx.repo.searchCourses(filters, offset, { signal: ctx.signal });
    const rows = result.value.map(courseSummaryRow);

    const fitted = fitList({
      rows,
      limit: args.limit,
      offset,
      totalRows: null,
      cursor: (next) => encodeCursor(TOOL, fingerprint, next),
      build: (state) => ({
        query: filters,
        items: state.items,
        returned: state.returned,
        has_more: state.has_more,
        ...(state.next_cursor === undefined ? {} : { next_cursor: state.next_cursor }),
      }),
    });

    const notes = [
      'Results come from the current upstream catalog index, not a live course-catalog lookup.',
      'Extra filters (course_number, catalog_year, school, class_level) are matched exactly; they are not fuzzy or auto-corrected.',
    ];
    if (fitted.has_more === null) {
      notes.push('has_more is null because the page was non-empty and the API does not report totals; a follow-up cursor returns the next page.');
    }
    if (fitted.returned < Math.min(args.limit, rows.length)) {
      notes.push('Rows were trimmed to fit the output budget; has_more and next_cursor describe the rows actually returned.');
    }

    return success(fitted.data, { notes, requests: result.requests }, ctx.now);
  },
};
