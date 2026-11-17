import { z } from 'zod';
import { fitList, localPage } from '../domain/budget.js';
import { decodeCursor, encodeCursor, filterFingerprint } from '../domain/cursor.js';
import { invalidArgument } from '../errors.js';
import { normalizeText, parseArgs } from './args.js';
import { clubRow } from './mappers.js';
import { success } from './result.js';
import { READ_ONLY_ANNOTATIONS, type ToolDefinition } from './types.js';

const TOOL = 'club_search';
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 15;

const shape = {
  query: z.string().min(1).max(120),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().min(1).max(512).optional(),
};

const schema = z.object(shape).strict();

/** Wildcards are text here; strip them so a query cannot become a broad scan. */
function cleanQuery(raw: string): string {
  const stripped = raw.replace(/[%_\\]/g, ' ').replace(/\s+/g, ' ').trim();
  const alphanumeric = stripped.replace(/[^A-Za-z0-9]/g, '');
  if (alphanumeric.length < 2) {
    throw invalidArgument(
      'query must contain at least two letters or digits after removing wildcard characters',
      'Search for a club name or topic, for example "robotics".',
    );
  }
  return stripped;
}

export const clubSearchTool: ToolDefinition = {
  name: TOOL,
  title: 'Search UT Dallas clubs',
  description: [
    'Searches the Nebula Labs student organization index (fuzzy text search) and returns IDs, slugs, names, tags, and short descriptions.',
    'No approval or active-status claim is made; use club_get for full details.',
  ].join(' '),
  toolset: 'clubs',
  inputShape: shape,
  annotations: READ_ONLY_ANNOTATIONS,
  async handler(raw, ctx) {
    const args = parseArgs(schema, raw);
    const query = cleanQuery(args.query);
    const fingerprint = filterFingerprint({ query: normalizeText(query) });
    const offset = args.cursor === undefined ? 0 : decodeCursor(args.cursor, TOOL, fingerprint);

    const result = await ctx.repo.searchClubs(query, { signal: ctx.signal });
    const rows = result.value.map(clubRow);

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
      'Matches come from the upstream club search index; upstream ranking is preserved.',
      'An empty result means no indexed club matched this query, not that no such organization exists.',
    ];
    if (fitted.returned < Math.min(args.limit, page.length)) {
      notes.push('Rows were trimmed to fit the output budget; has_more and next_cursor describe the rows actually returned.');
    }

    return success(fitted.data, { requests: result.requests, notes }, ctx.now);
  },
};
