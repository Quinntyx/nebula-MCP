import { z } from 'zod';
import { invalidArgument } from '../errors.js';

/** Upstream MongoDB ObjectID path parameters. */
export const objectIdShape = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'must be a 24-character hexadecimal id');

/**
 * Validate caller arguments against the strict schema. Unknown keys are
 * rejected rather than silently ignored, and error text never echoes values.
 */
export function parseArgs<S extends z.ZodTypeAny>(schema: S, args: unknown): z.output<S> {
  const result = schema.safeParse(args ?? {});
  if (result.success) {
    if (result.data && typeof result.data === 'object' && Object.values(result.data).some(
      (value) => typeof value === 'string' && value.trim() === '',
    )) {
      throw invalidArgument('Text arguments must contain non-whitespace characters.');
    }
    return result.data as z.output<S>;
  }

  const issue = result.error.issues[0];
  if (!issue) {
    throw invalidArgument('arguments could not be validated');
  }
  // Zod messages can include attacker-controlled unknown property names or enum
  // values. Publish only a static diagnostic, never the rejected input.
  throw invalidArgument('Arguments do not match this tool schema.', 'Use the published property types, bounds, and valid argument combinations.');
}

/** Normalize user-supplied free text without guessing its meaning. */
export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Course subject prefixes are canonical uppercase in the upstream index. */
export function normalizePrefix(value: string): string {
  return normalizeText(value).toUpperCase();
}
