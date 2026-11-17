import { z } from 'zod';
import { fitDetail } from '../domain/budget.js';
import { canonicalTerm } from '../domain/terms.js';
import { compact } from '../format.js';
import { calendarView } from './mappers.js';
import { parseArgs } from './args.js';
import { success } from './result.js';
import { READ_ONLY_ANNOTATIONS, type ToolDefinition } from './types.js';

const TOOL = 'academic_calendar_get';

const shape = { term: z.string().min(2).max(24).optional() };
const schema = z.object(shape).strict();

export const academicCalendarGetTool: ToolDefinition = {
  name: TOOL,
  title: 'Get a UT Dallas academic calendar',
  description: 'Get UTD academic term dates, registration/drop deadlines and exams. Term accepts 26F or Fall 2026; omitted uses the upstream current marker.',
  toolset: 'academics',
  inputShape: shape,
  annotations: READ_ONLY_ANNOTATIONS,
  async handler(raw, ctx) {
    const args = parseArgs(schema, raw);
    const requestedTerm = args.term === undefined ? undefined : canonicalTerm(args.term);
    const result =
      requestedTerm === undefined
        ? await ctx.repo.currentAcademicCalendar({ signal: ctx.signal })
        : await ctx.repo.academicCalendar(requestedTerm, { signal: ctx.signal });

    const calendar = result.value;
    const data = fitDetail((scale) =>
      compact({
        requested_term: requestedTerm,
        ...calendarView(calendar, scale),
      }),
    );

    const notes = [
      requestedTerm === undefined
        ? 'The upstream API chose this calendar through its own current marker; this server does not infer the current term from the clock and cannot certify that the marker is up to date.'
        : 'This calendar was requested by term id; upstream availability determines which terms exist.',
      'Dates are passed through as upstream text without timezone conversion or invented times.',
      'Nothing is fetched from linked source URLs automatically.',
    ];

    return success(data, { requests: result.requests, notes }, ctx.now);
  },
};
