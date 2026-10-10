import { writeFile } from 'node:fs/promises';
import type { ImportFiles } from '../../src/importers/types';

type Spec = string | { size?: number; text?: string; lastModified?: number };

/** An ImportFiles over in-memory files; a string value is the file's text. */
export function memoryFiles(files: Record<string, Spec>): ImportFiles & { reads: string[] } {
  const reads: string[] = [];
  const entries = Object.entries(files).map(([path, spec]) => {
    const s = typeof spec === 'string' ? { text: spec } : spec;
    return { path, size: s.size ?? s.text?.length ?? 1, lastModified: s.lastModified ?? null };
  });
  const textOf = (path: string) => {
    const spec = files[path];
    if (spec === undefined) throw new Error(`no such file: ${path}`);
    return typeof spec === 'string' ? spec : (spec.text ?? '');
  };
  return {
    entries,
    reads,
    async readText(path) {
      reads.push(path);
      return textOf(path);
    },
    async download(path, file) {
      await writeFile(file, textOf(path));
    },
  };
}
