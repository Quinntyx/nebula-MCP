import { z } from 'zod';
import { fitDetail, fitList, localPage } from '../domain/budget.js';
import { decodeCursor, encodeCursor, filterFingerprint } from '../domain/cursor.js';
import { toGradeCounts } from '../domain/grades.js';
import { canonicalSessionName, canonicalTerm, compareTermsDescending } from '../domain/terms.js';
import { invalidArgument } from '../errors.js';
import { capArray, capText, compact } from '../format.js';
import type { GradeFilters } from '../upstream/repository.js';
import type { UpstreamGradeData, UpstreamTypedGradeData } from '../upstream/schemas.js';
import { normalizePrefix, normalizeText, objectIdShape, parseArgs } from './args.js';
import { success } from './result.js';
import { READ_ONLY_ANNOTATIONS, type ToolDefinition } from './types.js';

const TOOL = 'grades_get';
const TERM_DEFAULT_LIMIT = 12;
const TERM_MAX_LIMIT = 40;

const shape = {
  course_id: objectIdShape.optional(),
  professor_id: objectIdShape.optional(),
  section_id: objectIdShape.optional(),
  subject_prefix: z.string().min(1).max(8).optional(),
  course_number: z.string().min(1).max(12).optional(),
  section_number: z.string().min(1).max(12).optional(),
  first_name: z.string().min(1).max(64).optional(),
  last_name: z.string().min(1).max(64).optional(),
  by: z.enum(['overall', 'term', 'term_section_type']).default('overall'),
  terms: z.array(z.string().min(2).max(24)).min(1).max(6).optional(),
  limit: z.number().int().min(1).max(TERM_MAX_LIMIT).optional(),
  cursor: z.string().min(1).max(512).optional(),
};

const schema = z
  .object(shape)
  .strict()
  .superRefine((value, ctx) => {
    const ids = [value.course_id, value.professor_id, value.section_id].filter((id) => id !== undefined);
    const hasFilters = [
      value.subject_prefix,
      value.course_number,
      value.section_number,
      value.first_name,
      value.last_name,
    ].some((field) => field !== undefined);

    if (ids.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['course_id'],
        message: 'provide at most one of course_id, professor_id, section_id',
      });
    }
    if (ids.length === 1 && hasFilters) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['course_id'],
        message: 'ID lookups and filter fields cannot be mixed',
      });
    }
    if (ids.length === 0 && !hasFilters) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['course_id'],
        message: 'provide exactly one ID or at least one filter field',
      });
    }
    if (value.course_number !== undefined && value.subject_prefix === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['subject_prefix'], message: 'course_number requires subject_prefix' });
    }
    if (value.section_number !== undefined && value.course_number === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['course_number'],
        message: 'section_number requires subject_prefix and course_number',
      });
    }
    const isIdLookup = ids.length === 1;
    if (isIdLookup && value.by !== 'overall') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['by'],
        message: 'ID lookups support by=overall only',
      });
    }
    if (isIdLookup && value.terms !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['terms'],
        message: 'term filtering is only available for filter-based lookups',
      });
    }
    if (value.by === 'overall' && value.terms !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['terms'],
        message: 'terms requires by=term or by=term_section_type',
      });
    }
    if (value.by === 'overall' && value.cursor !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cursor'],
        message: 'overall results are a single aggregate row and cannot be paginated',
      });
    }
  });

interface Period {
  id: string;
  term: string | undefined;
  buckets?: Record<string, number>;
  total?: number;
  groups?: Array<{ type: string; buckets: Record<string, number>; total: number }>;
}

