import { ConfigError } from './errors.js';

export const TOOLSETS = ['academics', 'clubs', 'events'] as const;
export type Toolset = (typeof TOOLSETS)[number];

export const DEFAULT_TOOLSETS: readonly Toolset[] = ['academics', 'clubs'];
export const TOOLSETS_ENV = 'NEBULA_MCP_TOOLSETS';
export const API_KEY_ENV = 'NEBULA_API_KEY';

export interface ServerConfig {
  apiKey: string | undefined;
  toolsets: readonly Toolset[];
}

/**
 * Parse a toolset selection. A missing value selects the default toolsets; an
 * empty or unknown value is a configuration error, not a silent fallback.
 */
export function parseToolsets(raw: string | undefined): readonly Toolset[] {
  if (raw === undefined) return DEFAULT_TOOLSETS;

  const trimmed = raw.trim();
  if (trimmed === '') {
    throw new ConfigError(`${TOOLSETS_ENV} is set but empty; omit it or list a subset of ${TOOLSETS.join(', ')}`);
  }

  const selected = new Set<Toolset>();
  for (const part of trimmed.split(',')) {
    const name = part.trim();
    if (name === '') {
      throw new ConfigError(`${TOOLSETS_ENV} contains an empty entry; list a subset of ${TOOLSETS.join(', ')}`);
    }
    if (!(TOOLSETS as readonly string[]).includes(name)) {
      throw new ConfigError(
        `Unknown toolset "${name}" in ${TOOLSETS_ENV}; expected a comma-separated subset of ${TOOLSETS.join(', ')}`,
      );
    }
    selected.add(name as Toolset);
  }

  if (selected.size === 0) {
    throw new ConfigError(`${TOOLSETS_ENV} did not select any toolset`);
  }

  // Preserve canonical order regardless of the client's ordering.
  return TOOLSETS.filter((toolset) => selected.has(toolset));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const rawKey = env[API_KEY_ENV];
  const apiKey = rawKey === undefined || rawKey.trim() === '' ? undefined : rawKey.trim();
  return {
    apiKey,
    toolsets: parseToolsets(env[TOOLSETS_ENV]),
  };
}
