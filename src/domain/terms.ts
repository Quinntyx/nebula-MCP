import { invalidArgument } from '../errors.js';

/** Maps the upstream `academic_session.name` season vocabulary to the id suffix. */
const SEASON_CODES: Record<string, string> = {
  spring: 'S',
  summer: 'U',
  fall: 'F',
};

const SEASON_NAMES: Record<string, string> = {
  S: 'spring',
  U: 'summer',
  F: 'fall',
};

export interface TermInfo {
  id: string;
  season: 'spring' | 'summer' | 'fall';
  year: number;
}

const SHORT_TERM = /^(\d{4}|\d{2})\s*([SUF])$/i;
const LONG_TERM = /^([A-Za-z]+)\s*(\d{4}|\d{2})$/;

function normalizeYear(raw: string): number | undefined {
  const numeric = Number(raw);
  if (!Number.isInteger(numeric)) return undefined;
  if (raw.length === 2) return 2000 + numeric;
  if (numeric >= 1900 && numeric <= 2099) return numeric;
  return undefined;
}

/**
 * Parses a caller term into a canonical `YY[SUF]` id without guessing.
 * Accepts `26F`, `2026F`, `fall 2026`, `Fall 26`. Anything else is rejected.
 */
export function parseTerm(raw: string): TermInfo | undefined {
  const value = raw.trim();
  if (value.length === 0 || value.length > 24) return undefined;

  const short = SHORT_TERM.exec(value);
  if (short) {
    const year = normalizeYear(short[1]!);
    const suffix = short[2]!.toUpperCase();
    if (year === undefined) return undefined;
    return {
      id: `${String(year % 100).padStart(2, '0')}${suffix}`,
      season: seasonForSuffix(suffix),
      year,
    };
  }

  const long = LONG_TERM.exec(value);
  if (long) {
    const season = SEASON_CODES[long[1]!.toLowerCase()];
    const year = normalizeYear(long[2]!);
    if (!season || year === undefined) return undefined;
    return {
      id: `${String(year % 100).padStart(2, '0')}${season}`,
      season: seasonForSuffix(season),
      year,
    };
  }

  return undefined;
}

function seasonForSuffix(suffix: string): 'spring' | 'summer' | 'fall' {
  const name = SEASON_NAMES[suffix];
  if (name === undefined) throw new Error(`unreachable season suffix ${suffix}`);
  return name as 'spring' | 'summer' | 'fall';
}

/** Validates a caller term and returns the canonical upstream id. */
export function canonicalTerm(raw: string): string {
  const parsed = parseTerm(raw);
  if (!parsed) {
    throw invalidArgument(
      'term must look like 26F, 2026F, Fall 2026, or Fall 26',
      'Use the academic session id or an English season plus year; no other formats are guessed.',
    );
  }
  return parsed.id;
}

/**
 * Maps an upstream session name (`Fall 2026`, `26F`, …) to a canonical id.
 * Unrecognised names are skipped by callers instead of being guessed.
 */
export function canonicalSessionName(raw: string): string | undefined {
  return parseTerm(raw)?.id;
}

export function termYear(id: string): number {
  const numeric = Number(id.slice(0, 2));
  return Number.isFinite(numeric) ? 2000 + numeric : 0;
}

export function termSeasonRank(id: string): number {
  const rank: Record<string, number> = { S: 0, U: 1, F: 2 };
  return rank[id.slice(2)] ?? -1;
}

/** Chronological comparison; newer terms sort first. Unknown ids sort last. */
export function compareTermsDescending(a: string, b: string): number {
  const yearDelta = termYear(b) - termYear(a);
  if (yearDelta !== 0) return yearDelta;
  return termSeasonRank(b) - termSeasonRank(a);
}
