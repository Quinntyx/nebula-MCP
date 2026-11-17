/**
 * Error vocabulary for tool results. Every failure surfaced to an MCP client is
 * one of these codes; upstream text is never passed through.
 */
export const ERROR_CODES = [
  'INVALID_ARGUMENT',
  'NOT_FOUND',
  'AUTH_MISSING',
  'AUTH_REJECTED',
  'RATE_LIMITED',
  'UPSTREAM_TIMEOUT',
  'UPSTREAM_ERROR',
  'UPSTREAM_SCHEMA',
  'RESPONSE_TOO_LARGE',
  'CANCELLED',
  'UNSUPPORTED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorEnvelope {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    hint?: string;
    retryable: boolean;
    upstream_status?: number;
  };
}

export interface ToolErrorOptions {
  hint?: string;
  retryable?: boolean;
  upstreamStatus?: number;
}

/** An expected, bounded failure. Messages must be static or already sanitized. */
export class ToolError extends Error {
  readonly code: ErrorCode;
  readonly hint: string | undefined;
  readonly retryable: boolean;
  readonly upstreamStatus: number | undefined;

  constructor(code: ErrorCode, message: string, options: ToolErrorOptions = {}) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.hint = options.hint;
    this.retryable = options.retryable ?? false;
    this.upstreamStatus = options.upstreamStatus;
  }

  toEnvelope(): ErrorEnvelope {
    const error: ErrorEnvelope['error'] = {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
    if (this.hint !== undefined) error.hint = this.hint;
    if (this.upstreamStatus !== undefined) error.upstream_status = this.upstreamStatus;
    return { ok: false, error };
  }
}

export function invalidArgument(message: string, hint?: string): ToolError {
  return new ToolError('INVALID_ARGUMENT', message, hint === undefined ? {} : { hint });
}

export function upstreamSchema(message: string): ToolError {
  return new ToolError('UPSTREAM_SCHEMA', message, {
    hint: 'The upstream response did not match its documented shape. Try again later.',
  });
}

/** Configuration failures happen before MCP starts; they go to stderr, not to clients. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const HEADER_LIKE = /\b(x-api-key|api[-_ ]?key|authorization|cookie|set-cookie)\b(\s*[:=]\s*)([^\s"',;}]+)/gi;
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi;

/**
 * Defense in depth: strip the runtime key and header-like secrets from any text
 * that could reach a client, a log line, or an error envelope.
 */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length < 4) continue;
    result = result.split(secret).join('[redacted]');
  }
  result = result.replace(HEADER_LIKE, (_match, name: string, separator: string) => `${name}${separator}[redacted]`);
  result = result.replace(URL_USERINFO, '$1[redacted]@');
  return result;
}