export const gradesGetTool: ToolDefinition = {
  name: TOOL,
  title: 'Get UT Dallas grade distributions',
  description: [
    'Returns labelled grade counts (A+ through W, 14 buckets) for one course, professor, or section, or for the exact filter combination the upstream grades routes accept.',
    'Supports overall aggregates and per-term aggregates (optionally split by section type). No GPA or ranking is computed.',
  ].join(' '),
  toolset: 'academics',
  inputShape: shape,
  annotations: READ_ONLY_ANNOTATIONS,
  async handler(raw, ctx) {
    const args = parseArgs(schema, raw);
    const scope = compact({
      course_id: args.course_id,
      professor_id: args.professor_id,
      section_id: args.section_id,
      subject_prefix: args.subject_prefix === undefined ? undefined : normalizePrefix(args.subject_prefix),
      course_number: args.course_number === undefined ? undefined : normalizeText(args.course_number),
      section_number: args.section_number === undefined ? undefined : normalizeText(args.section_number),
      first_name: args.first_name === undefined ? undefined : normalizeText(args.first_name),
      last_name: args.last_name === undefined ? undefined : normalizeText(args.last_name),
    });

    const limitations = [
      'Counts are historical observations; an all-zero distribution means no recorded observations, not proof that the course or instructor no longer exists.',
      'Grades are reported as raw bucket counts. No GPA or instructor ranking is computed or implied.',
    ];

    if (args.by === 'overall') {
      const result =
        args.course_id !== undefined
          ? await ctx.repo.gradesForCourse(args.course_id, { signal: ctx.signal })
          : args.professor_id !== undefined
            ? await ctx.repo.gradesForProfessor(args.professor_id, { signal: ctx.signal })
            : args.section_id !== undefined
              ? await ctx.repo.gradesForSection(args.section_id, { signal: ctx.signal })
              : await ctx.repo.gradesOverall(filterOf(args), { signal: ctx.signal });

      const counts = toGradeCounts(result.value);
      const data = fitDetail(() =>
        compact({
          by: args.by,
          scope,
          buckets: counts.buckets,
          total: counts.observations,
        }),
      );

      return success(
        data,
        { requests: result.requests, notes: [...limitations, ...scopeNotes(args)] },
        ctx.now,
      );
    }

    const filters = filterOf(args);
    const requestedTerms =
      args.terms === undefined ? undefined : new Set(args.terms.map((term) => canonicalTerm(term)));
    const fingerprint = filterFingerprint({ filters, by: args.by, terms: args.terms ?? null });
    const offset = args.cursor === undefined ? 0 : decodeCursor(args.cursor, TOOL, fingerprint);
    const limit = args.limit ?? TERM_DEFAULT_LIMIT;

    let requests: number;
    let periods: Period[];
    let allTerms: string[];

    if (args.by === 'term') {
      const result = await ctx.repo.gradesSemester(filters, { signal: ctx.signal });
      requests = result.requests;
      allTerms = result.value.map((row) => row._id);
      periods = result.value
        .filter((row) => requestedTerms === undefined || matchesTerms(row._id, requestedTerms))
        .map((row: UpstreamGradeData) => periodOf(row._id, row.grade_distribution));
    } else {
      const result = await ctx.repo.gradesSemesterSectionType(filters, { signal: ctx.signal });
      requests = result.requests;
      allTerms = result.value.map((row) => row._id);
      periods = result.value
        .filter((row) => requestedTerms === undefined || matchesTerms(row._id, requestedTerms))
        .map((row: UpstreamTypedGradeData) => {
          const groups = capArray(row.data, 4);
          return {
            id: row._id,
            term: canonicalSessionName(row._id),
            groups: groups.items.map((group) => {
              const counts = toGradeCounts(group.grade_distribution);
              return {
                type: capText(group.type || 'unspecified', 40).text,
                buckets: counts.buckets,
                total: counts.observations,
              };
            }),
          };
        });
    }

    periods.sort((left, right) => {
      const byTerm = compareTermsDescending(left.term ?? left.id, right.term ?? right.id);
      if (byTerm !== 0) return byTerm;
      return right.id.localeCompare(left.id);
    });

    const { page, totalRows } = localPage(periods, offset);

    const fitted = fitList({
      rows: page,
      limit,
      offset,
      totalRows,
      cursor: (next) => encodeCursor(TOOL, fingerprint, next),
      build: (state) => ({
        by: args.by,
        scope,
        terms: state.items.map((period) => {
          const row = period as Period;
          return compact({
            period: row.id,
            term: row.term,
            buckets: row.buckets,
            total: row.total,
            groups: row.groups,
          });
        }),
        returned: state.returned,
        has_more: state.has_more,
        ...(state.next_cursor === undefined ? {} : { next_cursor: state.next_cursor }),
      }),
    });

    const notes = [
      ...limitations,
      ...scopeNotes(args),
      'Term rows are ordered newest first; the upstream aggregate is complete, so has_more is exact.',
    ];
    if (requestedTerms !== undefined) {
      const available = allTerms.map((term) => canonicalSessionName(term) ?? term);
      const missing = [...requestedTerms].filter((term) => !available.includes(term));
      if (missing.length > 0) {
        notes.push(`No rows were returned for requested term(s): ${missing.join(', ')}.`);
      }
      const availableTerms = [...new Set(available)].sort(compareTermsDescending).slice(0, 8);
      if (availableTerms.length > 0) {
        notes.push(`Term rows available in this aggregate (newest first): ${availableTerms.join(', ')}.`);
      }
    }
    if (fitted.returned < Math.min(limit, page.length)) {
      notes.push('Rows were trimmed to fit the output budget; has_more and next_cursor describe the rows actually returned.');
    }

    return success(fitted.data, { requests, notes }, ctx.now);
  },
};

function filterOf(args: {
  subject_prefix?: string | undefined;
  course_number?: string | undefined;
  section_number?: string | undefined;
  first_name?: string | undefined;
  last_name?: string | undefined;
}): GradeFilters {
  return {
    prefix: args.subject_prefix === undefined ? undefined : normalizePrefix(args.subject_prefix),
    number: args.course_number === undefined ? undefined : normalizeText(args.course_number),
    section_number: args.section_number === undefined ? undefined : normalizeText(args.section_number),
    first_name: args.first_name === undefined ? undefined : normalizeText(args.first_name),
    last_name: args.last_name === undefined ? undefined : normalizeText(args.last_name),
  };
}

function periodOf(id: string, distribution: readonly number[]): Period {
  const counts = toGradeCounts(distribution);
  return { id, term: canonicalSessionName(id), buckets: counts.buckets, total: counts.observations };
}

function matchesTerms(id: string, terms: Set<string>): boolean {
  const canonical = canonicalSessionName(id);
  return canonical !== undefined && terms.has(canonical);
}

function scopeNotes(args: {
  course_id?: string | undefined;
  professor_id?: string | undefined;
  section_id?: string | undefined;
  subject_prefix?: string | undefined;
  first_name?: string | undefined;
}): string[] {
  const notes: string[] = [];
  if (args.professor_id !== undefined || args.first_name !== undefined) {
    notes.push('Instructor aggregates are keyed by name upstream, so homonymous instructors are merged.');
  }
  if (args.subject_prefix !== undefined && args.course_id === undefined) {
    notes.push('Course filters resolve through the upstream internal course number, so cross-listed or renumbered courses can be combined.');
  }
  if (args.section_id !== undefined) {
    notes.push('A section aggregate covers the recorded grade distribution for that section only.');
  }
  return notes;
}
