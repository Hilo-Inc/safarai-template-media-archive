import { readFileSync } from 'node:fs';
import type { z } from 'zod';
import { shared } from '../lib/shared';
import { configSchema, type ArchiveConfig } from './schema';

/** archive.config.json keys and the environment variables that override them. */
export const ENV_KEYS = {
  preset: 'ARCHIVE_PRESET',
  visibility: 'SITE_VISIBILITY',
  kinds: 'ARCHIVE_KINDS',
  location: 'ARCHIVE_LOCATION',
  mentions: 'ARCHIVE_MENTIONS',
} as const;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

export function resolveConfig(file: unknown, env: Env): ArchiveConfig {
  if (file === null || typeof file !== 'object' || Array.isArray(file)) {
    throw new ConfigError('archive.config.json must be a JSON object');
  }
  const input: Record<string, unknown> = { ...(file as Record<string, unknown>) };
  for (const [key, name] of Object.entries(ENV_KEYS)) {
    const value = env[name]?.trim();
    if (!value) continue;
    input[key] = key === 'kinds' ? value.split(',').map((k) => k.trim()).filter(Boolean) : value;
  }
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) throw new ConfigError(parsed.error.issues.map(describe).join('\n'));
  return parsed.data;
}

function describe(issue: z.core.$ZodIssue): string {
  if (issue.code === 'unrecognized_keys') {
    return `archive.config.json: unknown key ${issue.keys.map((k) => `"${k}"`).join(', ')}`;
  }
  const key = String(issue.path[0] ?? '');
  const variable = ENV_KEYS[key as keyof typeof ENV_KEYS];
  const where = `archive.config.json "${key}"${variable ? ` (or ${variable})` : ''}`;
  if (issue.code === 'invalid_value') return `${where} must be one of: ${issue.values.map(String).join(', ')}`;
  return `${where} ${issue.message}`;
}

export function readConfigFile(path = process.env.ARCHIVE_CONFIG ?? 'archive.config.json'): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ConfigError(`${path} is not valid JSON`);
  }
}

export function loadConfig(): ArchiveConfig {
  return shared('config', () => resolveConfig(readConfigFile(), process.env));
}
