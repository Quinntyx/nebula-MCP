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
  if (result.success) return result.data as z.output<S>;

  const issue = result.error.issues[0];
  if (!issue) {
    throw invalidArgument('arguments could not be validated');
  }
  const path = issue.path.length > 0 ? issue.path.join('.') : 'arguments';
  throw invalidArgument(`${path}: ${issue.message.slice(0, 200)}`);
}

/** Normalize user-supplied free text without guessing its meaning. */
export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Course subject prefixes are canonical uppercase in the upstream index. */
export function normalizePrefix(value: string): string {
  return normalizeText(value).toUpperCase();
}
