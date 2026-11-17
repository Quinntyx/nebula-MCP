import { z } from 'zod';
import { fitList, localPage } from '../domain/budget.js';
import { decodeCursor, encodeCursor, filterFingerprint } from '../domain/cursor.js';
import { normalizeText, parseArgs } from './args.js';
import { eventRow } from './mappers.js';
import { success } from './result.js';
import { READ_ONLY_ANNOTATIONS, type ToolDefinition } from './types.js';

const TOOL = 'campus_events_on_date';
const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 50;

const pathSegment = z
  .string()
  .min(1)
  .max(60)
  .refine((value) => !value.includes('/') && !value.includes('\\'), 'must not contain path separators')
  .refine((value) => !value.includes('..'), 'must not contain dot segments')
  .refine((value) => !/%[0-9A-Fa-f]{2}/.test(value), 'must not contain percent escapes')
  .refine((value) => value.trim() === value && value.length > 0, 'must be non-empty and unpadded');

const shape = {
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  building: pathSegment.optional(),
  room: pathSegment.optional(),
  query: z.string().min(1).max(80).optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().min(1).max(512).optional(),
};

const schema = z
  .object(shape)
  .strict()
  .superRefine((value, ctx) => {
    if (value.room !== undefined && value.building === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['building'], message: 'room requires building' });
    }
    const [year, month, day] = value.date.split('-').map(Number) as [number, number, number];
    const parsed = new Date(Date.UTC(year, month - 1, day));
    const valid =
      year >= 2000 &&
      year <= 2100 &&
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day;
    if (!valid) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['date'], message: 'date is not a real calendar date' });
    }
  });

export const campusEventsTool: ToolDefinition = {
  name: TOOL,
  title: 'List UT Dallas campus events on a date',
  description: 'List UTD Comet Calendar campus events on YYYY-MM-DD, optionally by building/room or keyword. Empty may mean the date is not indexed.',
  toolset: 'events',
  inputShape: shape,
  annotations: READ_ONLY_ANNOTATIONS,
  async handler(raw, ctx) {
    const args = parseArgs(schema, raw);
    const query = args.query === undefined ? undefined : normalizeText(args.query);
    const fingerprint = filterFingerprint({
      date: args.date,
      building: args.building ?? null,
      room: args.room ?? null,
      query: query ?? null,
    });
    const offset = args.cursor === undefined ? 0 : decodeCursor(args.cursor, TOOL, fingerprint);

    const calendarPage = await ctx.repo.calendarEvents(args.date, args.building, args.room, {
      signal: ctx.signal,
    });

    const needle = query?.toLowerCase();
    const matched = calendarPage.events.filter((entry) => {
      if (needle === undefined) return true;
      const haystack = [
        entry.event.summary,
        entry.event.description,
        ...entry.event.event_type,
        ...entry.event.topic,
        ...entry.event.event_tags,
        ...entry.event.department,
        entry.building,
        entry.room,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });

    const rows = matched.map((entry) => eventRow(entry, 150));
    const { page, totalRows } = localPage(rows, offset);

    const fitted = fitList({
      rows: page,
      limit: args.limit,
      offset,
      totalRows,
      cursor: (next) => encodeCursor(TOOL, fingerprint, next),
      build: (state) => ({
        date: args.date,
        building: args.building,
        room: args.room,
        query,
        items: state.items,
        returned: state.returned,
        has_more: state.has_more,
        ...(state.next_cursor === undefined ? {} : { next_cursor: state.next_cursor }),
      }),
    });

    const notes = [
      'Campus calendar coverage depends on upstream indexing; an empty day can mean no indexed events rather than no activity.',
      'Listed rooms are event locations, not verified or moderated bookings.',
      'Events are calendar entries only; this server never registers attendance or mutates upstream data.',
    ];
    if (fitted.returned < Math.min(args.limit, page.length)) {
      notes.push('Rows were trimmed to fit the output budget; has_more and next_cursor describe the rows actually returned.');
    }

    return success(fitted.data, { requests: calendarPage.requests, notes }, ctx.now);
  },
};
