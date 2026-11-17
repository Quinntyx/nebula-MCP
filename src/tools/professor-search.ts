import { z } from 'zod';
import { fitList } from '../domain/budget.js';
import { decodeCursor, encodeCursor, filterFingerprint } from '../domain/cursor.js';
import { invalidArgument } from '../errors.js';
import { normalizeText, parseArgs } from './args.js';
import { professorRow } from './mappers.js';
import { success } from './result.js';
import { READ_ONLY_ANNOTATIONS, type ToolDefinition } from './types.js';

const TOOL = 'professor_search';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

const shape = {
  first_name: z.string().min(1).max(64).optional(),
  last_name: z.string().min(1).max(64).optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().min(1).max(512).optional(),
};

const schema = z.object(shape).strict();

export const professorSearchTool: ToolDefinition = {
  name: TOOL,
  title: 'Search UT Dallas professors',
  description: 'Find UTD professors by exact, case-sensitive first and/or last name. At least one name required; no fuzzy matching or capitalization retries.',
  toolset: 'academics',
  inputShape: shape,
  annotations: READ_ONLY_ANNOTATIONS,
  async handler(raw, ctx) {
    const args = parseArgs(schema, raw);
    const first = args.first_name === undefined ? undefined : normalizeText(args.first_name);
    const last = args.last_name === undefined ? undefined : normalizeText(args.last_name);
    if (first === undefined && last === undefined) {
      throw invalidArgument('provide first_name, last_name, or both', 'A professor search cannot be unbounded.');
    }
    const filters = first === undefined ? { last_name: last } : last === undefined ? { first_name: first } : { first_name: first, last_name: last };
    const fingerprint = filterFingerprint(filters);
    const offset = args.cursor === undefined ? 0 : decodeCursor(args.cursor, TOOL, fingerprint);

    const result = await ctx.repo.searchProfessors(filters, offset, { signal: ctx.signal });
    const rows = result.value.map(professorRow);

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
      'Names are compared exactly as provided; supply the spelling used by the university directory.',
      'has_more is null when a non-empty page cannot prove exhaustion, because the API reports no totals.',
    ];
    if (fitted.returned < Math.min(args.limit, rows.length)) {
      notes.push('Rows were trimmed to fit the output budget; has_more and next_cursor describe the rows actually returned.');
    }

    return success(fitted.data, { notes, requests: result.requests }, ctx.now);
  },
};
