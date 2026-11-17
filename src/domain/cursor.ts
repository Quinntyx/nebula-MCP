import { createHash } from 'node:crypto';
import { invalidArgument } from '../errors.js';

/** Cursors are opaque, short, and bound to one tool plus one normalized filter set. */
const CURSOR_VERSION = 1;
const CURSOR_MAX_LENGTH = 512;
const MAX_OFFSET = 100_000;

interface CursorPayload {
  v: number;
  t: string;
  f: string;
  o: number;
}

/** Deterministic JSON so equivalent filter objects hash identically. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, member]) => member !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, member]) => `${JSON.stringify(key)}:${stableStringify(member)}`)
    .join(',')}}`;
}

export function filterFingerprint(filters: unknown): string {
  return createHash('sha256').update(stableStringify(filters)).digest('base64url').slice(0, 16);
}

export function encodeCursor(tool: string, fingerprint: string, offset: number): string {
  const payload: CursorPayload = { v: CURSOR_VERSION, t: tool, f: fingerprint, o: offset };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function cursorMismatch(): never {
  throw invalidArgument('cursor does not match this tool and filter combination');
}

export function decodeCursor(raw: string, tool: string, fingerprint: string): number {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > CURSOR_MAX_LENGTH) {
    throw invalidArgument('cursor is missing or too long');
  }
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw invalidArgument('cursor is not valid base64url');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw invalidArgument('cursor is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw invalidArgument('cursor payload is malformed');
  }
  const payload = parsed as Partial<CursorPayload>;
  if (payload.v !== CURSOR_VERSION) {
    throw invalidArgument('cursor version is not supported');
  }
  if (payload.t !== tool) cursorMismatch();
  if (payload.f !== fingerprint) cursorMismatch();
  if (
    typeof payload.o !== 'number' ||
    !Number.isSafeInteger(payload.o) ||
    payload.o < 0 ||
    payload.o > MAX_OFFSET
  ) {
    throw invalidArgument('cursor offset is out of range');
  }
  return payload.o;
}

export const CURSOR_MAX_OFFSET = MAX_OFFSET;
