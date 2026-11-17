/** Presentation helpers that keep every emitted string and collection bounded. */

export interface Capped {
  text: string;
  truncated: boolean;
}

export function capText(value: string | null | undefined, max: number): Capped {
  if (value === null || value === undefined) return { text: '', truncated: false };
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return { text: normalized, truncated: false };
  return { text: `${normalized.slice(0, max - 1).trimEnd()}…`, truncated: true };
}

export function capArray<T>(items: readonly T[], max: number): { items: T[]; truncated: boolean } {
  if (items.length <= max) return { items: [...items], truncated: false };
  return { items: items.slice(0, max), truncated: true };
}

/** Drop undefined members so minified JSON stays compact. */
export function compact<T extends Record<string, unknown>>(value: T): T {
  const output: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value)) {
    if (member !== undefined && member !== null) output[key] = member;
  }
  return output as T;
}

export function isoNow(now: () => Date): string {
  return now().toISOString();
}

/** Collapse whitespace for descriptions that will be embedded in text results. */
export function describe(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
