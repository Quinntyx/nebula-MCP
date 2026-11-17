import { z } from 'zod';
import { fitList, localPage } from '../domain/budget.js';
import { decodeCursor, encodeCursor, filterFingerprint } from '../domain/cursor.js';
import { canonicalSessionName, canonicalTerm, compareTermsDescending } from '../domain/terms.js';
import { invalidArgument } from '../errors.js';
import type { UpstreamSection } from '../upstream/schemas.js';
import { normalizePrefix, normalizeText, parseArgs } from './args.js';
import { sectionRow } from './mappers.js';
import { success } from './result.js';
import { READ_ONLY_ANNOTATIONS, type ToolDefinition } from './types.js';

const TOOL = 'section_search';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

const shape = {
  subject_prefix: z.string().min(1).max(8).optional(),
  course_number: z.string().min(1).max(12).optional(),
  first_name: z.string().min(1).max(64).optional(),
  last_name: z.string().min(1).max(64).optional(),
  term: z.string().min(2).max(24).optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().min(1).max(512).optional(),
};

const schema = z
  .object(shape)
  .strict()
  .superRefine((value, ctx) => {
    const hasPrefix = value.subject_prefix !== undefined;
    const hasNumber = value.course_number !== undefined;
    const hasFirst = value.first_name !== undefined;
    const hasLast = value.last_name !== undefined;
    if (hasPrefix !== hasNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasPrefix ? 'course_number' : 'subject_prefix'],
        message: 'subject_prefix and course_number must be provided together',
      });
    }
    if (hasFirst !== hasLast) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasFirst ? 'last_name' : 'first_name'],
        message: 'first_name and last_name must be provided together',
      });
    }
    if (!hasPrefix && !hasFirst) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subject_prefix'],
        message: 'provide an exact course pair, an exact professor pair, or both',
      });
    }
  });

interface SectionQuery {
  course?: { subject_prefix: string; course_number: string };
  professor?: { first_name: string; last_name: string };
  term?: string;
}

function matches(section: UpstreamSection, query: SectionQuery): boolean {
  if (query.course) {
    const found = (section.course_details ?? []).some(
      (course) =>
        normalizePrefix(course.subject_prefix) === query.course!.subject_prefix &&
        normalizeText(course.course_number) === query.course!.course_number,
    );
    if (!found) return false;
  }
  if (query.professor) {
    const found = (section.professor_details ?? []).some(
      (professor) =>
        normalizeText(professor.first_name) === query.professor!.first_name &&
        normalizeText(professor.last_name) === query.professor!.last_name,
    );
    if (!found) return false;
  }
  if (query.term) {
    const term = canonicalSessionName(section.academic_session?.name ?? '');
    if (term !== query.term) return false;
  }
  return true;
}

export const sectionSearchTool: ToolDefinition = {
  name: TOOL,
  title: 'Search UT Dallas sections',
  description: 'List UTD Trends sections by exact course (prefix+number) and/or professor (first+last name), optionally term (26S/26U/26F). Coverage may lag.',
  toolset: 'academics',
  inputShape: shape,
  annotations: READ_ONLY_ANNOTATIONS,
  async handler(raw, ctx) {
    const args = parseArgs(schema, raw);
    const query: SectionQuery = {};
    if (args.subject_prefix !== undefined && args.course_number !== undefined) {
      query.course = {
        subject_prefix: normalizePrefix(args.subject_prefix),
        course_number: normalizeText(args.course_number),
      };
    }
    if (args.first_name !== undefined && args.last_name !== undefined) {
      query.professor = {
        first_name: normalizeText(args.first_name),
        last_name: normalizeText(args.last_name),
      };
    }
    if (args.term !== undefined) {
      query.term = canonicalTerm(args.term);
    }
    if (!query.course && !query.professor) {
      throw invalidArgument('provide an exact course pair, an exact professor pair, or both');
    }

    const fingerprint = filterFingerprint(query);
    const offset = args.cursor === undefined ? 0 : decodeCursor(args.cursor, TOOL, fingerprint);

    // Live validation showed the combined materialized index intermittently
    // returns empty for unchanged valid queries. A course query already embeds
    // all instructors: apply the exact professor predicate locally in ONE call.
    const fetched = query.course
      ? await ctx.repo.trendsCourseSections(query.course.subject_prefix, query.course.course_number, {
          signal: ctx.signal,
        })
      : await ctx.repo.trendsProfessorSections(
          query.professor!.first_name,
          query.professor!.last_name,
          { signal: ctx.signal },
        );

    const availableTerms = Array.from(
      new Set(
        fetched.value
          .map((section) => canonicalSessionName(section.academic_session?.name ?? ''))
          .filter((term): term is string => term !== undefined),
      ),
    )
      .sort(compareTermsDescending)
      .slice(0, 8);

    const rows = fetched.value
      .filter((section) => matches(section, query))
      .sort((left, right) => {
        const termDelta = compareTermsDescending(
          canonicalSessionName(left.academic_session?.name ?? '') ?? '',
          canonicalSessionName(right.academic_session?.name ?? '') ?? '',
        );
        if (termDelta !== 0) return termDelta;
        const leftCourse = left.course_details?.[0];
        const rightCourse = right.course_details?.[0];
        const codeDelta = `${leftCourse?.subject_prefix ?? ''}${leftCourse?.course_number ?? ''}`.localeCompare(
          `${rightCourse?.subject_prefix ?? ''}${rightCourse?.course_number ?? ''}`,
        );
        if (codeDelta !== 0) return codeDelta;
        const sectionDelta = left.section_number.localeCompare(right.section_number);
        if (sectionDelta !== 0) return sectionDelta;
        return left._id.localeCompare(right._id);
      })
      .map(sectionRow);

    const { page, totalRows } = localPage(rows, offset);

    const fitted = fitList({
      rows: page,
      limit: args.limit,
      offset,
      totalRows,
      cursor: (next) => encodeCursor(TOOL, fingerprint, next),
      build: (state) => ({
        query,
        items: state.items,
        returned: state.returned,
        has_more: state.has_more,
        ...(state.next_cursor === undefined ? {} : { next_cursor: state.next_cursor }),
      }),
    });

    const notes = [
      'Section coverage comes from the upstream Trends dataset, which is derived and may lag the live schedule; an empty result does not prove a course is not offered.',
      'Course codes and professor names are matched exactly; no fuzzy or title-case retries are attempted.',
    ];
    if (query.term) {
      notes.push('term is canonicalized to YY[SUF] before matching the embedded academic session.');
    }
    if (query.professor) {
      notes.push('Homonymous instructors are merged by the upstream dataset; id-based professor scoping is not available on this route.');
      if (query.course) notes.push('Combined filters use the course Trends response with exact local instructor filtering, avoiding the upstream combined index that returned inconsistent empty results during live validation.');
    }
    if (fitted.returned < Math.min(args.limit, page.length)) {
      notes.push('Rows were trimmed to fit the output budget; has_more and next_cursor describe the rows actually returned.');
    }

    return success(
      fitted.data,
      {
        requests: fetched.requests,
        extra: { available_terms: availableTerms },
        notes,
      },
      ctx.now,
    );
  },
};
