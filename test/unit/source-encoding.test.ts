import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Every source and test file, so a stray non-UTF-8 byte fails here instead of in the production build. */
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return files(path);
    return /\.(ts|astro|css|json|md)$/.test(e.name) ? [path] : [];
  });
}

describe('source encoding', () => {
  it('keeps every source and test file valid UTF-8', () => {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const bad = [...files('src'), ...files('test')].filter((path) => {
      try {
        decoder.decode(readFileSync(path));
        return false;
      } catch {
        return true;
      }
    });
    expect(bad).toEqual([]);
  });
});
