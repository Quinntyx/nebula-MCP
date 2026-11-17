import { ToolError } from '../errors.js';

/**
 * Output budget. List views target ~6 KB of minified JSON; detail views may reach
 * a 12 KB hard ceiling. The budget never splits upstream requests.
 */
export const TARGET_RESULT_BYTES = 6_000;
export const HARD_RESULT_BYTES = 12_000;

export function jsonBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 0 : Buffer.byteLength(serialized, 'utf8');
}

export interface ListState {
  items: unknown[];
  returned: number;
  has_more: boolean | null;
  next_cursor?: string | undefined;
}

export interface ListFitInput {
  /** Rows available to emit from the single response already fetched. */
  rows: unknown[];
  /** Caller-requested row cap. */
  limit: number;
  /** Rows already skipped upstream (cursor offset). */
  offset: number;
  /**
   * Known local match count for single-response datasets, or null when the
   * upstream page is the only evidence about exhaustion.
   */
  totalRows: number | null;
  cursor: (nextOffset: number) => string;
  build: (state: ListState) => Record<string, unknown>;
}

export interface ListFitResult {
  data: Record<string, unknown>;
  returned: number;
  has_more: boolean | null;
}

/**
 * Applies a cursor offset to a complete local result set (Trends, clubs,
 * term grades, calendar events) so `fitList` can page it without a cache.
 */
export function localPage<T>(rows: readonly T[], offset: number): { page: T[]; totalRows: number } {
  return { page: rows.slice(offset), totalRows: rows.length };
}

/**
 * Shrinks the emitted row count until the payload fits the target budget.
 * `has_more` is exact when the full local match set is known, optimistic (true)
 * while an upstream page has unemitted rows, and `null` only when a non-empty
 * upstream page was fully consumed and exhaustion cannot be proven.
 */
export function fitList(input: ListFitInput): ListFitResult {
  const desired = Math.max(0, Math.min(input.limit, input.rows.length));
  // A nonempty page must either emit at least one row or fail explicitly.
  // A zero-row success cannot advance a cursor without dropping data.
  const minimum = input.rows.length > 0 ? 1 : 0;
  for (let count = desired; count >= minimum; count -= 1) {
    const hasMore =
      input.totalRows === null
        ? count < input.rows.length
          ? true
          : input.rows.length === 0
            ? false
            : null
        : input.offset + count < input.totalRows;
    const state: ListState = {
      items: input.rows.slice(0, count),
      returned: count,
      has_more: hasMore,
      next_cursor:
        hasMore === false || count === 0 ? undefined : input.cursor(input.offset + count),
    };
    const data = input.build(state);
    if (jsonBytes(data) <= TARGET_RESULT_BYTES) {
      return { data, returned: count, has_more: hasMore };
    }
  }
  throw new ToolError(
    'RESPONSE_TOO_LARGE',
    'No result row could fit the output budget; no rows were skipped.',
    { hint: 'Add a filter or reduce the requested limit.' },
  );
}

/**
 * Builds a detail payload, retrying with progressively tighter text/collection
 * caps. Falls back to the hardest acceptable reduction before failing.
 */
export function fitDetail(
  build: (scale: number) => Record<string, unknown>,
): Record<string, unknown> {
  let fallback: Record<string, unknown> | undefined;
  for (const scale of [1, 0.5, 0.25]) {
    const data = build(scale);
    const bytes = jsonBytes(data);
    if (bytes <= TARGET_RESULT_BYTES) return data;
    if (bytes <= HARD_RESULT_BYTES) fallback = data;
  }
  if (fallback) return fallback;
  throw new ToolError(
    'RESPONSE_TOO_LARGE',
    'The detail exceeds the output budget; use a narrower request',
    { hint: 'Add a filter or request a smaller record.' },
  );
}

/** Scales a per-field text cap without dropping below a readable floor. */
export function scaledCap(base: number, scale: number, floor = 80): number {
  return Math.max(floor, Math.floor(base * scale));
}
